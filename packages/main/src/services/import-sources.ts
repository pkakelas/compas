// import-sources.ts — work out which folders a playlist file points at, so
// "Choose your music folder" can accept an M3U/M3U8 and import the folders its
// songs live in (a library root is always a whole folder: the watcher tracks
// it and reconciliation imports everything under it).

import {existsSync, statSync} from 'node:fs';
import {dirname, relative, sep} from 'node:path';
import {isAudioFile} from './scan.js';
import {resolveLocation, type ParsedPlaylist} from './playlist-m3u.js';

export type PlaylistSources = {
  folders: string[]; // folders to import (not already under a library root, nested ones collapsed)
  found: number; // entries that exist on disk as audio files
  total: number; // entries in the playlist
  inLibrary: number; // entries that exist and already sit under a library root
};

function isUnder(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`) && !/^[A-Za-z]:/.test(rel));
}

/** Folders referenced by a playlist that the library doesn't cover yet. */
export function playlistSourceFolders(
  parsed: ParsedPlaylist,
  playlistDir: string,
  libraryRoots: string[],
): PlaylistSources {
  const folders = new Set<string>();
  let found = 0;
  let inLibrary = 0;
  for (const entry of parsed.entries) {
    const file = resolveLocation(entry.location, playlistDir);
    if (!isAudioFile(file) || !existsSync(file)) continue;
    try {
      if (!statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    found++;
    if (libraryRoots.some(r => isUnder(file, r))) {
      inLibrary++;
      continue;
    }
    folders.add(dirname(file));
  }
  // Collapse nested folders: scanning a parent already covers its children.
  const sorted = [...folders].sort((a, b) => a.length - b.length);
  const kept: string[] = [];
  for (const f of sorted) {
    if (!kept.some(k => isUnder(f, k))) kept.push(f);
  }
  return {folders: kept, found, total: parsed.entries.length, inLibrary};
}

/** Deepest folder containing every given path (the paths' own parent when
 *  there is only one). Falls back to the first path's parent if they share nothing. */
export function commonAncestor(paths: string[]): string {
  if (paths.length === 0) return '';
  if (paths.length === 1) return paths[0];
  const split = paths.map(p => p.split(sep));
  const first = split[0];
  let n = 0;
  while (n < first.length && split.every(s => s[n] === first[n])) n++;
  const shared = first.slice(0, n).join(sep);
  return shared || dirname(paths[0]);
}

/** A scanned song's folder path re-based from its own root onto the display
 *  root, using the ' / ' separator the import tree expects. */
export function displayFolderPath(displayRoot: string, root: string, folderPath: string): string {
  const prefix = relative(displayRoot, root).split(sep).filter(Boolean).join(' / ');
  if (!prefix) return folderPath;
  return folderPath ? `${prefix} / ${folderPath}` : prefix;
}
