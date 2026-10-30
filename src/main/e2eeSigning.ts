import { createHash } from "node:crypto";

type CborValue = string | number | Uint8Array;

export interface UploadPackage {
  data: Uint8Array;
  expiresAt: number;
}

export interface KeyPackageUpload {
  deviceId: string;
  generation: number;
  packages: UploadPackage[];
  lastResort?: UploadPackage;
  lastResortReplaces?: Uint8Array;
}

export interface DeviceCredentialFields {
  server: string;
  accountId: number;
  deviceId: string;
  generation: number;
  devicePublicKey: Uint8Array;
}

export interface Revocation {
  deviceId: string;
  generation: number;
  revokedAt: number;
  signerDeviceId: string;
}

export interface LeaveRequest {
  deviceId: string;
  generation: number;
  requestedAt: number;
  leaveRequestId: string;
}

function head(major: number, length: number): Buffer {
  if (!Number.isSafeInteger(length) || length < 0)
    throw new Error("CBOR values must be non-negative integers");
  const type = major << 5;
  if (length < 24) return Buffer.of(type | length);
  if (length < 0x100) return Buffer.of(type | 24, length);
  if (length < 0x10000) {
    const out = Buffer.alloc(3);
    out[0] = type | 25;
    out.writeUInt16BE(length, 1);
    return out;
  }
  if (length < 0x100000000) {
    const out = Buffer.alloc(5);
    out[0] = type | 26;
    out.writeUInt32BE(length, 1);
    return out;
  }
  const out = Buffer.alloc(9);
  out[0] = type | 27;
  out.writeBigUInt64BE(BigInt(length), 1);
  return out;
}

function encodeValue(value: CborValue): Buffer {
  if (typeof value === "number") return head(0, value);
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  return Buffer.concat([head(2, value.length), Buffer.from(value)]);
}

export function encodeCanonicalMap(map: Record<string, CborValue>): Uint8Array {
  const entries = Object.entries(map).map(
    ([key, value]) => [encodeValue(key), encodeValue(value)] as const,
  );
  entries.sort(([a], [b]) => Buffer.compare(a, b));
  return new Uint8Array(Buffer.concat([head(5, entries.length), ...entries.flat()]));
}

function digest(packages: UploadPackage[]): Uint8Array {
  const entries = packages.map(({ data, expiresAt }) => {
    const expiry = Buffer.alloc(8);
    if (!Number.isSafeInteger(expiresAt) || expiresAt < 0)
      throw new Error("expiresAt must be a unix timestamp");
    expiry.writeBigUInt64BE(BigInt(expiresAt));
    return Buffer.concat([createHash("sha256").update(data).digest(), expiry]);
  });
  return new Uint8Array(createHash("sha256").update(Buffer.concat(entries)).digest());
}

export function keyPackageUploadPayload(upload: KeyPackageUpload): Uint8Array {
  if (upload.lastResortReplaces !== undefined && upload.lastResortReplaces.length !== 32) {
    throw new Error("lastResortReplaces must be a SHA-256 digest");
  }
  return encodeCanonicalMap({
    deviceId: upload.deviceId,
    generation: upload.generation,
    packages: digest(upload.packages),
    lastResort: digest(upload.lastResort === undefined ? [] : [upload.lastResort]),
    replaces: upload.lastResortReplaces ?? new Uint8Array(0),
  });
}

export function revocationPayload(revocation: Revocation): Uint8Array {
  return encodeCanonicalMap({
    deviceId: revocation.deviceId,
    generation: revocation.generation,
    revokedAt: revocation.revokedAt,
    signerDeviceId: revocation.signerDeviceId,
  });
}

export function leaveRequestPayload(request: LeaveRequest): Uint8Array {
  return encodeCanonicalMap({
    deviceId: request.deviceId,
    generation: request.generation,
    requestedAt: request.requestedAt,
    leaveRequestId: request.leaveRequestId,
  });
}

export function deviceCredentialPayload(fields: DeviceCredentialFields): Uint8Array {
  return encodeCanonicalMap({
    server: fields.server,
    accountId: fields.accountId,
    deviceId: fields.deviceId,
    generation: fields.generation,
    devicePublicKey: fields.devicePublicKey,
  });
}
