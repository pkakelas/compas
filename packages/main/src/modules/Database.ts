import type {AppModule} from '../AppModule.js';
import type {ModuleContext} from '../ModuleContext.js';
import {app} from 'electron';
import {basename, dirname, join} from 'node:path';
import {existsSync} from 'node:fs';
import Database from 'better-sqlite3';

export type SongRow = {
  id: number;
  path: string;
  title: string;
  artist: string;
  singer: string;
  album: string | null;
  year: number | null;
  duration_sec: number | null;
  genre: string;
  folder: string;
  folder_path: string;
  root: string;
  added_at: number;
};

/** UI-facing song shape (mirrors the legacy renderer contract). */
export type Song = {
  id: string;
  title: string;
  orq: string;
  singer: string;
  album: string | null;
  year: number | null;
  dur: string;
  durationSec: number | null;
  genre: string;
  folder: string;
  folderPath: string;
  root: string;
};

export type TreeNode = {
  name: string;
  path: string;
  songs?: Song[];
  children?: TreeNode[];
};

/** A label attached to a tanda. `cat` groups it (type/age/orquesta) or is 'custom'. */
export type TandaTag = {
  cat: string;
  label: string;
};

export type Tanda = {
  id: string;
  name: string | null;
  songs: Song[];
  tags: TandaTag[];
};

/** A playlist item is either a saved tanda or a single cortina song. */
export type PlaylistItem =
  | {type: 'tanda'; data: Tanda}
  | {type: 'cortina'; data: Song};

export type Playlist = {
  id: string;
  name: string | null;
  items: PlaylistItem[];
};

