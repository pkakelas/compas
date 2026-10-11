import {test, expect, type ElectronApplication, type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchApp, stubFolderDialog, gotoView} from './helpers/app.js';
import {writeFlac, writeWav} from './helpers/wav.js';

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

/** The style each fixture song should end up with, by title. */
const EXPECTED: Record<string, string> = {
  'Toda mi vida': 'tango', // tagged "Tango" in an orchestra folder
  'Flor de lino': 'vals', // tagged "Tango Vals"
  'Mano brava': 'milonga', // tagged "Milonga"
  'Sin etiqueta': 'mixed', // no genre tag at all
  'Viejo porton': 'vals', // tagged "Tango", but its folder says Vals
  'La yumba': 'mixed', // tagged "Tango", but the DJ set its folder to Mixed
};

/** An orchestra folder (no style in its name) whose songs carry genre tags. */
function makeTaggedFixture(root: string): void {
  const orquesta = join(root, 'Troilo');
  const valses = join(root, 'Biagi - Vals');
  const forcedMixed = join(root, 'Pugliese');
  for (const dir of [orquesta, valses, forcedMixed]) mkdirSync(dir, {recursive: true});
  writeFlac(join(orquesta, 'Toda mi vida.flac'), 1, 'Tango');
  writeFlac(join(orquesta, 'Flor de lino.flac'), 1, 'Tango Vals');
  writeFlac(join(orquesta, 'Mano brava.flac'), 1, 'Milonga');
  writeWav(join(orquesta, 'Sin etiqueta.wav'));
  writeFlac(join(valses, 'Viejo porton.flac'), 1, 'Tango');
  writeFlac(join(forcedMixed, 'La yumba.flac'), 1, 'Tango');
}

const stylesByTitle = (p: Page): Promise<Record<string, string>> =>
  p.evaluate(async () => {
    const lib = await (window as any).compas.getLibrary();
    return Object.fromEntries(lib.songs.map((s: any) => [s.title, s.genre]));
  });

/** Run a statement against the (closed) app's library, under Electron's own
 *  Node so the natively-built better-sqlite3 loads. */
function execOnLibrary(dataDir: string, sql: string): void {
  const require = createRequire(new URL('../packages/main/package.json', import.meta.url));
  const script = `const db = require(${JSON.stringify(require.resolve('better-sqlite3'))})(process.argv[1]);
    db.exec(process.argv[2]); db.close();`;
  execFileSync(require('electron') as unknown as string, ['-e', script, join(dataDir, 'compas.db'), sql], {
    env: {...process.env, ELECTRON_RUN_AS_NODE: '1'},
  });
}

test.beforeAll(async () => {
  const launched = await launchApp();
  ({app, page, userDataDir} = launched);

  const musicRoot = mkdtempSync(join(tmpdir(), 'compas-music-'));
  makeTaggedFixture(musicRoot);
  await stubFolderDialog(app, musicRoot);
});

test.afterAll(async () => {
  await app?.close();
});

test('songs in a folder without a style take it from their genre tag', async () => {
  await gotoView(page, 'Tandas');
  await page.getByRole('button', {name: /Choose a folder/i}).click();
  await expect(page.getByText(/Import — set folder genres/i)).toBeVisible();

  // Mixed chosen by the DJ holds, whatever the tags say.
  const row = page.locator('.it-row', {hasText: 'Pugliese'});
  await row.locator('.it-pickbtn').click();
  await row.locator('.it-pop').getByRole('button', {name: 'Mixed', exact: true}).click();

  await page.getByRole('button', {name: 'Import', exact: true}).click();

  await expect.poll(() => stylesByTitle(page), {timeout: 15_000}).toEqual(EXPECTED);
});

test('a library imported before the tag was honoured is fixed on launch', async () => {
  // Rewind to what the old import left behind: every song in the orchestra
  // folder 'mixed', its tag never looked at.
  await app.close();
  execOnLibrary(
    userDataDir,
    `UPDATE songs SET genre = 'mixed', genre_tag_checked = 0 WHERE folder = 'Troilo'`,
  );

  ({app, page} = await launchApp(userDataDir));
  await expect.poll(() => stylesByTitle(page), {timeout: 15_000}).toEqual(EXPECTED);
});
