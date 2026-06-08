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
  playlists: [],
  imported: false,
  // Background loudness/silence analysis progress (drives the "still processing"
  // banner). running=false hides it.
  analysis: { running: false, total: 0, completed: 0, failed: 0 },
};
const _subs = new Set();
function _set(patch) {
  _state = { ..._state, ...patch };
  _subs.forEach((fn) => fn());
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
    // Prune songs whose files vanished while the app was closed first, so the
    // tree (and the tandas/playlists we read next) reflect what's really there.
    // Fall back to a plain read if the main process predates the prune handler.
    let library = null;
    try {
      if (window.compas.pruneMissing) {
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
    const ids = collectSongIds(node);
    if (!ids.length || !window.compas.deleteSongs) return;
    const library = await window.compas.deleteSongs(ids);
    if (library) _applyLibrary(library);
    const [tandas, playlists] = await Promise.all([
      window.compas.listTandas(),
      window.compas.listPlaylists(),
    ]);
    _set({ tandas: tandas || [], playlists: playlists || [] });
  },
  // Edit a single song's metadata. The main process writes the file's tags and
  // the database, then returns the fresh library; we re-apply it and refresh
  // tandas/playlists since they embed copies of the song. Returns the updated
  // song (or null if the id was unknown / the write failed).
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
    return res ? res.song : null;
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
  // Apply the DJ-approved subset of Smart Organize changes (Compás-only). The
  // main process returns the fresh library; re-apply it and refresh tandas/
  // playlists since they embed copies of the songs.
  async applySmartOrganize(changes) {
    if (!window.compas.applySmartOrganize || !changes || !changes.length) return;
    const library = await window.compas.applySmartOrganize(changes);
    if (library) _applyLibrary(library);
    const [tandas, playlists] = await Promise.all([
      window.compas.listTandas(),
      window.compas.listPlaylists(),
    ]);
    _set({ tandas: tandas || [], playlists: playlists || [] });
  },
  // Detailed import — step 1: pick a folder and scan it for preview (nothing is
  // saved). Returns the folder tree, or null if cancelled.
  async previewImport() {
    if (!window.compas.importScanPreview) return null;
    return await window.compas.importScanPreview();
  },
  // Detailed import — step 2: commit with a per-folder style map. Refreshes the
  // library + tandas/playlists.
  async commitImport(types) {
    if (!window.compas.importCommit) return null;
    const library = await window.compas.importCommit(types || {});
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
  // Re-type existing songs: set styles for many songs at once (Compás-only).
  async setSongGenres(updates) {
    if (!window.compas.setSongGenres || !updates || !updates.length) return;
    const library = await window.compas.setSongGenres(updates);
    if (library) {
      _applyLibrary(library);
      const [tandas, playlists] = await Promise.all([
        window.compas.listTandas(),
        window.compas.listPlaylists(),
      ]);
      _set({ tandas: tandas || [], playlists: playlists || [] });
    }
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
  async deleteTanda(id) {
    await window.compas.deleteTanda(id);
    // Deleting a tanda can change playlists that referenced it — refresh both.
    const [tandas, playlists] = await Promise.all([
      window.compas.listTandas(),
      window.compas.listPlaylists(),
    ]);
    _set({ tandas: tandas || [], playlists: playlists || [] });
  },
  // Optimistic local replacement used by the undo flow (no DB round-trip).
  setTandasLocal(tandas) {
    _set({ tandas });
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
