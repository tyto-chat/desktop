#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../mls-engine"
if command -v wasm-pack >/dev/null 2>&1; then
  wasm-pack build --release --target nodejs --out-dir pkg --no-pack
  exit 0
fi
docker build -q -t tyto-mls-build . >/dev/null
docker run --rm -e HOME=/tmp \
  -v tyto-mls-cargo:/usr/local/cargo/registry -v tyto-mls-target:/work/target -v "$PWD":/work \
  tyto-mls-build sh -c "wasm-pack build --release --target nodejs --out-dir pkg --no-pack && chown -R $(id -u):$(id -g) pkg"
