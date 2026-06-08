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

/** True if `file` has an audio extension we import. */
export function isAudioFile(file: string): boolean {
  return AUDIO_EXTENSIONS.has(extname(file).toLowerCase());
}

/** The earliest plausible recording year we'll accept, and the latest. */
const MIN_YEAR = 1910;
const MAX_YEAR = 2026;

/**
 * Coerce a raw year into a plausible tango recording year, or `null` ("unknown").
 *  • A two-digit value is read as 19xx (e.g. 28 → 1928, 29 → 1929).
 *  • Anything outside MIN_YEAR..MAX_YEAR is rejected as garbage (tags sometimes
 *    carry a remaster/release date or a bogus value far from the recording).
 */
export function normalizeYear(y: number | null | undefined): number | null {
  if (y == null || !Number.isFinite(y)) return null;
  let v = Math.trunc(y);
  if (v >= 0 && v < 100) v += 1900;
  return v >= MIN_YEAR && v <= MAX_YEAR ? v : null;
}

/**
 * A recording year embedded in a filename, e.g. "Anibal Troilo - 1962 - Grela -
 * Madame Ivone". For tango libraries this is the recording date and far more
 * reliable than a tag (which often holds a remaster/release year). Only
 * four-digit tokens are considered, so track numbers don't get mistaken for a
 * year. Returns the first in-range year, or `null`.
 */
export function yearFromFilename(path: string): number | null {
  const name = basename(path, extname(path));
  const tokens = name.match(/\d{4}/g);
  if (!tokens) return null;
  for (const tok of tokens) {
    const y = normalizeYear(parseInt(tok, 10));
    if (y != null) return y;
  }
  return null;
}

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
    } else if (entry.isFile() && isAudioFile(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

// Guess a style from a folder (or tag) name. Covers the four core tango styles
// plus common non-tango ones a DJ might file separately. Returns null if the
// name carries no style hint. Used to pre-fill the import tool's per-folder type
// and as the live-watcher fallback.
const STYLE_GUESS: [RegExp, string][] = [
  [/\bmixed\b/, 'mixed'],
  [/\bcortinas?\b/, 'cortina'],
  [/\bvals(es)?\b|\bwaltz\b/, 'vals'],
  [/\bmilongas?\b/, 'milonga'],
  [/\btangos?\b/, 'tango'],
  [/\bkizomba\b/, 'kizomba'],
  [/\bchacareras?\b/, 'chacarera'],
  [/\bzambas?\b/, 'zamba'],
  [/\bsalsa\b/, 'salsa'],
  [/\bswing\b/, 'swing'],
  [/\bfol(k|c)lore\b/, 'folklore'],
];
export function guessStyle(name: string | null | undefined): string | null {
  const n = (name || '').toLowerCase();
  for (const [re, t] of STYLE_GUESS) if (re.test(n)) return t;
  return null;
}

function mapGenre(segments: string[], tag: string | undefined): string {
  // The deepest folder name that names a style wins.
  for (let i = segments.length - 1; i >= 0; i--) {
    const g = guessStyle(segments[i]);
    if (g) return g;
  }
  const t = (tag || '').toLowerCase();
  if (t.includes('vals')) return 'vals';
  if (t.includes('milonga')) return 'milonga';
  if (t.includes('cortina')) return 'cortina';
  return 'tango';
}

export type ScanResult = {root: string; songs: ScannedSong[]};

/**
 * Read the tags from a single audio `file` (located under `root`) and build the
 * DB row, deriving `folder`/`folderPath`/`genre` from its position in the tree.
 * The file is never moved or modified.
 */
export async function scanFile(root: string, file: string): Promise<ScannedSong> {
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

  // Prefer a recording year spelled out in the filename; fall back to the
  // (normalized) tag year. Anything implausible becomes "unknown".
  year = yearFromFilename(file) ?? normalizeYear(year);

  return {
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
  };
}

/**
 * Walk `root` recursively, extract tags from every audio file, and return rows
 * ready for the DB. Files are never moved or modified.
 */
export async function scanFolder(root: string): Promise<ScanResult> {
  const files = await collectAudioFiles(root);
  const songs: ScannedSong[] = [];
  for (const file of files) {
    songs.push(await scanFile(root, file));
  }
  return {root, songs};
}
