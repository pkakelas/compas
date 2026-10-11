import {test, expect, type ElectronApplication, type Page} from '@playwright/test';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchApp, stubFolderDialog, gotoView} from './helpers/app.js';
import {makeMusicFixture, writeWav} from './helpers/wav.js';

/**
 * "Choose your music folder" accepts a playlist file: the folders its songs
 * live in are imported (and only those), then the playlist itself is built.
 */

let app: ElectronApplication;
let page: Page;
let musicRoot: string;
let playlistFile: string;

const TANGO_DIR = 'Di Sarli - Tango';
const VALS_DIR = 'Biagi - Vals';
const TANGO_TITLES = ['Bahia Blanca', 'Nido Gaucho', 'Verdemar'];
const VALS_TITLES = ['Lagrimas y Sonrisas', 'Viejo Porton'];

test.beforeAll(async () => {
  const launched = await launchApp();
  app = launched.app;
  page = launched.page;

  musicRoot = mkdtempSync(join(tmpdir(), 'compas-music-'));
  makeMusicFixture(musicRoot);
  // A folder the playlist never mentions: it must stay out of the library.
  mkdirSync(join(musicRoot, 'Canaro - Milonga'));
  writeWav(join(musicRoot, 'Canaro - Milonga', 'Milonga Sentimental.wav'));
  mkdirSync(join(musicRoot, 'Cortinas'));
  writeWav(join(musicRoot, 'Cortinas', 'Blue Moon.wav'));

  // The playlist lives outside the music tree, as an export from another app would.
  const outDir = mkdtempSync(join(tmpdir(), 'compas-m3u-'));
  playlistFile = join(outDir, 'Friday practica.m3u8');
  const wav = (dir: string, t: string) => join(musicRoot, dir, `${t}.wav`);
  const lines = ['#EXTM3U'];
  for (const t of TANGO_TITLES) lines.push(`#EXTINF:1,Carlos Di Sarli - ${t}`, wav(TANGO_DIR, t));
  lines.push('#EXTINF:1,Cortina - Blue Moon', wav('Cortinas', 'Blue Moon'));
  for (const t of VALS_TITLES) lines.push(`#EXTINF:1,Rodolfo Biagi - ${t}`, wav(VALS_DIR, t));
  lines.push('#EXTINF:1,Osvaldo Pugliese - La Yumba', join(musicRoot, 'Pugliese - Tango', 'La Yumba.wav'));
  writeFileSync(playlistFile, lines.join('\n') + '\n', 'utf8');
});

test.afterAll(async () => {
  await app?.close();
});

test('picking a playlist imports only the folders it references, then the playlist', async () => {
  await stubFolderDialog(app, playlistFile);
  await gotoView(page, 'Tandas');
  await page.getByRole('button', {name: /Import a playlist/i}).click();

  // One step: the referenced folders are imported without the folder-types
  // review, and the playlist confirmation appears straight away.
  const modal = page.locator('.tp-modal.pl-imp');
  await expect(modal).toBeVisible();
  await expect(page.getByText(/Import — set folder genres/i)).toHaveCount(0);
  await expect(modal.getByText(/2 tandas and 1 cortina/)).toBeVisible();
  await expect(modal.getByRole('textbox')).toHaveValue('Friday practica');
  await expect(modal.getByText(TANGO_TITLES.join(' · '))).toBeVisible();
  await expect(modal.locator('.pl-imp-row.is-cortina')).toHaveCount(1);
  await modal.locator('.tp-modal-confirm').click();
  await expect(modal).toBeHidden();

  const stored = await page.evaluate(async () => {
    const c = (window as any).compas;
    const lib = await c.getLibrary();
    const [pl] = await c.listPlaylists();
    return {
      songs: lib.songs.length,
      roots: lib.roots.length,
      folders: [...new Set(lib.songs.map((s: any) => s.folder))].sort(),
      cortinas: lib.songs.filter((s: any) => s.isCortina).map((s: any) => s.title),
      playlist: {
        name: pl.name,
        items: pl.items.map((it: any) =>
          it.type === 'tanda'
            ? {type: 'tanda', titles: it.data.songs.map((s: any) => s.title)}
            : {type: 'cortina', title: it.data.title},
        ),
      },
    };
  });

  // Whole folders come in (the tango folder holds two extra lossless tracks),
  // each as its own root; the Canaro folder never does.
  expect(stored.folders).toEqual([VALS_DIR, 'Cortinas', TANGO_DIR].sort());
  expect(stored.songs).toBe(5 + 2 + 1);
  expect(stored.roots).toBe(3);
  expect(stored.cortinas).toEqual(['Blue Moon']);
  expect(stored.playlist).toEqual({
    name: 'Friday practica',
    items: [
      {type: 'tanda', titles: TANGO_TITLES},
      {type: 'cortina', title: 'Blue Moon'},
      {type: 'tanda', titles: VALS_TITLES},
    ],
  });
});

test('a playlist whose folders are already imported skips straight to the playlist step', async () => {
  // Remove the playlist but keep the library, then pick the same file again.
  await page.evaluate(async () => {
    const c = (window as any).compas;
    for (const p of await c.listPlaylists()) await c.deletePlaylist(p.id);
  });
  await gotoView(page, 'Library');
  // First visit to the Library after an import shows the Smart Organize tip.
  const tip = page.locator('.sotip-x');
  if (await tip.isVisible({timeout: 2_000}).catch(() => false)) await tip.click();
  await page.getByRole('button', {name: /Add folder/i}).click();

  const modal = page.locator('.tp-modal.pl-imp');
  await expect(modal).toBeVisible();
  await expect(page.getByText(/Import — set folder genres/i)).toHaveCount(0);
  await modal.locator('.tp-modal-confirm').click();
  await expect(modal).toBeHidden();

  const count = await page.evaluate(async () => (await (window as any).compas.listPlaylists()).length);
  expect(count).toBe(1);
});

test('a playlist from another computer still matches songs already in the library', async () => {
  // Same songs, but under paths that don't exist here (as if exported on
  // another Mac): folder discovery finds nothing, yet filename matching should.
  const moved = join(mkdtempSync(join(tmpdir(), 'compas-m3u-')), 'From the old laptop.m3u8');
  const lines = ['#EXTM3U'];
  for (const t of TANGO_TITLES) lines.push(`#EXTINF:1,Carlos Di Sarli - ${t}`, `/Volumes/OldMac/Music/${TANGO_DIR}/${t}.wav`);
  writeFileSync(moved, lines.join('\n') + '\n', 'utf8');

  await stubFolderDialog(app, moved);
  await gotoView(page, 'Playlists');
  await page.getByRole('button', {name: /Import a playlist/i}).click();

  const modal = page.locator('.tp-modal.pl-imp');
  await expect(modal).toBeVisible();
  await expect(modal.getByText(TANGO_TITLES.join(' · '))).toBeVisible();
  await modal.locator('.tp-modal-confirm').click();
  await expect(modal).toBeHidden();

  const titles = await page.evaluate(async () => {
    const pl = (await (window as any).compas.listPlaylists()).find((p: any) => p.name === 'From the old laptop');
    return pl.items.flatMap((it: any) => (it.type === 'tanda' ? it.data.songs : [it.data])).map((s: any) => s.title);
  });
  expect(titles).toEqual(TANGO_TITLES);
});
