// tags.ts — writes a song's metadata tags back into the audio file itself.
//
// We reuse the bundled ffmpeg binary (already a dependency for loudness
// analysis) so we can retag every container we import (mp3/m4a/flac/…) without
// pulling in a format-specific tag library. The stream data is stream-copied
// (`-c copy`), so retagging is fast and lossless — only the metadata changes.
//
// ffmpeg can't edit in place, so we write to a sibling dotfile and atomically
// rename it over the original. The dotfile prefix matters: the library watcher
// ignores dotfiles, so our temp file never shows up as a phantom add/remove.
import {spawn} from 'node:child_process';
import {rename, unlink} from 'node:fs/promises';
import {dirname, extname, join} from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import {joinArtistTag} from './enrich.js';

// `ffmpeg-static` resolves to a path inside app.asar once packaged; the binary
// is unpacked next to it (see electron-builder asarUnpack), so point at that.
const FFMPEG_PATH = (ffmpegStatic as unknown as string | null)?.replace(
  /app\.asar([\\/])/,
  'app.asar.unpacked$1',
);

/** The editable, file-backed metadata fields. The orchestra (`artist`) and
 *  `singer` are written together into the artist tag ("Orchestra - Singer"),
 *  the convention most tango collections follow — see joinArtistTag. */
export type SongTags = {
  title: string;
  artist: string;
  singer: string;
  album: string | null;
  year: number | null;
  // Omitted (undefined) → the file's existing genre tag is kept as is.
  genre?: string;
};

/** ffmpeg `-metadata key=value` pairs derived from the editable fields. Empty
 *  values are passed through so clearing a field also clears the file tag. */
function metadataArgs(tags: SongTags): string[] {
  const pairs: [string, string][] = [
    ['title', tags.title ?? ''],
    ['artist', joinArtistTag(tags.artist ?? '', tags.singer ?? '')],
    ['album', tags.album ?? ''],
    ['date', tags.year != null ? String(tags.year) : ''],
  ];
  if (tags.genre !== undefined) pairs.push(['genre', tags.genre ?? '']);
  const args: string[] = [];
  for (const [key, value] of pairs) {
    args.push('-metadata', `${key}=${value}`);
  }
  return args;
}

/**
 * Write `tags` into the audio file at `filePath`, preserving the audio (and any
 * cover art) untouched. Resolves once the file has been replaced; rejects if
 * ffmpeg is missing or the encode fails (the original file is left intact).
 */
export function writeSongTags(filePath: string, tags: SongTags): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!FFMPEG_PATH) {
      reject(new Error('ffmpeg binary not found'));
      return;
    }
    const ext = extname(filePath);
    const tmpPath = join(dirname(filePath), `.compas-retag-${Date.now()}${ext}`);

    const args = [
      '-hide_banner',
      '-nostats',
      '-y',
      '-i',
      filePath,
      // Copy every stream (audio + embedded artwork) and all existing metadata,
      // then override the fields we edited on top.
      '-map',
      '0',
      '-c',
      'copy',
      '-map_metadata',
      '0',
      ...metadataArgs(tags),
      // mp3: write ID3v2.3, the most widely-readable revision.
      ...(ext.toLowerCase() === '.mp3' ? ['-id3v2_version', '3'] : []),
      tmpPath,
    ];

    const child = spawn(FFMPEG_PATH, args, {windowsHide: true});
    let stderr = '';
    child.stderr.on('data', d => {
      stderr += d.toString();
      if (stderr.length > 1_000_000) stderr = stderr.slice(-500_000);
    });
    child.on('error', reject);
    child.on('close', async code => {
      if (code !== 0) {
        await unlink(tmpPath).catch(() => {});
        reject(new Error(`ffmpeg retag failed (code ${code}): ${stderr.slice(-500)}`));
        return;
      }
      try {
        await rename(tmpPath, filePath);
        resolve();
      } catch (err) {
        await unlink(tmpPath).catch(() => {});
        reject(err as Error);
      }
    });
  });
}
