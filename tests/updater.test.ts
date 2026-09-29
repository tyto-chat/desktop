import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startUpdateSchedule, UPDATE_INTERVAL_MS } from "../src/main/updateSchedule";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("startUpdateSchedule", () => {
  it("checks on launch and then every four hours", async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    startUpdateSchedule({ check, onError: vi.fn() });

    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS - 1);
    expect(check).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS * 2);
    expect(check).toHaveBeenCalledTimes(4);
  });

  it("uses a four hour interval", () => {
    expect(UPDATE_INTERVAL_MS).toBe(4 * 60 * 60 * 1000);
  });

  it("reports a failed check and keeps the schedule alive", async () => {
    const failure = new Error("offline");
    const check = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const onError = vi.fn();
    startUpdateSchedule({ check, onError });

    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith(failure);

    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("survives a check that throws synchronously", async () => {
    const check = vi.fn(() => {
      throw new Error("boom");
    });
    const onError = vi.fn();
    startUpdateSchedule({ check, onError });

    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("never overlaps two checks", async () => {
    let release!: () => void;
    const check = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    startUpdateSchedule({ check, onError: vi.fn() });

    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS * 3);
    expect(check).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("stops when asked", async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const stop = startUpdateSchedule({ check, onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);

    stop();
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS * 2);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
