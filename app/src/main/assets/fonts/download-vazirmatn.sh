#!/usr/bin/env bash
set -euo pipefail
BASE="https://github.com/rastikerdar/vazirmatn/raw/refs/tags/v33.003/fonts/webfonts"
DIR="$(cd "$(dirname "$0")" && pwd)"
for pair in 400-Regular 500-Medium 600-SemiBold 700-Bold 800-ExtraBold 900-Black; do
  curl -L --fail --retry 3 -o "$DIR/Vazirmatn-$pair.woff2" "$BASE/Vazirmatn-$pair.woff2"
done
printf 'Downloaded Vazirmatn 400,500,600,700,800,900 into %s\n' "$DIR"
