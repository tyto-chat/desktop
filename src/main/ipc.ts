import type { BridgeBadgeState, BridgeNotification } from "../shared/bridge";

export const BRIDGE_CHANNELS = {
  secretsGet: "bridge:secrets:get",
  secretsSet: "bridge:secrets:set",
  secretsDelete: "bridge:secrets:delete",
  configGet: "bridge:config:get",
  configSet: "bridge:config:set",
  appGetVersion: "bridge:app:getVersion",
  appSetAutoLaunch: "bridge:app:setAutoLaunch",
  appQuit: "bridge:app:quit",
  appDeepLinksReady: "bridge:app:deepLinksReady",
  notificationsShow: "bridge:notifications:show",
  appStateSetBadge: "bridge:appState:setBadge",
  appStateSetTrayLabels: "bridge:appState:setTrayLabels",
} as const;

export const RENDERER_CHANNELS = {
  deepLink: "deep-link",
  trayCommand: "tray-command",
} as const;

const MAX_KEY_LENGTH = 512;
const MAX_SECRET_LENGTH = 65_536;
const MAX_CONFIG_LENGTH = 1_048_576;
const MAX_TITLE_LENGTH = 256;
const MAX_BODY_LENGTH = 2_048;
const MAX_TAG_LENGTH = 256;
const MAX_PAYLOAD_LENGTH = 8_192;
const MAX_CALL_LABEL_LENGTH = 256;
const MAX_TOOLTIP_LENGTH = 512;

const CALL_STATES: readonly unknown[] = ["none", "in-call", "in-call-muted"];

export interface IpcRegistrar {
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

export interface BridgeIpcDeps {
  isTrustedSender(event: unknown): boolean;
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  config: { get(): Promise<string | null>; set(json: string): Promise<void> };
  getVersion(): string;
  setAutoLaunch(enabled: boolean): void;
  quit(): void;
  showNotification(notification: BridgeNotification): void;
  setBadge(state: BridgeBadgeState): void;
  setTrayLabels(labels: Record<string, unknown>): void;
  deepLinksReady(): void;
}

function text(value: unknown, maxLength: number, allowEmpty = true): value is string {
  return typeof value === "string" && value.length <= maxLength && (allowEmpty || value.length > 0);
}

function requireText(value: unknown, maxLength: number, allowEmpty = true): string {
  if (!text(value, maxLength, allowEmpty)) throw new Error("invalid bridge argument");
  return value;
}

function parseNotification(value: unknown): BridgeNotification | null {
  if (value === null || typeof value !== "object") return null;
  const { title, body, tag, payload } = value as Record<string, unknown>;
  if (
    !text(title, MAX_TITLE_LENGTH) ||
    !text(body, MAX_BODY_LENGTH) ||
    !text(tag, MAX_TAG_LENGTH) ||
    !text(payload, MAX_PAYLOAD_LENGTH)
  ) {
    return null;
  }
  return { title, body, tag, payload };
}

function parseBadgeState(value: unknown): BridgeBadgeState | null {
  if (value === null || typeof value !== "object") return null;
  const { unreadCount, callState, callLabel, tooltip } = value as Record<string, unknown>;
  if (typeof unreadCount !== "number" || !Number.isInteger(unreadCount) || unreadCount < 0) {
    return null;
  }
  if (!CALL_STATES.includes(callState)) return null;
  if (callLabel !== undefined && !text(callLabel, MAX_CALL_LABEL_LENGTH)) return null;
  if (tooltip !== undefined && !text(tooltip, MAX_TOOLTIP_LENGTH)) return null;
  return {
    unreadCount,
    callState: callState as BridgeBadgeState["callState"],
    ...(callLabel === undefined ? {} : { callLabel }),
    ...(tooltip === undefined ? {} : { tooltip }),
  };
}

export function registerBridgeIpc(ipc: IpcRegistrar, deps: BridgeIpcDeps): void {
  const handle = (channel: string, handler: (...args: unknown[]) => unknown) => {
    ipc.handle(channel, (event, ...args) => {
      if (!deps.isTrustedSender(event)) throw new Error("untrusted bridge sender");
      return handler(...args);
    });
  };
  const listen = (channel: string, listener: (...args: unknown[]) => void) => {
    ipc.on(channel, (event, ...args) => {
      if (deps.isTrustedSender(event)) listener(...args);
    });
  };

  handle(BRIDGE_CHANNELS.secretsGet, (key) =>
    deps.secrets.get(requireText(key, MAX_KEY_LENGTH, false)),
  );
  handle(BRIDGE_CHANNELS.secretsSet, (key, value) =>
    deps.secrets.set(
      requireText(key, MAX_KEY_LENGTH, false),
      requireText(value, MAX_SECRET_LENGTH),
    ),
  );
  handle(BRIDGE_CHANNELS.secretsDelete, (key) =>
    deps.secrets.delete(requireText(key, MAX_KEY_LENGTH, false)),
  );
  handle(BRIDGE_CHANNELS.configGet, () => deps.config.get());
  handle(BRIDGE_CHANNELS.configSet, (json) =>
    deps.config.set(requireText(json, MAX_CONFIG_LENGTH)),
  );
  handle(BRIDGE_CHANNELS.appGetVersion, () => deps.getVersion());
  handle(BRIDGE_CHANNELS.appSetAutoLaunch, (enabled) => {
    if (typeof enabled !== "boolean") throw new Error("invalid bridge argument");
    deps.setAutoLaunch(enabled);
  });

  listen(BRIDGE_CHANNELS.appQuit, () => deps.quit());
  listen(BRIDGE_CHANNELS.appDeepLinksReady, () => deps.deepLinksReady());
  listen(BRIDGE_CHANNELS.notificationsShow, (value) => {
    const notification = parseNotification(value);
    if (notification) deps.showNotification(notification);
  });
  listen(BRIDGE_CHANNELS.appStateSetBadge, (value) => {
    const state = parseBadgeState(value);
    if (state) deps.setBadge(state);
  });
  listen(BRIDGE_CHANNELS.appStateSetTrayLabels, (value) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      deps.setTrayLabels(value as Record<string, unknown>);
    }
  });
}
