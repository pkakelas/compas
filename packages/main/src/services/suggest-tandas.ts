// suggest-tandas.ts — match the bundled curated tandas (suggested-tandas.json)
// against the DJ's own library and return the ones they can play *today*.
//
// A curated tanda is suggested only when EVERY one of its songs is found in the
// library (title + orchestra, disambiguated by year). That keeps every
// suggestion immediately playable with no gaps. The work is pure in-memory
// string matching over the cached library rows — same shape as the Smart
// Organize preview — so it stays fast on large libraries.

import suggestedRef from '../data/suggested-tandas.json' with {type: 'json'};
import {strictTitleKey, artistCore, surnameOf} from './tango-names.js';
import type {Library, Tanda} from '../modules/Database.js';

type RefSong = {
  title: string;
  alts?: string[];
  orq: string;
  singer: string | null;
  year: number | null;
  type: string;
};
type RefTanda = {songs: RefSong[]; tags: {cat: string; label: string}[]};

type LibSong = Library['songs'][number];

export type SuggestedTanda = {
  id: string; // "sug:<refId>" — synthetic, never collides with a real (numeric) tanda id
  refId: string;
  name: null;
  suggested: true;
  saved: boolean; // true when the DJ already has a tanda with this exact song set
  savedTandaId: string | null;
  songs: LibSong[];
  tags: {cat: string; label: string}[];
};

const REF = suggestedRef as RefTanda[];

// A glued trailing "-Singer" on a title, e.g. "Tinta Roja-Francisco Fiorentino"
// (same shape as enrich.ts GLUED_SINGER). Used to recover the bare song title.
const GLUED_SINGER =
  /^(.+?)-\s*([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ.'’]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ.'’]+){0,2})$/;
const YEAR_G = /\b(18[5-9]\d|19\d\d|20[0-2]\d)\b/g;

/** Library lookup key: strict title + orchestra surname (matches canonical.ts). */
function libKey(title: string, orq: string): string {
  return `${strictTitleKey(title)}|${surnameOf(artistCore(orq))}`;
}

/**
 * Library titles are rarely the bare song name — they carry the orchestra,
 * singer and year ("Aníbal Troilo (Fiorentino) - 1943 - Tinta Roja", or the
 * glued "Tinta Roja-Fiorentino"). Strip the parenthetical and year, then treat
 * every "-"-separated segment (plus any glued "-Singer" split) as a candidate
 * title. One of them is the real song title; the rest are harmless noise keys
 * (a singer/orchestra name almost never collides with a curated *song* title
 * under the same orchestra surname).
 */
function libTitleCandidates(rawTitle: string): string[] {
  let t = (rawTitle || '').trim().replace(/^\d{1,2}[\s.\-]+/, ''); // leading track number
  t = t
    .replace(/\([^)]*\)/g, ' ') // (singer) / (instrumental)
    .replace(YEAR_G, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const segs = t
    .split(/\s+[-–—]\s+/)
    .map(s => s.replace(/^[\s\-–—]+|[\s\-–—]+$/g, '').trim())
    .filter(Boolean);
  const out = new Set<string>();
  for (const seg of segs) {
    out.add(seg);
    const g = seg.match(GLUED_SINGER);
    if (g) out.add(g[1].trim());
  }
  if (!segs.length && t) out.add(t);
  return [...out];
}

/** The orchestra surname for a library song: its (Smart-Organized) artist tag,
 *  falling back to the leading title segment when the tag is empty. */
