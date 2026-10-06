# E2E tests (Playwright + Electron)

These tests launch the **real, built** Electron app via Playwright's
`_electron` driver — the actual main process, preload bridge, SQLite database,
`compas-audio://` protocol, and Howler audio engine. This covers the paths a
bare-browser tool (e.g. `/qa-only` against the Vite dev server) structurally
cannot reach.

## Run

```bash
pnpm test:e2e          # builds the app first (pretest:e2e), then runs headless
pnpm test:e2e:headed   # watch the window while tests run
```

Build is required because tests load the renderer from `packages/renderer/dist`
(production path), not the Vite dev server.

## What's covered

- **smoke.spec.ts** — app launches, window visible, title correct, preload
  bridge present, all six nav views render, no uncaught JS errors.
- **import.spec.ts** — stubs the native folder dialog, feeds a generated WAV
  fixture library, drives the import-review modal, and asserts the library
  populates through the real IPC → `scanFolder` → SQLite path.
- **import-genre-tag.spec.ts** — imports FLACs carrying genre tags from a
  folder with no style in its name and asserts each song takes its tag's style;
  then rewinds the database to a pre-fix import and asserts the launch backfill
  repairs it.
- **playback.spec.ts** — builds a tanda from imported tracks, queues it in Live,
  hits play, and asserts Howler actually reports a playing sound.
- **community.spec.ts** — Community accounts against a local stub backend
  (`helpers/community-stub.ts`): sign in, edit the profile, restart with the
  session intact (and not stored in clear), sign up with an emailed code, sign
  out, delete the account. Google sign-in is not covered. Every other spec runs
  with Community switched off, so no test talks to a real server.
- **community-feed.spec.ts** — sharing and the feed against the same stub, with
  a real imported library: a tanda is shared (and only song details leave the
  app), other DJs' tandas are matched against the library (ready / missing
  songs), then play, like, comment, reply, ask a question, save, report, block
  and unshare.

## How it stays isolated

Each launched app gets a throwaway `--user-data-dir` (`helpers/app.ts`), so:

- the test SQLite library never touches your real `compas.db`, and
- Electron's single-instance lock doesn't collide with a running dev instance —
  you can run the suite while `pnpm start` is open.

## Fixtures

`helpers/wav.ts` writes tiny valid PCM WAV files (no ffmpeg needed) into
style-named folders (`Di Sarli - Tango`, `Biagi - Vals`) so the importer's
folder-name genre heuristic has something realistic to classify.

## Driving the native dialog

The folder picker uses `dialog.showOpenDialog`, which Playwright can't click.
`stubFolderDialog()` overrides it in the main process via `app.evaluate(...)` to
return a fixture path. Call it before triggering the picker.
