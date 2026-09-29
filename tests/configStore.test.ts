import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ConfigStore } from "../src/main/configStore";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tyto-config-"));
});

describe("ConfigStore", () => {
  it("returns null before anything is saved", async () => {
    expect(await new ConfigStore(dir).get()).toBeNull();
  });

  it("round-trips the json text verbatim across instances", async () => {
    await new ConfigStore(dir).set('{"version":1,"profiles":[]}');
    expect(await new ConfigStore(dir).get()).toBe('{"version":1,"profiles":[]}');
  });

  it("keeps the last of several concurrent writes", async () => {
    const store = new ConfigStore(dir);
    await Promise.all([store.set("1"), store.set("2"), store.set("3")]);
    expect(await store.get()).toBe("3");
  });

  it("returns whatever is on disk without parsing it", async () => {
    writeFileSync(join(dir, "desktop-config.json"), "not json");
    expect(await new ConfigStore(dir).get()).toBe("not json");
  });
});
