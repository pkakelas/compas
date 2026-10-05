# Translations

Every user-visible string in the renderer lives here, one folder per language
and one JSON file per namespace:

```
locales/<locale>/<namespace>.json     →  tr("<namespace>.<key>")
```

English (`en/`) is the source of truth and the fallback for anything another
locale is missing. The runtime is `entries/i18n.js`; it publishes `tr`, `trx`
and `I18N` on `window`, like the rest of the design-file globals.

## Using it in a design file

```jsx
tr("common.cancel")                                // "Cancel"
tr("tandas.savedAs", { name })                     // "Saved as {name}"
tr("common.songs", { count: n })                   // songs_one / songs_other
trx("settings.bugs", { mail: <a …>…</a> })         // {mail} swapped for a node
trx("onboarding.tip", { b: (s) => <b>{s}</b> })    // wraps "<b>…</b>" in the message
```

Rules that keep translations correct:

- **Call `tr()` at render / event time, never at module top level** and never
  cache its result (module constants, `useMemo` without a locale dependency).
  The language can change while the app runs; the shell re-renders the tree and
  every string is resolved again. Constant tables keep a `labelKey`, not a label.
- **One message per sentence.** Never glue translated fragments together — word
  order differs between languages. Use `{placeholders}`, and `trx()` when the
  sentence contains JSX.
- **Plurals** are `key_one` / `key_other` (CLDR categories) selected by a numeric
  `count` var. Put the whole phrase in the message (`"{count} songs"`), not just
  the noun. A locale supplies the categories its language has — Russian adds
  `key_few` / `key_many`, Chinese and Japanese only ever use `key_other` — and
  anything missing falls back to `key_other`.
- Keys are flat camelCase within a namespace file (dots allowed for small
  families looked up dynamically, e.g. `genre.tango`).
- Tango vocabulary — tanda, cortina, milonga, vals, orquesta — and anything
  stored in the database (tag labels, song metadata) is not translated.

## Adding a language

1. Copy `en/` to `<locale>/` and translate the values.
2. Add the locale to `LOCALES` in `entries/i18n.js` and to the main-process
   strings in `packages/main/src/i18n.ts` (native menu + file dialogs).
3. `pnpm run i18n:check` — verifies keys and placeholders match English and
   that every key used in code exists.
