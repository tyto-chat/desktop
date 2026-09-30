export interface WindowTheme {
  color: string;
  symbolColor: string;
}

export const TITLE_BAR_HEIGHT = 32;
export const DEFAULT_WINDOW_THEME: WindowTheme = { color: "#1e1f26", symbolColor: "#9aa0ad" };

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function parseWindowTheme(value: unknown): WindowTheme | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { color, symbolColor } = value as Record<string, unknown>;
  if (typeof color !== "string" || !HEX_COLOR.test(color)) return null;
  if (typeof symbolColor !== "string" || !HEX_COLOR.test(symbolColor)) return null;
  return { color, symbolColor };
}

export interface TitleBarOverlay {
  color?: string;
  symbolColor?: string;
  height: number;
}

export interface TitleBarOptions {
  titleBarStyle?: "hidden" | "hiddenInset";
  titleBarOverlay?: TitleBarOverlay;
}

export function titleBarOptions(platform: string, theme: WindowTheme): TitleBarOptions {
  if (platform === "win32") {
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: { ...theme, height: TITLE_BAR_HEIGHT },
    };
  }
  if (platform === "darwin") {
    return { titleBarStyle: "hiddenInset", titleBarOverlay: { height: TITLE_BAR_HEIGHT } };
  }
  return {};
}

export function overlayUpdate(platform: string, theme: WindowTheme): TitleBarOverlay | null {
  return platform === "win32" ? { ...theme, height: TITLE_BAR_HEIGHT } : null;
}
