import pkg from './package.json' with {type: 'json'};
import mapWorkspaces from '@npmcli/map-workspaces';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Windows code signing via Azure Trusted Signing. Only the three AZURE_* auth
// vars are secret; the account/profile/endpoint/publisher are not and come from
// GitHub Actions repo *variables*. Signing is gated on the account name being
// present so local `compile:win` (and any build without Azure creds) still
// produces an unsigned binary instead of failing. electron-builder reads the
// AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET env vars itself for
// Entra ID auth, so they are not referenced here.
const azureSignOptions = process.env.AZURE_CODE_SIGNING_ACCOUNT
  ? {
      publisherName: process.env.AZURE_PUBLISHER_NAME,
      endpoint: process.env.AZURE_CODE_SIGNING_ENDPOINT,
      codeSigningAccountName: process.env.AZURE_CODE_SIGNING_ACCOUNT,
      certificateProfileName: process.env.AZURE_CODE_SIGNING_PROFILE,
    }
  : undefined;

export default /** @type import('electron-builder').Configuration */
({
  appId: 'com.compas.player',
  // ASCII slug for bundles, installers, and release URLs. Branded “Compás” is
  // restored in the UI (window title) and per-platform display names below.
  productName: 'Compas',
  executableName: 'Compas',
  publish: {
    provider: 'github',
    // Source lives in the private `compas` repo; binaries are published to a
    // separate public repo so the marketing site can link to them anonymously.
    owner: 'pkakelas',
    repo: 'compas-releases',
    releaseType: 'release',
  },
  directories: {
    output: 'dist',
    buildResources: 'buildResources',
  },
  generateUpdatesFilesForAllChannels: true,
  npmRebuild: true,
  asarUnpack: [
    '**/*.node',
    '**/node_modules/better-sqlite3/**',
    // The ffmpeg binary must live on the real filesystem so it can be spawned.
    '**/node_modules/ffmpeg-static/**',
  ],
  dmg: {
    title: 'Compás ${version}',
  },
  mac: {
    category: 'public.app-category.music',
    // Ship both Apple Silicon and Intel installers from the macOS CI runner.
    target: [
      {target: 'dmg', arch: ['arm64', 'x64']},
      {target: 'zip', arch: ['arm64', 'x64']},
    ],
    extendInfo: {
      CFBundleDisplayName: 'Compás',
    },
  },
  win: {
    // Ship both 64-bit Intel/AMD and ARM Windows installers.
    target: [
      {target: 'nsis', arch: ['x64', 'arm64']},
    ],
    // Present only when Azure creds are configured (CI release); otherwise the
    // build is unsigned. See azureSignOptions definition at the top of the file.
    ...(azureSignOptions ? {azureSignOptions} : {}),
  },
  nsis: {
    shortcutName: 'Compás',
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  linux: {
    target: ['deb'],
  },
  artifactName: 'Compas-${version}-${os}-${arch}.${ext}',
  files: [
    'LICENSE*',
    pkg.main,
    '!node_modules/@app/**',
    ...await getListOfFilesFromEachWorkspace(),
  ],
});

/**
 * By default, electron-builder copies each package into the output compilation entirety,
 * including the source code, tests, configuration, assets, and any other files.
 *
 * So you may get compiled app structure like this:
 * ```
 * app/
 * ├── node_modules/
 * │   └── workspace-packages/
 * │       ├── package-a/
 * │       │   ├── src/            # Garbage. May be safely removed
 * │       │   ├── dist/
 * │       │   │   └── index.js    # Runtime code
 * │       │   ├── vite.config.js  # Garbage
 * │       │   ├── .env            # some sensitive config
 * │       │   └── package.json
 * │       ├── package-b/
 * │       ├── package-c/
 * │       └── package-d/
 * ├── packages/
 * │   └── entry-point.js
 * └── package.json
 * ```
 *
 * To prevent this, we read the “files”
 * property from each package's package.json
 * and add all files that do not match the patterns to the exclusion list.
 *
 * This way,
 * each package independently determines which files will be included in the final compilation and which will not.
 *
 * So if `package-a` in its `package.json` describes
 * ```json
 * {
 *   "name": "package-a",
 *   "files": [
 *     "dist/**\/"
 *   ]
 * }
 * ```
 *
 * Then in the compilation only those files and `package.json` will be included:
 * ```
 * app/
 * ├── node_modules/
 * │   └── workspace-packages/
 * │       ├── package-a/
 * │       │   ├── dist/
 * │       │   │   └── index.js    # Runtime code
 * │       │   └── package.json
 * │       ├── package-b/
 * │       ├── package-c/
 * │       └── package-d/
 * ├── packages/
 * │   └── entry-point.js
 * └── package.json
 * ```
 */
async function getListOfFilesFromEachWorkspace() {

  /**
   * @type {Map<string, string>}
   */
  const workspaces = await mapWorkspaces({
    cwd: process.cwd(),
    pkg,
  });

  const allFilesToInclude = [];

  for (const [name, path] of workspaces) {
    const pkgPath = join(path, 'package.json');
    const {default: workspacePkg} = await import(pathToFileURL(pkgPath), {with: {type: 'json'}});

    let patterns = workspacePkg.files || ['dist/**', 'package.json'];

    patterns = patterns.map(p => join('node_modules', name, p));
    allFilesToInclude.push(...patterns);
  }

  return allFilesToInclude;
}
