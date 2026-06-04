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
pnpm run compile                    # build + package with electron-builder → /dist
pnpm run compile -- --dir           # package unpacked (faster, for debugging)
```

Config lives in `electron-builder.mjs`. App icons are in `buildResources/`.

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
