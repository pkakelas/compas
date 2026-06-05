import {sha256sum} from './nodeCrypto.js';
import {versions} from './versions.js';
import {ipcRenderer} from 'electron';

function send(channel: string, message: string) {
  return ipcRenderer.invoke(channel, message);
}

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

export {
  sha256sum,
  versions,
  send,
  importLibrary,
  getLibrary,
  clearLibrary,
  pruneMissingLibrary,
  removeSongIfMissing,
  deleteSongs,
  listTandas,
  saveTanda,
  deleteTanda,
  listPlaylists,
  savePlaylist,
  deletePlaylist,
};
