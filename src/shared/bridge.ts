export type BridgeCallState = "none" | "in-call" | "in-call-muted";

export interface BridgeNotification {
  title: string;
  body: string;
  tag: string;
  payload: string;
}

export interface BridgeBadgeState {
  unreadCount: number;
  callState: BridgeCallState;
  callLabel?: string;
  tooltip?: string;
}

export interface BridgeTrayLabels {
  open: string;
  mute: string;
  unmute: string;
  leaveCall: string;
  snooze: string;
  snooze30: string;
  snooze60: string;
  snoozeIndefinitely: string;
  snoozeOff: string;
  presence: string;
  presenceOnline: string;
  presenceAway: string;
  presenceDnd: string;
  presenceInvisible: string;
  startOnBoot: string;
  startMinimized: string;
  quit: string;
}

export type BridgePresence = "online" | "away" | "dnd" | "invisible";

export type TrayCommand =
  | { type: "snooze"; minutes: number | null }
  | { type: "presence"; value: BridgePresence }
  | { type: "toggle-mute" }
  | { type: "leave-call" };

export interface PlatformBridge {
  bridgeVersion: number;
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  config: {
    get(): Promise<string | null>;
    set(json: string): Promise<void>;
  };
  notifications: {
    show(notification: BridgeNotification): void;
  };
  appState: {
    setBadge(state: BridgeBadgeState): void;
    setTrayLabels(labels: BridgeTrayLabels): void;
  };
  app: {
    getVersion(): Promise<string>;
    setAutoLaunch(enabled: boolean): Promise<void>;
    quit(): void;
    onDeepLink(handler: (payload: string) => void): () => void;
    onTrayCommand(handler: (command: TrayCommand) => void): () => void;
  };
}
