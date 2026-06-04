// Bridge between the contextBridge-exposed preload functions and the design
// files, which are classic scripts that read globals off `window`.
// `@app/preload` resolves to the virtual browser module, whose exports map to
// the values exposed by the preload via `contextBridge.exposeInMainWorld`.
import * as preload from "@app/preload";
import {Howl, Howler} from "howler";

// The design files are classic scripts that read globals — expose Howler too.
window.Howl = Howl;
window.Howler = Howler;

const AUDIO_SCHEME = "compas-audio";

window.compas = {
  importLibrary: preload.importLibrary,
  getLibrary: preload.getLibrary,
  clearLibrary: preload.clearLibrary,
  listTandas: preload.listTandas,
  saveTanda: preload.saveTanda,
  deleteTanda: preload.deleteTanda,
  listPlaylists: preload.listPlaylists,
  savePlaylist: preload.savePlaylist,
  deletePlaylist: preload.deletePlaylist,
  // URL the audio engine can stream a song from (range requests supported).
  audioUrl: (id) => `${AUDIO_SCHEME}://song/${id}`,
};
