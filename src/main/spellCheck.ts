import type { Session } from "electron";
import type { BridgeSpellCheck } from "../shared/bridge";

export interface SpellCheckStore {
  read(): string[] | null;
  save(languages: string[]): void;
}

export interface SpellCheckController {
  get(): BridgeSpellCheck;
  set(languages: string[]): BridgeSpellCheck;
}

export const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function isLanguageList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 32 &&
    value.every((entry) => typeof entry === "string" && LANGUAGE_TAG.test(entry))
  );
}

export function createSpellCheck(
  session: Session,
  store: SpellCheckStore,
  platform: NodeJS.Platform = process.platform,
): SpellCheckController {
  const configurable = platform !== "darwin";
  const known = (languages: string[]) =>
    [...new Set(languages)].filter((language) =>
      session.availableSpellCheckerLanguages.includes(language),
    );

  if (configurable) {
    const saved = store.read();
    if (saved) session.setSpellCheckerLanguages(known(saved));
  }

  const get = (): BridgeSpellCheck =>
    configurable
      ? {
          available: session.availableSpellCheckerLanguages,
          enabled: session.getSpellCheckerLanguages(),
        }
      : { available: [], enabled: [] };

  return {
    get,
    set(languages) {
      if (!configurable) return get();
      const next = known(languages);
      session.setSpellCheckerLanguages(next);
      store.save(next);
      return get();
    },
  };
}
