import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ShellSettings } from "./trayState";

const DEFAULTS: ShellSettings = { autoLaunch: false, startMinimized: false };

export class ShellSettingsStore {
  private readonly file: string;

  constructor(private readonly userDataDir: string) {
    this.file = join(userDataDir, "shell-settings.json");
  }

  read(): ShellSettings {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      return { ...DEFAULTS };
    }
    if (parsed === null || typeof parsed !== "object") return { ...DEFAULTS };
    const { autoLaunch, startMinimized } = parsed as Record<string, unknown>;
    return {
      autoLaunch: typeof autoLaunch === "boolean" ? autoLaunch : DEFAULTS.autoLaunch,
      startMinimized:
        typeof startMinimized === "boolean" ? startMinimized : DEFAULTS.startMinimized,
    };
  }

  update(change: Partial<ShellSettings>): ShellSettings {
    const next = { ...this.read(), ...change };
    mkdirSync(this.userDataDir, { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(next), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.file);
    return next;
  }
}
