import { BrowserWindow, shell } from "electron";
import { KEYCHAIN_DOCS_URL, keychainErrorHtml } from "./errorPage";

export function createKeychainErrorWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 560,
    height: 380,
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: "#0f1117",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      javascript: false,
    },
  });

  const open = (url: string) => {
    if (url === KEYCHAIN_DOCS_URL) void shell.openExternal(url);
  };
  window.webContents.setWindowOpenHandler(({ url }) => {
    open(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    open(url);
  });

  void window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(keychainErrorHtml(KEYCHAIN_DOCS_URL))}`,
  );
  return window;
}
