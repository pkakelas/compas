import {defineConfig} from '@playwright/test';

/**
 * E2E config for the Electron app. Tests launch the *built* app, so run
 * `pnpm build` first (the `pretest:e2e` script does this for you).
 *
 * Electron can only run one app per process and our tests share a single
 * launched instance per file, so we keep workers at 1 to avoid windows
 * fighting over focus / native audio.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {timeout: 10_000},
  reporter: [['list'], ['html', {open: 'never', outputFolder: 'tests/.report'}]],
  use: {
    trace: 'retain-on-failure',
  },
});
