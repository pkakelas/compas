import {test, expect, type ElectronApplication, type Page} from '@playwright/test';
import {readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {launchApp, gotoView} from './helpers/app.js';

/**
 * Language switching (Settings ▸ Appearance ▸ Language): the UI retranslates in
 * place, <html lang> and the native menu follow, and the choice survives a
 * relaunch. Expected strings are read from the locale files themselves so the
 * test doesn't have to be touched when a translation is reworded.
 */

const localesDir = fileURLToPath(new URL('../packages/renderer/locales', import.meta.url));
const NAV = ['Library', 'Tandas', 'Playlists', 'Live', 'Settings'];
// locale id → the BCP 47 tag it puts on <html lang> (LOCALES in entries/i18n.js).
const LANG: Record<string, string> = {
  en: 'en', zh: 'zh-Hans', hi: 'hi', es: 'es', fr: 'fr', el: 'el', it: 'it', de: 'de', tr: 'tr', ru: 'ru', ja: 'ja',
};

const common = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(join(localesDir, locale, 'common.json'), 'utf8'));
const namespaces = readdirSync(join(localesDir, 'en')).map(f => f.replace(/\.json$/, ''));
// A message that failed to resolve renders as its raw key, e.g. "player.queue".
const RAW_KEY = new RegExp(`\\b(${namespaces.join('|')})\\.[a-z][A-Za-z.]*[A-Za-z]`);

let app: ElectronApplication;
let page: Page;
let userDataDir: string;
const pageErrors: string[] = [];

const languageSelect = () => page.locator('select.tp-set-select').filter({has: page.locator('option[value="el"]')});
const navTabs = () => page.locator('.tp-navset [role="tab"]');

test.beforeAll(async () => {
  ({app, page, userDataDir} = await launchApp());
  page.on('pageerror', err => pageErrors.push(err.message));
});

test.afterAll(async () => {
  await app?.close();
});

test('English is the default language', async () => {
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(navTabs()).toHaveText(NAV);
  await gotoView(page, 'Settings');
  await expect(languageSelect()).toHaveValue('en');
  // Every language is offered under its own name.
  await expect(languageSelect().locator('option')).toHaveText(
    ['English', '中文', 'हिन्दी', 'Español', 'Français', 'Ελληνικά', 'Italiano', 'Deutsch', 'Türkçe', 'Русский', '日本語'],
  );
});

for (const locale of Object.keys(LANG).filter(l => l !== 'en')) {
  test(`switching to ${locale} retranslates every view in place`, async () => {
    const msgs = common(locale);
    await navTabs().nth(NAV.indexOf('Settings')).click();
    await languageSelect().selectOption(locale);

    await expect(page.locator('html')).toHaveAttribute('lang', LANG[locale]);
    await expect(navTabs()).toHaveText(NAV.map(n => msgs[`nav.${n}`]));
    // Still on Settings — nothing remounted, the picker reflects the choice.
    await expect(languageSelect()).toHaveValue(locale);

    for (let i = 0; i < NAV.length; i++) {
      await navTabs().nth(i).click();
      await expect(navTabs().nth(i)).toHaveAttribute('aria-selected', 'true');
      const text = await page.locator('.tp-app').innerText();
      expect(text.match(RAW_KEY)?.[0], `untranslated key in ${NAV[i]} (${locale})`).toBeUndefined();
    }
  });
}

test('the native View menu follows the language', async () => {
  await navTabs().nth(NAV.indexOf('Settings')).click();
  await languageSelect().selectOption('el');
  await expect
    .poll(() => app.evaluate(({Menu}) => Menu.getApplicationMenu()?.items.map(i => i.label) ?? []))
    .toContain('Προβολή');
});

test('the chosen language survives a relaunch', async () => {
  await app.close();
  ({app, page} = await launchApp(userDataDir));
  page.on('pageerror', err => pageErrors.push(err.message));
  await expect(page.locator('html')).toHaveAttribute('lang', 'el');
  await expect(navTabs()).toHaveText(NAV.map(n => common('el')[`nav.${n}`]));
});

test('no uncaught errors while switching languages', async () => {
  expect(pageErrors, `unexpected errors:\n${pageErrors.join('\n')}`).toHaveLength(0);
});
