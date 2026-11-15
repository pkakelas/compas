import {test, expect, type ElectronApplication, type Page} from '@playwright/test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchApp, stubFolderDialog, gotoView} from './helpers/app.js';
import {makeMusicFixture} from './helpers/wav.js';

/**
 * Editing a tanda in the live queue: its songs reorder by drag, a library song
 * dropped on them joins the tanda, and a song can be removed. Only tonight's
 * copy changes; the saved tanda stays as it was. Songs already played and the
 * one on air can't be moved, removed or dropped in front of.
 */

let app: ElectronApplication;
let page: Page;

const TANDA = 'Di Sarli instrumental';
const [A, B, C] = ['Bahia Blanca', 'Nido Gaucho', 'Verdemar'];
const VALS = 'Lagrimas y Sonrisas';
const LOOSE = 'Milonguero Viejo';

const live = () => page.locator('.tp-main');
const songs = () => live().locator('.tp-queue .tp-songrow');
const song = (title: string) => live().locator('.tp-queue .tp-songrow', {hasText: title});
const libSong = (title: string) => live().locator('.tp-lib .tv-song', {hasText: title});
const TOP = {targetPosition: {x: 60, y: 6}};

async function expectSongs(titles: string[]) {
  await expect(songs()).toHaveCount(titles.length);
  for (const [i, t] of titles.entries()) await expect(songs().nth(i)).toContainText(t);
}

test.beforeAll(async () => {
  const launched = await launchApp();
  app = launched.app;
  page = launched.page;

  const musicRoot = mkdtempSync(join(tmpdir(), 'compas-music-'));
  makeMusicFixture(musicRoot);
  await stubFolderDialog(app, musicRoot);
  await gotoView(page, 'Tandas');
  await page.getByRole('button', {name: /Choose a folder/i}).click();
  await page.getByText(/Import — set folder genres/i).waitFor();
  await page.getByRole('button', {name: 'Import', exact: true}).click();
  await expect
    .poll(async () => page.evaluate(async () => (await (window as any).compas.getLibrary()).songs.length))
    .toBeGreaterThan(0);

  await page.evaluate(
    async ({name, titles}) => {
      const c = (window as any).compas;
      const lib = await c.getLibrary();
      const id = (t: string) => lib.songs.find((s: any) => s.title === t).id;
      await c.saveTanda({name, songIds: titles.map(id)});
    },
    {name: TANDA, titles: [A, B, C]},
  );
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await gotoView(page, 'Live');
  await live().locator('.tp-lib .tp-tab', {hasText: 'Tandas'}).click();
  await live().locator('button[title="Add tanda to queue"]').first().click();
  await expectSongs([A, B, C]);
  await live().locator('.tp-lib .tp-tab', {hasText: 'Songs'}).click();
  await live().locator('.tp-lib').getByRole('radio', {name: 'Songs'}).click();
});

test.afterAll(async () => {
  await app?.close();
});

test('songs of a queued tanda reorder, take library songs and can be removed', async () => {
  // A song row dragged onto the top half of the first one moves in front of it.
  await song(C).dragTo(song(A), TOP);
  await expectSongs([C, A, B]);

  // A library song dropped on the tanda's songs joins the tanda — the queue
  // still holds a single tanda card, and the song isn't a row of its own.
  await libSong(VALS).dragTo(song(A), TOP);
  await expectSongs([C, VALS, A, B]);
  await expect(live().locator('.tp-queue .tp-qdrag')).toHaveCount(1);
  await expect(live().locator('.tp-queue .tp-tandacard')).toContainText('4 songs');

  // Remove one (the button shows on hover).
  await song(A).hover();
  await song(A).locator('.tp-song-x').click();
  await expectSongs([C, VALS, B]);

  // Dropped on the tanda's header instead, a song still goes in on its own.
  await libSong(LOOSE).dragTo(live().locator('.tp-queue .tp-tanda-head'), TOP);
  await expect(live().locator('.tp-queue .tp-qdrag')).toHaveCount(2);
  await expectSongs([C, VALS, B]);

  // The saved tanda is untouched: only tonight's copy changed.
  const saved = await page.evaluate(async (name) => {
    const ts = await (window as any).compas.listTandas();
    return ts.find((t: any) => t.name === name).songs.map((s: any) => s.title);
  }, TANDA);
  expect(saved).toEqual([A, B, C]);
});

test('songs already played and the one on air stay put', async () => {
  // Drop the standalone song again so the tanda is the whole queue, then play
  // it through. The fixture tracks are a second long: the set ends paused on
  // the tanda's last song, which stays the current one.
  await live().locator('.tp-queue .tp-songcard .tp-qx').click({force: true});
  await expect(live().locator('.tp-queue .tp-qdrag')).toHaveCount(1);
  await songs().first().click();
  await expect(songs().last()).toHaveClass(/is-now/, {timeout: 45_000});

  // Every song is now played or on air: none can be dragged or removed.
  await expect(live().locator('.tp-queue .tp-songrow.is-movable')).toHaveCount(0);
  await expect(live().locator('.tp-queue .tp-song-x')).toHaveCount(0);

  // A song dropped in front of them lands after the one on air instead, and
  // that one is editable.
  await libSong(LOOSE).dragTo(songs().first(), TOP);
  await expectSongs([C, VALS, B, LOOSE]);
  await expect(songs().nth(2)).toHaveClass(/is-now/);
  await expect(live().locator('.tp-queue .tp-songrow.is-movable')).toHaveCount(1);
  await expect(song(LOOSE).locator('.tp-song-x')).toHaveCount(1);
});
