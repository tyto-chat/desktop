import { describe, expect, it } from "vitest";
import { chooseShareSource } from "../src/main/screenSharePolicy";

const screen1 = { id: "screen:1:0", name: "Screen 1" };
const screen2 = { id: "screen:2:0", name: "Screen 2" };
const window1 = { id: "window:7:0", name: "Editor" };

describe("chooseShareSource", () => {
  it("shares nothing when the request does not come from the app", () => {
    expect(chooseShareSource([screen1], "https://example.com/", "app://tyto")).toBeNull();
    expect(chooseShareSource([screen1], "", "app://tyto")).toBeNull();
  });

  it("shares nothing when there is nothing to share", () => {
    expect(chooseShareSource([], "app://tyto/x", "app://tyto")).toBeNull();
  });

  it("prefers a whole screen over a window", () => {
    expect(chooseShareSource([window1, screen2, screen1], "app://tyto/x", "app://tyto")).toBe(
      screen2,
    );
  });

  it("falls back to the first window when no screen is offered", () => {
    expect(chooseShareSource([window1], "app://tyto/x", "app://tyto")).toBe(window1);
  });
});
