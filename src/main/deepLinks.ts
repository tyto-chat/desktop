export interface DeepLink {
  url: string;
}

const MAX_LINK_LENGTH = 2_048;
const MAX_QUEUED_LINKS = 20;

export function parseDeepLink(raw: string): DeepLink | null {
  if (raw.length === 0 || raw.length > MAX_LINK_LENGTH) return null;

  let link: URL;
  try {
    link = new URL(raw);
  } catch {
    return null;
  }
  if (link.protocol !== "tyto:" || link.host.toLowerCase() !== "open") return null;

  const target = link.searchParams.get("url");
  if (!target) return null;

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;

  return { url: url.toString() };
}

export function findDeepLinkInArgv(argv: readonly string[]): DeepLink | null {
  for (const argument of argv) {
    const link = parseDeepLink(argument);
    if (link) return link;
  }
  return null;
}

export function urlEnvelope(url: string): string {
  return JSON.stringify({ kind: "url", url });
}

export function notificationEnvelope(payload: string): string {
  return JSON.stringify({ kind: "notification", payload });
}

export class DeepLinkQueue {
  private ready = false;
  private pending: string[] = [];

  constructor(private readonly deliver: (envelope: string) => void) {}

  push(envelope: string): void {
    if (this.ready) {
      this.deliver(envelope);
      return;
    }
    this.pending.push(envelope);
    if (this.pending.length > MAX_QUEUED_LINKS) this.pending.shift();
  }

  markReady(): void {
    this.ready = true;
    const queued = this.pending;
    this.pending = [];
    for (const envelope of queued) this.deliver(envelope);
  }

  markNotReady(): void {
    this.ready = false;
  }
}
