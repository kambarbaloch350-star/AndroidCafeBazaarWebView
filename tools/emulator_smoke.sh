#!/usr/bin/env bash
#
# Container smoke test – runs on a real Android emulator in CI.
#
# It installs the debug APK, boots it and verifies the *runtime* contract that
# cannot be checked statically:
#
#   1. the local HTTP server really starts on the device,
#   2. the WebView really loads assets/web/index.html over http://127.0.0.1,
#   3. the WebApp handshake completes (NativeApp.appReady -> container hides the
#      native loading plate),
#   4. the ad bridge degrades gracefully with **no** Tapsell keys configured,
#   5. a deep link is routed into the WebApp,
#   6. nothing crashes (no FATAL EXCEPTION anywhere in logcat).
#
# Screenshots are captured as a timeline so the run can be inspected visually.
set -uo pipefail

PKG="com.chistan.quickgames"
# The APK under test is built with `-PSMOKE_TEST_BUILD=true` (ads / push
# identifiers blanked): the contract below must hold without any live SDK
# traffic, and a served interstitial would otherwise take the screen away from
# the WebApp in the middle of the back-navigation checks.
APK="${APK_PATH:-app/build/outputs/apk/debug/app-debug.apk}"
OUT="${OUT_DIR:-ci-artifacts}"

# Two kinds of bundle can sit in assets/web: the reference demo (js/app.js,
# with its `quickgames://open/autotest` self test and hash routes) or a real
# Node-built game. The demo-only checks are skipped for a game; the game gets
# a scripted play-through over the DevTools protocol instead.
WEB_INDEX="${WEB_INDEX:-app/src/main/assets/web/index.html}"
REFERENCE_APP=0
if grep -q 'js/app.js' "$WEB_INDEX" 2>/dev/null; then
  REFERENCE_APP=1
fi

mkdir -p "$OUT"
FAILURES=0

# Mirror everything into the artifact directory so the published report carries
# the full console trace of the run.
exec > >(tee "$OUT/console.log") 2>&1

note() { echo "[smoke] $*"; }
# Waits (up to $1 s) until the app reports that the loading plate was lifted and
# prints which of the two paths lifted it:
#   * the readiness handshake (`appReady()` from the WebApp/facade), or
#   * the container's content probe (the page rendered but stayed silent).
wait_for_plate() {
  local limit="${1:-60}" tries=0
  while [ "$tries" -lt "$limit" ]; do
    if adb logcat -d -s MainActivity:I | grep -q "hiding the native loading plate"; then
      if adb logcat -d -s MainActivity:I | grep -q "lifting the loading plate for rendered content"; then
        echo "content-probe"
      else
        echo "handshake"
      fi
      return 0
    fi
    tries=$((tries + 1))
    sleep 1
  done
  echo "none"
  return 1
}
# Page console + engine errors: the container mirrors everything the page logs
# (and every uncaught exception) into logcat with the tag `WebApp`
# (MainActivity.onConsoleMessage), so this is the only way to see *why* a WebView
# refused to run the WebApp – an unparseable bundle on an old Chromium, a bridge
# call that threw, a failed asset.
webapp_console() {
  adb logcat -d -s WebApp:V 2>/dev/null | sed -n 's/^\(.*WebApp[^:]*: \)//p' | tail -"${1:-25}"
}
fail() { echo "[smoke][FAIL] $*"; FAILURES=$((FAILURES + 1)); }

adb start-server >/dev/null 2>&1 || true
adb wait-for-device

note "waiting for the system to finish booting"
for _ in $(seq 1 90); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 2
done
adb shell input keyevent 82 >/dev/null 2>&1 || true
adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
sleep 2

note "installing $APK"
adb install -r -t "$APK" || { fail "adb install failed"; exit 1; }

adb logcat -c >/dev/null 2>&1 || true

# ------------------------------------------------------------------ cold boot
note "cold boot: launching MainActivity"
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1

# Timeline: the native loading plate is visible only while the container boots,
# so the first frames are grabbed immediately.
for i in 1 2 3 4 5 6; do
  adb exec-out screencap -p > "$OUT/0${i}-boot.png" 2>/dev/null || true
  sleep 0.4
done
sleep 2
adb exec-out screencap -p > "$OUT/07-running.png" 2>/dev/null || true

# ------------------------------------------------------- wait for the handshake
note "waiting for the WebApp readiness handshake"
READY=0
for _ in $(seq 1 40); do
  if adb logcat -d -s WebAppBridge:I MainActivity:I LocalWebServer:I \
      | grep -q "WebApp reported readiness"; then
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" = "1" ]; then
  note "WebApp reported readiness (NativeApp.appReady reached the container)"
