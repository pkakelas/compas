import {ipcRenderer, webFrame} from 'electron';

// Apply the saved text size as early as possible — native page zoom rescales the
// layout viewport, so the app's fixed-height layout still fills the window at any
// size (unlike CSS zoom). Done here in the preload so it's in effect before the
// renderer paints, with no flash from 100% to the chosen size on launch.
try {
  const saved = parseInt(window.localStorage.getItem('compas.fontScale') || '', 10);
  if (!isNaN(saved)) webFrame.setZoomFactor(Math.max(70, Math.min(150, saved)) / 100);
} catch {
  /* localStorage unavailable — fall back to the default 100%. */
}

/** Set the app's text size (whole-page zoom). `factor` is a multiplier, e.g. 1.1. */
function setTextZoom(factor: number) {
  webFrame.setZoomFactor(factor);
}

/** Read the current library (folder tree + flat songs) from the database. */
function getLibrary() {
  return ipcRenderer.invoke('library:get');
}

/** Wipe all imported songs and library roots (leaves tandas that still have songs). */
function clearLibrary() {
  return ipcRenderer.invoke('library:clear');
}

/** Remove songs whose files no longer exist. Returns {removed, library}. */
function pruneMissingLibrary() {
  return ipcRenderer.invoke('library:pruneMissing');
}

/** Remove one song iff its file is gone. Returns {removed, song, library}. */
function removeSongIfMissing(id: string) {
  return ipcRenderer.invoke('songs:removeIfMissing', id);
}

/** Delete songs from the library by id (e.g. a whole folder). Files stay on disk. Returns the fresh library. */
function deleteSongs(ids: string[]) {
  return ipcRenderer.invoke('songs:delete', ids);
}

/** Edit a song's metadata: writes the file's tags and the database row. Returns {song, library}. */
function updateSong(input: {
  id: string;
  title: string;
  orq: string;
  singer: string;
  album: string | null;
  year: number | null;
  genre: string;
  isCortina?: boolean;
}) {
  return ipcRenderer.invoke('songs:update', input);
}

/** Flag/unflag songs as cortinas (usage flag, independent of genre). Returns the fresh library. */
function setSongCortina(ids: string[], isCortina: boolean) {
  return ipcRenderer.invoke('songs:setCortina', {ids, isCortina});
}

/** Flag/unflag a whole folder as cortinas (persisted; future imports inherit). Returns the fresh library. */
function setFolderCortina(root: string, folderPath: string, isCortina: boolean) {
  return ipcRenderer.invoke('folders:setCortina', {root, folderPath, isCortina});
}

/** Preview Smart Organize proposals for the whole library. Returns {proposals, summary}. */
function previewSmartOrganize() {
  return ipcRenderer.invoke('smartOrganize:preview');
}

/** Apply the approved Smart Organize changes (Compás-only). Returns the fresh library. */
function applySmartOrganize(
  changes: {id: string; orq?: string; singer?: string; year?: number | null; genre?: string}[],
) {
  return ipcRenderer.invoke('smartOrganize:apply', changes);
}

/** Pick a folder and scan it for preview (nothing is saved). Returns the folder tree, or null if cancelled. */
function importScanPreview() {
  return ipcRenderer.invoke('import:scanPreview');
}

/** Commit the previewed import with a per-folder style map and cortina-flag map. Returns the fresh library. */
function importCommit(types: Record<string, string>, cortinas?: Record<string, boolean>) {
  return ipcRenderer.invoke('import:commit', {types, cortinas: cortinas || {}});
}

/** Discard a pending import preview. */
function importCancel() {
  return ipcRenderer.invoke('import:cancel');
}

/** Set the style (genre) of many existing songs at once. Returns the fresh library. */
function setSongGenres(updates: {id: string; genre: string}[]) {
  return ipcRenderer.invoke('songs:setGenres', updates);
}

function listTandas() {
  return ipcRenderer.invoke('tandas:list');
}

/** Curated tandas the DJ fully owns, matched against their library. Returns an array of suggested-tanda objects. */
function suggestTandas() {
  return ipcRenderer.invoke('tandas:suggest');
}

function saveTanda(input: {
  id?: string | null;
  name?: string | null;
  songIds: string[];
  tags?: {cat: string; label: string}[];
}) {
  return ipcRenderer.invoke('tandas:save', input);
}

function deleteTanda(id: string) {
  return ipcRenderer.invoke('tandas:delete', id);
}

function listPlaylists() {
  return ipcRenderer.invoke('playlists:list');
}

function savePlaylist(input: {
  id?: string | null;
  name?: string | null;
  items: {type: 'tanda' | 'cortina'; refId: string}[];
}) {
  return ipcRenderer.invoke('playlists:save', input);
}

function deletePlaylist(id: string) {
  return ipcRenderer.invoke('playlists:delete', id);
}

/** Current background-analysis state + DB stats (for the initial banner). */
function analysisState() {
  return ipcRenderer.invoke('analysis:state');
}

/** Subscribe to analysis progress. Returns an unsubscribe function. */
function onAnalysisProgress(cb: (state: unknown) => void) {
  const listener = (_event: unknown, state: unknown) => cb(state);
  ipcRenderer.on('analysis:progress', listener);
  return () => ipcRenderer.removeListener('analysis:progress', listener);
}

/** Subscribe to live library changes (files added/removed/renamed on disk).
 *  The callback receives the fresh library. Returns an unsubscribe function. */
function onLibraryChanged(cb: (library: unknown) => void) {
  const listener = (_event: unknown, library: unknown) => cb(library);
  ipcRenderer.on('library:changed', listener);
  return () => ipcRenderer.removeListener('library:changed', listener);
}

/** Subscribe to text-size commands from the View ▸ Zoom menu / keyboard
 *  accelerators. The callback receives 'in' | 'out' | 'reset'. Returns an
 *  unsubscribe function. */
function onZoomCommand(cb: (dir: 'in' | 'out' | 'reset') => void) {
  const listener = (_event: unknown, dir: 'in' | 'out' | 'reset') => cb(dir);
  ipcRenderer.on('app:zoom', listener);
  return () => ipcRenderer.removeListener('app:zoom', listener);
}

export {
  getLibrary,
  clearLibrary,
  pruneMissingLibrary,
  removeSongIfMissing,
  deleteSongs,
  updateSong,
  setSongCortina,
  setFolderCortina,
  previewSmartOrganize,
  applySmartOrganize,
  importScanPreview,
  importCommit,
  importCancel,
  setSongGenres,
  listTandas,
  suggestTandas,
  saveTanda,
  deleteTanda,
  listPlaylists,
  savePlaylist,
  deletePlaylist,
  analysisState,
  onAnalysisProgress,
  onLibraryChanged,
  onZoomCommand,
  setTextZoom,
};