function libOrqSurname(song: LibSong): string {
  const tagged = surnameOf(artistCore(song.orq));
  if (tagged) return tagged;
  const segs = (song.title || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(YEAR_G, ' ')
    .split(/\s+[-–—]\s+/)
    .map(s => s.trim())
    .filter(Boolean);
  return segs.length >= 2 ? surnameOf(artistCore(segs[0])) : '';
}

/** Stable id for a reference tanda, independent of the DJ's library. */
function refIdOf(t: RefTanda): string {
  const sig =
    t.songs.map(s => `${strictTitleKey(s.title)}@${s.year ?? ''}`).join('|') +
    '~' +
    surnameOf(artistCore(t.songs[0]?.orq ?? ''));
  // djb2
  let h = 5381;
  for (let i = 0; i < sig.length; i++) h = ((h << 5) + h + sig.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** What a library lookup needs to know about a song: a title (plus optional
 *  alternate spellings), its orchestra, and a year to break ties. */
export type SongQuery = {title: string; alts?: string[]; orq: string; year?: number | null};

/** Title+orchestra → library songs. Build once per lookup batch (see
 *  buildLibraryIndex); shared with the playlist importer. */
export type LibraryIndex = Map<string, LibSong[]>;

/**
 * Index every library song under each of its plausible (title, orchestra)
 * keys so a reference song can be resolved with a single Map lookup.
 */
export function buildLibraryIndex(library: Library): LibraryIndex {
  const index: LibraryIndex = new Map();
  for (const s of library.songs) {
    const surname = libOrqSurname(s);
    if (!surname) continue; // no orchestra to match on
    for (const cand of libTitleCandidates(s.title)) {
      const tk = strictTitleKey(cand);
      if (!tk) continue;
      const k = `${tk}|${surname}`;
      const arr = index.get(k);
      if (arr) arr.push(s);
      else index.set(k, [s]);
    }
  }
  return index;
}

/** Choose the best library candidate for a reference song, or null. `used`
 *  holds song ids already taken by the current tanda so a title that repeats
 *  can't resolve to the same recording twice. */
export function findLibrarySong(
  index: LibraryIndex,
  ref: SongQuery,
  used: Set<string> = new Set(),
): LibSong | null {
  const keys = [ref.title, ...(ref.alts ?? [])].map(t => libKey(t, ref.orq));
  const seen = new Set<string>();
  const candidates: LibSong[] = [];
  for (const k of keys) {
    for (const s of index.get(k) ?? []) {
      if (used.has(s.id) || seen.has(s.id)) continue;
      seen.add(s.id);
      candidates.push(s);
    }
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  // Several recordings of this title by this orchestra: disambiguate by year.
  const year = ref.year;
  if (year != null) {
    const exact = candidates.find(s => s.year === year);
    if (exact) return exact;
    // Nearest year wins — the DJ still owns a genuine take of this song.
    return candidates
      .slice()
      .sort((a, b) => Math.abs((a.year ?? 0) - year) - Math.abs((b.year ?? 0) - year))[0];
  }
  return candidates[0];
}

/**
 * Return the curated tandas the DJ fully owns, as ready-to-render tanda objects.
 * `saved` is used to drop suggestions that duplicate a tanda the DJ already kept.
 */
export function suggestTandas(library: Library, saved: Tanda[] = []): SuggestedTanda[] {
  const index = buildLibraryIndex(library);

  // Song-id signature → saved tanda id, so a suggestion the DJ already kept is
  // shown as "Saved" rather than removed.
  const savedBySig = new Map<string, string>(
    saved.map(t => [t.songs.map(s => s.id).slice().sort().join(','), t.id] as const),
  );

  const out: SuggestedTanda[] = [];
  const emitted = new Set<string>(); // dedupe identical matches across the curated list

  for (const ref of REF) {
    const used = new Set<string>();
    const matched: LibSong[] = [];
    let ok = true;
    for (const song of ref.songs) {
      const hit = findLibrarySong(index, song, used);
      if (!hit) {
        ok = false;
        break;
      }
      used.add(hit.id);
      matched.push(hit);
    }
    if (!ok) continue;

    const sig = matched.map(s => s.id).slice().sort().join(',');
    if (emitted.has(sig)) continue;
    emitted.add(sig);

    const savedTandaId = savedBySig.get(sig) ?? null;
    out.push({
      id: `sug:${refIdOf(ref)}`,
      refId: refIdOf(ref),
      name: null,
      suggested: true,
      saved: savedTandaId != null,
      savedTandaId,
      songs: matched,
      tags: ref.tags,
    });
  }

  return out;
}
