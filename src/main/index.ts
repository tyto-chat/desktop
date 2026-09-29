import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { join } from "node:path";
import { ConfigStore } from "./configStore";
import { DeepLinkQueue, notificationEnvelope, urlEnvelope } from "./deepLinks";
import { wireDeepLinks } from "./deepLinkWiring";
import { createKeychainErrorWindow } from "./errorWindow";
import { registerBridgeIpc, RENDERER_CHANNELS } from "./ipc";
import { originOf } from "./navigationPolicy";
import { showNativeNotification } from "./notifications";
import { registerAppProtocol, registerAppScheme } from "./protocol";
import { allowsWeakBackend, bootMode, SecretStore } from "./secrets";
import { ShellSettingsStore } from "./shellSettings";
import { createTray, type TrayController } from "./tray";
import type { TrayAction } from "./trayState";
import { startAutoUpdates } from "./updater";
import { createMainWindow, resolveAppOrigin, revealWindow } from "./window";

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

  const setAutoLaunch = (enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
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

  registerBridgeIpc(ipcMain, {
    isTrustedSender: (event) => senderOrigin(event) === appOrigin,
    secrets: new SecretStore(userData, safeStorage),
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
    deepLinksReady: () => deepLinks.markReady(),
  });

  tray = createTray({
    iconDir: join(__dirname, "..", "..", "assets", "tray"),
    settings: shellSettings.read(),
    onAction: onTrayAction,
  });

  registerAppProtocol(join(__dirname, "..", "renderer"));
  mainWindow = createMainWindow({
    startHidden: shellSettings.read().startMinimized,
    shouldReallyClose: () => isQuitting,
  });
  mainWindow.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) deepLinks.markNotReady();
  });

  wireDeepLinks(app, (url) => {
    reveal();
    deepLinks.push(urlEnvelope(url));
  });

  startAutoUpdates(log);
}

registerAppScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
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
