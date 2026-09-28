import {test, expect, type ElectronApplication, type Page} from '@playwright/test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchApp, stubFolderDialog, gotoView} from './helpers/app.js';
import {makeMusicFixture, AIFF_FLAC_TITLES} from './helpers/wav.js';

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
  await page.getByText(/Import — set folder types/i).waitFor();
  await page.getByRole('button', {name: 'Import', exact: true}).click();
  await page
    .locator('#root')
    .getByText(/songs across/i)
    .first()
    .waitFor()
    .catch(() => {});
});

test.afterAll(async () => {
  await app?.close();
});

/** Stream a song through compas-audio:// and decode it with the renderer's own
 * media stack — exactly what Howler's html5 mode does — reporting the response
 * headers and the decoded duration. */
async function probeSong(title: string) {
  return page.evaluate(async t => {
    const c = (window as any).compas;
    const lib = await c.getLibrary();
    const song = lib.songs.find((s: any) => s.title === t);
    if (!song) return {found: false};
    const url = c.audioUrl(song.id);

    const full = await fetch(url);
    const partial = await fetch(url, {headers: {Range: 'bytes=0-99'}});

    const decoded = await new Promise<{ok: boolean; duration: number; error: string}>(resolve => {
      const a = new Audio();
      const timer = setTimeout(() => resolve({ok: false, duration: 0, error: 'timeout'}), 15_000);
      a.addEventListener('loadedmetadata', () => {
        clearTimeout(timer);
        resolve({ok: true, duration: a.duration, error: ''});
      });
      a.addEventListener('error', () => {
        clearTimeout(timer);
        resolve({ok: false, duration: 0, error: (a.error && a.error.message) || 'error'});
      });
      a.src = url;
      a.load();
    });

    return {
      found: true,
      status: full.status,
      contentType: full.headers.get('content-type'),
      partialStatus: partial.status,
      partialLength: partial.headers.get('content-length'),
      ...decoded,
    };
  }, title);
}

test('a FLAC track streams natively and decodes', async () => {
  const r = await probeSong(AIFF_FLAC_TITLES.flac);
  expect(r.found).toBe(true);
  expect(r.status).toBe(200);
  expect(r.contentType).toBe('audio/flac');
  expect(r.partialStatus).toBe(206);
  expect(r.partialLength).toBe('100');
  expect(r.ok, r.error).toBe(true);
  expect(r.duration).toBeCloseTo(1, 1);
});

test('an AIFF track is converted to WAV and decodes', async () => {
  const r = await probeSong(AIFF_FLAC_TITLES.aiff);
  expect(r.found).toBe(true);
  expect(r.status).toBe(200);
  // Chromium has no AIFF demuxer; the protocol serves a cached WAV conversion.
  expect(r.contentType).toBe('audio/wav');
  expect(r.partialStatus).toBe(206);
  expect(r.partialLength).toBe('100');
  expect(r.ok, r.error).toBe(true);
  expect(r.duration).toBeCloseTo(1, 1);
});
