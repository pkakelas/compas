import {test, expect, type ElectronApplication, type Page} from '@playwright/test';
import {launchApp, gotoView} from './helpers/app.js';

let app: ElectronApplication;
let page: Page;
const consoleErrors: string[] = [];

test.beforeAll(async () => {
  const launched = await launchApp();
  app = launched.app;
  page = launched.page;
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(`pageerror: ${err.message}`));

  // The first-run onboarding tour mounts a full-screen scrim that intercepts
  // nav clicks; skip it before the navigation tests run (same as shots.spec).
  await page.waitForTimeout(800);
  const obSkip = page.locator('.tp-ob-skip');
  if (await obSkip.isVisible().catch(() => false)) await obSkip.click();
});

test.afterAll(async () => {
  await app?.close();
});

test('app launches with a visible window and correct title', async () => {
  expect(await page.title()).toBe('Compás — Tango DJ Player');
  const isVisible = await app.evaluate(async ({BrowserWindow}) => {
    const win = BrowserWindow.getAllWindows()[0];
    return !!win && win.isVisible();
  });
  expect(isVisible).toBe(true);
  // The preload bridge is present in the real runtime (unlike the bare browser).
  expect(await page.evaluate(() => typeof (window as any).compas)).toBe('object');
});

test('all five nav views are reachable and render', async () => {
  for (const label of ['Library', 'Tandas', 'Playlists', 'Live', 'Settings']) {
    await gotoView(page, label);
    // Something rendered in the main content region beyond the chrome.
    await expect(page.locator('#root')).toBeVisible();
    const text = await page.locator('body').innerText();
    expect(text.length).toBeGreaterThan(20);
  }
});

test('Live view shows the queue and transport', async () => {
  await gotoView(page, 'Live');
  await expect(page.getByText('Add to queue')).toBeVisible();
  await expect(page.getByText('Queue', {exact: true})).toBeVisible();
});

test('nav is keyboard-accessible (tablist semantics, Enter + arrows)', async () => {
  const tabs = page.locator('.tp-navset [role="tab"]');
  await expect(tabs).toHaveCount(5);

  // Enter activates a focused tab (native <button> behaviour).
  await page.getByRole('tab', {name: 'Library'}).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', {name: 'Library'})).toHaveAttribute('aria-selected', 'true');

  // Arrow keys move selection AND focus (selection-follows-focus): Live → Settings.
  await page.getByRole('tab', {name: 'Live'}).click();
  await expect(page.getByRole('tab', {name: 'Live'})).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', {name: 'Settings'})).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', {name: 'Settings'})).toBeFocused();
});

test('no uncaught errors during navigation', async () => {
  // Allow benign network errors (e.g. blocked external font CDN under test),
  // but fail on app-level JS errors.
  const appErrors = consoleErrors.filter(
    e => !/fonts\.googleapis|fonts\.gstatic|net::ERR|Failed to load resource/i.test(e),
  );
  expect(appErrors, `unexpected errors:\n${appErrors.join('\n')}`).toHaveLength(0);
});
