import {AppModule} from '../AppModule.js';
import {BrowserWindow, ipcMain} from 'electron';
import electronUpdater, {type AppUpdater, type Logger} from 'electron-updater';

type DownloadNotification = Parameters<AppUpdater['checkForUpdatesAndNotify']>[0];

/** What the renderer needs to show the "update ready" modal. */
type DownloadedUpdate = {version: string; releaseNotes?: string | null};

export class AutoUpdater implements AppModule {

  readonly #logger: Logger | null;
  readonly #notification: DownloadNotification;
  // The last update that finished downloading, kept so a window that mounts (or
  // reloads) after the download completes can still learn about it on demand.
  #downloaded: DownloadedUpdate | null = null;

  constructor(
    {
      logger = null,
      downloadNotification = undefined,
    }:
      {
        logger?: Logger | null | undefined,
        downloadNotification?: DownloadNotification
      } = {},
  ) {
    this.#logger = logger;
    this.#notification = downloadNotification;
  }

  async enable(): Promise<void> {
    this.registerIpc();
    // A Microsoft Store install is updated by the Store, which also rejects
    // apps that update themselves — so never check GitHub from one. The IPC
    // handlers stay registered so the renderer just sees "no update".
    if (process.windowsStore) return;
    await this.runAutoUpdater();
  }

  /** Renderer-facing controls: read the pending update, and trigger the install. */
  registerIpc(): void {
    // Lets a freshly-mounted window ask whether an update is already waiting
    // (the `update:downloaded` broadcast below may have fired before it loaded).
    ipcMain.handle('update:status', (): DownloadedUpdate | null => this.#downloaded);

    // Quit and relaunch into the freshly-downloaded version. No-op if nothing
    // has been downloaded yet.
    ipcMain.handle('update:install', () => {
      if (!this.#downloaded) return false;
      // isSilent=false so the installer UI shows on Windows; isForceRunAfter so
      // the app comes back up after replacing itself.
      this.getAutoUpdater().quitAndInstall(false, true);
      return true;
    });
  }

  /** Push the downloaded-update info to every open window so they can show the modal. */
  #broadcastDownloaded(update: DownloadedUpdate): void {
    this.#downloaded = update;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('update:downloaded', update);
    }
  }

  getAutoUpdater(): AppUpdater {
    // Using destructuring to access autoUpdater due to the CommonJS module of 'electron-updater'.
    // It is a workaround for ESM compatibility issues, see https://github.com/electron-userland/electron-builder/issues/7976.
    const {autoUpdater} = electronUpdater;
    return autoUpdater;
  }

  async runAutoUpdater() {
    const updater = this.getAutoUpdater();
    try {
      updater.logger = this.#logger || null;
      updater.fullChangelog = true;

      if (import.meta.env.VITE_DISTRIBUTION_CHANNEL) {
        updater.channel = import.meta.env.VITE_DISTRIBUTION_CHANNEL;
      }

      // When a new version finishes downloading, tell the renderer so it can
      // surface an in-app modal instead of the default OS notification. The
      // install itself waits for the DJ to click "Restart" (autoInstallOnAppQuit
      // still applies it on a normal quit as a fallback).
      updater.on('update-downloaded', info => {
        this.#broadcastDownloaded({
          version: info.version,
          releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
        });
      });

      // checkForUpdates (not ...AndNotify) so our modal is the single surface —
      // autoDownload stays on, so the new version still downloads in the
      // background and fires the event above.
      return await updater.checkForUpdates();
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('No published versions')) {
          return null;
        }
      }

      throw error;
    }
  }
}


export function autoUpdater(...args: ConstructorParameters<typeof AutoUpdater>) {
  return new AutoUpdater(...args);
}
