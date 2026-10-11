import {test, expect, type ElectronApplication, type Page} from '@playwright/test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchApp, stubFolderDialog, gotoView} from './helpers/app.js';
import {makeMusicFixture} from './helpers/wav.js';

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const launched = await launchApp();
  app = launched.app;
  page = launched.page;

  // Import the fixture library through the real flow.
  const musicRoot = mkdtempSync(join(tmpdir(), 'compas-music-'));
  makeMusicFixture(musicRoot);
  await stubFolderDialog(app, musicRoot);
  await gotoView(page, 'Tandas');
  await page.getByRole('button', {name: /Choose a folder/i}).click();
  await page.getByText(/Import — set folder types/i).waitFor();
  await page.getByRole('button', {name: 'Import', exact: true}).click();
  await page
    .locator('#root')
    .getByText(/songs across/i)
    .first()
    .waitFor()
    .catch(() => {});

  // Save three tandas so creation order (Bravo, Alpha, Charlie) disagrees with
  // alphabetical order, then reload so the views pick them up.
  await page.evaluate(async () => {
    const c = (window as any).compas;
    const lib = await c.getLibrary();
    const ids = lib.songs.filter((s: any) => s.genre === 'tango').map((s: any) => s.id);
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    for (const name of ['Bravo', 'Alpha', 'Charlie']) {
      await c.saveTanda({name, songIds: ids});
      await sleep(5);
    }
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
});

test('tandas can be ordered by name or creation date, in both places that list them', async () => {
  await gotoView(page, 'Tandas');
  const cards = page.locator('.tv-tcard .tv-tcard-orq .o');
  const sort = page.locator('.tv-tree-head select[title="Sort tandas"]');
  await expect(cards).toHaveCount(3);

  // Name A–Z is the default; the other two follow the saved-at timestamp.
  await expect(sort).toHaveValue('name');
  await expect(cards).toHaveText(['Alpha', 'Bravo', 'Charlie']);
  await sort.selectOption('newest');
  await expect(cards).toHaveText(['Charlie', 'Alpha', 'Bravo']);
  await sort.selectOption('oldest');
  await expect(cards).toHaveText(['Bravo', 'Alpha', 'Charlie']);

  // Live's "Add to queue" picker shares the preference, in both directions.
  await gotoView(page, 'Live');
  await page.locator('.tp-main .tp-tab', {hasText: 'Tandas'}).click();
  const live = page.locator('.tp-lib-scroll .tp-libcard-orq');
  const liveSort = page.locator('.tp-lib-controls select[title="Sort tandas"]');
  await expect(liveSort).toHaveValue('oldest');
  await expect(live).toHaveText(['Bravo', 'Alpha', 'Charlie']);
  await liveSort.selectOption('name');
  await expect(live).toHaveText(['Alpha', 'Bravo', 'Charlie']);
  await gotoView(page, 'Tandas');
  await expect(sort).toHaveValue('name');
  await expect(cards).toHaveText(['Alpha', 'Bravo', 'Charlie']);

  // The choice survives a restart of the renderer.
  await sort.selectOption('newest');
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await gotoView(page, 'Tandas');
  await expect(page.locator('.tv-tree-head select[title="Sort tandas"]')).toHaveValue('newest');
  await expect(page.locator('.tv-tcard .tv-tcard-orq .o')).toHaveText(['Charlie', 'Alpha', 'Bravo']);
});
