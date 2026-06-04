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

function listTandas() {
  return ipcRenderer.invoke('tandas:list');
}

function saveTanda(input: {id?: string | null; name?: string | null; songIds: string[]}) {
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
  listTandas,
  saveTanda,
  deleteTanda,
  listPlaylists,
  savePlaylist,
  deletePlaylist,
};
