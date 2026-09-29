// tanda-tags.ts — infer type / age / orquesta tags for a tanda from its songs.
// A main-process port of suggestTandaTags in renderer/js/tandas-tags.jsx, used
// when the playlist importer creates tandas it inferred from a flat playlist.
// Keep the preset vocabulary in sync with TAG_PRESETS there.

import type {Song, TandaTag} from '../modules/Database.js';

const ORQUESTA_PRESETS = [
  "D'Arienzo", 'Di Sarli', 'Pugliese', 'Troilo', 'Tanturi', 'Canaro',
  'Fresedo', 'Caló', 'Biagi', 'Laurenz', "D'Agostino", 'De Angelis',
  'Demare', 'Donato', 'Rodríguez',
];
const AGE_PRESETS = new Set(['20s', '30s', '40s', '50s', '60s']);
const TYPE_LABELS: Record<string, string> = {tango: 'Tango', vals: 'Vals', milonga: 'Milonga', cortina: 'Cortina'};

function normOrq(raw: string | null | undefined): string {
  return (raw || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’`]/g, "'")
    .toLowerCase()
    .replace(/^orquesta\s+(?!tipica)/, '')
    .replace(/\s*-?\s*topic\s*$/, '')
    .trim();
}

function orqMatchesPreset(core: string, preset: string): boolean {
  const p = normOrq(preset);
  if (!core || !p) return false;
  if (core === p) return true;
  if (core.endsWith(' ' + p)) return true;
  if (p.includes(' ') && core.includes(p)) return true;
  const toks = core.split(/\s+/);
  return toks[toks.length - 1] === p;
}

function matchOrquestaTag(raw: string): TandaTag | null {
  const core = normOrq(raw);
  if (!core) return null;
  for (const label of ORQUESTA_PRESETS) {
    if (orqMatchesPreset(core, label)) return {cat: 'orquesta', label};
  }
  return null;
}

function yearToAgeTag(year: number): TandaTag | null {
  if (!year || year < 1920) return null;
  const decade = Math.floor(year / 10) * 10;
  if (decade > 1960) return null;
  const label = String(decade).slice(-2) + 's';
  return AGE_PRESETS.has(label) ? {cat: 'age', label} : null;
}

/** Infer type / age / orquesta tags from a tanda's songs. */
export function suggestTandaTags(songs: Song[]): TandaTag[] {
  if (!songs.length) return [];
  const tags: TandaTag[] = [];
  const add = (t: TandaTag | null): void => {
    if (!t || tags.some(x => x.cat === t.cat && x.label === t.label)) return;
    tags.push(t);
  };

  const genres = [...new Set(songs.map(s => s.genre).filter(Boolean))];
  if (genres.length === 1 && TYPE_LABELS[genres[0]]) add({cat: 'type', label: TYPE_LABELS[genres[0]]});

  const orqs = [...new Set(songs.map(s => s.orq).filter(Boolean))];
  if (orqs.length === 1) add(matchOrquestaTag(orqs[0]));

  const years = songs.map(s => s.year).filter((y): y is number => !!y);
  if (years.length) {
    const decades = new Set(years.map(y => Math.floor(y / 10) * 10));
    add(yearToAgeTag(decades.size === 1 ? years[0] : Math.min(...years)));
  }
  return tags;
}
