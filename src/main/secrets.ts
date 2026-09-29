import { join } from "node:path";
import { readTextIfPresent, SerialQueue, writeTextAtomically } from "./atomicFile";

export interface SecretCrypto {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
}

export type BootMode = "app" | "keychain-error";

export function bootMode(encryptionAvailable: boolean): BootMode {
  return encryptionAvailable ? "app" : "keychain-error";
}

export class SecretStore {
  private readonly file: string;
  private readonly queue = new SerialQueue();

  constructor(
    userDataDir: string,
    private readonly crypto: SecretCrypto,
  ) {
    this.file = join(userDataDir, "secrets.json");
  }

  get(key: string): Promise<string | null> {
    return this.queue.run(async () => {
      const encoded = (await this.load()).get(key);
      if (encoded === undefined) return null;
      try {
        return this.crypto.decryptString(Buffer.from(encoded, "base64"));
      } catch {
        return null;
      }
    });
  }

  set(key: string, value: string): Promise<void> {
    return this.queue.run(async () => {
      if (!this.crypto.isEncryptionAvailable()) {
        throw new Error("OS encryption is unavailable; refusing to store a secret");
      }
      const entries = await this.load();
      entries.set(key, this.crypto.encryptString(value).toString("base64"));
      await this.save(entries);
    });
  }

  delete(key: string): Promise<void> {
    return this.queue.run(async () => {
      const entries = await this.load();
      if (entries.delete(key)) await this.save(entries);
    });
  }

  private async load(): Promise<Map<string, string>> {
    const entries = new Map<string, string>();
    const text = await readTextIfPresent(this.file);
    if (text === null) return entries;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return entries;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return entries;

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") entries.set(key, value);
    }
    return entries;
  }

  private save(entries: Map<string, string>): Promise<void> {
    const plain: Record<string, string> = Object.create(null);
    for (const [key, value] of entries) plain[key] = value;
    return writeTextAtomically(this.file, JSON.stringify(plain));
  }
}
