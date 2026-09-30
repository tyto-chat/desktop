import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW_THEME,
  TITLE_BAR_HEIGHT,
  overlayUpdate,
  parseWindowTheme,
  titleBarOptions,
} from "../src/main/windowChrome";

const theme = { color: "#f6f7f9", symbolColor: "#5a6175" };

describe("parseWindowTheme", () => {
  it("accepts two plain hex colours", () => {
    expect(parseWindowTheme(theme)).toEqual(theme);
  });

  it("keeps only the two colours it knows", () => {
    expect(parseWindowTheme({ ...theme, height: 900, extra: "x" })).toEqual(theme);
  });

  it.each([
    [null],
    ["#f6f7f9"],
    [[theme]],
    [{ color: "#f6f7f9" }],
    [{ color: "red", symbolColor: "#5a6175" }],
    [{ color: "#fff", symbolColor: "#5a6175" }],
    [{ color: "#f6f7f9", symbolColor: "rgb(0,0,0)" }],
    [{ color: "#f6f7f9; background:url(x)", symbolColor: "#5a6175" }],
    [{ color: 5, symbolColor: "#5a6175" }],
  ])("refuses %j", (value) => {
    expect(parseWindowTheme(value)).toBeNull();
  });
});

describe("titleBarOptions", () => {
  it("hides the title bar on Windows and keeps the system buttons in our colours", () => {
    expect(titleBarOptions("win32", theme)).toEqual({
      titleBarStyle: "hidden",
      titleBarOverlay: { ...theme, height: TITLE_BAR_HEIGHT },
    });
  });

  it("hides the title bar on macOS and keeps the system buttons", () => {
    expect(titleBarOptions("darwin", theme)).toEqual({
      titleBarStyle: "hiddenInset",
      titleBarOverlay: { height: TITLE_BAR_HEIGHT },
    });
  });

  it.each(["linux", "freebsd"])("keeps the system frame on %s", (platform) => {
    expect(titleBarOptions(platform, theme)).toEqual({});
  });
});

describe("overlayUpdate", () => {
  it("recolours the buttons on Windows", () => {
    expect(overlayUpdate("win32", theme)).toEqual({ ...theme, height: TITLE_BAR_HEIGHT });
  });

  it.each(["darwin", "linux"])("has nothing to recolour on %s", (platform) => {
    expect(overlayUpdate(platform, theme)).toBeNull();
  });
});

describe("DEFAULT_WINDOW_THEME", () => {
  it("is itself a valid theme", () => {
    expect(parseWindowTheme(DEFAULT_WINDOW_THEME)).toEqual(DEFAULT_WINDOW_THEME);
  });
});
