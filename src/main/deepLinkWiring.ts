import type { App } from "electron";
import { findDeepLinkInArgv, parseDeepLink } from "./deepLinks";

export const DEEP_LINK_SCHEME = "tyto";

export function wireDeepLinks(app: App, onLink: (url: string) => void): void {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [process.argv[1]]);
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }

  app.on("open-url", (event, raw) => {
    event.preventDefault();
    const link = parseDeepLink(raw);
    if (link) onLink(link.url);
  });

  app.on("second-instance", (_event, argv) => {
    const link = findDeepLinkInArgv(argv);
    if (link) onLink(link.url);
  });

  const launched = findDeepLinkInArgv(process.argv);
  if (launched) onLink(launched.url);
}
