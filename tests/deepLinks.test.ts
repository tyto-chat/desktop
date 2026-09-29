import { describe, expect, it, vi } from "vitest";
import {
  DeepLinkQueue,
  findDeepLinkInArgv,
  notificationEnvelope,
  parseDeepLink,
  urlEnvelope,
} from "../src/main/deepLinks";

describe("parseDeepLink", () => {
  it.each([
    [
      "tyto://open?url=https://srv.example/m/0b1e3c8e-1111-4222-8333-444455556666",
      "https://srv.example/m/0b1e3c8e-1111-4222-8333-444455556666",
    ],
    ["tyto://open?url=https%3A%2F%2Fsrv.example%2Fm%2Fabc", "https://srv.example/m/abc"],
    ["tyto://open?url=https://srv.example", "https://srv.example/"],
    ["tyto://open/?url=https://srv.example:8443/x?y=1", "https://srv.example:8443/x?y=1"],
    ["TYTO://OPEN?url=https://srv.example/", "https://srv.example/"],
  ])("accepts %s", (raw, url) => {
    expect(parseDeepLink(raw)).toEqual({ url });
  });

  it.each([
    "tyto://open?url=http://srv.example/",
    "tyto://open?url=javascript:alert(1)",
    "tyto://open?url=file:///etc/passwd",
    "tyto://open?url=app://tyto/",
    "tyto://open?url=tyto://open?url=https://a",
    "tyto://open?url=https://user:pass@srv.example/",
    "tyto://open?url=",
    "tyto://open",
    "tyto://other?url=https://srv.example/",
    "https://srv.example/",
    "tyto:open?url=https://srv.example/",
    "not a url",
    "",
    `tyto://open?url=https://srv.example/${"a".repeat(4096)}`,
  ])("rejects %s", (raw) => {
    expect(parseDeepLink(raw)).toBeNull();
  });
});

describe("findDeepLinkInArgv", () => {
  it("finds the link among launch arguments", () => {
    expect(
      findDeepLinkInArgv([
        "/opt/tyto/tyto",
        "--no-sandbox",
        "tyto://open?url=https://srv.example/",
      ]),
    ).toEqual({ url: "https://srv.example/" });
  });

  it("ignores arguments that are not valid links", () => {
    expect(findDeepLinkInArgv(["/opt/tyto/tyto", "tyto://open?url=http://x", "--flag"])).toBeNull();
    expect(findDeepLinkInArgv([])).toBeNull();
  });
});

describe("envelopes", () => {
  it("wraps a url", () => {
    expect(JSON.parse(urlEnvelope("https://srv.example/m/1"))).toEqual({
      kind: "url",
      url: "https://srv.example/m/1",
    });
  });

  it("wraps a notification payload verbatim", () => {
    expect(JSON.parse(notificationEnvelope('{"identityId":"a"}'))).toEqual({
      kind: "notification",
      payload: '{"identityId":"a"}',
    });
  });
});

describe("DeepLinkQueue", () => {
  it("holds links until the renderer is ready, then delivers them in order", () => {
    const deliver = vi.fn();
    const queue = new DeepLinkQueue(deliver);

    queue.push("a");
    queue.push("b");
    expect(deliver).not.toHaveBeenCalled();

    queue.markReady();
    expect(deliver.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("delivers immediately once ready", () => {
    const deliver = vi.fn();
    const queue = new DeepLinkQueue(deliver);
    queue.markReady();

    queue.push("c");
    expect(deliver.mock.calls).toEqual([["c"]]);
  });

  it("buffers again after the renderer reloads", () => {
    const deliver = vi.fn();
    const queue = new DeepLinkQueue(deliver);
    queue.markReady();
    queue.markNotReady();

    queue.push("d");
    expect(deliver).not.toHaveBeenCalled();

    queue.markReady();
    expect(deliver.mock.calls).toEqual([["d"]]);
  });

  it("keeps only the most recent links when nobody ever listens", () => {
    const deliver = vi.fn();
    const queue = new DeepLinkQueue(deliver);
    for (let i = 0; i < 50; i += 1) queue.push(String(i));

    queue.markReady();
    expect(deliver).toHaveBeenCalledTimes(20);
    expect(deliver.mock.calls.at(-1)).toEqual(["49"]);
  });
});
