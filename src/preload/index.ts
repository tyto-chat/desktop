import { contextBridge, ipcRenderer } from "electron";
import type { PlatformBridge, TrayCommand } from "../shared/bridge";

function subscribe<T>(channel: string, handler: (value: T) => void): () => void {
  const listener = (_event: unknown, value: T) => handler(value);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const bridge: PlatformBridge = {
  bridgeVersion: 2,
  secrets: {
    get: (key) => ipcRenderer.invoke("bridge:secrets:get", key),
    set: (key, value) => ipcRenderer.invoke("bridge:secrets:set", key, value),
    delete: (key) => ipcRenderer.invoke("bridge:secrets:delete", key),
  },
  config: {
    get: () => ipcRenderer.invoke("bridge:config:get"),
    set: (json) => ipcRenderer.invoke("bridge:config:set", json),
  },
  notifications: {
    show: (notification) => ipcRenderer.send("bridge:notifications:show", notification),
  },
  appState: {
    setBadge: (state) => ipcRenderer.send("bridge:appState:setBadge", state),
    setTrayLabels: (labels) => ipcRenderer.send("bridge:appState:setTrayLabels", labels),
  },
  app: {
    getVersion: () => ipcRenderer.invoke("bridge:app:getVersion"),
    setAutoLaunch: (enabled) => ipcRenderer.invoke("bridge:app:setAutoLaunch", enabled),
    quit: () => ipcRenderer.send("bridge:app:quit"),
    onDeepLink: (handler) => {
      const unsubscribe = subscribe<string>("deep-link", handler);
      ipcRenderer.send("bridge:app:deepLinksReady");
      return unsubscribe;
    },
    onTrayCommand: (handler) => subscribe<TrayCommand>("tray-command", handler),
  },
};

contextBridge.exposeInMainWorld("__TYTO_PLATFORM__", bridge);
