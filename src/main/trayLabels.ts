import { readFileSync } from "node:fs";
import { ENGLISH_TRAY_LABELS, mergeTrayLabels, type TrayLabels } from "./trayState";

export type TrayLabelBundle = Record<string, unknown>;

export function readTrayLabelBundle(path: string): TrayLabelBundle {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as TrayLabelBundle)
      : {};
  } catch {
    return {};
  }
}

export function pickTrayLanguage(available: string[], preferred: string[]): string | null {
  const byLower = new Map(available.map((lang) => [lang.toLowerCase(), lang]));
  for (const tag of preferred) {
    const lower = tag.toLowerCase();
    const exact = byLower.get(lower);
    if (exact) return exact;
    const base = byLower.get(lower.split("-")[0] ?? "");
    if (base) return base;
  }
  return null;
}

export function bundledTrayLabels(bundle: TrayLabelBundle, preferred: string[]): TrayLabels {
  const english = mergeTrayLabels(bundle.en, ENGLISH_TRAY_LABELS);
  const lang = pickTrayLanguage(Object.keys(bundle), preferred);
  return lang ? mergeTrayLabels(bundle[lang], english) : english;
}
