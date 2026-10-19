import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "..", "scripts", "extract-tray-labels.js");

function catalog(dir: string, lang: string, entries: Record<string, string>) {
  mkdirSync(join(dir, lang), { recursive: true });
  writeFileSync(join(dir, lang, "desktop.json"), JSON.stringify(entries));
}

const fullEnglish = {
  tray_open: "Open Tyto",
  tray_mute: "Mute",
  tray_unmute: "Unmute",
  tray_leave_call: "Leave call",
  tray_snooze: "Snooze notifications",
  tray_snooze_30: "For 30 minutes",
  tray_snooze_60: "For 1 hour",
  tray_snooze_indefinitely: "Until I turn them back on",
  tray_snooze_off: "Turn notifications back on",
  tray_presence: "Presence",
  tray_presence_online: "Online",
  tray_presence_away: "Away",
  tray_presence_dnd: "Do not disturb",
  tray_presence_invisible: "Invisible",
  tray_start_on_boot: "Start on boot",
  tray_start_minimized: "Start minimized",
  tray_quit: "Quit",
};

describe("extract-tray-labels.js", () => {
  it("maps the client's tray_* strings per language onto the shell's label keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "tyto-locales-"));
    catalog(dir, "en", fullEnglish);
    catalog(dir, "pl", { tray_open: "Otwórz Tyto", tray_snooze_30: "Na 30 minut", unrelated: "x" });
    mkdirSync(join(dir, "empty"));
    const out = join(dir, "out", "tray-labels.json");

    execFileSync(process.execPath, [SCRIPT, dir, out]);

    const bundle = JSON.parse(readFileSync(out, "utf8"));
    expect(Object.keys(bundle)).toEqual(["en", "pl"]);
    expect(bundle.en.snoozeIndefinitely).toBe("Until I turn them back on");
    expect(bundle.en.presenceDnd).toBe("Do not disturb");
    expect(bundle.pl).toEqual({ open: "Otwórz Tyto", snooze30: "Na 30 minut" });
  });

  it("fails the build when English lacks a tray string", () => {
    const dir = mkdtempSync(join(tmpdir(), "tyto-locales-"));
    const { tray_quit: _quit, ...incomplete } = fullEnglish;
    catalog(dir, "en", incomplete);
    expect(() =>
      execFileSync(process.execPath, [SCRIPT, dir, join(dir, "out.json")], { stdio: "pipe" }),
    ).toThrow(/tray_quit/);
  });
});
