import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveAppPath } from "../src/main/appPath";

let rendererDir: string;
let index: string;

beforeAll(() => {
  rendererDir = mkdtempSync(join(tmpdir(), "tyto-renderer-"));
  mkdirSync(join(rendererDir, "assets"));
  mkdirSync(join(rendererDir, "locales", "en"), { recursive: true });
  writeFileSync(join(rendererDir, "index.html"), "<!doctype html>");
  writeFileSync(join(rendererDir, "assets", "x.js"), "export {}");
  writeFileSync(join(rendererDir, "embed.js"), "");
  writeFileSync(join(rendererDir, "locales", "en", "common.json"), "{}");
  writeFileSync(join(rendererDir, "..", "secret.txt"), "nope");
  index = join(rendererDir, "index.html");
});

describe("resolveAppPath", () => {
  it("serves index.html for the root", () => {
    expect(resolveAppPath("/", rendererDir)).toBe(index);
    expect(resolveAppPath("", rendererDir)).toBe(index);
  });

  it("serves an existing asset", () => {
    expect(resolveAppPath("/assets/x.js", rendererDir)).toBe(join(rendererDir, "assets", "x.js"));
    expect(resolveAppPath("/embed.js", rendererDir)).toBe(join(rendererDir, "embed.js"));
    expect(resolveAppPath("/locales/en/common.json", rendererDir)).toBe(
      join(rendererDir, "locales", "en", "common.json"),
    );
  });

  it.each(["/dm/123", "/m/0b1e3c8e-1111-4222-8333-444455556666", "/community/general"])(
    "falls back to index.html for the SPA route %s",
    (route) => {
      expect(resolveAppPath(route, rendererDir)).toBe(index);
    },
  );

  it.each([
    "/../secret.txt",
    "/assets/../../secret.txt",
    "/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/assets/..%5c..%5csecret.txt",
    "//etc/passwd",
  ])("never leaves the renderer directory for %s", (path) => {
    const resolved = resolveAppPath(path, rendererDir);
    expect(resolved.startsWith(rendererDir)).toBe(true);
    expect(resolved).toBe(index);
  });

  it("falls back to index.html for a missing file", () => {
    expect(resolveAppPath("/assets/missing.js", rendererDir)).toBe(index);
  });

  it("falls back to index.html for a directory", () => {
    expect(resolveAppPath("/assets", rendererDir)).toBe(index);
  });

  it("falls back to index.html for malformed escapes", () => {
    expect(resolveAppPath("/%E0%A4%A", rendererDir)).toBe(index);
  });

  it("ignores null bytes", () => {
    expect(resolveAppPath("/assets/x.js%00.png", rendererDir)).toBe(index);
  });
});
