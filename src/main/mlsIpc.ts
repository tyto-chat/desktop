import type { IpcRegistrar } from "./ipc";
import type { MlsHost } from "./mls";
import type {
  BridgeE2eeScope,
  BridgeKeyPackageUpload,
  BridgeMlsCredential,
  BridgeRevocation,
  BridgeUploadPackage,
} from "../shared/bridge";

export const MLS_CHANNELS = {
  createDeviceKey: "bridge:mls:createDeviceKey",
  deleteDeviceKey: "bridge:mls:deleteDeviceKey",
  latestState: "bridge:mls:latestState",
  pendingStages: "bridge:mls:pendingStages",
  generateDevice: "bridge:mls:generateDevice",
  createKeyPackages: "bridge:mls:createKeyPackages",
  inspectKeyPackage: "bridge:mls:inspectKeyPackage",
  inspectGroupInfo: "bridge:mls:inspectGroupInfo",
  createGroup: "bridge:mls:createGroup",
  addMembers: "bridge:mls:addMembers",
  joinFromWelcome: "bridge:mls:joinFromWelcome",
  joinExternal: "bridge:mls:joinExternal",
  removeMember: "bridge:mls:removeMember",
  stageIncomingCommit: "bridge:mls:stageIncomingCommit",
  merge: "bridge:mls:merge",
  discard: "bridge:mls:discard",
  encrypt: "bridge:mls:encrypt",
  decrypt: "bridge:mls:decrypt",
  signKeyPackageUpload: "bridge:mls:signKeyPackageUpload",
  signRevocation: "bridge:mls:signRevocation",
} as const;

export interface MlsIpcDeps {
  isTrustedSender(event: unknown): boolean;
  host: MlsHost;
}

const HTTP_ORIGIN = /^https?:\/\/[^/\s?#]+$/;
const STAGED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_ORIGIN = 512;
const MAX_TEXT = 256;
const MAX_STATE_BYTES = 64 * 1024 * 1024;
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const MAX_KEY_PACKAGE_BYTES = 4096;
const MAX_GROUP_INFO_BYTES = 1024 * 1024;
const MAX_KEY_PACKAGES_PER_CALL = 100;
const MAX_LIFETIME_SECONDS = 366 * 86_400;
const MAX_MEMBERS_PER_CALL = 100;

function invalid(): never {
  throw new Error("invalid bridge argument");
}

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : invalid();
}

function whole(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : invalid();
}

function bytes(value: unknown, max: number, exact?: number): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length > max) invalid();
  if (exact !== undefined && value.length !== exact) invalid();
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();
}

function scope(value: unknown): BridgeE2eeScope {
  const { serverOrigin, serverUserId, profileId } = record(value);
  const origin = text(serverOrigin, MAX_ORIGIN);
  if (!HTTP_ORIGIN.test(origin)) invalid();
  return { serverOrigin: origin, serverUserId: whole(serverUserId, 1), profileId: text(profileId) };
}

function credential(value: unknown): BridgeMlsCredential {
  const c = record(value);
  return {
    server: text(c.server, MAX_ORIGIN),
    accountId: whole(c.accountId, 1),
    deviceId: text(c.deviceId),
    generation: whole(c.generation, 1),
    devicePublicKey: bytes(c.devicePublicKey, 32, 32),
    signature: bytes(c.signature, 64, 64),
  };
}

function uploadPackage(value: unknown): BridgeUploadPackage {
  const p = record(value);
  return { data: bytes(p.data, MAX_KEY_PACKAGE_BYTES), expiresAt: whole(p.expiresAt) };
}

function upload(value: unknown): BridgeKeyPackageUpload {
  const u = record(value);
  if (!Array.isArray(u.packages) || u.packages.length > MAX_KEY_PACKAGES_PER_CALL) invalid();
  return {
    deviceId: text(u.deviceId),
    generation: whole(u.generation, 1),
    packages: u.packages.map(uploadPackage),
    ...(u.lastResort === undefined ? {} : { lastResort: uploadPackage(u.lastResort) }),
    ...(u.lastResortReplaces === undefined
      ? {}
      : { lastResortReplaces: bytes(u.lastResortReplaces, 32, 32) }),
  };
}

