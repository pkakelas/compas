/**
 * Design screenshot harness — NOT part of the regular e2e suite.
 * Seeds a small library + tandas + a playlist, then captures every view in
 * both themes to /tmp/compas-shots. Run with:
 *   SHOTS=1 npx playwright test tests/shots.spec.ts
 */
import {test, type ElectronApplication, type Page} from '@playwright/test';
import {mkdtempSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchApp, stubFolderDialog, gotoView} from './helpers/app.js';
import {writeWav} from './helpers/wav.js';

test.skip(!process.env.SHOTS, 'screenshot harness — run with SHOTS=1');

let app: ElectronApplication;
let page: Page;

const OUT = '/tmp/compas-shots';
mkdirSync(OUT, {recursive: true});

function makeRichFixture(root: string) {
  const folders: Record<string, string[]> = {
    'Di Sarli - Tango': ['Bahia Blanca', 'Nido Gaucho', 'Verdemar', 'A la gran muneca'],
    "D'Arienzo - Tango": ['La cumparsita', 'El flete', 'Derecho viejo', 'Loca'],
    'Biagi - Vals': ['Lagrimas y sonrisas', 'Viejo porton', 'Amor y vals'],
    'Canaro - Milonga': ['Milonga sentimental', 'Reliquias portenas', 'Milonga brava'],
    'Cortinas': ['Sway', 'Blue moon', 'Cheek to cheek'],
  };
  for (const [dir, titles] of Object.entries(folders)) {
    const d = join(root, dir);
    mkdirSync(d, {recursive: true});
    titles.forEach(t => writeWav(join(d, `${t}.wav`), 2));
  }
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const launched = await launchApp();
  app = launched.app;
  page = launched.page;
  await page.setViewportSize({width: 1480, height: 940});

  const musicRoot = mkdtempSync(join(tmpdir(), 'compas-music-'));
  makeRichFixture(musicRoot);
  await stubFolderDialog(app, musicRoot);
  // first-run tour can cover the nav — skip it before navigating
  await page.waitForTimeout(800);
  const obSkip = page.locator('.tp-ob-skip');
  if (await obSkip.isVisible().catch(() => false)) await obSkip.click();
  const sotipX = page.locator('.sotip-x');
  if (await sotipX.isVisible().catch(() => false)) await sotipX.click();
  await gotoView(page, 'Tandas');
  const choose = page.getByRole('button', {name: /Choose a folder/i});
  if (await choose.isVisible().catch(() => false)) {
    await choose.click();
    await page.getByText(/Import — set folder types/i).waitFor();
    await page.getByRole('button', {name: 'Import', exact: true}).click();
    await page.waitForTimeout(2000);
  }

  // Seed metadata, cortinas, tandas and a playlist through the preload API.
  await page.evaluate(async () => {
    const c = (window as any).compas;
    const lib = await c.getLibrary();
    const byFolder = (frag: string) => lib.songs.filter((s: any) => (s.folder || '').includes(frag));

    const meta: Record<string, {orq: string; genre: string; year: number | null; singer: string}> = {
      'Di Sarli': {orq: 'Carlos Di Sarli', genre: 'tango', year: 1941, singer: 'Roberto Rufino'},
      "D'Arienzo": {orq: "Juan D'Arienzo", genre: 'tango', year: 1937, singer: ''},
      'Biagi': {orq: 'Rodolfo Biagi', genre: 'vals', year: 1939, singer: 'Teofilo Ibanez'},
      'Canaro': {orq: 'Francisco Canaro', genre: 'milonga', year: 1933, singer: 'Ernesto Fama'},
    };
    for (const [frag, m] of Object.entries(meta)) {
      for (const s of byFolder(frag)) {
        await c.updateSong({id: s.id, title: s.title, orq: m.orq, singer: m.singer, album: null, year: m.year, genre: m.genre});
      }
    }
    for (const s of byFolder('Cortinas')) await c.setSongCortina(s.id, true);

    const fresh = await c.getLibrary();
    const ids = (frag: string) => fresh.songs.filter((s: any) => (s.folder || '').includes(frag)).map((s: any) => s.id);
    await c.saveTanda({name: 'Di Sarli con Rufino', songIds: ids('Di Sarli')});
    await c.saveTanda({name: "D'Arienzo instrumental", songIds: ids("D'Arienzo")});
    await c.saveTanda({name: 'Biagi vals', songIds: ids('Biagi')});
    await c.saveTanda({name: 'Canaro milonga', songIds: ids('Canaro')});

    const tandas = await c.listTandas();
    await c.savePlaylist({
      name: 'Saturday milonga',
      items: tandas.slice(0, 3).map((t: any) => ({type: 'tanda', refId: t.id})),
    }).catch(() => {});
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
});

test.afterAll(async () => {
  await app?.close();
});

async function dismissPopups() {
  const x = page.locator('.sotip-x');
  if (await x.isVisible().catch(() => false)) await x.click();
  const skip = page.locator('.tp-ob-skip');
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await page.waitForTimeout(200);
}

async function setTheme(theme: 'light' | 'dark') {
  await page.evaluate(t => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('compas.theme', t);
  }, theme);
  await page.waitForTimeout(150);
}