export type Library = {
  tree: TreeNode[];
  songs: Song[];
  totalSongs: number;
  totalFolders: number;
  roots: string[];
};

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  const file = join(app.getPath('userData'), 'compas.db');
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(d: Database.Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS songs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      path         TEXT UNIQUE NOT NULL,
      title        TEXT NOT NULL DEFAULT '',
      artist       TEXT NOT NULL DEFAULT '',
      singer       TEXT NOT NULL DEFAULT '',
      album        TEXT,
      year         INTEGER,
      duration_sec REAL,
      genre        TEXT NOT NULL DEFAULT 'tango',
      folder       TEXT NOT NULL DEFAULT '',
      folder_path  TEXT NOT NULL DEFAULT '',
      root         TEXT NOT NULL DEFAULT '',
      added_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tandas (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tanda_songs (
      tanda_id INTEGER NOT NULL REFERENCES tandas(id) ON DELETE CASCADE,
      song_id  INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (tanda_id, position)
    );

    CREATE TABLE IF NOT EXISTS tanda_tags (
      tanda_id INTEGER NOT NULL REFERENCES tandas(id) ON DELETE CASCADE,
      cat      TEXT NOT NULL DEFAULT 'custom',  -- 'type' | 'age' | 'orquesta' | 'custom'
      label    TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (tanda_id, position)
    );

    CREATE INDEX IF NOT EXISTS idx_tanda_tags_label ON tanda_tags(label);

    CREATE TABLE IF NOT EXISTS library_roots (
      path     TEXT PRIMARY KEY,
      added_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlists (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS playlist_items (
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      position    INTEGER NOT NULL,
      kind        TEXT NOT NULL,          -- 'tanda' | 'cortina'
      ref_id      INTEGER NOT NULL,       -- tandas.id (tanda) or songs.id (cortina)
      PRIMARY KEY (playlist_id, position)
    );
  `);
}

function fmtDur(sec: number | null | undefined): string {
  if (!sec || !isFinite(sec) || sec <= 0) return '0:00';
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function rowToSong(r: SongRow): Song {
  return {
    id: String(r.id),
    title: r.title,
    orq: r.artist,
    singer: r.singer,
    album: r.album,
    year: r.year,
    dur: fmtDur(r.duration_sec),
    durationSec: r.duration_sec,
    genre: r.genre,
    folder: r.folder,
    folderPath: r.folder_path,
    root: r.root,
  };
}

export type ScannedSong = {
  path: string;
  title: string;
  artist: string;
  singer: string;
  album: string | null;
  year: number | null;
  durationSec: number | null;
  genre: string;
  folder: string;
  folderPath: string;
};

/** Upsert scanned songs (keyed by absolute path) and record the import root. */
export function importSongs(root: string, songs: ScannedSong[]): void {
  const d = getDb();
  const now = Date.now();

  const upsertRoot = d.prepare(
    'INSERT INTO library_roots (path, added_at) VALUES (?, ?) ON CONFLICT(path) DO NOTHING',
  );
  const upsertSong = d.prepare(`
    INSERT INTO songs (path, title, artist, singer, album, year, duration_sec, genre, folder, folder_path, root, added_at)
    VALUES (@path, @title, @artist, @singer, @album, @year, @durationSec, @genre, @folder, @folderPath, @root, @added_at)
    ON CONFLICT(path) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      singer = excluded.singer,
      album = excluded.album,
      year = excluded.year,
      duration_sec = excluded.duration_sec,
      genre = excluded.genre,
      folder = excluded.folder,
      folder_path = excluded.folder_path,
      root = excluded.root
  `);

  const tx = d.transaction(() => {
    upsertRoot.run(root, now);
    for (const s of songs) {
      upsertSong.run({...s, root, added_at: now});
    }
  });
  tx();
}

export function clearLibrary(): void {
  const d = getDb();
  const tx = d.transaction(() => {
    d.prepare('DELETE FROM songs').run();
    d.prepare('DELETE FROM library_roots').run();
    // tanda_songs cascade on song delete; remove now-empty tandas too.
    d.prepare('DELETE FROM tandas WHERE id NOT IN (SELECT DISTINCT tanda_id FROM tanda_songs)').run();
  });
  tx();
}

/**
 * Human-friendly label for each imported root. Normally just the folder's own
 * name; if two imported libraries share a name (e.g. two `Music` folders) the
 * parent directory is appended so they stay distinct in the tree.
 */
function rootLabels(roots: string[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const r of roots) {
    const b = basename(r) || r;
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const labels = new Map<string, string>();
  for (const r of roots) {
    const b = basename(r) || r;
    if ((counts.get(b) ?? 0) > 1) {
      const parent = basename(dirname(r));
      labels.set(r, parent ? `${b} (${parent})` : r);
    } else {
      labels.set(r, b);
    }
  }
  return labels;
}

/**
 * Build the folder tree. Every imported root becomes its own top-level node, so
 * tandas can be assembled across multiple libraries without their subfolders
 * (e.g. a shared `Tango` folder) merging together.
 */
function buildTree(songs: Song[], roots: string[]): {tree: TreeNode[]; totalFolders: number} {
  const labels = rootLabels(roots);
  const root: TreeNode = {name: '', path: '', children: []};
  const folders = new Set<string>();

  for (const song of songs) {
    const label = labels.get(song.root) ?? (basename(song.root) || 'Library');
    const subSegments = song.folderPath ? song.folderPath.split(' / ') : [];
    const segments = [label, ...subSegments];
    let node = root;
    let acc = '';
    for (const seg of segments) {
      acc = acc ? `${acc} / ${seg}` : seg;
      folders.add(acc);
      node.children = node.children || [];
      let child = node.children.find(c => c.path === acc);
      if (!child) {
        child = {name: seg, path: acc};
        node.children.push(child);
      }
      node = child;
    }
    node.songs = node.songs || [];
    node.songs.push(song);
  }

  const sortTree = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of nodes) if (n.children) sortTree(n.children);
    return nodes;
  };

  return {tree: sortTree(root.children || []), totalFolders: folders.size};
}

export function getLibrary(): Library {
  const d = getDb();
  const rows = d
    .prepare('SELECT * FROM songs ORDER BY folder_path, year, title')
    .all() as SongRow[];
  const songs = rows.map(rowToSong);
  const roots = (d.prepare('SELECT path FROM library_roots').all() as {path: string}[]).map(
    r => r.path,
  );
  const {tree, totalFolders} = buildTree(songs, roots);
  return {tree, songs, totalSongs: songs.length, totalFolders, roots};
}

export function listTandas(): Tanda[] {
  const d = getDb();
  const tandaRows = d.prepare('SELECT * FROM tandas ORDER BY created_at').all() as {
    id: number;
    name: string | null;
    created_at: number;
  }[];
  const songStmt = d.prepare(`
    SELECT s.* FROM tanda_songs ts
    JOIN songs s ON s.id = ts.song_id
    WHERE ts.tanda_id = ?
    ORDER BY ts.position
  `);
  const tagStmt = d.prepare(
    'SELECT cat, label FROM tanda_tags WHERE tanda_id = ? ORDER BY position',
  );
  return tandaRows.map(t => ({
    id: String(t.id),
    name: t.name,
    songs: (songStmt.all(t.id) as SongRow[]).map(rowToSong),
    tags: tagStmt.all(t.id) as TandaTag[],
  }));
}

export type SaveTandaInput = {
  id?: string | null;
  name?: string | null;
  songIds: string[];
  tags?: TandaTag[];
};

/** Trim, drop blanks, and de-dupe tags by (cat, case-insensitive label). */
function cleanTags(tags: TandaTag[] | undefined): TandaTag[] {
  const out: TandaTag[] = [];
  const seen = new Set<string>();
  for (const t of tags ?? []) {
    const label = (t?.label ?? '').trim();
    if (!label) continue;
    const cat = (t?.cat ?? 'custom').trim() || 'custom';
    const key = `${cat}|${label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({cat, label});
  }
  return out;
}

export function saveTanda(input: SaveTandaInput): Tanda {
  const d = getDb();
  const name = input.name && input.name.trim() ? input.name.trim() : null;
  const songIds = input.songIds.map(Number).filter(n => Number.isFinite(n));
  const tags = cleanTags(input.tags);

  const tx = d.transaction(() => {
    let tandaId: number;
    if (input.id != null && Number.isFinite(Number(input.id))) {
      tandaId = Number(input.id);
      d.prepare('UPDATE tandas SET name = ? WHERE id = ?').run(name, tandaId);
      d.prepare('DELETE FROM tanda_songs WHERE tanda_id = ?').run(tandaId);
      d.prepare('DELETE FROM tanda_tags WHERE tanda_id = ?').run(tandaId);
    } else {
      const info = d
        .prepare('INSERT INTO tandas (name, created_at) VALUES (?, ?)')
        .run(name, Date.now());
      tandaId = Number(info.lastInsertRowid);
    }
    const link = d.prepare(
      'INSERT INTO tanda_songs (tanda_id, song_id, position) VALUES (?, ?, ?)',
    );
    songIds.forEach((songId, i) => link.run(tandaId, songId, i));
    const tagLink = d.prepare(
      'INSERT INTO tanda_tags (tanda_id, cat, label, position) VALUES (?, ?, ?, ?)',
    );
    tags.forEach((t, i) => tagLink.run(tandaId, t.cat, t.label, i));
    return tandaId;
  });

  const newId = tx();
  return listTandas().find(t => t.id === String(newId))!;
}

export function deleteTanda(id: string): void {
  const d = getDb();
  d.prepare('DELETE FROM tandas WHERE id = ?').run(Number(id));
}

/**
 * Read all playlists, resolving each item to a live tanda/cortina. Items whose
 * referenced tanda or song no longer exists are silently dropped, so a playlist
 * always reflects the current library.
 */
export function listPlaylists(): Playlist[] {
  const d = getDb();
  const playlistRows = d.prepare('SELECT * FROM playlists ORDER BY created_at').all() as {
    id: number;
    name: string | null;
    created_at: number;
  }[];
  const itemStmt = d.prepare(
    'SELECT kind, ref_id FROM playlist_items WHERE playlist_id = ? ORDER BY position',
  );
  const songStmt = d.prepare('SELECT * FROM songs WHERE id = ?');
  const tandaById = new Map(listTandas().map(t => [t.id, t]));

  return playlistRows.map(p => {
    const rows = itemStmt.all(p.id) as {kind: string; ref_id: number}[];
    const items: PlaylistItem[] = [];
    for (const r of rows) {
      if (r.kind === 'tanda') {
        const tanda = tandaById.get(String(r.ref_id));
        if (tanda) items.push({type: 'tanda', data: tanda});
      } else if (r.kind === 'cortina') {
        const song = songStmt.get(r.ref_id) as SongRow | undefined;
        if (song) items.push({type: 'cortina', data: rowToSong(song)});
      }
    }
    return {id: String(p.id), name: p.name, items};
  });
}

export type SavePlaylistInput = {
  id?: string | null;
  name?: string | null;
  items: {type: 'tanda' | 'cortina'; refId: string}[];
};

export function savePlaylist(input: SavePlaylistInput): Playlist {
  const d = getDb();
  const name = input.name && input.name.trim() ? input.name.trim() : null;

  const tx = d.transaction(() => {
    let playlistId: number;
    if (input.id != null && Number.isFinite(Number(input.id))) {
      playlistId = Number(input.id);
      d.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(name, playlistId);
      d.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(playlistId);
    } else {
      const info = d
        .prepare('INSERT INTO playlists (name, created_at) VALUES (?, ?)')
        .run(name, Date.now());
      playlistId = Number(info.lastInsertRowid);
    }
    const link = d.prepare(
      'INSERT INTO playlist_items (playlist_id, position, kind, ref_id) VALUES (?, ?, ?, ?)',
    );
    input.items.forEach((it, i) => {
      const refId = Number(it.refId);
      if (Number.isFinite(refId)) link.run(playlistId, i, it.type, refId);
    });
    return playlistId;
  });

  const newId = tx();
  return listPlaylists().find(p => p.id === String(newId))!;
}

export function deletePlaylist(id: string): void {
  const d = getDb();
  d.prepare('DELETE FROM playlists WHERE id = ?').run(Number(id));
}

export function getSongPath(id: string): string | null {
  const d = getDb();
  const row = d.prepare('SELECT path FROM songs WHERE id = ?').get(Number(id)) as
    | {path: string}
    | undefined;
  return row ? row.path : null;
}

/**
 * Delete the given song ids in one transaction, then clean up anything left
 * dangling: library roots that no longer hold any songs (so the empty folder
 * disappears from the tree) and tandas that lost all of their songs.
 */
function deleteSongs(d: Database.Database, ids: number[]): void {
  if (!ids.length) return;
  const del = d.prepare('DELETE FROM songs WHERE id = ?');
  const tx = d.transaction(() => {
    for (const id of ids) del.run(id);
    d.prepare(
      'DELETE FROM library_roots WHERE path NOT IN (SELECT DISTINCT root FROM songs)',
    ).run();
    d.prepare(
      'DELETE FROM tandas WHERE id NOT IN (SELECT DISTINCT tanda_id FROM tanda_songs)',
    ).run();
  });
  tx();
}

/**
 * Remove the given songs from the library by id (used when the DJ deletes a
 * folder from the app). Only the database records go — the files stay on disk.
 * Empty roots and tandas are cleaned up by deleteSongs. Returns the fresh library.
 */
export function deleteSongsByIds(ids: string[]): Library {
  const d = getDb();
  const numeric = ids.map(Number).filter(n => Number.isFinite(n));
  deleteSongs(d, numeric);
  return getLibrary();
}

/**
 * Remove a single song from the library, but only if its file is actually gone
 * from disk. Used reactively when playback fails so we never delete a track for
 * a transient/codec error. Returns whether it was removed and the fresh library.
 */
export function removeSongIfMissing(
  id: string,
): {removed: boolean; song: Song | null; library: Library} {
  const d = getDb();
  const row = d.prepare('SELECT * FROM songs WHERE id = ?').get(Number(id)) as
    | SongRow
    | undefined;
  if (!row) return {removed: false, song: null, library: getLibrary()};
  if (existsSync(row.path)) {
    return {removed: false, song: rowToSong(row), library: getLibrary()};
  }
  deleteSongs(d, [row.id]);
  return {removed: true, song: rowToSong(row), library: getLibrary()};
}

/**
 * Sweep the whole library and drop any song whose file no longer exists on disk
 * (e.g. the folder was moved or deleted while the app was closed). Runs on load
 * so phantom folders never linger in the tree. Returns the count + fresh library.
 */
export function pruneMissingSongs(): {removed: number; library: Library} {
  const d = getDb();
  const rows = d.prepare('SELECT id, path FROM songs').all() as {id: number; path: string}[];
  const missing = rows.filter(r => !existsSync(r.path)).map(r => r.id);
  deleteSongs(d, missing);
  return {removed: missing.length, library: getLibrary()};
}

export class DatabaseModule implements AppModule {
  enable(_context: ModuleContext): void {
    getDb();
  }
}

export function databaseModule(): DatabaseModule {
  return new DatabaseModule();
}
