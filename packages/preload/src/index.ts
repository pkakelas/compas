import {ipcRenderer} from 'electron';

/** Open a folder picker, scan it, and persist the songs. Returns the full library, or null if cancelled. */
function importLibrary() {
  return ipcRenderer.invoke('library:import');
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
}) {
  return ipcRenderer.invoke('songs:update', input);
}

function listTandas() {
  return ipcRenderer.invoke('tandas:list');
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

/** Tell the main process the floor is/!isn't playing, so it can pause/resume the
 *  analysis pool (ffmpeg must never compete with live playback). */
function setAnalysisPlaying(playing: boolean) {
  return ipcRenderer.invoke('analysis:setPlaying', playing);
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

export {
  importLibrary,
  getLibrary,
  clearLibrary,
  pruneMissingLibrary,
  removeSongIfMissing,
  deleteSongs,
  updateSong,
  listTandas,
  saveTanda,
  deleteTanda,
  listPlaylists,
  savePlaylist,
  deletePlaylist,
  analysisState,
  setAnalysisPlaying,
  onAnalysisProgress,
  onLibraryChanged,
};
