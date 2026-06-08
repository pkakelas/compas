import type {AppModule} from '../AppModule.js';
import type {ModuleContext} from '../ModuleContext.js';
import {BrowserWindow, dialog, ipcMain} from 'electron';
import {basename} from 'node:path';
import {scanFolder, guessStyle} from '../services/scan.js';
import {AnalysisManager, type AnalysisState} from '../services/loudness.js';
import {LibraryWatcher} from '../services/watcher.js';
import {writeSongTags} from '../services/tags.js';
import {proposeLibrary, type EnrichInput} from '../services/enrich.js';
import {
  applySmartOrganize,
  type SmartOrganizeChange,
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
  setSongGenres,
  updateSong,
  type Library,
  type SavePlaylistInput,
  type SaveTandaInput,
  type ScannedSong,
  type UpdateSongInput,
} from './Database.js';

/** A node in the import folder tree shown to the DJ (counts + a style guess). */
type ImportTreeNode = {
  key: string; // stable, unique per node (the relative path; '#root' for the root)
  name: string;
  path: string; // relative folder path under the root ('' for the root itself)
  count: number;
  guess: string | null;
  children: ImportTreeNode[];
};

/** Build the nested folder tree (with per-folder song counts + a style guess)
 *  from a flat list of scanned songs, for the import review UI. */
function buildImportTree(root: string, songs: ScannedSong[]): ImportTreeNode {
  const rootNode: ImportTreeNode = {
    key: '#root',
    name: basename(root) || root,
    path: '',
    count: songs.length,
    guess: guessStyle(basename(root)),
    children: [],
  };
  const byPath = new Map<string, ImportTreeNode>([['', rootNode]]);
  for (const s of songs) {
    const segs = s.folderPath ? s.folderPath.split(' / ') : [];
    let acc = '';
    let parent = rootNode;
    for (const seg of segs) {
      acc = acc ? `${acc} / ${seg}` : seg;
      let node = byPath.get(acc);
      if (!node) {
        node = {key: acc, name: seg, path: acc, count: 0, guess: guessStyle(seg), children: []};
        byPath.set(acc, node);
        parent.children.push(node);
      }
      node.count += 1;
      parent = node;
    }
  }
  const sort = (n: ImportTreeNode): void => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(rootNode);
  return rootNode;
}

export class IpcModule implements AppModule {
  async enable({app}: ModuleContext): Promise<void> {
    await app.whenReady();

    // Background loudness/silence analysis. Results stream to every open window
    // so the "still processing" banner can show progress. The pass runs
    // continuously (it is not paused during playback) and resumes leftover work
    // on import / startup.
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

    // --- Detailed import: scan a folder for preview (persist nothing yet), let
    // the renderer assign a style per folder, then commit with those styles. ---
    let importPreview: {root: string; songs: ScannedSong[]} | null = null;

    ipcMain.handle('import:scanPreview', async (event): Promise<ImportTreeNode | null> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts: Electron.OpenDialogOptions = {
        title: 'Choose a folder to import',
        properties: ['openDirectory'],
      };
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) return null;
      const root = result.filePaths[0];
      const {songs} = await scanFolder(root);
      importPreview = {root, songs};
      return buildImportTree(root, songs);
    });

    // Commit the previewed import. `types` maps a relative folder path to the
    // chosen style; a song with no entry for its folder is imported as 'mixed'.
    ipcMain.handle(
      'import:commit',
      (_event, payload: {types?: Record<string, string>}): Library | null => {
        if (!importPreview) return null;
        const types = (payload && payload.types) || {};
        const songs = importPreview.songs.map(s => ({
          ...s,
          genre: types[s.folderPath] || 'mixed',
        }));
        importSongs(importPreview.root, songs);
        importPreview = null;
        analysis.enqueuePending();
        watcher.sync();
        const library = getLibrary();
        broadcastLibrary(library);
        return library;
      },
    );

    ipcMain.handle('import:cancel', () => {
      importPreview = null;
      return true;
    });

    // Re-type existing songs (the tree tool run on the current library): set
    // each song's style directly. Compás-only; files untouched.
    ipcMain.handle('songs:setGenres', (_event, updates: {id: string; genre: string}[]): Library => {
      const library = setSongGenres(Array.isArray(updates) ? updates : []);
      broadcastLibrary(library);
      return library;
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

    // Smart Organize — derive cleaner metadata from each song's title/folder/
    // tags and confirm it against the bundled canonical catalog. The preview is
    // pure, in-memory string work over the cached library rows (no disk I/O), so
    // it stays fast even on thousands of songs.
    ipcMain.handle('smartOrganize:preview', () => {
      const songs: EnrichInput[] = getLibrary().songs.map(s => ({
        id: s.id,
        title: s.title,
        orq: s.orq,
        singer: s.singer,
        year: s.year,
        genre: s.genre,
        folderPath: s.folderPath,
      }));
      return proposeLibrary(songs);
    });

    // Apply the DJ-approved subset (Compás-only: database update, files
    // untouched), then push the fresh library to every window.
    ipcMain.handle(
      'smartOrganize:apply',
      (_event, changes: SmartOrganizeChange[]): Library => {
        const library = applySmartOrganize(Array.isArray(changes) ? changes : []);
        broadcastLibrary(library);
        return library;
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
