#!/usr/bin/env bash
# Rebuilds every PNG icon used by the PWA + native shells from the
# single source-of-truth icon.svg. Prefers rsvg-convert / inkscape when
# installed (fastest), otherwise falls back to the Node generator
# (scripts/generate-icons.js) which uses @resvg/resvg-js — install once
# via `cd scripts && npm install`.
#
# Usage:
#     ./scripts/generate-icons.sh

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SRC="$ROOT/icon.svg"
OUT="$ROOT/icons"
mkdir -p "$OUT"

declare -a SIZES=(
  "192 icon-192.png"
  "512 icon-512.png"
  "180 apple-touch-icon-180.png"
)

if command -v rsvg-convert >/dev/null 2>&1; then
  echo "[icons] using rsvg-convert"
  for entry in "${SIZES[@]}"; do
    read -r size name <<<"$entry"
    rsvg-convert -w "$size" -h "$size" "$SRC" -o "$OUT/$name"
    echo "  wrote $OUT/$name"
  done
  rsvg-convert -w 512 -h 512 "$SRC" -o "$OUT/icon-maskable-512.png"
  echo "  wrote $OUT/icon-maskable-512.png (plain; edit SVG for maskable variant)"
elif command -v inkscape >/dev/null 2>&1; then
  echo "[icons] using inkscape"
  for entry in "${SIZES[@]}"; do
    read -r size name <<<"$entry"
    inkscape "$SRC" --export-type=png --export-filename="$OUT/$name" \
      --export-width="$size" --export-height="$size"
  done
  inkscape "$SRC" --export-type=png --export-filename="$OUT/icon-maskable-512.png" \
    --export-width=512 --export-height=512
else
  echo "[icons] rsvg-convert / inkscape not found — using Node + @resvg/resvg-js"
  if [ ! -d "$HERE/node_modules/@resvg/resvg-js" ]; then
    echo "[icons] Dependencies missing. Running: cd scripts && npm install"
    (cd "$HERE" && npm install --no-audit --no-fund)
  fi
  node "$HERE/generate-icons.js" "$SRC" "$OUT"
fi

echo "[icons] done"
