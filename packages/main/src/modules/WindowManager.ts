import type {AppModule} from '../AppModule.js';
import {ModuleContext} from '../ModuleContext.js';
import {app, BrowserWindow, Menu, nativeImage, screen} from 'electron';
import type {MenuItemConstructorOptions} from 'electron';
import {join} from 'node:path';
import {readFileSync, writeFileSync} from 'node:fs';
import type {AppInitConfig} from '../AppInitConfig.js';
import {APP_ICON_DATA_URL} from './appIcon.js';

// Persisted window placement, so relaunching reopens at the same size/position
// the user left it. Stored as JSON next to the database in userData.
type WindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
  isFullScreen: boolean;
};

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1480,
  height: 940,
  isMaximized: false,
  isFullScreen: false,
};

const windowStateFile = () => join(app.getPath('userData'), 'window-state.json');

function loadWindowState(): WindowState {
  try {
    const saved = JSON.parse(readFileSync(windowStateFile(), 'utf-8')) as Partial<WindowState>;
    return {...DEFAULT_WINDOW_STATE, ...saved};
  } catch {
    // No saved state yet (or it's unreadable) — fall back to defaults.
    return {...DEFAULT_WINDOW_STATE};
  }
}

function saveWindowState(state: WindowState): void {
  try {
    writeFileSync(windowStateFile(), JSON.stringify(state));
  } catch {
    // Persisting placement is best-effort; never let it break the app.
  }
}

// True when the saved rectangle still overlaps a connected display, so we don't
// restore the window onto a monitor that has since been unplugged.
function isVisibleOnSomeDisplay(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) {
    return false;
  }
  return screen.getAllDisplays().some(({workArea}) => {
    return (
      state.x! < workArea.x + workArea.width &&
      state.x! + state.width > workArea.x &&
      state.y! < workArea.y + workArea.height &&
      state.y! + state.height > workArea.y
    );
  });
}

// The headphones app icon as a NativeImage, used for the BrowserWindow
// (Windows/Linux taskbar) and the macOS Dock (see enable()).
const appIcon = nativeImage.createFromDataURL(APP_ICON_DATA_URL);

// Build the application menu. Beyond the standard roles (so copy/paste/quit and
// friends keep working), the View menu owns the text-size shortcuts: each Zoom
// item nudges the renderer's text-size setting via an IPC message rather than
// Electron's native page zoom, so the keyboard, the menu and the Settings slider
// all drive one persisted value.
function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin';
  const sendZoom = (dir: 'in' | 'out' | 'reset') => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    win?.webContents.send('app:zoom', dir);
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{role: 'appMenu'} as MenuItemConstructorOptions] : []),
    {role: 'fileMenu'},
    {role: 'editMenu'},
    {
      label: 'View',
      submenu: [
        {role: 'reload'},
        {role: 'toggleDevTools'},
        {type: 'separator'},
        {label: 'Zoom In', accelerator: 'CommandOrControl+Plus', click: () => sendZoom('in')},
        // On most layouts "+" needs Shift; "=" is its unshifted twin, so bind both.
        // Hidden so the menu shows a single Zoom In entry; the accelerator still fires.
        {label: 'Zoom In', accelerator: 'CommandOrControl+=', visible: false, acceleratorWorksWhenHidden: true, click: () => sendZoom('in')},
        {label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: () => sendZoom('out')},
        {label: 'Actual Size', accelerator: 'CommandOrControl+0', click: () => sendZoom('reset')},
        {type: 'separator'},
        {role: 'togglefullscreen'},
      ],
    },
    {role: 'windowMenu'},
  ];
  return Menu.buildFromTemplate(template);
}

class WindowManager implements AppModule {
  readonly #preload: {path: string};
  readonly #renderer: {path: string} | URL;
  readonly #openDevTools;

  constructor({initConfig, openDevTools = false}: {initConfig: AppInitConfig, openDevTools?: boolean}) {
    this.#preload = initConfig.preload;
    this.#renderer = initConfig.renderer;
    this.#openDevTools = openDevTools;
  }

  async enable({app}: ModuleContext): Promise<void> {
    await app.whenReady();

    // Windows ties the taskbar icon (and shortcut grouping) to the
    // AppUserModelID. Without setting it explicitly, the running app's taskbar
    // button falls back to the generic Electron icon instead of ours. Match the
    // appId in electron-builder.mjs so dev and packaged builds agree.
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.compas.player');
    }

