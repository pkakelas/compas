// enrich.ts — the Smart Organize inference engine.
//
// Two stages, both pure:
//   1. derive()     — read everything we can from the title + folder + existing
//                     tags (orchestra, singer(s), instrumental, year, danced
//                     style), without any external data.
//   2. crossCheck()  — confirm/upgrade the derivation against the bundled
//                     canonical catalog, but only on an exact title + orchestra
//                     (+ year) match, so we never adopt the wrong recording.
//
// resolveSong() combines them into a Proposal: the concrete field changes plus a
// confidence tier that drives how the review UI presents (and pre-selects) it.
import {
  strictTitleKey,
  artistCore,
  surnameOf,
  matchCanonicalArtist,
  displayArtist,
  splitVoices,
  isInstrumentalCredit,
  isNonSingerNote,
  isIgnoredArtist,
  dancedStyleFromFolder,
  styleToGenre,
  type Style,
} from './tango-names.js';
import {lookupCanonical, classifyArtist} from './canonical.js';

/** The subset of a song the engine needs. Mirrors the DB/UI song fields. */
export type EnrichInput = {
  id: string;
  title: string;
  orq: string;
  singer: string;
  year: number | null;
  genre: string;
  folderPath: string;
};

type Derived = {
  songTitle: string; // best guess at the bare song title (for catalog lookup)
  songTitleAlt: string | null; // alternate (glued "-Singer" removed)
  mainArtistRaw: string | null;
  voices: string[];
  instrumental: boolean;
  year: number | null;
  dancedStyle: Style;
};

const YEAR_RE = /\b(18[5-9]\d|19\d\d|20[0-2]\d)\b/;
// A glued trailing "-Singer": a capitalized 1–3 word name after a hyphen with no
// surrounding spaces, e.g. "Uno-Héctor Mauré". Conservative so we don't split
// genuinely hyphenated titles.
const GLUED_SINGER = /^(.+?)-\s*([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ.'’]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ.'’]+){0,2})$/;

function junkArtist(s: string): boolean {
  // The literal word "Instrumental" in the artist tag is a marker, not a name.
  return /^instrumental$/i.test(s.trim());
}

/** Trim leading/trailing dashes and whitespace left behind after stripping the
 *  year/decorators out of a title segment. */
function cleanSegment(s: string): string {
  return s.replace(/^[\s\-–—]+/, '').replace(/[\s\-–—]+$/, '').trim();
}

/** Stage 1: derive structured fields from the raw song. */
export function derive(song: EnrichInput): Derived {
  const dancedStyle = dancedStyleFromFolder(song.folderPath);

  // Main artist: prefer a real tag, else the title's leading segment (filled in
  // below once we've parsed the title).
  // Trust the artist tag only if it's a real name — not the literal word
  // "Instrumental" nor a junk value the DJ flagged. When it's junk we fall back
  // to the title, which often carries the real orchestra ("Anibal Troilo - …").
  let mainArtistRaw: string | null =
    song.orq && song.orq.trim() && !junkArtist(song.orq) && !isIgnoredArtist(song.orq)
      ? song.orq.trim()
      : null;
  let instrumental = !!(song.orq && junkArtist(song.orq));
  let voices: string[] = [];

  // Work on the title with the leading track number removed.
  let t = (song.title || '').trim().replace(/^\d{1,2}[\s.\-]+/, '');

  // Parenthetical: a singer credit or an "(instrumental)" marker.
  const paren = t.match(/\(([^)]*)\)/);
  if (paren) {
    const inside = paren[1].trim();
    if (isInstrumentalCredit(inside)) instrumental = true;
    else if (!isNonSingerNote(inside)) voices = splitVoices(inside);
    t = (t.slice(0, paren.index) + t.slice((paren.index ?? 0) + paren[0].length)).trim();
  }

  // Year (kept, then removed from the title text so it doesn't pollute the song).
  let year: number | null = song.year ?? null;
  const ym = t.match(YEAR_RE);
  if (year == null && ym) year = parseInt(ym[1], 10);
  t = t.replace(new RegExp(YEAR_RE.source, 'g'), ' ').replace(/\s+/g, ' ').trim();

  // Split "Artist - Title" on spaced hyphens, cleaning stray dashes per segment.
  const segs = t
    .split(/\s+[-–—]\s+/)
    .map(cleanSegment)
    .filter(Boolean)
    .filter(seg => !/^\d{4}$/.test(seg));

  let songTitle = '';
  if (segs.length >= 2) {
    if (!mainArtistRaw) mainArtistRaw = segs[0];
    songTitle = segs.slice(1).join(' - ');
  } else if (segs.length === 1) {
    songTitle = segs[0];
  }

  // A glued trailing "-Singer"/"-Instrumental" on the song title.
  let songTitleAlt: string | null = null;
  if (songTitle) {
    const instTail = songTitle.replace(/\s*[-–—]\s*instrumental\s*$/i, '').trim();
    if (instTail !== songTitle) {
      instrumental = true;
      songTitle = instTail;
    } else {
      const g = songTitle.match(GLUED_SINGER);
      if (g) {
        songTitleAlt = g[1].trim();
        if (voices.length === 0 && !instrumental) voices = splitVoices(g[2]);
      }
    }
  }

  if (instrumental) voices = [];

  return {songTitle, songTitleAlt, mainArtistRaw, voices, instrumental, year, dancedStyle};
}

