import {test, expect, type ElectronApplication, type Page} from '@playwright/test';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {launchApp, stubFolderDialog, gotoView} from './helpers/app.js';
import {makeMusicFixture} from './helpers/wav.js';

/**
 * Playlist exchange with other players: export a set as M3U8, re-import it
 * losslessly, and import a flat "foreign" M3U (no Compás markers) with the
 * tanda structure inferred from cortinas.
 */

let app: ElectronApplication;
let page: Page;
let musicRoot: string;
let outDir: string;

const TANGO_DIR = 'Di Sarli - Tango';
const VALS_DIR = 'Biagi - Vals';
const TANGO_TITLES = ['Bahia Blanca', 'Nido Gaucho', 'Verdemar'];
const CORTINA_TITLE = 'Viejo Porton';
const VALS_TITLE = 'Lagrimas y Sonrisas';

const wav = (dir: string, title: string) => join(musicRoot, dir, `${title}.wav`);

async function stubSaveDialog(file: string): Promise<void> {
  await app.evaluate(({dialog}, chosen) => {
    // @ts-expect-error overriding for the test session
    dialog.showSaveDialog = async () => ({canceled: false, filePath: chosen});
  }, file);
}

async function stubOpenFileDialog(file: string): Promise<void> {
  await stubFolderDialog(app, file);
}

test.beforeAll(async () => {
  const launched = await launchApp();
  app = launched.app;
  page = launched.page;

  musicRoot = mkdtempSync(join(tmpdir(), 'compas-music-'));
  outDir = mkdtempSync(join(tmpdir(), 'compas-m3u-'));
  makeMusicFixture(musicRoot);
  await stubFolderDialog(app, musicRoot);
  await gotoView(page, 'Tandas');
  await page.getByRole('button', {name: /Choose a folder/i}).click();
  await page.getByText(/Import — set folder types/i).waitFor();
  await page.getByRole('button', {name: 'Import', exact: true}).click();
  await expect
    .poll(async () => page.evaluate(async () => (await (window as any).compas.getLibrary()).songs.length))
    .toBeGreaterThan(0);

  // Seed orchestras, a cortina, one tanda and a playlist through the preload API.
  await page.evaluate(
    async ({tangoTitles, cortinaTitle}) => {
      const c = (window as any).compas;
      const lib = await c.getLibrary();
      for (const s of lib.songs) {
        const isTango = (s.folder || '').includes('Di Sarli');
        await c.updateSong({
          id: s.id,
          title: s.title,
          orq: isTango ? 'Carlos Di Sarli' : 'Rodolfo Biagi',
          singer: '',
          album: null,
          year: isTango ? 1941 : 1939,
          genre: isTango ? 'tango' : 'vals',
        });
      }
      const fresh = await c.getLibrary();
      const byTitle = (t: string) => fresh.songs.find((s: any) => s.title === t);
      await c.setSongCortina([byTitle(cortinaTitle).id], true);
      const tanda = await c.saveTanda({
        name: 'Di Sarli instrumental',
        songIds: tangoTitles.map((t: string) => byTitle(t).id),
      });
      await c.savePlaylist({
        name: 'Saturday milonga',
        items: [
          {type: 'tanda', refId: tanda.id},
          {type: 'cortina', refId: byTitle(cortinaTitle).id},
        ],
      });
    },
    {tangoTitles: TANGO_TITLES, cortinaTitle: CORTINA_TITLE},
  );
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
});

test('exporting a playlist writes an extended M3U8 with tanda markers', async () => {
  const file = join(outDir, 'Saturday milonga.m3u8');
  await stubSaveDialog(file);

  await gotoView(page, 'Playlists');
  await expect(page.getByText('Saturday milonga').first()).toBeVisible();
  await page.getByRole('button', {name: 'Open', exact: true}).first().click();
  await page.locator('button[title^="Export"]').click();

  await expect.poll(() => existsSync(file)).toBe(true);
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  expect(lines[0]).toBe('#EXTM3U');
  expect(lines).toContain('#PLAYLIST:Saturday milonga');
  expect(text).toContain('#COMPAS-TANDA:{"name":"Di Sarli instrumental"');
  expect(text).toContain('#EXTGRP:Di Sarli instrumental');
  expect(text).toContain('#EXTINF:1,Carlos Di Sarli - Bahia Blanca');
  expect(text).toContain('#COMPAS-CORTINA');

  // Play order: the tanda's songs, then the cortina; one absolute path each.
  const paths = lines.filter(l => l && !l.startsWith('#'));
  expect(paths).toEqual([...TANGO_TITLES.map(t => wav(TANGO_DIR, t)), wav(VALS_DIR, CORTINA_TITLE)]);

  await page.getByRole('button', {name: 'Playlists'}).click();
});

