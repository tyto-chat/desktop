import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { readTextIfPresent, SerialQueue, writeTextAtomically } from "./atomicFile";
import { readdir, rm } from "node:fs/promises";
import { keyPackageUploadPayload, revocationPayload } from "./e2eeSigning";
import type {
  BridgeE2eeScope,
  BridgeKeyPackageUpload,
  BridgeMlsCredential,
  BridgeMlsMember,
  BridgeMlsStaged,
  BridgeRevocation,
} from "../shared/bridge";

export type E2eeScope = BridgeE2eeScope;

interface WasmObject {
  free(): void;
}

interface WasmCredential extends WasmObject {
  server: string;
  accountId: number;
  deviceId: string;
  generation: number;
  devicePublicKey: Uint8Array;
  signature: Uint8Array;
}

interface WasmMember extends WasmObject {
  credential: WasmCredential;
  leafIndex: number;
}

interface WasmStaged extends WasmObject {
  state: Uint8Array;
  groupId: Uint8Array;
  commit: Uint8Array | undefined;
  groupInfo: Uint8Array | undefined;
  actor: WasmCredential;
  added: WasmMember[];
  removed: WasmMember[];
  resultingRoster: WasmMember[];
  newEpoch: number;
  welcomes: unknown[];
}

export interface MlsWasm {
  Credential: new (
    server: string,
    accountId: number,
    deviceId: string,
    generation: number,
    devicePublicKey: Uint8Array,
    signature: Uint8Array,
  ) => WasmCredential;
  generateSignatureKeyPair(): WasmObject & { secret: Uint8Array; public: Uint8Array };
  publicKeyOf(secret: Uint8Array): Uint8Array;
  signDetached(secret: Uint8Array, data: Uint8Array): Uint8Array;
  generateDevice(credential: WasmCredential, signer: Uint8Array): Uint8Array;
  createKeyPackages(
    state: Uint8Array,
    signer: Uint8Array,
    count: number,
    lifetimeSeconds: number,
  ): WasmObject & { state: Uint8Array; lastResort: Uint8Array; packages: unknown[] };
  inspectKeyPackage(keyPackage: Uint8Array): WasmCredential;
  inspectGroupInfo(
    groupInfo: Uint8Array,
  ): WasmObject & { groupId: Uint8Array; epoch: number; members: WasmMember[] };
  createGroup(state: Uint8Array, signer: Uint8Array, groupId: Uint8Array): WasmStaged;
  addMembers(
    state: Uint8Array,
    signer: Uint8Array,
    groupId: Uint8Array,
    keyPackages: Uint8Array[],
  ): WasmStaged;
  removeMember(
    state: Uint8Array,
    signer: Uint8Array,
    groupId: Uint8Array,
    leafIndex: number,
  ): WasmStaged;
  joinFromWelcome(state: Uint8Array, signer: Uint8Array, welcome: Uint8Array): WasmStaged;
  joinExternal(state: Uint8Array, signer: Uint8Array, groupInfo: Uint8Array): WasmStaged;
  stageIncomingCommit(
    state: Uint8Array,
    signer: Uint8Array,
    groupId: Uint8Array,
    commit: Uint8Array,
  ): WasmStaged;
  encrypt(
    state: Uint8Array,
    signer: Uint8Array,
    groupId: Uint8Array,
    data: Uint8Array,
  ): WasmObject & { state: Uint8Array; message: Uint8Array };
  decrypt(
    state: Uint8Array,
    signer: Uint8Array,
    groupId: Uint8Array,
    message: Uint8Array,
  ): WasmObject & { state: Uint8Array; data: Uint8Array; sender: WasmCredential };
  applyDelta(state: Uint8Array, delta: Uint8Array): Uint8Array;
}

export interface DeviceKeySecrets {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface DeviceStateFiles {
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, sealed: Uint8Array): Promise<void>;
  delete(name: string): Promise<void>;
  list(): Promise<string[]>;
}

const STATE_SUFFIX = ".state";

