// watcher.ts — keeps the library in sync with the filesystem. It watches every
// imported root and reacts to files being added, removed, renamed, or moved
// while the app is open, so the DJ never has to re-import after re-organizing a
// folder.
//
// Renames/moves surface from chokidar as an `unlink` of the old path plus an
// `add` of the new one. We don't act on either immediately: events are buffered
// for a short window and then reconciled, so an unlink+add pair for the same
// audio is recognised as a *move* and applied as an in-place path update. That
// preserves the song's id — and therefore its loudness analysis and any tanda /
// playlist membership — instead of dropping it and re-analyzing a fresh copy
// (which would needlessly show the "Preparing your music" banner).
import chokidar, {type FSWatcher} from 'chokidar';
import {existsSync} from 'node:fs';
import {stat} from 'node:fs/promises';
import {basename, sep} from 'node:path';
import {scanFile, isAudioFile, listAudioFiles} from './scan.js';
import {
  getLibrary,
  getSongMetaByPath,
  importSongs,
  listLibraryRoots,
  listSongPathsByRoot,
  removeSongByPath,
  renameSong,
  setSongMtimes,
  type Library,
  type ScannedSong,
} from '../modules/Database.js';

export type LibraryWatcherDeps = {
  /** Push the fresh library to the renderer(s) after a debounced batch of changes. */
  onLibraryChanged: (library: Library) => void;
  /** Genuinely new files were imported — kick the background analysis pass. */
  onSongsAdded: () => void;
};

// chokidar waits this long after a file stops changing before emitting add/change,
// so we never read a half-copied download. `unlink` fires immediately, though, so
// the reconcile window below must comfortably outlast this for rename pairing.
const WRITE_FINISH_MS = 700;
// How long to buffer filesystem events before reconciling them into library
// changes. Must exceed WRITE_FINISH_MS so the `add` half of a rename is in hand
// before we'd otherwise treat the `unlink` half as a plain deletion.
const RECONCILE_WINDOW_MS = 1200;
// Two files are considered "the same audio" (a move/rename) when their durations
// match within this many seconds. Both-unknown also counts.
const DURATION_TOLERANCE_SEC = 0.75;

function durationsMatch(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= DURATION_TOLERANCE_SEC;
}

