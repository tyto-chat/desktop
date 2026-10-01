import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { posix } from "node:path";

export function autostartDir(env: NodeJS.ProcessEnv = process.env): string {
  return posix.join(env.XDG_CONFIG_HOME || posix.join(homedir(), ".config"), "autostart");
}

export function launchCommand(env: NodeJS.ProcessEnv, execPath: string): string {
  return quote(env.APPIMAGE || execPath);
}

function quote(path: string): string {
  return `"${path.replace(/["\\$`]/g, "\\$&")}"`;
}

export function autostartEntry(command: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Tyto",
    "Comment=tyto.chat desktop app",
    `Exec=${command}`,
    "Icon=tyto",
    "Terminal=false",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

export function setLinuxAutostart(
  enabled: boolean,
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
): void {
  const file = posix.join(autostartDir(env), "tyto.desktop");
  if (!enabled) {
    rmSync(file, { force: true });
    return;
  }
  mkdirSync(autostartDir(env), { recursive: true });
  writeFileSync(file, autostartEntry(launchCommand(env, execPath)), { mode: 0o644 });
}
