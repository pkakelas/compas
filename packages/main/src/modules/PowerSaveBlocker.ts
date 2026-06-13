import type {AppModule} from '../AppModule.js';
import type {ModuleContext} from '../ModuleContext.js';
import {ipcMain, powerSaveBlocker} from 'electron';

/**
 * Keeps the display awake while music is playing. The renderer calls
 * `power:keepAwake` with its play/pause state; we hold a single
 * `prevent-display-sleep` blocker for the whole "is playing" period and
 * release it the moment playback stops.
 *
 * This is both a UX fix (a DJ glances at the now-playing/up-next list mid-set,
 * so the screen must not go dark) and the upstream cure for renderer
 * throttling: when the OS turns the display off after its idle timeout, the
 * window becomes occluded and Chromium throttles the playback tick, which made
 * the engine "flicker" (rapid stop/start) during long unattended sets.
 * Preventing display sleep means the window never gets occluded in the first
 * place. `backgroundThrottling: false` on the window is the belt to this
 * suspenders.
 */
export class PowerSaveBlockerModule implements AppModule {
  #blockerId: number | null = null;

  enable(_context: ModuleContext): void {
    ipcMain.handle('power:keepAwake', (_event, keepAwake: boolean) => {
      if (keepAwake) {
        this.#start();
      } else {
        this.#stop();
      }
    });
  }

  #start(): void {
    if (this.#blockerId !== null && powerSaveBlocker.isStarted(this.#blockerId)) return;
    this.#blockerId = powerSaveBlocker.start('prevent-display-sleep');
  }

  #stop(): void {
    if (this.#blockerId !== null && powerSaveBlocker.isStarted(this.#blockerId)) {
      powerSaveBlocker.stop(this.#blockerId);
    }
    this.#blockerId = null;
  }
}

export function powerSaveBlockerModule(): PowerSaveBlockerModule {
  return new PowerSaveBlockerModule();
}
