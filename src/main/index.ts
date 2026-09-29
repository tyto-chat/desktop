import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { join } from "node:path";
import { ConfigStore } from "./configStore";
import { registerBridgeIpc } from "./ipc";
import { registerAppProtocol, registerAppScheme } from "./protocol";
import { SecretStore } from "./secrets";
import { createMainWindow, resolveAppOrigin, revealWindow } from "./window";

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

function senderOrigin(event: unknown): string | null {
  const url = (event as Electron.IpcMainInvokeEvent).senderFrame?.url;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function quit(): void {
  isQuitting = true;
  app.quit();
}

registerAppScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) revealWindow(mainWindow);
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("activate", () => {
    if (mainWindow) revealWindow(mainWindow);
  });

  app.on("window-all-closed", () => {
    if (isQuitting) app.quit();
  });

  void app.whenReady().then(() => {
    const appOrigin = resolveAppOrigin();
    const userData = app.getPath("userData");

    registerBridgeIpc(ipcMain, {
      isTrustedSender: (event) => senderOrigin(event) === appOrigin,
      secrets: new SecretStore(userData, safeStorage),
      config: new ConfigStore(userData),
      getVersion: () => app.getVersion(),
      setAutoLaunch: (enabled) => app.setLoginItemSettings({ openAtLogin: enabled }),
      quit,
      showNotification: () => undefined,
      setBadge: () => undefined,
    });

    registerAppProtocol(join(__dirname, "..", "renderer"));
    mainWindow = createMainWindow({
      startHidden: false,
      shouldReallyClose: () => isQuitting,
    });
  });
}