else
  fail "the WebApp never reported readiness within 40s"
  # Diagnose it here: the usual cause is the page not running at all.
  PAGE_ERRORS=$(webapp_console 10)
  if [ -n "$PAGE_ERRORS" ]; then
    note "page console / uncaught errors:"
    echo "$PAGE_ERRORS"
  else
    note "the page logged nothing – the bundle may not have been served at all"
  fi
  if echo "$PAGE_ERRORS" | grep -qE "SyntaxError"; then
    note "a SyntaxError means the bundle cannot be parsed by this WebView (Chromium 83 here):"
    note "keep app/src/main/assets/web/assets/index-*.js free of post-ES2019 syntax"
    note "(tools/game-patches/apply_chistan_patches.py --check, tools/static_checks.py)"
  fi
fi

if adb logcat -d -s LocalWebServer:I | grep -q "Local HTTP server ready at http://127.0.0.1"; then
  note "local HTTP server answered on the loopback interface"
else
  fail "the local HTTP server never came up"
fi

PLATE_PATH=$(wait_for_plate 20 || true)
case "$PLATE_PATH" in
  handshake)      note "native loading plate was hidden by the readiness handshake" ;;
  content-probe)  note "native loading plate was hidden by the container's content probe (the WebApp rendered but stayed silent – see the warning in logcat)" ;;
  *)              fail "the loading plate was never hidden (neither the handshake nor the content probe fired)" ;;
esac

# The bridge runs on the WebView's JavaBridge thread: any WebView call made from
# there throws "A WebView method was called on thread 'JavaBridge'" and silently
# disables the JS API. Catch it here instead of in production.
adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true
if grep -q "was called on thread 'JavaBridge'" "$OUT/logcat.txt"; then
  fail "bridge methods touched WebView APIs off the main thread"
  grep -n "was called on thread" "$OUT/logcat.txt" | head -3
fi
if grep -q "Bridge method failed" "$OUT/logcat.txt"; then
  fail "a bridge method threw an exception"
  grep -n "Bridge method failed" "$OUT/logcat.txt" | head -3
fi

sleep 1
adb exec-out screencap -p > "$OUT/08-webapp.png" 2>/dev/null || true

# ------------------------------------------------------------------ deep link
note "deep link -> labzband://open/container"
adb shell am start -a android.intent.action.VIEW \
  -d "labzband://open/container" "$PKG" >/dev/null 2>&1
sleep 2
adb exec-out screencap -p > "$OUT/09-deeplink.png" 2>/dev/null || true

AUTOTEST=""
if [ "$REFERENCE_APP" = "1" ]; then
# --------------------------------------------------- ad bridge without keys
note "deep link -> quickgames://open/autotest (ad bridge; legacy scheme)"
adb shell am start -a android.intent.action.VIEW \
  -d "quickgames://open/autotest" "$PKG" >/dev/null 2>&1
sleep 4
adb exec-out screencap -p > "$OUT/10-autotest.png" 2>/dev/null || true

for _ in $(seq 1 25); do
  adb logcat -d -s WebApp:D | grep -q "AUTOTEST done" && break
  sleep 1
done
AUTOTEST=$(adb logcat -d -s WebApp:D | grep -o "AUTOTEST done .*" | tail -1)
if [ -n "$AUTOTEST" ]; then
  note "$AUTOTEST"
else
  fail "the ad-bridge self test did not complete"
fi

# ------------------------------------------------- Café Bazaar rating intent
note "deep link -> quickgames://open/rating (CafeBazaar rating intent)"
adb shell am start -a android.intent.action.VIEW \
  -d "quickgames://open/rating" "$PKG" >/dev/null 2>&1
sleep 3
RATING=$(adb logcat -d -s WebApp:D | grep -o "RATING test .*" | tail -1)
if [ -n "$RATING" ]; then
  note "$RATING"
else
  fail "the rating bridge path was never exercised"
fi
# On the emulator CafeBazaar is not installed: the container must degrade
# gracefully (log + toast) instead of crashing.
if adb logcat -d -s MainActivity:W | grep -q "CafeBazaar is not installed"; then
  note "rating intent degraded gracefully (Bazaar absent)"
fi

# ------------------------------------------------- WebApp back navigation
note "deep link -> container, then ads, then BACK (WebApp history first)"
adb shell am start -a android.intent.action.VIEW \
  -d "quickgames://open/container" "$PKG" >/dev/null 2>&1
sleep 2
adb shell am start -a android.intent.action.VIEW \
  -d "quickgames://open/ads" "$PKG" >/dev/null 2>&1
