import type {AppModule} from '../AppModule.js';
import type {ModuleContext} from '../ModuleContext.js';
import {BrowserWindow, dialog, ipcMain, shell} from 'electron';
import {basename, dirname, extname, relative, sep} from 'node:path';
import {existsSync} from 'node:fs';
import {readFile, stat, writeFile} from 'node:fs/promises';
import {
  scanFolder,
  guessStyle,
  isAudioFile,
  looksLikeCortinaFolder,
  readTagStyle,
} from '../services/scan.js';
import {commonAncestor, displayFolderPath, playlistSourceFolders} from '../services/import-sources.js';
import {clearAudioCache} from '../services/transcode.js';
import {AnalysisManager, type AnalysisState} from '../services/loudness.js';
import {LibraryWatcher} from '../services/watcher.js';
import {writeSongTags} from '../services/tags.js';
import {proposeLibrary, type EnrichInput} from '../services/enrich.js';
import {suggestTandas} from '../services/suggest-tandas.js';
import {
  buildImportPreview,
  decodeM3u,
  exportFilename,
  parseM3u,
  resolveEntries,
  writeM3u,
  type ImportPreview,
} from '../services/playlist-m3u.js';
import {
  applySmartOrganize,
  type SmartOrganizeChange,
  applyTagStyles,
  clearLibrary,
  deletePlaylist,
  deleteSongsByIds,
  deleteTanda,
  getAnalysisStats,
  getLibrary,
  getSongPath,
  importSongs,
  listPendingAnalysis,
  keepTanda,
  listCollectionTandas,
  listLibraryRoots,
  listMixedWithUncheckedTag,
  listPlaylists,
  listSongPaths,
  listTandas,
  markAnalysisFailed,
  pruneMissingSongs,
  removeSongIfMissing,
  saveAnalysisResult,
  savePlaylist,
  saveTanda,
  setFolderCortina,
  setFolderFlags,
  setSongCortina,
  setSongGenres,
  updateSong,
  type Library,
  type Playlist,
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
  cortina: boolean; // folder name looks like a cortina folder (pre-checks the toggle)
  children: ImportTreeNode[];
  // Set on the root when the import was started from a playlist file: the
  // renderer continues into the playlist import once the folders are in.
  playlist?: {path: string; name: string; found: number; total: number; inLibrary: number};
};

const PLAYLIST_EXTS = new Set(['.m3u', '.m3u8']);
export function isPlaylistFile(file: string): boolean {
  return PLAYLIST_EXTS.has(extname(file).toLowerCase());
}

/** Build the nested folder tree (with per-folder song counts + a style guess)
 *  from a flat list of scanned songs, for the import review UI. */
