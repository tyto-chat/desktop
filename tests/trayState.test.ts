import { describe, expect, it } from "vitest";
import {
  buildTrayMenu,
  ENGLISH_TRAY_LABELS,
  mergeTrayLabels,
  TRAY_LABEL_KEYS,
  trayIconFor,
  trayTooltipFor,
  type BadgeState,
  type TrayLabels,
  type TrayMenuItem,
} from "../src/main/trayState";

const idle: BadgeState = { unreadCount: 0, callState: "none" };
const EN = ENGLISH_TRAY_LABELS;

const POLISH: TrayLabels = {
  open: "Otwórz Tyto",
  mute: "Wycisz",
  unmute: "Wyłącz wyciszenie",
  leaveCall: "Opuść rozmowę",
  snooze: "Wstrzymaj powiadomienia",
  snooze30: "Na 30 minut",
  snooze60: "Na godzinę",
  snoozeIndefinitely: "Do odwołania",
  snoozeOff: "Włącz powiadomienia ponownie",
  presence: "Status",
  presenceOnline: "Dostępny",
  presenceAway: "Zaraz wracam",
  presenceDnd: "Nie przeszkadzać",
  presenceInvisible: "Niewidoczny",
  startOnBoot: "Uruchamiaj przy starcie systemu",
  startMinimized: "Uruchamiaj zminimalizowany",
  quit: "Zakończ",
  contextCut: "Wytnij",
  contextCopy: "Kopiuj",
  contextPaste: "Wklej",
  contextSelectAll: "Zaznacz wszystko",
  contextOpenLink: "Otwórz link w przeglądarce",
  contextCopyLink: "Kopiuj link",
  contextCopyImage: "Kopiuj obraz",
  contextCopyImageAddress: "Kopiuj adres obrazu",
  contextAddToDictionary: "Dodaj do słownika",
};

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
  it("uses the text the app translated", () => {
    expect(
      trayTooltipFor({ unreadCount: 5, callState: "none", tooltip: "5 nieprzeczytanych" }),
    ).toBe("5 nieprzeczytanych");
    expect(
      trayTooltipFor({
        unreadCount: 0,
        callState: "in-call",
        callLabel: "#voice @ Srv",
        tooltip: "W rozmowie: #voice @ Srv",
      }),
    ).toBe("W rozmowie: #voice @ Srv");
  });

  it("names the snooze instead of the app while idle and snoozed", () => {
    expect(trayTooltipFor({ ...idle, snooze: { minutes: 30, label: "Snoozed until 14:32" } })).toBe(
      "Snoozed until 14:32",
    );
    expect(
      trayTooltipFor({
        unreadCount: 2,
        callState: "none",
        tooltip: "2 unread",
        snooze: { minutes: 30, label: "Snoozed until 14:32" },
      }),
    ).toBe("2 unread");
  });

  it("names the app when idle", () => {
    expect(trayTooltipFor(idle)).toBe("Tyto");
  });

  it("falls back to English when the app sent no text", () => {
    expect(trayTooltipFor({ unreadCount: 1, callState: "none" })).toBe("1 unread");
    expect(trayTooltipFor({ unreadCount: 12, callState: "none" })).toBe("12 unread");
    expect(
      trayTooltipFor({ unreadCount: 4, callState: "in-call", callLabel: "#voice @ Srv" }),
    ).toBe("In call: #voice @ Srv");
    expect(
      trayTooltipFor({ unreadCount: 0, callState: "in-call-muted", callLabel: "#voice" }),
    ).toBe("In call (muted): #voice");
    expect(trayTooltipFor({ unreadCount: 0, callState: "in-call" })).toBe("In call");
  });

  it("ignores a blank translated text", () => {
    expect(trayTooltipFor({ unreadCount: 2, callState: "none", tooltip: "  " })).toBe("2 unread");
  });
});

