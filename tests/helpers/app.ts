import {_electron as electron, type ElectronApplication, type Page} from '@playwright/test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export type LaunchedApp = {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
};

/**
 * Launch the built Compás app under Electron with an isolated user-data dir.
 *
 * Isolation matters twice over:
 *  - the SQLite library (compas.db) lives in userData, so a temp dir keeps
 *    tests from touching the real library;
 *  - Electron's single-instance lock is keyed off userData, so a temp dir lets
 *    tests run even while a real dev instance is open.
 *
 * We launch the production-style path (renderer loaded from disk, no Vite dev
 * server) by NOT setting MODE=development / VITE_DEV_SERVER_URL. PLAYWRIGHT_TEST
 * makes the entry point crash-fast on unhandled errors.
 *
 * Pass the `userDataDir` of an earlier launch to reopen that same library.
 *
 * Community is switched off by default (an empty COMPAS_COMMUNITY_URL overrides
 * whatever backend the build was made with), so no test ever talks to a real
 * Community server. A spec that needs it passes a local stub's URL in `opts.env`.
 */
export async function launchApp(
  userDataDir = mkdtempSync(join(tmpdir(), 'compas-e2e-')),
  opts: {env?: Record<string, string>; args?: string[]} = {},
): Promise<LaunchedApp> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`, ...(opts.args ?? [])],
    cwd: repoRoot,
    env: {
      ...process.env,
      PLAYWRIGHT_TEST: 'true',
      NODE_ENV: 'test',
      MODE: 'test',
      CI: process.env.CI ?? '',
      COMPAS_COMMUNITY_URL: '',
      COMPAS_COMMUNITY_KEY: '',
      ...opts.env,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await skipTour(page);
  return {app, page, userDataDir};
}

/**
 * Dismiss the first-run feature tour if it's up. A fresh user-data dir always
 * triggers it, and its scrim swallows every click until it's skipped.
 */
export async function skipTour(page: Page): Promise<void> {
  const skip = page.locator('.tp-ob-scrim .tp-ob-skip');
  if (await skip.isVisible({timeout: 2_000}).catch(() => false)) {
    await skip.click();
    await page.locator('.tp-ob-scrim').waitFor({state: 'detached'}).catch(() => {});
  }
}

/**
 * Replace the native open-folder dialog in the MAIN process so clicking
 * "Choose a folder…" resolves to `folder` instead of blocking on a real OS
 * picker Playwright can't drive. Must run before the click that triggers it.
 */
export async function stubFolderDialog(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({dialog}, chosen) => {
    // @ts-expect-error overriding for the test session
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [chosen]});
  }, folder);
}

/** Click a top-nav tab by its label. Matched by role within the nav, and by the
 *  start of its name, because the Community tab's name grows a count when
 *  there are notifications ("Community 1 new notifications"). */
export async function gotoView(page: Page, label: string): Promise<void> {
  await page.locator('.tp-navset').getByRole('tab', {name: new RegExp(`^${label}`)}).click();
}