function sameRoots(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

type PendingAdd = {root: string; song: ScannedSong};
type PendingUnlink = {path: string; durationSec: number | null};

/**
 * Refresh known songs whose files changed: their tags are updated in place (no
 * re-analysis), with one import per root so a large retag stays one batch. A
 * file whose tags couldn't be read keeps its row — and its old modification
 * time, so the next startup tries again — instead of being overwritten with
 * filename defaults. Returns how many songs were refreshed.
 */
function refreshInPlace(changed: PendingAdd[]): number {
  const byRoot = new Map<string, ScannedSong[]>();
  let refreshed = 0;
  for (const {root, song} of changed) {
    if (song.tagReadFailed) continue;
    const songs = byRoot.get(root);
    if (songs) songs.push(song);
    else byRoot.set(root, [song]);
    refreshed += 1;
  }
  for (const [root, songs] of byRoot) importSongs(root, songs);
  return refreshed;
}

export class LibraryWatcher {
  readonly #deps: LibraryWatcherDeps;
  #watcher: FSWatcher | null = null;
  #roots: string[] = [];
  #reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  // Buffered events, keyed by path so repeated events for one file coalesce.
  #adds = new Map<string, PendingAdd>();
  #unlinks = new Map<string, PendingUnlink>();
  // Serialize per-file work (reads/scans) so a burst can't race itself.
  #queue: Promise<void> = Promise.resolve();

  constructor(deps: LibraryWatcherDeps) {
    this.#deps = deps;
  }

  /** Begin watching the currently imported roots. */
  start(): void {
    this.sync();
  }

  /**
   * Re-attach watchers to the current set of imported roots. Call after an
   * import adds a root or after a clear/delete removes one. No-op if unchanged.
   */
  sync(): void {
    const next = [...listLibraryRoots()].sort();
    if (this.#watcher && sameRoots(next, this.#roots)) return;
    this.#roots = next;
    this.#dispose();
    if (next.length === 0) return;

    this.#watcher = chokidar.watch(next, {
      ignoreInitial: true,
      // Skip dotfiles/dotfolders to match the importer's scan.
      ignored: (p: string) => p.split(sep).some(seg => seg.length > 1 && seg.startsWith('.')),
      awaitWriteFinish: {stabilityThreshold: WRITE_FINISH_MS, pollInterval: 150},
    });

    this.#watcher
      .on('add', p => this.#enqueue(() => this.#onAddOrChange(p)))
      .on('change', p => this.#enqueue(() => this.#onAddOrChange(p)))
      .on('unlink', p => this.#enqueue(() => this.#onUnlink(p)));
  }

  stop(): void {
    if (this.#reconcileTimer) {
      clearTimeout(this.#reconcileTimer);
      this.#reconcileTimer = null;
    }
    this.#adds.clear();
    this.#unlinks.clear();
    this.#dispose();
    this.#roots = [];
  }

  /** The imported root that contains `file` (longest matching prefix), if any. */
  #rootFor(file: string): string | null {
    let best: string | null = null;
    for (const r of this.#roots) {
      const prefix = r.endsWith(sep) ? r : r + sep;
      if (file === r || file.startsWith(prefix)) {
        if (!best || r.length > best.length) best = r;
      }
    }
    return best;
  }

  async #onAddOrChange(file: string): Promise<void> {
    if (!isAudioFile(file)) return;
    const root = this.#rootFor(file);
    if (!root) return;
    const song = await scanFile(root, file);
    this.#adds.set(file, {root, song});
    this.#scheduleReconcile();
  }

  async #onUnlink(file: string): Promise<void> {
    if (!isAudioFile(file)) return;
    const meta = getSongMetaByPath(file);
    if (!meta) return; // not something we track
    this.#unlinks.set(file, {path: file, durationSec: meta.durationSec});
    this.#scheduleReconcile();
  }

  #enqueue(task: () => Promise<void>): void {
    // Swallow per-file errors (unreadable tags, races) so the chain keeps going.
    this.#queue = this.#queue.then(task).catch(() => {});
  }

  #scheduleReconcile(): void {
    if (this.#reconcileTimer) clearTimeout(this.#reconcileTimer);
    this.#reconcileTimer = setTimeout(() => {
      this.#reconcileTimer = null;
      this.#reconcile();
    }, RECONCILE_WINDOW_MS);
  }

  /**
   * Turn the buffered events into library changes in one batch: pair up moves
   * (preserving analysis + tandas), apply genuine adds and deletes, then push a
   * single refresh.
   */
  #reconcile(): void {
    const adds = [...this.#adds.values()];
    const unlinks = [...this.#unlinks.values()];
    this.#adds.clear();
    this.#unlinks.clear();
    if (adds.length === 0 && unlinks.length === 0) return;

    // A move's destination path is new to the DB; an in-place edit ('change')
    // targets a path we already know. Only new paths can be the new end of a
    // rename — which conveniently excludes plain content edits and re-imports.
    const newAdds: PendingAdd[] = [];
    const existingAdds: PendingAdd[] = [];
    for (const a of adds) {
      if (getSongMetaByPath(a.song.path)) existingAdds.push(a);
      else newAdds.push(a);
    }

    // Re-scanned existing files: refresh their tags in place (no re-analysis).
    refreshInPlace(existingAdds);

    const genuinelyAdded = this.#applyMovesAddsRemovals(newAdds, [...unlinks]);

    if (genuinelyAdded > 0) this.#deps.onSongsAdded();
    this.#deps.onLibraryChanged(getLibrary());
  }

  /**
   * One-shot reconcile of every imported root against what's actually on disk.
   * The live watcher only sees events that fire while it's running, so changes
   * made while the app was *closed* — songs dropped in, deleted, moved, or
   * retagged in another app — would otherwise be invisible until a manual
   * re-import. Run this at startup to catch them. Like the live path, an
   * old-path-gone + new-path-appeared pair for the same audio is recognised as
   * a move and applied in place, preserving the song's id (and thus its
   * analysis + tanda membership). A known file whose modification time differs
   * from the one stored at its last tag read is re-read through the normal
   * import path, so the DJ's locks (Compás-only edits, Smart Organize) still
   * apply. Only the file's date is checked per file; tags are parsed just for
   * the changed ones. Returns the fresh library; safe to call before/after
   * start().
   */
  async reconcileRoots(): Promise<Library> {
    const newAdds: PendingAdd[] = [];
    const changed: PendingAdd[] = [];
    const available: PendingUnlink[] = [];
    // Songs scanned before modification times were recorded: take today's as
    // the baseline (without re-reading tags) so the next startup can compare.
    const baseline: {path: string; mtimeMs: number}[] = [];
    for (const root of listLibraryRoots()) {
      // A root that's gone entirely (moved/unmounted) would make every song
      // under it look deleted. Leave those intact for relink (see relocateRoot)
      // instead of pairing/dropping them here.
      if (!existsSync(root)) continue;
      const known = new Map(listSongPathsByRoot(root).map(s => [s.path, s]));
      const onDisk = new Set<string>();
      for (const file of await listAudioFiles(root)) {
        onDisk.add(file);
        const k = known.get(file);
        if (!k) {
          newAdds.push({root, song: await scanFile(root, file)});
          continue;
        }
        let mtimeMs: number;
        try {
          mtimeMs = Math.round((await stat(file)).mtimeMs);
        } catch {
          continue; // vanished mid-walk; the live watcher will report it
        }
        if (k.mtimeMs == null) baseline.push({path: file, mtimeMs});
        else if (k.mtimeMs !== mtimeMs) changed.push({root, song: await scanFile(root, file)});
      }
      for (const [path, {durationSec}] of known) {
        if (!onDisk.has(path)) available.push({path, durationSec});
      }
    }
    setSongMtimes(baseline);
    // Edited while closed: refresh their tags in place (no re-analysis), the
    // same way the live watcher handles an in-place change.
    const refreshed = refreshInPlace(changed);
    if (newAdds.length === 0 && available.length === 0) {
      return refreshed > 0 ? this.#refresh() : getLibrary();
    }

    const genuinelyAdded = this.#applyMovesAddsRemovals(newAdds, available);
    if (genuinelyAdded > 0) this.#deps.onSongsAdded();
    return this.#refresh();
  }

  #refresh(): Library {
    const library = getLibrary();
    this.#deps.onLibraryChanged(library);
    return library;
  }

  /**
   * Apply a batch of new files and now-missing paths: pair moves first (matching
   * an add to a missing path by duration so its id survives — see file header),
   * import the genuinely new, then drop whatever missing path is left as a real
   * deletion. `available` is mutated as moves consume entries. Returns the count
   * of genuinely-new imports so the caller can kick off analysis.
   */
  #applyMovesAddsRemovals(newAdds: PendingAdd[], available: PendingUnlink[]): number {
    let genuinelyAdded = 0;
    for (const add of newAdds) {
      const idx = this.#bestMoveMatch(add, available);
      if (idx >= 0) {
        const moved = available.splice(idx, 1)[0];
        renameSong(moved.path, add.root, add.song);
      } else {
        importSongs(add.root, [add.song]);
        genuinelyAdded += 1;
      }
    }
    // Whatever's left really was deleted.
    for (const u of available) removeSongByPath(u.path);
    return genuinelyAdded;
  }

  /**
   * Pick the best unlink to pair `add` with as a move: a matching duration is
   * required, and a matching filename is preferred so a folder move with several
   * equal-length songs still maps each old path to the right new one.
   */
  #bestMoveMatch(add: PendingAdd, candidates: PendingUnlink[]): number {
    const addName = basename(add.song.path);
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (!durationsMatch(c.durationSec, add.song.durationSec)) continue;
      const score = basename(c.path) === addName ? 2 : 1;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  #dispose(): void {
    if (this.#watcher) {
      void this.#watcher.close();
      this.#watcher = null;
    }
  }
}
