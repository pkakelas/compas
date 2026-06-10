// tango-names.ts — pure, dependency-free helpers for understanding tango
// metadata: text normalization, a strict title key, a curated canonical
// orchestra dictionary, and small parsers for singers and danced style.
//
// Everything here is a pure function so it can be unit-tested and reused by the
// inference engine (enrich.ts) and the canonical lookup (canonical.ts) without
// touching the database, the filesystem, or Electron.
import knownArtists from '../data/known-artists.json' with {type: 'json'};

/** Canonical danced style. Matches the app's genre vocabulary (+ 'other'). */
export type Style = 'tango' | 'vals' | 'milonga' | 'cortina' | 'other';

/**
 * Loosely normalize a string for comparison: strip diacritics, fold smart
 * quotes to a plain apostrophe, lowercase, drop anything but letters/digits/
 * apostrophes, and collapse whitespace. Keeps word boundaries (spaces) intact —
 * use this for artist names, where token structure matters.
 */
export function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining diacritics
    .replace(/[\u2018\u2019\u02bc\u00b4`]/g, "'") // smart quotes → '
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A strict, exact-match key for song titles: like `normalize` but also removes
 * apostrophes AND spaces, so "Pa' l que se va" and "Pa'l que se va" collapse to
 * the same key. This is deliberately NOT fuzzy — it only equates titles that are
 * identical up to case, accents, punctuation and spacing, so two genuinely
 * different titles never collide.
 */
export function strictTitleKey(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// Ensemble/role words stripped from the front of an artist name so
// "Orquesta Carlos Di Sarli", "Sexteto Carlos Di Sarli" and "Carlos Di Sarli"
// all reduce to the same core "carlos di sarli".
const LEAD_DECORATOR =
  /^(orquesta tipica|orquesta de cuerdas de|orquesta del|orquesta de|orquesta|sexteto|quinteto|cuarteto|conjunto|trio|dir)\b/;

/**
 * Reduce a raw artist string to its core name tokens: normalized, with leading
 * ensemble decorators and any trailing "- topic"/"-dir:" cruft removed.
 */
export function artistCore(raw: string | null | undefined): string {
  let n = normalize(raw)
    .replace(/\s*-?\s*topic\b.*$/, '') // YouTube "- Topic"
    .replace(/\s*-?\s*dir\b.*$/, '') // "-dir: …"
    .trim();
  // Strip stacked leading decorators ("orquesta tipica victor" keeps "victor").
  let prev: string;
  do {
    prev = n;
    n = n.replace(LEAD_DECORATOR, '').trim();
  } while (n !== prev && n.length);
  return n;
}

/** Surname (last token) of a core name, used as a match candidate. */
export function surnameOf(core: string): string {
  const toks = core.split(' ').filter(Boolean);
  return toks.length ? toks[toks.length - 1] : '';
}

// Curated canonical orchestras. Each entry lists the accepted *full core* forms
// (already normalized: lowercase, no accents). Matching is EXACT against these
// forms, never a loose surname guess — so "roberto pugliese" and "adriana
// varela" do NOT collapse into Osvaldo Pugliese / Héctor Varela.
type CanonEntry = {display: string; forms: string[]};
const CANONICAL_ORCHESTRAS: CanonEntry[] = [
  {display: "Juan D'Arienzo", forms: ["juan d'arienzo", "d'arienzo", "darienzo"]},
  {display: 'Carlos Di Sarli', forms: ['carlos di sarli', 'di sarli', 'disarli']},
  {display: 'Aníbal Troilo', forms: ['anibal troilo', 'troilo']},
  {display: 'Osvaldo Pugliese', forms: ['osvaldo pugliese', 'pugliese']},
  {display: 'Ricardo Tanturi', forms: ['ricardo tanturi', 'tanturi']},
  {display: 'Francisco Canaro', forms: ['francisco canaro', 'canaro']},
  {display: 'Osvaldo Fresedo', forms: ['osvaldo fresedo', 'fresedo']},
  {display: 'Miguel Caló', forms: ['miguel calo', 'calo']},
  {display: 'Rodolfo Biagi', forms: ['rodolfo biagi', 'biagi', 'biagi rodolfo']},
  {display: 'Pedro Laurenz', forms: ['pedro laurenz', 'laurenz']},
  {display: "Ángel D'Agostino", forms: ["angel d'agostino", "d'agostino", 'dagostino']},
  {display: 'Alfredo De Angelis', forms: ['alfredo de angelis', 'de angelis']},
  {display: 'Lucio Demare', forms: ['lucio demare', 'demare']},
  {display: 'Edgardo Donato', forms: ['edgardo donato', 'donato']},
  {display: 'Enrique Rodríguez', forms: ['enrique rodriguez', 'rodriguez']},
  {display: 'Francisco Lomuto', forms: ['francisco lomuto', 'lomuto']},
  {display: 'Julio De Caro', forms: ['julio de caro', 'de caro']},
  {display: 'Alfredo Gobbi', forms: ['alfredo gobbi', 'gobbi']},
  {display: 'Astor Piazzolla', forms: ['astor piazzolla', 'piazzolla']},
  {display: 'Orquesta Típica Victor', forms: ['victor', 'tipica victor', 'orquesta tipica victor']},
  {display: 'Carlos Marcucci', forms: ['carlos marcucci', 'marcucci']},
  {display: 'Adolfo Carabelli', forms: ['adolfo carabelli', 'carabelli']},
  {display: 'Domingo Federico', forms: ['domingo federico', 'federico']},
  {display: 'Héctor Varela', forms: ['hector varela', 'varela']},
  {display: 'Florindo Sassone', forms: ['florindo sassone', 'sassone']},
  {display: 'Roberto Firpo', forms: ['roberto firpo', 'firpo']},
  {display: 'José Basso', forms: ['jose basso', 'basso']},
  {display: 'Ricardo Malerba', forms: ['ricardo malerba', 'malerba']},
  // NOTE: famous *singers* (Enrique Campos, Alberto Castillo, Carlos Gardel,
  // Alberto Echagüe, Jorge Durán, …) are deliberately NOT listed here — they are
  // not orchestras. The engine recognizes them via the catalog's singer set and
  // moves them out of the orchestra field (see enrich.ts).
];

const FORM_TO_CANON = new Map<string, string>();
for (const e of CANONICAL_ORCHESTRAS) for (const f of e.forms) FORM_TO_CANON.set(f, e.display);

// User-supplied list (data/known-artists.json), reviewable and editable. It
// extends the built-in dictionary and TAKES PRECEDENCE for orchestra/singer
// classification. Only the exact normalized core of each name is registered, so
// adding "Osvaldo Fresedo" tidies "OSVALDO FRESEDO" but never loosely merges a
// different person who happens to share a surname.
type KnownArtists = {orchestras?: string[]; singers?: string[]; ignore?: string[]};
const USER_ORCHESTRA_CORES = new Set<string>();
const USER_SINGER_CORES = new Set<string>();
const USER_IGNORE_CORES = new Set<string>();
for (const display of (knownArtists as KnownArtists).orchestras ?? []) {
  const core = artistCore(display);
  if (!core) continue;
  USER_ORCHESTRA_CORES.add(core);
  if (!FORM_TO_CANON.has(core)) FORM_TO_CANON.set(core, display); // tidy spelling/case
}
for (const display of (knownArtists as KnownArtists).singers ?? []) {
  const core = artistCore(display);
  if (core) USER_SINGER_CORES.add(core);
}
for (const display of (knownArtists as KnownArtists).ignore ?? []) {
  // Ignore entries can be arbitrary junk (e.g. "LO PASAO,PASO"), so key them on
  // the looser `normalize` rather than `artistCore` (which strips ensemble words).
  const n = normalize(display);
  if (n) USER_IGNORE_CORES.add(n);
}

/** True if the user's list explicitly names this as an orchestra. */
export function isUserOrchestra(raw: string | null | undefined): boolean {
  const c = artistCore(raw);
  return !!c && USER_ORCHESTRA_CORES.has(c);
}

/** True if the user's list explicitly names this as a singer. */
export function isUserSinger(raw: string | null | undefined): boolean {
  const c = artistCore(raw);
  return !!c && USER_SINGER_CORES.has(c);
}

/** True if the user's list marks this value as junk (not an artist at all). */
export function isIgnoredArtist(raw: string | null | undefined): boolean {
  const n = normalize(raw);
  return !!n && USER_IGNORE_CORES.has(n);
}

/**
 * Resolve a raw artist string to a canonical orchestra name, or null if it
 * isn't a confident, exact match. Strips ensemble decorators first, then
 * requires the remaining core to exactly equal one of the curated name forms.
 */
export function matchCanonicalArtist(raw: string | null | undefined): string | null {
  const core = artistCore(raw);
  if (!core) return null;
  return FORM_TO_CANON.get(core) ?? null;
}

// A leading "Orquesta " is dropped for display (DJs say "Di Sarli", not
// "Orquesta Carlos Di Sarli"), but the named "Orquesta Típica …" ensembles keep
// their full name.
const DROP_LEAD_ORQ = /^orquesta\s+(?!t[ií]pica\b)/i;

/**
 * A tidy display form for an artist we recognize but that isn't in the curated
 * dictionary: trims YouTube "- Topic" and a leading bare "Orquesta ". We never
 * re-case or otherwise rewrite the name — guessing capitalization risks mangling
 * names like D'Arienzo — so unmatched names are only lightly cleaned.
 */
export function displayArtist(raw: string): string {
  return (raw || '')
    .replace(/\s*-?\s*topic\s*$/i, '')
    .replace(DROP_LEAD_ORQ, '')
    .trim();
}

// Separators between co-singers: "&", "y", "con", "with", "/", ",".
const VOICE_SEP = /\s*(?:&| y | con | with |\/|,)\s*/i;
// Parenthetical notes that are NOT a singer (alternate takes, tempo notes…).
const NON_SINGER = /tempo|take|remaster|version|alt|vivo|live|slower|faster|remasterizado/i;

/**
 * Split a singer credit into individual voices, dropping chorus markers
 * ("coro"/"corro") and empty fragments. "Marino y Floreal Ruiz" → two voices.
 */
export function splitVoices(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(VOICE_SEP)
    .map(v => v.trim())
    .filter(v => v && !/^(corro|coro)$/i.test(v));
}

/** True if a parenthetical/credit string denotes an instrumental recording. */
export function isInstrumentalCredit(s: string | null | undefined): boolean {
  return /instrumental/i.test(s ?? '');
}

/** True if a parenthetical is a non-singer note (so we don't read it as a voice). */
export function isNonSingerNote(s: string | null | undefined): boolean {
  return NON_SINGER.test(s ?? '');
}

/**
 * The danced style implied by a folder path (the DJ's own organization, which
 * we treat as authoritative). Returns 'other' when no known style word appears.
 */
export function dancedStyleFromFolder(folderPath: string | null | undefined): Style {
  const segs = normalize(folderPath).split(' ');
  if (segs.includes('cortina') || segs.includes('cortinas')) return 'cortina';
  if (segs.includes('vals') || segs.includes('valses')) return 'vals';
  if (segs.includes('milonga') || segs.includes('milongas')) return 'milonga';
  if (segs.includes('tango') || segs.includes('tangos')) return 'tango';
  return 'other';
}

/** Map a CSV/danced style code to the app's stored genre, or null if unsupported.
 *  Cortina is a usage flag, not a musical genre, so it never maps to a genre
 *  value — Smart Organize must not stamp genre='cortina' on a song. */
export function styleToGenre(style: Style): string | null {
  return style === 'other' || style === 'cortina' ? null : style;
}
