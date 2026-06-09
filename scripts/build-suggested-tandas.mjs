// build-suggested-tandas.mjs — convert the curated tandas list (a tab-separated
// export, blocks of songs delimited by blank rows) into the bundled reference
// JSON the app matches against each DJ's library.
//
//   node scripts/build-suggested-tandas.mjs
//
// Source : scripts/suggested-tandas.source.tsv   (Song · Orchestra · Singer · Year · Type)
// Output : packages/main/src/data/suggested-tandas.json
//
// The list is messy on purpose-tolerant: annotation rows ("My Favorite Tanda"),
// singer cells that wrapped onto a second line, "?1939?" years, alternate titles
// ("El Retirao // El Retirado"), and missing Type columns. We parse best-effort —
// any block that comes out garbled simply won't fully match a library later and
// quietly drops out, so imperfect rows never produce a broken suggestion.

import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'suggested-tandas.source.tsv');
const OUT = join(HERE, '..', 'packages', 'main', 'src', 'data', 'suggested-tandas.json');

// Mirror of tango-names.ts strictTitleKey / surname, used only for de-duplicating
// identical reference tandas (the runtime matcher has its own copies).
const strictTitleKey = s =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
const surnameOf = s => {
  const n = (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ´`]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  return n.length ? n[n.length - 1] : '';
};

/** Parse a year cell: first 4-digit 19xx/20xx number, else null. Handles "?1939?", " 1944". */
function parseYear(raw) {
  const m = String(raw ?? '').match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}

/** Split a title cell into a primary title + alternates ("A // B", "A / B"). */
function splitTitles(raw) {
  const parts = String(raw ?? '')
    .split(/\s*\/\/\s*|\s+\/\s+/)
    .map(s => s.trim())
    .filter(Boolean);
  return {title: parts[0] || '', alts: parts.slice(1)};
}

const lines = readFileSync(SRC, 'utf8').split(/\r?\n/);

// A blank row (all cells empty after trim) separates tandas.
const isBlank = cols => cols.every(c => c.trim() === '');
// An orchestra cell must read like a name: has a letter and isn't just a year.
const looksLikeOrchestra = v => /[a-zà-ÿ]/i.test(v) && !/^\s*(19|20)\d{2}\s*$/.test(v);

const blocks = [];
let cur = [];
let started = false;
for (const line of lines) {
  const cols = line.split('\t');
  if (!started) {
    // Skip down to the header row, then begin.
    if (/song/i.test(cols[0] || '') && /orchestra/i.test(cols[1] || '')) started = true;
    continue;
  }
  if (isBlank(cols)) {
    if (cur.length) blocks.push(cur);
    cur = [];
  } else {
    cur.push(cols);
  }
}
if (cur.length) blocks.push(cur);

const tandas = [];
const seen = new Set();
let dropped = 0;

for (const block of blocks) {
  const songs = [];
  for (const cols of block) {
    const title0 = (cols[0] || '').trim();
    const orq = (cols[1] || '').trim();
    if (!title0 || !looksLikeOrchestra(orq)) continue; // annotation / wrapped-cell row
    const {title, alts} = splitTitles(title0);
    if (!title) continue;
    songs.push({
      title,
      ...(alts.length ? {alts} : {}),
      orq,
      singer: (cols[2] || '').trim() || null,
      year: parseYear(cols[3]),
      type: (cols[4] || '').trim() || 'Tango',
    });
  }

  // Tandas are 3–5 songs. Anything smaller is an annotation/garbled block; we
  // allow up to 6 to tolerate the occasional 5-song set plus a stray row.
  if (songs.length < 3 || songs.length > 6) {
    dropped++;
    continue;
  }

  // Dominant orchestra + type across the block.
  const mode = pick => {
    const counts = new Map();
    for (const s of songs) {
      const k = pick(s);
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }
    let best = null;
    let n = 0;
    for (const [k, c] of counts) if (c > n) ((best = k), (n = c));
    return best;
  };
  const orchestra = mode(s => s.orq);
  const type = mode(s => s.type) || 'Tango';

  // De-dupe identical reference tandas (the list repeats some across sections).
  const sig = songs.map(s => `${strictTitleKey(s.title)}@${s.year ?? ''}`).join('|') + `~${surnameOf(orchestra)}`;
  if (seen.has(sig)) continue;
  seen.add(sig);

  const tags = [];
  if (orchestra) tags.push({cat: 'orquesta', label: orchestra});
  if (type) tags.push({cat: 'type', label: type});

  tandas.push({songs, tags});
}

writeFileSync(OUT, JSON.stringify(tandas, null, 2) + '\n', 'utf8');
console.log(
  `Parsed ${blocks.length} blocks → ${tandas.length} reference tandas ` +
    `(${dropped} blocks dropped as too small/large). Wrote ${OUT}`,
);
