import { originOf } from "./navigationPolicy";

export interface ShareSource {
  id: string;
  name: string;
}

export function chooseShareSource<T extends ShareSource>(
  sources: readonly T[],
  requestingUrl: string,
  appOrigin: string,
): T | null {
  if (originOf(requestingUrl) !== appOrigin) return null;
  return sources.find((source) => source.id.startsWith("screen:")) ?? sources[0] ?? null;
}
