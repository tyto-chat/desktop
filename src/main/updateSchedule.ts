export const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;

export interface UpdateScheduleDeps {
  check(): Promise<unknown> | unknown;
  onError(error: unknown): void;
}

export function startUpdateSchedule(deps: UpdateScheduleDeps): () => void {
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      await deps.check();
    } catch (error) {
      deps.onError(error);
    } finally {
      running = false;
    }
  };

  const first = setTimeout(() => void run(), 0);
  const repeat = setInterval(() => void run(), UPDATE_INTERVAL_MS);

  return () => {
    clearTimeout(first);
    clearInterval(repeat);
  };
}
