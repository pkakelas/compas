// playlist-m3u.ts — read and write playlists as M3U / M3U8 so a set can travel
// to and from VLC, Apple Music, rekordbox, Mixxx, VirtualDJ, Traktor and
// friends.
//
// Export writes extended M3U (UTF-8) with one absolute path per song, in play
// order: each tanda's songs, then its cortina. Compás-specific structure rides
// along in comment lines every other player ignores:
//
//   #EXTM3U
//   #PLAYLIST:Saturday milonga
//   #COMPAS:{"v":1}
//   #COMPAS-TANDA:{"name":"Troilo 40s","tags":[{"cat":"orquesta","label":"Troilo"}]}
//   #EXTGRP:Troilo 40s
//   #EXTINF:187,Aníbal Troilo - Tinta Roja
//   /Users/dj/Music/Troilo/Tinta Roja.flac
//   #COMPAS-CORTINA
//   #EXTINF:35,Cortina - Something
//   /Users/dj/Music/Cortinas/Something.mp3
//
// Import parses any M3U/M3U8, resolves each entry to a library song (by path,
// then filename, then title + orchestra) and rebuilds tandas: from the markers
// above when the file came from Compás, otherwise by treating cortinas as
// separators and splitting long runs where the orchestra changes.

import {basename, dirname, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {looksLikeCortinaFolder} from './scan.js';
import {buildLibraryIndex, findLibrarySong, type LibraryIndex} from './suggest-tandas.js';
import {artistCore, surnameOf} from './tango-names.js';
import {suggestTandaTags} from './tanda-tags.js';
import type {Library, Playlist, Song, Tanda, TandaTag} from '../modules/Database.js';

const FORMAT_VERSION = 1;
// Tandas run 3–5 songs; a longer cortina-free run is several tandas glued together.
const MAX_TANDA = 5;
// An unresolved entry this short is almost certainly a cortina, not a song.
const CORTINA_MAX_SEC = 75;
// A filename-only match still has to be the same recording: allow tag/encoder drift.
const DURATION_TOLERANCE_SEC = 3;
const YEAR_RE = /\b(18[5-9]\d|19\d\d|20[0-2]\d)\b/;

/* ============================== writing ============================== */

function extinfLabel(s: Song): string {
  const title = (s.title || '').trim() || basename(s.folderPath || '') || 'Untitled';
  const orq = (s.orq || '').trim();
  return orq ? `${orq} - ${title}` : title;
}

function extinf(s: Song): string {
  const dur = s.durationSec != null && s.durationSec > 0 ? Math.round(s.durationSec) : -1;
  // A newline inside a title would corrupt the file; the label is display-only.
  return `#EXTINF:${dur},${extinfLabel(s).replace(/[\r\n]+/g, ' ')}`;
}

/**
 * Serialize a playlist as extended M3U. `pathOf` maps a song id to its absolute
 * path; songs with no path (deleted mid-export) are skipped rather than written
 * as a broken line.
 */
export function writeM3u(playlist: Playlist, pathOf: (songId: string) => string | null): string {
  const out: string[] = ['#EXTM3U'];
  const name = (playlist.name || '').trim();
  if (name) out.push(`#PLAYLIST:${name.replace(/[\r\n]+/g, ' ')}`);
  out.push(`#COMPAS:${JSON.stringify({v: FORMAT_VERSION})}`);

  let n = 0;
  for (const it of playlist.items) {
    if (it.type === 'tanda') {
      n++;
      const t = it.data;
      const meta = {name: t.name || null, tags: t.tags || []};
      out.push(`#COMPAS-TANDA:${JSON.stringify(meta)}`);
      out.push(`#EXTGRP:${(t.name || `Tanda ${n}`).replace(/[\r\n]+/g, ' ')}`);
      for (const s of t.songs) {
        const p = pathOf(s.id);
        if (!p) continue;
        out.push(extinf(s), p);
      }
    } else {
      const p = pathOf(it.data.id);
      if (!p) continue;
      out.push('#COMPAS-CORTINA', extinf(it.data), p);
    }
  }
  return out.join('\n') + '\n';
}

/** A filesystem-safe default filename for an exported playlist. */
export function exportFilename(playlist: Playlist): string {
  const raw = (playlist.name || '').trim() || 'Untitled playlist';
  const safe = raw.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  return `${safe || 'Untitled playlist'}.m3u8`;
}

/* ============================== parsing ============================== */

export type ParsedEntry = {
  location: string; // path or URL exactly as written in the file
  title: string | null; // from #EXTINF, if present
  artist: string | null;
  durationSec: number | null;
  tandaStart: {name: string | null; tags: TandaTag[]} | null; // a Compás/EXTGRP marker
  cortina: boolean; // a Compás cortina marker
};

export type ParsedPlaylist = {
  name: string | null; // from #PLAYLIST, if present
  structured: boolean; // true when the file carries tanda markers
  entries: ParsedEntry[];
};

/** Decode file bytes: strip a BOM, prefer UTF-8, fall back to Latin-1 for old .m3u files. */
export function decodeM3u(buf: Buffer): string {
  let b = buf;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(b);
  } catch {
    return b.toString('latin1');
  }
}

function safeJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function cleanTags(raw: unknown): TandaTag[] {
  if (!Array.isArray(raw)) return [];
  const out: TandaTag[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const label = String((t as {label?: unknown}).label ?? '').trim();
    if (!label) continue;
    const cat = String((t as {cat?: unknown}).cat ?? 'custom').trim() || 'custom';
    out.push({cat, label});
  }
  return out;
}

/** Split an EXTINF label into artist + title ("Artist - Title"). */
function splitLabel(label: string): {artist: string | null; title: string | null} {
  const s = label.trim();
  if (!s) return {artist: null, title: null};
  const m = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!m) return {artist: null, title: s};
  return {artist: m[1].trim() || null, title: m[2].trim() || null};
}

/** Parse the text of an M3U / M3U8 file. Tolerates CRLF, blank lines and
 *  unknown directives. Non-file locations (http streams) are kept as entries
 *  so the caller can report them as unresolved. */
export function parseM3u(text: string): ParsedPlaylist {
  const entries: ParsedEntry[] = [];
  let name: string | null = null;
  let structured = false;

  let inf: {artist: string | null; title: string | null; durationSec: number | null} | null = null;
  let tandaStart: ParsedEntry['tandaStart'] = null;
  let cortina = false;
  let lastGroup: string | null = null;

  for (const rawLine of text.split(/\r?\n|\r/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#')) {
      if (/^#EXTINF:/i.test(line)) {
        // "#EXTINF:<seconds>[ attrs],<label>" — seconds may be -1 or fractional.
        const m = line.match(/^#EXTINF:\s*(-?\d+(?:\.\d+)?)?[^,]*,(.*)$/i);
        const secs = m && m[1] != null ? Number(m[1]) : NaN;
        inf = {
          ...splitLabel(m ? m[2] : ''),
          durationSec: Number.isFinite(secs) && secs > 0 ? secs : null,
        };
      } else if (/^#PLAYLIST:/i.test(line)) {
        name = line.slice('#PLAYLIST:'.length).trim() || null;
      } else if (/^#COMPAS-TANDA:/i.test(line)) {
        structured = true;
        const meta = safeJson<{name?: unknown; tags?: unknown}>(line.slice('#COMPAS-TANDA:'.length));
        const n = meta && typeof meta.name === 'string' ? meta.name.trim() : '';
        tandaStart = {name: n || null, tags: cleanTags(meta?.tags)};
      } else if (/^#COMPAS-CORTINA\b/i.test(line)) {
        structured = true;
        cortina = true;
      } else if (/^#EXTGRP:/i.test(line)) {
        // Winamp-style group: a new group name starts a new tanda unless a
        // Compás marker already did.
        const g = line.slice('#EXTGRP:'.length).trim();
        if (g && g !== lastGroup && !tandaStart) tandaStart = {name: g, tags: []};
        if (g) {
          lastGroup = g;
          structured = true;
        }
      }
      continue;
    }

    entries.push({
      location: line,
      title: inf?.title ?? null,
      artist: inf?.artist ?? null,
      durationSec: inf?.durationSec ?? null,
      tandaStart,
      cortina,
    });
    inf = null;
    tandaStart = null;
    cortina = false;
  }

  return {name, structured, entries};
}

/* ============================== resolving ============================== */

export type ResolvedEntry = ParsedEntry & {
  song: Song | null;
  isCortina: boolean;
  label: string; // what to show the DJ for this entry (esp. when unresolved)
};

function looksLikeWindowsPath(s: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(s) || s.startsWith('\\\\');
}

/**
 * Turn whatever the file wrote into a comparable absolute path: decode file://
 * URLs and percent-escapes, resolve relative paths against the playlist's own
 * folder, and NFC-normalize (macOS, iTunes and Traktor disagree on how to
 * encode accented titles).
 */
export function resolveLocation(location: string, playlistDir: string): string {
  let loc = location.trim();
  if (/^file:/i.test(loc)) {
    try {
      loc = fileURLToPath(loc);
    } catch {
      loc = decodeURIComponent(loc.replace(/^file:\/*/i, '/'));
    }
  } else if (/%[0-9A-Fa-f]{2}/.test(loc)) {
    try {
      loc = decodeURIComponent(loc);
    } catch {
      /* keep as written */
    }
  }
  if (looksLikeWindowsPath(loc)) {
    loc = loc.replace(/\\/g, '/');
  } else if (!/^\//.test(loc) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(loc)) {
    loc = resolve(playlistDir, loc);
  }
  return loc.normalize('NFC');
}

function segmentsOf(p: string): string[] {
  return p.split(/[\\/]+/).filter(Boolean).map(s => s.toLowerCase());
}

/** Number of trailing path segments two paths share. */
function commonSuffix(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function stemOf(p: string): string {
  const base = basename(p.replace(/\\/g, '/'));
  return base.slice(0, base.length - extname(base).length);
}

/** Candidate titles from a filename like "03 - Troilo - 1943 - Tinta Roja". */
function stemSegments(stem: string): string[] {
  const t = stem.replace(/^\d{1,3}[\s.\-_]+/, '').replace(/_/g, ' ');
  return t
    .split(/\s+[-–—]\s+/)
    .map(s => s.replace(YEAR_RE, ' ').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function yearIn(...texts: (string | null)[]): number | null {
  for (const t of texts) {
    const m = t && t.match(YEAR_RE);
    if (m) return Number(m[1]);
  }
  return null;
}

type PathIndex = {
  exact: Map<string, Song>;
  lower: Map<string, Song>;
  byBase: Map<string, {song: Song; segs: string[]}[]>;
};

function buildPathIndex(library: Library, paths: Map<string, string>): PathIndex {
  const idx: PathIndex = {exact: new Map(), lower: new Map(), byBase: new Map()};
  for (const song of library.songs) {
    const p = paths.get(song.id);
    if (!p) continue;
    const nfc = p.normalize('NFC');
    idx.exact.set(nfc, song);
    idx.lower.set(nfc.toLowerCase(), song);
    const segs = segmentsOf(nfc);
    const base = segs[segs.length - 1];
    if (!base) continue;
    const arr = idx.byBase.get(base);
    const rec = {song, segs};
    if (arr) arr.push(rec);
    else idx.byBase.set(base, [rec]);
  }
  return idx;
}

function matchByPath(loc: string, entry: ParsedEntry, idx: PathIndex): Song | null {
  const exact = idx.exact.get(loc);
  if (exact) return exact;
  const lower = idx.lower.get(loc.toLowerCase());
  if (lower) return lower;

  const segs = segmentsOf(loc);
  const base = segs[segs.length - 1];
  const cands = base ? idx.byBase.get(base) : undefined;
  if (!cands || cands.length === 0) return null;
  if (cands.length === 1) return cands[0].song;

  // Same filename in several folders: prefer the one whose folders line up,
  // then the one whose duration agrees with the playlist's.
  const scored = cands
    .map(c => {
      const diff =
        entry.durationSec != null && c.song.durationSec != null
          ? Math.abs(c.song.durationSec - entry.durationSec)
          : null;
      return {
        song: c.song,
        suffix: commonSuffix(segs, c.segs),
        durOk: diff != null && diff <= DURATION_TOLERANCE_SEC,
        diff: diff ?? Infinity,
      };
    })
    .sort((a, b) => b.suffix - a.suffix || Number(b.durOk) - Number(a.durOk) || a.diff - b.diff);
  const best = scored[0];
  const runnerUp = scored[1];
  if (runnerUp && best.suffix === runnerUp.suffix && best.durOk === runnerUp.durOk) {
    // Same filename, same folders: only the duration can tell them apart.
    // Take the closest one when it clearly is; otherwise don't guess, and let
    // title + orchestra matching (which also weighs the year) decide.
    const clearlyCloser = best.durOk && runnerUp.diff - best.diff >= 1;
    return clearlyCloser ? best.song : null;
  }
  return best.song;
}

function matchByMetadata(loc: string, entry: ParsedEntry, index: LibraryIndex): Song | null {
  const year = yearIn(entry.title, loc);
  const tryQ = (title: string | null, orq: string | null): Song | null =>
    title && orq ? findLibrarySong(index, {title, orq, year}) : null;

  // "Artist - Title" is the convention, but some players write "Title - Artist".
  const hit = tryQ(entry.title, entry.artist) ?? tryQ(entry.artist, entry.title);
  if (hit) return hit;

  // Fall back to the filename: try every (orchestra, title) pairing of its
  // dash-separated segments, plus each segment against the EXTINF artist.
  const segs = stemSegments(stemOf(loc));
  for (const t of segs) {
    const h = tryQ(t, entry.artist);
    if (h) return h;
  }
  for (const o of segs) {
    for (const t of segs) {
      if (o === t) continue;
      const h = tryQ(t, o);
      if (h) return h;
    }
  }
  return null;
}

function labelOf(entry: ParsedEntry, loc: string): string {
  if (entry.title) return entry.artist ? `${entry.artist} - ${entry.title}` : entry.title;
  return stemOf(loc) || entry.location;
}

/**
 * Resolve every parsed entry to a library song where possible, and decide
 * which entries are cortinas. Resolution order: exact path, case-insensitive
 * path, filename (disambiguated by folder and duration), then title +
 * orchestra through the same matcher the curated-tanda suggestions use.
 */
export function resolveEntries(
  parsed: ParsedPlaylist,
  playlistDir: string,
  library: Library,
  paths: Map<string, string>,
): ResolvedEntry[] {
  const pathIdx = buildPathIndex(library, paths);
  const metaIdx = buildLibraryIndex(library);

  return parsed.entries.map(entry => {
    const loc = resolveLocation(entry.location, playlistDir);
    const song = matchByPath(loc, entry, pathIdx) ?? matchByMetadata(loc, entry, metaIdx);
    const isCortina = entry.cortina
      ? true
      : song
        ? song.isCortina
        : (entry.durationSec != null && entry.durationSec < CORTINA_MAX_SEC) ||
          looksLikeCortinaFolder(basename(dirname(loc)));
    return {...entry, song, isCortina, label: labelOf(entry, loc)};
  });
}

/* ============================== grouping ============================== */

export type ImportTanda = {
  name: string | null;
  tags: TandaTag[];
  songs: Song[];
  missing: string[]; // labels of entries in this tanda that weren't found
  existingTandaId: string | null; // a saved tanda with exactly these songs
};

export type ImportItem = {type: 'tanda'; tanda: ImportTanda} | {type: 'cortina'; song: Song};

export type ImportPreview = {
  name: string;
  sourcePath: string;
  structured: boolean;
  items: ImportItem[];
  missing: string[]; // every unresolved entry, in file order
  found: number;
  total: number;
};

function orqKey(e: ResolvedEntry): string {
  // Prefer the library's orchestra; fall back to the file's EXTINF artist for
  // untagged songs so an orchestra change still splits the run.
  const raw = (e.song && e.song.orq) || e.artist || '';
  return surnameOf(artistCore(raw)) || raw.toLowerCase().trim();
}

/** Split a cortina-free run into tanda-sized chunks: first where the orchestra
 *  changes, then evenly when a single orchestra runs too long. */
function splitRun(run: ResolvedEntry[]): ResolvedEntry[][] {
  if (run.length <= MAX_TANDA) return [run];
  const byOrq: ResolvedEntry[][] = [];
  for (const e of run) {
    const last = byOrq[byOrq.length - 1];
    if (last && orqKey(last[0]) === orqKey(e)) last.push(e);
    else byOrq.push([e]);
  }
  const out: ResolvedEntry[][] = [];
  for (const chunk of byOrq) {
    if (chunk.length <= MAX_TANDA) {
      out.push(chunk);
      continue;
    }
    const parts = Math.ceil(chunk.length / MAX_TANDA);
    const size = Math.ceil(chunk.length / parts);
    for (let i = 0; i < chunk.length; i += size) out.push(chunk.slice(i, i + size));
  }
  return out;
}

/** A readable name for an inferred tanda, e.g. "Di Sarli · Tango": the
 *  orchestra (its preset tag, else the one shared artist) and the style. */
function inferTandaName(songs: Song[], tags: TandaTag[]): string | null {
  const orqTag = tags.find(t => t.cat === 'orquesta')?.label;
  const orqs = [...new Set(songs.map(s => (s.orq || '').trim()).filter(Boolean))];
  const orq = orqTag || (orqs.length === 1 ? orqs[0] : '');
  const style = tags.find(t => t.cat === 'type')?.label || '';
  const name = [orq, style].filter(Boolean).join(' · ');
  return name || null;
}

function uniquePlaylistName(base: string, existing: Playlist[]): string {
  const taken = new Set(existing.map(p => (p.name || '').trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let n = 1;
  for (;;) {
    const cand = n === 1 ? `${base} (imported)` : `${base} (imported ${n})`;
    if (!taken.has(cand.toLowerCase())) return cand;
    n++;
  }
}

/**
 * Turn resolved entries into the tandas + cortinas the import would create.
 * Cortinas always end the current tanda; Compás/EXTGRP markers start one; a
 * run with no markers is split by orchestra and size. A tanda whose songs
 * were all missing is dropped (its songs still appear in `missing`).
 */
export function buildImportPreview(
  parsed: ParsedPlaylist,
  resolved: ResolvedEntry[],
  opts: {sourcePath: string; existingTandas: Tanda[]; existingPlaylists: Playlist[]},
): ImportPreview {
  type Run = {marker: ParsedEntry['tandaStart']; entries: ResolvedEntry[]};
  const items: ImportItem[] = [];
  // Every unresolved entry, in the order the file lists them.
  const missing = resolved.filter(e => !e.song).map(e => e.label);
  // Cortinas and tandas interleave, so remember where each run sits in `items`.
  const slots: (Run | ImportItem)[] = [];
  let current: Run | null = null;

  const close = (): void => {
    if (current && current.entries.length) slots.push(current);
    current = null;
  };

  for (const e of resolved) {
    if (e.tandaStart) {
      close();
      current = {marker: e.tandaStart, entries: []};
    }
    if (e.isCortina) {
      close();
      if (e.song) slots.push({type: 'cortina', song: e.song});
      continue;
    }
    if (!current) current = {marker: null, entries: []};
    current.entries.push(e);
  }
  close();

  // Ordered on purpose: a saved tanda is reused only when it plays the same
  // songs in the same order, so the playlist keeps the file's order.
  const sigOf = (songs: Song[]): string => songs.map(s => s.id).join(',');
  const existingBySig = new Map(opts.existingTandas.map(t => [sigOf(t.songs), t.id]));

  for (const slot of slots) {
    if ('type' in slot) {
      items.push(slot);
      continue;
    }
    const chunks = slot.marker ? [slot.entries] : splitRun(slot.entries);
    chunks.forEach((chunk, i) => {
      const songs = chunk.map(e => e.song).filter((s): s is Song => !!s);
      const gone = chunk.filter(e => !e.song).map(e => e.label);
      if (!songs.length) return;
      const marker = i === 0 ? slot.marker : null;
      // Untagged files have no orchestra in the library; the playlist's own
      // "Artist - Title" labels usually do, so borrow them for naming/tagging.
      const named = chunk
        .filter(e => e.song)
        .map(e => (e.song!.orq ? e.song! : {...e.song!, orq: e.artist || ''}));
      const tags = marker && marker.tags.length ? marker.tags : suggestTandaTags(named);
      items.push({
        type: 'tanda',
        tanda: {
          name: marker ? marker.name : inferTandaName(named, tags),
          tags,
          songs,
          missing: gone,
          existingTandaId: existingBySig.get(sigOf(songs)) ?? null,
        },
      });
    });
  }

  const baseName = (parsed.name || '').trim() || stemOf(opts.sourcePath) || 'Imported playlist';
  return {
    name: uniquePlaylistName(baseName, opts.existingPlaylists),
    sourcePath: opts.sourcePath,
    structured: parsed.structured,
    items,
    missing,
    found: resolved.filter(e => e.song).length,
    total: resolved.length,
  };
}
