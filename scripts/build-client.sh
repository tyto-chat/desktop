#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="$(tr -d '[:space:]' < "$ROOT/client-ref")"
REPO="${TYTO_CLIENT_REPO:-https://github.com/tyto-chat/client.git}"
SRC="${TYTO_CLIENT_DIR:-}"
WORK="$ROOT/.client-build"
OUT="$ROOT/app/renderer"

if [ -z "$REF" ]; then
  echo "client-ref is empty" >&2
  exit 1
fi

if [ -n "$SRC" ]; then
  echo "→ Using the client checkout at $SRC (client-ref $REF is NOT applied)"
  WORK="$SRC"
else
  echo "→ Fetching tyto-chat/client at $REF"
  rm -rf "$WORK"
  git init -q "$WORK"
  git -C "$WORK" remote add origin "$REPO"
  git -C "$WORK" fetch -q --depth 1 origin "$REF"
  git -C "$WORK" checkout -q FETCH_HEAD
fi

echo "→ Installing client dependencies"
(cd "$WORK" && npm ci)

echo "→ Building the client in desktop mode"
(cd "$WORK" && VITE_APP_MODE=desktop npm run build)

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$WORK/dist/." "$OUT/"
git -C "$WORK" rev-parse HEAD > "$OUT/.client-commit"

echo "→ Renderer ready in app/renderer ($(cat "$OUT/.client-commit"))"
