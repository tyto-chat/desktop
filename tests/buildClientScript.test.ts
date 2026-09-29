import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = join(__dirname, "..", "scripts", "build-client.sh");

function run(env: Record<string, string>) {
  return spawnSync("bash", [script], {
    env: { PATH: process.env.PATH ?? "", TYTO_CLIENT_REPO: "/nonexistent/repo", ...env },
    encoding: "utf8",
    timeout: 20_000,
  });
}

describe("build-client.sh", () => {
  it.each([
    "--upload-pack=true",
    "-c core.sshCommand=x",
    "main; rm -rf /",
    "feat/branch name",
    "$(id)",
    "..",
  ])("refuses the ref %j before touching git", (ref) => {
    const result = run({ TYTO_CLIENT_REF: ref, TYTO_ALLOW_UNPINNED_CLIENT: "1" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/client ref/i);
    expect(result.stdout).not.toMatch(/Fetching/);
  });

  it.each(["main", "v1.0.0-beta.4", "feat/desktop-plan6-bridge"])(
    "refuses the unpinned ref %j unless explicitly allowed",
    (ref) => {
      const result = run({ TYTO_CLIENT_REF: ref });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/40-character commit/i);
      expect(result.stdout).not.toMatch(/Fetching/);
    },
  );

  it("accepts a full commit sha", () => {
    const result = run({ TYTO_CLIENT_REF: "286b408e39b2f1f88183b5fb8a77442b3fb2270c" });
    expect(result.stdout).toMatch(/Fetching/);
  });

  it("accepts a branch name when unpinned builds are explicitly allowed", () => {
    const result = run({ TYTO_CLIENT_REF: "feat/x", TYTO_ALLOW_UNPINNED_CLIENT: "1" });
    expect(result.stdout).toMatch(/Fetching/);
  });
});
