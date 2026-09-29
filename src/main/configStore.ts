import { join } from "node:path";
import { readTextIfPresent, SerialQueue, writeTextAtomically } from "./atomicFile";

export class ConfigStore {
  private readonly file: string;
  private readonly queue = new SerialQueue();

  constructor(userDataDir: string) {
    this.file = join(userDataDir, "desktop-config.json");
  }

  get(): Promise<string | null> {
    return this.queue.run(() => readTextIfPresent(this.file));
  }

  set(json: string): Promise<void> {
    return this.queue.run(() => writeTextAtomically(this.file, json));
  }
}
