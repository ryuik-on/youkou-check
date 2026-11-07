#!/bin/sh
# 見本の書類（HTML）を PDF にする。Google Chrome が要る
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p pdf
for f in src/*.html; do
  n=$(basename "$f" .html)
  "$CHROME" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="pdf/$n.pdf" "file://$PWD/$f" 2>/dev/null
done
ls pdf
