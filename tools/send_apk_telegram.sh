#!/usr/bin/env bash
#
# Delivers a built APK to a Telegram chat through a bot.
#
# CI uses this instead of uploading the APK as a build artifact: the owner gets
# the installable file straight in Telegram, with the commit, the version and
# the SHA-256 in the caption.
#
# Required environment:
#   TELEGRAM_BOT_TOKEN   token of the bot (BotFather -> /newbot or /token)
#   TELEGRAM_CHAT_ID     numeric id of the chat/channel (or @channelusername)
# Optional:
#   TELEGRAM_MESSAGE_THREAD_ID   topic id inside a forum group
#   TELEGRAM_DISABLE_NOTIFICATION=1   send silently
#
# Usage:
#   tools/send_apk_telegram.sh <apk> [caption-extra]
#
# Exit codes:
#   0  delivered
#   1  delivery failed (API error, network)
#   2  configuration missing (no token / chat id)
#   3  the APK is too large for the Bot API (50 MB document limit)
set -uo pipefail

APK="${1:-}"
EXTRA="${2:-}"
MAX_BYTES=$((50 * 1024 * 1024 - 1024 * 1024)) # Bot API document limit is 50 MB

note() { echo "[telegram] $*"; }
fail() { echo "[telegram][FAIL] $*"; echo "::error::$*"; }

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  note "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are not set"
  exit 2
fi
if [ -z "$APK" ] || [ ! -f "$APK" ]; then
  fail "APK not found: ${APK:-<empty>}"
  exit 1
fi

SIZE=$(wc -c < "$APK" | tr -d ' ')
SIZE_MB=$(awk -v b="$SIZE" 'BEGIN { printf "%.1f", b / 1048576 }')
if [ "$SIZE" -gt "$MAX_BYTES" ]; then
  fail "$(basename "$APK") is ${SIZE_MB} MB – the Telegram Bot API only accepts documents up to 50 MB"
  exit 3
fi

CAPTION="${EXTRA:+$EXTRA$'\n'}"
CAPTION+="$(basename "$APK") · ${SIZE_MB} MB"
if [ -n "${GITHUB_SHA:-}" ]; then
  CAPTION+=$'\n'"commit ${GITHUB_SHA:0:7} (${GITHUB_REF_NAME:-?})"
fi
if [ -n "${GITHUB_RUN_NUMBER:-}" ]; then
  CAPTION+=$'\n'"build #${GITHUB_RUN_NUMBER}"
fi

SHA=$( (sha256sum "$APK" 2>/dev/null || shasum -a 256 "$APK") | cut -d' ' -f1)
CAPTION+=$'\n'"sha256 ${SHA:0:16}…"

# Who are we? (also proves the token is valid before uploading megabytes)
ME=$(curl -sS --max-time 30 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" || true)
if ! printf '%s' "$ME" | grep -q '"ok":true'; then
  fail "the Telegram bot token was rejected: $(printf '%s' "$ME" | head -c 300)"
  exit 1
fi
note "bot: $(printf '%s' "$ME" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')"

ARGS=(
  -sS --fail-with-body --retry 3 --retry-all-errors --max-time 600
  -F "chat_id=${TELEGRAM_CHAT_ID}"
  -F "document=@${APK}"
  -F "caption=${CAPTION}"
)
[ -n "${TELEGRAM_MESSAGE_THREAD_ID:-}" ] && ARGS+=(-F "message_thread_id=${TELEGRAM_MESSAGE_THREAD_ID}")
[ "${TELEGRAM_DISABLE_NOTIFICATION:-}" = "1" ] && ARGS+=(-F "disable_notification=true")

RESPONSE=$(curl "${ARGS[@]}" \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument" || true)
if ! printf '%s' "$RESPONSE" | grep -q '"ok":true'; then
  fail "sendDocument failed: $(printf '%s' "$RESPONSE" | head -c 400)"
  exit 1
fi

note "delivered $(basename "$APK") (${SIZE_MB} MB) to chat ${TELEGRAM_CHAT_ID}"
exit 0
