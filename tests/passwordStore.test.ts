import { describe, expect, it } from "vitest";
import { preferredPasswordStore } from "../src/main/passwordStore";

const linux = { platform: "linux", explicit: false };

describe("preferredPasswordStore", () => {
  it.each(["Hyprland", "sway", "i3", "niri", "river", "bspwm", "wlroots", "", undefined])(
    "asks for the Secret Service on the desktop %j, which Chromium does not recognise",
    (desktop) => {
      expect(preferredPasswordStore({ ...linux, desktop })).toBe("gnome-libsecret");
    },
  );

  it.each([
    "GNOME",
    "ubuntu:GNOME",
    "KDE",
    "plasma:KDE",
    "XFCE",
    "X-Cinnamon",
    "Unity",
    "Pantheon",
    "Deepin",
    "UKUI",
    "gnome",
    "kde",
  ])("leaves the choice to Chromium on %s", (desktop) => {
    expect(preferredPasswordStore({ ...linux, desktop })).toBeNull();
  });

  it("recognises a known desktop anywhere in a colon-separated list", () => {
    expect(preferredPasswordStore({ ...linux, desktop: "Hyprland:GNOME" })).toBeNull();
    expect(preferredPasswordStore({ ...linux, desktop: "sway:wlroots" })).toBe("gnome-libsecret");
  });

  it("never overrides a store the user chose on the command line", () => {
    expect(
      preferredPasswordStore({ platform: "linux", desktop: "Hyprland", explicit: true }),
    ).toBeNull();
  });

  it.each(["darwin", "win32"])("does nothing on %s", (platform) => {
    expect(preferredPasswordStore({ platform, desktop: "Hyprland", explicit: false })).toBeNull();
  });
});
