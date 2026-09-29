import { statSync } from "node:fs";
import { isAbsolute, join, posix, relative, resolve } from "node:path";

export function resolveAppPath(urlPath: string, rendererDir: string): string {
  const index = join(rendererDir, "index.html");

  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return index;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return index;

  const candidate = resolve(rendererDir, `.${posix.normalize(`/${decoded}`)}`);
  const fromRoot = relative(rendererDir, candidate);
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) return index;

  try {
    if (statSync(candidate).isFile()) return candidate;
  } catch {
    return index;
  }
  return index;
}
