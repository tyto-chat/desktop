import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { bootMode, SecretStore, type SecretCrypto } from "../src/main/secrets";

const fakeCrypto: SecretCrypto = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${[...plain].reverse().join("")}`, "utf8"),
  decryptString: (cipher) => {
    const text = cipher.toString("utf8");
    if (!text.startsWith("enc:")) throw new Error("bad ciphertext");
    return [...text.slice(4)].reverse().join("");
  },
};

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tyto-secrets-"));
  file = join(dir, "secrets.json");
});

describe("SecretStore", () => {
  it("returns null for an unknown key", async () => {
    expect(await new SecretStore(dir, fakeCrypto).get("missing")).toBeNull();
  });

  it("round-trips a secret", async () => {
    const store = new SecretStore(dir, fakeCrypto);
    await store.set("a", "s3cret");
    expect(await store.get("a")).toBe("s3cret");
  });

  it("persists across instances", async () => {
    await new SecretStore(dir, fakeCrypto).set("a", "s3cret");
    expect(await new SecretStore(dir, fakeCrypto).get("a")).toBe("s3cret");
  });

  it("never writes the plaintext to disk", async () => {
    await new SecretStore(dir, fakeCrypto).set("token", "super-secret-value");
    const raw = readFileSync(file, "utf8");
    expect(raw).not.toContain("super-secret-value");
    expect(JSON.parse(raw)).toEqual({
      token: fakeCrypto.encryptString("super-secret-value").toString("base64"),
    });
  });

  it("deletes a secret and keeps the others", async () => {
    const store = new SecretStore(dir, fakeCrypto);
    await store.set("a", "1");
    await store.set("b", "2");
    await store.delete("a");
    expect(await store.get("a")).toBeNull();
    expect(await store.get("b")).toBe("2");
  });

  it("keeps every write when several land at once", async () => {
    const store = new SecretStore(dir, fakeCrypto);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.set(`k${i}`, `v${i}`)));
    const fresh = new SecretStore(dir, fakeCrypto);
    for (let i = 0; i < 20; i += 1) expect(await fresh.get(`k${i}`)).toBe(`v${i}`);
  });

  it.each(["not json", "[1,2]", '"text"', "null", ""])(
    "treats a corrupt file (%j) as empty instead of crashing",
    async (content) => {
      writeFileSync(file, content);
      const store = new SecretStore(dir, fakeCrypto);
      expect(await store.get("a")).toBeNull();
      await store.set("a", "fresh");
      expect(await store.get("a")).toBe("fresh");
    },
  );

  it("returns null for an entry that no longer decrypts", async () => {
    writeFileSync(file, JSON.stringify({ a: Buffer.from("garbage").toString("base64"), b: 5 }));
    const store = new SecretStore(dir, fakeCrypto);
    expect(await store.get("a")).toBeNull();
    expect(await store.get("b")).toBeNull();
  });

  it("is not fooled by keys that shadow object internals", async () => {
    const store = new SecretStore(dir, fakeCrypto);
    expect(await store.get("__proto__")).toBeNull();
    expect(await store.get("constructor")).toBeNull();
    await store.set("__proto__", "x");
    expect(await store.get("__proto__")).toBe("x");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("refuses to store anything when encryption is unavailable", async () => {
    const store = new SecretStore(dir, { ...fakeCrypto, isEncryptionAvailable: () => false });
    await expect(store.set("a", "plain")).rejects.toThrow(/encryption/i);
    expect(await store.get("a")).toBeNull();
  });
});

describe("bootMode", () => {
  it("starts the app when the OS can encrypt", () => {
    expect(bootMode(true)).toBe("app");
  });

  it("shows the keychain error instead of the app when it cannot", () => {
    expect(bootMode(false)).toBe("keychain-error");
  });
});
