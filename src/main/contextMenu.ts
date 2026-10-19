import {
  clipboard,
  Menu,
  shell,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import type { TrayLabels } from "./trayState";

export type ContextMenuLabels = Pick<
  TrayLabels,
  | "contextCut"
  | "contextCopy"
  | "contextPaste"
  | "contextSelectAll"
  | "contextOpenLink"
  | "contextCopyLink"
  | "contextCopyImage"
  | "contextCopyImageAddress"
  | "contextAddToDictionary"
>;

export interface ContextTarget {
  x: number;
  y: number;
  isEditable: boolean;
  selectionText: string;
  linkURL: string;
  mediaType: string;
  srcURL: string;
  misspelledWord: string;
  dictionarySuggestions: string[];
  editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
}

export type ContextAction =
  | { type: "replace-misspelling"; word: string }
  | { type: "add-to-dictionary"; word: string }
  | { type: "open-link"; url: string }
  | { type: "copy-text"; text: string }
  | { type: "copy-image"; x: number; y: number }
  | { type: "role"; role: "cut" | "copy" | "paste" | "selectAll" };

export type ContextMenuEntry =
  { kind: "separator" } | { kind: "item"; label: string; enabled: boolean; action: ContextAction };

const MAX_SUGGESTIONS = 5;
const OPENABLE_LINK = /^(https?|mailto):/i;

function item(label: string, action: ContextAction, enabled = true): ContextMenuEntry {
  return { kind: "item", label, enabled, action };
}

export function buildContextMenu(
  target: ContextTarget,
  labels: ContextMenuLabels,
): ContextMenuEntry[] {
  const groups: ContextMenuEntry[][] = [];

  if (target.misspelledWord) {
    groups.push([
      ...target.dictionarySuggestions
        .slice(0, MAX_SUGGESTIONS)
        .map((word) => item(word, { type: "replace-misspelling", word })),
      item(labels.contextAddToDictionary, {
        type: "add-to-dictionary",
        word: target.misspelledWord,
      }),
    ]);
  }

  if (target.linkURL && OPENABLE_LINK.test(target.linkURL)) {
    groups.push([
      item(labels.contextOpenLink, { type: "open-link", url: target.linkURL }),
      item(labels.contextCopyLink, { type: "copy-text", text: target.linkURL }),
    ]);
  }

  if (target.mediaType === "image" && target.srcURL) {
    groups.push([
      item(labels.contextCopyImage, { type: "copy-image", x: target.x, y: target.y }),
      item(labels.contextCopyImageAddress, { type: "copy-text", text: target.srcURL }),
    ]);
  }

  if (target.isEditable) {
    const flags = target.editFlags;
    groups.push([
      item(labels.contextCut, { type: "role", role: "cut" }, flags.canCut),
      item(labels.contextCopy, { type: "role", role: "copy" }, flags.canCopy),
      item(labels.contextPaste, { type: "role", role: "paste" }, flags.canPaste),
      item(labels.contextSelectAll, { type: "role", role: "selectAll" }, flags.canSelectAll),
    ]);
  } else if (target.selectionText.trim() !== "") {
    groups.push([item(labels.contextCopy, { type: "role", role: "copy" })]);
  }

  return groups.flatMap((group, index) =>
    index === 0 ? group : [{ kind: "separator" }, ...group],
  );
}

function toTemplate(
  entries: ContextMenuEntry[],
  contents: WebContents,
): MenuItemConstructorOptions[] {
  return entries.map((entry) => {
    if (entry.kind === "separator") return { type: "separator" };
    const { action, label, enabled } = entry;
    if (action.type === "role") return { role: action.role, label, enabled };
    return {
      label,
      enabled,
      click: () => {
        switch (action.type) {
          case "replace-misspelling":
            contents.replaceMisspelling(action.word);
            break;
          case "add-to-dictionary":
            contents.session.addWordToSpellCheckerDictionary(action.word);
            break;
          case "open-link":
            void shell.openExternal(action.url);
            break;
          case "copy-text":
            clipboard.writeText(action.text);
            break;
          case "copy-image":
            contents.copyImageAt(action.x, action.y);
            break;
        }
      },
    };
  });
}

export function installContextMenu(contents: WebContents, labels: () => ContextMenuLabels): void {
  contents.on("context-menu", (_event, params) => {
    const entries = buildContextMenu(params, labels());
    if (entries.length === 0) return;
    Menu.buildFromTemplate(toTemplate(entries, contents)).popup();
  });
}