async function shoot(name: string) {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(theme);
    await page.screenshot({path: join(OUT, `${name}-${theme}.png`)});
  }
}

test('capture all views in both themes', async () => {
  test.setTimeout(240_000);

  // LIVE — queue two tandas and a cortina, start playing
  await gotoView(page, 'Live');
  await page.waitForTimeout(700);
  await dismissPopups();
  const addBtns = page.locator('.tp-addbtn');
  const n = await addBtns.count();
  for (let i = 0; i < Math.min(n, 2); i++) await addBtns.nth(i).click();
  // add a cortina from the Cortinas tab
  await page.locator('.tp-tab', {hasText: 'Cortinas'}).click().catch(() => {});
  await page.waitForTimeout(400);
  const cortAdd = page.locator('.tp-cortrow .tp-addbtn, .tp-addbtn').first();
  if (await cortAdd.isVisible().catch(() => false)) await cortAdd.click();
  await page.locator('.tp-tab', {hasText: 'Tandas'}).first().click().catch(() => {});
  await page.waitForTimeout(300);
  // press play
  await page.locator('.tp-tbtn.play').first().click().catch(() => {});
  await page.waitForTimeout(800);
  await shoot('live');

  await gotoView(page, 'Library');
  await page.waitForTimeout(700);
  await dismissPopups();
  // the root folder is expanded by default; open the first two child folders
  await page.locator('.tv-folder-row:not(.root)').nth(0).click().catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('.tv-folder-row:not(.root)').nth(1).click().catch(() => {});
  await page.waitForTimeout(400);
  await shoot('library');

  await gotoView(page, 'Tandas');
  await page.getByRole('tab', {name: 'Build'}).click();
  await page.waitForTimeout(700);
  await dismissPopups();
  await page.locator('.tv-folder-row:not(.root)').nth(0).click().catch(() => {});
  await page.waitForTimeout(300);
  // drop a couple of songs into the bench
  const adds = page.locator('.tv-song .add');
  const an = await adds.count();
  for (let i = 0; i < Math.min(an, 2); i++) await adds.nth(i).click();
  await page.waitForTimeout(300);
  await shoot('builder');

  await gotoView(page, 'Tandas');
  await page.getByRole('tab', {name: 'My tandas'}).click();
  await page.waitForTimeout(700);
  await dismissPopups();
  await shoot('tandas');

  await gotoView(page, 'Playlists');
  await page.waitForTimeout(700);
  await dismissPopups();
  await shoot('playlists');

  await gotoView(page, 'Settings');
  await page.waitForTimeout(700);
  await shoot('settings');

  // settings scrolled to the theme picker
  await page.locator('.tp-set-scroll').evaluate(el => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(300);
  await shoot('settings-bottom');

  // confirm modal + toast (delete a tanda)
  await gotoView(page, 'Tandas');
  await page.getByRole('tab', {name: 'My tandas'}).click();
  await page.waitForTimeout(500);
  await page.locator('.tv-tcbtn.del:visible').first().click();
  await page.waitForTimeout(400);
  await shoot('modal');
  await page.locator('.tp-modal-confirm').click();
  await page.waitForTimeout(400);
  await shoot('toast');
});
