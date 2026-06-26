// @ts-nocheck
import InteropApi from '../ipc-electron/interopApi.js';
import RemoteInteropApi from '../ipc-electron/remoteInteropApi.js';
import configRepository from '../services/config.js';
import vrcxJsonStorage from '../services/jsonStorage.js';

export async function initInteropApi(isVrOverlay = false) {
    const isRemote = Boolean(window.__VRCX_REMOTE__);
    const interopApi = isRemote ? RemoteInteropApi : InteropApi;

    if (isVrOverlay) {
        if (!isRemote && WINDOWS) {
            await CefSharp.BindObjectAsync('AppApiVr');
        } else {
            // @ts-ignore
            window.AppApiVr = interopApi.AppApiVrElectron;
        }
    } else {
        // #region | Init Cef C# bindings
        if (!isRemote && WINDOWS) {
            await CefSharp.BindObjectAsync(
                'AppApi',
                'WebApi',
                'VRCXStorage',
                'SQLite',
                'LogWatcher',
                'Discord',
                'AssetBundleManager'
            );
        } else {
            window.AppApi = interopApi.AppApiElectron;
            window.WebApi = interopApi.WebApi;
            window.VRCXStorage = interopApi.VRCXStorage;
            window.SQLite = interopApi.SQLite;
            window.LogWatcher = interopApi.LogWatcher;
            window.Discord = interopApi.Discord;
            window.AssetBundleManager = interopApi.AssetBundleManager;
            window.AppApiVrElectron = interopApi.AppApiVrElectron;

            if (isRemote) {
                initRemoteElectronCompat();
            }
        }

        await configRepository.init();
        new vrcxJsonStorage(VRCXStorage);

        AppApi.SetUserAgent();
    }
}

function initRemoteElectronCompat() {
    const noopListener = () => () => {};
    window.electron = {
        getArch: async () => 'remote',
        getClipboardText: async () => navigator.clipboard?.readText?.() || '',
        getNoUpdater: async () => true,
        setTrayIconNotification: async () => {},
        openFileDialog: async () => '',
        openDirectoryDialog: async () => '',
        onWindowPositionChanged: noopListener,
        onWindowSizeChanged: noopListener,
        onWindowStateChange: noopListener,
        onBrowserFocus: noopListener,
        desktopNotification: async () => {},
        restartApp: async () => {},
        getOverlayWindow: async () => null,
        updateVr: async () => {},
        ipcRenderer: {
            on: noopListener
        }
    };
}
