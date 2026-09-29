import type {
  BridgeBadgeState,
  BridgeCallState,
  BridgePresence,
  TrayCommand,
} from "../shared/bridge";

export type CallState = BridgeCallState;
export type BadgeState = BridgeBadgeState;
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

export interface TrayLabels {
  idle: string;
  unread: (count: number) => string;
  inCall: string;
  inCallMuted: string;
  open: string;
  mute: string;
  unmute: string;
  leaveCall: string;
  snooze: string;
  snoozeMinutes: (minutes: number) => string;
  snoozeIndefinitely: string;
  snoozeOff: string;
  presence: string;
  presenceValues: Record<BridgePresence, string>;
  startOnBoot: string;
  startMinimized: string;
  quit: string;
}

export const TRAY_LABELS: TrayLabels = {
  idle: "tyto",
  unread: (count) => `${count} unread`,
  inCall: "In call",
  inCallMuted: "In call (muted)",
  open: "Open tyto",
  mute: "Mute",
  unmute: "Unmute",
  leaveCall: "Leave call",
  snooze: "Snooze notifications",
  snoozeMinutes: (minutes) => (minutes === 60 ? "For 1 hour" : `For ${minutes} minutes`),
  snoozeIndefinitely: "Until I turn them back on",
  snoozeOff: "Turn notifications back on",
  presence: "Presence",
  presenceValues: {
    online: "Online",
    away: "Away",
    dnd: "Do not disturb",
    invisible: "Invisible",
  },
  startOnBoot: "Start on boot",
  startMinimized: "Start minimized",
  quit: "Quit",
};

const SNOOZE_MINUTES = [30, 60] as const;
const PRESENCE_ORDER: readonly BridgePresence[] = ["online", "away", "dnd", "invisible"];

export function trayIconFor(state: BadgeState): TrayIcon {
  if (state.callState === "in-call-muted") return "call-muted";
  if (state.callState === "in-call") return "call";
  return state.unreadCount > 0 ? "unread" : "idle";
}

function callHeadline(state: BadgeState, labels: TrayLabels): string {
  const prefix = state.callState === "in-call-muted" ? labels.inCallMuted : labels.inCall;
  return state.callLabel ? `${prefix}: ${state.callLabel}` : prefix;
}

export function trayTooltipFor(state: BadgeState, labels: TrayLabels): string {
  if (state.callState !== "none") return callHeadline(state, labels);
  return state.unreadCount > 0 ? labels.unread(state.unreadCount) : labels.idle;
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
      { kind: "item", label: callHeadline(state, labels), enabled: false },
      command(state.callState === "in-call-muted" ? labels.unmute : labels.mute, {
        type: "toggle-mute",
      }),
      command(labels.leaveCall, { type: "leave-call" }),
    );
  }

  menu.push(
    separator,
    {
      kind: "submenu",
      label: labels.snooze,
      submenu: [
        ...SNOOZE_MINUTES.map((minutes) =>
          command(labels.snoozeMinutes(minutes), { type: "snooze", minutes }),
        ),
        command(labels.snoozeIndefinitely, { type: "snooze", minutes: null }),
        command(labels.snoozeOff, { type: "snooze", minutes: 0 }),
      ],
    },
    {
      kind: "submenu",
      label: labels.presence,
      submenu: PRESENCE_ORDER.map((value) =>
        command(labels.presenceValues[value], { type: "presence", value }),
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
