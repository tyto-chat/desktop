#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${1:-$ROOT/build/icon.svg}"
TRAY="$ROOT/assets/tray"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$TRAY"

rsvg-convert -w 1024 -h 1024 "$SOURCE" -o "$ROOT/build/icon.png"

tinted() {
  local color="$1" out="$2"
  sed "s/fill=\"url(#nebula)\"/fill=\"$color\"/g" "$SOURCE" > "$out"
}

render() {
  local state="$1" svg="$2"
  rsvg-convert -w 24 -h 24 "$svg" -o "$TRAY/$state.png"
  rsvg-convert -w 48 -h 48 "$svg" -o "$TRAY/$state@2x.png"
}

render idle "$SOURCE"

tinted "#ef4444" "$WORK/unread.svg"
render unread "$WORK/unread.svg"

tinted "#22c55e" "$WORK/call.svg"
render call "$WORK/call.svg"

tinted "#f59e0b" "$WORK/call-muted.svg"
render call-muted "$WORK/call-muted.svg"

echo "Icons written to build/ and assets/tray/"