export function deviceStateDirectory(directory: string): DeviceStateFiles {
  const path = (name: string) => join(directory, `${name}${STATE_SUFFIX}`);
  return {
    read: async (name) => {
      const text = await readTextIfPresent(path(name));
      return text === null ? null : new Uint8Array(Buffer.from(text, "base64"));
    },
    write: (name, sealed) =>
      writeTextAtomically(path(name), Buffer.from(sealed).toString("base64")),
    delete: (name) => rm(path(name), { force: true }),
    list: async () => {
      try {
        const entries = await readdir(directory);
        return entries
          .filter((entry) => entry.endsWith(STATE_SUFFIX))
          .map((entry) => entry.slice(0, -STATE_SUFFIX.length));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
  };
}

export const DEVICE_KEY_SECRET_PREFIX = "e2ee-device-key:";

export function loadMlsWasm(): MlsWasm {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(join(__dirname, "..", "..", "mls-engine", "pkg", "tyto_mls_engine.js")) as MlsWasm;
}

function scopeId(scope: E2eeScope): string {
  return JSON.stringify([scope.serverOrigin, scope.serverUserId, scope.profileId]);
}

export function deviceKeySecretName(scope: E2eeScope): string {
  return `${DEVICE_KEY_SECRET_PREFIX}${scopeId(scope)}`;
}

function stateFileName(scope: E2eeScope): string {
  return createHash("sha256").update(scopeId(scope)).digest("hex");
}

function stagePrefix(scope: E2eeScope): string {
  return `${stateFileName(scope)}.stage.`;
}

function receivedPrefix(scope: E2eeScope): string {
  return `${stateFileName(scope)}.received.`;
}

function receivedName(scope: E2eeScope, receipt: string): string {
  return `${receivedPrefix(scope)}${receipt}`;
}

const RECEIPT = /^[0-9a-f]{64}$/;

function receiptOf(scope: E2eeScope, groupId: string, message: Uint8Array): string {
  return createHash("sha256")
    .update(lengthPrefixed(scopeId(scope)))
    .update(lengthPrefixed(groupId))
    .update(message)
    .digest("hex");
}

function lengthPrefixed(text: string): Buffer {
  const bytes = Buffer.from(text);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function encodeStage(scope: E2eeScope, groupId: string, sealedDelta: Uint8Array): Uint8Array {
  return new Uint8Array(
    Buffer.concat([lengthPrefixed(scopeId(scope)), lengthPrefixed(groupId), sealedDelta]),
  );
}

function decodeStage(record: Uint8Array): {
  scope: E2eeScope;
  groupId: string;
  sealedDelta: Uint8Array;
} {
  const data = Buffer.from(record);
  const scopeLength = data.readUInt16BE(0);
  const [serverOrigin, serverUserId, profileId] = JSON.parse(
    data.subarray(2, 2 + scopeLength).toString(),
  ) as [string, number, string];
  const groupStart = 2 + scopeLength;
  const groupLength = data.readUInt16BE(groupStart);
  return {
    scope: { serverOrigin, serverUserId, profileId },
    groupId: data.subarray(groupStart + 2, groupStart + 2 + groupLength).toString(),
    sealedDelta: new Uint8Array(data.subarray(groupStart + 2 + groupLength)),
  };
}

interface Received {
  data: Uint8Array;
  sender: BridgeMlsCredential;
  base: string;
  next: Uint8Array;
}

function encodeReceived(receipt: string, held: Received): Uint8Array {
  const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  return utf8.encode(
    JSON.stringify({
      receipt,
      base: held.base,
      next: base64(held.next),
      data: base64(held.data),
      sender: {
        ...held.sender,
        devicePublicKey: base64(held.sender.devicePublicKey),
        signature: base64(held.sender.signature),
      },
    }),
  );
}

function decodeReceived(receipt: string, plain: Uint8Array): Received {
  const held = JSON.parse(fromUtf8.decode(plain)) as {
    receipt: string;
    base: string;
    next: string;
    data: string;
    sender: Omit<BridgeMlsCredential, "devicePublicKey" | "signature"> & {
      devicePublicKey: string;
      signature: string;
    };
  };
  plain.fill(0);
  if (held.receipt !== receipt) throw new Error("held message is not valid");
  const bytes = (text: string) => new Uint8Array(Buffer.from(text, "base64"));
  return {
    base: held.base,
    next: bytes(held.next),
    data: bytes(held.data),
    sender: {
      ...held.sender,
      devicePublicKey: bytes(held.sender.devicePublicKey),
      signature: bytes(held.sender.signature),
    },
  };
}

function requireSettled(pending: ReadonlyMap<string, string>, groupId: string): void {
  if (pending.has(groupId)) throw new Error("this conversation has a pending stage");
}

function stateKeySecretName(scope: E2eeScope): string {
  return `${DEVICE_KEY_SECRET_PREFIX}state:${scopeId(scope)}`;
}

const SEALED_VERSION = 1;
const SEALED_DELTA_VERSION = 2;
const SEALED_RECEIVED_VERSION = 3;

const TOKEN_BYTES = 16;
const HEADER_BYTES = 1 + TOKEN_BYTES + 12 + 16;

interface StateTracker {
  loaded: boolean;
  latest?: string;
  receivesSettled?: boolean;
}

function tokenOf(sealed: Uint8Array): string {
  return Buffer.from(sealed.subarray(1, 1 + TOKEN_BYTES)).toString("hex");
}

class StateSeal {
  accepted?: Uint8Array;
  staged?: { id: string; groupId: string; record: Uint8Array };
  settled?: { id: string; groupId: string };
  held?: { name: string; record: Uint8Array };

  constructor(
    private readonly key: Buffer,
    private readonly scope: E2eeScope,
    private readonly tracker: StateTracker,
  ) {}

  seal(
    plain: Uint8Array,
    accept: boolean,
    version = SEALED_VERSION,
  ): { sealed: Uint8Array; token: string } {
    const token = randomBytes(TOKEN_BYTES);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(this.aad(token));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    plain.fill(0);
    const sealed = new Uint8Array(
      Buffer.concat([Buffer.of(version), token, iv, cipher.getAuthTag(), body]),
    );
    if (accept) this.accepted = sealed;
    return { sealed, token: token.toString("hex") };
  }

  openDelta(sealed: Uint8Array): Uint8Array {
    return this.decrypt(sealed, SEALED_DELTA_VERSION).plain;
  }

  openReceived(sealed: Uint8Array): Uint8Array {
    return this.decrypt(sealed, SEALED_RECEIVED_VERSION).plain;
  }

  open(sealed: Uint8Array): Uint8Array {
    const { plain, presented } = this.decrypt(sealed, SEALED_VERSION);
    if (this.tracker.latest === undefined) this.tracker.latest = presented;
    if (this.tracker.latest !== presented) {
      plain.fill(0);
      throw new Error("stale device state");
    }
    return plain;
  }

  private decrypt(sealed: Uint8Array, version: number): { plain: Uint8Array; presented: string } {
    const data = Buffer.from(sealed);
    if (data.length < HEADER_BYTES || data[0] !== version) {
      throw new Error("device state is not valid");
    }
    const token = data.subarray(1, 1 + TOKEN_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(17, 29));
    decipher.setAAD(this.aad(token));
    decipher.setAuthTag(data.subarray(29, HEADER_BYTES));
    let plain: Uint8Array;
    try {
      plain = new Uint8Array(
        Buffer.concat([decipher.update(data.subarray(HEADER_BYTES)), decipher.final()]),
      );
    } catch {
      throw new Error("device state is not valid");
    }
    return { plain, presented: token.toString("hex") };
  }

  private aad(token: Buffer): Buffer {
    return Buffer.concat([Buffer.from(scopeId(this.scope)), token]);
  }
}

interface DeviceKeys {
  signer: Uint8Array;
  seal: StateSeal;
  initialised: boolean;
  latest: Uint8Array | null;
  pending: ReadonlyMap<string, string>;
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder("utf-8", { fatal: true });

function take<T extends WasmObject, R>(value: T, read: (value: T) => R): R {
  try {
    return read(value);
  } finally {
    value.free();
  }
}

function credential(value: WasmCredential): BridgeMlsCredential {
  return take(value, (c) => ({
    server: c.server,
    accountId: c.accountId,
    deviceId: c.deviceId,
    generation: c.generation,
    devicePublicKey: c.devicePublicKey,
    signature: c.signature,
  }));
}

function members(values: WasmMember[]): BridgeMlsMember[] {
  return values.map((value) =>
    take(value, (m) => ({ credential: credential(m.credential), leafIndex: m.leafIndex })),
  );
}

export class MlsHost {
  private readonly queues = new Map<string, SerialQueue>();
  private readonly trackers = new Map<string, StateTracker>();
  private readonly pendingByScope = new Map<string, Map<string, string>>();

  constructor(
    private readonly wasm: MlsWasm,
    private readonly secrets: DeviceKeySecrets,
    private readonly files: DeviceStateFiles,
  ) {}

  createDeviceKey(scope: E2eeScope): Promise<{ devicePublicKey: Uint8Array }> {
    return this.serial(scope, async () => {
      const existing = await this.secrets.get(deviceKeySecretName(scope));
      if (existing !== null)
        return { devicePublicKey: this.wasm.publicKeyOf(Buffer.from(existing, "base64")) };
      const pair = this.wasm.generateSignatureKeyPair();
      const { secret, publicKey } = take(pair, (p) => ({ secret: p.secret, publicKey: p.public }));
      await this.secrets.set(stateKeySecretName(scope), randomBytes(32).toString("base64"));
      await this.secrets.set(deviceKeySecretName(scope), Buffer.from(secret).toString("base64"));
      secret.fill(0);
      return { devicePublicKey: publicKey };
    });
  }

  deleteDeviceKey(scope: E2eeScope): Promise<void> {
    return this.serial(scope, async () => {
      await this.secrets.delete(deviceKeySecretName(scope));
      await this.secrets.delete(stateKeySecretName(scope));
      await this.files.delete(stateFileName(scope));
      await this.purgeScopeFiles(scope);
      this.trackers.delete(scopeId(scope));
      this.pendingByScope.delete(scopeId(scope));
    });
  }

  pendingStages(scope: E2eeScope): Promise<{ id: string; groupId: string }[]> {
    return this.serial(scope, async () =>
      [...(await this.loadedStages(scope)).entries()].map(([groupId, id]) => ({ id, groupId })),
    );
  }

  latestState(scope: E2eeScope): Promise<{ state: Uint8Array } | null> {
    return this.serial(scope, async () => {
      const sealed = await this.files.read(stateFileName(scope));
      return sealed === null ? null : { state: sealed };
    });
  }

  generateDevice(scope: E2eeScope, input: BridgeMlsCredential): Promise<{ state: Uint8Array }> {
    return this.withKeys(scope, ({ signer, seal, initialised }) => {
      if (initialised) throw new Error("this device is already initialised");
      const wasmCredential = this.toWasmCredential(input);
      try {
        return { state: seal.seal(this.wasm.generateDevice(wasmCredential, signer), true).sealed };
      } finally {
        wasmCredential.free();
      }
    });
  }

  createKeyPackages(scope: E2eeScope, state: Uint8Array, count: number, lifetimeSeconds: number) {
    return this.withKeys(scope, ({ signer, seal }) =>
      take(this.wasm.createKeyPackages(seal.open(state), signer, count, lifetimeSeconds), (r) => ({
        packages: r.packages as Uint8Array[],
        lastResort: r.lastResort,
        state: seal.seal(r.state, true).sealed,
      })),
    );
  }

  async inspectKeyPackage(keyPackage: Uint8Array): Promise<BridgeMlsCredential> {
    return credential(this.wasm.inspectKeyPackage(keyPackage));
  }

  async inspectGroupInfo(
    groupInfo: Uint8Array,
  ): Promise<{ groupId: string; epoch: number; members: BridgeMlsMember[] }> {
    return take(this.wasm.inspectGroupInfo(groupInfo), (info) => ({
      groupId: fromUtf8.decode(info.groupId),
      epoch: info.epoch,
      members: members(info.members),
    }));
  }

  createGroup(scope: E2eeScope, state: Uint8Array, groupId: string): Promise<BridgeMlsStaged> {
    return this.stage(scope, groupId, (signer, open) =>
      this.wasm.createGroup(open(state), signer, utf8.encode(groupId)),
    );
  }

  addMembers(
    scope: E2eeScope,
    state: Uint8Array,
    groupId: string,
    keyPackages: Uint8Array[],
  ): Promise<BridgeMlsStaged> {
    return this.stage(scope, groupId, (signer, open) =>
      this.wasm.addMembers(open(state), signer, utf8.encode(groupId), keyPackages),
    );
  }

  removeMember(
    scope: E2eeScope,
    state: Uint8Array,
    groupId: string,
    leafIndex: number,
  ): Promise<BridgeMlsStaged> {
    return this.stage(scope, groupId, (signer, open) =>
      this.wasm.removeMember(open(state), signer, utf8.encode(groupId), leafIndex),
    );
  }

  joinFromWelcome(
    scope: E2eeScope,
    state: Uint8Array,
    welcome: Uint8Array,
  ): Promise<BridgeMlsStaged> {
    return this.stage(scope, null, (signer, open) =>
      this.wasm.joinFromWelcome(open(state), signer, welcome),
    );
  }

  joinExternal(
    scope: E2eeScope,
    state: Uint8Array,
    groupInfo: Uint8Array,
  ): Promise<BridgeMlsStaged> {
    return this.stage(scope, null, (signer, open) =>
      this.wasm.joinExternal(open(state), signer, groupInfo),
    );
  }

  stageIncomingCommit(
    scope: E2eeScope,
    state: Uint8Array,
    groupId: string,
    commit: Uint8Array,
  ): Promise<BridgeMlsStaged> {
    return this.stage(scope, groupId, (signer, open) =>
      this.wasm.stageIncomingCommit(open(state), signer, utf8.encode(groupId), commit),
    );
  }

  async merge(stagedId: string): Promise<{ state: Uint8Array }> {
    const name = await this.findStage(stagedId);
    const record = name === null ? null : await this.files.read(name);
    if (name === null || record === null) throw new Error("unknown or already settled stage");
    const { scope, groupId, sealedDelta } = decodeStage(record);
    try {
      return await this.withKeys(scope, ({ seal, latest, pending }) => {
        if (pending.get(groupId) !== stagedId) throw new Error("unknown or already settled stage");
        if (latest === null) throw new Error("no device state for this account");
        const next = this.wasm.applyDelta(seal.open(latest), seal.openDelta(sealedDelta));
        seal.settled = { id: stagedId, groupId };
        return { state: seal.seal(next, true).sealed };
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("stale stage")) {
        await this.settle(scope, { id: stagedId, groupId });
      }
      throw error;
    }
  }

  async discard(stagedId: string): Promise<void> {
    const name = await this.findStage(stagedId);
    const record = name === null ? null : await this.files.read(name);
    if (record === null) return;
    const { scope, groupId } = decodeStage(record);
    await this.settle(scope, { id: stagedId, groupId });
  }

  encrypt(scope: E2eeScope, state: Uint8Array, groupId: string, data: Uint8Array) {
    return this.withKeys(scope, ({ signer, seal, pending }) => {
      requireSettled(pending, groupId);
      return take(this.wasm.encrypt(seal.open(state), signer, utf8.encode(groupId), data), (r) => ({
        state: seal.seal(r.state, true).sealed,
        message: r.message,
      }));
    });
  }

  decrypt(scope: E2eeScope, state: Uint8Array, groupId: string, message: Uint8Array) {
    const receipt = receiptOf(scope, groupId, message);
    const name = receivedName(scope, receipt);
    return this.withKeys(scope, async ({ signer, seal, pending, latest }) => {
      const held = await this.files.read(name);
      if (held !== null) {
        if (latest === null) throw new Error("no device state for this account");
        const { data, sender, base, next } = decodeReceived(receipt, seal.openReceived(held));
        if (tokenOf(latest) !== base) return { state: latest, data, sender, receipt };
        seal.accepted = next;
        return { state: next, data, sender, receipt };
      }
      requireSettled(pending, groupId);
      const opened = seal.open(state);
      const base = tokenOf(state);
      return take(this.wasm.decrypt(opened, signer, utf8.encode(groupId), message), (r) => {
        const data = r.data;
        const sender = credential(r.sender);
        const next = seal.seal(r.state, true).sealed;
        const record = encodeReceived(receipt, { data, sender, base, next });
        seal.held = { name, record: seal.seal(record, false, SEALED_RECEIVED_VERSION).sealed };
        return { state: next, data, sender, receipt };
      });
    });
  }

  acknowledgeDecrypt(scope: E2eeScope, receipt: string): Promise<void> {
    if (!RECEIPT.test(receipt)) return Promise.reject(new Error("invalid receipt"));
    return this.serial(scope, () => this.files.delete(receivedName(scope, receipt)));
  }

  signKeyPackageUpload(scope: E2eeScope, upload: BridgeKeyPackageUpload): Promise<Uint8Array> {
    const payload = keyPackageUploadPayload(upload);
    return this.withKeys(scope, ({ signer }) => this.wasm.signDetached(signer, payload));
  }

  signRevocation(scope: E2eeScope, revocation: BridgeRevocation): Promise<Uint8Array> {
    const payload = revocationPayload(revocation);
    return this.withKeys(scope, ({ signer }) => this.wasm.signDetached(signer, payload));
  }

  private toWasmCredential(input: BridgeMlsCredential): WasmCredential {
    return new this.wasm.Credential(
      input.server,
      input.accountId,
      input.deviceId,
      input.generation,
      input.devicePublicKey,
      input.signature,
    );
  }

  private stage(
    scope: E2eeScope,
    knownGroup: string | null,
    run: (signer: Uint8Array, open: (state: Uint8Array) => Uint8Array) => WasmStaged,
  ): Promise<BridgeMlsStaged> {
    return this.withKeys(scope, ({ signer, seal, pending }) => {
      if (knownGroup !== null) requireSettled(pending, knownGroup);
      return take(
        run(signer, (state) => seal.open(state)),
        (s) => {
          const groupId = fromUtf8.decode(s.groupId);
          requireSettled(pending, groupId);
          const id = randomUUID();
          const { sealed } = seal.seal(s.state, false, SEALED_DELTA_VERSION);
          seal.staged = { id, groupId, record: encodeStage(scope, groupId, sealed) };
          return {
            id,
            groupId,
            commit: s.commit ?? null,
            groupInfo: s.groupInfo ?? null,
            actor: credential(s.actor),
            added: members(s.added),
            removed: members(s.removed),
            resultingRoster: members(s.resultingRoster),
            newEpoch: s.newEpoch,
            welcomes: s.welcomes as Uint8Array[],
          };
        },
      );
    });
  }

  private withKeys<T>(scope: E2eeScope, run: (keys: DeviceKeys) => T | Promise<T>): Promise<T> {
    return this.serial(scope, async () => {
      const storedSigner = await this.secrets.get(deviceKeySecretName(scope));
      const storedStateKey = await this.secrets.get(stateKeySecretName(scope));
      if (storedSigner === null || storedStateKey === null) {
        throw new Error("no device key for this account");
      }
      const tracker = await this.loadedTracker(scope);
      const pending = await this.loadedStages(scope);
      let latest = await this.files.read(stateFileName(scope));
      const initialised = latest !== null;
      const signer = new Uint8Array(Buffer.from(storedSigner, "base64"));
      const stateKey = Buffer.from(storedStateKey, "base64");
      const seal = new StateSeal(stateKey, scope, tracker);
      let result: T;
      try {
        if (tracker.receivesSettled !== true) {
          latest = await this.finishHalfSavedReceive(scope, seal, tracker, latest);
          tracker.receivesSettled = true;
        }
        result = await run({ signer, seal, initialised, latest, pending });
      } finally {
        signer.fill(0);
        stateKey.fill(0);
      }
      if (seal.staged !== undefined) {
        await this.files.write(`${stagePrefix(scope)}${seal.staged.id}`, seal.staged.record);
        pending.set(seal.staged.groupId, seal.staged.id);
      }
      if (seal.held !== undefined) {
        await this.files.write(seal.held.name, seal.held.record);
        tracker.receivesSettled = false;
      }
      if (seal.accepted !== undefined) await this.accept(scope, tracker, seal.accepted);
      if (seal.held !== undefined) tracker.receivesSettled = true;
      if (seal.settled !== undefined) await this.dropStage(scope, pending, seal.settled);
      return result;
    });
  }

  private async finishHalfSavedReceive(
    scope: E2eeScope,
    seal: StateSeal,
    tracker: StateTracker,
    latest: Uint8Array | null,
  ): Promise<Uint8Array | null> {
    if (latest === null) return null;
    const prefix = receivedPrefix(scope);
    for (const name of await this.files.list()) {
      if (!name.startsWith(prefix)) continue;
      const record = await this.files.read(name);
      if (record === null) continue;
      const held = decodeReceived(name.slice(prefix.length), seal.openReceived(record));
      if (held.base !== tokenOf(latest)) continue;
      await this.accept(scope, tracker, held.next);
      return held.next;
    }
    return latest;
  }

  private async accept(scope: E2eeScope, tracker: StateTracker, sealed: Uint8Array): Promise<void> {
    await this.files.write(stateFileName(scope), sealed);
    tracker.latest = tokenOf(sealed);
  }

  private settle(scope: E2eeScope, stage: { id: string; groupId: string }): Promise<void> {
    return this.serial(scope, async () =>
      this.dropStage(scope, await this.loadedStages(scope), stage),
    );
  }

  private async dropStage(
    scope: E2eeScope,
    pending: Map<string, string>,
    stage: { id: string; groupId: string },
  ): Promise<void> {
    await this.files.delete(`${stagePrefix(scope)}${stage.id}`);
    if (pending.get(stage.groupId) === stage.id) pending.delete(stage.groupId);
  }

  private async loadedStages(scope: E2eeScope): Promise<Map<string, string>> {
    const key = scopeId(scope);
    let pending = this.pendingByScope.get(key);
    if (pending === undefined) {
      pending = new Map();
      const prefix = stagePrefix(scope);
      for (const name of await this.files.list()) {
        if (!name.startsWith(prefix)) continue;
        const record = await this.files.read(name);
        if (record !== null) pending.set(decodeStage(record).groupId, name.slice(prefix.length));
      }
      this.pendingByScope.set(key, pending);
    }
    return pending;
  }

  private async purgeScopeFiles(scope: E2eeScope): Promise<void> {
    const prefix = `${stateFileName(scope)}.`;
    for (const name of await this.files.list()) {
      if (name.startsWith(prefix)) await this.files.delete(name);
    }
  }

  private async findStage(stagedId: string): Promise<string | null> {
    const suffix = `.stage.${stagedId}`;
    return (await this.files.list()).find((name) => name.endsWith(suffix)) ?? null;
  }

  private async loadedTracker(scope: E2eeScope): Promise<StateTracker> {
    const key = scopeId(scope);
    let tracker = this.trackers.get(key);
    if (tracker === undefined) {
      tracker = { loaded: false };
      this.trackers.set(key, tracker);
    }
    if (!tracker.loaded) {
      const persisted = await this.files.read(stateFileName(scope));
      if (persisted !== null && persisted.length > 1 + TOKEN_BYTES)
        tracker.latest = tokenOf(persisted);
      tracker.loaded = true;
    }
    return tracker;
  }

  private serial<T>(scope: E2eeScope, task: () => Promise<T>): Promise<T> {
    const key = deviceKeySecretName(scope);
    let queue = this.queues.get(key);
    if (queue === undefined) {
      queue = new SerialQueue();
      this.queues.set(key, queue);
    }
    return queue.run(task);
  }
}
