// Internationalization for the design files. Like everything else they rely on,
// the API is published on `window` (the design files are classic scripts with no
// imports): `tr()` for plain strings, `trx()` for strings with embedded JSX, and
// `I18N` for the active locale.
//
// Messages live in ../locales/<locale>/<namespace>.json as flat key → string
// maps; a message is addressed as "<namespace>.<key>". English is the source of
// truth and the fallback for anything a locale is missing.
//
//   tr("common.cancel")                         → "Cancel"
//   tr("tandas.savedAs", { name })              → "Saved as {name}"
//   tr("common.songs", { count: 3 })            → picks songs_one / songs_other
//   trx("settings.madeBy", { heart: <span/> })  → React nodes, {heart} swapped in
//   trx("x.hint", { b: (s) => <b>{s}</b> })     → wraps the <b>…</b> span of the message
import React from "react";

const DEFAULT_LOCALE = "en";
const STORAGE_KEY = "compas.language";

// The languages offered in Settings. `name` is the language's own name, so the
// picker reads the same whatever locale is active. `lang` is the BCP 47 tag put
// on <html lang> (drives font fallback, hyphenation and locale-aware uppercase).
const LOCALES = [
  { id: "en", name: "English", lang: "en" },
  { id: "zh", name: "中文", lang: "zh-Hans" },
  { id: "hi", name: "हिन्दी", lang: "hi" },
  { id: "es", name: "Español", lang: "es" },
  { id: "fr", name: "Français", lang: "fr" },
  { id: "el", name: "Ελληνικά", lang: "el" },
  { id: "it", name: "Italiano", lang: "it" },
  { id: "de", name: "Deutsch", lang: "de" },
  { id: "tr", name: "Türkçe", lang: "tr" },
  { id: "ru", name: "Русский", lang: "ru" },
  { id: "ja", name: "日本語", lang: "ja" },
];

// locale → { "namespace.key": "message" }
const MESSAGES = {};
const files = import.meta.glob("../locales/*/*.json", { eager: true, import: "default" });
for (const [path, dict] of Object.entries(files)) {
  const m = path.match(/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!m) continue;
  const bag = MESSAGES[m[1]] || (MESSAGES[m[1]] = {});
  for (const [k, v] of Object.entries(dict)) bag[m[2] + "." + k] = v;
}

const isSupported = (id) => LOCALES.some((l) => l.id === id);

let locale = DEFAULT_LOCALE;
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (isSupported(saved)) locale = saved;
} catch (e) { /* localStorage unavailable — stay on the default */ }

const listeners = new Set();
const pluralRules = {};
function pluralCategory(loc, count) {
  if (!pluralRules[loc]) pluralRules[loc] = new Intl.PluralRules(loc);
  return pluralRules[loc].select(count);
}

// Resolve a key to its raw message. With a numeric `count` the plural form is
// tried first (key_one, key_other, …). Falls back to English, then to the key.
function lookup(key, vars) {
  const hasCount = vars && typeof vars.count === "number";
  for (const loc of locale === DEFAULT_LOCALE ? [DEFAULT_LOCALE] : [locale, DEFAULT_LOCALE]) {
    const dict = MESSAGES[loc];
    if (!dict) continue;
    if (hasCount) {
      const plural = dict[key + "_" + pluralCategory(loc, vars.count)];
      if (plural != null) return plural;
      if (dict[key + "_other"] != null) return dict[key + "_other"];
    }
    if (dict[key] != null) return dict[key];
  }
  if (import.meta.env.DEV) console.warn("[i18n] missing message:", key);
  return key;
}

const fill = (msg, vars) =>
  vars ? msg.replace(/\{(\w+)\}/g, (m, name) => (vars[name] != null ? String(vars[name]) : m)) : msg;

/** Translate `key` to a string, replacing {placeholders} from `vars`. */
function tr(key, vars) {
  return fill(lookup(key, vars), vars);
}

/** Translate `key` to React nodes. A {placeholder} whose var is a React node is
 *  swapped in as-is, and a <tag>…</tag> span is passed to `vars.tag(children)`
 *  to be wrapped — so a sentence with a link or a bold word stays one message. */
function trx(key, vars = {}) {
  const msg = lookup(key, vars);
  const out = [];
  const re = /\{(\w+)\}|<(\w+)>(.*?)<\/\2>/gs;
  let last = 0;
  let m;
  while ((m = re.exec(msg))) {
    if (m.index > last) out.push(msg.slice(last, m.index));
    if (m[1]) out.push(vars[m[1]] != null ? vars[m[1]] : m[0]);
    else out.push(typeof vars[m[2]] === "function" ? vars[m[2]](fill(m[3], vars)) : fill(m[3], vars));
    last = m.index + m[0].length;
  }
  if (last < msg.length) out.push(msg.slice(last));
  return React.createElement(React.Fragment, null, ...out);
}

function applyLocale() {
  const meta = LOCALES.find((l) => l.id === locale);
  document.documentElement.lang = meta ? meta.lang : locale;
  // The main process owns the native bits (menu, file dialogs) — keep it in step.
  if (window.compas && window.compas.setLocale) window.compas.setLocale(locale).catch(() => {});
}

function setLocale(id) {
  if (!isSupported(id) || id === locale) return;
  locale = id;
  try { localStorage.setItem(STORAGE_KEY, id); } catch (e) { /* ignore */ }
  applyLocale();
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Re-render the calling component when the language changes. The app shell
 *  calls this once at the root: strings are resolved at render time, so one
 *  top-level re-render retranslates every view without remounting anything. */
function useLocale() {
  return React.useSyncExternalStore(subscribe, () => locale);
}

applyLocale();

window.tr = tr;
window.trx = trx;
window.I18N = {
  LOCALES,
  get locale() { return locale; },
  setLocale,
  useLocale,
};
