import { app, BrowserWindow, ipcMain, safeStorage, session } from "electron";
import { join } from "node:path";
import { ConfigStore } from "./configStore";
import { installContextMenu } from "./contextMenu";
import { DeepLinkQueue, notificationEnvelope, urlEnvelope } from "./deepLinks";
import { rearmQueueOnNavigation, wireDeepLinks } from "./deepLinkWiring";
import { createKeychainErrorWindow } from "./errorWindow";
import { registerBridgeIpc, RENDERER_CHANNELS } from "./ipc";
import { deviceStateDirectory, loadMlsWasm, MlsHost } from "./mls";
import { registerMlsIpc } from "./mlsIpc";
import { setLinuxAutostart } from "./linuxAutostart";
import { installMediaAuth } from "./mediaAuth";
import { originOf } from "./navigationPolicy";
import { showNativeNotification } from "./notifications";
import { preferredPasswordStore } from "./passwordStore";
import { registerAppProtocol, registerAppScheme } from "./protocol";
import { allowsWeakBackend, bootMode, SecretStore } from "./secrets";
import { ShellSettingsStore } from "./shellSettings";
import { createSpellCheck } from "./spellCheck";
import { createTray, type TrayController } from "./tray";
import { bundledTrayLabels, readTrayLabelBundle } from "./trayLabels";
import { mergeTrayLabels, type TrayAction } from "./trayState";
import { startAutoUpdates } from "./updater";
import { resolveUserDataDir } from "./userData";
import { createMainWindow, resolveAppOrigin, revealWindow } from "./window";
import { DEFAULT_WINDOW_THEME, overlayUpdate } from "./windowChrome";

const APP_ID = "chat.tyto.desktop";

let mainWindow: BrowserWindow | null = null;
let tray: TrayController | null = null;
let isQuitting = false;

const deepLinks = new DeepLinkQueue((envelope) => {
  mainWindow?.webContents.send(RENDERER_CHANNELS.deepLink, envelope);
});

function senderOrigin(event: unknown): string | null {
  const url = (event as Electron.IpcMainInvokeEvent).senderFrame?.url;
  return url ? originOf(url) : null;
}

function quit(): void {
  isQuitting = true;
  app.quit();
}

function reveal(): void {
  if (mainWindow) revealWindow(mainWindow);
}

function log(message: string, error?: unknown): void {
  console.log(`[tyto] ${message}`, error ?? "");
}

function startApp(): void {
  const appOrigin = resolveAppOrigin();
  const userData = app.getPath("userData");
  const shellSettings = new ShellSettingsStore(userData);
  const defaultTrayLabels = bundledTrayLabels(
    readTrayLabelBundle(join(__dirname, "..", "tray-labels.json")),
    app.getPreferredSystemLanguages(),
  );
  let shellLabels = mergeTrayLabels(shellSettings.readTrayLabels(), defaultTrayLabels);

  const setAutoLaunch = (enabled: boolean) => {
    if (process.platform === "linux") setLinuxAutostart(enabled);
    else app.setLoginItemSettings({ openAtLogin: enabled });
    tray?.setSettings(shellSettings.update({ autoLaunch: enabled }));
  };

  const onTrayAction = (action: TrayAction) => {
    switch (action.type) {
      case "open":
        reveal();
        return;
      case "quit":
        quit();
        return;
      case "toggle-auto-launch":
        setAutoLaunch(!shellSettings.read().autoLaunch);
        return;
      case "toggle-start-minimized":
        tray?.setSettings(
          shellSettings.update({ startMinimized: !shellSettings.read().startMinimized }),
        );
        return;
      case "command":
        mainWindow?.webContents.send(RENDERER_CHANNELS.trayCommand, action.command);
        return;
    }
  };

  const mediaAuth = installMediaAuth(session.defaultSession);
  const spellCheck = createSpellCheck(session.defaultSession, {
    read: () => shellSettings.readSpellCheckLanguages(),
    save: (languages) => shellSettings.saveSpellCheckLanguages(languages),
  });

  const secrets = new SecretStore(userData, safeStorage);
  const isTrustedSender = (event: unknown) => senderOrigin(event) === appOrigin;
  registerMlsIpc(ipcMain, {
    isTrustedSender,
    host: new MlsHost(loadMlsWasm(), secrets, deviceStateDirectory(join(userData, "e2ee"))),
  });

  registerBridgeIpc(ipcMain, {
    isTrustedSender,
    secrets,
    config: new ConfigStore(userData),
    getVersion: () => app.getVersion(),
    setAutoLaunch,
    quit,
    showNotification: (notification) =>
      showNativeNotification(notification, (payload) => {
        reveal();
        deepLinks.push(notificationEnvelope(payload));
      }),
    setBadge: (state) => tray?.setBadge(state),
    setTrayLabels: (received) => {
      shellLabels = mergeTrayLabels(received, defaultTrayLabels);
      shellSettings.saveTrayLabels({ ...shellLabels });
      tray?.setLabels(shellLabels);
    },
    setMediaAuth: (auth) => mediaAuth.set(auth),
    spellCheck,
    setWindowTheme: (theme) => {
      shellSettings.saveWindowTheme(theme);
      const overlay = overlayUpdate(process.platform, theme);
      if (overlay && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setTitleBarOverlay(overlay);
      }
    },
    deepLinksReady: () => deepLinks.markReady(),
  });

  tray = createTray({
    iconDir: join(__dirname, "..", "..", "assets", "tray"),
    settings: shellSettings.read(),
    labels: shellLabels,
    onAction: onTrayAction,
  });

  registerAppProtocol(join(__dirname, "..", "renderer"));
  mainWindow = createMainWindow({
    theme: shellSettings.readWindowTheme() ?? DEFAULT_WINDOW_THEME,
    startHidden: shellSettings.read().startMinimized,
    shouldReallyClose: () => isQuitting,
  });
  rearmQueueOnNavigation(mainWindow.webContents, deepLinks);
  installContextMenu(mainWindow.webContents, () => shellLabels);

  startAutoUpdates(log);
}

app.setPath(
  "userData",
  resolveUserDataDir({
    appData: app.getPath("appData"),
    isPackaged: app.isPackaged,
    override: process.env.TYTO_USER_DATA_DIR,
  }),
);

registerAppScheme();
app.setAppUserModelId(APP_ID);

const passwordStore = preferredPasswordStore({
  platform: process.platform,
  desktop: process.env.XDG_CURRENT_DESKTOP,
  explicit: app.commandLine.hasSwitch("password-store"),
  weakBackendAllowed: allowsWeakBackend({ isPackaged: app.isPackaged, env: process.env }),
});
if (passwordStore) app.commandLine.appendSwitch("password-store", passwordStore);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  wireDeepLinks(app, (url) => {
    reveal();
    deepLinks.push(urlEnvelope(url));
  });

  app.on("second-instance", reveal);
  app.on("activate", reveal);

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("window-all-closed", () => {
    if (isQuitting || !tray) app.quit();
  });

  void app.whenReady().then(() => {
    const allowWeakBackend = allowsWeakBackend({ isPackaged: app.isPackaged, env: process.env });
    if (allowWeakBackend) {
      log("INSECURE: weak keychain backends allowed for development");
      if (process.platform === "linux") safeStorage.setUsePlainTextEncryption(true);
    }
    const keychain = {
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      platform: process.platform,
      backend: process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : null,
      allowWeakBackend,
    };
    if (bootMode(keychain) === "keychain-error") {
      log(`keychain unavailable (backend: ${keychain.backend ?? "none"})`);
      createKeychainErrorWindow();
      return;
    }
    startApp();
  });
}
