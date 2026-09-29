import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from "electron";
import { join } from "node:path";
import {
  buildTrayMenu,
  trayIconFor,
  trayTooltipFor,
  type BadgeState,
  type ShellSettings,
  type TrayAction,
  type TrayLabels,
  type TrayMenuItem,
} from "./trayState";

export interface TrayController {
  setBadge(state: BadgeState): void;
  setSettings(settings: ShellSettings): void;
  setLabels(labels: TrayLabels): void;
  destroy(): void;
}

export interface TrayDeps {
  iconDir: string;
  settings: ShellSettings;
  labels: TrayLabels;
  onAction(action: TrayAction): void;
}

function toTemplate(
  items: TrayMenuItem[],
  onAction: (action: TrayAction) => void,
): MenuItemConstructorOptions[] {
  return items.map((item) => {
    if (item.kind === "separator") return { type: "separator" };
    const action = item.action;
    return {
      label: item.label,
      enabled: item.enabled ?? true,
      ...(item.kind === "checkbox" ? { type: "checkbox" as const, checked: item.checked } : {}),
      ...(item.submenu ? { submenu: toTemplate(item.submenu, onAction) } : {}),
      ...(action ? { click: () => onAction(action) } : {}),
    };
  });
}

export function createTray(deps: TrayDeps): TrayController {
  let badge: BadgeState = { unreadCount: 0, callState: "none" };
  let settings = deps.settings;
  let labels = deps.labels;

  const iconFor = (state: BadgeState) =>
    nativeImage.createFromPath(join(deps.iconDir, `${trayIconFor(state)}.png`));

  const tray = new Tray(iconFor(badge));
  tray.on("click", () => deps.onAction({ type: "open" }));

  const render = () => {
    tray.setImage(iconFor(badge));
    tray.setToolTip(trayTooltipFor(badge));
    tray.setContextMenu(
      Menu.buildFromTemplate(toTemplate(buildTrayMenu(badge, settings, labels), deps.onAction)),
    );
    if (process.platform === "darwin") {
      app.dock?.setBadge(badge.unreadCount > 0 ? String(badge.unreadCount) : "");
    } else {
      app.setBadgeCount(badge.unreadCount);
    }
  };

  render();

  return {
    setBadge(state) {
      badge = state;
      render();
    },
    setSettings(next) {
      settings = next;
      render();
    },
    setLabels(next) {
      labels = next;
      render();
    },
    destroy() {
      tray.destroy();
    },
  };
}
