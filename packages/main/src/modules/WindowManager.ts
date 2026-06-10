import type {AppModule} from '../AppModule.js';
import {ModuleContext} from '../ModuleContext.js';
import {BrowserWindow, Menu} from 'electron';
import type {MenuItemConstructorOptions} from 'electron';
import type {AppInitConfig} from '../AppInitConfig.js';

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
    const browserWindow = new BrowserWindow({
      show: false, // Use the 'ready-to-show' event to show the instantiated BrowserWindow.
      width: 1480,
      height: 940,
      minWidth: 900,
      minHeight: 600,
      backgroundColor: '#f0eee9',
      title: 'Compás',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false, // Sandbox disabled so the preload can use Node.js APIs (ipcRenderer, etc.)
        webviewTag: false, // The webview tag is not recommended. Consider alternatives like an iframe or Electron's BrowserView. @see https://www.electronjs.org/docs/latest/api/webview-tag#warning
        preload: this.#preload.path,
      },
    });

    if (this.#renderer instanceof URL) {
      await browserWindow.loadURL(this.#renderer.href);
    } else {
      await browserWindow.loadFile(this.#renderer.path);
    }

    return browserWindow;
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
