export type NavigationKind = "internal" | "external" | "blocked";

const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

const ALLOWED_PERMISSIONS = new Set([
  "media",
  "notifications",
  "clipboard-sanitized-write",
  "fullscreen",
  "display-capture",
]);

function originOf(raw: string): string | null {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

export function classifyNavigation(raw: string, appOrigin: string): NavigationKind {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "blocked";
  }
  if (`${url.protocol}//${url.host}` === appOrigin) return "internal";
  return EXTERNAL_PROTOCOLS.has(url.protocol) ? "external" : "blocked";
}

export function isPermissionAllowed(
  permission: string,
  requestingUrl: string,
  appOrigin: string,
): boolean {
  return originOf(requestingUrl) === appOrigin && ALLOWED_PERMISSIONS.has(permission);
}
