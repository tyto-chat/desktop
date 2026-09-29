import { findDeepLinkInArgv, parseDeepLink, type DeepLinkQueue } from "./deepLinks";

export const DEEP_LINK_SCHEME = "tyto";

interface Listenable {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface DeepLinkApp extends Listenable {
  setAsDefaultProtocolClient(protocol: string, path?: string, args?: string[]): boolean;
}

export function wireDeepLinks(
  app: DeepLinkApp,
  onLink: (url: string) => void,
  argv: readonly string[] = process.argv,
): void {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [process.argv[1]]);
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }

  app.on("open-url", (event, raw) => {
    (event as { preventDefault(): void }).preventDefault();
    const link = typeof raw === "string" ? parseDeepLink(raw) : null;
    if (link) onLink(link.url);
  });

  app.on("second-instance", (_event, secondArgv) => {
    const link = Array.isArray(secondArgv)
      ? findDeepLinkInArgv(secondArgv.filter((value) => typeof value === "string"))
      : null;
    if (link) onLink(link.url);
  });

  const launched = findDeepLinkInArgv(argv);
  if (launched) onLink(launched.url);
}

export function rearmQueueOnNavigation(contents: Listenable, queue: DeepLinkQueue): void {
  contents.on("did-navigate", () => queue.markNotReady());
  contents.on("render-process-gone", () => queue.markNotReady());
}