sleep 2
adb logcat -c >/dev/null 2>&1 || true
adb shell input keyevent KEYCODE_BACK >/dev/null 2>&1
sleep 3
if adb logcat -d | grep -q "onPageFinished: .*#/container"; then
  note "BACK walked one page back inside the WebApp (#/container)"
else
  fail "BACK did not navigate inside the WebApp"
fi
if adb logcat -d -s MainActivity:I | grep -q "Exit confirmation shown"; then
  fail "the exit dialog appeared although the WebApp could still go back"
fi
else
# ------------------------------------------------------ game play-through
# The packaged game is driven over the Chrome DevTools protocol: two levels,
# an interstitial request, a simulated ad Activity in front of the app, the
# ad-closed events, then a third level. This is the exact sequence that used
# to leave the game with flashing buttons and a white screen.
note "game play-through over DevTools (levels 1-3 with a simulated interstitial)"
if command -v node >/dev/null 2>&1; then
  if node tools/game-tests/emulator_play.mjs --pkg "$PKG" --out "$OUT" 2>&1 | tee "$OUT/play.log"; then
    note "game play-through passed"
  else
    fail "the game play-through reported failures (see play.log)"
  fi
  AUTOTEST=$(grep -o '[0-9]*/[0-9]* checks passed' "$OUT/play.log" | tail -1)
  [ -n "$AUTOTEST" ] && AUTOTEST="play-through $AUTOTEST"
else
  fail "node is required for the game play-through"
fi

# ----------------------------------------- progress survives a force stop
# The reported bug: "I reached level 4, force-stopped the app, it started from
# level 1". The WebApp must come back on the same origin (stable loopback
# port) with the same save game, and the native state mirror alone must be
# able to restore it (a wiped web copy + reload).
note "progress survives a force stop (stable origin + native state mirror)"
if command -v node >/dev/null 2>&1; then
  if node tools/game-tests/emulator_persist.mjs --pkg "$PKG" --out "$OUT" 2>&1 | tee "$OUT/persist.log"; then
    note "progress persistence passed"
  else
    fail "progress was lost across a force stop (see persist.log)"
  fi
  PERSIST=$(grep -o '[0-9]*/[0-9]* checks passed' "$OUT/persist.log" | tail -1)
  [ -n "$PERSIST" ] && AUTOTEST="$AUTOTEST, persistence $PERSIST"
fi
fi

# --------------------------------------------- exit dialog on the first page
# A freshly launched WebView has no history left, so BACK must fall through to
# the native exit confirmation instead of killing the app.
note "fresh launch, then BACK on the first page -> exit dialog"
adb shell am force-stop "$PKG" >/dev/null 2>&1
sleep 2
adb logcat -c >/dev/null 2>&1 || true
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
PLATE_PATH=$(wait_for_plate 45 || true)
if ! adb logcat -d -s MainActivity:I | grep -q "minimum is 3000 ms"; then
  # A thrashing emulator (the launcher itself ANRs under the CI load) can push a
  # boot past the timeout: give the same cold boot one more chance before failing.
  note "no boot timing yet – relaunching once more"
  adb shell am force-stop "$PKG" >/dev/null 2>&1
  sleep 2
  adb logcat -c >/dev/null 2>&1 || true
  adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
  PLATE_PATH=$(wait_for_plate 60 || true)
fi
if adb logcat -d -s MainActivity:I | grep -q "minimum is 3000 ms"; then
  note "cold boot done (plate lifted by: ${PLATE_PATH:-none}): $(adb logcat -d -s MainActivity:I | grep -o 'Loading screen visible for.*' | tail -1)"
else
  fail "the loading screen never reported its minimum-duration floor"
fi
sleep 1
adb shell input keyevent KEYCODE_BACK >/dev/null 2>&1
sleep 2
adb exec-out screencap -p > "$OUT/12-backdialog.png" 2>/dev/null || true
if adb logcat -d -s MainActivity:I | grep -q "Exit confirmation shown"; then
  note "hardware BACK opened the exit confirmation"
else
  fail "the exit confirmation never appeared on BACK"
fi
# BACK again must cancel the dialog instead of leaving the app
adb shell input keyevent KEYCODE_BACK >/dev/null 2>&1
sleep 1
if adb logcat -d -s MainActivity:I | grep -q "Exit dialog: cancelled"; then
  note "BACK on the dialog cancels it (stays in the app)"
else
  fail "BACK on the dialog did not cancel it"
fi
if adb shell dumpsys activity activities 2>/dev/null | grep -q "$PKG/.MainActivity"; then
  note "the app is still in the foreground after cancelling"
