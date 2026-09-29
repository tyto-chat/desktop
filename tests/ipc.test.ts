import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRIDGE_CHANNELS,
  registerBridgeIpc,
  type BridgeIpcDeps,
  type IpcRegistrar,
} from "../src/main/ipc";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const TRUSTED = { trusted: true };
const FOREIGN = { trusted: false };

let handlers: Map<string, Handler>;
let listeners: Map<string, Handler>;
let deps: BridgeIpcDeps;

function makeDeps(): BridgeIpcDeps {
  return {
    isTrustedSender: (event) => event === TRUSTED,
    secrets: {
      get: vi.fn().mockResolvedValue("value"),
      set: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    config: { get: vi.fn().mockResolvedValue("{}"), set: vi.fn().mockResolvedValue(undefined) },
    getVersion: vi.fn().mockReturnValue("1.2.3"),
    setAutoLaunch: vi.fn(),
    quit: vi.fn(),
    showNotification: vi.fn(),
    setBadge: vi.fn(),
    setTrayLabels: vi.fn(),
    deepLinksReady: vi.fn(),
  };
}

beforeEach(() => {
  handlers = new Map();
  listeners = new Map();
  deps = makeDeps();
  const ipc: IpcRegistrar = {
    handle: (channel, handler) => void handlers.set(channel, handler as Handler),
    on: (channel, listener) => void listeners.set(channel, listener as Handler),
  };
  registerBridgeIpc(ipc, deps);
});

const invoke = (channel: string, event: unknown, ...args: unknown[]) =>
  Promise.resolve().then(() => handlers.get(channel)!(event, ...args));

describe("registerBridgeIpc", () => {
  it("registers exactly the bridge channels", () => {
    expect([...handlers.keys(), ...listeners.keys()].sort()).toEqual(
      Object.values(BRIDGE_CHANNELS).sort(),
    );
  });

  it("routes secrets and config calls", async () => {
    expect(await invoke(BRIDGE_CHANNELS.secretsGet, TRUSTED, "k")).toBe("value");
    await invoke(BRIDGE_CHANNELS.secretsSet, TRUSTED, "k", "v");
    await invoke(BRIDGE_CHANNELS.secretsDelete, TRUSTED, "k");
    expect(await invoke(BRIDGE_CHANNELS.configGet, TRUSTED)).toBe("{}");
    await invoke(BRIDGE_CHANNELS.configSet, TRUSTED, "{}");

    expect(deps.secrets.set).toHaveBeenCalledWith("k", "v");
    expect(deps.secrets.delete).toHaveBeenCalledWith("k");
    expect(deps.config.set).toHaveBeenCalledWith("{}");
  });

  it("routes app calls", async () => {
    expect(await invoke(BRIDGE_CHANNELS.appGetVersion, TRUSTED)).toBe("1.2.3");
    await invoke(BRIDGE_CHANNELS.appSetAutoLaunch, TRUSTED, true);
    listeners.get(BRIDGE_CHANNELS.appQuit)!(TRUSTED);
    listeners.get(BRIDGE_CHANNELS.appDeepLinksReady)!(TRUSTED);

    expect(deps.setAutoLaunch).toHaveBeenCalledWith(true);
    expect(deps.quit).toHaveBeenCalledTimes(1);
    expect(deps.deepLinksReady).toHaveBeenCalledTimes(1);
  });

  it("routes notifications and badge state", () => {
    const notification = { title: "Srv", body: "hi", tag: "t", payload: "{}" };
    listeners.get(BRIDGE_CHANNELS.notificationsShow)!(TRUSTED, notification);
    listeners.get(BRIDGE_CHANNELS.appStateSetBadge)!(TRUSTED, {
      unreadCount: 3,
      callState: "in-call",
      callLabel: "#general",
    });

    expect(deps.showNotification).toHaveBeenCalledWith(notification);
    expect(deps.setBadge).toHaveBeenCalledWith({
      unreadCount: 3,
      callState: "in-call",
      callLabel: "#general",
    });
  });

  it("passes tray labels through for the shell to validate", () => {
    listeners.get(BRIDGE_CHANNELS.appStateSetTrayLabels)!(TRUSTED, { quit: "Zakończ" });
    expect(deps.setTrayLabels).toHaveBeenCalledWith({ quit: "Zakończ" });
  });

  it.each([[null], ["text"], [5], [[1, 2]]])(
    "drops tray labels that are not an object: %j",
    (value) => {
      listeners.get(BRIDGE_CHANNELS.appStateSetTrayLabels)!(TRUSTED, value);
      expect(deps.setTrayLabels).not.toHaveBeenCalled();
    },
  );

  it("carries the translated tooltip with the badge state", () => {
    listeners.get(BRIDGE_CHANNELS.appStateSetBadge)!(TRUSTED, {
      unreadCount: 3,
      callState: "none",
      tooltip: "3 nieprzeczytane",
    });
    expect(deps.setBadge).toHaveBeenCalledWith({
      unreadCount: 3,
      callState: "none",
      tooltip: "3 nieprzeczytane",
    });
  });

  it.each([[5], ["x".repeat(513)], [{ a: 1 }]])(
    "drops a badge state with the tooltip %j",
    (tooltip) => {
      listeners.get(BRIDGE_CHANNELS.appStateSetBadge)!(TRUSTED, {
        unreadCount: 1,
        callState: "none",
        tooltip,
      });
      expect(deps.setBadge).not.toHaveBeenCalled();
    },
  );

  it("refuses every channel for a sender outside the app origin", async () => {
    for (const channel of handlers.keys()) {
      await expect(invoke(channel, FOREIGN, "k", "v")).rejects.toThrow(/untrusted/i);
    }
    for (const listener of listeners.values()) listener(FOREIGN, {});

    expect(deps.secrets.get).not.toHaveBeenCalled();
    expect(deps.config.get).not.toHaveBeenCalled();
    expect(deps.quit).not.toHaveBeenCalled();
    expect(deps.showNotification).not.toHaveBeenCalled();
    expect(deps.setBadge).not.toHaveBeenCalled();
    expect(deps.setTrayLabels).not.toHaveBeenCalled();
    expect(deps.deepLinksReady).not.toHaveBeenCalled();
  });

  it.each([
    [BRIDGE_CHANNELS.secretsGet, [5]],
    [BRIDGE_CHANNELS.secretsGet, [""]],
    [BRIDGE_CHANNELS.secretsGet, ["k".repeat(513)]],
    [BRIDGE_CHANNELS.secretsSet, ["k", 5]],
    [BRIDGE_CHANNELS.secretsSet, ["k"]],
    [BRIDGE_CHANNELS.secretsSet, ["k", "v".repeat(65_537)]],
    [BRIDGE_CHANNELS.secretsDelete, [null]],
    [BRIDGE_CHANNELS.configSet, [{}]],
    [BRIDGE_CHANNELS.configSet, ["x".repeat(1_048_577)]],
    [BRIDGE_CHANNELS.appSetAutoLaunch, ["yes"]],
  ])("rejects malformed arguments on %s", async (channel, args) => {
    await expect(invoke(channel, TRUSTED, ...args)).rejects.toThrow(/invalid/i);
    expect(deps.secrets.set).not.toHaveBeenCalled();
    expect(deps.config.set).not.toHaveBeenCalled();
    expect(deps.setAutoLaunch).not.toHaveBeenCalled();
  });

  it.each([
    [null],
    ["text"],
    [{ title: "a", body: "b", tag: "c" }],
    [{ title: 1, body: "b", tag: "c", payload: "d" }],
    [{ title: "a".repeat(257), body: "b", tag: "c", payload: "d" }],
  ])("drops a malformed notification %j", (notification) => {
    listeners.get(BRIDGE_CHANNELS.notificationsShow)!(TRUSTED, notification);
    expect(deps.showNotification).not.toHaveBeenCalled();
  });

  it.each([
    [null],
    [{ unreadCount: -1, callState: "none" }],
    [{ unreadCount: 1.5, callState: "none" }],
    [{ unreadCount: 1, callState: "dancing" }],
    [{ unreadCount: "1", callState: "none" }],
    [{ unreadCount: 1, callState: "none", callLabel: 5 }],
  ])("drops a malformed badge state %j", (state) => {
    listeners.get(BRIDGE_CHANNELS.appStateSetBadge)!(TRUSTED, state);
    expect(deps.setBadge).not.toHaveBeenCalled();
  });
});

describe("preload", () => {
  const source = readFileSync(join(__dirname, "..", "src", "preload", "index.ts"), "utf8");

  it("uses exactly the channels the main process registers", () => {
    const used = [...source.matchAll(/"(bridge:[a-zA-Z:]+)"/g)].map((m) => m[1]!);
    expect([...new Set(used)].sort()).toEqual(Object.values(BRIDGE_CHANNELS).sort());
  });

  it("imports nothing at runtime except electron", () => {
    const runtimeImports = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map(
      (m) => m[1],
    );
    expect(runtimeImports).toEqual(["electron"]);
    expect(source).not.toMatch(/\brequire\(/);
  });

  it("declares bridge version 2", () => {
    expect(source).toMatch(/bridgeVersion:\s*2\b/);
  });
});