    // Give the macOS Dock (and the Cmd+Tab app switcher) our headphones icon.
    // Packaged builds already get it from buildResources/icon.icns, but a dev
    // run launches the stock Electron binary, which otherwise shows Electron's
    // default icon — so only override when running unpackaged.
    if (process.platform === 'darwin' && !app.isPackaged) {
      app.dock?.setIcon(appIcon);
    }

    // Install our application menu on every platform. On macOS it lives in the
    // global menu bar; on Windows/Linux it's hidden by autoHideMenuBar (toggled
    // with Alt) but its accelerators — including Ctrl +/-/0 for text size — still
    // fire.
    Menu.setApplicationMenu(buildAppMenu());

    await this.restoreOrCreateWindow(true);
    app.on('second-instance', () => this.restoreOrCreateWindow(true));
    app.on('activate', () => this.restoreOrCreateWindow(true));
  }

  async createWindow(): Promise<BrowserWindow> {
    const state = loadWindowState();
    // Only honour a saved position if it still lands on a connected display.
    const onScreen = isVisibleOnSomeDisplay(state);

    const browserWindow = new BrowserWindow({
      show: false, // Use the 'ready-to-show' event to show the instantiated BrowserWindow.
      width: state.width,
      height: state.height,
      x: onScreen ? state.x : undefined,
      y: onScreen ? state.y : undefined,
      minWidth: 720,
      minHeight: 520,
      backgroundColor: '#f0eee9',
      title: 'Compás',
      icon: appIcon, // Windows/Linux taskbar + window icon (ignored on macOS).
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false, // Sandbox disabled so the preload can use Node.js APIs (ipcRenderer, etc.)
        webviewTag: false, // The webview tag is not recommended. Consider alternatives like an iframe or Electron's BrowserView. @see https://www.electronjs.org/docs/latest/api/webview-tag#warning
        preload: this.#preload.path,
      },
    });

    // Re-apply the maximized / fullscreen state the user left the window in.
    if (state.isFullScreen) {
      browserWindow.setFullScreen(true);
    } else if (state.isMaximized) {
      browserWindow.maximize();
    }

    this.#trackWindowState(browserWindow);

    if (this.#renderer instanceof URL) {
      await browserWindow.loadURL(this.#renderer.href);
    } else {
      await browserWindow.loadFile(this.#renderer.path);
    }

    return browserWindow;
  }

  // Persist placement as the user resizes/moves the window and toggles
  // maximize/fullscreen, so the next launch reopens exactly where they left off.
  #trackWindowState(browserWindow: BrowserWindow) {
    const persist = () => {
      if (browserWindow.isDestroyed()) {
        return;
      }
      const isMaximized = browserWindow.isMaximized();
      const isFullScreen = browserWindow.isFullScreen();
      // getNormalBounds() reports the restored (un-maximized) rectangle, so we
      // keep a sensible size to return to after a maximize/fullscreen session.
      const bounds = browserWindow.getNormalBounds();
      saveWindowState({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized,
        isFullScreen,
      });
    };

    // Coalesce the flood of resize/move events into one write per idle moment.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const persistDebounced = () => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(persist, 400);
    };

    browserWindow.on('resize', persistDebounced);
    browserWindow.on('move', persistDebounced);
    browserWindow.on('maximize', persist);
    browserWindow.on('unmaximize', persist);
    browserWindow.on('enter-full-screen', persist);
    browserWindow.on('leave-full-screen', persist);
    // Final flush on close, in case the last change hasn't been written yet.
    browserWindow.on('close', () => {
      if (timer) {
        clearTimeout(timer);
      }
      persist();
    });
  }

  async restoreOrCreateWindow(show = false) {
    let window = BrowserWindow.getAllWindows().find(w => !w.isDestroyed());

    if (window === undefined) {
      window = await this.createWindow();
    }

    if (!show) {
      return window;
    }

    if (window.isMinimized()) {
      window.restore();
    }

    window?.show();

    if (this.#openDevTools) {
      window?.webContents.openDevTools();
    }

    window.focus();

    return window;
  }

}

export function createWindowManagerModule(...args: ConstructorParameters<typeof WindowManager>) {
  return new WindowManager(...args);
}
