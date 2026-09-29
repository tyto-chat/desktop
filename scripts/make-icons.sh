#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${1:-$ROOT/build/icon.svg}"
TRAY="$ROOT/assets/tray"
mkdir -p "$TRAY"

rsvg-convert -w 1024 -h 1024 "$SOURCE" -o "$ROOT/build/icon.png"

badge() {
  local size="$1" color="$2" out="$3" base="$4"
  local radius=$((size * 3 / 16))
  local ring=$((size / 24))
  local cx=$((size - radius - ring - 1))
  local cy=$((size - radius - ring - 1))
  magick "$base" \
    -fill "#0f1117" -draw "circle $cx,$cy $cx,$((cy - radius - ring))" \
    -fill "$color" -draw "circle $cx,$cy $cx,$((cy - radius))" \
    "$out"
}

for scale in 1 2; do
  size=$((24 * scale))
  suffix=""
  [ "$scale" = "2" ] && suffix="@2x"
  base="$TRAY/idle$suffix.png"
  rsvg-convert -w "$size" -h "$size" "$SOURCE" -o "$base"
  badge "$size" "#a855f7" "$TRAY/unread$suffix.png" "$base"
  badge "$size" "#22c55e" "$TRAY/call$suffix.png" "$base"
  badge "$size" "#ef4444" "$TRAY/call-muted$suffix.png" "$base"
done

echo "Icons written to build/ and assets/tray/"
