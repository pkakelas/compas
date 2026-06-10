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
 */
export async function launchApp(): Promise<LaunchedApp> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'compas-e2e-'));
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: repoRoot,
    env: {
      ...process.env,
      PLAYWRIGHT_TEST: 'true',
      NODE_ENV: 'test',
      MODE: 'test',
      CI: process.env.CI ?? '',
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return {app, page, userDataDir};
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

/** Click a top-nav tab by its visible label (the tabs are clickable divs). */
export async function gotoView(page: Page, label: string): Promise<void> {
  await page.getByText(label, {exact: true}).first().click();
}
