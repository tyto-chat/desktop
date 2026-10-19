import { describe, expect, it, vi } from "vitest";
import { createSpellCheck, isLanguageList } from "../src/main/spellCheck";

function fakeSession(available: string[], enabled: string[]) {
  let current = enabled;
  return {
    availableSpellCheckerLanguages: available,
    getSpellCheckerLanguages: () => current,
    setSpellCheckerLanguages: vi.fn((languages: string[]) => {
      current = languages;
    }),
  };
}

function fakeStore(saved: string[] | null) {
  return { read: () => saved, save: vi.fn() };
}

describe("isLanguageList", () => {
  it("accepts BCP 47 tags only", () => {
    expect(isLanguageList(["en-US", "pl", "pt-BR"])).toBe(true);
    expect(isLanguageList([])).toBe(true);
    expect(isLanguageList("en")).toBe(false);
    expect(isLanguageList(["en US"])).toBe(false);
    expect(isLanguageList([42])).toBe(false);
    expect(isLanguageList(new Array(33).fill("en"))).toBe(false);
  });
});

describe("createSpellCheck", () => {
  it("restores the saved languages that the session knows", () => {
    const session = fakeSession(["en-US", "pl", "de"], ["en-US"]);
    createSpellCheck(session as never, fakeStore(["pl", "fr", "pl"]), "linux");
    expect(session.setSpellCheckerLanguages).toHaveBeenCalledWith(["pl"]);
  });

  it("leaves the session alone without saved languages", () => {
    const session = fakeSession(["en-US", "pl"], ["en-US"]);
    const control = createSpellCheck(session as never, fakeStore(null), "linux");
    expect(session.setSpellCheckerLanguages).not.toHaveBeenCalled();
    expect(control.get()).toEqual({ available: ["en-US", "pl"], enabled: ["en-US"] });
  });

  it("applies, persists and reports a new selection", () => {
    const session = fakeSession(["en-US", "pl"], ["en-US"]);
    const store = fakeStore(null);
    const control = createSpellCheck(session as never, store, "win32");
    expect(control.set(["pl", "xx"])).toEqual({ available: ["en-US", "pl"], enabled: ["pl"] });
    expect(store.save).toHaveBeenCalledWith(["pl"]);
  });

  it("is inert on macOS, where the system spellchecker rules", () => {
    const session = fakeSession(["en-US"], ["en-US"]);
    const store = fakeStore(["pl"]);
    const control = createSpellCheck(session as never, store, "darwin");
    expect(session.setSpellCheckerLanguages).not.toHaveBeenCalled();
    expect(control.set(["en-US"])).toEqual({ available: [], enabled: [] });
    expect(store.save).not.toHaveBeenCalled();
  });
});