function buildImportTree(root: string, songs: ScannedSong[]): ImportTreeNode {
  const rootNode: ImportTreeNode = {
    key: '#root',
    name: basename(root) || root,
    path: '',
    count: songs.length,
    guess: guessStyle(basename(root)),
    cortina: looksLikeCortinaFolder(basename(root)),
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
        node = {
          key: acc,
          name: seg,
          path: acc,
          count: 0,
          guess: guessStyle(seg),
          cortina: looksLikeCortinaFolder(seg),
          children: [],
        };
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

/**
 * Give songs left 'mixed' by an older import the style their own genre tag
 * names. Songs whose root or file is missing (e.g. an unplugged drive) are
 * skipped and retried on a later launch. Resolves to how many songs changed
 * style.
 */
async function backfillTagStyles(): Promise<number> {
  const results: {id: number; style: string | null}[] = [];
  const rootIsThere = new Map<string, boolean>();
  for (const {id, path, root} of listMixedWithUncheckedTag()) {
    if (!rootIsThere.has(root)) rootIsThere.set(root, existsSync(root));
    if (!rootIsThere.get(root)) continue;
    const style = await readTagStyle(path);
    if (style !== undefined) results.push({id, style});
  }
  return results.length ? applyTagStyles(results) : 0;
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

    // Libraries imported before the genre tag was honoured: fix them up in the
    // background and refresh every window once done.
    void backfillTagStyles()
      .then(changed => {
        if (changed > 0) broadcastLibrary(getLibrary());
      })
      .catch(console.error);

    // --- Detailed import: scan a folder for preview (persist nothing yet), let
    // the renderer assign a style per folder, then commit with those styles.
    // A preview may span several roots when it was started from a playlist
    // file (one root per folder the playlist's songs live in); the tree shown
    // to the DJ is then keyed from their common ancestor. ---
    type PendingRoot = {root: string; songs: ScannedSong[]};
    let importPreview: {displayRoot: string; roots: PendingRoot[]} | null = null;

    // Scan one folder, or the folders a playlist file points at, into a preview.
    const previewPath = async (chosen: string): Promise<ImportTreeNode | null> => {
      const info = await stat(chosen).catch(() => null);
      if (!info) return null;
      if (info.isDirectory()) {
        const {songs} = await scanFolder(chosen);
        importPreview = {displayRoot: chosen, roots: [{root: chosen, songs}]};
        return buildImportTree(chosen, songs);
      }
      if (isAudioFile(chosen)) return previewPath(dirname(chosen)); // a dropped song → its folder
      if (!isPlaylistFile(chosen)) return null;

      const parsed = parseM3u(decodeM3u(await readFile(chosen)));
      const src = playlistSourceFolders(parsed, dirname(chosen), listLibraryRoots());
      const roots: PendingRoot[] = [];
      for (const root of src.folders) roots.push({root, songs: (await scanFolder(root)).songs});
      const displayRoot = commonAncestor(src.folders) || dirname(chosen);
      importPreview = {displayRoot, roots};
      const songs = roots.flatMap(r =>
        r.songs.map(s => ({...s, folderPath: displayFolderPath(displayRoot, r.root, s.folderPath)})),
      );
      const tree = buildImportTree(displayRoot, songs);
      const name = (parsed.name || '').trim() || basename(chosen, extname(chosen));
      tree.playlist = {path: chosen, name, found: src.found, total: src.total, inLibrary: src.inLibrary};
      return tree;
    };

    // `kind` picks the dialog: a folder (default) or a playlist file. Two plain
    // choices in the UI beat one picker that quietly accepts both.
    ipcMain.handle(
      'import:scanPreview',
      async (event, opts?: {kind?: 'folder' | 'playlist'}): Promise<ImportTreeNode | null> => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const playlist = opts?.kind === 'playlist';
        const dialogOpts: Electron.OpenDialogOptions = playlist
          ? {
              title: 'Choose a playlist',
              properties: ['openFile'],
              filters: [{name: 'Playlists', extensions: ['m3u8', 'm3u']}],
            }
          : {title: 'Choose your music folder', properties: ['openDirectory']};
        const result = win
          ? await dialog.showOpenDialog(win, dialogOpts)
          : await dialog.showOpenDialog(dialogOpts);
        if (result.canceled || result.filePaths.length === 0) return null;
        return previewPath(result.filePaths[0]);
      },
    );

    // Same preview from a path the renderer already has (a dropped folder,
    // song or playlist file).
    ipcMain.handle('import:scanPreviewPath', (_event, chosen: string) =>
      typeof chosen === 'string' && chosen ? previewPath(chosen) : null,
    );

    // Commit the previewed import. `types` maps a relative folder path to its
    // style: the DJ's choice (which may be 'mixed') or the one its name gives.
    // A song whose folder has no entry takes the style its own genre tag names,
    // and is 'mixed' only without one.
    // `cortinas` maps a folder path to its cortina flag (the per-folder toggle):
    // an explicit entry overrides the folder-name heuristic, and `true` is also
    // persisted in folder_flags so future imports into that folder inherit it.
    // Keys are relative to the tree's display root; each root maps them back.
    ipcMain.handle(
      'import:commit',
      (
        _event,
        payload: {types?: Record<string, string>; cortinas?: Record<string, boolean>},
      ): Library | null => {
        if (!importPreview) return null;
        const types = (payload && payload.types) || {};
        const cortinas = (payload && payload.cortinas) || {};
        for (const {root, songs: scanned} of importPreview.roots) {
          const disp = (fp: string) => displayFolderPath(importPreview!.displayRoot, root, fp);
          const songs = scanned.map(s => ({
            ...s,
            genre: types[disp(s.folderPath)] || s.tagStyle || 'mixed',
            isCortina: disp(s.folderPath) in cortinas ? cortinas[disp(s.folderPath)] : s.isCortina,
          }));
          // Persist the folder-level flags (root-relative) so re-imports /
          // dropped-in clips inherit.
          const prefix = relative(importPreview.displayRoot, root).split(sep).filter(Boolean).join(' / ');
          const rootFlags: Record<string, boolean> = {};
          for (const [key, flag] of Object.entries(cortinas)) {
            if (!prefix) rootFlags[key] = flag;
            else if (key === prefix) rootFlags[''] = flag;
            else if (key.startsWith(`${prefix} / `)) rootFlags[key.slice(prefix.length + 3)] = flag;
          }
          setFolderFlags(root, rootFlags);
          importSongs(root, songs);
        }
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

    // Flag/unflag songs as cortinas (the usage flag, independent of genre).
    ipcMain.handle(
      'songs:setCortina',
      (_event, payload: {ids: string[]; isCortina: boolean}): Library => {
        const library = setSongCortina(
          Array.isArray(payload?.ids) ? payload.ids : [],
          !!payload?.isCortina,
        );
        broadcastLibrary(library);
        return library;
      },
    );

    // Flag/unflag a whole folder as cortinas (persisted; future imports inherit).
    ipcMain.handle(
      'folders:setCortina',
      (_event, payload: {root: string; folderPath: string; isCortina: boolean}): Library => {
        const library = setFolderCortina(
          payload?.root ?? '',
          payload?.folderPath ?? '',
          !!payload?.isCortina,
        );
        broadcastLibrary(library);
        return library;
      },
    );

    // App version (from the packaged app's package.json) for the About card.
    ipcMain.handle('app:version', (): string => app.getVersion());

    // Open a vetted external link (the About footer's website / email) in the
    // user's default browser or mail client. Restricted to known targets so the
    // renderer can never hand us an arbitrary URL to open.
    ipcMain.handle('app:openExternal', (_event, url: string): void => {
      if (url === 'mailto:pkakelas@gmail.com' || url === 'https://t.me/pkakelas') {
        shell.openExternal(url).catch(console.error);
      }
    });

    ipcMain.handle('library:get', (): Library => getLibrary());

    ipcMain.handle('library:clear', (): Library => {
      clearLibrary();
      // Cached AIFF→WAV conversions are keyed by song id, which restarts here.
      void clearAudioCache();
      watcher.sync();
      return getLibrary();
    });

    // Drop every song whose file has gone missing from disk (and any folder/
    // tanda left empty as a result). Runs on load to keep the tree honest.
    ipcMain.handle('library:pruneMissing', () => pruneMissingSongs());

    // Full reconcile of the imported roots against the filesystem: picks up
    // songs added, removed, or moved while the app was closed (the live watcher
    // only sees changes while running). Runs on load and supersedes the prune
    // above — it removes the gone *and* imports the new, pairing moves so ids
    // (and analysis/tanda membership) survive. Returns the fresh library.
    ipcMain.handle('library:reconcile', () => watcher.reconcileRoots());

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

    // "My tandas": playlist-only tandas (from an import) are left out.
    ipcMain.handle('tandas:list', () => listCollectionTandas());

    // Match the bundled curated tandas against the DJ's library and return the
    // ones they fully own — used to seed the (otherwise empty) Tandas page with
    // ready-to-play suggestions. Pure in-memory string matching, like the Smart
    // Organize preview.
    ipcMain.handle('tandas:suggest', () => suggestTandas(getLibrary(), listCollectionTandas()));

    ipcMain.handle('tandas:save', (_event, input: SaveTandaInput) => saveTanda(input));

    // Keep a playlist-only tanda (made by an import) in "My tandas".
    ipcMain.handle('tandas:keep', (_event, id: string) => {
      keepTanda(id);
      return true;
    });

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

    // --- Playlist exchange with other players (M3U / M3U8). ---

    // Write one playlist as an extended M3U8 the DJ picks a location for.
    // Returns the written path, or null when the dialog was cancelled.
    ipcMain.handle('playlists:export', async (event, id: string): Promise<string | null> => {
      const playlist = listPlaylists().find(p => p.id === String(id));
      if (!playlist) return null;
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts: Electron.SaveDialogOptions = {
        title: 'Export playlist',
        defaultPath: exportFilename(playlist),
        filters: [
          {name: 'M3U8 playlist (UTF-8)', extensions: ['m3u8']},
          {name: 'M3U playlist', extensions: ['m3u']},
        ],
      };
      const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (result.canceled || !result.filePath) return null;
      const paths = listSongPaths();
      await writeFile(result.filePath, writeM3u(playlist, sid => paths.get(sid) ?? null), 'utf8');
      return result.filePath;
    });

    // Pick an M3U/M3U8, resolve its songs against the library and propose the
    // tandas + cortinas it would create. Nothing is written until commit.
    let playlistImport: ImportPreview | null = null;

    const previewPlaylistFile = async (file: string): Promise<ImportPreview> => {
      const parsed = parseM3u(decodeM3u(await readFile(file)));
      const resolved = resolveEntries(parsed, dirname(file), getLibrary(), listSongPaths());
      playlistImport = buildImportPreview(parsed, resolved, {
        sourcePath: file,
        existingTandas: listCollectionTandas(),
        existingPlaylists: listPlaylists(),
      });
      return playlistImport;
    };

    ipcMain.handle('playlists:importPreview', async (event): Promise<ImportPreview | null> => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts: Electron.OpenDialogOptions = {
        title: 'Import playlist',
        properties: ['openFile'],
        filters: [
          {name: 'Playlists', extensions: ['m3u8', 'm3u']},
          {name: 'All files', extensions: ['*']},
        ],
      };
      const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) return null;
      return previewPlaylistFile(result.filePaths[0]);
    });

    // Preview a playlist file the renderer already has a path for (the folder
    // import's follow-up step, or a dropped file).
    ipcMain.handle('playlists:importPreviewPath', (_event, file: string) =>
      typeof file === 'string' && isPlaylistFile(file) ? previewPlaylistFile(file) : null,
    );

    // Create the previewed tandas (reusing saved ones with the same songs) and
    // the playlist. `name` lets the DJ rename before committing.
    ipcMain.handle('playlists:importCommit', (_event, payload?: {name?: string}): Playlist | null => {
      if (!playlistImport) return null;
      const preview = playlistImport;
      playlistImport = null;
      const items: SavePlaylistInput['items'] = [];
      for (const it of preview.items) {
        if (it.type === 'cortina') {
          items.push({type: 'cortina', refId: it.song.id});
          continue;
        }
        const t = it.tanda;
        const tandaId =
          t.existingTandaId ??
          saveTanda({name: t.name, songIds: t.songs.map(s => s.id), tags: t.tags, inCollection: false}).id;
        items.push({type: 'tanda', refId: tandaId});
      }
      const name = (payload?.name ?? preview.name).trim() || preview.name;
      return savePlaylist({name, items});
    });

    ipcMain.handle('playlists:importCancel', () => {
      playlistImport = null;
      return true;
    });
  }
}

export function ipcModule(): IpcModule {
  return new IpcModule();
}
