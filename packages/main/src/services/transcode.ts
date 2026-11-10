// transcode.ts — converts audio formats Chromium can't play into WAV.
//
// Electron's media stack (Chromium's trimmed ffmpeg build) decodes MP3,
// AAC/M4A, FLAC, Ogg/Opus and WAV natively, but two lossless formats DJs rip to
// are missing from it:
//  • AIFF — no demuxer at all; the <audio> element fails with
//    `DEMUXER_ERROR_COULD_NOT_OPEN`.
//  • Apple Lossless (ALAC) — the MP4 container opens, but there's no ALAC
//    decoder, so it fails with `DEMUXER_ERROR_NO_SUPPORTED_STREAMS`. ALAC
//    shares the `.m4a` extension with AAC, so it's detected by codec, not name.
// The first time such a song is requested we convert it to PCM WAV with the
// bundled ffmpeg (already a dependency for loudness analysis and tag editing)
// and serve the cached copy instead.
//
// Both are lossless and cheap to decode, so a full song converts in well under
// a second. The WAV keeps the source bit depth, and the cache lives in
// userData, is keyed by the source file's identity (id + mtime + size, so a
// retag or replacement invalidates it) and is capped by size with
// least-recently-played eviction.
import {spawn} from 'node:child_process';
import {mkdir, readdir, rename, rm, stat, unlink, utimes} from 'node:fs/promises';
import {dirname, extname, join} from 'node:path';
import {app} from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import {parseFile} from 'music-metadata';

// `ffmpeg-static` resolves to a path inside app.asar once packaged; the binary
// is unpacked next to it (see electron-builder asarUnpack), so point at that.
const FFMPEG_PATH = (ffmpegStatic as unknown as string | null)?.replace(
  /app\.asar([\\/])/,
  'app.asar.unpacked$1',
);

/** Extensions Chromium can't play at all; always served via the WAV cache. */
const TRANSCODE_EXTENSIONS = new Set(['.aiff', '.aif', '.aifc']);

/** MP4-family extensions whose codec decides: AAC plays as-is, ALAC doesn't. */
const MP4_EXTENSIONS = new Set(['.m4a', '.mp4']);

/** Codecs (as music-metadata names them) Chromium has no decoder for. */
const TRANSCODE_CODECS = new Set(['ALAC']);

/** Upper bound on the cache's total size before the oldest copies are evicted.
 * A 16-bit/44.1 kHz tango is ~30 MB as WAV; hi-res transfers a few times that,
 * so this comfortably holds a full night's worth of AIFF/ALAC tracks. */
const MAX_CACHE_BYTES = 1.5 * 1024 * 1024 * 1024;

export type Playable = {
  /** The cached conversion to stream to the renderer. */
  path: string;
  /** MIME type of the converted file. */
  contentType: string;
};

/** Per-file codec verdicts, so the many range requests a single playback makes
 * don't each re-read the MP4 header. Keyed by path, checked against mtime+size
 * so a replaced file is re-probed. */
const codecVerdicts = new Map<string, {identity: string; transcode: boolean}>();
const MAX_CODEC_VERDICTS = 5000;

/**
 * True if this file must be converted before the renderer can play it. `info`
 * is the caller's `stat` of the file, used to tell when a cached verdict is
 * stale. An `.m4a` whose header can't be read is served as-is, as before.
 */
export async function needsTranscode(
  filePath: string,
  info: {mtimeMs: number; size: number},
): Promise<boolean> {
  const ext = extname(filePath).toLowerCase();
  if (TRANSCODE_EXTENSIONS.has(ext)) return true;
  if (!MP4_EXTENSIONS.has(ext)) return false;

  const identity = `${Math.floor(info.mtimeMs)}-${info.size}`;
  const known = codecVerdicts.get(filePath);
  if (known && known.identity === identity) return known.transcode;

  let transcode = false;
  try {
    const meta = await parseFile(filePath, {duration: false, skipCovers: true});
    transcode = TRANSCODE_CODECS.has(meta.format.codec ?? '');
  } catch {
    // unreadable header — let Chromium try the original
  }
  if (codecVerdicts.size >= MAX_CODEC_VERDICTS) codecVerdicts.clear();
  codecVerdicts.set(filePath, {identity, transcode});
  return transcode;
}

function cacheDir(): string {
  return join(app.getPath('userData'), 'audio-cache');
}

/** In-flight conversions by output path, so concurrent requests for the same
 * song (the player plus a preview, or a rapid re-seek) share one ffmpeg run. */
const inFlight = new Map<string, Promise<void>>();

/**
 * Resolve the cached WAV conversion of `filePath`, converting it first if
 * needed. Only call this for files {@link needsTranscode} accepts. Rejects if
 * the source is unreadable or ffmpeg fails.
 */
