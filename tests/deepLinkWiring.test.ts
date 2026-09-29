import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { DeepLinkQueue } from "../src/main/deepLinks";
import { rearmQueueOnNavigation, wireDeepLinks } from "../src/main/deepLinkWiring";

function fakeApp() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { setAsDefaultProtocolClient: vi.fn() });
}

describe("wireDeepLinks", () => {
  it("listens for links as soon as it is called, before the app is ready", () => {
    const app = fakeApp();
    const onLink = vi.fn();

    wireDeepLinks(app, onLink, []);
    app.emit("open-url", { preventDefault: vi.fn() }, "tyto://open?url=https://srv.example/");

    expect(onLink).toHaveBeenCalledWith("https://srv.example/");
  });

  it("claims the link so the OS does not handle it again", () => {
    const app = fakeApp();
    const preventDefault = vi.fn();

    wireDeepLinks(app, vi.fn(), []);
    app.emit("open-url", { preventDefault }, "tyto://open?url=https://srv.example/");

    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it("picks up the link the app was launched with", () => {
    const onLink = vi.fn();
    wireDeepLinks(fakeApp(), onLink, ["/opt/tyto", "tyto://open?url=https://srv.example/m/1"]);
    expect(onLink).toHaveBeenCalledWith("https://srv.example/m/1");
  });

  it("picks up the link passed to a second launch", () => {
    const app = fakeApp();
    const onLink = vi.fn();

    wireDeepLinks(app, onLink, []);
    app.emit("second-instance", {}, ["/opt/tyto", "tyto://open?url=https://srv.example/"]);

    expect(onLink).toHaveBeenCalledWith("https://srv.example/");
  });

  it("ignores links it cannot accept", () => {
    const app = fakeApp();
    const onLink = vi.fn();

    wireDeepLinks(app, onLink, ["tyto://open?url=http://srv.example/"]);
    app.emit("open-url", { preventDefault: vi.fn() }, "tyto://open?url=javascript:alert(1)");
    app.emit("second-instance", {}, ["--flag"]);

    expect(onLink).not.toHaveBeenCalled();
  });

  it("registers the protocol", () => {
    const app = fakeApp();
    wireDeepLinks(app, vi.fn(), []);
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledTimes(1);
    expect(app.setAsDefaultProtocolClient.mock.calls[0]![0]).toBe("tyto");
  });
});

describe("rearmQueueOnNavigation", () => {
  function setup() {
    const deliver = vi.fn();
    const queue = new DeepLinkQueue(deliver);
    const contents = new EventEmitter();
    rearmQueueOnNavigation(contents, queue);
    queue.markReady();
    return { deliver, queue, contents };
  }

  it("keeps delivering when a navigation starts but is cancelled", () => {
    const { deliver, queue, contents } = setup();

    contents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    contents.emit("will-navigate", { preventDefault: vi.fn() }, "https://files.example/a.png");
    queue.push("a");

    expect(deliver).toHaveBeenCalledWith("a");
  });

  it("buffers again once the page has actually been replaced", () => {
    const { deliver, queue, contents } = setup();

    contents.emit("did-navigate", {}, "app://tyto/");
    queue.push("b");
    expect(deliver).not.toHaveBeenCalled();

    queue.markReady();
    expect(deliver).toHaveBeenCalledWith("b");
  });

  it("keeps delivering across in-page route changes", () => {
    const { deliver, queue, contents } = setup();

    contents.emit("did-navigate-in-page", {}, "app://tyto/dm/1", true);
    queue.push("c");

    expect(deliver).toHaveBeenCalledWith("c");
  });

  it("buffers again when the renderer process dies", () => {
    const { deliver, queue, contents } = setup();

    contents.emit("render-process-gone", {}, { reason: "crashed" });
    queue.push("d");

    expect(deliver).not.toHaveBeenCalled();
  });
});
