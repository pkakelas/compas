// canonical.ts — a high-precision lookup against a bundled reference catalog of
// historical tango recordings (derived from the open todotango dataset, indexed
// by a strict title key).
//
// The catalog is used only to CONFIRM and enrich what the heuristic parser
// already derived: a match requires the title key, the orchestra surname, and
// (when a title was recorded more than once) the year to all agree. This keeps
// recall modest but precision very high — we never borrow another orchestra's
// metadata for a song just because the title happens to match.
//
// Data source: https://github.com/galanakis/tangomusicdb (todotango.csv).
import rawIndex from '../data/canonical-tango.json' with {type: 'json'};
import {
  artistCore,
  surnameOf,
  splitVoices,
  isInstrumentalCredit,
  isUserOrchestra,
  isUserSinger,
  type Style,
} from './tango-names.js';

type RawRecord = {o: string; v: string; d: string; g: string};
type IndexedRecord = {orq: string; voc: string; date: string; style: Style; orqSurname: string};

// Authoritative core-name sets, derived from the catalog: every name that ever
// appears as an orchestra, and every name that appears as a singer. These let
// the engine tell when a name in the "orchestra" slot is really a singer.
const ORQ_CORES = new Set<string>();
const VOC_CORES = new Set<string>();

const INDEX: Map<string, IndexedRecord[]> = (() => {
  const map = new Map<string, IndexedRecord[]>();
  const data = rawIndex as Record<string, RawRecord[]>;
  for (const key of Object.keys(data)) {
    map.set(
      key,
      data[key].map(r => {
        const orqCore = artistCore(r.o);
        if (orqCore) ORQ_CORES.add(orqCore);
        if (r.v && !isInstrumentalCredit(r.v)) {
          for (const voice of splitVoices(r.v)) {
            const vc = artistCore(voice);
            if (vc) VOC_CORES.add(vc);
          }
        }
        return {
          orq: r.o,
          voc: r.v,
          date: r.d,
          style: (r.g as Style) ?? 'tango',
          orqSurname: surnameOf(orqCore),
        };
      }),
    );
  }
  return map;
})();

/**
 * Decide whether an artist name denotes an orchestra, a singer, or neither.
 * The user's reviewable list (known-artists.json) wins; otherwise the catalog
 * decides, treating a name that only ever appears as a vocalist as a singer.
 */
export function classifyArtist(raw: string | null | undefined): 'orchestra' | 'singer' | 'unknown' {
  if (isUserOrchestra(raw) && !isUserSinger(raw)) return 'orchestra';
  if (isUserSinger(raw) && !isUserOrchestra(raw)) return 'singer';
  const c = artistCore(raw);
  if (!c) return 'unknown';
  const inOrq = ORQ_CORES.has(c);
  const inVoc = VOC_CORES.has(c);
  if (inVoc && !inOrq) return 'singer';
  if (inOrq) return 'orchestra';
  return 'unknown';
}

export type CanonicalMatch = {
  orq: string;
  voc: string;
  date: string; // ISO-ish, may be just a year
  year: number | null;
  style: Style;
};

function yearOf(date: string): number | null {
  const m = (date || '').match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Find the single canonical recording that matches a derived song, or null.
 *
 * Precision rules:
 *  - the strict title key must be present in the catalog;
 *  - at least one candidate's orchestra surname must equal `orqSurname`;
 *  - if several candidates remain (same title + orchestra, different takes), a
 *    `year` is required to pick one — otherwise we return null rather than guess.
 */
export function lookupCanonical(
  titleKey: string,
  orqSurname: string,
  year: number | null,
): CanonicalMatch | null {
  if (!titleKey || !orqSurname) return null;
  const candidates = INDEX.get(titleKey);
  if (!candidates) return null;

  const byOrq = candidates.filter(r => r.orqSurname === orqSurname);
  if (byOrq.length === 0) return null;

  let chosen: IndexedRecord | undefined;
  if (byOrq.length === 1) {
    chosen = byOrq[0];
  } else if (year != null) {
    chosen = byOrq.find(r => yearOf(r.date) === year);
  }
  if (!chosen) return null;

  return {
    orq: chosen.orq,
    voc: chosen.voc,
    date: chosen.date,
    year: yearOf(chosen.date),
    style: chosen.style,
  };
}
