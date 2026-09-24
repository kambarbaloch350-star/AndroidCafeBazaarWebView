#!/usr/bin/env python3
"""Generate src/data/projectFiles.ts from the real project files.

The in-app file explorer reads `PROJECT_FILES`, the ZIP exporter reads
`ALL_EXPORT_FILES` (`src/data/exportFiles.ts`, which re-uses this file), so both
stay in sync with what actually compiles into the APK: package
`com.chistan.quickgames`, the چیستان‌سرا WebApp bundle and the CI workflow that
builds and delivers it.

Order matters: `src/App.tsx` opens `PROJECT_FILES[5]` on load, which must stay
`MainActivity.kt`.
"""
import glob
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

JAVA = "app/src/main/java/com/chistan/quickgames"

FILES = [
    ("app/build.gradle.kts", "gradle", "kotlin", "App module: compileSdk 35 / target 34, Tapsell + Pushfa dependencies, native-only configuration injection, conditional google-services and the release signing block."),
    ("settings.gradle.kts", "gradle", "kotlin", "Gradle settings: Google / MavenCentral / JitPack repositories."),
    ("gradle.properties", "gradle", "properties", "Build-wide settings plus the native container configuration keys (Tapsell / Pushfa / Firebase)."),
    ("app/src/main/AndroidManifest.xml", "manifest", "xml", "Permissions, notification permission, loopback-only network security config, Pushfa channel/icon metadata and the deep-link intent filter."),
    (f"{JAVA}/App.kt", "kotlin", "kotlin", "Application class: Firebase bootstrap, notification channels and native Pushfa push initialization."),
    (f"{JAVA}/MainActivity.kt", "kotlin", "kotlin", "The container: deterministic boot state machine, heavy-WebApp WebView tuning, renderer watchdog + crash recovery, pause/resume/memory events, fullscreen media, back navigation and the native ad plate."),
    (f"{JAVA}/LocalWebServer.kt", "kotlin", "kotlin", "Embedded HTTP/1.1 server on 127.0.0.1: stable loopback port, gzip, ETag/304, correct MIME types, SPA history fallback, COOP/COEP headers."),
    (f"{JAVA}/MimeTypes.kt", "kotlin", "kotlin", "MIME table for modern formats (wasm, mjs, webmanifest, fonts, media) with compression heuristics."),
    (f"{JAVA}/WebAppServerController.kt", "kotlin", "kotlin", "Process-wide server owner so the WebView origin – and therefore localStorage / IndexedDB – survives Activity recreation."),
    (f"{JAVA}/WebAppBridge.kt", "kotlin", "kotlin", "window.AndroidBridge: NativeApp.appReady()/saveState()/loadState(), device profile, NativeAds.showInterstitial()/showRewarded()/showNative(), CafeBazaar billing, plus trusted-origin hardening."),
    (f"{JAVA}/WebAppStateStore.kt", "kotlin", "kotlin", "Native progress mirror (SharedPreferences) behind NativeApp.saveState()/loadState() – progress survives a force stop."),
    (f"{JAVA}/CompatInjector.kt", "kotlin", "kotlin", "Injects assets/native/compat.js into every HTML document the local server serves (browser APIs a WebView lacks)."),
    ("app/src/main/assets/native/compat.js", "assets", "javascript", "The compat layer: fetch/AbortController, matchMedia, requestIdleCallback, OffscreenCanvas guards – only what the WebView is missing."),
    (f"{JAVA}/TapsellConfig.kt", "kotlin", "kotlin", "Tapsell app key and ad zones resolved from BuildConfig – never hard-coded, never exposed to JavaScript."),
    (f"{JAVA}/TapsellManager.kt", "kotlin", "kotlin", "Tapsell interstitial / rewarded / native lifecycle with request queueing, every event forwarded to the WebApp and total error containment."),
    (f"{JAVA}/PushfaSettings.kt", "kotlin", "kotlin", "Native Pushfa public key and notification channel ids resolved from BuildConfig."),
    (f"{JAVA}/PushfaManager.kt", "kotlin", "kotlin", "Pushfa push: 100% native. SDK init, registration, channels, Android 13+ permission, notification tap -> deep link."),
    (f"{JAVA}/GameNotificationManager.kt", "kotlin", "kotlin", "Local notifications (daily-reward reminder) posted natively."),
    (f"{JAVA}/DeepLinkBus.kt", "kotlin", "kotlin", "Buffers push/deep-link routes until the WebApp reports readiness, then hands them to the router."),
    (f"{JAVA}/CafeBazaarBillingManager.kt", "kotlin", "kotlin", "CafeBazaar in-app billing through the official Poolakey SDK: connect, purchase, consume (consumables only) and the owned-products mirror."),
    (f"{JAVA}/CafeBazaarConfig.kt", "kotlin", "kotlin", "The product catalogue (coin packs + the permanent remove_ads unlock) and the Poolakey security-check configuration."),
    (f"{JAVA}/BillingResult.kt", "kotlin", "kotlin", "The JSON payloads the WebApp receives: purchase, consume, connection and query-purchases results."),
    (f"{JAVA}/ContainerWebView.kt", "kotlin", "kotlin", "The WebView subclass: media/fullscreen handling, safe browsing policy and renderer diagnostics."),
    (f"{JAVA}/LoadingBarView.kt", "kotlin", "kotlin", "Native loading plate / progress view shown until the WebApp calls NativeApp.appReady()."),
    (f"{JAVA}/ShimmerTextView.kt", "kotlin", "kotlin", "Shimmer used by the boot screen."),
    (f"{JAVA}/ExitConfirmationDialog.kt", "kotlin", "kotlin", "The exit dialog (and its double-back handling)."),
    (f"{JAVA}/WebAssetSource.kt", "kotlin", "kotlin", "Index of the packaged web assets (needed because the APK is a zip, not a directory)."),
    ("app/src/main/res/layout/activity_main.xml", "xml", "xml", "Container layout: WebView host, native ad plate, loading screen and the fullscreen target."),
    ("app/src/main/res/layout/dialog_exit.xml", "xml", "xml", "Exit-confirmation dialog layout."),
    ("app/src/main/res/values/colors.xml", "xml", "xml", "Light green / green plate palette used by the native loading screen."),
    ("app/src/main/res/values/strings.xml", "xml", "xml", "Persian (RTL) strings: «در حال بارگذاری…», boot stages, error/retry copy."),
    ("app/src/main/res/values/themes.xml", "xml", "xml", "Material DayNight theme with green-plate text appearances for the loading screen."),
    ("app/src/main/res/xml/network_security_config.xml", "xml", "xml", "Cleartext HTTP allowed for 127.0.0.1 / localhost only – everything else stays HTTPS."),
    ("app/src/main/assets/web/index.html", "web", "html", "WebApp entry document served over HTTP by the container; loads the built game chunk and native-bridge.js."),
    ("app/src/main/assets/web/native-bridge.js", "web", "javascript", "The only consumer of window.AndroidBridge: promise facade over NativeApp / NativeAds / CafeBazaar, the save mirror, the interstitial cadence and the appReady() handshake."),
    ("app/proguard-rules.pro", "gradle", "proguard", "R8 rules keeping the JS bridge, Poolakey, Tapsell and Pushfa SDK entry points."),
    ("tools/game-patches/apply_chistan_patches.py", "doc", "python", "The anchored patches applied to the built game chunk (fair economy, toman store, billing, ad cadence, coin credits) – idempotent and covered by the jsdom contract tests."),
    ("tools/send_apk_telegram.sh", "doc", "bash", "CI delivery: uploads the signed release APK to the owner's Telegram chat (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)."),
    (".github/workflows/build-apk.yml", "doc", "yaml", "CI: builds the release APK, verifies its contents, delivers it to Telegram (never an artifact upload) and runs the jsdom WebApp contract."),
    ("README.md", "doc", "markdown", "Setup, native configuration, CI secrets and the WebApp bridge contract."),
]

