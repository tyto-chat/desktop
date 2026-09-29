import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENGLISH_TRAY_LABELS } from "../src/main/trayState";

const root = join(__dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("product naming", () => {
  it("calls the app Tyto in package metadata", () => {
    expect(JSON.parse(read("package.json")).productName).toBe("Tyto");
    expect(read("electron-builder.yml")).toMatch(/^productName: Tyto$/m);
  });

  it("keeps machine identifiers lowercase", () => {
    const builder = read("electron-builder.yml");
    expect(builder).toMatch(/^appId: chat\.tyto\.desktop$/m);
    expect(builder).toMatch(/executableName: tyto$/m);
    expect(builder).toMatch(/^\s+- tyto$/m);
    expect(JSON.parse(read("package.json")).name).toBe("tyto-desktop");
  });

  it("never shows a lowercase standalone name in a tray label", () => {
    for (const label of Object.values(ENGLISH_TRAY_LABELS)) {
      expect(label.replaceAll("tyto.chat", "")).not.toMatch(/\btyto\b/);
    }
  });
});
