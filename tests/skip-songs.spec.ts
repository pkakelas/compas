import {test, expect, type ElectronApplication, type Page} from '@playwright/test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchApp, stubFolderDialog, gotoView} from './helpers/app.js';
import {makeMusicFixture} from './helpers/wav.js';

// Songs marked "skip" in the live queue must be passed over however playback
// reaches them — not only when a song ends, but also when a cortina fades into
// the next tanda and when the DJ steps back with Prev.

const LIVE_KEY = 'compas.live.v1';

let app: ElectronApplication;
let page: Page;

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
  await page.locator('#root').getByText(/songs across/i).first().waitFor().catch(() => {});

  // Live queue: tanda A (vals) · cortina · tanda B (tango) whose FIRST song is
  // marked skip. The cortina is current, paused — the state a restart restores.
  await page.evaluate(async key => {
    const lib = await (window as any).compas.getLibrary();
    const tango = lib.songs.filter((s: any) => s.genre === 'tango');
    const vals = lib.songs.filter((s: any) => s.genre === 'vals');
    const queue = [
      {key: 'q1', type: 'tanda', data: {id: 'ta', name: 'A', songs: vals}},
      {key: 'q2', type: 'cortina', data: tango[0]},
      {key: 'q3', type: 'tanda', data: {id: 'tb', name: 'B', songs: [{...tango[1], skip: true}, tango[2]]}},
    ];
    localStorage.setItem(key, JSON.stringify({queue, nowKey: 'q2', nowIx: 0}));
  }, LIVE_KEY);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // Record every (item, song) the player lands on, so a skipped song that's
  // only current for an instant (the fixtures are a second long) still shows.
  await page.evaluate(key => {
    const w = window as any;
    w.__landed = [];
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === key) {
        const d = JSON.parse(v);
        const last = w.__landed[w.__landed.length - 1];
        const cur = `${d.nowKey}:${d.nowIx}`;
        if (cur !== last) w.__landed.push(cur);
      }
      return orig.call(this, k, v);
    };
  }, LIVE_KEY);
  await gotoView(page, 'Live');
});

test.afterAll(async () => {
  await app?.close();
});

const landed = () => page.evaluate(() => (window as any).__landed as string[]);

test('fading a cortina into the next tanda skips its marked first song', async () => {
  await page.getByRole('button', {name: /Fade to next tanda/}).click();
  // The tanda's second song plays, then the set runs out on it.
  await expect.poll(landed, {timeout: 15_000}).toContain('q3:1');
  expect(await landed()).not.toContain('q3:0');
});

test('Prev steps back over a marked song', async () => {
  // Wait for the set to run out (paused on tanda B's last song), then step back:
  // the only earlier song in B is marked skip, so Prev lands on the cortina.
  await expect(page.locator('.tp-nowbar .tp-nb-mark .tp-eq')).toHaveCount(0, {timeout: 15_000});
  await page.evaluate(() => { (window as any).__landed = []; });
  await page.locator('.tp-nowbar .tp-tbtn').first().click();
  await expect.poll(async () => (await landed())[0], {timeout: 10_000}).toBe('q2:0');
  expect(await landed()).not.toContain('q3:0');
});
