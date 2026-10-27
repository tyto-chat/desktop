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
  bridgeVersion: 3,
  secrets: {
    get: (key) => ipcRenderer.invoke("bridge:secrets:get", key),
    set: (key, value) => ipcRenderer.invoke("bridge:secrets:set", key, value),
    delete: (key) => ipcRenderer.invoke("bridge:secrets:delete", key),
  },
  mls: {
    createDeviceKey: (scope) => ipcRenderer.invoke("bridge:mls:createDeviceKey", scope),
    deleteDeviceKey: (scope) => ipcRenderer.invoke("bridge:mls:deleteDeviceKey", scope),
    latestState: (scope) => ipcRenderer.invoke("bridge:mls:latestState", scope),
    pendingStages: (scope) => ipcRenderer.invoke("bridge:mls:pendingStages", scope),
    generateDevice: (scope, credential) =>
      ipcRenderer.invoke("bridge:mls:generateDevice", scope, credential),
    createKeyPackages: (scope, state, count, lifetimeSeconds) =>
      ipcRenderer.invoke("bridge:mls:createKeyPackages", scope, state, count, lifetimeSeconds),
    inspectKeyPackage: (keyPackage) =>
      ipcRenderer.invoke("bridge:mls:inspectKeyPackage", keyPackage),
    inspectGroupInfo: (groupInfo) => ipcRenderer.invoke("bridge:mls:inspectGroupInfo", groupInfo),
    createGroup: (scope, state, groupId) =>
      ipcRenderer.invoke("bridge:mls:createGroup", scope, state, groupId),
    addMembers: (scope, state, groupId, keyPackages) =>
      ipcRenderer.invoke("bridge:mls:addMembers", scope, state, groupId, keyPackages),
    joinFromWelcome: (scope, state, welcome) =>
      ipcRenderer.invoke("bridge:mls:joinFromWelcome", scope, state, welcome),
    joinExternal: (scope, state, groupInfo) =>
      ipcRenderer.invoke("bridge:mls:joinExternal", scope, state, groupInfo),
    removeMember: (scope, state, groupId, leafIndex) =>
      ipcRenderer.invoke("bridge:mls:removeMember", scope, state, groupId, leafIndex),
    stageIncomingCommit: (scope, state, groupId, commit) =>
      ipcRenderer.invoke("bridge:mls:stageIncomingCommit", scope, state, groupId, commit),
    merge: (stagedId) => ipcRenderer.invoke("bridge:mls:merge", stagedId),
    discard: (stagedId) => ipcRenderer.invoke("bridge:mls:discard", stagedId),
    encrypt: (scope, state, groupId, data) =>
      ipcRenderer.invoke("bridge:mls:encrypt", scope, state, groupId, data),
    decrypt: (scope, state, groupId, message) =>
      ipcRenderer.invoke("bridge:mls:decrypt", scope, state, groupId, message),
    acknowledgeDecrypt: (scope, receipt) =>
      ipcRenderer.invoke("bridge:mls:acknowledgeDecrypt", scope, receipt),
    signKeyPackageUpload: (scope, upload) =>
      ipcRenderer.invoke("bridge:mls:signKeyPackageUpload", scope, upload),
    signRevocation: (scope, revocation) =>
      ipcRenderer.invoke("bridge:mls:signRevocation", scope, revocation),
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
    setWindowTheme: (theme) => ipcRenderer.send("bridge:appState:setWindowTheme", theme),
    setMediaAuth: (auth) => ipcRenderer.send("bridge:appState:setMediaAuth", auth),
  },
  spellCheck: {
    get: () => ipcRenderer.invoke("bridge:spellCheck:get"),
    set: (languages) => ipcRenderer.invoke("bridge:spellCheck:set", languages),
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