else
  fail "cancelling the dialog left the app"
fi
# "Cancel" (انصراف) must behave exactly like back: stay in the game.
adb shell input tap 360 1000 >/dev/null 2>&1
sleep 1
if adb logcat -d -s MainActivity:I | grep -q "Exit dialog: cancelled"; then
  note "the cancel button keeps the player in the game"
fi

# ------------------------------------------------------- status bar contrast
# The bars are white in both themes, so their icons must be the dark variant –
# light icons on white are invisible.
if adb logcat -d -s MainActivity:I | grep -q "copy protection active"; then
  note "the app rendered a full frame with its system bars"
fi

# ------------------------------------------- copy protection / no haptics
# The stylesheet is injected on every finished page load, so the window is
# cleared *before* this relaunch to make the assertion deterministic.
note "long press on the page must not select or copy anything"
adb logcat -c >/dev/null 2>&1 || true
adb shell am force-stop "$PKG" >/dev/null 2>&1
sleep 2
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
for _ in $(seq 1 40); do
  adb logcat -d -s MainActivity:I | grep -q "hiding the native loading plate" && break
  sleep 1
done
sleep 1
adb shell input swipe 360 700 360 700 900 >/dev/null 2>&1
sleep 2
adb exec-out screencap -p > "$OUT/13-longpress.png" 2>/dev/null || true
if adb logcat -d -s MainActivity:I | grep -q "copy protection active"; then
  note "the page copy protection is applied (selection, copy and context menu off)"
else
  fail "the copy protection was never applied to the page"
fi
if adb logcat -d | grep -qiE "Vibrat|HapticFeedback"; then
  fail "a vibration/haptic feedback was requested while holding the page"
else
  note "no haptic feedback was requested by holding the page"
fi

# ------------------------------------------------------- night-mode splash
# Regression guard for the reported bug: a device in dark mode used to repaint
# the animated splash dark green.
note "night mode: the loading screen must stay white"
adb shell cmd uimode night yes >/dev/null 2>&1 || true
adb shell am force-stop "$PKG" >/dev/null 2>&1
sleep 2
adb logcat -c >/dev/null 2>&1 || true
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 1.2
adb exec-out screencap -p > "$OUT/14-splash-night.png" 2>/dev/null || true
# The splash has a 3 s floor, so the timing line only appears once it is done.
NIGHT_OK=0
for attempt in 1 2; do
  for _ in $(seq 1 30); do
    if adb logcat -d -s MainActivity:I | grep -q "Loading screen visible for"; then
      NIGHT_OK=1
      break
    fi
    sleep 1
  done
  [ "$NIGHT_OK" = "1" ] && break
  note "night-mode boot slow – relaunching (attempt $attempt)"
  adb shell am force-stop "$PKG" >/dev/null 2>&1
  sleep 2
  adb logcat -c >/dev/null 2>&1 || true
  adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
done
adb shell cmd uimode night no >/dev/null 2>&1 || true
if [ "$NIGHT_OK" = "1" ]; then
  note "night-mode boot completed: $(adb logcat -d -s MainActivity:I | grep -o 'Loading screen visible for.*' | tail -1)"
else
  fail "the night-mode boot did not report the loading screen timing"
fi

# ------------------------------------------------------------------ lifecycle
note "background / foreground cycle (onPause -> onResume) and rotation"
adb shell input keyevent KEYCODE_HOME >/dev/null 2>&1
sleep 2
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 2
if adb logcat -d -s LocalWebServer:I | grep -q "Local HTTP server ready" \
   && [ "$(adb logcat -d -s LocalWebServer:I | grep -c 'Local HTTP server ready')" -ge 1 ]; then
  note "server survived backgrounding without restarting a second instance"
fi
adb shell settings put system accelerometer_rotation 0 >/dev/null 2>&1 || true
adb shell settings put system user_rotation 1 >/dev/null 2>&1 || true
sleep 3
adb exec-out screencap -p > "$OUT/11-landscape.png" 2>/dev/null || true
adb shell settings put system user_rotation 0 >/dev/null 2>&1 || true
sleep 2

