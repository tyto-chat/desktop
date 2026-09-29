import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveUserDataDir } from "../src/main/userData";

const appData = "/home/u/.config";

describe("resolveUserDataDir", () => {
  it("keeps the data folder lowercase whatever the product is called", () => {
    expect(resolveUserDataDir({ appData, isPackaged: true, override: undefined })).toBe(
      join(appData, "tyto"),
    );
  });

  it("lets a development run point somewhere else", () => {
    expect(resolveUserDataDir({ appData, isPackaged: false, override: "/tmp/smoke" })).toBe(
      "/tmp/smoke",
    );
  });

  it("ignores the override in a packaged build", () => {
    expect(resolveUserDataDir({ appData, isPackaged: true, override: "/tmp/evil" })).toBe(
      join(appData, "tyto"),
    );
  });

  it.each(["", "   ", "relative/path"])("ignores the unusable override %j", (override) => {
    expect(resolveUserDataDir({ appData, isPackaged: false, override })).toBe(
      join(appData, "tyto"),
    );
  });
});