describe("mergeTrayLabels", () => {
  it("takes a complete set as is", () => {
    expect(mergeTrayLabels(POLISH, EN)).toEqual(POLISH);
  });

  it("fills every missing label from the fallback", () => {
    expect(mergeTrayLabels({ quit: "Zakończ" }, EN)).toEqual({ ...EN, quit: "Zakończ" });
  });

  it.each([null, undefined, "text", 5, [], true])("keeps the fallback for %j", (received) => {
    expect(mergeTrayLabels(received, EN)).toEqual(EN);
  });

  it.each([
    ["a number", 5],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["an object", { nested: "x" }],
    ["an overlong string", "x".repeat(121)],
    ["a line break", "Quit\nnow"],
  ])("rejects %s for a single label and keeps the rest", (_name, value) => {
    const merged = mergeTrayLabels({ ...POLISH, quit: value }, EN);
    expect(merged.quit).toBe(EN.quit);
    expect(merged.open).toBe(POLISH.open);
  });

  it("drops keys it does not know", () => {
    const merged = mergeTrayLabels({ ...POLISH, extra: "x", __proto__: { polluted: "y" } }, EN);
    expect(Object.keys(merged).sort()).toEqual([...TRAY_LABEL_KEYS].sort());
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("trims surrounding whitespace", () => {
    expect(mergeTrayLabels({ quit: "  Zakończ  " }, EN).quit).toBe("Zakończ");
  });

  it("has an English label for every key", () => {
    expect(Object.keys(EN).sort()).toEqual([...TRAY_LABEL_KEYS].sort());
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
    expect(labels(buildTrayMenu(idle, settings, EN))).toEqual([
      "Open Tyto",
      "Snooze notifications",
      "Presence",
      "Start on boot",
      "Start minimized",
      "Quit",
    ]);
  });

  it("uses the labels it is given, in every position", () => {
    const menu = buildTrayMenu(
      { unreadCount: 0, callState: "in-call-muted", tooltip: "W rozmowie (wyciszono): #voice" },
      settings,
      POLISH,
    );
    const shown = labels(flatten(menu));

    expect(shown).toEqual([
      "Otwórz Tyto",
      "W rozmowie (wyciszono): #voice",
      "Wyłącz wyciszenie",
      "Opuść rozmowę",
      "Wstrzymaj powiadomienia",
      "Na 30 minut",
      "Na godzinę",
      "Do odwołania",
      "Status",
      "Dostępny",
      "Zaraz wracam",
      "Nie przeszkadzać",
      "Niewidoczny",
      "Uruchamiaj przy starcie systemu",
      "Uruchamiaj zminimalizowany",
      "Zakończ",
    ]);
    for (const english of Object.values(EN)) expect(shown).not.toContain(english);
  });

  it("offers the snooze lengths, none of them checked while idle", () => {
    const snooze = buildTrayMenu(idle, settings, EN).find(
      (i) => i.label === "Snooze notifications",
    )!;
    expect(snooze.submenu!.map((i) => i.action)).toEqual([
      { type: "command", command: { type: "snooze", minutes: 30 } },
      { type: "command", command: { type: "snooze", minutes: 60 } },
      { type: "command", command: { type: "snooze", minutes: null } },
    ]);
    expect(snooze.submenu!.map((i) => i.checked)).toEqual([false, false, false]);
    expect(labels(buildTrayMenu(idle, settings, EN))).not.toContain("Turn notifications back on");
  });

  it("shows the snooze status, a way back and the checked length while snoozed", () => {
    const snoozed: BadgeState = {
      ...idle,
      snooze: { minutes: 60, label: "Notifications snoozed until 14:32" },
    };
    const menu = buildTrayMenu(snoozed, settings, EN);

    expect(labels(menu)).toEqual([
      "Open Tyto",
      "Notifications snoozed until 14:32",
      "Turn notifications back on",
      "Snooze notifications",
      "Presence",
      "Start on boot",
      "Start minimized",
      "Quit",
    ]);
    expect(menu.find((i) => i.label === "Notifications snoozed until 14:32")!.enabled).toBe(false);
    expect(menu.find((i) => i.label === "Turn notifications back on")!.action).toEqual({
      type: "command",
      command: { type: "snooze", minutes: 0 },
    });
    const lengths = menu.find((i) => i.label === "Snooze notifications")!.submenu!;
    expect(lengths.map((i) => [i.label, i.checked])).toEqual([
      ["For 30 minutes", false],
      ["For 1 hour", true],
      ["Until I turn them back on", false],
    ]);
  });

  it("checks the open-ended length when snoozed indefinitely", () => {
    const menu = buildTrayMenu(
      { ...idle, snooze: { minutes: null, label: "Snoozed until you turn them back on" } },
      settings,
      EN,
    );
    const lengths = menu.find((i) => i.label === "Snooze notifications")!.submenu!;
    expect(lengths.map((i) => i.checked)).toEqual([false, false, true]);
  });

  it("offers the four presence states", () => {
    const presence = buildTrayMenu(idle, settings, EN).find((i) => i.label === "Presence")!;
    expect(presence.submenu!.map((i) => i.action)).toEqual(
      ["online", "away", "dnd", "invisible"].map((value) => ({
        type: "command",
        command: { type: "presence", value },
      })),
    );
  });

  it("has no call controls outside a call", () => {
    const actions = flatten(buildTrayMenu(idle, settings, EN)).map((i) => i.action);
    expect(actions).not.toContainEqual({ type: "command", command: { type: "toggle-mute" } });
    expect(actions).not.toContainEqual({ type: "command", command: { type: "leave-call" } });
  });

  it("adds call controls with the call headline while in a call", () => {
    const menu = buildTrayMenu(
      { unreadCount: 0, callState: "in-call", callLabel: "#voice @ Srv" },
      settings,
      EN,
    );
    expect(labels(menu)).toEqual([
      "Open Tyto",
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
  });

  it("offers unmute while muted", () => {
    const menu = buildTrayMenu({ unreadCount: 0, callState: "in-call-muted" }, settings, EN);
    expect(labels(menu)).toContain("Unmute");
    expect(labels(menu)).not.toContain("Mute");
  });

  it("reflects the two startup settings as checkboxes", () => {
    const menu = buildTrayMenu(idle, { autoLaunch: true, startMinimized: false }, EN);
    expect(menu.find((i) => i.label === "Start on boot")).toMatchObject({
      kind: "checkbox",
      checked: true,
      action: { type: "toggle-auto-launch" },
    });
    expect(menu.find((i) => i.label === "Start minimized")).toMatchObject({
      kind: "checkbox",
      checked: false,
      action: { type: "toggle-start-minimized" },
    });
  });

  it("opens and quits through shell actions, not renderer commands", () => {
    const menu = buildTrayMenu(idle, settings, EN);
    expect(menu[0]!.action).toEqual({ type: "open" });
    expect(menu.at(-1)!.action).toEqual({ type: "quit" });
  });
});
