import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ShellSettings } from "./trayState";
import { parseWindowTheme, type WindowTheme } from "./windowChrome";

const DEFAULTS: ShellSettings = { autoLaunch: false, startMinimized: false };

export class ShellSettingsStore {
  private readonly file: string;

  constructor(private readonly userDataDir: string) {
    this.file = join(userDataDir, "shell-settings.json");
  }

  read(): ShellSettings {
    const { autoLaunch, startMinimized } = this.load();
    return {
      autoLaunch: typeof autoLaunch === "boolean" ? autoLaunch : DEFAULTS.autoLaunch,
      startMinimized:
        typeof startMinimized === "boolean" ? startMinimized : DEFAULTS.startMinimized,
    };
  }

  update(change: Partial<ShellSettings>): ShellSettings {
    const next = { ...this.read(), ...change };
    this.save({ ...this.load(), ...next });
    return next;
  }

  readTrayLabels(): Record<string, unknown> | null {
    const { trayLabels } = this.load();
    return trayLabels !== null && typeof trayLabels === "object" && !Array.isArray(trayLabels)
      ? (trayLabels as Record<string, unknown>)
      : null;
  }

  saveTrayLabels(trayLabels: Record<string, unknown>): void {
    this.save({ ...this.load(), trayLabels });
  }

  readWindowTheme(): WindowTheme | null {
    return parseWindowTheme(this.load().windowTheme);
  }

  saveWindowTheme(windowTheme: WindowTheme): void {
    this.save({ ...this.load(), windowTheme });
  }

  private load(): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      return {};
    }
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  }

  private save(content: Record<string, unknown>): void {
    mkdirSync(this.userDataDir, { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(content), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.file);
  }
}