# The Vite build re-hashes its chunks (`index-<hash>.js/.css`); the explorer
# shows the chunk that is actually packaged, whatever its current hash is.
GENERATED_WEB = [
    ("app/src/main/assets/web/assets/index-*.js", "web", "javascript",
     "The built چیستان‌سرا game (Vite chunk): React UI, economy, store and the calls into native-bridge.js. Patched by tools/game-patches/apply_chistan_patches.py."),
    ("app/src/main/assets/web/assets/index-*.css", "web", "css",
     "The game stylesheet (Vazirmatn faces, RTL layout) packaged next to the chunk."),
]


def expand(pattern):
    matches = sorted(glob.glob(os.path.join(ROOT, pattern)))
    if not matches:
        raise SystemExit(f"missing file: {pattern}")
    return [os.path.relpath(path, ROOT) for path in matches]


def escape(content: str) -> str:
    return content.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")


entries = list(FILES)
for pattern, category, language, description in GENERATED_WEB:
    for path in expand(pattern):
        entries.append((path, category, language, description))

out = []
out.append("// AUTO-GENERATED by tools/gen_project_files.py – keeps the in-app file explorer")
out.append("// in sync with the real sources that compile into the APK.")
out.append("import { ProjectFile } from '../types';")
out.append("")
out.append("export const PROJECT_FILES: ProjectFile[] = [")

for path, category, language, description in entries:
    full = os.path.join(ROOT, path)
    if not os.path.isfile(full):
        raise SystemExit(f"missing file: {path}")
    content = open(full, encoding="utf-8").read()
    name = os.path.basename(path)
    out.append("  {")
    out.append(f"    path: {json.dumps(path)},")
    out.append(f"    name: {json.dumps(name)},")
    out.append(f"    category: {json.dumps(category)},")
    out.append(f"    language: {json.dumps(language)},")
    out.append(f"    description: {json.dumps(description)},")
    out.append("    content: `" + escape(content) + "`")
    out.append("  },")

out.append("];")
out.append("")
text = "\n".join(out)
with open(os.path.join(ROOT, "src/data/projectFiles.ts"), "w", encoding="utf-8") as fh:
    fh.write(text)
print(f"written src/data/projectFiles.ts ({len(entries)} files, {len(text):,} bytes)")
