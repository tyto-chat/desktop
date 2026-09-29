import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { join } from "node:path";
import { ConfigStore } from "./configStore";
import { registerBridgeIpc, RENDERER_CHANNELS } from "./ipc";
import { registerAppProtocol, registerAppScheme } from "./protocol";
import { SecretStore } from "./secrets";
import { ShellSettingsStore } from "./shellSettings";
import { createTray, type TrayController } from "./tray";
import type { TrayAction } from "./trayState";
import { createMainWindow, resolveAppOrigin, revealWindow } from "./window";

let mainWindow: BrowserWindow | null = null;
let tray: TrayController | null = null;
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
    const shellSettings = new ShellSettingsStore(userData);

    const setAutoLaunch = (enabled: boolean) => {
      app.setLoginItemSettings({ openAtLogin: enabled });
      tray?.setSettings(shellSettings.update({ autoLaunch: enabled }));
    };

    const onTrayAction = (action: TrayAction) => {
      switch (action.type) {
        case "open":
          if (mainWindow) revealWindow(mainWindow);
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
      showNotification: () => undefined,
      setBadge: (state) => tray?.setBadge(state),
    });

    tray = createTray({
      iconDir: join(__dirname, "..", "..", "build", "tray"),
      settings: shellSettings.read(),
      onAction: onTrayAction,
    });

    registerAppProtocol(join(__dirname, "..", "renderer"));
    mainWindow = createMainWindow({
      startHidden: shellSettings.read().startMinimized,
      shouldReallyClose: () => isQuitting,
    });
  });
}
