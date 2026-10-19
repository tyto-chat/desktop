import { describe, expect, it, vi } from "vitest";
import {
  buildContextMenu,
  type ContextMenuEntry,
  type ContextTarget,
} from "../src/main/contextMenu";

vi.mock("electron", () => ({ clipboard: {}, Menu: {}, shell: {} }));

const labels = {
  contextCut: "Cut",
  contextCopy: "Copy",
  contextPaste: "Paste",
  contextSelectAll: "Select all",
  contextOpenLink: "Open link in browser",
  contextCopyLink: "Copy link",
  contextCopyImage: "Copy image",
  contextCopyImageAddress: "Copy image address",
  contextAddToDictionary: "Add to dictionary",
};

function target(overrides: Partial<ContextTarget> = {}): ContextTarget {
  return {
    x: 10,
    y: 20,
    isEditable: false,
    selectionText: "",
    linkURL: "",
    mediaType: "none",
    srcURL: "",
    misspelledWord: "",
    dictionarySuggestions: [],
    editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: false },
    ...overrides,
  };
}

const labelsOf = (entries: ContextMenuEntry[]) =>
  entries.map((e) => (e.kind === "separator" ? "---" : `${e.label}${e.enabled ? "" : " (off)"}`));

describe("buildContextMenu", () => {
  it("offers nothing on plain page content", () => {
    expect(buildContextMenu(target(), labels)).toEqual([]);
  });

  it("offers editing commands in editable fields, greyed out by edit flags", () => {
    const entries = buildContextMenu(
      target({
        isEditable: true,
        editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
      }),
      labels,
    );
    expect(labelsOf(entries)).toEqual(["Cut (off)", "Copy (off)", "Paste", "Select all"]);
  });

  it("offers copy only for a selection outside fields", () => {
    expect(labelsOf(buildContextMenu(target({ selectionText: "hello" }), labels))).toEqual([
      "Copy",
    ]);
    expect(buildContextMenu(target({ selectionText: "   " }), labels)).toEqual([]);
  });

  it("puts spelling suggestions first, capped, with add-to-dictionary", () => {
    const entries = buildContextMenu(
      target({
        isEditable: true,
        misspelledWord: "teh",
        dictionarySuggestions: ["the", "tea", "ten", "tech", "then", "them"],
        editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true },
      }),
      labels,
    );
    expect(labelsOf(entries)).toEqual([
      "the",
      "tea",
      "ten",
      "tech",
      "then",
      "Add to dictionary",
      "---",
      "Cut",
      "Copy",
      "Paste",
      "Select all",
    ]);
    expect(entries[0]).toMatchObject({ action: { type: "replace-misspelling", word: "the" } });
    expect(entries[5]).toMatchObject({ action: { type: "add-to-dictionary", word: "teh" } });
  });

  it("offers link and image actions, only for openable links", () => {
    const link = buildContextMenu(target({ linkURL: "https://tyto.chat/docs" }), labels);
    expect(labelsOf(link)).toEqual(["Open link in browser", "Copy link"]);
    expect(link[0]).toMatchObject({ action: { type: "open-link", url: "https://tyto.chat/docs" } });

    expect(buildContextMenu(target({ linkURL: "javascript:alert(1)" }), labels)).toEqual([]);

    const image = buildContextMenu(
      target({
        mediaType: "image",
        srcURL: "https://tyto.chat/a.png",
        linkURL: "https://tyto.chat",
      }),
      labels,
    );
    expect(labelsOf(image)).toEqual([
      "Open link in browser",
      "Copy link",
      "---",
      "Copy image",
      "Copy image address",
    ]);
    expect(image[3]).toMatchObject({ action: { type: "copy-image", x: 10, y: 20 } });
  });
});
