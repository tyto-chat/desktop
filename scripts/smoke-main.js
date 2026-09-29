const { app } = require("electron");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const TIMEOUT_MS = Number(process.env.TYTO_SMOKE_TIMEOUT_MS ?? 20000);
const report = { windows: [], console: [], failures: [] };

app.commandLine.appendSwitch("ozone-platform", "headless");
app.commandLine.appendSwitch("disable-gpu");
app.setPath("userData", mkdtempSync(join(tmpdir(), "tyto-smoke-")));

function finish(code) {
  console.log(`SMOKE ${JSON.stringify(report)}`);
  app.exit(code);
}

setTimeout(() => {
  report.failures.push("timed out");
  finish(1);
}, TIMEOUT_MS);

app.on("web-contents-created", (_event, contents) => {
  contents.on("console-message", (details) => {
    if (details.level === "error" || details.level === "warning") {
      report.console.push(`${details.level}: ${String(details.message).slice(0, 300)}`);
    }
  });
  contents.on("did-fail-load", (_e, code, description, url) => {
    report.failures.push(`load failed ${code} ${description} ${url}`);
  });
  contents.on("preload-error", (_e, path, error) => {
    report.failures.push(`preload error ${path}: ${error.message}`);
  });
  contents.on("did-finish-load", () => {
    setTimeout(async () => {
      try {
        const probe = await contents.executeJavaScript(`(async () => {
          const bridge = window.__TYTO_PLATFORM__;
          const out = {
            url: location.href,
            origin: location.origin,
            title: document.title,
            bridgeType: typeof bridge,
            bridgeVersion: bridge?.bridgeVersion ?? null,
            members: bridge ? Object.keys(bridge).sort() : [],
            nodeLeak: typeof require !== "undefined" || typeof process !== "undefined",
            text: document.body.innerText.replace(/\\s+/g, " ").slice(0, 200),
            testIds: [...document.querySelectorAll("[data-testid]")].map((e) => e.dataset.testid).slice(0, 12),
          };
          if (bridge) {
            await bridge.secrets.set("smoke", "s3cret");
            out.secretRoundTrip = (await bridge.secrets.get("smoke")) === "s3cret";
            await bridge.secrets.delete("smoke");
            out.secretDeleted = (await bridge.secrets.get("smoke")) === null;
            await bridge.config.set('{"smoke":true}');
            out.configRoundTrip = (await bridge.config.get()) === '{"smoke":true}';
            out.version = await bridge.app.getVersion();
          }
          return out;
        })()`);
        report.windows.push(probe);
      } catch (error) {
        report.failures.push(`probe failed: ${error.message}`);
      }
      finish(report.failures.length === 0 ? 0 : 1);
    }, 4000);
  });
});

require("../app/main/index.js");
