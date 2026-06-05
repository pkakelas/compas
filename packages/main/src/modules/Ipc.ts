import type {AppModule} from '../AppModule.js';
import type {ModuleContext} from '../ModuleContext.js';
import {BrowserWindow, dialog, ipcMain} from 'electron';
import {scanFolder} from '../services/scan.js';
import {AnalysisManager, type AnalysisState} from '../services/loudness.js';
import {LibraryWatcher} from '../services/watcher.js';
import {writeSongTags} from '../services/tags.js';
import {
  clearLibrary,
  deletePlaylist,
  deleteSongsByIds,
  deleteTanda,
  getAnalysisStats,
  getLibrary,
  getSongPath,
  importSongs,
  listPendingAnalysis,
  listPlaylists,
  listTandas,
  markAnalysisFailed,
  pruneMissingSongs,
  removeSongIfMissing,
  saveAnalysisResult,
  savePlaylist,
  saveTanda,
  updateSong,
  type Library,
  type SavePlaylistInput,
  type SaveTandaInput,
  type UpdateSongInput,
} from './Database.js';

export class IpcModule implements AppModule {
  async enable({app}: ModuleContext): Promise<void> {
    await app.whenReady();

    // Background loudness/silence analysis. Results stream to every open window
    // so the "still processing" banner can show progress. The pass is paused
    // while the floor plays live (see 'analysis:setPlaying') so ffmpeg never
    // competes with playback, and resumes on import / startup.
    const broadcast = (state: AnalysisState): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('analysis:progress', state);
      }
    };
    const analysis = new AnalysisManager({
      loadPending: listPendingAnalysis,
      saveResult: saveAnalysisResult,
      markFailed: markAnalysisFailed,
      onProgress: broadcast,
    });

    ipcMain.handle('analysis:state', () => ({
      ...analysis.getState(),
      stats: getAnalysisStats(),
    }));
    ipcMain.handle('analysis:setPlaying', (_event, playing: boolean) => {
      if (playing) analysis.pause();
      else analysis.resume();
      return analysis.getState();
    });

    // Resume any leftover work from a previous session (interruptible by design).
    analysis.enqueuePending();

    // Keep the library in sync with the filesystem: when songs are added,
    // removed, or renamed inside an imported folder while the app is open, push
    // the fresh library to every window (and analyze any new files).
    const broadcastLibrary = (library: Library): void => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('library:changed', library);
      }
    };
    const watcher = new LibraryWatcher({
      onLibraryChanged: broadcastLibrary,
      onSongsAdded: () => analysis.enqueuePending(),
    });
    watcher.start();

    ipcMain.handle('library:import', async (event): Promise<Library | null> => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const result = win
        ? await dialog.showOpenDialog(win, {
            title: 'Choose your music folder',
            properties: ['openDirectory'],
          })
        : await dialog.showOpenDialog({
            title: 'Choose your music folder',
            properties: ['openDirectory'],
          });

      if (result.canceled || result.filePaths.length === 0) return null;

      const root = result.filePaths[0];
      const {songs} = await scanFolder(root);
      importSongs(root, songs);
      // Songs are usable immediately; kick off (or extend) the background pass
      // for the newly-imported tracks.
      analysis.enqueuePending();
      // Start watching the newly-imported root for live changes.
      watcher.sync();
      return getLibrary();
    });

    ipcMain.handle('library:get', (): Library => getLibrary());

    ipcMain.handle('library:clear', (): Library => {
      clearLibrary();
      watcher.sync();
      return getLibrary();
    });

    // Drop every song whose file has gone missing from disk (and any folder/
    // tanda left empty as a result). Runs on load to keep the tree honest.
    ipcMain.handle('library:pruneMissing', () => pruneMissingSongs());

    // Remove a single song, but only if its file is truly gone — used when
    // playback fails so we self-heal the library instead of looping on errors.
    ipcMain.handle('songs:removeIfMissing', (_event, id: string) => removeSongIfMissing(id));

    // Delete songs from the library by id (e.g. removing a whole folder). The
    // files are left untouched on disk — this only forgets them in the app.
    ipcMain.handle('songs:delete', (_event, ids: string[]) => {
      const library = deleteSongsByIds(ids);
      // Removing a whole folder can drop a root — stop watching it.
      watcher.sync();
      return library;
    });

    // Edit a single song's metadata. We write the tags into the file on disk
    // first (so the change is portable and survives a re-import), then mirror it
    // into the database. The file write makes the watcher re-scan shortly after,
    // but importSongs preserves the user-set singer/genre so nothing is lost.
    // Returns {song, library} so the renderer can refresh the tree and any
    // tandas/playlists that embed this song.
    ipcMain.handle(
      'songs:update',
      async (
        _event,
        input: UpdateSongInput,
      ): Promise<{song: ReturnType<typeof updateSong>; library: Library}> => {
        const path = getSongPath(input.id);
        if (!path) return {song: null, library: getLibrary()};
        // Write the file's tags first; if this throws, the DB is left untouched
        // and the error propagates to the renderer so it can flag the failure.
        await writeSongTags(path, {
          title: input.title,
          artist: input.orq,
          album: input.album,
          year: input.year,
          genre: input.genre,
        });
        const song = updateSong(input);
        const library = getLibrary();
        // Push the fresh library to every other window too, so a song edited in
        // one place updates everywhere immediately.
        broadcastLibrary(library);
        return {song, library};
      },
    );

    ipcMain.handle('tandas:list', () => listTandas());

    ipcMain.handle('tandas:save', (_event, input: SaveTandaInput) => saveTanda(input));

    ipcMain.handle('tandas:delete', (_event, id: string) => {
      deleteTanda(id);
      return true;
    });

    ipcMain.handle('playlists:list', () => listPlaylists());

    ipcMain.handle('playlists:save', (_event, input: SavePlaylistInput) => savePlaylist(input));

    ipcMain.handle('playlists:delete', (_event, id: string) => {
      deletePlaylist(id);
      return true;
    });
  }
}

export function ipcModule(): IpcModule {
  return new IpcModule();
}
