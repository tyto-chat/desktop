export type NavigationKind = "internal" | "external" | "blocked";

const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

const ALLOWED_PERMISSIONS = new Set([
  "media",
  "notifications",
  "clipboard-sanitized-write",
  "fullscreen",
  "display-capture",
]);

export function originOf(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.host === "" ? null : `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' https: data: blob:",
    "media-src 'self' https: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function classifyNavigation(raw: string, appOrigin: string): NavigationKind {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "blocked";
  }
  if (originOf(raw) === appOrigin) return "internal";
  return EXTERNAL_PROTOCOLS.has(url.protocol) ? "external" : "blocked";
}

export function isPermissionAllowed(
  permission: string,
  requestingUrl: string,
  appOrigin: string,
): boolean {
  return originOf(requestingUrl) === appOrigin && ALLOWED_PERMISSIONS.has(permission);
}
