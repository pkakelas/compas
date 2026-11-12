import type {AppInitConfig} from './AppInitConfig.js';
import {createModuleRunner} from './ModuleRunner.js';
import {disallowMultipleAppInstance} from './modules/SingleInstanceApp.js';
import {createWindowManagerModule} from './modules/WindowManager.js';
import {terminateAppOnLastWindowClose} from './modules/ApplicationTerminatorOnLastWindowClose.js';
import {hardwareAccelerationMode} from './modules/HardwareAccelerationModule.js';
import {autoUpdater} from './modules/AutoUpdater.js';
import {allowInternalOrigins} from './modules/BlockNotAllowdOrigins.js';
import {allowExternalUrls} from './modules/ExternalUrls.js';
import {databaseModule} from './modules/Database.js';
import {ipcModule} from './modules/Ipc.js';
import {communityModule} from './modules/Community.js';
import {audioProtocolModule, registerAudioScheme} from './modules/AudioProtocol.js';
import {mediaDevicePermissionsModule} from './modules/MediaDevicePermissions.js';
import {powerSaveBlockerModule} from './modules/PowerSaveBlocker.js';
import {antiThrottlingModule} from './modules/AntiThrottling.js';
import {controllersModule} from './modules/Controllers.js';

// The custom audio scheme must be registered as privileged before app ready.
registerAudioScheme();


export async function initApp(initConfig: AppInitConfig) {
  const moduleRunner = createModuleRunner()
    .init(antiThrottlingModule())
    .init(databaseModule())
    .init(audioProtocolModule())
    .init(mediaDevicePermissionsModule())
    .init(controllersModule())
    .init(powerSaveBlockerModule())
    .init(ipcModule())
    .init(communityModule())
    .init(createWindowManagerModule({initConfig, openDevTools: import.meta.env.DEV}))
    .init(disallowMultipleAppInstance())
    .init(terminateAppOnLastWindowClose())
    .init(hardwareAccelerationMode({enable: false}))
    .init(autoUpdater())

    // Security: only allow navigation within the app's own origin, and deny
    // opening new windows to any external origin.
    .init(allowInternalOrigins(
      new Set(initConfig.renderer instanceof URL ? [initConfig.renderer.origin] : []),
    ))
    .init(allowExternalUrls(new Set()));

  await moduleRunner;
}
