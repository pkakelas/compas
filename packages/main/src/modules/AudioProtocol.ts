import type {AppModule} from '../AppModule.js';
import type {ModuleContext} from '../ModuleContext.js';
import {protocol} from 'electron';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {extname} from 'node:path';
import {getSongPath} from './Database.js';

export const AUDIO_SCHEME = 'compas-audio';

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
};

function contentTypeFor(filePath: string): string {
  return MIME_BY_EXT[extname(filePath).toLowerCase()] || 'audio/mpeg';
}

// The renderer document and `compas-audio://` are different origins, so the
// graphic equalizer — which taps the playing <audio> element through a Web
// Audio MediaElementSource — would receive a *tainted* (silent) stream unless
// the response opts into CORS. We send a permissive ACAO and expose the range
// headers the media stack reads; the renderer pairs this with
// `crossOrigin = "anonymous"` on the element so the captured audio is audible.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

// Parse a single-range HTTP `Range` header (e.g. `bytes=1000-` or `bytes=0-1023`).
// Returns null when the header is absent or not a form we serve, so the caller
// falls back to a full 200 response.
function parseRange(header: string | null, size: number): {start: number; end: number} | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  let start: number;
  let end: number;

  if (rawStart === '') {
    // suffix range: last N bytes
    if (rawEnd === '') return null;
    const suffix = parseInt(rawEnd, 10);
    if (suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(rawStart, 10);
    end = rawEnd === '' ? size - 1 : parseInt(rawEnd, 10);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  end = Math.min(end, size - 1);
  return {start, end};
}

/**
 * Streams imported audio files to the renderer via `compas-audio://song/<id>`.
 *
 * Seeking in an HTML5 `<audio>` element (Howler `html5: true`) requires the
 * source to honor HTTP range requests — without a `206 Partial Content`
 * response the element reports `seekable = [0,0]` and clicking ahead in the
 * waveform snaps back to the start. Electron's `net.fetch` does NOT serve ranges
 * for `file://` URLs, so we read the requested byte slice off disk ourselves and
 * return it with the proper `Content-Range` / `Accept-Ranges` headers.
 *
 * The scheme must be registered as privileged BEFORE app ready — see
 * `registerAudioScheme()` which is called at module load in `index.ts`.
 */
export class AudioProtocolModule implements AppModule {
  async enable({app}: ModuleContext): Promise<void> {
    await app.whenReady();

    protocol.handle(AUDIO_SCHEME, async request => {
      const url = new URL(request.url);
      // compas-audio://song/<id>
      const id = url.pathname.replace(/^\/+/, '') || url.hostname;
      const songId = id.startsWith('song/') ? id.slice('song/'.length) : id;

      const filePath = getSongPath(decodeURIComponent(songId));
      if (!filePath) {
        return new Response('Not found', {status: 404});
      }

      let size: number;
      try {
        const info = await stat(filePath);
        if (!info.isFile()) return new Response('Not found', {status: 404});
        size = info.size;
      } catch {
        return new Response('Not found', {status: 404});
      }

      const contentType = contentTypeFor(filePath);
      const range = parseRange(request.headers.get('range'), size);

      // A bare HEAD/metadata probe still needs the headers that advertise range
      // support, but no body.
      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(size),
            'Accept-Ranges': 'bytes',
            ...CORS_HEADERS,
          },
        });
      }

      if (range) {
        const {start, end} = range;
        const stream = createReadStream(filePath, {start, end});
        return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes',
            ...CORS_HEADERS,
          },
        });
      }

      const stream = createReadStream(filePath);
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(size),
          'Accept-Ranges': 'bytes',
          ...CORS_HEADERS,
        },
      });
    });
  }
}

export function audioProtocolModule(): AudioProtocolModule {
  return new AudioProtocolModule();
}

/** Must run before `app.ready`. */
export function registerAudioScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: AUDIO_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        bypassCSP: true,
      },
    },
  ]);
}
