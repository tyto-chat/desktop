const DESKTOPS_CHROMIUM_RECOGNISES = new Set([
  "gnome",
  "unity",
  "kde",
  "xfce",
  "x-cinnamon",
  "cinnamon",
  "pantheon",
  "deepin",
  "ukui",
]);

export interface PasswordStoreInput {
  platform: string;
  desktop: string | undefined;
  explicit: boolean;
  weakBackendAllowed: boolean;
}

export function preferredPasswordStore(input: PasswordStoreInput): string | null {
  if (input.platform !== "linux" || input.explicit || input.weakBackendAllowed) return null;
  const names = (input.desktop ?? "").toLowerCase().split(":");
  if (names.some((name) => DESKTOPS_CHROMIUM_RECOGNISES.has(name))) return null;
  return "gnome-libsecret";
}
