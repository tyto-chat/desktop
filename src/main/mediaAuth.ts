import type { Session } from "electron";
import type { BridgeMediaAuth } from "../shared/bridge";

export interface MediaAuthStore {
  set(auth: BridgeMediaAuth): void;
}

export function mediaAuthorization(
  url: string,
  tokens: ReadonlyMap<string, string>,
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.pathname.startsWith("/media/")) return null;
  const token = tokens.get(parsed.origin);
  return token ? `Bearer ${token}` : null;
}

export function installMediaAuth(session: Session): MediaAuthStore {
  const tokens = new Map<string, string>();
  session.webRequest.onBeforeSendHeaders({ urls: ["*://*/media/*"] }, (details, callback) => {
    const authorization = mediaAuthorization(details.url, tokens);
    const requestHeaders = authorization
      ? { ...details.requestHeaders, Authorization: authorization }
      : details.requestHeaders;
    callback({ requestHeaders });
  });
  return {
    set({ origin, token }) {
      if (token) tokens.set(origin, token);
      else tokens.delete(origin);
    },
  };
}