test('re-importing the exported file recreates the playlist and its tanda', async () => {
  const file = join(outDir, 'Saturday milonga.m3u8');

  // Wipe the playlist and its tanda so the import has to rebuild both.
  await page.evaluate(async () => {
    const c = (window as any).compas;
    for (const p of await c.listPlaylists()) await c.deletePlaylist(p.id);
    for (const t of await c.listTandas()) await c.deleteTanda(t.id);
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await gotoView(page, 'Playlists');

  await stubOpenFileDialog(file);
  await page.getByRole('button', {name: /Import a playlist/}).click();

  const modal = page.locator('.tp-modal.pl-imp');
  await expect(modal).toBeVisible();
  await expect(modal.getByText(/1 tanda and 1 cortina/)).toBeVisible();
  await expect(modal.getByText('Di Sarli instrumental')).toBeVisible();
  await expect(modal.locator('.pl-imp-row.is-cortina')).toHaveCount(1);
  await modal.locator('.tp-modal-confirm').click();

  await expect(modal).toBeHidden();
  await expect(page.locator('.pl-card', {hasText: 'Saturday milonga'})).toBeVisible();

  const stored = await page.evaluate(async () => {
    const c = (window as any).compas;
    const [pl] = await c.listPlaylists();
    return {
      name: pl.name,
      items: pl.items.map((it: any) =>
        it.type === 'tanda'
          ? {type: 'tanda', name: it.data.name, titles: it.data.songs.map((s: any) => s.title)}
          : {type: 'cortina', title: it.data.title},
      ),
    };
  });
  expect(stored).toEqual({
    name: 'Saturday milonga',
    items: [
      {type: 'tanda', name: 'Di Sarli instrumental', titles: TANGO_TITLES},
      {type: 'cortina', title: CORTINA_TITLE},
    ],
  });
});

test('a flat M3U from another player is split into tandas at the cortinas', async () => {
  // Written by hand the way VLC / Apple Music would: no Compás markers, a mix
  // of absolute paths, a file:// URL and a path relative to the playlist, plus
  // one song we don't own.
  const file = join(musicRoot, 'from-vlc.m3u');
  const inf = (orq: string, title: string) => `#EXTINF:1,${orq} - ${title}`;
  const lines = [
    '#EXTM3U',
    inf('Carlos Di Sarli', 'Bahia Blanca'),
    wav(TANGO_DIR, 'Bahia Blanca'),
    inf('Carlos Di Sarli', 'Nido Gaucho'),
    pathToFileURL(wav(TANGO_DIR, 'Nido Gaucho')).href,
    inf('Carlos Di Sarli', 'Verdemar'),
    `${TANGO_DIR}/Verdemar.wav`,
    inf('Rodolfo Biagi', CORTINA_TITLE),
    wav(VALS_DIR, CORTINA_TITLE),
    inf('Rodolfo Biagi', VALS_TITLE),
    wav(VALS_DIR, VALS_TITLE),
    inf('Someone Else', 'Missing Song'),
    '/nowhere/Missing Song.wav',
  ];
  writeFileSync(file, lines.join('\r\n') + '\r\n', 'utf8');

  await stubOpenFileDialog(file);
  await page.getByRole('button', {name: /Import a playlist/}).click();

  const modal = page.locator('.tp-modal.pl-imp');
  await expect(modal).toBeVisible();
  await expect(modal.getByText(/2 tandas and 1 cortina/)).toBeVisible();
  // Inferred tandas are named from the orchestra and style.
  await expect(modal.getByText('Di Sarli · Tango')).toBeVisible();
  await expect(modal.getByText('Biagi · Vals')).toBeVisible();
  await expect(modal.getByText(/1 song isn't in your library/)).toBeVisible();
  await expect(modal.getByText('Someone Else - Missing Song')).toBeVisible();
  await modal.locator('.tp-modal-confirm').click();
  await expect(modal).toBeHidden();

  const stored = await page.evaluate(async () => {
    const c = (window as any).compas;
    const pl = (await c.listPlaylists()).find((p: any) => p.name === 'from-vlc');
    const tandas = await c.listTandas();
    return {
      tandaCount: tandas.length,
      items: pl.items.map((it: any) =>
        it.type === 'tanda'
          ? {type: 'tanda', name: it.data.name, kept: it.data.inCollection, titles: it.data.songs.map((s: any) => s.title), tags: it.data.tags}
          : {type: 'cortina', title: it.data.title},
      ),
    };
  });
  expect(stored.items).toEqual([
    {type: 'tanda', name: 'Di Sarli · Tango', kept: false, titles: TANGO_TITLES, tags: [{cat: 'type', label: 'Tango'}, {cat: 'orquesta', label: 'Di Sarli'}, {cat: 'age', label: '40s'}]},
    {type: 'cortina', title: CORTINA_TITLE},
    {type: 'tanda', name: 'Biagi · Vals', kept: false, titles: [VALS_TITLE], tags: [{cat: 'type', label: 'Vals'}, {cat: 'orquesta', label: 'Biagi'}, {cat: 'age', label: '30s'}]},
  ]);
  // Imported tandas stay inside their playlists, out of "My tandas".
  expect(stored.tandaCount).toBe(0);
});

test('an imported tanda can be kept, and export works from the playlist card', async () => {
  // Keep the first tanda of the imported playlist from the editor.
  await page.locator('.pl-card', {hasText: 'from-vlc'}).getByRole('button', {name: 'Open', exact: true}).click();
  await page.getByRole('button', {name: /Save to My tandas/}).first().click();
  await expect
    .poll(async () => page.evaluate(async () => (await (window as any).compas.listTandas()).map((t: any) => t.name)))
    .toEqual(['Di Sarli · Tango']);
  await page.getByRole('button', {name: 'Playlists'}).click();

  // Export straight from the card, without opening the playlist.
  const file = join(outDir, 'from-card.m3u8');
  await stubSaveDialog(file);
  await page.locator('.pl-card', {hasText: 'from-vlc'}).locator('button[title^="Export"]').click();
  await expect.poll(() => existsSync(file)).toBe(true);
  expect(readFileSync(file, 'utf8')).toContain('#EXTGRP:Di Sarli · Tango');

  // Deleting the playlist leaves the kept tanda in My tandas.
  await page.evaluate(async () => {
    const c = (window as any).compas;
    const pl = (await c.listPlaylists()).find((p: any) => p.name === 'from-vlc');
    await c.deletePlaylist(pl.id);
  });
  const names = await page.evaluate(async () => (await (window as any).compas.listTandas()).map((t: any) => t.name));
  expect(names).toEqual(['Di Sarli · Tango']);
});
