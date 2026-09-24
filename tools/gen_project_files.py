#!/usr/bin/env python3
"""Generate src/data/projectFiles.ts from the real project files."""
import os, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = "/home/user/AndroidCafeBazaarWebView"

FILES = [
    ("app/build.gradle.kts", "gradle", "kotlin", "App module: compileSdk 35 / target 34, Tapsell + Pushfa dependencies, native-only configuration injection, conditional google-services."),
    ("settings.gradle.kts", "gradle", "kotlin", "Gradle settings: Google / MavenCentral / JitPack repositories."),
    ("gradle.properties", "gradle", "properties", "Build-wide settings plus the native container configuration keys (Tapsell / Pushfa / Firebase)."),
    ("app/src/main/AndroidManifest.xml", "manifest", "xml", "Permissions, notification permission, loopback-only network security config, Pushfa channel/icon metadata and the labzband:// deep-link intent filter."),
    ("app/src/main/java/com/labzband/balochafzar/App.kt", "kotlin", "kotlin", "Application class: Firebase bootstrap, notification channels and native Pushfa push initialization."),
    ("app/src/main/java/com/labzband/balochafzar/MainActivity.kt", "kotlin", "kotlin", "The container: deterministic boot state machine, heavy-WebApp WebView tuning, renderer watchdog + crash recovery, pause/resume/memory events, fullscreen media, back navigation and the native ad plate."),
    ("app/src/main/java/com/labzband/balochafzar/LocalWebServer.kt", "kotlin", "kotlin", "Embedded HTTP/1.1 server on 127.0.0.1: gzip, ETag/304, correct MIME types, SPA history fallback, COOP/COEP headers."),
    ("app/src/main/java/com/labzband/balochafzar/MimeTypes.kt", "kotlin", "kotlin", "MIME table for modern formats (wasm, mjs, webmanifest, fonts, media) with compression heuristics."),
    ("app/src/main/java/com/labzband/balochafzar/WebAppServerController.kt", "kotlin", "kotlin", "Process-wide server owner so the WebView origin – and therefore localStorage / IndexedDB – survives Activity recreation."),
    ("app/src/main/java/com/labzband/balochafzar/WebAppBridge.kt", "kotlin", "kotlin", "window.AndroidBridge: NativeApp.appReady(), getDeviceProfile(), NativeAds.showInterstitial()/showRewarded()/showNative(), billing, plus trusted-origin hardening."),
    ("app/src/main/java/com/labzband/balochafzar/TapsellConfig.kt", "kotlin", "kotlin", "Tapsell app key and ad zones resolved from BuildConfig – never hard-coded, never exposed to JavaScript."),
    ("app/src/main/java/com/labzband/balochafzar/TapsellManager.kt", "kotlin", "kotlin", "Tapsell interstitial / rewarded / native lifecycle with request queueing and total error containment."),
    ("app/src/main/java/com/labzband/balochafzar/PushfaSettings.kt", "kotlin", "kotlin", "Native Pushfa public key and notification channel ids resolved from BuildConfig."),
    ("app/src/main/java/com/labzband/balochafzar/PushfaManager.kt", "kotlin", "kotlin", "Pushfa push: 100% native. SDK init, registration, channels, Android 13+ permission, notification tap -> deep link."),
    ("app/src/main/java/com/labzband/balochafzar/DeepLinkBus.kt", "kotlin", "kotlin", "Buffers push/deep-link routes until the WebApp reports readiness, then hands them to the router."),
    ("app/src/main/java/com/labzband/balochafzar/CafeBazaarBillingManager.kt", "kotlin", "kotlin", "CafeBazaar in-app billing through the official Poolakey SDK."),
    ("app/src/main/res/layout/activity_main.xml", "xml", "xml", "Container layout: WebView host, native ad plate, green-plate loading screen and the fullscreen target."),
    ("app/src/main/res/values/colors.xml", "xml", "xml", "Light green / green plate palette used by the native loading screen."),
    ("app/src/main/res/values/strings.xml", "xml", "xml", "Persian (RTL) strings: «در حال بارگذاری…», boot stages, error/retry copy."),
    ("app/src/main/res/values/themes.xml", "xml", "xml", "Material DayNight theme with green-plate text appearances for the loading screen."),
    ("app/src/main/res/xml/network_security_config.xml", "xml", "xml", "Cleartext HTTP allowed for 127.0.0.1 / localhost only – everything else stays HTTPS."),
    ("app/src/main/assets/web/index.html", "web" if False else "web", "html", "WebApp entry document served over HTTP by the container."),
    ("app/src/main/assets/web/js/native-bridge.js", "web", "javascript", "JavaScript facade: NativeApp.appReady(), NativeAds.* promises that always settle, deep-link handling."),
    ("app/src/main/assets/web/js/app.js", "web", "javascript", "Reference WebApp that verifies ES modules, WebAssembly, IndexedDB, Canvas, WebGL and the local server."),
    ("app/src/main/assets/web/css/style.css", "web", "css", "Green-plate RTL styling for the reference WebApp."),
    ("app/src/main/assets/web/README.md", "doc", "markdown", "Replacing assets/web/ with your own bundle: the appReady() contract and the bridge API."),
    ("app/proguard-rules.pro", "gradle", "proguard", "R8 rules keeping the JS bridge, Poolakey, Tapsell and Pushfa SDK entry points."),
    (".github/workflows/build-apk.yml", "doc", "yaml", "CI: builds debug + release APKs, injects Tapsell/Pushfa/Firebase secrets as native configuration and verifies the packaged SDKs."),
    ("README.md", "doc", "markdown", "Project documentation."),
]

def escape(content: str) -> str:
    return content.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")

out = []
out.append("// AUTO-GENERATED by tools/gen_project_files.ts.py – keeps the in-app file explorer")
out.append("// in sync with the real sources that compile into the APK.")
out.append("import { ProjectFile } from '../types';")
out.append("")
out.append("export const PROJECT_FILES: ProjectFile[] = [")

for path, category, language, description in FILES:
    full = os.path.join(REPO, path)
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
open(os.path.join(REPO, "src/data/projectFiles.ts"), "w", encoding="utf-8").write("\n".join(out))
print("written src/data/projectFiles.ts", len("\n".join(out)), "bytes")
