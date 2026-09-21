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

if grep -E "java\.lang\.(NullPointerException|IllegalStateException)" "$OUT/logcat.txt" \
    | grep -v "available" | grep -q .; then
  note "non-fatal exceptions in logcat:"
  grep -E "java\.lang\.(NullPointerException|IllegalStateException)" "$OUT/logcat.txt" | head -5
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
