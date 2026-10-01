import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  autostartDir,
  autostartEntry,
  launchCommand,
  setLinuxAutostart,
} from "../src/main/linuxAutostart";

let configHome: string;
const env = () => ({ XDG_CONFIG_HOME: configHome });

beforeEach(() => {
  configHome = mkdtempSync(join(tmpdir(), "tyto-autostart-"));
});

describe("linux autostart", () => {
  it("uses the XDG config home when set, else ~/.config", () => {
    expect(autostartDir({ XDG_CONFIG_HOME: "/cfg" })).toBe("/cfg/autostart");
    expect(autostartDir({})).toMatch(/\/\.config\/autostart$/);
  });

  it("launches the AppImage itself when running from one, else the executable", () => {
    expect(launchCommand({ APPIMAGE: "/home/me/Apps/Tyto.AppImage" }, "/tmp/.mount/tyto")).toBe(
      '"/home/me/Apps/Tyto.AppImage"',
    );
    expect(launchCommand({}, "/opt/Tyto/tyto")).toBe('"/opt/Tyto/tyto"');
  });

  it("escapes characters that a desktop entry would otherwise interpret", () => {
    expect(launchCommand({}, '/odd "dir"/$HOME/tyto')).toBe('"/odd \\"dir\\"/\\$HOME/tyto"');
  });

  it("writes a desktop entry that starts the app at login", () => {
    setLinuxAutostart(true, env(), "/opt/Tyto/tyto");
    const entry = readFileSync(join(configHome, "autostart", "tyto.desktop"), "utf8");
    expect(entry).toBe(autostartEntry('"/opt/Tyto/tyto"'));
    expect(entry).toContain("[Desktop Entry]\nType=Application\nName=Tyto\n");
    expect(entry).toContain('Exec="/opt/Tyto/tyto"\n');
  });

  it("removes the entry when turned off, and does not mind it being absent", () => {
    setLinuxAutostart(true, env(), "/opt/Tyto/tyto");
    setLinuxAutostart(false, env());
    expect(existsSync(join(configHome, "autostart", "tyto.desktop"))).toBe(false);
    expect(() => setLinuxAutostart(false, env())).not.toThrow();
  });
});
