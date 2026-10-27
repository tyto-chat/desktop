import { describe, expect, it } from "vitest";
import { keyPackageUploadPayload, revocationPayload } from "../src/main/e2eeSigning";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("e2ee signed payloads", () => {
  it("encodes the key package upload exactly like the server", () => {
    const payload = keyPackageUploadPayload({
      deviceId: "0b3e6e1c-2f43-4a59-9d6e-4c1f5a7b8c9d",
      generation: 3,
      packages: [
        { data: Uint8Array.of(1, 2), expiresAt: 1_800_000_000 },
        { data: Uint8Array.of(3), expiresAt: 1_800_000_001 },
      ],
      lastResort: { data: Uint8Array.of(4, 5, 6), expiresAt: 1_900_000_000 },
      lastResortReplaces: new Uint8Array(32).fill(7),
    });

    expect(hex(payload)).toBe(
      "a5686465766963654964782430623365366531632d326634332d346135392d396436652d346331663561376238633964687061636b61676573582045c62b810c80aef5f8d240c7603065949a973a5cfe6b71fbca2edde4637f057d687265706c61636573582007070707070707070707070707070707070707070707070707070707070707076a67656e65726174696f6e036a6c6173745265736f727458202e8e3c883412abf92f94208c9d4af87a161262a79b06d1b79b456a5ecbd34dd1",
    );
  });

  it("encodes an upload without fallback or predecessor like the server", () => {
    const payload = keyPackageUploadPayload({ deviceId: "dev1", generation: 1, packages: [] });

    expect(hex(payload)).toBe(
      "a56864657669636549646464657631687061636b616765735820e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855687265706c61636573406a67656e65726174696f6e016a6c6173745265736f72745820e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("encodes a revocation exactly like the server", () => {
    const payload = revocationPayload({
      deviceId: "0b3e6e1c-2f43-4a59-9d6e-4c1f5a7b8c9d",
      generation: 2,
      revokedAt: 1_800_000_123,
      signerDeviceId: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    });

    expect(hex(payload)).toBe(
      "a4686465766963654964782430623365366531632d326634332d346135392d396436652d346331663561376238633964697265766f6b656441741a6b49d27b6a67656e65726174696f6e026e7369676e65724465766963654964782435643163326233612d346535662d346136622d386337642d396530663161326233633464",
    );
  });

  it("rejects values the server could not have signed", () => {
    expect(() =>
      keyPackageUploadPayload({ deviceId: "d", generation: -1, packages: [] }),
    ).toThrow();
    expect(() =>
      keyPackageUploadPayload({
        deviceId: "d",
        generation: 1,
        packages: [],
        lastResortReplaces: new Uint8Array(31),
      }),
    ).toThrow();
    expect(() =>
      revocationPayload({ deviceId: "d", generation: 1, revokedAt: 1.5, signerDeviceId: "s" }),
    ).toThrow();
  });
});
