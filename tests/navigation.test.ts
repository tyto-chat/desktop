import { describe, expect, it } from "vitest";
import { classifyNavigation, isPermissionAllowed } from "../src/main/navigationPolicy";

const APP = "app://tyto";
const DEV = "https://client.ddev.site";

describe("classifyNavigation", () => {
  it.each(["app://tyto/", "app://tyto/dm/1", "app://tyto/m/abc?x=1#y"])(
    "keeps %s inside the app",
    (url) => {
      expect(classifyNavigation(url, APP)).toBe("internal");
    },
  );

  it.each(["https://example.com/", "http://example.com/a", "mailto:a@b.c"])(
    "hands %s to the operating system",
    (url) => {
      expect(classifyNavigation(url, APP)).toBe("external");
    },
  );

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "app://evil/",
    "app://tyto.evil.example/",
    "chrome://settings",
    "tyto://open?url=https://a",
    "not a url",
    "",
  ])("blocks %s", (url) => {
    expect(classifyNavigation(url, APP)).toBe("blocked");
  });

  it("treats the dev server origin as internal only when it is the app origin", () => {
    expect(classifyNavigation(`${DEV}/dm`, DEV)).toBe("internal");
    expect(classifyNavigation(`${DEV}/dm`, APP)).toBe("external");
    expect(classifyNavigation("https://client.ddev.site.evil.example/", DEV)).toBe("external");
  });
});

describe("isPermissionAllowed", () => {
  it.each(["media", "notifications", "clipboard-sanitized-write", "fullscreen", "display-capture"])(
    "grants %s to the app origin",
    (permission) => {
      expect(isPermissionAllowed(permission, `${APP}/dm/1`, APP)).toBe(true);
    },
  );

  it.each(["geolocation", "midi", "openExternal", "hid", "serial", "usb", "clipboard-read"])(
    "denies %s even to the app origin",
    (permission) => {
      expect(isPermissionAllowed(permission, `${APP}/`, APP)).toBe(false);
    },
  );

  it("denies everything to any other origin", () => {
    expect(isPermissionAllowed("media", "https://example.com/", APP)).toBe(false);
    expect(isPermissionAllowed("notifications", "app://evil/", APP)).toBe(false);
    expect(isPermissionAllowed("media", "", APP)).toBe(false);
  });
});
