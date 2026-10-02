# Compás — Tango DJ Player

A desktop app (Electron) for DJing a milonga: a live tango player and a
tanda-builder workspace. Built on the
[vite-electron-builder](https://github.com/cawa-93/vite-electron-builder)
template — a secure, Vite-based Electron monorepo.

The UI is React. The original design prototypes were authored as classic
scripts that read a global `React` and publish their components onto `window`;
that contract is preserved (see `packages/renderer/entries/globals.js`), so the
design files in `packages/renderer/js/` are bundled unchanged.

Uses **pnpm** workspaces.

## Quick start

```bash
pnpm install     # installs all workspaces
pnpm start       # dev mode with hot reload
```

`pnpm start` runs `packages/dev-mode.js`, which:

- starts a Vite dev server for the renderer,
- builds `packages/preload` and `packages/main` in watch mode,
- launches Electron and **reloads the window** on renderer changes and
  **restarts Electron** on main/preload changes.

## Build & distribute

```bash
pnpm run build                      # build all workspaces (no packaging)
pnpm run compile                    # package for the current OS (all configured targets)
pnpm run compile:mac                # macOS only: arm64 + x64 dmg/zip
pnpm run compile:win                # Windows only: x64 + arm64 NSIS installers
                                    # (on macOS, run `pnpm run rebuild` afterward before `pnpm start`)
pnpm run compile:dir                # unpacked app dir (faster, for debugging)
```

Platform flags must use the scripts above — `pnpm run compile -- --mac` does not
reach electron-builder because the `compile` script chains commands with `&&`.

Config lives in `electron-builder.mjs`. App icons are in `buildResources/`.

### Releases (GitHub Actions → website downloads)

Binaries are built in CI and published to **GitHub Releases**. The Vercel
marketing site should link there — Vercel is great for the site, but large
`.dmg` / `.exe` files belong on GitHub’s release CDN.

**Ship a version**

1. Bump `version` in `package.json` (e.g. `0.1.0` → `0.2.0`).
2. Commit, tag, and push:
   ```bash
   git tag v0.2.0
   git push origin main --tags
   ```
3. The [Release workflow](.github/workflows/release.yml) runs on macOS and
   Windows, uploads installers, and writes update metadata for the in-app
   auto-updater.

**Artifacts** (ASCII names for stable URLs):

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `Compas-{version}-mac-arm64.dmg` |
| macOS (Intel) | `Compas-{version}-mac-x64.dmg` |
| Windows (Intel/AMD) | `Compas-{version}-win-x64.exe` |
| Windows (ARM) | `Compas-{version}-win-arm64.exe` |

**Microsoft Store packages** are built separately, by running the
[Store package workflow](.github/workflows/store-package.yml) by hand. It
attaches `Compas-{version}-win-x64.appx` and `Compas-{version}-win-arm64.appx`
to the workflow run; upload both to the submission in Partner Center. It needs
the repo variables `APPX_IDENTITY_NAME`, `APPX_PUBLISHER` and
`APPX_PUBLISHER_DISPLAY_NAME` (values from Partner Center → Product identity),
plus `APPX_DISPLAY_NAME` if the reserved app name is not "Compás". A Store
install is updated by the Store, so the in-app updater is off there.

**Download links on Vercel** — point buttons at GitHub:

```html
<a href="https://github.com/pkakelas/compas/releases/latest/download/Compas-0.2.0-mac-arm64.dmg">
  Download for Mac (Apple Silicon)
</a>
<a href="https://github.com/pkakelas/compas/releases/latest/download/Compas-0.2.0-mac-x64.dmg">
  Download for Mac (Intel)
</a>
<a href="https://github.com/pkakelas/compas/releases/latest/download/Compas-0.2.0-win-x64.exe">
  Download for Windows
</a>
```

`releases/latest/download/…` always serves the newest tag, but the filename
still includes the version. For a version-agnostic redirect, add a small
Vercel API route that calls the
[GitHub Releases API](https://docs.github.com/en/rest/releases/releases) and
`302` redirects to the matching asset.

Installed apps check GitHub Releases on launch (`electron-updater`) and prompt
to update when a newer tag exists.

> macOS signing note: the app is packaged **unsigned / ad-hoc** (no Apple
> Developer ID). Recent macOS may refuse to launch an ad-hoc-signed bundle. For
> real distribution, add a Developer ID certificate and enable notarization.
> Development (`pnpm start`) is unaffected.

## Project structure

```
.
├─ package.json            # root workspace: scripts + electron-builder devdeps
├─ pnpm-workspace.yaml     # workspace globs + allowed build scripts
├─ .npmrc                  # hoisted node-linker + workspace linking
├─ electron-builder.mjs    # packaging config (appId, targets)
├─ buildResources/         # app icons for electron-builder
├─ types/                  # ambient TS types (import.meta.env, etc.)
├─ packages/
│  ├─ entry-point.mjs      # production entry: wires renderer + preload into main
│  ├─ dev-mode.js          # dev orchestrator (renderer server + watch builds)
│  ├─ main/                # Electron main process (TS, modular)
│  ├─ preload/             # preload scripts (contextBridge auto-expose)
│  ├─ electron-versions/   # helper to read bundled Chrome/Node versions
│  └─ renderer/            # the UI — a standalone Vite app (@app/renderer)
│     ├─ index.html        # the app
│     ├─ styles.css        # design system styles
│     ├─ vite.config.js    # classic JSX runtime
│     ├─ entries/          # globals (React→window) + main entry module
│     └─ js/               # the design source (*.jsx), bundled as-is
└─ screenshots/            # reference renders
```

## How the renderer is wired

- `packages/renderer` is a plain Vite app. `vite.config.js` uses
  `@vitejs/plugin-react` with the **classic** JSX runtime so JSX compiles to
  `React.createElement` against the global `React` — matching the original
  design files, which have no `import`/`export`.
- `entries/globals.js` sets `window.React` / `window.ReactDOM` before the design
  modules load; `entries/main.jsx` then imports the design files in order, each
  of which attaches its components to `window`. `app-shell.jsx` mounts the app
  into `#root`.
- In dev the main process loads the Vite dev-server URL; in production it loads
  the built `dist/index.html` (resolved via the `@app/renderer` package
  `exports`).

### Using native APIs later

This template exposes anything you `export` from `packages/preload` to the
renderer via `contextBridge` automatically (see the template docs). Add
Node-powered features (reading audio folders, persisting state) in the preload
package and import them from the renderer.
