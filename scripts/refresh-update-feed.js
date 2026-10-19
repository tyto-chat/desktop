const fs = require("fs");
const path = require("path");
const { buildBlockMap } = require("app-builder-lib/out/targets/blockmap/blockmap.js");

const installer = process.argv[2];
if (!installer || !fs.existsSync(installer)) {
  console.error("usage: node scripts/refresh-update-feed.js dist/<installer>.exe");
  process.exit(2);
}

const replaceAll = (text, pattern, replacement) => {
  const matches = text.match(pattern);
  if (!matches) throw new Error(`${pattern} not found in latest.yml`);
  return text.replace(pattern, replacement);
};

(async () => {
  const name = path.basename(installer);
  const feedPath = path.join(path.dirname(installer), "latest.yml");
  const feed = fs.readFileSync(feedPath, "utf8");
  const urls = feed.match(/^\s*(?:- url|path): (.+)$/gm) ?? [];
  const foreign = urls.filter((line) => !line.endsWith(` ${name}`));
  if (urls.length === 0 || foreign.length > 0) {
    throw new Error(`latest.yml does not describe only ${name}: ${urls.join(", ")}`);
  }

  const { sha512, size } = await buildBlockMap(installer, "gzip", `${installer}.blockmap`);
  let updated = replaceAll(feed, /^(\s*sha512: ).+$/gm, `$1${sha512}`);
  updated = replaceAll(updated, /^(\s*size: ).+$/gm, `$1${size}`);
  fs.writeFileSync(feedPath, updated);
  console.log(
    `${name}: ${size} bytes, sha512 ${sha512.slice(0, 12)}…, blockmap and latest.yml refreshed`,
  );
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
