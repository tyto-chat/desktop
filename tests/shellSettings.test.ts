import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ShellSettingsStore } from "../src/main/shellSettings";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tyto-shell-"));
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
});
