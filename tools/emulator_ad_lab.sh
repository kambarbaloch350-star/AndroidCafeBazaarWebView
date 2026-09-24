#!/usr/bin/env bash
#
# Ad lab driver – runs inside the emulator step of the `adlab` CI job.
#
# The APK was built with `-PSMOKE_TEST_BUILD=true -PSMOKE_TEST_ADS=true`
# (Tapsell on its official test key/zones, push blanked). The game is booted,
# then tools/game-tests/ad_lab.mjs plays it through a real test interstitial
# over the DevTools protocol and records what the container and the page did.
set -uo pipefail

PKG="com.chistan.quickgames"
APK="${APK_PATH:-app/build/outputs/apk/debug/app-debug.apk}"
OUT="${OUT_DIR:-ci-artifacts-adlab}"
mkdir -p "$OUT"
exec > >(tee "$OUT/console.log") 2>&1

note() { echo "[adlab] $*"; }

adb start-server >/dev/null 2>&1 || true
adb wait-for-device
note "waiting for the system to finish booting"
for _ in $(seq 1 120); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 2
done
adb shell input keyevent 82 >/dev/null 2>&1 || true
adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
adb shell settings put global window_animation_scale 0 >/dev/null 2>&1 || true
adb shell settings put global transition_animation_scale 0 >/dev/null 2>&1 || true
adb shell settings put global animator_duration_scale 0 >/dev/null 2>&1 || true
sleep 2

note "device: $(adb shell getprop ro.build.fingerprint | tr -d '\r')"
note "WebView provider: $(adb shell dumpsys webviewupdate 2>/dev/null | grep -m1 -E 'Current WebView package' | tr -d '\r')"

note "installing $APK"
if ! adb install -r -t "$APK"; then
  echo "::error::adb install failed"
  exit 1
fi
adb logcat -c >/dev/null 2>&1 || true

note "launching $PKG"
adb shell am start -n "$PKG/.MainActivity" >/dev/null 2>&1
READY=0
for _ in $(seq 1 60); do
  if adb logcat -d -s WebAppBridge:I MainActivity:I | grep -q "WebApp reported readiness"; then
    READY=1
    break
  fi
  sleep 1
done
adb exec-out screencap -p > "$OUT/30-adlab-boot.png" 2>/dev/null || true
if [ "$READY" != "1" ]; then
  echo "::error::the WebApp never reported readiness – the ad lab cannot start"
  adb logcat -d > "$OUT/logcat-full.txt" 2>/dev/null || true
  # The container mirrors the page's console (and uncaught errors) to logcat with
  # the tag `WebApp`: that is where an unparseable bundle or a thrown bridge call
  # shows up, so print it instead of leaving a bare timeout.
  note "page console / uncaught errors:"
  adb logcat -d -s WebApp:V 2>/dev/null | tail -15 | tr -d '\r' || true
  exit 1
fi
note "WebApp ready; Tapsell init: $(adb logcat -d -s TapsellManager:I TapsellManager:W TapsellManager:E | grep -m3 -iE 'initiali|not configured' | tr -d '\r' | tr '\n' ' ')"

STATUS=0
if ! node tools/game-tests/ad_lab.mjs --pkg "$PKG" --out "$OUT" 2>&1 | tee "$OUT/adlab.log"; then
  STATUS=1
fi

adb logcat -d > "$OUT/logcat-full.txt" 2>/dev/null || true
adb exec-out screencap -p > "$OUT/36-adlab-final.png" 2>/dev/null || true
note "finished with status $STATUS (report: $OUT/report.md)"
exit $STATUS
