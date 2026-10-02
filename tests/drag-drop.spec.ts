import {test, expect, type ElectronApplication, type Page} from '@playwright/test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchApp, stubFolderDialog, gotoView} from './helpers/app.js';
import {makeMusicFixture} from './helpers/wav.js';

/**
 * Drag & drop in the playlist editor, the live queue and the Tandas builder:
 * library songs and cortinas drop into the list at the gap nearest the pointer
 * (in front of a row from its top half, after it from its bottom half, or at
 * the end), and rows reorder the same way.
 */

let app: ElectronApplication;
let page: Page;

const TANDA = 'Di Sarli instrumental';
const TANGO_TITLES = ['Bahia Blanca', 'Nido Gaucho', 'Verdemar'];
const CORTINA_TITLE = 'Viejo Porton';
const VALS_TITLE = 'Lagrimas y Sonrisas';
const LOOSE_TITLE = 'Milonguero Viejo';

/** The saved playlist as the database has it: tanda names and single-song titles, in order. */
async function storedItems(): Promise<string[]> {
  return page.evaluate(async () => {
    const [pl] = await (window as any).compas.listPlaylists();
    return pl.items.map((it: any) => (it.type === 'tanda' ? it.data.name : it.data.title));
  });
}

// Every view stays mounted, so the Live tab has a library panel of its own:
// scope to the one sitting next to the playlist editor.
const lib = () => page.locator('.tv-body:has(.pl-dock) .tp-lib');
const row = (text: string) => page.locator('.pl-dock .tp-qdrag', {hasText: text});

/** Drop targets within a row: its top half (lands in front) or its bottom half (lands after). */
const TOP = {targetPosition: {x: 60, y: 8}};
async function bottomOf(text: string) {
  const box = (await row(text).boundingBox())!;
  return {targetPosition: {x: 60, y: box.height - 8}};
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
  await page.getByText(/Import — set folder types/i).waitFor();
  await page.getByRole('button', {name: 'Import', exact: true}).click();
  await expect
    .poll(async () => page.evaluate(async () => (await (window as any).compas.getLibrary()).songs.length))
    .toBeGreaterThan(0);

  // Seed a cortina, one tanda and a playlist holding just that tanda.
  await page.evaluate(
    async ({tandaName, tangoTitles, cortinaTitle}) => {
      const c = (window as any).compas;
      const lib = await c.getLibrary();
      const byTitle = (t: string) => lib.songs.find((s: any) => s.title === t);
      await c.setSongCortina([byTitle(cortinaTitle).id], true);
      const tanda = await c.saveTanda({
        name: tandaName,
        songIds: tangoTitles.map((t: string) => byTitle(t).id),
      });
      await c.savePlaylist({name: 'Saturday milonga', items: [{type: 'tanda', refId: tanda.id}]});
    },
    {tandaName: TANDA, tangoTitles: TANGO_TITLES, cortinaTitle: CORTINA_TITLE},
  );
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  await gotoView(page, 'Playlists');
  await page.getByRole('button', {name: 'Open', exact: true}).first().click();
  await expect(row(TANDA)).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
});

test('a library song dropped on the top half of a row lands in front of it', async () => {
  await lib().locator('.tp-tab', {hasText: 'Songs'}).click();
  // Sub-folders start collapsed; the flat layout lists every song.
  await lib().getByRole('radio', {name: 'Songs'}).click();
  await lib().locator('.tv-song', {hasText: VALS_TITLE}).dragTo(row(TANDA), TOP);

  await expect.poll(storedItems).toEqual([VALS_TITLE, TANDA]);
  await expect(page.locator('.pl-dock .tp-qdrag')).toHaveCount(2);
});

test('a library song dropped below the rows is appended', async () => {
  await lib().locator('.tv-song', {hasText: LOOSE_TITLE}).dragTo(page.locator('.pl-dock .tp-q-end'));

  await expect.poll(storedItems).toEqual([VALS_TITLE, TANDA, LOOSE_TITLE]);
  // Neither single song bridges two tandas, so they count as songs, not cortinas.
  await expect(page.locator('.pl-dock .tv-dock-meta')).toHaveText(/1\s*tanda\s*·\s*2\s*songs/);
});

test('a cortina dropped on the bottom half of a row lands after it', async () => {
  await lib().locator('.tp-tab', {hasText: 'Cortinas'}).click();
  await lib().locator('.tp-cortrow', {hasText: CORTINA_TITLE}).dragTo(row(TANDA), await bottomOf(TANDA));

  await expect.poll(storedItems).toEqual([VALS_TITLE, TANDA, CORTINA_TITLE, LOOSE_TITLE]);
});

