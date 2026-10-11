import {test, expect, type ElectronApplication, type Page} from '@playwright/test';
import {mkdtempSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {launchApp, gotoView, stubFolderDialog} from './helpers/app.js';
import {
  startCommunityStub,
  STUB_ACCOUNT,
  STUB_ANON_KEY,
  STUB_NEW_ACCOUNT,
  type CommunityStub,
} from './helpers/community-stub.js';

// Community accounts, end to end against a local stub backend: the real main
// process (auth client, encrypted session file, IPC) and the real sign-in UI.
// Google sign-in is not covered — it needs a real browser and Google account.

const ME = '11111111-1111-4111-8111-111111111111';

let stub: CommunityStub;
let app: ElectronApplication;
let page: Page;
let userDataDir: string;

async function launch(dir?: string) {
  const launched = await launchApp(dir, {
    env: {COMPAS_COMMUNITY_URL: stub.url, COMPAS_COMMUNITY_KEY: STUB_ANON_KEY},
    // Keep the OS keychain out of the test run (macOS would otherwise store —
    // and could prompt for — a real keychain item).
    args: ['--use-mock-keychain'],
  });
  app = launched.app;
  page = launched.page;
  userDataDir = launched.userDataDir;
}

test.describe.configure({mode: 'serial'});

test.beforeAll(async () => {
  stub = await startCommunityStub();
  await launch();
});

test.afterAll(async () => {
  await app?.close();
  await stub?.close();
});

test('the Community tab appears when a backend is configured', async () => {
  await expect(page.locator('.tp-navset [role="tab"]')).toHaveCount(6);
  // Never opened, and signed out: a "new" dot points at the tab, and goes once it is opened.
  await expect(page.locator('.tp-nav-dot')).toHaveCount(1);
  await gotoView(page, 'Community');
  await expect(page.getByRole('heading', {name: 'Sign in to Community'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Continue with Google'})).toBeVisible();
  await expect(page.locator('.tp-nav-dot')).toHaveCount(0);
});

test('the welcome tour tells new DJs about the Community', async () => {
  await gotoView(page, 'Settings');
  await page.getByRole('button', {name: 'Replay tour'}).click();
  // The last slide before the sign-off.
  const dots = page.locator('.tp-ob-dot');
  await dots.nth((await dots.count()) - 2).click();
  await expect(page.locator('.tp-ob-title')).toHaveText('Share tandas with other DJs');
  await expect(page.locator('.tp-ob-new')).toHaveText('New');
  await expect(page.locator('.tp-ob-how')).toContainText('Open the Community tab');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tp-ob-scrim')).toHaveCount(0);
  await gotoView(page, 'Community');
});

test('a wrong password is explained, the right one signs in', async () => {
  await page.getByLabel('Email').fill(STUB_ACCOUNT.email);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('don’t match');

  await page.getByLabel('Password').fill(STUB_ACCOUNT.password);
  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await expect(page.getByText('Nothing has been shared yet')).toBeVisible();
  await expect(page.locator('.cm-me-name')).toHaveText('Test DJ');
  await expect(page.locator('.cm-me-sub')).toHaveText('@dj_test');
});

test('the profile can be edited from Settings', async () => {
  // "Edit profile" lands on the Community card itself, not the top of Settings
  // (the card sits below the fold), with the name field ready to type in.
  await page.getByRole('button', {name: 'Edit profile'}).click();
  await expect(page.getByRole('tab', {name: 'Settings'})).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Name', {exact: true})).toBeFocused();
  await expect(page.getByLabel('Name', {exact: true})).toBeInViewport();
  await expect(page.getByText(`Signed in as ${STUB_ACCOUNT.email}`)).toBeInViewport();
  const save = page.getByRole('button', {name: 'Save profile'});
  await expect(save).toBeDisabled();

  await page.getByLabel('City').fill('Athens');
  await page.getByLabel('Name', {exact: true}).fill('Test DJ Renamed');
  await save.click();
  await expect(page.getByRole('button', {name: 'Saved'})).toBeVisible();
  expect(stub.profiles.get('11111111-1111-4111-8111-111111111111')).toMatchObject({
    display_name: 'Test DJ Renamed',
    city: 'Athens',
  });

  // A handle the backend would reject never leaves the app.
  await page.getByLabel('Handle').fill('no');
  await page.getByRole('button', {name: 'Save profile'}).click();
  await expect(page.getByRole('alert')).toContainText('3–24');
  expect(stub.profiles.get('11111111-1111-4111-8111-111111111111')?.handle).toBe('dj_test');

  await gotoView(page, 'Community');
  await expect(page.locator('.cm-me-name')).toHaveText('Test DJ Renamed');
  await expect(page.locator('.cm-me-sub')).toHaveText('@dj_test · Athens');
});

test('the profile picture can be one of the drawn ones, or an uploaded photo', async () => {
  // With nothing chosen, the app draws one from the account id; picking
  // another is one click, and the backend remembers it.
  await page.getByRole('button', {name: 'Edit profile'}).click();
  const card = page.locator('.cm-acct-avatar');
  const own = card.locator('.cm-avatar');
  await expect(own).toHaveAttribute('data-preset', /^\d+$/);
  await card.getByRole('radio', {name: 'Picture 4'}).click();
  await expect(card.getByRole('radio', {name: 'Picture 4'})).toHaveAttribute('aria-checked', 'true');
  await expect(own).toHaveAttribute('data-preset', '3');
  expect(stub.profiles.get(ME)?.avatar_url).toBe('preset:3');

  // A photo: chosen from disk, squared and shrunk here, stored as the DJ's
  // own file, and shown from there.
  const dir = mkdtempSync(join(tmpdir(), 'compas-avatar-'));
  const png = join(dir, 'me.png');
  // A 6×4 PNG (made by Electron itself), so the crop and resize have
  // something to do.
  const pngBase64 = await app.evaluate(({nativeImage}) => {
    const w = 6, h = 4, px = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) px.set([200, 60, 60, 255], i * 4);
    return nativeImage.createFromBitmap(px, {width: w, height: h}).toPNG().toString('base64');
  });
  writeFileSync(png, Buffer.from(pngBase64, 'base64'));
  await stubFolderDialog(app, png);
  await card.getByRole('button', {name: 'Upload a photo…'}).click();
  await expect(card.locator('img.cm-avatar')).toHaveAttribute('src', new RegExp(`/storage/v1/object/public/avatars/${ME}/\\d+\\.jpg$`));
  const mine = () => [...stub.uploads.keys()].filter(p => p.startsWith(`${ME}/`));
  expect(mine()).toHaveLength(1);
  const stored = stub.uploads.get(mine()[0])!;
  expect(stored.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff])); // a JPEG
  // What is stored is "an upload", not a URL: the app builds that itself.
  expect(stub.profiles.get(ME)?.avatar_url).toMatch(/^upload:\d+$/);
  // Everywhere the DJ appears, it is the photo now.
  await gotoView(page, 'Community');
  await expect(page.locator('.cm-me img.cm-avatar')).toBeVisible();
  await page.getByRole('button', {name: 'Edit profile'}).click();

  // A second photo is a file of its own; the first is deleted once replaced.
  await stubFolderDialog(app, png);
  const first = mine()[0];
  await card.getByRole('button', {name: 'Upload a photo…'}).click();
  await expect.poll(() => mine().length === 1 && mine()[0] !== first).toBe(true);
  await expect(card.locator('img.cm-avatar')).toHaveAttribute('src', new RegExp(`/${mine()[0]}$`));

  // And it can be taken down again — the file too, not just the link to it.
  await card.getByRole('button', {name: 'Remove photo'}).click();
  await expect(own).toHaveAttribute('data-preset', /^\d+$/);
  expect(stub.profiles.get(ME)?.avatar_url).toBeNull();
  await expect.poll(() => mine()).toEqual([]);

  // If deleting the file fails, the picture still changes, and the file is
  // deleted later without the DJ having to do anything.
  await stubFolderDialog(app, png);
  await card.getByRole('button', {name: 'Upload a photo…'}).click();
  await expect(card.locator('img.cm-avatar')).toBeVisible();
  stub.flags.failStorageDeletes = true;
  await card.getByRole('radio', {name: 'Picture 2'}).click();
  await expect(own).toHaveAttribute('data-preset', '1');
  expect(mine()).toHaveLength(1);
  stub.flags.failStorageDeletes = false;
  await gotoView(page, 'Community'); // anything that reads the account state retries
  await expect.poll(() => mine()).toEqual([]);
});

test('the session survives a restart and is not stored in clear', async () => {
  await app.close();

  const files = readdirSync(userDataDir).filter(f => f.startsWith('community-session-'));
  expect(files).toHaveLength(1);
  const stored = readFileSync(join(userDataDir, files[0])).toString('latin1');
  for (const token of stub.issuedTokens) expect(stored).not.toContain(token);
  expect(stored).not.toContain('stub-refresh-');
  expect(stored).not.toContain(STUB_ACCOUNT.email);

  await launch(userDataDir);
  await gotoView(page, 'Community');
  await expect(page.locator('.cm-me-name')).toHaveText('Test DJ Renamed');
});

test('signing out returns to the sign-in screen and removes the session file', async () => {
  await gotoView(page, 'Settings');
  await page.getByRole('button', {name: 'Sign out'}).click();
  await expect(page.getByText('You’re not signed in.')).toBeVisible();
  expect(readdirSync(userDataDir).filter(f => f.startsWith('community-session-'))).toHaveLength(0);

  await page.getByRole('button', {name: 'Sign in', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Sign in to Community'})).toBeVisible();
});

test('creating an account asks for the emailed code', async () => {
  await page.getByRole('button', {name: 'Create an account'}).click();
  await expect(page.getByRole('heading', {name: 'Create your account'})).toBeVisible();

  // An address that already has an account is told so — not sent to wait for
  // a confirmation email the backend will never send.
  await page.getByLabel('Email').fill(STUB_ACCOUNT.email);
  await page.getByLabel('Password').fill(STUB_NEW_ACCOUNT.password);
  await page.getByRole('button', {name: 'Create account', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('already an account');
  await expect(page.getByRole('heading', {name: 'Create your account'})).toBeVisible();

  await page.getByLabel('Email').fill(STUB_NEW_ACCOUNT.email);
  await page.getByLabel('Password').fill('short');
  await page.getByRole('button', {name: 'Create account', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('at least 8 characters');

  await page.getByLabel('Password').fill(STUB_NEW_ACCOUNT.password);
  await page.getByRole('button', {name: 'Create account', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Check your email'})).toBeVisible();

  await page.getByLabel('Confirmation code').fill('000000');
  await page.getByRole('button', {name: 'Confirm email'}).click();
  await expect(page.getByRole('alert')).toContainText('wrong or has expired');

  await page.getByLabel('Confirmation code').fill(STUB_NEW_ACCOUNT.code);
  await page.getByRole('button', {name: 'Confirm email'}).click();
  await expect(page.locator('.cm-me-name')).toHaveText('New DJ');
});

test('deleting the account asks first, then signs out', async () => {
  await gotoView(page, 'Settings');
  await page.getByRole('button', {name: 'Delete account…'}).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Delete your Community account?');

  await dialog.getByRole('button', {name: 'Keep account'}).click();
  await expect(dialog).toHaveCount(0);
  expect(stub.deleted.size).toBe(0);

  await page.getByRole('button', {name: 'Delete account…'}).click();
  await page.getByRole('alertdialog').getByRole('button', {name: 'Delete account'}).click();
  await expect(page.getByText('You’re not signed in.')).toBeVisible();
  expect([...stub.deleted]).toEqual(['22222222-2222-4222-8222-222222222222']);
});
