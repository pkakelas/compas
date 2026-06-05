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
  loaded: false,
  importing: false,
  tree: [],
  songs: [],
  byId: {},
  totalSongs: 0,
  totalFolders: 0,
  roots: [],
  tandas: [],
  playlists: [],
  imported: false,
};
const _subs = new Set();
function _set(patch) {
  _state = { ..._state, ...patch };
  _subs.forEach((fn) => fn());
}
function _applyLibrary(lib) {
  const songs = (lib && lib.songs) || [];
  _set({
    loaded: true,
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
  // Opens the folder picker + scans. Returns the library, or null if cancelled.
  async importLibrary() {
    _set({ importing: true });
    try {
      const lib = await window.compas.importLibrary();
      if (lib) {
        _applyLibrary(lib);
        const [tandas, playlists] = await Promise.all([
          window.compas.listTandas(),
          window.compas.listPlaylists(),
        ]);
        _set({ tandas: tandas || [], playlists: playlists || [] });
      }
      return lib;
    } finally {
      _set({ importing: false });
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
  tandaTotal,
  fmtDur,
  secOf,
});
