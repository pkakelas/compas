<p align="center">
  <img src="logo.svg" alt="Compás" width="96">
</p>

<h1 align="center">Compás</h1>

<p align="center">A desktop music player for tango DJs.</p>

---

Compás is the player you wanted when DJing milongas. It knows what a tanda and a
cortina are, helps you clean up the tags on a messy tango library, and lets you
build a night ahead of time and then run it live — with a headphone output for
previewing the next tanda while the floor keeps dancing.

It runs on macOS and Windows, with a Linux build (x64 deb and AppImage) in
beta. Your audio files are never moved, renamed or rewritten: everything Compás
learns about them lives in its own database.

## What it does

- **Library cleanup.** Matches your tracks against a catalogue of tango
  recordings and suggests the orquesta, singer, year and style. You review
  every change before it's applied, and nothing is written back to your files.
- **Tanda builder.** Put tandas together, tag them, filter them by orquesta,
  singer, decade or mood, and keep the ones that work.
- **Live player.** Queue tandas and cortinas for the night. Cortinas can play
  as a short snippet and fade out on their own, and Compás warns you if you've
  put two tandas back to back with no cortina between them. Silence at the
  start and end of old transfers is trimmed at playback, so the gaps inside a
  tanda stay tight.
- **Pre-listen.** Send a second output to your headphones to audition tandas
  without touching what's playing in the room.
- **Community.** Optionally share tandas (song details only — never audio),
  see which songs from other DJs' tandas you already own, and rebuild them
  from your own files.

The interface is available in English, Spanish, French, Italian, German, Greek,
Turkish, Russian, Chinese, Hindi and Japanese.

## Download

Grab the latest installer from the
[releases page](https://github.com/pkakelas/compas/releases/latest). Installed
copies check for updates on launch.

The macOS build isn't notarized yet, so macOS may refuse to open it the first
time. Right-click the app and choose **Open** to get past that.

On Ubuntu, Debian and their derivatives, install the `.deb`
(`sudo apt install ./Compas-*.deb`). On other distros, download the `.AppImage`,
make it executable (`chmod +x Compas-*.AppImage`) and run it; some need
`libfuse2` installed for AppImages to start.

## Building from source

You'll need Node 23 or newer and pnpm (`corepack enable` will set it up).

```bash
git clone https://github.com/pkakelas/compas.git
cd compas
pnpm install
pnpm start
```

`pnpm start` opens the app in development mode. Renderer changes reload the
window; changes to the main process or preload restart Electron.

To build installers for your own machine:

```bash
pnpm run compile       # everything configured for the current OS
pnpm run compile:mac   # macOS dmg/zip, arm64 + x64
pnpm run compile:win   # Windows installers, x64 + arm64
pnpm run compile:linux # Linux deb + AppImage, x64 — run it on Linux
pnpm run compile:dir   # unpacked app, quickest for debugging
```

Use those scripts rather than passing `--mac` or `--win` to `compile` — the
flag won't make it through to electron-builder. If you cross-build for Windows
on a Mac, run `pnpm run rebuild` before going back to `pnpm start`, otherwise
the native SQLite module will be built for the wrong platform. The Linux build
can't be cross-built that way: the bundled ffmpeg is the one for the machine
that ran `pnpm install`, so build it on Linux.

### Community backend

The Community features talk to a Supabase project. The development build points
at a staging project through `packages/main/.env.development`. If you leave
those values empty the app builds without Community and everything else works
as normal. Database migrations are in `supabase/migrations`.

## Project layout

It's a pnpm workspace based on the
[vite-electron-builder](https://github.com/cawa-93/vite-electron-builder)
template:

```
packages/
  main/        Electron main process — library, database, audio protocol, updates
  preload/     the bridge between main and the UI
  renderer/    the UI (React, built with Vite)
supabase/      Community backend migrations
tests/         end-to-end tests
```

A quirk worth knowing about the renderer: the UI started life as design
prototypes written as plain scripts that use a global `React` and attach their
components to `window`. That's still how it works. `entries/globals.js` sets up
the globals, `entries/main.jsx` loads the files in `js/` in order, and Vite
compiles them with the classic JSX runtime. There are no imports between those
files, so load order matters.

## Tests

The end-to-end tests drive the real, built Electron app with Playwright:

```bash
pnpm test:e2e
pnpm test:e2e:headed   # if you want to watch
```

See [tests/README.md](tests/README.md) for what each spec covers. Community
tests run against a local stub, never a real server.

## Translations

Every string in the UI lives in `packages/renderer/locales/<language>/`. English
is the source; other languages fall back to it for anything missing. If you'd
like to add or fix a language,
[packages/renderer/locales/README.md](packages/renderer/locales/README.md)
explains the conventions, and `pnpm run i18n:check` will tell you if anything
is missing or unused.

## Releasing

1. Bump `version` in `package.json`.
2. Tag and push:
   ```bash
   git tag v0.2.0
   git push origin main --tags
   ```

The [release workflow](.github/workflows/release.yml) builds the macOS,
Windows and Linux installers and publishes them to GitHub Releases along with the update
metadata the app checks against. A
[separate workflow](.github/workflows/store-package.yml) builds the Microsoft
Store package and submits it; the comments at the top of that file list the
secrets it needs. Store installs are updated by the Store, so the in-app updater
is switched off there.

## Contributing

Bug reports and pull requests are welcome. If you're planning something larger
than a fix, open an issue first so we can talk it through. If you DJ tango and
something in Compás doesn't match how you actually work, that's worth an issue
too.

## License

[MIT](LICENSE)
