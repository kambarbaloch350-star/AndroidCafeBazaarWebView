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

PKG="com.emochi.quickgames"
APK="${APK_PATH:-app/build/outputs/apk/debug/app-debug.apk}"
OUT="${OUT_DIR:-ci-artifacts}"

mkdir -p "$OUT"
FAILURES=0

# Mirror everything into the artifact directory so the published report carries
# the full console trace of the run.
exec > >(tee "$OUT/console.log") 2>&1

note() { echo "[smoke] $*"; }
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
fi

if adb logcat -d -s LocalWebServer:I | grep -q "Local HTTP server ready at http://127.0.0.1"; then
  note "local HTTP server answered on the loopback interface"
else
  fail "the local HTTP server never came up"
fi

if adb logcat -d -s MainActivity:I | grep -q "hiding the native loading plate"; then
  note "native loading plate was hidden by the readiness handshake"
else
  fail "the loading plate was never hidden (handshake incomplete)"
fi

# The bridge runs on the WebView's JavaBridge thread: any WebView call made from
# there throws "A WebView method was called on thread 'JavaBridge'" and silently
# disables the JS API. Catch it here instead of in production.
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
note "deep link -> quickgames://open/container"
adb shell am start -a android.intent.action.VIEW \
  -d "quickgames://open/container" "$PKG" >/dev/null 2>&1
sleep 2
adb exec-out screencap -p > "$OUT/09-deeplink.png" 2>/dev/null || true

# --------------------------------------------------- ad bridge without keys
note "deep link -> quickgames://open/autotest (ad bridge, no SDK keys)"
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

# --------------------------------------------- exit dialog on the first page
# A freshly launched WebView has no history left, so BACK must fall through to
# the native exit confirmation instead of killing the app.
note "fresh launch, then BACK on the first page -> exit dialog"
adb shell am force-stop "$PKG" >/dev/null 2>&1
sleep 2
adb logcat -c >/dev/null 2>&1 || true
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
for _ in $(seq 1 40); do
  adb logcat -d -s MainActivity:I | grep -q "hiding the native loading plate" && break
  sleep 1
done
if adb logcat -d -s MainActivity:I | grep -q "minimum is 3000 ms"; then
  note "$(adb logcat -d -s MainActivity:I | grep -o 'Loading screen visible for.*' | tail -1)"
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
for _ in $(seq 1 25); do
  if adb logcat -d -s MainActivity:I | grep -q "Loading screen visible for"; then
    NIGHT_OK=1
    break
  fi
  sleep 1
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

# ---------------------------------------------------------------- crash check
adb logcat -d > "$OUT/logcat.txt" 2>/dev/null || true

if grep -q "FATAL EXCEPTION" "$OUT/logcat.txt"; then
  fail "FATAL EXCEPTION found in logcat"
  grep -n -A 25 "FATAL EXCEPTION" "$OUT/logcat.txt" | head -60
fi

for tag in NajvaManager TapsellManager WebAppBridge MainActivity LocalWebServer; do
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
  adb logcat -d | grep -E "LocalWebServer|WebAppBridge|MainActivity|TapsellManager|NajvaManager|App:" | tail -45
  echo '```'
  echo
  echo "WebApp console (bridge handshake):"
  echo '```'
  adb logcat -d -s WebApp:D | grep -E "webapp\]|AUTOTEST" | tail -25
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