test('rows reorder into the gap nearest the pointer, or to the end', async () => {
  // Down the list, onto a top half: in front of the cortina, not after it.
  await row(VALS_TITLE).dragTo(row(CORTINA_TITLE), TOP);
  await expect.poll(storedItems).toEqual([TANDA, VALS_TITLE, CORTINA_TITLE, LOOSE_TITLE]);

  // Up the list.
  await row(LOOSE_TITLE).dragTo(row(TANDA), TOP);
  await expect.poll(storedItems).toEqual([LOOSE_TITLE, TANDA, VALS_TITLE, CORTINA_TITLE]);

  // Onto a bottom half: after that row.
  await row(LOOSE_TITLE).dragTo(row(VALS_TITLE), await bottomOf(VALS_TITLE));
  await expect.poll(storedItems).toEqual([TANDA, VALS_TITLE, LOOSE_TITLE, CORTINA_TITLE]);

  // Onto the end marker: to the very end.
  await row(TANDA).dragTo(page.locator('.pl-dock .tp-q-end'));
  await expect.poll(storedItems).toEqual([VALS_TITLE, LOOSE_TITLE, CORTINA_TITLE, TANDA]);
});

test('the live queue takes drops and reorders the same way', async () => {
  await gotoView(page, 'Live');
  const live = page.locator('.tp-main');
  const rows = live.locator('.tp-queue .tp-qdrag');
  const end = live.locator('.tp-queue .tp-q-end');
  const expectOrder = async (titles: string[]) => {
    await expect(rows).toHaveCount(titles.length);
    for (const [i, t] of titles.entries()) await expect(rows.nth(i)).toContainText(t);
  };

  // The empty queue offers the three ways to start; each opens that picker.
  await expect(live.locator('.tp-queue')).toContainText('Start your set');
  await live.locator('.tp-queue').getByRole('button', {name: 'Tandas'}).click();
  await live.locator('button[title="Add tanda to queue"]').first().click();
  await expectOrder([TANDA]);
  await expect(live.locator('.tp-queue')).not.toContainText('Start your set');

  await live.locator('.tp-lib .tp-tab', {hasText: 'Songs'}).click();
  await live.locator('.tp-lib').getByRole('radio', {name: 'Songs'}).click();
  await live.locator('.tp-lib .tv-song', {hasText: VALS_TITLE}).dragTo(rows.first(), TOP);
  await expectOrder([VALS_TITLE, TANDA]);

  await live.locator('.tp-lib .tv-song', {hasText: LOOSE_TITLE}).dragTo(end);
  await expectOrder([VALS_TITLE, TANDA, LOOSE_TITLE]);

  // A queue row dragged onto the end marker moves to the very end.
  await rows.first().dragTo(end);
  await expectOrder([TANDA, LOOSE_TITLE, VALS_TITLE]);
});

test('the tanda builder takes drops and reorders the same way', async () => {
  await gotoView(page, 'Tandas');
  await page.locator('.tv-sectab', {hasText: 'Build'}).click();
  await page.locator('.tv-body:has(.tv-dock)').getByRole('radio', {name: 'Songs'}).click();
  const dock = page.locator('.tv-dock');
  const slots = dock.locator('.tv-slot.filled');
  const song = (title: string) => page.locator('.tv-body:has(.tv-dock) .tv-song', {hasText: title});
  const expectOrder = async (titles: string[]) => {
    await expect(slots).toHaveCount(titles.length);
    for (const [i, t] of titles.entries()) await expect(slots.nth(i)).toContainText(t);
  };

  // Onto the empty "next" slot: appended.
  await song(TANGO_TITLES[0]).dragTo(dock.locator('.tv-slot-empty.next'));
  await song(TANGO_TITLES[1]).dragTo(dock.locator('.tv-slot-empty.next'));
  await expectOrder([TANGO_TITLES[0], TANGO_TITLES[1]]);

  // Onto the top half of a slot: in front of it.
  await song(TANGO_TITLES[2]).dragTo(slots.nth(1), {targetPosition: {x: 60, y: 5}});
  await expectOrder([TANGO_TITLES[0], TANGO_TITLES[2], TANGO_TITLES[1]]);

  // A slot dragged below the filled ones moves to the end.
  await slots.first().dragTo(dock.locator('.tv-slot-empty.next'));
  await expectOrder([TANGO_TITLES[2], TANGO_TITLES[1], TANGO_TITLES[0]]);
});
