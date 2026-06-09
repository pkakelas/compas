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
  getLibrary: preload.getLibrary,
  clearLibrary: preload.clearLibrary,
  pruneMissing: preload.pruneMissingLibrary,
  removeSongIfMissing: preload.removeSongIfMissing,
  deleteSongs: preload.deleteSongs,
  updateSong: preload.updateSong,
  previewSmartOrganize: preload.previewSmartOrganize,
  applySmartOrganize: preload.applySmartOrganize,
  importScanPreview: preload.importScanPreview,
  importCommit: preload.importCommit,
  importCancel: preload.importCancel,
  setSongGenres: preload.setSongGenres,
  listTandas: preload.listTandas,
  suggestTandas: preload.suggestTandas,
  saveTanda: preload.saveTanda,
  deleteTanda: preload.deleteTanda,
  listPlaylists: preload.listPlaylists,
  savePlaylist: preload.savePlaylist,
  deletePlaylist: preload.deletePlaylist,
  // Background loudness/silence analysis: read state and subscribe to progress
  // for the banner.
  analysisState: preload.analysisState,
  onAnalysisProgress: preload.onAnalysisProgress,
  // Live library sync: fires when songs are added/removed/renamed on disk.
  onLibraryChanged: preload.onLibraryChanged,
  // URL the audio engine can stream a song from (range requests supported).
  audioUrl: (id) => `${AUDIO_SCHEME}://song/${id}`,
};
