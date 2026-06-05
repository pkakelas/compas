import type {AppModule} from '../AppModule.js';
import type {ModuleContext} from '../ModuleContext.js';
import {BrowserWindow, dialog, ipcMain} from 'electron';
import {scanFolder} from '../services/scan.js';
import {
  clearLibrary,
  deletePlaylist,
  deleteSongsByIds,
  deleteTanda,
  getLibrary,
  importSongs,
  listPlaylists,
  listTandas,
  pruneMissingSongs,
  removeSongIfMissing,
  savePlaylist,
  saveTanda,
  type Library,
  type SavePlaylistInput,
  type SaveTandaInput,
} from './Database.js';

export class IpcModule implements AppModule {
  async enable({app}: ModuleContext): Promise<void> {
    await app.whenReady();

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
      return getLibrary();
    });

    ipcMain.handle('library:get', (): Library => getLibrary());

    ipcMain.handle('library:clear', (): Library => {
      clearLibrary();
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
    ipcMain.handle('songs:delete', (_event, ids: string[]) => deleteSongsByIds(ids));

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
