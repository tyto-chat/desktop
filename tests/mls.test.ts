import { createPublicKey, verify } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  MlsHost,
  deviceKeySecretName,
  loadMlsWasm,
  type DeviceStateFiles,
  type E2eeScope,
} from "../src/main/mls";
import { keyPackageUploadPayload, revocationPayload } from "../src/main/e2eeSigning";
import type { BridgeMlsCredential } from "../src/shared/bridge";

const SERVER = "https://chat.example.org";
const wasm = loadMlsWasm();

class MemorySecrets {
  readonly values = new Map<string, string>();
  get = async (key: string) => this.values.get(key) ?? null;
  set = async (key: string, value: string) => void this.values.set(key, value);
  delete = async (key: string) => void this.values.delete(key);
}

interface Device {
  scope: E2eeScope;
  credential: BridgeMlsCredential;
  state: Uint8Array;
}

class MemoryFiles implements DeviceStateFiles {
  readonly values = new Map<string, Uint8Array>();
  failNextWrite = false;
  read = async (name: string) => this.values.get(name) ?? null;
  write = async (name: string, sealed: Uint8Array) => {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("disk full");
    }
    this.values.set(name, sealed);
  };
  delete = async (name: string) => void this.values.delete(name);
  list = async () => [...this.values.keys()];
}

let secrets: MemorySecrets;
let files: MemoryFiles;
let host: MlsHost;

beforeEach(() => {
  secrets = new MemorySecrets();
  files = new MemoryFiles();
  host = new MlsHost(wasm, secrets, files);
});

async function device(userId: number, deviceId: string, onHost = host): Promise<Device> {
  const scope = { serverOrigin: SERVER, serverUserId: userId, profileId: `p-${deviceId}` };
  const { devicePublicKey } = await onHost.createDeviceKey(scope);
  const credential: BridgeMlsCredential = {
    server: SERVER,
    accountId: userId,
    deviceId,
    generation: 1,
    devicePublicKey,
    signature: new Uint8Array(64).fill(userId),
  };
  const { state } = await onHost.generateDevice(scope, credential);
  return { scope, credential, state };
}

async function keyPackages(d: Device, count = 1) {
  const result = await host.createKeyPackages(d.scope, d.state, count, 86_400);
  d.state = result.state;
  return result;
}

async function conversation() {
  const alice = await device(1, "a0000000-0000-4000-8000-000000000001");
  const bob = await device(2, "b0000000-0000-4000-8000-000000000002");
  const { packages } = await keyPackages(bob);

  const created = await host.createGroup(alice.scope, alice.state, "conv-1");
  alice.state = (await host.merge(created.id)).state;
  const added = await host.addMembers(alice.scope, alice.state, "conv-1", [packages[0]!]);
  alice.state = (await host.merge(added.id)).state;
  const joined = await host.joinFromWelcome(bob.scope, bob.state, added.welcomes[0]!);
  bob.state = (await host.merge(joined.id)).state;

  return { alice, bob, added, joined };
}

async function send(from: Device, to: Device, text: string) {
  const sent = await host.encrypt(from.scope, from.state, "conv-1", new TextEncoder().encode(text));
  from.state = sent.state;
  const received = await host.decrypt(to.scope, to.state, "conv-1", sent.message);
  to.state = received.state;
  return { text: new TextDecoder().decode(received.data), sender: received.sender };
}

