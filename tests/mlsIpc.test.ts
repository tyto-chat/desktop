import { beforeEach, describe, expect, it } from "vitest";
import { MLS_CHANNELS, registerMlsIpc } from "../src/main/mlsIpc";
import { MlsHost, loadMlsWasm } from "../src/main/mls";
import type { IpcRegistrar } from "../src/main/ipc";
import type { BridgeMlsStaged } from "../src/shared/bridge";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const TRUSTED = { trusted: true };
const FOREIGN = { trusted: false };
const SERVER = "https://chat.example.org";

let handlers: Map<string, Handler>;

beforeEach(() => {
  handlers = new Map();
  const values = new Map<string, string>();
  const states = new Map<string, Uint8Array>();
  const host = new MlsHost(
    loadMlsWasm(),
    {
      get: async (key) => values.get(key) ?? null,
      set: async (key, value) => void values.set(key, value),
      delete: async (key) => void values.delete(key),
    },
    {
      read: async (name) => states.get(name) ?? null,
      write: async (name, sealed) => void states.set(name, sealed),
      delete: async (name) => void states.delete(name),
      list: async () => [...states.keys()],
    },
  );
  const ipc: IpcRegistrar = {
    handle: (channel, handler) => void handlers.set(channel, handler as Handler),
    on: () => undefined,
  };
  registerMlsIpc(ipc, { isTrustedSender: (event) => event === TRUSTED, host });
});

const call = (channel: string, ...args: unknown[]) =>
  Promise.resolve().then(() => handlers.get(channel)!(TRUSTED, ...args));

const scope = (userId: number) => ({
  serverOrigin: SERVER,
  serverUserId: userId,
  profileId: `profile-${userId}`,
});

async function device(userId: number, deviceId: string) {
  const { devicePublicKey } = (await call(MLS_CHANNELS.createDeviceKey, scope(userId))) as {
    devicePublicKey: Uint8Array;
  };
  const credential = {
    server: SERVER,
    accountId: userId,
    deviceId,
    generation: 1,
    devicePublicKey,
    signature: new Uint8Array(64),
  };
  const { state } = (await call(MLS_CHANNELS.generateDevice, scope(userId), credential)) as {
    state: Uint8Array;
  };
  return { state, deviceId };
}

describe("registerMlsIpc", () => {
  it("registers one channel per engine method", () => {
    expect([...handlers.keys()].sort()).toEqual(Object.values(MLS_CHANNELS).sort());
  });

  it("round-trips a conversation through the handlers with the real engine", async () => {
    const alice = await device(1, "a0000000-0000-4000-8000-000000000001");
    const bob = await device(2, "b0000000-0000-4000-8000-000000000002");
    const packages = (await call(
      MLS_CHANNELS.createKeyPackages,
      scope(2),
      bob.state,
      1,
      86_400,
    )) as {
      packages: Uint8Array[];
      state: Uint8Array;
    };

    const created = (await call(
      MLS_CHANNELS.createGroup,
      scope(1),
      alice.state,
      "conv-1",
    )) as BridgeMlsStaged;
    let aliceState = ((await call(MLS_CHANNELS.merge, created.id)) as { state: Uint8Array }).state;
    const added = (await call(
      MLS_CHANNELS.addMembers,
      scope(1),
      aliceState,
      "conv-1",
      packages.packages,
    )) as BridgeMlsStaged;
    aliceState = ((await call(MLS_CHANNELS.merge, added.id)) as { state: Uint8Array }).state;
    const joined = (await call(
      MLS_CHANNELS.joinFromWelcome,
      scope(2),
      packages.state,
      added.welcomes[0],
    )) as BridgeMlsStaged;
    const bobState = ((await call(MLS_CHANNELS.merge, joined.id)) as { state: Uint8Array }).state;

    const sent = (await call(
      MLS_CHANNELS.encrypt,
      scope(1),
      aliceState,
      "conv-1",
      Uint8Array.of(104, 105),
    )) as {
      message: Uint8Array;
    };
    const received = (await call(
      MLS_CHANNELS.decrypt,
      scope(2),
      bobState,
      "conv-1",
      sent.message,
    )) as {
      data: Uint8Array;
      receipt: string;
    };

    expect(Array.from(received.data)).toEqual([104, 105]);
    await expect(
      call(MLS_CHANNELS.acknowledgeDecrypt, scope(2), received.receipt),
    ).resolves.toBeUndefined();
  });

  it("rejects untrusted senders", async () => {
    await expect(
      Promise.resolve().then(() => handlers.get(MLS_CHANNELS.createDeviceKey)!(FOREIGN, scope(1))),
    ).rejects.toThrow("untrusted bridge sender");
  });

  it("rejects malformed arguments before they reach the engine", async () => {
    await expect(
      call(MLS_CHANNELS.createDeviceKey, { ...scope(1), serverOrigin: "file:///etc" }),
    ).rejects.toThrow("invalid bridge argument");
    await expect(
      call(MLS_CHANNELS.createDeviceKey, { ...scope(1), serverUserId: 1.5 }),
    ).rejects.toThrow("invalid bridge argument");
    await expect(
      call(MLS_CHANNELS.encrypt, scope(1), "not bytes", "conv-1", Uint8Array.of(1)),
    ).rejects.toThrow("invalid bridge argument");
    await expect(
      call(MLS_CHANNELS.createKeyPackages, scope(1), Uint8Array.of(1), 101, 86_400),
    ).rejects.toThrow("invalid bridge argument");
    await expect(call(MLS_CHANNELS.merge, "../x")).rejects.toThrow("invalid bridge argument");
    await expect(call(MLS_CHANNELS.acknowledgeDecrypt, scope(1), "../x")).rejects.toThrow(
      "invalid bridge argument",
    );
    await expect(
      call(MLS_CHANNELS.signRevocation, scope(1), {
        deviceId: "d",
        generation: 1,
        revokedAt: "now",
        signerDeviceId: "s",
      }),
    ).rejects.toThrow("invalid bridge argument");
    await expect(
      call(MLS_CHANNELS.signLeaveRequest, scope(1), {
        deviceId: "d",
        generation: 1,
        requestedAt: 1,
        leaveRequestId: 7,
      }),
    ).rejects.toThrow("invalid bridge argument");
  });

  it("never returns the device signing key", async () => {
    const created = (await call(MLS_CHANNELS.createDeviceKey, scope(9))) as Record<string, unknown>;

    expect(Object.keys(created)).toEqual(["devicePublicKey"]);
  });
});
