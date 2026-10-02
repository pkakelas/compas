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

  // Build a tango tanda from the imported tango tracks, then reload so the UI
  // (which reads tandas on mount) picks it up.
  await page.evaluate(async () => {
    const c = (window as any).compas;
    const lib = await c.getLibrary();
    const tangoIds = lib.songs.filter((s: any) => s.genre === 'tango').map((s: any) => s.id);
    await c.saveTanda({name: 'Test Tanda', songIds: tangoIds});
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
});

test('a saved tanda can be queued and played', async () => {
  await gotoView(page, 'Live');

  // The tanda appears in the "Add to queue" panel's Tandas picker. Use its "+"
  // button (clicking the name only previews; the add button queues it).
  await page.locator('.tp-main .tp-tab', {hasText: 'Tandas'}).click();
  await expect(page.getByText('Test Tanda').first()).toBeVisible({timeout: 10_000});
  await page.locator('button[title="Add tanda to queue"]').first().click();

  // Queue is no longer empty: the transport play button enables.
  const playBtn = page.locator('.tp-tbtn.play');
  await expect(playBtn).toBeEnabled({timeout: 10_000});
  await playBtn.click();

  // Real playback: Howler should report a sound actually playing (the audio is
  // streamed via the compas-audio:// protocol from the imported file).
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const H = (window as any).Howler;
          const howls = (H && H._howls) || [];
          return howls.some((h: any) => typeof h.playing === 'function' && h.playing());
        }),
      {timeout: 15_000},
    )
    .toBe(true);

  // And the transport leaves its idle state.
  await expect(page.getByText('Nothing playing')).toHaveCount(0);
});
