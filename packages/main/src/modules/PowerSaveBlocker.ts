import type {AppModule} from '../AppModule.js';
import type {ModuleContext} from '../ModuleContext.js';
import {ipcMain, powerSaveBlocker} from 'electron';

/**
 * Keeps the machine fully awake while music is playing. The renderer calls
 * `power:keepAwake` with its play/pause state.
 *
 * We hold TWO blockers for the whole "is playing" period, because they assert
 * different things to the OS and a long unattended set needs both:
 *   - `prevent-display-sleep` (Windows ES_DISPLAY_REQUIRED): keeps the screen
 *     lit. This is the UX fix (a DJ glances at now-playing/up-next mid-set) and
 *     the cure for renderer throttling — if the display sleeps the window gets
 *     occluded and Chromium throttles the playback tick, making the engine
 *     "flicker" (rapid stop/start). `backgroundThrottling: false` on the window
 *     is the belt to this suspenders.
 *   - `prevent-app-suspension` (Windows ES_SYSTEM_REQUIRED): asserts the system
 *     itself is in use. `prevent-display-sleep` only says "keep the screen on",
 *     NOT "keep the system at performance", so on Windows the box can still drop
 *     into an idle power state after the no-input timeout — starving a USB audio
 *     card's real-time isochronous stream and producing sudden mid-song
 *     distortion that only clears when the user moves the mouse. Holding the
 *     system blocker too keeps the machine marked active.
 *
 * `#start` returns the live `isStarted` state of both blockers so the renderer
 * can confirm the keep-awake actually took effect (the handler used to swallow
 * everything, so a silently-failed blocker was invisible).
 */
export class PowerSaveBlockerModule implements AppModule {
  #displayBlockerId: number | null = null;
  #systemBlockerId: number | null = null;

  enable(_context: ModuleContext): void {
    ipcMain.handle('power:keepAwake', (_event, keepAwake: boolean) => {
      if (keepAwake) {
        return this.#start();
      }
      this.#stop();
      return {display: false, system: false};
    });
  }

  #start(): {display: boolean; system: boolean} {
    if (!this.#isActive(this.#displayBlockerId)) {
      this.#displayBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    }
    if (!this.#isActive(this.#systemBlockerId)) {
      this.#systemBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
    const status = {
      display: this.#isActive(this.#displayBlockerId),
      system: this.#isActive(this.#systemBlockerId),
    };
    if (!status.display || !status.system) {
      console.warn('[power] keep-awake did not fully engage', status);
    }
    return status;
  }

  #stop(): void {
    for (const id of [this.#displayBlockerId, this.#systemBlockerId]) {
      if (this.#isActive(id)) powerSaveBlocker.stop(id as number);
    }
    this.#displayBlockerId = null;
    this.#systemBlockerId = null;
  }

  #isActive(id: number | null): boolean {
    return id !== null && powerSaveBlocker.isStarted(id);
  }
}

export function powerSaveBlockerModule(): PowerSaveBlockerModule {
  return new PowerSaveBlockerModule();
}