export type ProposalField = 'orq' | 'singer' | 'year' | 'genre';
export type ProposalTier = 'confirmed' | 'suggested' | 'review';

export type Proposal = {
  id: string;
  title: string;
  folderPath: string;
  current: {orq: string; singer: string; year: number | null; genre: string};
  proposed: {orq: string; singer: string; year: number | null; genre: string};
  changes: ProposalField[];
  tier: ProposalTier;
  source: 'canonical' | 'derived';
  canonicalDate: string | null;
  note: string | null;
};

const SINGER_JOIN = ', ';

/** Canonical display name for an orchestra string (dictionary first, else a
 *  light cleanup). */
function canonicalDisplay(raw: string): string {
  return matchCanonicalArtist(raw) ?? displayArtist(raw);
}

/** Stage 2 + combine: produce a Proposal for one song, or null if nothing would
 *  change. */
export function resolveSong(song: EnrichInput): Proposal | null {
  const d = derive(song);

  const current = {
    orq: song.orq ?? '',
    singer: song.singer ?? '',
    year: song.year ?? null,
    genre: song.genre ?? 'tango',
  };
  const proposed = {...current};
  let source: 'canonical' | 'derived' = 'derived';
  let tier: ProposalTier = 'suggested';
  let canonicalDate: string | null = null;
  let note: string | null = null;
  // Allow proposing an empty orchestra only when we deliberately clear a
  // misplaced singer out of the orchestra field (otherwise we never blank it).
  let allowOrqClear = false;

  // A name in the orchestra slot that we know to be a *singer* (and not an
  // orchestra) was mis-tagged — e.g. "Alberto Echagüe" is D'Arienzo's singer.
  // Don't trust it as an orchestra or try to match it as one.
  const artistIsMisplacedSinger =
    !!d.mainArtistRaw && classifyArtist(d.mainArtistRaw) === 'singer';

  // --- Stage 2: try the canonical catalog (high precision) ---
  // Skip the orchestra-keyed lookup when the "artist" is really a singer; its
  // surname would match the wrong recordings.
  const surname = artistIsMisplacedSinger ? '' : surnameOf(artistCore(d.mainArtistRaw));
  const keys = [d.songTitle, d.songTitleAlt].filter(Boolean) as string[];
  let canon = null as ReturnType<typeof lookupCanonical>;
  for (const k of keys) {
    canon = lookupCanonical(strictTitleKey(k), surname, d.year);
    if (canon) break;
  }

  if (canon) {
    source = 'canonical';
    tier = 'confirmed';
    canonicalDate = canon.date || null;
    proposed.orq = canonicalDisplay(canon.orq);
    if (isInstrumentalCredit(canon.voc)) {
      proposed.singer = ''; // instrumental → no voice
    } else {
      const voices = splitVoices(canon.voc);
      if (voices.length) proposed.singer = voices.join(SINGER_JOIN);
    }
    if (canon.year != null) proposed.year = canon.year;
    const g = styleToGenre(canon.style);
    if (g) proposed.genre = g;

    // Surface disagreements between the catalog and the DJ's folder for review.
    if (d.dancedStyle !== 'other' && d.dancedStyle !== 'cortina') {
      const folderGenre = styleToGenre(d.dancedStyle);
      if (folderGenre && g && folderGenre !== g) {
        tier = 'review';
        note = `Folder suggests ${folderGenre}, catalog says ${g}`;
      }
    }
  } else if (artistIsMisplacedSinger) {
    // The orchestra field holds a singer's name — move it to the singer field
    // and leave the orchestra unknown (we can't recover it from the data). Flag
    // for review so the DJ can fill in the real orchestra if they know it.
    tier = 'review';
    note = 'Looks like a singer, not an orchestra';
    proposed.orq = '';
    allowOrqClear = true;
    // Move the name to the singer field — but not onto an instrumental track,
    // where there is no voice (just clear the wrong orchestra and let the DJ
    // decide). Never overwrite a singer the DJ already set.
    if (!current.singer && !d.instrumental) {
      proposed.singer = d.voices.length ? d.voices.join(SINGER_JOIN) : displayArtist(d.mainArtistRaw as string);
    }
    if (current.year == null && d.year != null) proposed.year = d.year;
    const g = styleToGenre(d.dancedStyle);
    if (g) proposed.genre = g;
  } else {
    // --- Stage 1 only: derived values ---
    const dict = matchCanonicalArtist(d.mainArtistRaw);
    if (dict) {
      proposed.orq = dict; // confident orchestra (incl. one recovered from the title)
    } else if (junkArtist(current.orq) || isIgnoredArtist(current.orq)) {
      // The orchestra field holds a non-artist value (the literal word
      // "Instrumental", or a junk value from known-artists.json) and we couldn't
      // recover a real orchestra from the title — clear it and flag for review.
      proposed.orq = '';
      allowOrqClear = true;
      tier = 'review';
      note = junkArtist(current.orq) ? '“Instrumental” isn’t an orchestra' : 'Not an orchestra';
    }
    if (!d.instrumental && d.voices.length && !current.singer) {
      proposed.singer = d.voices.join(SINGER_JOIN);
    }
    if (current.year == null && d.year != null) proposed.year = d.year;
    const g = styleToGenre(d.dancedStyle); // folder is authoritative for style
    if (g) proposed.genre = g;
  }

  // --- Diff: which fields actually change? ---
  const changes: ProposalField[] = [];
  const orqChanged = allowOrqClear
    ? proposed.orq !== current.orq
    : !!proposed.orq && proposed.orq !== current.orq;
  if (orqChanged) changes.push('orq');
  // Singer: propose a fill/replace, or (canonical-only) a clear when instrumental.
  if (proposed.singer !== current.singer) {
    if (proposed.singer || source === 'canonical') changes.push('singer');
    else proposed.singer = current.singer; // never silently clear on a guess
  }
  if (proposed.year != null && proposed.year !== current.year) changes.push('year');
  // Never reclassify a cortina: the DJ marked the folder as cortinas (or set it
  // explicitly), and that intent outranks any folder/catalog-derived style.
  if (proposed.genre && proposed.genre !== current.genre && current.genre !== 'cortina') {
    changes.push('genre');
  }

  if (changes.length === 0) return null;

  return {
    id: song.id,
    title: song.title,
    folderPath: song.folderPath,
    current,
    proposed,
    changes,
    tier,
    source,
    canonicalDate,
    note,
  };
}

export type ProposalSummary = {
  total: number;
  confirmed: number;
  suggested: number;
  review: number;
};

export type LibraryProposal = {
  proposals: Proposal[];
  summary: ProposalSummary;
};

/** Run the engine across the whole library. Cheap: pure string work over rows. */
export function proposeLibrary(songs: EnrichInput[]): LibraryProposal {
  const proposals: Proposal[] = [];
  const summary: ProposalSummary = {total: 0, confirmed: 0, suggested: 0, review: 0};
  for (const s of songs) {
    const p = resolveSong(s);
    if (!p) continue;
    proposals.push(p);
    summary.total += 1;
    summary[p.tier] += 1;
  }
  // Order: confirmed first, then suggested, then review — but the UI groups by
  // tier anyway; within a tier keep them stable by folder/title.
  proposals.sort(
    (a, b) =>
      tierRank(a.tier) - tierRank(b.tier) ||
      a.folderPath.localeCompare(b.folderPath) ||
      a.title.localeCompare(b.title),
  );
  return {proposals, summary};
}

function tierRank(t: ProposalTier): number {
  return t === 'confirmed' ? 0 : t === 'suggested' ? 1 : 2;
}
