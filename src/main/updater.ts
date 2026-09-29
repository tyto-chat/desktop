import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { startUpdateSchedule } from "./updateSchedule";

export function startAutoUpdates(log: (message: string, error?: unknown) => void): () => void {
  if (!app.isPackaged) return () => undefined;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", (error) => log("update failed", error));
  autoUpdater.on("update-downloaded", (info) =>
    log(`update ${info.version} downloaded; it installs when the app quits`),
  );

  return startUpdateSchedule({
    check: () => autoUpdater.checkForUpdates(),
    onError: (error) => log("update check failed", error),
  });
}
