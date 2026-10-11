// tandas-data.jsx — the live data layer. Songs and tandas come from the SQLite
// database in the main process (via window.compas / IPC); this file holds a
// tiny reactive store so the design components can read library + tandas and
// re-render when an import or edit changes them. No song data is hardcoded.

/* ---------- duration helpers ---------- */
function secOf(d) {
  if (!d || typeof d !== "string") return 0;
  const parts = d.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}
function fmtDur(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(s / 60);
  return m + ":" + String(s % 60).padStart(2, "0");
}
function tandaTotal(songs) {
  return fmtDur((songs || []).reduce((a, s) => a + secOf(s.dur), 0));
}

/* ---------- count songs under a tree node ---------- */
function countSongs(node) {
  let n = node && node.songs ? node.songs.length : 0;
  if (node && node.children) node.children.forEach((c) => (n += countSongs(c)));
  return n;
}

/* ---------- collect every song id under a tree node (folder + subfolders) ---------- */
function collectSongIds(node) {
  let ids = node && node.songs ? node.songs.map((s) => s.id) : [];
  if (node && node.children) node.children.forEach((c) => { ids = ids.concat(collectSongIds(c)); });
  return ids;
}

/* ---------- reactive store ---------- */
let _state = {
  tree: [],
  songs: [],
  byId: {},
  totalSongs: 0,
  totalFolders: 0,
  roots: [],
  tandas: [],
  // A pending playlist import (the preview awaiting confirmation). Lives here,
  // not in a view, because a folder import started from a playlist file can
  // unmount the screen that began it (the first-run screen goes away once songs
  // land); the app shell renders the confirmation modal from this.
  playlistImport: null,
  // Curated tandas the DJ fully owns, matched against their library in the main
  // process. Virtual (not in the DB): they seed the otherwise-empty Tandas page
  // and can be saved (kept) or dismissed. Recomputed whenever the library or the
  // saved tandas change (see _set below).
  suggestions: [],
  playlists: [],
  imported: false,
  // Background loudness/silence analysis progress (drives the "still processing"
  // banner). running=false hides it.
  analysis: { running: false, total: 0, completed: 0, failed: 0 },
};
const _subs = new Set();

/* ---------- suggested tandas (virtual, library-derived) ---------- */
const DISMISS_KEY = "compas.dismissedSuggestions";
function _dismissedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]")); }
  catch (_e) { return new Set(); }
}
// Coalesce the bursty library+tandas updates (e.g. _applyLibrary then a tandas
// _set) into a single suggestion fetch on the next microtask.
let _suggestPending = false;
function _scheduleSuggest() {
  if (_suggestPending) return;
  if (!window.compas || !window.compas.suggestTandas) return;
  _suggestPending = true;
  Promise.resolve().then(async () => {
    _suggestPending = false;
    try {
      const list = await window.compas.suggestTandas();
      const dismissed = _dismissedSet();
      _set({ suggestions: (list || []).filter((s) => !dismissed.has(s.refId)) });
    } catch (_e) { /* older main without the handler — leave suggestions empty */ }
  });
}

function _set(patch) {
  _state = { ..._state, ...patch };
  _subs.forEach((fn) => fn());
  // Suggestions depend on the library (songs) and the saved tandas (for dedup);
  // refresh them whenever either changes, but never recurse on our own update.
  if (("songs" in patch || "tandas" in patch) && !("suggestions" in patch)) _scheduleSuggest();
}
function _applyLibrary(lib) {
  const songs = (lib && lib.songs) || [];
  _set({
    tree: (lib && lib.tree) || [],
    songs,
    byId: Object.fromEntries(songs.map((s) => [s.id, s])),
    totalSongs: (lib && lib.totalSongs) || 0,
    totalFolders: (lib && lib.totalFolders) || 0,
    roots: (lib && lib.roots) || [],
    imported: songs.length > 0,
  });
}

