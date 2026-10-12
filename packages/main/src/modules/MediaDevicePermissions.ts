import type {AppModule} from '../AppModule.js';
import type {ModuleContext} from '../ModuleContext.js';
import {session} from 'electron';

const AUDIO_PERMISSIONS = new Set(['media', 'audioCapture', 'speaker-selection']);
// Writing plain text to the clipboard (the Community's "Copy song list"). Only
// writing: nothing in the app reads the clipboard.
const ALLOWED = new Set([...AUDIO_PERMISSIONS, 'clipboard-sanitized-write']);

/**
 * Lets the renderer enumerate audio output devices (with real labels) and route
 * playback to a specific card via `HTMLMediaElement.setSinkId`. This powers the
 * DJ cue/monitor feature — the live set on one output, headphone previews on
 * another.
 *
 * Without these handlers Chromium hides device labels and refuses
 * `setSinkId` to any non-default device. Also lets the renderer write text to
 * the clipboard, which the same handlers would otherwise refuse.
 */
export class MediaDevicePermissionsModule implements AppModule {
  async enable({app}: ModuleContext): Promise<void> {
    await app.whenReady();
    const ses = session.defaultSession;

    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(ALLOWED.has(permission));
    });

    ses.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission));
  }
}

export function mediaDevicePermissionsModule(): MediaDevicePermissionsModule {
  return new MediaDevicePermissionsModule();
}
