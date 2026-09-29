import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { registerAppProtocol, registerAppScheme } from "./protocol";
import { createMainWindow, revealWindow } from "./window";

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

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
    registerAppProtocol(join(__dirname, "..", "renderer"));
    mainWindow = createMainWindow({
      startHidden: false,
      shouldReallyClose: () => isQuitting,
    });
  });
}
