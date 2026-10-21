import type {
  BridgeBadgeState,
  BridgeCallState,
  BridgePresence,
  BridgeTrayLabels,
  TrayCommand,
} from "../shared/bridge";

export type CallState = BridgeCallState;
export type BadgeState = BridgeBadgeState;
export type TrayLabels = BridgeTrayLabels;
export type TrayIcon = "idle" | "unread" | "call" | "call-muted";

export interface ShellSettings {
  autoLaunch: boolean;
  startMinimized: boolean;
}

export type TrayAction =
  | { type: "open" }
  | { type: "quit" }
  | { type: "toggle-auto-launch" }
  | { type: "toggle-start-minimized" }
  | { type: "command"; command: TrayCommand };

export interface TrayMenuItem {
  kind: "item" | "checkbox" | "separator" | "submenu";
  label?: string;
  enabled?: boolean;
  checked?: boolean;
  action?: TrayAction;
  submenu?: TrayMenuItem[];
}

export const TRAY_LABEL_KEYS = [
  "open",
  "mute",
  "unmute",
  "leaveCall",
  "snooze",
  "snooze30",
  "snooze60",
  "snoozeIndefinitely",
  "snoozeOff",
  "presence",
  "presenceOnline",
  "presenceAway",
  "presenceDnd",
  "presenceInvisible",
  "startOnBoot",
  "startMinimized",
  "quit",
  "contextCut",
  "contextCopy",
  "contextPaste",
  "contextSelectAll",
  "contextOpenLink",
  "contextCopyLink",
  "contextCopyImage",
  "contextCopyImageAddress",
  "contextAddToDictionary",
] as const satisfies readonly (keyof TrayLabels)[];

export const ENGLISH_TRAY_LABELS: TrayLabels = {
  open: "Open Tyto",
  mute: "Mute",
  unmute: "Unmute",
  leaveCall: "Leave call",
  snooze: "Snooze notifications",
  snooze30: "For 30 minutes",
  snooze60: "For 1 hour",
  snoozeIndefinitely: "Until I turn them back on",
  snoozeOff: "Turn notifications back on",
  presence: "Presence",
  presenceOnline: "Online",
  presenceAway: "Away",
  presenceDnd: "Do not disturb",
  presenceInvisible: "Invisible",
  startOnBoot: "Start on boot",
  startMinimized: "Start minimized",
  quit: "Quit",
  contextCut: "Cut",
  contextCopy: "Copy",
  contextPaste: "Paste",
  contextSelectAll: "Select all",
  contextOpenLink: "Open link in browser",
  contextCopyLink: "Copy link",
  contextCopyImage: "Copy image",
  contextCopyImageAddress: "Copy image address",
  contextAddToDictionary: "Add to dictionary",
};

const APP_NAME = "Tyto";
const MAX_LABEL_LENGTH = 120;

const SNOOZE_CHOICES: readonly [keyof TrayLabels, number | null][] = [
  ["snooze30", 30],
  ["snooze60", 60],
  ["snoozeIndefinitely", null],
];

const PRESENCE_LABEL_KEYS: readonly [BridgePresence, keyof TrayLabels][] = [
  ["online", "presenceOnline"],
  ["away", "presenceAway"],
  ["dnd", "presenceDnd"],
  ["invisible", "presenceInvisible"],
];

function usableLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_LABEL_LENGTH || /[\r\n]/.test(trimmed)) return null;
  return trimmed;
}

export function mergeTrayLabels(received: unknown, fallback: TrayLabels): TrayLabels {
  const source =
    received !== null && typeof received === "object" && !Array.isArray(received)
      ? (received as Record<string, unknown>)
      : {};
  const merged = { ...fallback };
  for (const key of TRAY_LABEL_KEYS) {
    const label = Object.hasOwn(source, key) ? usableLabel(source[key]) : null;
    if (label !== null) merged[key] = label;
  }
  return merged;
}

export function trayIconFor(state: BadgeState): TrayIcon {
  if (state.callState === "in-call-muted") return "call-muted";
  if (state.callState === "in-call") return "call";
  return state.unreadCount > 0 ? "unread" : "idle";
}

function englishTooltip(state: BadgeState): string {
  if (state.callState !== "none") {
    const prefix = state.callState === "in-call-muted" ? "In call (muted)" : "In call";
    return state.callLabel ? `${prefix}: ${state.callLabel}` : prefix;
  }
  return `${state.unreadCount} unread`;
}

export function trayTooltipFor(state: BadgeState): string {
  if (state.callState === "none" && state.unreadCount === 0) {
    return usableLabel(state.snooze?.label) ?? APP_NAME;
  }
  return usableLabel(state.tooltip) ?? englishTooltip(state);
}

function command(label: string, value: TrayCommand): TrayMenuItem {
  return { kind: "item", label, action: { type: "command", command: value } };
}

export function buildTrayMenu(
  state: BadgeState,
  settings: ShellSettings,
  labels: TrayLabels,
): TrayMenuItem[] {
  const separator: TrayMenuItem = { kind: "separator" };
  const menu: TrayMenuItem[] = [{ kind: "item", label: labels.open, action: { type: "open" } }];

  if (state.callState !== "none") {
    menu.push(
      separator,
      { kind: "item", label: trayTooltipFor(state), enabled: false },
      command(state.callState === "in-call-muted" ? labels.unmute : labels.mute, {
        type: "toggle-mute",
      }),
      command(labels.leaveCall, { type: "leave-call" }),
    );
  }

  const snooze = state.snooze;
  menu.push(separator);
  if (snooze) {
    menu.push(
      { kind: "item", label: snooze.label, enabled: false },
      command(labels.snoozeOff, { type: "snooze", minutes: 0 }),
    );
  }
  menu.push(
    {
      kind: "submenu",
      label: labels.snooze,
      submenu: SNOOZE_CHOICES.map(([key, minutes]) => ({
        kind: "checkbox",
        label: labels[key],
        checked: snooze !== undefined && snooze.minutes === minutes,
        action: { type: "command", command: { type: "snooze", minutes } },
      })),
    },
    {
      kind: "submenu",
      label: labels.presence,
      submenu: PRESENCE_LABEL_KEYS.map(([value, key]) =>
        command(labels[key], { type: "presence", value }),
      ),
    },
    separator,
    {
      kind: "checkbox",
      label: labels.startOnBoot,
      checked: settings.autoLaunch,
      action: { type: "toggle-auto-launch" },
    },
    {
      kind: "checkbox",
      label: labels.startMinimized,
      checked: settings.startMinimized,
      action: { type: "toggle-start-minimized" },
    },
    separator,
    { kind: "item", label: labels.quit, action: { type: "quit" } },
  );

  return menu;
}
