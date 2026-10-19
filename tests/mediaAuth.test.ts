import { describe, expect, it, vi } from "vitest";
import { installMediaAuth, mediaAuthorization } from "../src/main/mediaAuth";

const tokens = new Map([["https://chat.example", "abc.def.ghi"]]);

describe("mediaAuthorization", () => {
  it("authorizes media requests of a known origin", () => {
    expect(mediaAuthorization("https://chat.example/media/tok/file.mp4", tokens)).toBe(
      "Bearer abc.def.ghi",
    );
  });

  it("ignores other paths and unknown origins", () => {
    expect(mediaAuthorization("https://chat.example/api/v1/me", tokens)).toBeNull();
    expect(mediaAuthorization("https://other.example/media/tok/file.mp4", tokens)).toBeNull();
    expect(mediaAuthorization("not a url", tokens)).toBeNull();
  });
});

describe("installMediaAuth", () => {
  function fakeSession() {
    let hook:
      | ((
          details: { url: string; requestHeaders: Record<string, string> },
          cb: (r: { requestHeaders: Record<string, string> }) => void,
        ) => void)
      | null = null;
    const session = {
      webRequest: {
        onBeforeSendHeaders: vi.fn((_filter: unknown, listener: typeof hook) => {
          hook = listener;
        }),
      },
    };
    const run = (url: string) => {
      let result: { requestHeaders: Record<string, string> } | null = null;
      hook!({ url, requestHeaders: { Accept: "*/*" } }, (r) => {
        result = r;
      });
      return result!.requestHeaders;
    };
    return { session, run };
  }

  it("adds and removes the header as tokens change", () => {
    const { session, run } = fakeSession();
    const store = installMediaAuth(session as never);
    expect(session.webRequest.onBeforeSendHeaders).toHaveBeenCalledWith(
      { urls: ["*://*/media/*"] },
      expect.any(Function),
    );

    expect(run("https://chat.example/media/tok/a.png")).toEqual({ Accept: "*/*" });

    store.set({ origin: "https://chat.example", token: "abc" });
    expect(run("https://chat.example/media/tok/a.png")).toEqual({
      Accept: "*/*",
      Authorization: "Bearer abc",
    });

    store.set({ origin: "https://chat.example", token: null });
    expect(run("https://chat.example/media/tok/a.png")).toEqual({ Accept: "*/*" });
  });
});
