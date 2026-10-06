// Sanity-check the renderer's translations (packages/renderer/locales):
//   - every locale has exactly the keys English has (plural forms aside),
//   - every plural family has the forms its language's plural rules select,
//   - every message keeps the {placeholders} and <tags> of its English source,
//   - every tr("…") / trx("…") key used in the renderer exists in English,
//   - English keys nothing references are listed as a warning.
// Run with `pnpm run i18n:check`. Exits non-zero on errors.
import {readdirSync, readFileSync} from 'node:fs';
import {join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const renderer = fileURLToPath(new URL('../packages/renderer/', import.meta.url));
const localesDir = join(renderer, 'locales');
const SOURCE = 'en';
const PLURAL = /_(zero|one|two|few|many|other)$/;

function load(locale) {
  const out = {};
  const dir = join(localesDir, locale);
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const dict = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const [k, v] of Object.entries(dict)) out[`${basename(file, '.json')}.${k}`] = v;
  }
  return out;
}

// The plural categories a locale's rules actually pick for whole-number counts
// (plus "other", the runtime's fallback). Narrower than Intl's full list on
// purpose: Spanish, French and Italian only use "many" for exact millions.
function neededCategories(locale) {
  const rules = new Intl.PluralRules(locale);
  const cats = new Set(['other']);
  for (let n = 0; n <= 200; n++) cats.add(rules.select(n));
  return [...cats];
}

const tokens = msg => [...String(msg).matchAll(/\{\w+\}|<\/?\w+>/g)].map(m => m[0]).sort().join(' ');
const base = key => key.replace(PLURAL, '');

const errors = [];
const warnings = [];
const source = load(SOURCE);
const sourceBases = new Set(Object.keys(source).map(base));

// --- locales vs. English ---
const locales = readdirSync(localesDir, {withFileTypes: true})
  .filter(d => d.isDirectory() && d.name !== SOURCE)
  .map(d => d.name);
for (const locale of locales) {
  const dict = load(locale);
  const bases = new Set(Object.keys(dict).map(base));
  const needed = neededCategories(locale);
  for (const key of Object.keys(source)) {
    // A locale may use different plural categories than English, so plural
    // keys are matched by their base; everything else must match exactly.
    if (PLURAL.test(key) ? !bases.has(base(key)) : !(key in dict)) errors.push(`${locale}: missing ${key}`);
  }
  for (const family of new Set(Object.keys(source).filter(k => PLURAL.test(k)).map(base))) {
    if (!bases.has(family)) continue; // already reported as missing above
    for (const cat of needed) {
      if (!(`${family}_${cat}` in dict)) errors.push(`${locale}: missing plural form ${family}_${cat}`);
    }
  }
  for (const [key, msg] of Object.entries(dict)) {
    if (!sourceBases.has(base(key))) {
      errors.push(`${locale}: unknown key ${key}`);
      continue;
    }
    if (typeof msg !== 'string' || !msg.trim()) errors.push(`${locale}: empty ${key}`);
    const ref = source[key] ?? source[`${base(key)}_other`];
    if (ref != null && tokens(ref) !== tokens(msg)) {
      errors.push(`${locale}: ${key} placeholders differ — expected "${tokens(ref)}", got "${tokens(msg)}"`);
    }
  }
}

// --- keys used in code vs. English ---
const used = new Set();
const prefixes = new Set();
const sources = readdirSync(join(renderer, 'js')).map(f => join(renderer, 'js', f));
for (const file of sources) {
  const code = readFileSync(file, 'utf8');
  // tr("ns.key") — or tr("ns.prefix." + x) / tr(`ns.prefix.${x}`), a dynamic key.
  for (const m of code.matchAll(/\btrx?\(\s*(["'`])([\w.]+)(\1|\$\{)\s*(\+)?/g)) {
    const dynamic = m[3] === '${' || m[4] === '+';
    if (dynamic) prefixes.add(m[2]);
    else used.add(m[2]);
  }
  // Keys kept in data (e.g. `labelKey: "ns.key"`) and resolved by a later tr(x).
  for (const m of code.matchAll(/\b\w*Key:\s*(["'])([\w]+\.[\w.]+)\1/g)) used.add(m[2]);
}
for (const key of used) {
  if (!sourceBases.has(key)) errors.push(`code: tr("${key}") has no English message`);
}
for (const prefix of prefixes) {
  if (![...sourceBases].some(k => k.startsWith(prefix))) errors.push(`code: no English messages under "${prefix}…"`);
}
for (const key of sourceBases) {
  if (!used.has(key) && ![...prefixes].some(p => key.startsWith(p))) warnings.push(`unused: ${key}`);
}

for (const w of warnings) console.warn('warn  ' + w);
for (const e of errors) console.error('error ' + e);
console.log(`${Object.keys(source).length} English messages, ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
