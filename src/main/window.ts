import { app, BrowserWindow, desktopCapturer, shell } from "electron";
import { join } from "node:path";
import { classifyNavigation, isPermissionAllowed, originOf } from "./navigationPolicy";
import { APP_ORIGIN } from "./protocol";
import { chooseShareSource } from "./screenSharePolicy";
import { titleBarOptions, type WindowTheme } from "./windowChrome";

export function resolveAppOrigin(): string {
  const devUrl = app.isPackaged ? undefined : process.env.TYTO_DEV_URL;
  return (devUrl && originOf(devUrl)) || APP_ORIGIN;
}

export interface MainWindowOptions {
  theme: WindowTheme;
  startHidden: boolean;
  shouldReallyClose: () => boolean;
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const appOrigin = resolveAppOrigin();

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 480,
    show: false,
    backgroundColor: options.theme.color,
    autoHideMenuBar: true,
    ...titleBarOptions(process.platform, options.theme),
    webPreferences: {
      preload: join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  const { session } = window.webContents;
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(isPermissionAllowed(permission, details.requestingUrl, appOrigin));
  });
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    isPermissionAllowed(permission, requestingOrigin, appOrigin),
  );

  session.setDisplayMediaRequestHandler(
    (request, callback) => {
      void desktopCapturer
        .getSources({ types: ["screen", "window"] })
        .then((sources) => {
          const source = chooseShareSource(sources, request.securityOrigin, appOrigin);
          if (source) callback({ video: source });
          else callback({});
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: true },
  );

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (classifyNavigation(url, appOrigin) === "external") void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    const kind = classifyNavigation(url, appOrigin);
    if (kind === "internal") return;
    event.preventDefault();
    if (kind === "external") void shell.openExternal(url);
  });

  window.webContents.on("will-attach-webview", (event) => event.preventDefault());

  window.on("close", (event) => {
    if (options.shouldReallyClose()) return;
    event.preventDefault();
    window.hide();
  });

  window.once("ready-to-show", () => {
    if (!options.startHidden) window.show();
  });

  void window.loadURL(`${appOrigin}/`);

  return window;
}

export function revealWindow(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