function revocation(value: unknown): BridgeRevocation {
  const r = record(value);
  return {
    deviceId: text(r.deviceId),
    generation: whole(r.generation, 1),
    revokedAt: whole(r.revokedAt),
    signerDeviceId: text(r.signerDeviceId),
  };
}

function keyPackages(value: unknown): Uint8Array[] {
  if (!Array.isArray(value) || value.length > MAX_MEMBERS_PER_CALL) invalid();
  return value.map((p) => bytes(p, MAX_KEY_PACKAGE_BYTES));
}

function stagedId(value: unknown): string {
  return typeof value === "string" && STAGED_ID.test(value) ? value : invalid();
}

export function registerMlsIpc(ipc: IpcRegistrar, deps: MlsIpcDeps): void {
  const { host } = deps;
  const handle = (channel: string, handler: (...args: unknown[]) => unknown) => {
    ipc.handle(channel, (event, ...args) => {
      if (!deps.isTrustedSender(event)) throw new Error("untrusted bridge sender");
      return handler(...args);
    });
  };
  const state = (value: unknown) => bytes(value, MAX_STATE_BYTES);

  handle(MLS_CHANNELS.createDeviceKey, (s) => host.createDeviceKey(scope(s)));
  handle(MLS_CHANNELS.deleteDeviceKey, (s) => host.deleteDeviceKey(scope(s)));
  handle(MLS_CHANNELS.latestState, (s) => host.latestState(scope(s)));
  handle(MLS_CHANNELS.pendingStages, (s) => host.pendingStages(scope(s)));
  handle(MLS_CHANNELS.generateDevice, (s, c) => host.generateDevice(scope(s), credential(c)));
  handle(MLS_CHANNELS.createKeyPackages, (s, st, count, lifetime) =>
    host.createKeyPackages(
      scope(s),
      state(st),
      whole(count, 0, MAX_KEY_PACKAGES_PER_CALL),
      whole(lifetime, 1, MAX_LIFETIME_SECONDS),
    ),
  );
  handle(MLS_CHANNELS.inspectKeyPackage, (kp) =>
    host.inspectKeyPackage(bytes(kp, MAX_KEY_PACKAGE_BYTES)),
  );
  handle(MLS_CHANNELS.inspectGroupInfo, (gi) =>
    host.inspectGroupInfo(bytes(gi, MAX_GROUP_INFO_BYTES)),
  );
  handle(MLS_CHANNELS.createGroup, (s, st, g) => host.createGroup(scope(s), state(st), text(g)));
  handle(MLS_CHANNELS.addMembers, (s, st, g, kps) =>
    host.addMembers(scope(s), state(st), text(g), keyPackages(kps)),
  );
  handle(MLS_CHANNELS.joinFromWelcome, (s, st, w) =>
    host.joinFromWelcome(scope(s), state(st), bytes(w, MAX_MESSAGE_BYTES)),
  );
  handle(MLS_CHANNELS.joinExternal, (s, st, gi) =>
    host.joinExternal(scope(s), state(st), bytes(gi, MAX_GROUP_INFO_BYTES)),
  );
  handle(MLS_CHANNELS.removeMember, (s, st, g, leaf) =>
    host.removeMember(scope(s), state(st), text(g), whole(leaf)),
  );
  handle(MLS_CHANNELS.stageIncomingCommit, (s, st, g, c) =>
    host.stageIncomingCommit(scope(s), state(st), text(g), bytes(c, MAX_MESSAGE_BYTES)),
  );
  handle(MLS_CHANNELS.merge, (id) => host.merge(stagedId(id)));
  handle(MLS_CHANNELS.discard, (id) => host.discard(stagedId(id)));
  handle(MLS_CHANNELS.encrypt, (s, st, g, d) =>
    host.encrypt(scope(s), state(st), text(g), bytes(d, MAX_MESSAGE_BYTES)),
  );
  handle(MLS_CHANNELS.decrypt, (s, st, g, m) =>
    host.decrypt(scope(s), state(st), text(g), bytes(m, MAX_MESSAGE_BYTES)),
  );
  handle(MLS_CHANNELS.signKeyPackageUpload, (s, u) =>
    host.signKeyPackageUpload(scope(s), upload(u)),
  );
  handle(MLS_CHANNELS.signRevocation, (s, r) => host.signRevocation(scope(s), revocation(r)));
}