describe("MlsHost with the real engine", () => {
  it("lets two devices exchange messages both ways", async () => {
    const { alice, bob } = await conversation();

    const toBob = await send(alice, bob, "hello bob");
    const toAlice = await send(bob, alice, "hi alice");

    expect(toBob.text).toBe("hello bob");
    expect(toBob.sender.deviceId).toBe(alice.credential.deviceId);
    expect(toAlice.text).toBe("hi alice");
    expect(toAlice.sender.accountId).toBe(2);
  });

  it("round-trips device state through bytes into a fresh host", async () => {
    const { alice, bob } = await conversation();
    const restarted = new MlsHost(loadMlsWasm(), secrets, files);

    const sent = await restarted.encrypt(
      alice.scope,
      alice.state,
      "conv-1",
      new TextEncoder().encode("after restart"),
    );
    const received = await restarted.decrypt(bob.scope, bob.state, "conv-1", sent.message);

    expect(new TextDecoder().decode(received.data)).toBe("after restart");
  });

  it("exposes the actor, added members and resulting roster of a staged commit", async () => {
    const { alice, bob, added, joined } = await conversation();

    expect(added.actor.deviceId).toBe(alice.credential.deviceId);
    expect(added.added.map((m) => m.credential.deviceId)).toEqual([bob.credential.deviceId]);
    expect(added.removed).toEqual([]);
    expect(added.resultingRoster.map((m) => m.credential.accountId).sort()).toEqual([1, 2]);
    expect(added.newEpoch).toBe(1);
    expect(added.commit).toBeInstanceOf(Uint8Array);
    expect(added.groupInfo).toBeInstanceOf(Uint8Array);
    expect(joined.groupId).toBe("conv-1");
    expect(joined.actor.deviceId).toBe(alice.credential.deviceId);
  });

  it("stages another member's removal and reports the remover", async () => {
    const { alice, bob } = await conversation();
    const carol = await device(3, "c0000000-0000-4000-8000-000000000003");
    const { packages } = await keyPackages(carol);
    const addCarol = await host.addMembers(alice.scope, alice.state, "conv-1", [packages[0]!]);
    alice.state = (await host.merge(addCarol.id)).state;
    bob.state = (
      await host.merge(
        (await host.stageIncomingCommit(bob.scope, bob.state, "conv-1", addCarol.commit!)).id,
      )
    ).state;
    const carolLeaf = addCarol.added[0]!.leafIndex;

    const removal = await host.removeMember(alice.scope, alice.state, "conv-1", carolLeaf);
    const seen = await host.stageIncomingCommit(bob.scope, bob.state, "conv-1", removal.commit!);

    expect(removal.removed.map((m) => m.credential.deviceId)).toEqual([carol.credential.deviceId]);
    expect(seen.actor.deviceId).toBe(alice.credential.deviceId);
    expect(seen.removed.map((m) => m.leafIndex)).toEqual([carolLeaf]);
    expect(seen.resultingRoster.map((m) => m.credential.accountId).sort()).toEqual([1, 2]);
    await host.discard(seen.id);
    await host.discard(removal.id);
  });

  it("rejects a delayed message whose sender was removed and never attributes it to the new leaf owner", async () => {
    const { alice, bob } = await conversation();
    const carol = await device(3, "c0000000-0000-4000-8000-000000000003");
    const dave = await device(4, "d0000000-0000-4000-8000-000000000004");
    const carolPackage = (await keyPackages(carol)).packages[0]!;
    const davePackage = (await keyPackages(dave)).packages[0]!;

    const addCarol = await host.addMembers(alice.scope, alice.state, "conv-1", [carolPackage]);
    alice.state = (await host.merge(addCarol.id)).state;
    bob.state = (
      await host.merge(
        (await host.stageIncomingCommit(bob.scope, bob.state, "conv-1", addCarol.commit!)).id,
      )
    ).state;
    carol.state = (
      await host.merge(
        (await host.joinFromWelcome(carol.scope, carol.state, addCarol.welcomes[0]!)).id,
      )
    ).state;
    const carolLeaf = addCarol.added[0]!.leafIndex;

    const delayed = await host.encrypt(
      carol.scope,
      carol.state,
      "conv-1",
      new TextEncoder().encode("sent before removal"),
    );

    const removeCarol = await host.removeMember(alice.scope, alice.state, "conv-1", carolLeaf);
    alice.state = (await host.merge(removeCarol.id)).state;
    bob.state = (
      await host.merge(
        (await host.stageIncomingCommit(bob.scope, bob.state, "conv-1", removeCarol.commit!)).id,
      )
    ).state;
    const addDave = await host.addMembers(alice.scope, alice.state, "conv-1", [davePackage]);
    alice.state = (await host.merge(addDave.id)).state;
    bob.state = (
      await host.merge(
        (await host.stageIncomingCommit(bob.scope, bob.state, "conv-1", addDave.commit!)).id,
      )
    ).state;
    expect(addDave.added[0]!.leafIndex).toBe(carolLeaf);

    await expect(host.decrypt(bob.scope, bob.state, "conv-1", delayed.message)).rejects.toThrow(
      "No member found",
    );
  });

  it("reports the device itself as removed when it is removed", async () => {
    const { alice, bob } = await conversation();
    const removal = await host.removeMember(alice.scope, alice.state, "conv-1", 1);

    const seen = await host.stageIncomingCommit(bob.scope, bob.state, "conv-1", removal.commit!);
    bob.state = (await host.merge(seen.id)).state;

    expect(seen.removed.map((m) => m.credential.deviceId)).toEqual([bob.credential.deviceId]);
    expect(seen.resultingRoster.map((m) => m.credential.deviceId)).toEqual([
      alice.credential.deviceId,
    ]);
    await expect(host.encrypt(bob.scope, bob.state, "conv-1", Uint8Array.of(1))).rejects.toThrow();
  });

  it("leaves accepted state unchanged when a stage is discarded", async () => {
    const { alice, bob } = await conversation();
    const carol = await device(3, "c0000000-0000-4000-8000-000000000003");
    const { packages } = await keyPackages(carol);

    const staged = await host.addMembers(alice.scope, alice.state, "conv-1", [packages[0]!]);
    await host.discard(staged.id);

    await expect(host.merge(staged.id)).rejects.toThrow();
    expect((await send(alice, bob, "still epoch one")).text).toBe("still epoch one");
  });

  it("advances accepted state only on an explicit merge", async () => {
    const { alice, bob } = await conversation();
    const update = await host.addMembers(alice.scope, alice.state, "conv-1", []);
    alice.state = (await host.merge(update.id)).state;
    const sent = await host.encrypt(
      alice.scope,
      alice.state,
      "conv-1",
      new TextEncoder().encode("epoch two"),
    );

    const staged = await host.stageIncomingCommit(bob.scope, bob.state, "conv-1", update.commit!);
    expect(staged).not.toHaveProperty("state");
    await expect(host.decrypt(bob.scope, bob.state, "conv-1", sent.message)).rejects.toThrow();

    bob.state = (await host.merge(staged.id)).state;
    const received = await host.decrypt(bob.scope, bob.state, "conv-1", sent.message);
    expect(new TextDecoder().decode(received.data)).toBe("epoch two");
  });

  it("makes the identity binding of a key package inspectable", async () => {
    const bob = await device(2, "b0000000-0000-4000-8000-000000000002");
    const { packages, lastResort } = await keyPackages(bob, 2);

    const inspected = await host.inspectKeyPackage(packages[1]!);

    expect(packages).toHaveLength(2);
    expect(inspected.deviceId).toBe(bob.credential.deviceId);
    expect(inspected.server).toBe(SERVER);
    expect(Buffer.from(inspected.devicePublicKey)).toEqual(
      Buffer.from(bob.credential.devicePublicKey),
    );
    expect((await host.inspectKeyPackage(lastResort)).accountId).toBe(2);
  });

  it("makes the membership of a group info inspectable", async () => {
    const { added } = await conversation();

    const info = await host.inspectGroupInfo(added.groupInfo!);

    expect(info.groupId).toBe("conv-1");
    expect(info.epoch).toBe(1);
    expect(info.members.map((m) => m.credential.accountId).sort()).toEqual([1, 2]);
  });

  it("lets a device join by itself from published group info", async () => {
    const { alice, added } = await conversation();
    const alicePhone = await device(1, "a0000000-0000-4000-8000-00000000000f");

    const external = await host.joinExternal(alicePhone.scope, alicePhone.state, added.groupInfo!);
    alicePhone.state = (await host.merge(external.id)).state;
    const seen = await host.stageIncomingCommit(
      alice.scope,
      alice.state,
      "conv-1",
      external.commit!,
    );
    alice.state = (await host.merge(seen.id)).state;

    expect(seen.actor.deviceId).toBe(alicePhone.credential.deviceId);
    expect(seen.added.map((m) => m.credential.deviceId)).toEqual([alicePhone.credential.deviceId]);
    expect((await send(alice, alicePhone, "welcome, phone")).text).toBe("welcome, phone");
  });

  it("serves the last-resort package to more than one welcome", async () => {
    const alice = await device(1, "a0000000-0000-4000-8000-000000000001");
    const bob = await device(2, "b0000000-0000-4000-8000-000000000002");
    const { lastResort } = await keyPackages(bob, 0);

    for (const groupId of ["conv-a", "conv-b"]) {
      const created = await host.createGroup(alice.scope, alice.state, groupId);
      alice.state = (await host.merge(created.id)).state;
      const added = await host.addMembers(alice.scope, alice.state, groupId, [lastResort]);
      alice.state = (await host.merge(added.id)).state;
      const joined = await host.joinFromWelcome(bob.scope, bob.state, added.welcomes[0]!);
      bob.state = (await host.merge(joined.id)).state;
      expect(joined.groupId).toBe(groupId);
    }
  });

  it("refuses a replayed welcome for a conversation the device already has", async () => {
    const alice = await device(1, "a0000000-0000-4000-8000-000000000001");
    const bob = await device(2, "b0000000-0000-4000-8000-000000000002");
    const { lastResort } = await keyPackages(bob, 0);
    const created = await host.createGroup(alice.scope, alice.state, "conv-1");
    alice.state = (await host.merge(created.id)).state;
    const added = await host.addMembers(alice.scope, alice.state, "conv-1", [lastResort]);
    alice.state = (await host.merge(added.id)).state;
    bob.state = (
      await host.merge((await host.joinFromWelcome(bob.scope, bob.state, added.welcomes[0]!)).id)
    ).state;

    await expect(host.joinFromWelcome(bob.scope, bob.state, added.welcomes[0]!)).rejects.toThrow(
      "already",
    );
    await expect(host.joinExternal(bob.scope, bob.state, added.groupInfo!)).rejects.toThrow(
      "already",
    );
  });

  it("refuses a credential that does not carry this device's signing key", async () => {
    const scope = { serverOrigin: SERVER, serverUserId: 1, profileId: "p" };
    await host.createDeviceKey(scope);

    await expect(
      host.generateDevice(scope, {
        server: SERVER,
        accountId: 1,
        deviceId: "a0000000-0000-4000-8000-000000000001",
        generation: 1,
        devicePublicKey: new Uint8Array(32).fill(9),
        signature: new Uint8Array(64),
      }),
    ).rejects.toThrow();
  });

  it("keeps the signing key in the secret store and returns only the public half", async () => {
    const scope = { serverOrigin: SERVER, serverUserId: 7, profileId: "p" };
    const first = await host.createDeviceKey(scope);
    const again = await host.createDeviceKey(scope);
    const stored = await secrets.get(deviceKeySecretName(scope));

    expect(Object.keys(first)).toEqual(["devicePublicKey"]);
    expect(Buffer.from(again.devicePublicKey)).toEqual(Buffer.from(first.devicePublicKey));
    expect(stored).not.toBeNull();
    expect(Buffer.from(stored!, "base64").equals(Buffer.from(first.devicePublicKey))).toBe(false);

    await host.deleteDeviceKey(scope);
    expect(await secrets.get(deviceKeySecretName(scope))).toBeNull();
  });

  it("never lets returned state reveal the device signing key or other secrets", async () => {
    const { alice, bob } = await conversation();
    const secret = Buffer.from((await secrets.get(deviceKeySecretName(alice.scope)))!, "base64");
    const sent = await host.encrypt(
      alice.scope,
      alice.state,
      "conv-1",
      new TextEncoder().encode("x"),
    );
    const before = alice.state;
    alice.state = sent.state;
    const states = [before, bob.state, sent.state, (await keyPackages(alice)).state];

    for (const state of states) {
      expect(Buffer.from(state).includes(secret.subarray(0, 32))).toBe(false);
      expect(Buffer.from(state).includes(Buffer.from(alice.credential.devicePublicKey))).toBe(
        false,
      );
    }
  });

  it("refuses state that belongs to another account or was altered", async () => {
    const { alice, bob } = await conversation();
    const altered = Uint8Array.from(alice.state);
    altered[altered.length - 1]! ^= 1;

    await expect(
      host.encrypt(bob.scope, alice.state, "conv-1", Uint8Array.of(1)),
    ).rejects.toThrow();
    await expect(host.encrypt(alice.scope, altered, "conv-1", Uint8Array.of(1))).rejects.toThrow();
  });

  it("refuses to advance the same state twice so ratchet generations are never reused", async () => {
    const { alice, bob } = await conversation();
    const base = alice.state;

    const first = await host.encrypt(alice.scope, base, "conv-1", new TextEncoder().encode("one"));
    await expect(
      host.encrypt(alice.scope, base, "conv-1", new TextEncoder().encode("two")),
    ).rejects.toThrow("stale device state");

    const second = await host.encrypt(
      alice.scope,
      first.state,
      "conv-1",
      new TextEncoder().encode("two"),
    );
    bob.state = (await host.decrypt(bob.scope, bob.state, "conv-1", first.message)).state;
    const received = await host.decrypt(bob.scope, bob.state, "conv-1", second.message);
    expect(new TextDecoder().decode(received.data)).toBe("two");
  });

  it("keeps a pending commit mergeable while other conversations advance", async () => {
    const { alice, bob } = await conversation();
    const bobPackage = (await keyPackages(bob)).packages[0]!;
    const second = await host.createGroup(alice.scope, alice.state, "conv-2");
    alice.state = (await host.merge(second.id)).state;
    const addBob = await host.addMembers(alice.scope, alice.state, "conv-2", [bobPackage]);
    alice.state = (await host.merge(addBob.id)).state;
    bob.state = (
      await host.merge((await host.joinFromWelcome(bob.scope, bob.state, addBob.welcomes[0]!)).id)
    ).state;

    const pending = await host.addMembers(alice.scope, alice.state, "conv-1", []);
    const other = await host.encrypt(
      alice.scope,
      alice.state,
      "conv-2",
      new TextEncoder().encode("meanwhile"),
    );
    alice.state = other.state;
    bob.state = (await host.decrypt(bob.scope, bob.state, "conv-2", other.message)).state;

    alice.state = (await host.merge(pending.id)).state;
    bob.state = (
      await host.merge(
        (await host.stageIncomingCommit(bob.scope, bob.state, "conv-1", pending.commit!)).id,
      )
    ).state;

    expect((await send(alice, bob, "epoch two")).text).toBe("epoch two");
    const later = await host.encrypt(
      alice.scope,
      alice.state,
      "conv-2",
      new TextEncoder().encode("conv-2 still fine"),
    );
    alice.state = later.state;
    expect(
      new TextDecoder().decode(
        (await host.decrypt(bob.scope, bob.state, "conv-2", later.message)).data,
      ),
    ).toBe("conv-2 still fine");
  });

  it("allows one unsettled stage per conversation and nothing else on it until it settles", async () => {
    const { alice, bob } = await conversation();
    const mine = await host.addMembers(alice.scope, alice.state, "conv-1", []);
    const theirs = await host.addMembers(bob.scope, bob.state, "conv-1", []);
    bob.state = (await host.merge(theirs.id)).state;
    const fromBob = await host.encrypt(bob.scope, bob.state, "conv-1", Uint8Array.of(1));
    bob.state = fromBob.state;

    await expect(host.addMembers(alice.scope, alice.state, "conv-1", [])).rejects.toThrow(
      "pending",
    );
    await expect(
      host.stageIncomingCommit(alice.scope, alice.state, "conv-1", theirs.commit!),
    ).rejects.toThrow("pending");
    await expect(host.decrypt(alice.scope, alice.state, "conv-1", fromBob.message)).rejects.toThrow(
      "pending",
    );
    await expect(
      host.encrypt(alice.scope, alice.state, "conv-1", Uint8Array.of(2)),
    ).rejects.toThrow("pending");

    await host.discard(mine.id);
    alice.state = (
      await host.merge(
        (await host.stageIncomingCommit(alice.scope, alice.state, "conv-1", theirs.commit!)).id,
      )
    ).state;
    const received = await host.decrypt(alice.scope, alice.state, "conv-1", fromBob.message);
    expect(Array.from(received.data)).toEqual([1]);
  });

  it("never restores consumed message keys when a pending commit is merged", async () => {
    const { alice, bob } = await conversation();
    const sent = await host.encrypt(bob.scope, bob.state, "conv-1", Uint8Array.of(7));
    bob.state = sent.state;
    alice.state = (await host.decrypt(alice.scope, alice.state, "conv-1", sent.message)).state;

    const pending = await host.addMembers(alice.scope, alice.state, "conv-1", []);
    alice.state = (await host.merge(pending.id)).state;

    await expect(host.decrypt(alice.scope, alice.state, "conv-1", sent.message)).rejects.toThrow();
  });

  it("lists unsettled stages so they can be settled after a restart", async () => {
    const { alice } = await conversation();
    const pending = await host.addMembers(alice.scope, alice.state, "conv-1", []);

    const restarted = new MlsHost(loadMlsWasm(), secrets, files);

    expect(await restarted.pendingStages(alice.scope)).toEqual([
      { id: pending.id, groupId: "conv-1" },
    ]);
    await restarted.merge(pending.id);
    expect(await restarted.pendingStages(alice.scope)).toEqual([]);
  });

  it("never merges a stage that a concurrent discard settled", async () => {
    const { alice } = await conversation();
    const staged = await host.addMembers(alice.scope, alice.state, "conv-1", []);

    const [merged] = await Promise.allSettled([host.merge(staged.id), host.discard(staged.id)]);
    const state = merged.status === "fulfilled" ? merged.value.state : alice.state;

    expect(await host.pendingStages(alice.scope)).toEqual([]);
    await expect(
      host.encrypt(alice.scope, state, "conv-1", Uint8Array.of(1)),
    ).resolves.toHaveProperty("message");
  });

  it("keeps the base state usable after a discard", async () => {
    const { alice } = await conversation();
    const staged = await host.addMembers(alice.scope, alice.state, "conv-1", []);
    await host.discard(staged.id);

    await expect(
      host.encrypt(alice.scope, alice.state, "conv-1", Uint8Array.of(1)),
    ).resolves.toHaveProperty("message");
  });

  it("still refuses a consumed state after the shell restarts", async () => {
    const { alice } = await conversation();
    const base = alice.state;
    await host.encrypt(alice.scope, base, "conv-1", Uint8Array.of(1));

    const restarted = new MlsHost(loadMlsWasm(), secrets, files);

    await expect(restarted.encrypt(alice.scope, base, "conv-1", Uint8Array.of(2))).rejects.toThrow(
      "stale device state",
    );
  });

  it("hands back the latest accepted state after the window lost it", async () => {
    const { alice, bob } = await conversation();
    await host.encrypt(alice.scope, alice.state, "conv-1", Uint8Array.of(1));

    const recovered = await host.latestState(alice.scope);
    const sent = await host.encrypt(
      alice.scope,
      recovered!.state,
      "conv-1",
      new TextEncoder().encode("after recovery"),
    );
    const received = await host.decrypt(bob.scope, bob.state, "conv-1", sent.message);

    expect(new TextDecoder().decode(received.data)).toBe("after recovery");
    expect(await host.latestState({ ...alice.scope, profileId: "nobody" })).toBeNull();
  });

  it("refuses to initialise a device twice so accepted conversations survive", async () => {
    const { alice, bob } = await conversation();

    await expect(host.generateDevice(alice.scope, alice.credential)).rejects.toThrow("already");
    expect((await send(alice, bob, "still here")).text).toBe("still here");
  });

  it("settles a published stage after the shell restarts", async () => {
    const { alice, bob } = await conversation();
    const staged = await host.addMembers(alice.scope, alice.state, "conv-1", []);

    const restarted = new MlsHost(loadMlsWasm(), secrets, files);
    alice.state = (await restarted.merge(staged.id)).state;
    bob.state = (
      await restarted.merge(
        (await restarted.stageIncomingCommit(bob.scope, bob.state, "conv-1", staged.commit!)).id,
      )
    ).state;
    host = restarted;

    expect((await send(alice, bob, "after restart")).text).toBe("after restart");
  });

  it("keeps a stage retryable when saving its merge fails", async () => {
    const { alice, bob } = await conversation();
    const staged = await host.addMembers(alice.scope, alice.state, "conv-1", []);

    files.failNextWrite = true;
    await expect(host.merge(staged.id)).rejects.toThrow("disk full");
    alice.state = (await host.merge(staged.id)).state;
    bob.state = (
      await host.merge(
        (await host.stageIncomingCommit(bob.scope, bob.state, "conv-1", staged.commit!)).id,
      )
    ).state;

    expect((await send(alice, bob, "retried")).text).toBe("retried");
  });

  it("signs key package uploads and revocations with the device key", async () => {
    const d = await device(4, "d0000000-0000-4000-8000-000000000004");
    const upload = {
      deviceId: d.credential.deviceId,
      generation: 1,
      packages: [{ data: Uint8Array.of(1), expiresAt: 1_900_000_000 }],
    };
    const revocation = {
      deviceId: "e0000000-0000-4000-8000-000000000005",
      generation: 1,
      revokedAt: 1_800_000_000,
      signerDeviceId: d.credential.deviceId,
    };
    const publicKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(d.credential.devicePublicKey),
      ]),
      format: "der",
      type: "spki",
    });

    const uploadSignature = await host.signKeyPackageUpload(d.scope, upload);
    const revocationSignature = await host.signRevocation(d.scope, revocation);

    expect(verify(null, keyPackageUploadPayload(upload), publicKey, uploadSignature)).toBe(true);
    expect(verify(null, revocationPayload(revocation), publicKey, revocationSignature)).toBe(true);
  });
});
