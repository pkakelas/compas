import type {AppModule} from '../AppModule.js';
import type {ModuleContext} from '../ModuleContext.js';
import {net, protocol} from 'electron';
import {pathToFileURL} from 'node:url';
import {getSongPath} from './Database.js';

export const AUDIO_SCHEME = 'compas-audio';

/**
 * Streams imported audio files to the renderer via `compas-audio://song/<id>`.
 * The song's absolute on-disk path is resolved from the DB and proxied through
 * `net.fetch`, which provides HTTP range support (so the player can seek).
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

      return net.fetch(pathToFileURL(filePath).toString(), {
        headers: request.headers,
        method: request.method,
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
