import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTray } from "../src/main/tray";
import { ENGLISH_TRAY_LABELS } from "../src/main/trayState";

const { trays, FakeTray } = vi.hoisted(() => {
  class FakeTray {
    setImage = vi.fn();
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    on = vi.fn();
    destroy = vi.fn();
    constructor() {
      trays.push(this);
    }
  }
  const trays: FakeTray[] = [];
  return { trays, FakeTray };
});

vi.mock("electron", () => ({
  app: { setBadgeCount: vi.fn() },
  Menu: { buildFromTemplate: vi.fn((template: unknown) => template) },
  nativeImage: { createFromPath: vi.fn(() => ({})) },
  Tray: FakeTray,
}));

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

function create() {
  return createTray({
    iconDir: "/icons",
    settings: { autoLaunch: false, startMinimized: false },
    labels: ENGLISH_TRAY_LABELS,
    onAction: vi.fn(),
  });
}

describe("createTray menu re-sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    trays.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    setPlatform(originalPlatform);
  });

  it("sets the context menu again shortly after creation on Linux", () => {
    setPlatform("linux");
    create();
    const tray = trays[0]!;
    expect(tray.setContextMenu).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1500);
    expect(tray.setContextMenu).toHaveBeenCalledTimes(2);
  });

  it("does not re-sync on other platforms", () => {
    setPlatform("win32");
    create();
    vi.advanceTimersByTime(5000);
    expect(trays[0]!.setContextMenu).toHaveBeenCalledTimes(1);
  });

  it("skips the re-sync once the tray is destroyed", () => {
    setPlatform("linux");
    const controller = create();
    controller.destroy();
    vi.advanceTimersByTime(5000);
    expect(trays[0]!.setContextMenu).toHaveBeenCalledTimes(1);
  });
});
