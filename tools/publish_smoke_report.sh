#!/usr/bin/env bash
#
# Publishes the emulator smoke test results (report + screenshots) as commit
# comments: build artifacts are not always reachable from the tooling that
# reviews a run, while commit comments are plain text.
#
# Screenshots are downscaled to JPEG and split into <=52k character chunks
# because a single commit comment body is limited to 65536 characters.
set -uo pipefail

SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
REPO="${GITHUB_REPOSITORY:-}"
OUT="${OUT_DIR:-ci-artifacts}"
LIMIT=52000

if [ -z "$REPO" ]; then
  echo "[publish] GITHUB_REPOSITORY is unset – skipping"
  exit 0
fi

post() { # post <body-file>
  if gh api -X POST "repos/$REPO/commits/$SHA/comments" -F "body=@$1" >/dev/null 2>&1; then
    echo "[publish] posted $(basename "$1")"
  else
    echo "[publish][warn] could not post $(basename "$1")"
  fi
}

if [ -f "$OUT/report.md" ]; then
  post "$OUT/report.md"
fi

# Only the most informative frames are published: one comment set per picture,
# and the whole timeline stays in the `emulator-screenshots` artifact.
WANTED="01-boot 03-boot 05-boot 07-running 08-webapp 09-deeplink 10-autotest 11-landscape"
pictures=()
for name in $WANTED; do
  [ -f "$OUT/$name.png" ] && pictures+=("$OUT/$name.png")
done
if [ "${#pictures[@]}" -eq 0 ]; then
  echo "[publish] no screenshots found"
  exit 0
fi

for picture in "${pictures[@]}"; do
  name=$(basename "$picture" .png)
  small="/tmp/$name.jpg"
  if command -v convert >/dev/null 2>&1; then
    convert "$picture" -resize 360x -quality 55 "$small" 2>/dev/null || cp "$picture" "$small"
  else
    cp "$picture" "$small"
  fi

  rm -f /tmp/"$name".part.*
  base64 -w0 "$small" > "/tmp/$name.b64"
  split -b "$LIMIT" -a 3 "/tmp/$name.b64" "/tmp/$name.part."
  parts=(/tmp/"$name".part.*)
  total=${#parts[@]}
  index=0

  for part in "${parts[@]}"; do
    index=$((index + 1))
    body="/tmp/$name.$index.md"
    {
      echo "### screenshot \`$name\` ($index/$total)"
      echo
      if [ "$index" = "1" ]; then
        echo "Downscaled JPEG as base64. ${total} comment(s) – concatenate them in order."
        echo
      fi
      echo '```'
      cat "$part"
      echo
      echo '```'
    } > "$body"
    post "$body"
  done
done

echo "[publish] done"
