import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ShellSettingsStore } from "../src/main/shellSettings";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tyto-shell-"));
});

describe("ShellSettingsStore tray labels", () => {
  it("has none before the app ever sent any", () => {
    expect(new ShellSettingsStore(dir).readTrayLabels()).toBeNull();
  });

  it("remembers the last labels across launches", () => {
    new ShellSettingsStore(dir).saveTrayLabels({ quit: "Zakończ" });
    expect(new ShellSettingsStore(dir).readTrayLabels()).toEqual({ quit: "Zakończ" });
  });

  it("keeps the startup settings when labels are saved, and the other way round", () => {
    const store = new ShellSettingsStore(dir);
    store.update({ startMinimized: true });
    store.saveTrayLabels({ quit: "Zakończ" });
    store.update({ autoLaunch: true });

    expect(store.read()).toEqual({ autoLaunch: true, startMinimized: true });
    expect(store.readTrayLabels()).toEqual({ quit: "Zakończ" });
  });

  it("returns nothing for a corrupt file", () => {
    writeFileSync(join(dir, "shell-settings.json"), "not json");
    expect(new ShellSettingsStore(dir).readTrayLabels()).toBeNull();
  });
});

describe("ShellSettingsStore", () => {
  it("defaults to everything off", () => {
    expect(new ShellSettingsStore(dir).read()).toEqual({
      autoLaunch: false,
      startMinimized: false,
    });
  });

  it("persists a change across instances", () => {
    new ShellSettingsStore(dir).update({ startMinimized: true });
    expect(new ShellSettingsStore(dir).read()).toEqual({ autoLaunch: false, startMinimized: true });
  });

  it.each(["not json", "[]", '{"autoLaunch":"yes","startMinimized":1}', "null"])(
    "falls back to defaults for %j",
    (content) => {
      writeFileSync(join(dir, "shell-settings.json"), content);
      expect(new ShellSettingsStore(dir).read()).toEqual({
        autoLaunch: false,
        startMinimized: false,
      });
    },
  );

  it("remembers the window colours without losing the other settings", () => {
    const store = new ShellSettingsStore(dir);
    store.update({ startMinimized: true });
    store.saveTrayLabels({ quit: "Zakończ" });

    store.saveWindowTheme({ color: "#f6f7f9", symbolColor: "#5a6175" });

    const reopened = new ShellSettingsStore(dir);
    expect(reopened.readWindowTheme()).toEqual({ color: "#f6f7f9", symbolColor: "#5a6175" });
    expect(reopened.read().startMinimized).toBe(true);
    expect(reopened.readTrayLabels()).toEqual({ quit: "Zakończ" });
  });

  it("ignores stored window colours that are not valid", () => {
    const store = new ShellSettingsStore(dir);
    store.saveWindowTheme({ color: "red", symbolColor: "#5a6175" });

    expect(store.readWindowTheme()).toBeNull();
  });
});
