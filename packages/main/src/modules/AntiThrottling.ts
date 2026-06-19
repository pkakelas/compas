import type {AppModule} from '../AppModule.js';
import type {ModuleContext} from '../ModuleContext.js';

/**
 * Stops Chromium from de-prioritizing this app's processes when the window is
 * occluded or the user goes idle. `backgroundThrottling: false` (set on the
 * window) covers per-window timer/animation throttling; these switches cover
 * the process-level backgrounding Chromium does independently of that flag.
 *
 * For a DJ tool this matters because a long unattended set must never let the
 * audio engine get throttled mid-set. These are belt-and-suspenders to the
 * powerSaveBlocker: the blocker keeps the OS awake, these keep Chromium from
 * throttling us regardless.
 *
 * Switches must be appended before the app `ready` event; a module's `enable`
 * runs during init (before ready), same as HardwareAccelerationModule.
 */
export class AntiThrottlingModule implements AppModule {
  enable({app}: ModuleContext): void {
    // Don't lower renderer process priority when its window is in the background.
    app.commandLine.appendSwitch('disable-renderer-backgrounding');
    // Don't treat an occluded window (e.g. display off) as backgrounded.
    app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
    // Don't throttle timers in backgrounded pages (redundant with the window's
    // backgroundThrottling:false, kept for defense in depth).
    app.commandLine.appendSwitch('disable-background-timer-throttling');
  }
}

export function antiThrottlingModule(): AntiThrottlingModule {
  return new AntiThrottlingModule();
}
