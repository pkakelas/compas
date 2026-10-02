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

// Runs after the test above, with the tanda queued and on air. The fixture
// tracks are a second long, so rather than race the set we let it run out
// (paused on its last song) and check that a locked set can't be started —
// the same controls that would otherwise interrupt a song on the floor.
test('locking the live set makes the queue, the transport and the spacebar inert', async () => {
  const floorPlaying = () =>
    page.evaluate(() => {
      const H = (window as any).Howler;
      const howls = (H && H._howls) || [];
      return howls.some((h: any) => typeof h.playing === 'function' && h.playing());
    });
  const floorPos = () =>
    page.evaluate(() => {
      const h = ((window as any).Howler._howls || [])[0];
      const p = h ? h.seek() : 0;
      return typeof p === 'number' ? p : 0;
    });
  const bar = page.locator('.tp-nowbar');
  // The set has run out once its last song is the current one and the bar has
  // dropped its "playing" meter.
  await expect(page.locator('.tp-q-scroll .tp-songrow').last()).toHaveClass(/is-now/, {timeout: 45_000});
  await expect(bar.locator('.tp-nb-mark .tp-eq')).toHaveCount(0, {timeout: 15_000});
  expect(await floorPlaying()).toBe(false);

  const transport = bar.locator('.tp-tbtn');
  const lock = bar.locator('.tp-nb-lock');
  const songRow = page.locator('.tp-q-scroll .tp-songrow').nth(1);

  await lock.click();
  await expect(bar).toHaveClass(/is-locked/);
  // The queue header's toggle is the same latch.
  await expect(page.locator('.tp-lockq')).toHaveAttribute('aria-pressed', 'true');

  // Prev / play-pause / next are all disabled, and nothing else gets through:
  // not the seek area, not the spacebar, not a click on a queued song.
  await expect(transport).toHaveCount(3);
  for (const btn of await transport.all()) await expect(btn).toBeDisabled();
  const before = await floorPos();
  const wave = (await bar.locator('.tp-nb-wave .tp-flex1').boundingBox())!;
  await page.mouse.click(wave.x + wave.width * 0.9, wave.y + wave.height / 2);
  await page.keyboard.press('Space');
  await songRow.click();
  await page.waitForTimeout(600);
  expect(await floorPlaying()).toBe(false);
  expect(await floorPos()).toBe(before);

  // Unlocked, the very same click starts that song.
  await lock.click();
  await expect(bar).not.toHaveClass(/is-locked/);
  await songRow.click();
  await expect.poll(floorPlaying, {timeout: 15_000}).toBe(true);
});
