import { isAbsolute, join } from "node:path";

const DATA_FOLDER = "tyto";

export interface UserDataInput {
  appData: string;
  isPackaged: boolean;
  override: string | undefined;
}

export function resolveUserDataDir(input: UserDataInput): string {
  const override = input.override?.trim() ?? "";
  if (!input.isPackaged && override !== "" && isAbsolute(override)) return override;
  return join(input.appData, DATA_FOLDER);
}
