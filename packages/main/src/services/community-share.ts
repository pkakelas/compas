// community-share.ts — the two halves of sharing a tanda, with no network in
// either: turning one of the DJ's tandas into the song-details-only snapshot
// that gets posted, and matching someone else's snapshot against this library.
//
// Nothing about the library ever leaves the machine here. What is shared is a
// title, an orchestra, a singer, a year and a style per song — the same kind of
// details the bundled suggested tandas carry — and every reader works out
// locally which of those songs they own (services/suggest-tandas.ts).
import {classifyArtist, lookupCanonical} from './canonical.js';
import {artistCore, displayArtist, matchCanonicalArtist, strictTitleKey, surnameOf} from './tango-names.js';
import {
  findLibrarySong,
  libOrqSurname,
  libTitleCandidates,
  type LibraryIndex,
} from './suggest-tandas.js';
import type {Tanda, TandaTag} from '../modules/Database.js';

export type SharedSong = {
  title: string;
  // Other plausible spellings of the title, so a reader whose files are named
  // differently still matches.
  alts?: string[];
  // Null when the sharer's library has no orchestra for the song: such a
  // song is shown, but never matched.
  orq: string | null;
  // The orchestra's normalised surname ("pugliese") — what the backend files
  // the tanda under, so the feed can be filtered by orchestra.
  orq_key?: string;
  singer: string | null;
  year: number | null;
  genre: string | null;
};

export type SharedTanda = {name: string | null; tags: TandaTag[]; songs: SharedSong[]};

/** A shared song as a reader sees it: `songId` is their own copy, or null;
 *  `orqKey` is the orchestra key the feed filters on. */
export type MatchedSong = Omit<SharedSong, 'orq_key' | 'alts' | 'orq'> & {
  orq: string; // '' when the post doesn't say
  songId: string | null;
  orqKey: string;
};

export type MatchedTanda = {
  name: string | null;
  tags: TandaTag[];
  songs: MatchedSong[];
  owned: number;
  ready: boolean; // every song is in this library
};

// The limits the backend enforces (supabase/migrations, is_valid_tanda).
const MAX_SONGS = 8;
const MAX_TAGS = 12;
const TAG_CATS = new Set(['type', 'age', 'orquesta', 'mood', 'custom']);

const clip = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const validYear = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1890 && v <= 2100 ? v : null;

/**
 * The bare song title for a library song, plus alternates. Library titles often
 * carry the orchestra, singer and year ("Aníbal Troilo (Fiorentino) - 1943 -
 * Tinta Roja"); readers match on the bare title, so that is what must be sent.
 * A candidate the reference catalog knows for this orchestra wins; otherwise
 * the last candidate that isn't itself an artist's name.
 */
function sharedTitle(rawTitle: string, orqSurname: string, year: number | null): {title: string; alts: string[]} {
  const candidates = libTitleCandidates(rawTitle).filter(c => strictTitleKey(c));
  const isArtist = (c: string): boolean =>
    classifyArtist(c) !== 'unknown' || (!!orqSurname && surnameOf(artistCore(c)) === orqSurname);
  const plausible = candidates.filter(c => !isArtist(c));
  const pool = plausible.length ? plausible : candidates;

  const confirmed = pool.find(c => lookupCanonical(strictTitleKey(c), orqSurname, year));
  const title = confirmed ?? pool[pool.length - 1] ?? rawTitle.trim();

  const seen = new Set([strictTitleKey(title)]);
  const alts: string[] = [];
  for (const c of pool) {
    const k = strictTitleKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    alts.push(c.slice(0, 200));
    if (alts.length === 3) break;
  }
  return {title: title.slice(0, 200), alts};
}

/**
 * Build the snapshot of a tanda that gets posted, or say why it can't be. A
 * song with no orchestra in this library is posted without one.
 */
