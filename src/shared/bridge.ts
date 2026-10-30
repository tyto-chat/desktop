export type BridgeCallState = "none" | "in-call" | "in-call-muted";

export interface BridgeNotification {
  title: string;
  body: string;
  tag: string;
  payload: string;
}

export interface BridgeSnoozeState {
  minutes: number | null;
  label: string;
}

export interface BridgeBadgeState {
  unreadCount: number;
  callState: BridgeCallState;
  callLabel?: string;
  tooltip?: string;
  snooze?: BridgeSnoozeState;
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
  contextCut: string;
  contextCopy: string;
  contextPaste: string;
  contextSelectAll: string;
  contextOpenLink: string;
  contextCopyLink: string;
  contextCopyImage: string;
  contextCopyImageAddress: string;
  contextAddToDictionary: string;
}

export type BridgePresence = "online" | "away" | "dnd" | "invisible";

export type TrayCommand =
  | { type: "snooze"; minutes: number | null }
  | { type: "presence"; value: BridgePresence }
  | { type: "toggle-mute" }
  | { type: "leave-call" };

export interface BridgeWindowTheme {
  color: string;
  symbolColor: string;
}

export interface BridgeMediaAuth {
  origin: string;
  token: string | null;
}

export interface BridgeSpellCheck {
  available: string[];
  enabled: string[];
}

export interface BridgeE2eeScope {
  serverOrigin: string;
  serverUserId: number;
  profileId: string;
}

export interface BridgeMlsCredential {
  server: string;
  accountId: number;
  deviceId: string;
  generation: number;
  devicePublicKey: Uint8Array;
  signature: Uint8Array;
}

export interface BridgeMlsMember {
  credential: BridgeMlsCredential;
  leafIndex: number;
}

export interface BridgeMlsStaged {
  id: string;
  groupId: string;
  commit: Uint8Array | null;
  groupInfo: Uint8Array | null;
  actor: BridgeMlsCredential;
  added: BridgeMlsMember[];
  removed: BridgeMlsMember[];
  resultingRoster: BridgeMlsMember[];
  newEpoch: number;
  welcomes: Uint8Array[];
}

export interface BridgeUploadPackage {
  data: Uint8Array;
  expiresAt: number;
}

export interface BridgeKeyPackageUpload {
  deviceId: string;
  generation: number;
  packages: BridgeUploadPackage[];
  lastResort?: BridgeUploadPackage;
  lastResortReplaces?: Uint8Array;
}

export interface BridgeLeaveRequest {
  deviceId: string;
  generation: number;
  requestedAt: number;
  leaveRequestId: string;
}

export interface BridgeRevocation {
  deviceId: string;
  generation: number;
  revokedAt: number;
  signerDeviceId: string;
}

export interface BridgeMls {
  createDeviceKey(scope: BridgeE2eeScope): Promise<{ devicePublicKey: Uint8Array }>;
  deleteDeviceKey(scope: BridgeE2eeScope): Promise<void>;
  latestState(scope: BridgeE2eeScope): Promise<{ state: Uint8Array } | null>;
  pendingStages(scope: BridgeE2eeScope): Promise<{ id: string; groupId: string }[]>;
  generateDevice(
    scope: BridgeE2eeScope,
    credential: BridgeMlsCredential,
  ): Promise<{ state: Uint8Array }>;
  createKeyPackages(
    scope: BridgeE2eeScope,
    state: Uint8Array,
    count: number,
    lifetimeSeconds: number,
  ): Promise<{ packages: Uint8Array[]; lastResort: Uint8Array; state: Uint8Array }>;
  inspectKeyPackage(keyPackage: Uint8Array): Promise<BridgeMlsCredential>;
  inspectGroupInfo(
    groupInfo: Uint8Array,
  ): Promise<{ groupId: string; epoch: number; members: BridgeMlsMember[] }>;
  createGroup(scope: BridgeE2eeScope, state: Uint8Array, groupId: string): Promise<BridgeMlsStaged>;
  addMembers(
    scope: BridgeE2eeScope,
    state: Uint8Array,
    groupId: string,
    keyPackages: Uint8Array[],
  ): Promise<BridgeMlsStaged>;
  joinFromWelcome(
    scope: BridgeE2eeScope,
    state: Uint8Array,
    welcome: Uint8Array,
  ): Promise<BridgeMlsStaged>;
  joinExternal(
    scope: BridgeE2eeScope,
    state: Uint8Array,
    groupInfo: Uint8Array,
  ): Promise<BridgeMlsStaged>;
  removeMember(
    scope: BridgeE2eeScope,
    state: Uint8Array,
    groupId: string,
    leafIndex: number,
  ): Promise<BridgeMlsStaged>;
  stageIncomingCommit(
    scope: BridgeE2eeScope,
    state: Uint8Array,
    groupId: string,
    commit: Uint8Array,
  ): Promise<BridgeMlsStaged>;
  merge(stagedId: string): Promise<{ state: Uint8Array }>;
  discard(stagedId: string): Promise<void>;
  encrypt(
    scope: BridgeE2eeScope,
    state: Uint8Array,
    groupId: string,
    data: Uint8Array,
  ): Promise<{ state: Uint8Array; message: Uint8Array }>;
  decrypt(
    scope: BridgeE2eeScope,
    state: Uint8Array,
    groupId: string,
    message: Uint8Array,
  ): Promise<{
    state: Uint8Array;
    data: Uint8Array;
    sender: BridgeMlsCredential;
    receipt: string;
  }>;
  acknowledgeDecrypt(scope: BridgeE2eeScope, receipt: string): Promise<void>;
  signKeyPackageUpload(scope: BridgeE2eeScope, upload: BridgeKeyPackageUpload): Promise<Uint8Array>;
  signRevocation(scope: BridgeE2eeScope, revocation: BridgeRevocation): Promise<Uint8Array>;
  signLeaveRequest(scope: BridgeE2eeScope, request: BridgeLeaveRequest): Promise<Uint8Array>;
}

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
    setWindowTheme(theme: BridgeWindowTheme): void;
    setMediaAuth(auth: BridgeMediaAuth): void;
  };
  spellCheck: {
    get(): Promise<BridgeSpellCheck>;
    set(languages: string[]): Promise<BridgeSpellCheck>;
  };
  mls: BridgeMls;
  app: {
    getVersion(): Promise<string>;
    setAutoLaunch(enabled: boolean): Promise<void>;
    quit(): void;
    onDeepLink(handler: (payload: string) => void): () => void;
    onTrayCommand(handler: (command: TrayCommand) => void): () => void;
  };
}
