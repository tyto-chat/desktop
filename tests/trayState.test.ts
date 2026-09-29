import { describe, expect, it } from "vitest";
import {
  buildTrayMenu,
  trayIconFor,
  trayTooltipFor,
  TRAY_LABELS,
  type BadgeState,
  type TrayMenuItem,
} from "../src/main/trayState";

const idle: BadgeState = { unreadCount: 0, callState: "none" };

describe("trayIconFor", () => {
  it.each<[BadgeState, string]>([
    [{ unreadCount: 0, callState: "none" }, "idle"],
    [{ unreadCount: 3, callState: "none" }, "unread"],
    [{ unreadCount: 0, callState: "in-call" }, "call"],
    [{ unreadCount: 0, callState: "in-call-muted" }, "call-muted"],
    [{ unreadCount: 9, callState: "in-call" }, "call"],
    [{ unreadCount: 9, callState: "in-call-muted" }, "call-muted"],
  ])("%j → %s", (state, icon) => {
    expect(trayIconFor(state)).toBe(icon);
  });
});

describe("trayTooltipFor", () => {
  it("names the app when idle", () => {
    expect(trayTooltipFor(idle, TRAY_LABELS)).toBe("tyto");
  });

  it("counts unread messages", () => {
    expect(trayTooltipFor({ unreadCount: 1, callState: "none" }, TRAY_LABELS)).toBe("1 unread");
    expect(trayTooltipFor({ unreadCount: 12, callState: "none" }, TRAY_LABELS)).toBe("12 unread");
  });

  it("prefers the call over unread and names where it is", () => {
    const state: BadgeState = { unreadCount: 4, callState: "in-call", callLabel: "#voice @ Srv" };
    expect(trayTooltipFor(state, TRAY_LABELS)).toBe("In call: #voice @ Srv");
  });

  it("says so when muted", () => {
    const state: BadgeState = { unreadCount: 0, callState: "in-call-muted", callLabel: "#voice" };
    expect(trayTooltipFor(state, TRAY_LABELS)).toBe("In call (muted): #voice");
  });

  it("copes with a call that has no label", () => {
    expect(trayTooltipFor({ unreadCount: 0, callState: "in-call" }, TRAY_LABELS)).toBe("In call");
  });
});

function flatten(items: TrayMenuItem[]): TrayMenuItem[] {
  return items.flatMap((item) => [item, ...flatten(item.submenu ?? [])]);
}

function labels(items: TrayMenuItem[]): string[] {
  return items.filter((i) => i.kind !== "separator").map((i) => i.label ?? "");
}

const settings = { autoLaunch: false, startMinimized: false };

describe("buildTrayMenu", () => {
  it("lists the idle menu in order", () => {
    expect(labels(buildTrayMenu(idle, settings, TRAY_LABELS))).toEqual([
      "Open tyto",
      "Snooze notifications",
      "Presence",
      "Start on boot",
      "Start minimized",
      "Quit",
    ]);
  });

  it("offers the three snooze lengths", () => {
    const snooze = buildTrayMenu(idle, settings, TRAY_LABELS).find(
      (i) => i.label === "Snooze notifications",
    )!;
    expect(snooze.submenu!.map((i) => i.action)).toEqual([
      { type: "command", command: { type: "snooze", minutes: 30 } },
      { type: "command", command: { type: "snooze", minutes: 60 } },
      { type: "command", command: { type: "snooze", minutes: null } },
      { type: "command", command: { type: "snooze", minutes: 0 } },
    ]);
    expect(snooze.submenu!.at(-1)!.label).toBe("Turn notifications back on");
  });

  it("offers the four presence states", () => {
    const presence = buildTrayMenu(idle, settings, TRAY_LABELS).find(
      (i) => i.label === "Presence",
    )!;
    expect(presence.submenu!.map((i) => i.action)).toEqual(
      ["online", "away", "dnd", "invisible"].map((value) => ({
        type: "command",
        command: { type: "presence", value },
      })),
    );
  });

  it("has no call controls outside a call", () => {
    const actions = flatten(buildTrayMenu(idle, settings, TRAY_LABELS)).map((i) => i.action);
    expect(actions).not.toContainEqual({ type: "command", command: { type: "toggle-mute" } });
    expect(actions).not.toContainEqual({ type: "command", command: { type: "leave-call" } });
  });

  it("adds call controls with the call label while in a call", () => {
    const menu = buildTrayMenu(
      { unreadCount: 0, callState: "in-call", callLabel: "#voice @ Srv" },
      settings,
      TRAY_LABELS,
    );
    expect(labels(menu)).toEqual([
      "Open tyto",
      "In call: #voice @ Srv",
      "Mute",
      "Leave call",
      "Snooze notifications",
      "Presence",
      "Start on boot",
      "Start minimized",
      "Quit",
    ]);
    expect(menu.find((i) => i.label === "In call: #voice @ Srv")!.enabled).toBe(false);
    expect(menu.find((i) => i.label === "Mute")!.action).toEqual({
      type: "command",
      command: { type: "toggle-mute" },
    });
  });

  it("offers unmute while muted", () => {
    const menu = buildTrayMenu(
      { unreadCount: 0, callState: "in-call-muted" },
      settings,
      TRAY_LABELS,
    );
    expect(labels(menu)).toContain("Unmute");
    expect(labels(menu)).not.toContain("Mute");
  });

  it("reflects the two startup settings as checkboxes", () => {
    const menu = buildTrayMenu(idle, { autoLaunch: true, startMinimized: false }, TRAY_LABELS);
    const boot = menu.find((i) => i.label === "Start on boot")!;
    const minimized = menu.find((i) => i.label === "Start minimized")!;

    expect(boot).toMatchObject({
      kind: "checkbox",
      checked: true,
      action: { type: "toggle-auto-launch" },
    });
    expect(minimized).toMatchObject({
      kind: "checkbox",
      checked: false,
      action: { type: "toggle-start-minimized" },
    });
  });

  it("opens and quits through shell actions, not renderer commands", () => {
    const menu = buildTrayMenu(idle, settings, TRAY_LABELS);
    expect(menu[0]!.action).toEqual({ type: "open" });
    expect(menu.at(-1)!.action).toEqual({ type: "quit" });
  });
});