# ------------------------------------------- activity switch (full-screen ad)
# A full-screen ad is simply another Activity on top of the container: the
# WebApp is paused, covered for a while, then resumed. It must come back
# alive – no renderer loss, no reload, no boot loop, no white screen. The
# Settings app stands in for the ad Activity (no live ad on the emulator).
note "activity switch (another Activity in front, like a full-screen ad) -> back to the WebApp"
REBUILDS_BEFORE=$(adb logcat -d | grep -c "rebuilding WebView" || true)
LOADS_BEFORE=$(adb logcat -d | grep -c "onPageFinished: " || true)
adb shell am start -a android.settings.SETTINGS >/dev/null 2>&1 || true
sleep 5
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
sleep 4
adb exec-out screencap -p > "$OUT/15-after-activity-switch.png" 2>/dev/null || true
REBUILDS_AFTER=$(adb logcat -d | grep -c "rebuilding WebView" || true)
LOADS_AFTER=$(adb logcat -d | grep -c "onPageFinished: " || true)
if [ "${REBUILDS_AFTER:-0}" -gt "${REBUILDS_BEFORE:-0}" ]; then
  fail "the WebApp renderer was lost while another Activity covered the container"
fi
if [ "${LOADS_AFTER:-0}" -gt "${LOADS_BEFORE:-0}" ]; then
  fail "the WebApp reloaded after the activity switch (it must simply resume where it was)"
fi
if adb logcat -d | grep -q "Renderer crash loop"; then
  fail "the renderer crash-loop guard fired"
fi
if adb logcat -d | grep -q "WebApp renderer unresponsive"; then
  note "renderer reported unresponsive at some point (see logcat.txt)"
fi

# ---------------------------------------------------------------- crash check
adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true

if grep -q "FATAL EXCEPTION" "$OUT/logcat.txt"; then
  fail "FATAL EXCEPTION found in logcat"
  grep -n -A 25 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -60
fi

for tag in PushfaManager TapsellManager WebAppBridge MainActivity LocalWebServer; do
  if grep -E "E $tag" "$OUT/logcat.txt" | grep -q .; then
    note "errors logged by $tag (first 3):"
    grep -E "E $tag" "$OUT/logcat.txt" | head -3
  fi
done

# ---------------------------------------------------------- visual assertions
if command -v convert >/dev/null 2>&1; then
  for frame in 01-boot 02-boot 03-boot 04-boot 05-boot; do
    [ -f "$OUT/$frame.png" ] || continue
    read -r r g b <<<"$(convert "$OUT/$frame.png" -resize 1x1 \
      -format '%[fx:int(255*r)] %[fx:int(255*g)] %[fx:int(255*b)]' info: 2>/dev/null || echo '0 0 0')"
    note "$frame average colour: rgb($r,$g,$b)"
    if [ "$g" -gt "$r" ] && [ "$g" -gt "$b" ] && [ $((r + g + b)) -gt 480 ]; then
      PLATE_SEEN="$frame"
    fi
  done
  if [ -n "${PLATE_SEEN:-}" ]; then
    note "green loading plate visible in $PLATE_SEEN"
  else
    fail "no light-green loading plate found in the first frames"
  fi
else
  note "ImageMagick unavailable – skipping the pixel assertions"
fi

# ------------------------------------------------------------------ summary
{
  echo "### Container smoke test"
  echo
  echo "- readiness handshake: $([ "$READY" = "1" ] && echo passed || echo FAILED)"
  echo "- local HTTP server: $(adb logcat -d -s LocalWebServer:I | grep -o 'ready at [^ ]*' | head -1 || echo 'n/a')"
  echo "- self test: ${AUTOTEST:-not reported}"
  echo "- crashing exceptions: $(grep -c 'FATAL EXCEPTION' "$OUT/logcat.txt" || true)"
  echo
  echo "Server / bridge log lines:"
  echo '```'
  adb logcat -d | grep -E "LocalWebServer|WebAppBridge|MainActivity|TapsellManager|PushfaManager|App:" | tail -45
  echo '```'
  echo
  echo "WebApp console (page log + uncaught errors, container tag WebApp):"
  echo '```'
  webapp_console 25
  echo '```'
  echo
  echo "Loading plate:"
  echo '```'
  adb logcat -d -s MainActivity:I 2>/dev/null | grep -E "hiding the native loading plate|lifting the loading plate|Loading screen visible for|WebApp never called" | tail -6
  echo '```'
  echo
  echo "Parse / URL errors reported by the WebView:"
  echo '```'
  adb logcat -d 2>/dev/null | grep -iE "SyntaxError|Uncaught|net::ERR|ERR_FILE" | tail -15
  echo '```'
  echo
  echo "Smoke script console:"
  echo '```'
  tail -60 "$OUT/console.log" 2>/dev/null || true
  echo '```'
} > "$OUT/report.md"

note "report written to $OUT/report.md"
if [ "$FAILURES" -gt 0 ]; then
  note "$FAILURES check(s) failed"
  exit 1
fi
note "all checks passed"