export async function resolvePlayable(songId: string, filePath: string): Promise<Playable> {
  const info = await stat(filePath);
  // `songId` was already validated against the DB, but normalise it to a plain
  // integer so the cache filename never carries anything odd from the URL.
  const key = `${Number(songId)}-${Math.floor(info.mtimeMs)}-${info.size}`;
  const dir = cacheDir();
  const out = join(dir, `${key}.wav`);

  const cached = await stat(out).catch(() => null);
  if (cached && cached.isFile()) {
    // Touch the copy so eviction treats it as recently played.
    const now = new Date();
    utimes(out, now, now).catch(() => {});
    return {path: out, contentType: 'audio/wav'};
  }

  let job = inFlight.get(out);
  if (!job) {
    job = transcodeToWav(filePath, out).finally(() => inFlight.delete(out));
    inFlight.set(out, job);
  }
  await job;

  // Drop stale conversions of this song and keep the cache under its cap —
  // in the background, so the first byte reaches the player right away.
  schedulePrune(String(Number(songId)), `${key}.wav`);
  return {path: out, contentType: 'audio/wav'};
}

/** Wipe every cached conversion (used when the library is cleared). */
export async function clearAudioCache(): Promise<void> {
  await rm(cacheDir(), {recursive: true, force: true}).catch(() => {});
}

/** Pick the little-endian PCM codec matching the source's bit depth, so a
 * 24-bit transfer isn't silently truncated to 16. Falls back to 16-bit if the
 * tags can't be read (ffmpeg still converts whatever the stream really is). */
async function pcmCodecFor(src: string): Promise<string> {
  try {
    const meta = await parseFile(src, {duration: false, skipCovers: true});
    const bits = meta.format.bitsPerSample ?? 16;
    if (bits > 24) return 'pcm_s32le';
    if (bits > 16) return 'pcm_s24le';
  } catch {
    // unreadable header — 16-bit is the safe default
  }
  return 'pcm_s16le';
}

function transcodeToWav(src: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!FFMPEG_PATH) {
      reject(new Error('ffmpeg binary not found'));
      return;
    }
    (async () => {
      await mkdir(dirname(dest), {recursive: true});
      const codec = await pcmCodecFor(src);
      // Write to a sibling temp file and rename on success so a half-written
      // WAV is never served (or mistaken for a valid cache hit).
      const tmp = `${dest}.${process.pid}-${Date.now()}.part`;
      const args = [
        '-hide_banner',
        '-nostats',
        '-loglevel',
        'error',
        '-y',
        '-i',
        src,
        // Drop embedded artwork (the WAV muxer can't carry it) and tags: the
        // cache copy exists purely for playback; the library keeps the metadata.
        '-vn',
        '-map_metadata',
        '-1',
        '-c:a',
        codec,
        '-f',
        'wav',
        tmp,
      ];
      const child = spawn(FFMPEG_PATH!, args, {windowsHide: true});
      let stderr = '';
      child.stderr.on('data', d => {
        stderr += d.toString();
        if (stderr.length > 100_000) stderr = stderr.slice(-50_000);
      });
      child.on('error', err => {
        unlink(tmp).catch(() => {});
        reject(err);
      });
      child.on('close', async code => {
        if (code !== 0) {
          await unlink(tmp).catch(() => {});
          reject(new Error(`ffmpeg transcode failed (code ${code}): ${stderr.slice(-500)}`));
          return;
        }
        try {
          await rename(tmp, dest);
          resolve();
        } catch (err) {
          await unlink(tmp).catch(() => {});
          reject(err as Error);
        }
      });
    })().catch(reject);
  });
}

// Prunes run one at a time; a burst of conversions queues rather than racing.
let pruneChain: Promise<void> = Promise.resolve();

function schedulePrune(songId: string, keep: string): void {
  pruneChain = pruneChain.then(() => pruneCache(songId, keep)).catch(err => {
    console.warn('[transcode] cache prune failed:', err);
  });
}

/**
 * Delete superseded conversions of `songId` (any `<id>-*.wav` other than
 * `keep`), then evict least-recently-used files until the cache fits its cap.
 */
async function pruneCache(songId: string, keep: string): Promise<void> {
  const dir = cacheDir();
  const names = await readdir(dir).catch(() => [] as string[]);
  const entries: {name: string; size: number; mtimeMs: number}[] = [];
  for (const name of names) {
    if (!name.endsWith('.wav')) continue; // leave `.part` files to their writers
    const full = join(dir, name);
    if (name !== keep && name.startsWith(`${songId}-`)) {
      await unlink(full).catch(() => {});
      continue;
    }
    const info = await stat(full).catch(() => null);
    if (info && info.isFile()) entries.push({name, size: info.size, mtimeMs: info.mtimeMs});
  }

  let total = entries.reduce((sum, e) => sum + e.size, 0);
  if (total <= MAX_CACHE_BYTES) return;

  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const e of entries) {
    if (total <= MAX_CACHE_BYTES) break;
    if (e.name === keep || inFlight.has(join(dir, e.name))) continue;
    await unlink(join(dir, e.name)).catch(() => {});
    total -= e.size;
  }
}
