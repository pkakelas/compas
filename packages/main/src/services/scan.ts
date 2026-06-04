import {readdir} from 'node:fs/promises';
import {basename, extname, join, relative, sep} from 'node:path';
import {parseFile} from 'music-metadata';
import type {ScannedSong} from '../modules/Database.js';

const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.m4a',
  '.flac',
  '.wav',
  '.aac',
  '.ogg',
  '.opus',
  '.aiff',
  '.aif',
  '.wma',
]);

async function collectAudioFiles(dir: string, acc: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, {withFileTypes: true});
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectAudioFiles(full, acc);
    } else if (entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      acc.push(full);
    }
  }
  return acc;
}

function mapGenre(segments: string[], tag: string | undefined): string {
  if (segments.some(s => s.toLowerCase() === 'cortinas' || s.toLowerCase() === 'cortina')) {
    return 'cortina';
  }
  const g = (tag || '').toLowerCase();
  if (g.includes('vals')) return 'vals';
  if (g.includes('milonga')) return 'milonga';
  if (g.includes('cortina')) return 'cortina';
  return 'tango';
}

export type ScanResult = {root: string; songs: ScannedSong[]};

/**
 * Walk `root` recursively, extract tags from every audio file, and return rows
 * ready for the DB. Files are never moved or modified.
 */
export async function scanFolder(
  root: string,
  onProgress?: (done: number, total: number, folder: string) => void,
): Promise<ScanResult> {
  const files = await collectAudioFiles(root);
  const songs: ScannedSong[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relDir = relative(root, file).split(sep).slice(0, -1);
    const segments = relDir.length ? relDir : [];
    const folderPath = segments.join(' / ');
    const folder = segments.length ? segments[segments.length - 1] : basename(root);

    let title = basename(file, extname(file));
    let artist = '';
    let album: string | null = null;
    let year: number | null = null;
    let durationSec: number | null = null;
    let genreTag: string | undefined;

    try {
      const meta = await parseFile(file, {duration: true});
      const c = meta.common;
      if (c.title) title = c.title;
      if (c.artist) artist = c.artist;
      if (c.album) album = c.album;
      if (typeof c.year === 'number') year = c.year;
      if (Array.isArray(c.genre) && c.genre.length) genreTag = c.genre[0];
      if (typeof meta.format.duration === 'number') durationSec = meta.format.duration;
    } catch {
      // Unreadable/corrupt tags — keep the file with filename-derived defaults.
    }

    songs.push({
      path: file,
      title,
      artist,
      singer: '',
      album,
      year,
      durationSec,
      genre: mapGenre(segments, genreTag),
      folder,
      folderPath,
    });

    onProgress?.(i + 1, files.length, folderPath || folder);
  }

  return {root, songs};
}
