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

// Microsoft Store package, built only by the "Store package" workflow (which
// asks for the appx target on the command line — it is deliberately not in
// win.target, so releases never build it). The three identity values are copied
// from Partner Center → Product identity; none are secret, so they come from
// GitHub Actions repo *variables*. The package is left unsigned — the Store
// signs it on ingestion.
const appxOptions = process.env.APPX_IDENTITY_NAME
  ? {
      identityName: process.env.APPX_IDENTITY_NAME,
      publisher: process.env.APPX_PUBLISHER,
      publisherDisplayName: process.env.APPX_PUBLISHER_DISPLAY_NAME,
      applicationId: 'Compas',
      // Must match an app name reserved in Partner Center, or the upload is
      // rejected. Override with APPX_DISPLAY_NAME if "Compás" isn't reserved.
      displayName: process.env.APPX_DISPLAY_NAME || 'Compás',
      // The tile images in buildResources/appx carry their own rounded plate.
      backgroundColor: 'transparent',
      // The x64 and arm64 packages go into one .msixbundle, which needs them to
      // declare the same Windows versions (electron-builder's default differs
      // per architecture), and the Store only accepts .msix bundles targeting
      // Windows 10 1809 (10.0.17763) or later.
      minVersion: '10.0.17763.0',
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
    // Code signing + notarization for distribution outside the Mac App Store.
    // The Developer ID Application cert is supplied via CSC_LINK/CSC_KEY_PASSWORD
    // (base64 .p12 + password) which electron-builder reads directly; locally,
    // a cert in the login keychain is used automatically. Hardened runtime +
    // entitlements are mandatory for notarization.
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'buildResources/entitlements.mac.plist',
    entitlementsInherit: 'buildResources/entitlements.mac.plist',
    // Notarize only when App Store Connect API key creds are present (CI
    // release). electron-builder reads APPLE_API_KEY / APPLE_API_KEY_ID /
    // APPLE_API_ISSUER itself; gating keeps local `compile:mac` building an
    // unsigned, un-notarized app instead of failing.
    notarize: process.env.APPLE_API_KEY_ID ? true : false,
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
  ...(appxOptions ? {appx: appxOptions} : {}),
  nsis: {
    shortcutName: 'Compás',
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
  linux: {
    // AppImage only: it needs no signing, runs on any distro, and is the one
    // Linux format electron-updater replaces in place without asking for root.
    // x64 only for now. Must be built on Linux (the release workflow's ubuntu
    // runner) — ffmpeg-static bundles the binary for the machine doing the
    // install, so a cross-build from macOS would ship a macOS ffmpeg.
    // A .deb would additionally need a maintainer email (linux.maintainer).
    target: [{target: 'AppImage', arch: ['x64']}],
    // The menu category is derived from mac.category (music → Audio;AudioVideo).
    // productName stays ASCII for file names; launchers show the real name.
    desktop: {
      entry: {
        Name: 'Compás',
      },
    },
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