export function buildSharedTanda(
  tanda: Tanda,
  includeTags: boolean,
): {ok: true; tanda: SharedTanda} | {ok: false; error: string; errorVars?: Record<string, number>} {
  const songs = tanda.songs.filter(s => !s.isCortina);
  if (songs.length === 0) return {ok: false, error: 'communityErrors.tandaEmpty'};
  if (songs.length > MAX_SONGS) {
    return {ok: false, error: 'communityErrors.tandaTooLong', errorVars: {max: MAX_SONGS}};
  }

  const shared: SharedSong[] = [];
  for (const s of songs) {
    const orqSurname = libOrqSurname(s);
    const {title, alts} = sharedTitle(s.title, orqSurname, s.year);
    // The orchestra is half of what readers match on. Prefer the song's own
    // tag; a library that was never organised may only have it in the title.
    let orq = clip(s.orq, 120);
    if (!orq) {
      const lead = libTitleCandidates(s.title)[0] ?? '';
      if (lead && classifyArtist(lead) === 'orchestra') orq = clip(lead, 120);
    }
    // Post the orchestra under its usual full name where the app knows it
    // ("Tanturi" → "Ricardo Tanturi"), so one orchestra reads the same from
    // every sharer; the key is taken from the name as the library has it.
    const orqKey = orq ? surnameOf(artistCore(orq)).slice(0, 40) : '';
    if (orq) orq = clip(matchCanonicalArtist(orq) ?? displayArtist(orq), 120) || orq;
    shared.push({
      title,
      ...(alts.length ? {alts} : {}),
      orq: orq || null,
      ...(orqKey ? {orq_key: orqKey} : {}),
      singer: clip(s.singer, 120) || null,
      year: validYear(s.year),
      genre: clip(s.genre, 40) || null,
    });
  }

  const tags: TandaTag[] = [];
  if (includeTags) {
    for (const t of tanda.tags) {
      const label = clip(t.label, 40);
      if (!label) continue;
      tags.push({cat: TAG_CATS.has(t.cat) ? t.cat : 'custom', label});
      if (tags.length === MAX_TAGS) break;
    }
  }

  return {ok: true, tanda: {name: clip(tanda.name, 120) || null, tags, songs: shared}};
}

/**
 * Read a snapshot posted by someone else and match it against this library.
 * The input is untrusted (it came from another user through the backend), so
 * every field is checked and clipped before it is used or shown. Returns null
 * when it isn't a usable tanda at all.
 */
export function matchSharedTanda(index: LibraryIndex, raw: unknown): MatchedTanda | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as {name?: unknown; tags?: unknown; songs?: unknown};
  if (!Array.isArray(t.songs) || t.songs.length === 0) return null;

  const used = new Set<string>();
  const songs: MatchedSong[] = [];
  for (const item of t.songs.slice(0, MAX_SONGS)) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const title = clip(s.title, 200);
    const orq = clip(s.orq, 120);
    if (!title) continue;
    const alts = Array.isArray(s.alts)
      ? s.alts.map(a => clip(a, 200)).filter(Boolean).slice(0, 3)
      : [];
    const year = validYear(s.year);
    // A song posted without its orchestra is never matched: a title alone
    // could be any of a dozen recordings.
    const hit = orq ? findLibrarySong(index, {title, alts, orq, year}, used) : null;
    if (hit) used.add(hit.id);
    songs.push({
      title,
      orq,
      // Worked out here rather than read from the post: the same rule the
      // backend falls back on, and nothing a sharer could mislabel.
      orqKey: orq ? surnameOf(artistCore(orq)).slice(0, 40) : '',
      singer: clip(s.singer, 120) || null,
      year,
      genre: clip(s.genre, 40) || null,
      songId: hit ? hit.id : null,
    });
  }
  if (songs.length === 0) return null;

  const tags: TandaTag[] = [];
  if (Array.isArray(t.tags)) {
    for (const item of t.tags.slice(0, MAX_TAGS)) {
      if (!item || typeof item !== 'object') continue;
      const g = item as Record<string, unknown>;
      const label = clip(g.label, 40);
      if (!label) continue;
      const cat = typeof g.cat === 'string' && TAG_CATS.has(g.cat) ? g.cat : 'custom';
      tags.push({cat, label});
    }
  }

  const owned = songs.filter(s => s.songId).length;
  return {name: clip(t.name, 120) || null, tags, songs, owned, ready: owned === songs.length};
}