const Store = {
  get: () => _state,
  subscribe(fn) {
    _subs.add(fn);
    return () => _subs.delete(fn);
  },
  async loadAll() {
    // Reconcile the library with the filesystem first, so the tree (and the
    // tandas/playlists we read next) reflect what's really on disk — this picks
    // up songs added, removed, or moved while the app was closed. Degrade
    // gracefully on an older main: reconcile → prune (removes vanished only) →
    // a plain read.
    let library = null;
    try {
      if (window.compas.reconcile) {
        const res = await window.compas.reconcile();
        library = res && res.library;
      } else if (window.compas.pruneMissing) {
        const pruned = await window.compas.pruneMissing();
        library = pruned && pruned.library;
      }
    } catch (e) { /* older main without the handler — fall through to getLibrary */ }
    if (!library) library = await window.compas.getLibrary();
    _applyLibrary(library);
    const [tandas, playlists] = await Promise.all([
      window.compas.listTandas(),
      window.compas.listPlaylists(),
    ]);
    _set({ tandas: tandas || [], playlists: playlists || [] });
  },
  // Reactive cleanup: drop a song only if its file is truly gone (used when
  // playback fails). Refreshes library + tandas/playlists. Returns the result.
  async removeSongIfMissing(id) {
    if (!window.compas.removeSongIfMissing) return { removed: false, song: null };
    let res;
    try {
      res = await window.compas.removeSongIfMissing(id);
    } catch (e) {
      return { removed: false, song: null };
    }
    if (res && res.removed && res.library) {
      _applyLibrary(res.library);
      const [tandas, playlists] = await Promise.all([
        window.compas.listTandas(),
        window.compas.listPlaylists(),
      ]);
      _set({ tandas: tandas || [], playlists: playlists || [] });
    }
    return res;
  },
  // Remove a whole folder (and its subfolders) from the library. Only forgets
  // the songs in the app — the files stay on disk. Refreshes library + tandas/
  // playlists since deleting songs can empty out tandas that referenced them.
  async deleteFolder(node) {
    return Store.deleteSongs(collectSongIds(node));
  },
  // Forget specific songs from the library (files stay on disk). Refreshes the
  // library + tandas/playlists since deleting songs can empty out tandas that
  // referenced them.
  async deleteSongs(ids) {
    if (!ids || !ids.length || !window.compas.deleteSongs) return;
    const library = await window.compas.deleteSongs(ids);
    if (library) _applyLibrary(library);
    const [tandas, playlists] = await Promise.all([
      window.compas.listTandas(),
      window.compas.listPlaylists(),
    ]);
    _set({ tandas: tandas || [], playlists: playlists || [] });
  },
  // Edit a single song's metadata. The main process updates the database (and,
  // with input.writeFile, the file's tags too), then returns the fresh library;
  // we re-apply it and refresh tandas/playlists since they embed copies of the
  // song. Returns {song, fileError} — song is null if the id was unknown;
  // fileError ('missing' | 'readonly' | 'other') says why the file could not
  // be updated even though the edit was kept in Compás.
  async updateSong(input) {
    if (!window.compas.updateSong) return null;
    const res = await window.compas.updateSong(input);
    if (res && res.library) {
      _applyLibrary(res.library);
      const [tandas, playlists] = await Promise.all([
        window.compas.listTandas(),
        window.compas.listPlaylists(),
      ]);
      _set({ tandas: tandas || [], playlists: playlists || [] });
    }
    return res ? { song: res.song, fileError: res.fileError || null } : null;
  },
  // Flag/unflag songs as cortinas (usage flag, independent of genre). Refreshes
  // the library + tandas/playlists (embedded song copies carry the flag).
  async setSongCortina(ids, isCortina) {
    if (!window.compas.setSongCortina || !ids || !ids.length) return;
    const library = await window.compas.setSongCortina(ids, !!isCortina);
    if (library) _applyLibrary(library);
    const [tandas, playlists] = await Promise.all([
      window.compas.listTandas(),
      window.compas.listPlaylists(),
    ]);
    _set({ tandas: tandas || [], playlists: playlists || [] });
  },
  // Flag/unflag every song under a library folder (and its subfolders) as
  // cortinas. Uses the per-song flag so nested folders are covered too.
  async setFolderCortina(node, isCortina) {
    if (!window.compas.setSongCortina || !node) return;
    const ids = collectSongIds(node);
    if (!ids.length) return;
    const library = await window.compas.setSongCortina(ids, !!isCortina);
    if (library) _applyLibrary(library);
    const [tandas, playlists] = await Promise.all([
      window.compas.listTandas(),
      window.compas.listPlaylists(),
    ]);
    _set({ tandas: tandas || [], playlists: playlists || [] });
  },
  // Smart Organize: ask the main process for proposed metadata changes across
  // the whole library (pure preview — nothing is written yet). Returns
  // { proposals, summary }.
  async previewSmartOrganize() {
    if (!window.compas.previewSmartOrganize) {
      return { proposals: [], summary: { total: 0, confirmed: 0, suggested: 0, review: 0 } };
    }
    return await window.compas.previewSmartOrganize();
  },
  // Apply the DJ-approved subset of Smart Organize changes (also used by the
  // bulk right-click edits). Honors the "also save to the music files" setting:
  // the main process updates the database and, when on, each song's file. It
  // returns the fresh library; re-apply it and refresh tandas/playlists since
  // they embed copies of the songs. Resolves to {writeFile, filesUpdated,
  // fileErrors} so the caller can say where the changes went.
  async applySmartOrganize(changes) {
    if (!window.compas.applySmartOrganize || !changes || !changes.length) return null;
    let writeFile = false;
    try { writeFile = localStorage.getItem("compas.writeTagsToFiles") === "1"; } catch (e) { /* ignore */ }
    const res = await window.compas.applySmartOrganize(changes, { writeFile });
    if (res && res.library) _applyLibrary(res.library);
    const [tandas, playlists] = await Promise.all([
      window.compas.listTandas(),
      window.compas.listPlaylists(),
    ]);
    _set({ tandas: tandas || [], playlists: playlists || [] });
    return { writeFile, filesUpdated: (res && res.filesUpdated) || 0, fileErrors: (res && res.fileErrors) || 0 };
  },
  // Detailed import — step 1: pick a folder and scan it for preview (nothing is
  // saved). Returns the folder tree, or null if cancelled.
  // `source` is a path (a dropped folder / song / playlist file — the picker is
  // skipped), "playlist" (open the playlist picker) or nothing (folder picker).
  async previewImport(source) {
    if (!window.compas.importScanPreview) return null;
    if (source === "playlist") return await window.compas.importScanPreview("playlist");
    if (source && window.compas.importScanPreviewPath) return await window.compas.importScanPreviewPath(source);
    return await window.compas.importScanPreview();
  },
  // Detailed import — step 2: commit with a per-folder style map and cortina-flag
  // map. Refreshes the library + tandas/playlists.
  async commitImport(types, cortinas) {
    if (!window.compas.importCommit) return null;
    const library = await window.compas.importCommit(types || {}, cortinas || {});
    if (library) {
      _applyLibrary(library);
      const [tandas, playlists] = await Promise.all([
        window.compas.listTandas(),
        window.compas.listPlaylists(),
      ]);
      _set({ tandas: tandas || [], playlists: playlists || [] });
    }
    return library;
  },
  async cancelImport() {
    if (window.compas.importCancel) { try { await window.compas.importCancel(); } catch (_e) { /* ignore */ } }
  },
  // Re-type existing songs: set genres for many songs at once. Honors the
  // "also save to the music files" setting like applySmartOrganize; resolves to
  // {writeFile, filesUpdated, fileErrors}.
  async setSongGenres(updates) {
    if (!window.compas.setSongGenres || !updates || !updates.length) return null;
    let writeFile = false;
    try { writeFile = localStorage.getItem("compas.writeTagsToFiles") === "1"; } catch (e) { /* ignore */ }
    const res = await window.compas.setSongGenres(updates, { writeFile });
    if (res && res.library) {
      _applyLibrary(res.library);
      const [tandas, playlists] = await Promise.all([
        window.compas.listTandas(),
        window.compas.listPlaylists(),
      ]);
      _set({ tandas: tandas || [], playlists: playlists || [] });
    }
    return { writeFile, filesUpdated: (res && res.filesUpdated) || 0, fileErrors: (res && res.fileErrors) || 0 };
  },
  async clearLibrary() {
    const lib = await window.compas.clearLibrary();
    _applyLibrary(lib);
    const [tandas, playlists] = await Promise.all([
      window.compas.listTandas(),
      window.compas.listPlaylists(),
    ]);
    _set({ tandas: tandas || [], playlists: playlists || [] });
  },
  async saveTanda(input) {
    const saved = await window.compas.saveTanda(input);
    const [tandas, playlists] = await Promise.all([
      window.compas.listTandas(),
      window.compas.listPlaylists(),
    ]);
    _set({ tandas: tandas || [], playlists: playlists || [] });
    return saved;
  },
  // Keep a tanda that came in with an imported playlist in "My tandas".
  async keepTanda(id) {
    await window.compas.keepTanda(id);
    const [tandas, playlists] = await Promise.all([
      window.compas.listTandas(),
      window.compas.listPlaylists(),
    ]);
    _set({ tandas: tandas || [], playlists: playlists || [] });
  },
  async deleteTanda(id) {
    await window.compas.deleteTanda(id);
    // Deleting a tanda can change playlists that referenced it — refresh both.
    const [tandas, playlists] = await Promise.all([
      window.compas.listTandas(),
      window.compas.listPlaylists(),
    ]);
    _set({ tandas: tandas || [], playlists: playlists || [] });
  },
  // Re-read the tandas (e.g. another Community account signed in, and with it
  // a different set of "Shared" markers).
  async reloadTandas() {
    _set({ tandas: (await window.compas.listTandas()) || [] });
  },
  // Optimistic local replacement used by the undo flow (no DB round-trip).
  setTandasLocal(tandas) {
    _set({ tandas });
  },
  // Hide a suggested tanda for good (persisted), so it won't reappear on the
  // next match. Suggestions are virtual, so this never touches the database.
  dismissSuggestion(refId) {
    if (!refId) return;
    const set = _dismissedSet();
    set.add(refId);
    try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...set])); } catch (_e) { /* ignore */ }
    _set({ suggestions: (_state.suggestions || []).filter((s) => s.refId !== refId) });
  },
  // Keep a suggestion: save it as a real tanda. The follow-up refresh dedupes it
  // out of the suggestions list automatically.
  async keepSuggestion(t) {
    if (!t || !t.songs || !t.songs.length) return null;
    return await this.saveTanda({
      name: t.name || null,
      songIds: t.songs.map((s) => s.id),
      tags: (t.tags || []).slice(),
    });
  },
  async savePlaylist(input) {
    const saved = await window.compas.savePlaylist(input);
    _set({ playlists: (await window.compas.listPlaylists()) || [] });
    return saved;
  },
  async deletePlaylist(id) {
    await window.compas.deletePlaylist(id);
    _set({ playlists: (await window.compas.listPlaylists()) || [] });
  },
  setPlaylistsLocal(playlists) {
    _set({ playlists });
  },
  // Resolve a playlist file against the (now imported) library and hold its
  // preview for the app-shell modal. Returns the preview, or null.
  async beginPlaylistImport(path) {
    if (!path || !window.compas.importPlaylistPreviewPath) return null;
    let preview = null;
    try { preview = await window.compas.importPlaylistPreviewPath(path); } catch (_e) { preview = null; }
    _set({ playlistImport: preview || null });
    return preview;
  },
  cancelPlaylistImport() {
    _set({ playlistImport: null });
    if (window.compas.importPlaylistCancel) { try { window.compas.importPlaylistCancel(); } catch (_e) { /* ignore */ } }
  },
  // Commit a previewed M3U import. It may create tandas as well as the
  // playlist, so refresh both. Returns the new playlist (or null).
  async importPlaylistCommit(name) {
    const saved = await window.compas.importPlaylistCommit(name);
    _set({ playlistImport: null });
    const [tandas, playlists] = await Promise.all([
      window.compas.listTandas(),
      window.compas.listPlaylists(),
    ]);
    _set({ tandas: tandas || [], playlists: playlists || [] });
    return saved;
  },
  songById(id) {
    return _state.byId[id];
  },
  // Wire up the background-analysis banner: fetch the current state once, then
  // keep it live from the main process's progress broadcasts. Safe to call more
  // than once — it only subscribes a single time.
  async initAnalysis() {
    if (this._analysisWired) return;
    this._analysisWired = true;
    if (!window.compas.onAnalysisProgress) return;
    try {
      window.compas.onAnalysisProgress((state) => {
        if (state) _set({ analysis: state });
      });
    } catch (_e) { /* older main without the channel */ }
    try {
      if (window.compas.analysisState) {
        const s = await window.compas.analysisState();
        if (s) _set({ analysis: s });
      }
    } catch (_e) { /* ignore */ }
  },
  // Keep the library live with the filesystem: the main process watches every
  // imported folder and pushes a fresh library whenever songs are added,
  // removed, or renamed on disk. Safe to call more than once. A removed song
  // can empty a tanda/playlist, so refresh those alongside the tree.
  initLibraryWatch() {
    if (this._libraryWired) return;
    this._libraryWired = true;
    if (!window.compas.onLibraryChanged) return;
    try {
      window.compas.onLibraryChanged(async (library) => {
        if (!library) return;
        _applyLibrary(library);
        try {
          const [tandas, playlists] = await Promise.all([
            window.compas.listTandas(),
            window.compas.listPlaylists(),
          ]);
          _set({ tandas: tandas || [], playlists: playlists || [] });
        } catch (_e) { /* ignore */ }
      });
    } catch (_e) { /* older main without the channel */ }
  },
};

function useStore() {
  const [, force] = React.useState(0);
  React.useEffect(() => Store.subscribe(() => force((n) => n + 1)), []);
  return Store.get();
}

Object.assign(window, {
  Store,
  useStore,
  countSongs,
  collectSongIds,
  tandaTotal,
  fmtDur,
  secOf,
});
