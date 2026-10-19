const { readdirSync, readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { join, dirname } = require("node:path");

const TRAY_LABEL_KEYS = [
  "open",
  "mute",
  "unmute",
  "leaveCall",
  "snooze",
  "snooze30",
  "snooze60",
  "snoozeIndefinitely",
  "snoozeOff",
  "presence",
  "presenceOnline",
  "presenceAway",
  "presenceDnd",
  "presenceInvisible",
  "startOnBoot",
  "startMinimized",
  "quit",
  "contextCut",
  "contextCopy",
  "contextPaste",
  "contextSelectAll",
  "contextOpenLink",
  "contextCopyLink",
  "contextCopyImage",
  "contextCopyImageAddress",
  "contextAddToDictionary",
];

const snake = (key) => key.replace(/([A-Z]|\d+)/g, "_$1").toLowerCase();
const clientKey = (key) =>
  key.startsWith("context")
    ? `context_${snake(key.charAt(7).toLowerCase() + key.slice(8))}`
    : `tray_${snake(key)}`;

function extract(localesDir) {
  const bundle = {};
  for (const lang of readdirSync(localesDir).sort()) {
    let catalog;
    try {
      catalog = JSON.parse(readFileSync(join(localesDir, lang, "desktop.json"), "utf8"));
    } catch {
      continue;
    }
    const labels = {};
    for (const key of TRAY_LABEL_KEYS) {
      const value = catalog[clientKey(key)];
      if (typeof value === "string" && value.trim() !== "") labels[key] = value;
    }
    if (Object.keys(labels).length > 0) bundle[lang] = labels;
  }
  const missing = TRAY_LABEL_KEYS.filter((key) => !bundle.en?.[key]);
  if (missing.length > 0) {
    throw new Error(`en/desktop.json lacks tray labels: ${missing.map(clientKey).join(", ")}`);
  }
  return bundle;
}

const [localesDir, outFile] = process.argv.slice(2);
if (!localesDir || !outFile) {
  console.error("usage: node scripts/extract-tray-labels.js <client-src>/src/locales <out.json>");
  process.exit(2);
}
try {
  const bundle = extract(localesDir);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(bundle, null, 2) + "\n");
  console.log(`→ Tray labels for ${Object.keys(bundle).join(", ")} in ${outFile}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
