import {test, expect, type ElectronApplication, type Page} from '@playwright/test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchApp, stubFolderDialog, gotoView} from './helpers/app.js';
import {makeMusicFixture} from './helpers/wav.js';

let app: ElectronApplication;
let page: Page;
let fixtureCounts: {tango: number; vals: number; total: number};

test.beforeAll(async () => {
  const launched = await launchApp();
  app = launched.app;
  page = launched.page;

  const musicRoot = mkdtempSync(join(tmpdir(), 'compas-music-'));
  fixtureCounts = makeMusicFixture(musicRoot);
  await stubFolderDialog(app, musicRoot);
});

test.afterAll(async () => {
  await app?.close();
});

test('importing a folder scans it and populates the library', async () => {
  await gotoView(page, 'Tandas');

  // Kick off the import — the native dialog is stubbed to our fixture folder.
  await page.getByRole('button', {name: /Choose a folder/i}).click();

  // The scan completes and the per-folder review modal opens.
  await expect(page.getByText(/Import — set folder types/i)).toBeVisible();

  // Commit, accepting the default (everything imports as "Mixed").
  await page.getByRole('button', {name: 'Import', exact: true}).click();

  // The library now holds every fixture track — verified through the real
  // IPC → scanFolder → SQLite path, not a mock.
  await expect
    .poll(async () => page.evaluate(async () => (await (window as any).compas.getLibrary()).songs.length), {
      timeout: 15_000,
    })
    .toBe(fixtureCounts.total);
});

test('imported songs are visible in the Library view', async () => {
  await gotoView(page, 'Library');
  // Library groups by folder (collapsed by default): assert the count header and
  // both fixture folders render with their per-folder song counts.
  await expect(page.getByText(`${fixtureCounts.total} songs across 3 folders`)).toBeVisible({timeout: 10_000});
  await expect(page.getByText('Di Sarli - Tango').first()).toBeVisible();
  await expect(page.getByText('Biagi - Vals').first()).toBeVisible();
});
