import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledTrayLabels, pickTrayLanguage, readTrayLabelBundle } from "../src/main/trayLabels";
import { ENGLISH_TRAY_LABELS } from "../src/main/trayState";

describe("pickTrayLanguage", () => {
  it("prefers an exact match, then the base language, in the user's order", () => {
    expect(pickTrayLanguage(["en", "pl", "pt"], ["pl-PL", "en-US"])).toBe("pl");
    expect(pickTrayLanguage(["en", "pt-BR"], ["pt-br"])).toBe("pt-BR");
    expect(pickTrayLanguage(["en", "pl"], ["fr-FR", "en-GB"])).toBe("en");
  });

  it("returns null when nothing matches", () => {
    expect(pickTrayLanguage(["en", "pl"], ["ja-JP"])).toBeNull();
    expect(pickTrayLanguage([], ["en"])).toBeNull();
  });
});

describe("bundledTrayLabels", () => {
  const bundle = {
    en: { open: "Open Tyto", quit: "Quit" },
    pl: { open: "Otwórz Tyto", presence: "   " },
  };

  it("uses the OS language and fills gaps from English, then the built-in English", () => {
    const labels = bundledTrayLabels(bundle, ["pl-PL"]);
    expect(labels.open).toBe("Otwórz Tyto");
    expect(labels.quit).toBe("Quit");
    expect(labels.presence).toBe(ENGLISH_TRAY_LABELS.presence);
    expect(labels.mute).toBe(ENGLISH_TRAY_LABELS.mute);
  });

  it("is plain English when the OS language is not bundled or the bundle is empty", () => {
    expect(bundledTrayLabels(bundle, ["ja-JP"]).open).toBe("Open Tyto");
    expect(bundledTrayLabels({}, ["pl"])).toEqual(ENGLISH_TRAY_LABELS);
  });
});

describe("readTrayLabelBundle", () => {
  it("reads a bundle file and tolerates a missing or malformed one", () => {
    const dir = mkdtempSync(join(tmpdir(), "tyto-tray-"));
    const good = join(dir, "good.json");
    writeFileSync(good, JSON.stringify({ en: { open: "Open" } }));
    expect(readTrayLabelBundle(good)).toEqual({ en: { open: "Open" } });
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "[1,2]");
    expect(readTrayLabelBundle(bad)).toEqual({});
    expect(readTrayLabelBundle(join(dir, "missing.json"))).toEqual({});
  });
});
