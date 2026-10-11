import type {AppModule} from '../AppModule.js';
import type {ModuleContext} from '../ModuleContext.js';
import {app} from 'electron';
import {basename, dirname, join, sep} from 'node:path';
import {existsSync} from 'node:fs';
import Database from 'better-sqlite3';
import {normalizeYear, yearFromFilename} from '../services/scan.js';

export type SongRow = {
  id: number;
  path: string;
  title: string;
  artist: string;
  singer: string;
  album: string | null;
  year: number | null;
  year_locked: number;
  duration_sec: number | null;
  genre: string;
  // Cortina is a usage flag, orthogonal to genre: a song marked for use as a
  // floor-clearing cortina still has its real musical genre. `is_cortina` is the
  // flag; `cortina_locked` marks it as DJ-set so a re-scan won't clobber it.
  is_cortina: number;
  cortina_locked: number;
  // Set when the DJ edited this song in Compás without writing the file (or the
  // write failed): a re-scan must then keep the app's title/artist/singer/album/
  // year instead of re-reading them from the file's own tags.
  meta_locked: number;
  folder: string;
  folder_path: string;
  root: string;
  added_at: number;
  // Loudness/silence analysis (see services/loudness.ts). Null until analyzed.
  loudness_lufs: number | null;
  loudness_peak: number | null;
  content_start_samples: number | null;
  content_end_samples: number | null;
  sample_rate: number | null;
  detect_threshold_db: number | null;
  analysis_status: string;
  analysis_version: number;
  analyzed_at: number | null;
  // The file's modification time (ms) as of the last tag read; null until the
  // first startup after the column was added records a baseline.
  mtime_ms: number | null;
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
  // True when this song is flagged for use as a cortina (independent of genre).
  isCortina: boolean;
  folder: string;
  folderPath: string;
  root: string;
  // Loudness/silence analysis — the player reads these to normalize volume and
  // skip leading/trailing silence. Null/false until the background pass runs.
  loudnessLufs: number | null;
  loudnessPeak: number | null;
  contentStartSamples: number | null;
  contentEndSamples: number | null;
  sampleRate: number | null;
  analyzed: boolean;
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
  // False for a tanda that exists only inside an imported playlist.
  inCollection: boolean;
  // The Community post this tanda was shared as, or null when it isn't shared.
  sharedPostId: string | null;
  // Epoch milliseconds when the tanda was first saved (the DB's created_at),
  // so the views can order by creation as well as by name.
  createdAt: number;
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

/**
 * Add any missing columns to an existing table. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so we diff against `PRAGMA table_info` first.
 * This lets us evolve the schema without a wipe-and-reimport. Returns the names
 * of the columns it added.
 */
function addColumns(
  d: Database.Database,
  table: string,
  columns: [name: string, def: string][],
): string[] {
  const existing = new Set(
    (d.prepare(`PRAGMA table_info(${table})`).all() as {name: string}[]).map(c => c.name),
  );
  const added: string[] = [];
  for (const [name, def] of columns) {
    if (existing.has(name)) continue;
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
    added.push(name);
  }
  return added;
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

    -- Community: the post each tanda was shared as, per account — two DJs who
    -- sign in on the same computer each see only their own "Shared".
    CREATE TABLE IF NOT EXISTS tanda_shares (
      tanda_id INTEGER NOT NULL REFERENCES tandas(id) ON DELETE CASCADE,
      user_id  TEXT NOT NULL,
      post_id  TEXT NOT NULL,
      PRIMARY KEY (tanda_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS library_roots (
      path     TEXT PRIMARY KEY,
      added_at INTEGER NOT NULL
    );

    -- Folder-level cortina flag, keyed by (root, folder_path). A flagged folder
    -- means "the songs in here are cortinas": existing songs are flagged when
    -- the DJ sets it, and newly-imported songs under the folder inherit it.
    CREATE TABLE IF NOT EXISTS folder_flags (
      root        TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      is_cortina  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (root, folder_path)
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

  // Loudness/silence analysis columns. Raw measurements only — the player
  // derives the playback gain (from a target LUFS setting) and the trim offsets
  // (from a pad setting) on the fly, so changing those never needs a re-analysis.
  // Tandas created by a playlist import live only inside that playlist until
  // the DJ keeps one: they stay out of "My tandas" and are removed once no
  // playlist uses them.
  addColumns(d, 'tandas', [
    ['in_collection', 'INTEGER NOT NULL DEFAULT 1'],
    // Community: id of the post a tanda was shared as, from before shares were
    // kept per account (tanda_shares). Read once, then moved there by
    // claimLegacyShares for the account that wrote the post.
    ['shared_post_id', 'TEXT'],
  ]);
  const addedSongColumns = addColumns(d, 'songs', [
    ['loudness_lufs', 'REAL'],
    ['loudness_peak', 'REAL'],
    ['content_start_samples', 'INTEGER'],
    ['content_end_samples', 'INTEGER'],
    ['sample_rate', 'INTEGER'],
    ['detect_threshold_db', 'REAL'],
    ['analysis_status', "TEXT NOT NULL DEFAULT 'pending'"], // 'pending' | 'done' | 'failed'
    ['analysis_version', 'INTEGER NOT NULL DEFAULT 0'],
    ['analyzed_at', 'INTEGER'],
    // Provenance flags: set when Smart Organize (or a manual edit) authors the
    // orchestra/year, so a later re-scan of the file does NOT overwrite the
    // app-set value from the file's own tags. This is what makes "Compás-only"
    // organization durable (singer/genre are already preserved on re-scan).
    ['orq_locked', 'INTEGER NOT NULL DEFAULT 0'],
    ['year_locked', 'INTEGER NOT NULL DEFAULT 0'],
    // Set by a song edit that was kept inside Compás (the file's tags were not
    // written, by choice or because the write failed): every editable field is
    // then preserved on re-scan, so the edit is durable without touching disk.
    ['meta_locked', 'INTEGER NOT NULL DEFAULT 0'],
    // The file's modification time when its tags were last read, so the startup
    // reconcile re-reads only files edited while the app was closed.
    ['mtime_ms', 'INTEGER'],
    // Cortina is now a usage flag separate from genre (see SongRow). New DBs get
    // it as a column; older DBs gain it here, then the migration below moves any
    // legacy genre='cortina' rows onto the flag.
    ['is_cortina', 'INTEGER NOT NULL DEFAULT 0'],
    ['cortina_locked', 'INTEGER NOT NULL DEFAULT 0'],
    // Whether the file's genre tag has been considered for this song's style.
    // Imports used to ignore the tag and stamp 'mixed' on every song in a folder
    // without a style; those rows stay 0 until the startup backfill (see
    // listMixedWithUncheckedTag) has read their tag.
    ['genre_tag_checked', 'INTEGER NOT NULL DEFAULT 0'],
  ]);
  // Only the old 'mixed' rows are owed that backfill: a song the DJ later
  // re-types to Mixed must not be flipped back by its tag.
  if (addedSongColumns.includes('genre_tag_checked')) {
    d.exec(`UPDATE songs SET genre_tag_checked = 1 WHERE genre <> 'mixed'`);
  }
  // The background worker repeatedly asks "what's left?" — keep that cheap.
  d.exec(
    `CREATE INDEX IF NOT EXISTS idx_songs_analysis_status ON songs(analysis_status)`,
  );

  // One-time migration: "cortina" used to be a genre value, which destroyed the
  // song's real musical genre. Move those rows onto the is_cortina flag (and
  // lock it, since it reflects DJ intent), and reset the lost genre to unknown.
  // Seed folder_flags from any folder whose songs were all cortinas, so future
  // imports into those folders inherit the flag. Guarded so it runs only while
  // legacy rows still exist.
  const legacy = d.prepare(`SELECT COUNT(*) AS n FROM songs WHERE genre = 'cortina'`).get() as {
    n: number;
  };
  if (legacy.n > 0) {
    const tx = d.transaction(() => {
      d.prepare(
        `INSERT OR IGNORE INTO folder_flags (root, folder_path, is_cortina)
         SELECT DISTINCT root, folder_path, 1 FROM songs WHERE genre = 'cortina'`,
      ).run();
      d.prepare(
        `UPDATE songs SET is_cortina = 1, cortina_locked = 1, genre = 'unknown'
         WHERE genre = 'cortina'`,
      ).run();
    });
    tx();
  }
}

function fmtDur(sec: number | null | undefined): string {
  if (!sec || !isFinite(sec) || sec <= 0) return '0:00';
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The year to show for a song. A DJ-locked value (set in Smart Organize) is
 * authoritative; otherwise a year spelled out in the filename wins over the tag
 * (tags often carry a remaster/release date), and anything implausible — or out
 * of the 1910–2026 window — is reported as "unknown" (null).
 */
function resolveYear(r: SongRow): number | null {
  if (r.year_locked) return normalizeYear(r.year);
  return yearFromFilename(r.path) ?? normalizeYear(r.year);
}

function rowToSong(r: SongRow): Song {
  return {
    id: String(r.id),
    title: r.title,
    orq: r.artist,
    singer: r.singer,
    album: r.album,
    year: resolveYear(r),
    dur: fmtDur(r.duration_sec),
    durationSec: r.duration_sec,
    genre: r.genre,
    isCortina: r.is_cortina === 1,
    folder: r.folder,
    folderPath: r.folder_path,
    root: r.root,
    loudnessLufs: r.loudness_lufs,
    loudnessPeak: r.loudness_peak,
    contentStartSamples: r.content_start_samples,
    contentEndSamples: r.content_end_samples,
    sampleRate: r.sample_rate,
    analyzed: r.analysis_status === 'done',
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
  // Modification time of the file when its tags were read (see scanFile).
  mtimeMs?: number | null;
  genre: string;
  // The style named by the file's own genre tag (null when it names none). The
  // import uses it for songs whose folder carries no style of its own.
  tagStyle?: string | null;
  // Set by the scanner when the song lives under a folder named like a cortina
  // folder. Orthogonal to genre.
  isCortina?: boolean;
  folder: string;
  folderPath: string;
};

/** Record an import root, leaving an existing one untouched. */
function upsertRoot(d: Database.Database, root: string): void {
  d.prepare(
    'INSERT INTO library_roots (path, added_at) VALUES (?, ?) ON CONFLICT(path) DO NOTHING',
  ).run(root, Date.now());
}

/** Upsert scanned songs (keyed by absolute path) and record the import root. */
export function importSongs(root: string, songs: ScannedSong[]): void {
  const d = getDb();
  const now = Date.now();

  const upsertSong = d.prepare(`
    INSERT INTO songs (path, title, artist, singer, album, year, duration_sec, mtime_ms, genre, genre_tag_checked, is_cortina, folder, folder_path, root, added_at)
    VALUES (@path, @title, @artist, @singer, @album, @year, @durationSec, @mtimeMs, @genre, 1, @isCortina, @folder, @folderPath, @root, @added_at)
    ON CONFLICT(path) DO UPDATE SET
      title = CASE WHEN songs.meta_locked = 1 THEN songs.title ELSE excluded.title END,
      artist = CASE WHEN songs.orq_locked = 1 OR songs.meta_locked = 1 THEN songs.artist ELSE excluded.artist END,
      singer = CASE WHEN songs.meta_locked = 1 THEN songs.singer WHEN excluded.singer <> '' THEN excluded.singer ELSE songs.singer END,
      album = CASE WHEN songs.meta_locked = 1 THEN songs.album ELSE excluded.album END,
      year = CASE WHEN songs.year_locked = 1 OR songs.meta_locked = 1 THEN songs.year ELSE excluded.year END,
      is_cortina = CASE WHEN songs.cortina_locked = 1 THEN songs.is_cortina ELSE excluded.is_cortina END,
      duration_sec = excluded.duration_sec,
      mtime_ms = excluded.mtime_ms,
      folder = excluded.folder,
      folder_path = excluded.folder_path,
      root = excluded.root
  `);
  // Note: `genre` is intentionally NOT refreshed on conflict, and `singer`
  // follows the file only when the file actually credits one: both are editable
  // by the DJ (Smart Organize sets them without a lock) — so a re-scan of an
  // existing song (e.g. the watcher reacting to an in-place tag edit) must not
  // reset singer to '' or genre to its folder-derived default. A singer credit
  // in the file ("Orchestra - Singer") does win, so a singer fixed in another
  // app shows up here like a title fix would. `artist`/`year`/`is_cortina` are
  // preserved when locked (set by Smart Organize / a manual cortina toggle), and
  // every editable field is preserved when `meta_locked` is set (a song edit
  // kept inside Compás), so a Compás-only edit survives the file being re-scanned.

  // Folders the DJ flagged as cortinas under this root — newly-imported songs in
  // them inherit the flag regardless of the folder-name heuristic.
  const flaggedFolders = new Set(
    (
      d
        .prepare('SELECT folder_path FROM folder_flags WHERE root = ? AND is_cortina = 1')
        .all(root) as {folder_path: string}[]
    ).map(r => r.folder_path),
  );

  const tx = d.transaction(() => {
    upsertRoot(d, root);
    for (const s of songs) {
      const isCortina = s.isCortina || flaggedFolders.has(s.folderPath) ? 1 : 0;
      upsertSong.run({...s, mtimeMs: s.mtimeMs ?? null, isCortina, root, added_at: now});
    }
  });
  tx();
}

/** Persist per-folder cortina flags (folder_flags only, no song updates). Used
 *  by the import flow, where songs aren't in the DB yet — importSongs then reads
 *  these to flag the incoming rows. A false entry clears the folder's flag. */
export function setFolderFlags(root: string, flags: Record<string, boolean>): void {
  const d = getDb();
  const up = d.prepare(
    `INSERT INTO folder_flags (root, folder_path, is_cortina) VALUES (?, ?, ?)
     ON CONFLICT(root, folder_path) DO UPDATE SET is_cortina = excluded.is_cortina`,
  );
  const tx = d.transaction(() => {
    for (const [folderPath, on] of Object.entries(flags)) {
      up.run(root, folderPath, on ? 1 : 0);
    }
  });
  tx();
}

/** Flag (or unflag) songs as cortinas by id. DJ intent, so it locks the flag
 *  against later re-scans. Compás-only; the audio files are untouched. */
export function setSongCortina(ids: string[], isCortina: boolean): Library {
  const d = getDb();
  const stmt = d.prepare(
    'UPDATE songs SET is_cortina = ?, cortina_locked = 1 WHERE id = ?',
  );
  const flag = isCortina ? 1 : 0;
  const tx = d.transaction(() => {
    for (const id of ids) stmt.run(flag, Number(id));
  });
  tx();
  return getLibrary();
}

/** Flag (or unflag) a whole folder as cortinas: persist it in folder_flags (so
 *  future imports inherit) and apply it to every song currently in the folder. */
export function setFolderCortina(
  root: string,
  folderPath: string,
  isCortina: boolean,
): Library {
  const d = getDb();
  const flag = isCortina ? 1 : 0;
  const tx = d.transaction(() => {
    d.prepare(
      `INSERT INTO folder_flags (root, folder_path, is_cortina) VALUES (?, ?, ?)
       ON CONFLICT(root, folder_path) DO UPDATE SET is_cortina = excluded.is_cortina`,
    ).run(root, folderPath, flag);
    d.prepare(
      'UPDATE songs SET is_cortina = ?, cortina_locked = 1 WHERE root = ? AND folder_path = ?',
    ).run(flag, root, folderPath);
  });
  tx();
  return getLibrary();
}

/** Absolute paths of every imported library root (oldest first). */
export function listLibraryRoots(): string[] {
  const d = getDb();
  return (
    d.prepare('SELECT path FROM library_roots ORDER BY added_at').all() as {path: string}[]
  ).map(r => r.path);
}

/**
 * Imported roots whose folder no longer exists on disk — typically because the
 * library was moved or its drive is unmounted. These are *not* pruned (their
 * songs stay so the DJ can relink via relocateRoot); the UI surfaces them with a
 * "Locate…" action instead.
 */
export function listMissingRoots(): string[] {
  return listLibraryRoots().filter(r => !existsSync(r));
}

/**
 * Relocate a whole imported root to a new on-disk location, rebasing every song
 * under it onto `newRoot` in place. A move preserves the folder layout beneath
 * the root, so this is a pure prefix swap: song ids — and therefore loudness
 * analysis and tanda/playlist membership — survive untouched, with no re-scan or
 * re-analysis. `folder_path` is relative to the root and so is unchanged; only
 * `folder` for songs sitting directly in the root is re-derived, since it mirrors
 * the root's own name. The root's folder_flags move across too. Returns the
 * number of songs rebased (0 if `oldRoot` isn't a known root) and the fresh
 * library.
 */
export function relocateRoot(
  oldRoot: string,
  newRoot: string,
): {moved: number; library: Library} {
  const d = getDb();
  if (oldRoot === newRoot) return {moved: 0, library: getLibrary()};
  const oldPrefix = oldRoot.endsWith(sep) ? oldRoot : oldRoot + sep;
  const newName = basename(newRoot) || newRoot;
  const rows = d
    .prepare('SELECT id, path, folder_path FROM songs WHERE root = ?')
    .all(oldRoot) as {id: number; path: string; folder_path: string}[];

  const tx = d.transaction(() => {
    const upd = d.prepare('UPDATE songs SET path = ?, root = ?, folder = ? WHERE id = ?');
    for (const r of rows) {
      // Defensive: only rebase paths actually nested under the old root.
      if (!r.path.startsWith(oldPrefix)) continue;
      const rel = r.path.slice(oldPrefix.length);
      const newPath = join(newRoot, rel);
      // Subfolder songs keep their leaf folder name; root-level songs (no
      // folder_path) take the new root's name, mirroring scanFile.
      const folder = r.folder_path ? r.folder_path.split(' / ').pop()! : newName;
      upd.run(newPath, newRoot, folder, r.id);
    }
    // Carry the registration and folder cortina flags onto the new path. OR
    // REPLACE guards the rare case where newRoot was already a known root.
    d.prepare('UPDATE OR REPLACE library_roots SET path = ? WHERE path = ?').run(newRoot, oldRoot);
    d.prepare('UPDATE OR REPLACE folder_flags SET root = ? WHERE root = ?').run(newRoot, oldRoot);
  });
  tx();
  return {moved: rows.length, library: getLibrary()};
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

// The Community account signed in on this computer (null when none): the
// "Shared" markers listTandas reports are this account's.
let shareAccount: string | null = null;

/** Set whose "Shared" markers listTandas reports. */
export function setShareAccount(userId: string | null): void {
  shareAccount = userId;
}

export function listTandas(): Tanda[] {
  const d = getDb();
  const tandaRows = d.prepare('SELECT * FROM tandas ORDER BY created_at').all() as {
    id: number;
    name: string | null;
    created_at: number;
    in_collection: number;
    shared_post_id: string | null;
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
  const shares = new Map<number, string>();
  if (shareAccount) {
    const rows = d.prepare('SELECT tanda_id, post_id FROM tanda_shares WHERE user_id = ?').all(shareAccount) as {
      tanda_id: number;
      post_id: string;
    }[];
    for (const r of rows) shares.set(r.tanda_id, r.post_id);
  }
  return tandaRows.map(t => ({
    id: String(t.id),
    name: t.name,
    songs: (songStmt.all(t.id) as SongRow[]).map(rowToSong),
    tags: tagStmt.all(t.id) as TandaTag[],
    inCollection: t.in_collection !== 0,
    sharedPostId: shares.get(t.id) ?? null,
    createdAt: t.created_at,
  }));
}

/** The DJ's own tandas ("My tandas"), without playlist-only ones. */
export function listCollectionTandas(): Tanda[] {
  return listTandas().filter(t => t.inCollection);
}

/** Record (or, with null, clear) the post a tanda was shared as by `userId` —
 *  the account that made (or took down) the post, named by the caller rather
 *  than read from whoever is signed in at this moment. */
export function setTandaSharedPost(id: string, postId: string | null, userId: string): void {
  const d = getDb();
  if (postId) {
    d.prepare('INSERT OR REPLACE INTO tanda_shares (tanda_id, user_id, post_id) VALUES (?, ?, ?)').run(
      Number(id),
      userId,
      postId,
    );
  } else {
    d.prepare('DELETE FROM tanda_shares WHERE tanda_id = ? AND user_id = ?').run(Number(id), userId);
  }
}

/** Forget a Community post that no longer exists, whichever tanda pointed at it. */
export function clearSharedPost(postId: string): void {
  getDb().prepare('DELETE FROM tanda_shares WHERE post_id = ?').run(postId);
}

/** Shares recorded before they were kept per account: tanda id → post id. */
export function listLegacyShares(): {tandaId: string; postId: string}[] {
  const rows = getDb()
    .prepare('SELECT id, shared_post_id FROM tandas WHERE shared_post_id IS NOT NULL')
    .all() as {id: number; shared_post_id: string}[];
  return rows.map(r => ({tandaId: String(r.id), postId: r.shared_post_id}));
}

/** File legacy shares under the account that wrote them (`owned` holds the
 *  post ids that are the signed-in account's), and drop the old column's
 *  value for those — the rest wait for their own account to sign in. */
export function claimLegacyShares(userId: string, owned: Set<string>): void {
  const d = getDb();
  const insert = d.prepare('INSERT OR IGNORE INTO tanda_shares (tanda_id, user_id, post_id) VALUES (?, ?, ?)');
  const clear = d.prepare('UPDATE tandas SET shared_post_id = NULL WHERE id = ?');
  d.transaction(() => {
    for (const {tandaId, postId} of listLegacyShares()) {
      if (!owned.has(postId)) continue;
      insert.run(Number(tandaId), userId, postId);
      clear.run(Number(tandaId));
    }
  })();
}

/** Keep a playlist-only tanda in "My tandas". */
export function keepTanda(id: string): void {
  getDb().prepare('UPDATE tandas SET in_collection = 1 WHERE id = ?').run(Number(id));
}

/** Drop playlist-only tandas that no playlist references any more. */
function pruneOrphanTandas(d: Database.Database): void {
  d.prepare(
    `DELETE FROM tandas WHERE in_collection = 0 AND id NOT IN
       (SELECT ref_id FROM playlist_items WHERE kind = 'tanda')`,
  ).run();
}

export type SaveTandaInput = {
  id?: string | null;
  name?: string | null;
  songIds: string[];
  tags?: TandaTag[];
  // Only read when creating: false makes a playlist-only tanda.
  inCollection?: boolean;
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
        .prepare('INSERT INTO tandas (name, created_at, in_collection) VALUES (?, ?, ?)')
        .run(name, Date.now(), input.inCollection === false ? 0 : 1);
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
    pruneOrphanTandas(d);
    return playlistId;
  });

  const newId = tx();
  return listPlaylists().find(p => p.id === String(newId))!;
}

export function deletePlaylist(id: string): void {
  const d = getDb();
  d.prepare('DELETE FROM playlists WHERE id = ?').run(Number(id));
  pruneOrphanTandas(d);
}

/** Absolute path of every library song, keyed by song id. Used by the
 *  playlist exporter (write paths) and importer (resolve paths). */
export function listSongPaths(): Map<string, string> {
  const d = getDb();
  const rows = d.prepare('SELECT id, path FROM songs').all() as {id: number; path: string}[];
  return new Map(rows.map(r => [String(r.id), r.path]));
}

export function getSongPath(id: string): string | null {
  const d = getDb();
  const row = d.prepare('SELECT path FROM songs WHERE id = ?').get(Number(id)) as
    | {path: string}
    | undefined;
  return row ? row.path : null;
}

/** Editable metadata for a single song. `orq` maps to the DB's `artist` column. */
export type UpdateSongInput = {
  id: string;
  title: string;
  orq: string;
  singer: string;
  album: string | null;
  year: number | null;
  genre: string;
  // Optional: when present, also sets the cortina usage flag (and locks it).
  isCortina?: boolean;
  // Also write the edit into the file's tags (the DJ's Settings choice). The
  // database is updated either way.
  writeFile?: boolean;
};

/**
 * Update a song's editable metadata in the database (the on-disk file tags are
 * written separately, see services/tags.ts). The id, file path and all
 * loudness/analysis fields are preserved, so editing metadata never triggers a
 * re-analysis or drops the song from its tandas/playlists. `lock` records that
 * the file was NOT updated to match (the DJ keeps edits inside Compás, or the
 * write failed), so a later re-scan keeps these values rather than the file's
 * tags; when the file was written the two agree and the lock is cleared so
 * edits made in other apps can flow in again. Returns the updated song, or
 * null if the id is unknown.
 */
export function updateSong(input: UpdateSongInput, opts: {lock: boolean}): Song | null {
  const d = getDb();
  const id = Number(input.id);
  if (!Number.isFinite(id)) return null;
  const exists = d.prepare('SELECT id FROM songs WHERE id = ?').get(id);
  if (!exists) return null;
  // The cortina flag is optional on this input; when provided, set it and lock
  // it (so a re-scan won't revert the DJ's choice), otherwise leave it untouched.
  d.prepare(
    `UPDATE songs SET
       title = @title,
       artist = @orq,
       singer = @singer,
       album = @album,
       year = @year,
       genre = @genre,
       meta_locked = @metaLocked,
       is_cortina = CASE WHEN @setCortina = 1 THEN @isCortina ELSE is_cortina END,
       cortina_locked = CASE WHEN @setCortina = 1 THEN 1 ELSE cortina_locked END
     WHERE id = @id`,
  ).run({
    id,
    metaLocked: opts.lock ? 1 : 0,
    title: input.title ?? '',
    orq: input.orq ?? '',
    singer: input.singer ?? '',
    album: input.album ?? null,
    year: input.year ?? null,
    genre: input.genre || 'tango',
    setCortina: input.isCortina !== undefined ? 1 : 0,
    isCortina: input.isCortina ? 1 : 0,
  });
  const row = d.prepare('SELECT * FROM songs WHERE id = ?').get(id) as SongRow;
  return rowToSong(row);
}

/** One song's approved Smart Organize changes. Any omitted field is left as-is.
 *  Setting `orq`/`year` also locks them so a re-scan won't revert the value. */
export type SmartOrganizeChange = {
  id: string;
  orq?: string;
  singer?: string;
  year?: number | null;
  genre?: string;
};

/**
 * Apply a batch of Smart Organize changes in a single transaction (Compás-only:
 * the database is updated, the files on disk are never touched). Editing
 * `orq`/`year` sets the corresponding lock so the value survives a later
 * re-scan. Returns the fresh library.
 */
export function applySmartOrganize(changes: SmartOrganizeChange[]): Library {
  const d = getDb();
  const tx = d.transaction(() => {
    for (const c of changes) {
      const id = Number(c.id);
      if (!Number.isFinite(id)) continue;
      const sets: string[] = [];
      const params: Record<string, unknown> = {id};
      if (c.orq !== undefined) {
        sets.push('artist = @orq', 'orq_locked = 1');
        params.orq = c.orq ?? '';
      }
      if (c.singer !== undefined) {
        sets.push('singer = @singer');
        params.singer = c.singer ?? '';
      }
      if (c.year !== undefined) {
        sets.push('year = @year', 'year_locked = 1');
        params.year = c.year ?? null;
      }
      if (c.genre !== undefined) {
        sets.push('genre = @genre');
        params.genre = c.genre || 'tango';
      }
      if (sets.length === 0) continue;
      d.prepare(`UPDATE songs SET ${sets.join(', ')} WHERE id = @id`).run(params);
    }
  });
  tx();
  return getLibrary();
}

/**
 * Set the genre (style) of many songs in one transaction (Compás-only: the DB
 * is updated, files are untouched). Used by the import/re-type tree tool. genre
 * is preserved across re-scans (see importSongs), so this is durable. Returns
 * the fresh library.
 */
export function setSongGenres(updates: {id: string; genre: string}[]): Library {
  const d = getDb();
  const stmt = d.prepare('UPDATE songs SET genre = @genre WHERE id = @id');
  const tx = d.transaction(() => {
    for (const u of updates) {
      const id = Number(u.id);
      if (!Number.isFinite(id)) continue;
      stmt.run({id, genre: u.genre || 'unknown'});
    }
  });
  tx();
  return getLibrary();
}

/** Resolve a song's editable, file-backed tags (used before writing the file). */
export function getSongTags(
  id: string,
): {path: string; title: string; orq: string; album: string | null; year: number | null; genre: string} | null {
  const d = getDb();
  const row = d.prepare('SELECT path, title, artist, album, year, genre FROM songs WHERE id = ?').get(
    Number(id),
  ) as
    | {path: string; title: string; artist: string; album: string | null; year: number | null; genre: string}
    | undefined;
  if (!row) return null;
  return {path: row.path, title: row.title, orq: row.artist, album: row.album, year: row.year, genre: row.genre};
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
 * Remove a single song identified by its absolute file `path` (used by the
 * filesystem watcher when a track is deleted on disk). Empty roots and tandas
 * are cleaned up by deleteSongs. Returns whether a row was removed.
 */
export function removeSongByPath(path: string): boolean {
  const d = getDb();
  const row = d.prepare('SELECT id FROM songs WHERE path = ?').get(path) as
    | {id: number}
    | undefined;
  if (!row) return false;
  deleteSongs(d, [row.id]);
  return true;
}

/** Every song path currently recorded under `root`, with its duration. Used by
 *  the startup reconcile to diff the DB against what's really on disk (durations
 *  let it pair a move performed while the app was closed). */
export function listSongPathsByRoot(
  root: string,
): {path: string; durationSec: number | null; mtimeMs: number | null}[] {
  const d = getDb();
  return (
    d.prepare('SELECT path, duration_sec, mtime_ms FROM songs WHERE root = ?').all(root) as {
      path: string;
      duration_sec: number | null;
      mtime_ms: number | null;
    }[]
  ).map(r => ({path: r.path, durationSec: r.duration_sec, mtimeMs: r.mtime_ms}));
}

/**
 * Record the current modification time of songs that have none yet (the first
 * startup after the column was introduced). Tags are deliberately not re-read
 * here: this only sets the baseline that later startups compare against.
 */
export function setSongMtimes(entries: {path: string; mtimeMs: number}[]): void {
  if (entries.length === 0) return;
  const d = getDb();
  const stmt = d.prepare('UPDATE songs SET mtime_ms = ? WHERE path = ? AND mtime_ms IS NULL');
  const tx = d.transaction(() => {
    for (const e of entries) stmt.run(e.mtimeMs, e.path);
  });
  tx();
}

/** Whether a song exists for `path`, and its duration (used to pair renames). */
export function getSongMetaByPath(
  path: string,
): {id: number; durationSec: number | null} | null {
  const d = getDb();
  const row = d.prepare('SELECT id, duration_sec FROM songs WHERE path = ?').get(path) as
    | {id: number; duration_sec: number | null}
    | undefined;
  return row ? {id: row.id, durationSec: row.duration_sec} : null;
}

/**
 * Songs still 'mixed' from an import that never looked at their genre tag —
 * the work list for the startup backfill.
 */
export function listMixedWithUncheckedTag(): {id: number; path: string; root: string}[] {
  return getDb()
    .prepare(`SELECT id, path, root FROM songs WHERE genre = 'mixed' AND genre_tag_checked = 0`)
    .all() as {id: number; path: string; root: string}[];
}

/**
 * Record the backfill's findings: each song's tag is now checked, and a song
 * whose tag names a style takes it — unless the DJ re-typed it in the meantime.
 * Returns how many songs changed style.
 */
export function applyTagStyles(results: {id: number; style: string | null}[]): number {
  const d = getDb();
  const setStyle = d.prepare(`UPDATE songs SET genre = ? WHERE id = ? AND genre = 'mixed'`);
  const setChecked = d.prepare('UPDATE songs SET genre_tag_checked = 1 WHERE id = ?');
  let changed = 0;
  const tx = d.transaction(() => {
    for (const r of results) {
      if (r.style) changed += setStyle.run(r.style, r.id).changes;
      setChecked.run(r.id);
    }
  });
  tx();
  return changed;
}

/**
 * Move a song from `oldPath` to a new path/metadata in place (used when the
 * watcher detects a rename or folder move). Crucially this keeps the song's id,
 * so its loudness/silence analysis and any tanda/playlist membership survive the
 * rename instead of being dropped and re-analyzed. Returns whether it moved.
 */
export function renameSong(oldPath: string, root: string, song: ScannedSong): boolean {
  const d = getDb();
  const row = d.prepare('SELECT id FROM songs WHERE path = ?').get(oldPath) as
    | {id: number}
    | undefined;
  if (!row) return false;
  const tx = d.transaction(() => {
    // Guard against a stray row already sitting on the destination path.
    const clash = d.prepare('SELECT id FROM songs WHERE path = ?').get(song.path) as
      | {id: number}
      | undefined;
    if (clash && clash.id !== row.id) deleteSongs(d, [clash.id]);
    upsertRoot(d, root);
    // A move re-derives the file-backed fields, but preserves the DJ's app-only
    // `genre` (omitted from SET), a `singer` the file doesn't credit, any locked
    // `artist`/`year` set by Smart Organize and everything under `meta_locked`
    // — mirroring importSongs so an edit isn't lost on a move.
    d.prepare(
      `UPDATE songs SET
         path = @path,
         title = CASE WHEN meta_locked = 1 THEN title ELSE @title END,
         artist = CASE WHEN orq_locked = 1 OR meta_locked = 1 THEN artist ELSE @artist END,
         singer = CASE WHEN meta_locked = 1 THEN singer WHEN @singer <> '' THEN @singer ELSE singer END,
         album = CASE WHEN meta_locked = 1 THEN album ELSE @album END,
         year = CASE WHEN year_locked = 1 OR meta_locked = 1 THEN year ELSE @year END,
         duration_sec = @durationSec,
         mtime_ms = @mtimeMs,
         folder = @folder, folder_path = @folderPath, root = @root
       WHERE id = @id`,
    ).run({
      path: song.path,
      title: song.title,
      artist: song.artist,
      singer: song.singer,
      album: song.album,
      year: song.year,
      durationSec: song.durationSec,
      mtimeMs: song.mtimeMs ?? null,
      folder: song.folder,
      folderPath: song.folderPath,
      root,
      id: row.id,
    });
    // The previous root may now be empty (a move across libraries).
    d.prepare(
      'DELETE FROM library_roots WHERE path NOT IN (SELECT DISTINCT root FROM songs)',
    ).run();
  });
  tx();
  return true;
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
 * Sweep the library and drop any song whose file is gone *while its root still
 * exists* (e.g. individual tracks deleted on disk). Runs on load so phantom
 * folders never linger in the tree. Songs under a root that has vanished
 * entirely are left intact — that usually means the library was moved or its
 * drive unmounted, and we want the DJ to relink it (relocateRoot) rather than
 * silently lose its analysis and tanda membership. Returns count + fresh library.
 */
export function pruneMissingSongs(): {removed: number; library: Library} {
  const d = getDb();
  const liveRoots = new Set(listLibraryRoots().filter(r => existsSync(r)));
  const rows = d.prepare('SELECT id, path, root FROM songs').all() as {
    id: number;
    path: string;
    root: string;
  }[];
  const missing = rows
    .filter(r => liveRoots.has(r.root) && !existsSync(r.path))
    .map(r => r.id);
  deleteSongs(d, missing);
  return {removed: missing.length, library: getLibrary()};
}

/**
 * Bump when the analysis algorithm or thresholds change so the startup sweep
 * re-processes everything measured by an older version.
 */
export const ANALYSIS_VERSION = 1;

/** Result of one loudness/silence pass (raw measurements, see services/loudness.ts). */
export type AnalysisResult = {
  loudnessLufs: number | null;
  loudnessPeak: number | null;
  sampleRate: number | null;
  contentStartSamples: number;
  contentEndSamples: number;
  detectThresholdDb: number;
};

/** Songs that still need analysis (never analyzed, or analyzed by an older version). */
export function listPendingAnalysis(): {id: number; path: string}[] {
  const d = getDb();
  return d
    .prepare(
      `SELECT id, path FROM songs
       WHERE analysis_status = 'pending' OR analysis_version < ?
       ORDER BY added_at`,
    )
    .all(ANALYSIS_VERSION) as {id: number; path: string}[];
}

/** Persist a successful measurement and mark the song done. */
export function saveAnalysisResult(id: number, r: AnalysisResult): void {
  const d = getDb();
  d.prepare(
    `UPDATE songs SET
       loudness_lufs = @loudnessLufs,
       loudness_peak = @loudnessPeak,
       sample_rate = @sampleRate,
       content_start_samples = @contentStartSamples,
       content_end_samples = @contentEndSamples,
       detect_threshold_db = @detectThresholdDb,
       analysis_status = 'done',
       analysis_version = @version,
       analyzed_at = @now
     WHERE id = @id`,
  ).run({...r, id, version: ANALYSIS_VERSION, now: Date.now()});
}

/** Mark a song as failed (e.g. unreadable file) so we don't retry it forever. */
export function markAnalysisFailed(id: number): void {
  const d = getDb();
  d.prepare(
    `UPDATE songs SET analysis_status = 'failed', analysis_version = ?, analyzed_at = ? WHERE id = ?`,
  ).run(ANALYSIS_VERSION, Date.now(), id);
}

/** Counts for the renderer's initial banner state. */
export function getAnalysisStats(): {pending: number; done: number; failed: number; total: number} {
  const d = getDb();
  const row = d
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN analysis_status = 'done'   THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN analysis_status = 'failed' THEN 1 ELSE 0 END) AS failed,
         SUM(CASE WHEN analysis_status = 'pending' OR analysis_version < ? THEN 1 ELSE 0 END) AS pending
       FROM songs`,
    )
    .get(ANALYSIS_VERSION) as {total: number; done: number; failed: number; pending: number};
  return {
    pending: row.pending || 0,
    done: row.done || 0,
    failed: row.failed || 0,
    total: row.total || 0,
  };
}

export class DatabaseModule implements AppModule {
  enable(_context: ModuleContext): void {
    getDb();
  }
}

export function databaseModule(): DatabaseModule {
  return new DatabaseModule();
}
