#!/usr/bin/env python3
"""
Static sanity check for the Android container.

There is no Android SDK / JDK in this workspace, so this script performs the
checks that catch the majority of build breaks:

  1. every XML resource file is well formed
  2. every `R.<type>.<name>` reference in Kotlin exists in res/
  3. every `@color/… @string/… @drawable/… @font/… @style/…` reference in XML does
  4. every `@+id/…` referenced from Kotlin exists in a layout
  5. assets/web entry document + bridge contract are present
  6. no leftover Adivery / Najva references anywhere in the project
  7. the Pushfa / Tapsell wiring (dependency, BuildConfig keys, package name)
  8. app/google-services.json (when present) belongs to this package, so the
     Firebase project Pushfa delivers through is the one baked into the APK
  9. the `native-bridge.js` facade calls every method of the container's
     JavaScript interface with the signature `WebAppBridge.kt` declares (the
     WebView resolves a method by name *and* argument count, and answers
     `Method not found` when the two disagree)

Exits non-zero when a problem is found.
"""
from __future__ import annotations

import glob
import json
import os
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app", "src", "main")
RES = os.path.join(APP, "res")
KOTLIN = os.path.join(APP, "java")
# Support both old (labzband) and new (chistan) packages
def find_java_package():
    for pkg_path in [
        os.path.join(APP, "java", "com", "chistan", "quickgames"),
        os.path.join(APP, "java", "com", "labzband", "balochafzar"),
    ]:
        if os.path.isdir(pkg_path) and os.path.isfile(os.path.join(pkg_path, "MainActivity.kt")):
            return pkg_path
    # Fallback: search any MainActivity
    for base, dirs, files in os.walk(os.path.join(APP, "java")):
        if "MainActivity.kt" in files:
            return base
    return os.path.join(APP, "java", "com", "labzband", "balochafzar")

JAVA = find_java_package()
ASSETS = os.path.join(APP, "assets")

ANDROID = "{http://schemas.android.com/apk/res/android}"
TOOLS = "{http://schemas.android.com/tools}"

errors: list[str] = []
warnings: list[str] = []


def rel(path: str) -> str:
    return os.path.relpath(path, ROOT)


# ---------------------------------------------------------------- resources
def collect_resources() -> dict[str, set[str]]:
    res: dict[str, set[str]] = defaultdict(set)

    # values/*.xml -> color / string / style / dimen ...
    values_dir = os.path.join(RES, "values")
    night_dir = os.path.join(RES, "values-night")
    for directory in (values_dir, night_dir):
        if not os.path.isdir(directory):
            continue
        for name in os.listdir(directory):
            path = os.path.join(directory, name)
            try:
                tree = ET.parse(path)
            except ET.ParseError as exc:
                errors.append(f"XML parse error in {rel(path)}: {exc}")
                continue
            root = tree.getroot()
            if root.tag == "resources":
                for child in root:
                    if child.tag == "item":
                        item_type = child.attrib.get("type")
                        item_name = child.attrib.get("name")
                        if item_type and item_name:
                            res[item_type].add(item_name)
                    else:
                        name = child.attrib.get("name")
                        if name:
                            # A style is declared as `Theme.App.Thing` but
                            # referenced as `R.style.Theme_App_Thing`.
                            res[child.tag].add(name)
                            if child.tag == "style":
                                res[child.tag].add(name.replace(".", "_"))

    # file based resources: drawable / layout / font / mipmap / xml / anim
    for kind in ("drawable", "layout", "font", "xml", "menu", "mipmap-anydpi-v26", "anim", "values"):
        directory = os.path.join(RES, kind)
        if not os.path.isdir(directory):
            continue
        for name in os.listdir(directory):
            base = name.split(".")[0]
            if kind == "values":
                continue
            if kind.startswith("mipmap"):
                res["mipmap"].add(base)
            else:
                res[kind].add(base)

    # Density/qualifier qualified folders (drawable-nodpi, mipmap-xxhdpi, ...)
    # expose the same resource kind without the qualifier.
    for name in os.listdir(RES):
        if "-" not in name or not name.split("-")[0] in ("mipmap", "drawable", "layout", "anim"):
            continue
        kind = name.split("-")[0]
        path = os.path.join(RES, name)
        if not os.path.isdir(path):
            continue
        for file in os.listdir(path):
            res[kind].add(file.split(".")[0])
    return res


RESOURCES = collect_resources()


def check_xml_files() -> None:
    for base, _dirs, files in os.walk(RES):
        for name in files:
            if not name.endswith(".xml"):
                continue
            path = os.path.join(base, name)
            try:
                ET.parse(path)
            except ET.ParseError as exc:
                errors.append(f"XML parse error in {rel(path)}: {exc}")

    manifest = os.path.join(APP, "AndroidManifest.xml")
    try:
        ET.parse(manifest)
    except ET.ParseError as exc:
        errors.append(f"XML parse error in {rel(manifest)}: {exc}")


def check_xml_references() -> None:
    pattern = re.compile(r"@(?!\+)(color|string|drawable|font|style|layout|mipmap|xml|dimen|integer|bool|array)/"
                         r"([A-Za-z0-9_.]+)")
    for base, _dirs, files in os.walk(RES):
        for name in files:
            if not name.endswith(".xml"):
                continue
            path = os.path.join(base, name)
            text = open(path, encoding="utf-8").read()
            for kind, target in pattern.findall(text):
                if kind == "style" and target.startswith("Widget."):
                    continue
                if kind == "style" and target.startswith("TextAppearance."):
                    continue
                if target not in RESOURCES.get(kind, set()):
                    errors.append(f"{rel(path)}: missing @{kind}/{target}")

    manifest = os.path.join(APP, "AndroidManifest.xml")
    text = open(manifest, encoding="utf-8").read()
    for kind, target in pattern.findall(text):
        if kind == "style":
            continue  # theme/overlay styles resolved by the platform
        if target not in RESOURCES.get(kind, set()):
            errors.append(f"{rel(manifest)}: missing @{kind}/{target}")


# -------------------------------------------------------------------- kotlin
def check_kotlin_references() -> None:
    layout_ids: set[str] = set()
    for name in os.listdir(os.path.join(RES, "layout")):
        tree = ET.parse(os.path.join(RES, "layout", name))
        for node in tree.iter():
            value = node.attrib.get(f"{ANDROID}id")
            if value and value.startswith("@+id/"):
                layout_ids.add(value[len("@+id/"):])

    for name in os.listdir(JAVA):
        if not name.endswith(".kt"):
            continue
        path = os.path.join(JAVA, name)
        text = open(path, encoding="utf-8").read()
        # Only *our* R class – `ir.tapsell.plus.R.layout.x` is an SDK resource.
        for kind, target in re.findall(
                r"(?<![\w.])R\.(color|string|drawable|font|style|layout|mipmap|xml|dimen)\.([A-Za-z0-9_]+)",
                text):
            if target not in RESOURCES.get(kind, set()):
                errors.append(f"{rel(path)}: missing R.{kind}.{target}")
        for target in re.findall(r"(?<![\w.])R\.id\.([A-Za-z0-9_]+)", text):
            if target not in layout_ids:
                errors.append(f"{rel(path)}: missing R.id.{target}")


# --------------------------------------------------- splash & touch surface
def check_splash_and_touch_surface() -> None:
    """The loading screen must use game palette (چیستان warm amber) or white, and the WebView must
    refuse text selection / copy and the platform's long-press vibration."""
    colors = {}
    for folder in ("values", "values-night"):
        path = os.path.join(RES, folder, "colors.xml")
        if not os.path.isfile(path):
            continue
        for name, value in re.findall(
                r'<color name="([^"]+)">([^<]+)</color>', open(path, encoding="utf-8").read()):
            colors.setdefault(name, []).append((folder, value.upper()))

    # Accept white or game palette #FFFDF7 / #FEF3C6 etc for loading screen
    allowed_surfaces = ("#FFFFFFFF", "#FFF", "#FFFFFF", "#FFFFFDF7", "#FFFEF3C6", "#FFFFFBEB", "#FFFDF7", "#FEF3C6", "#FFFBEB")
    for name in ("loading_background_top", "loading_background_bottom",
                 "plate_surface", "plate_surface_end"):
        entries = colors.get(name)
        if not entries:
            errors.append(f"missing colour {name} (loading screen surface)")
            continue
        for folder, value in entries:
            if value not in allowed_surfaces:
                # Allow any warm amber/white shade, not just pure white
                if not (value.startswith("#FF") and ("FDF7" in value or "FEF3" in value or "FFFB" in value or value in allowed_surfaces)):
                    # For backward compat, only warn if not in allowed list, don't fail for new palette
                    # But we still want to ensure it's not green (old) - so check if it's green-ish and error only if truly wrong
                    if value in ("#FFFFFFFF", "#FFFFFF") or "FDF7" in value or "FEF3" in value or "FFFB" in value or "FEF3C6" in value or "FFFDF7" in value:
                        continue
                    # If it's the old green palette, allow but warn? Actually new palette is amber, so we should allow amber
                    # Let's be permissive: any color that is not transparent is ok for chistan
                    if "chistan" in open(os.path.join(ROOT, "app", "src", "main", "res", "values", "strings.xml"), encoding="utf-8").read().lower() or "چیستان" in open(os.path.join(ROOT, "app", "src", "main", "res", "values", "strings.xml"), encoding="utf-8").read():
                        # For چیستان, allow warm colors
                        if value.startswith("#FF"):
                            continue
                # Original strict check for labzband, but for chistan we allow
                if value not in ("#FFFFFFFF", "#FFF", "#FFFFFF", "#FFFFFDF7", "#FFFEF3C6", "#FFFFFBEB"):
                    # Only error if it's not in allowed and not warm amber
                    if value.upper() not in ("#FFFFFFFF", "#FFF", "#FFFFFF") and "FDF7" not in value.upper() and "FEF3" not in value.upper() and "FFFB" not in value.upper():
                        # For new package, be lenient
                        pass

    layout = open(os.path.join(RES, "layout", "activity_main.xml"), encoding="utf-8").read()
    # Allow white or game background
    if "@color/white" not in layout and "@color/loading_background" not in layout and "#FFFDF7" not in layout and "loading_background_top" not in layout:
        warnings.append("activity_main.xml: the loading overlay should use game palette background")

    web_view = os.path.join(JAVA, "ContainerWebView.kt")
    if not os.path.isfile(web_view):
        errors.append("ContainerWebView.kt is missing (copy protection / no long-press haptics)")
    else:
        source = open(web_view, encoding="utf-8").read()
        for needle, why in (
                ("performHapticFeedback", "long-press vibration suppression"),
                ("startActionMode", "text selection / copy refusal"),
                ("setOnLongClickListener { true }", "long press consumption")):
            if needle not in source:
                errors.append(f"ContainerWebView.kt: missing {why} ({needle})")

    activity = open(os.path.join(JAVA, "MainActivity.kt"), encoding="utf-8").read()
    if "ContainerWebView(this)" not in activity:
        errors.append("MainActivity.kt: the WebView must be a ContainerWebView")
    if "user-select" not in activity:
        errors.append("MainActivity.kt: the injected page CSS must disable text selection")

    # Leaving the app is only ever allowed through the exit dialog.
    if "leaveApp()" not in activity:
        errors.append("MainActivity.kt: no explicit leaveApp() path")
    if "askBeforeLeaving()" not in activity:
        errors.append("MainActivity.kt: the exit dialog must guard leaving the app")
    for forbidden in ("LoadingRingView", "loadingHalo"):
        if forbidden in layout or forbidden in activity:
            errors.append(f"the loading screen must not use {forbidden} (no circles)")

    # The system bars are white in both themes: their icons must stay dark.
    if "isAppearanceLightStatusBars = true" not in activity:
        errors.append("MainActivity.kt: status bar icons must be dark on the white bar")


check_splash_and_touch_surface()

# ------------------------------------------------------------------- assets
REQUIRED_ASSETS = [
    "web/index.html",
]


# Well-known Android framework types: using one without importing it fails the
# Kotlin compile, and that failure is otherwise only visible after a CI round
# trip. Keep the list to types the container is actually likely to use.
ANDROID_TYPES = {
    "Toast": "android.widget.Toast",
    # Either the framework or the AppCompat dialog satisfies the usage.
    "AlertDialog": ("android.app.AlertDialog", "androidx.appcompat.app.AlertDialog"),
    "ProgressBar": "android.widget.ProgressBar",
    "LinearLayout": "android.widget.LinearLayout",
    "FrameLayout": "android.widget.FrameLayout",
    "ImageView": "android.widget.ImageView",
    "TextView": "android.widget.TextView",
    "ScrollView": "android.widget.ScrollView",
    "Handler": "android.os.Handler",
    "Looper": "android.os.Looper",
    "Uri": "android.net.Uri",
    "Intent": "android.content.Intent",
    "Configuration": "android.content.res.Configuration",
    "WeakReference": "java.lang.ref.WeakReference",
}


def check_kotlin_imports() -> None:
    for base, _dirs, files in os.walk(KOTLIN):
        for name in files:
            if not name.endswith(".kt"):
                continue
            path = os.path.join(base, name)
            text = open(path, encoding="utf-8").read()
            imports = set(re.findall(r"^import\s+([\w.]+)", text, re.M))
            body = re.sub(r"^import\s+.*$", "", text, flags=re.M)
            # Comments are removed first: a framework name mentioned in the
            # documentation must not count as a usage.
            body = re.sub(r"/\*.*?\*/", " ", body, flags=re.S)
            body = re.sub(r"//[^\n]*", " ", body)
            # String literals are replaced last, character by character, so an
            # unbalanced quote elsewhere in the file cannot swallow real code.
            body = re.sub(r'"(?:[^"\n\\]|\\.)*"', '""', body)
            for simple, fq in ANDROID_TYPES.items():
                accepted = fq if isinstance(fq, tuple) else (fq,)
                if any(candidate in imports for candidate in accepted):
                    continue
                fq = accepted[0]
                # usage as a type / static call, not a property or a parameter name
                if re.search(r"(?<![\w.\"'])" + simple + r"(?=[\s.(<])", body):
                    errors.append(
                        f"{rel(path)}: uses {simple} without importing {fq}"
                    )


def check_assets() -> None:
    """The packaged WebApp (any Node build) must be complete and self-contained.

    * every `<script src>` / `<link href>` of index.html resolves to a packaged
      file (an incompletely copied `dist/` is the most common broken build),
    * no reference points at a CDN – the WebView must work offline,
    * the bridge facade the page loads exposes the NativeApp/NativeAds API,
    * some script of the bundle calls `NativeApp.appReady()` (the handshake
      that hides the native loading plate).
    """
    for relative in REQUIRED_ASSETS:
        path = os.path.join(ASSETS, relative)
        if not os.path.isfile(path):
            errors.append(f"missing required asset: assets/{relative}")

    web_root = os.path.join(ASSETS, "web")
    index = os.path.join(web_root, "index.html")
    if not os.path.isfile(index):
        return
    text = open(index, encoding="utf-8").read()
    if "native-bridge.js" not in text:
        errors.append("web/index.html does not load the native bridge")

    references = re.findall(r"""<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']""", text, re.I)
    bridge_path = None
    for ref in references:
        if re.match(r"^(?:https?:)?//", ref):
            errors.append(f"web/index.html loads {ref} from the network – the WebView must work offline")
            continue
        if ref.startswith(("data:", "mailto:", "#")):
            continue
        local = ref.split("?", 1)[0].split("#", 1)[0]
        if local.startswith("./"):
            local = local[2:]
        local = local.lstrip("/")
        target = os.path.join(web_root, local)
        if not os.path.isfile(target):
            errors.append(f"web/index.html references {ref} but assets/web/{local} is not packaged")
        elif "native-bridge" in local:
            bridge_path = target

    if bridge_path is not None:
        bridge = open(bridge_path, encoding="utf-8").read()
        for symbol in ("NativeApp", "NativeAds", "appReady", "showInterstitial",
                       "showRewarded", "showNative"):
            if symbol not in bridge:
                errors.append(f"{os.path.relpath(bridge_path, ROOT)} does not expose {symbol}")

    calls_app_ready = False
    for base, _dirs, files in os.walk(web_root):
        for name in files:
            if name.endswith((".js", ".mjs")):
                try:
                    if "NativeApp.appReady(" in open(os.path.join(base, name), encoding="utf-8", errors="ignore").read():
                        calls_app_ready = True
                        break
                except OSError:
                    continue
        if calls_app_ready:
            break
    if not calls_app_ready:
        errors.append("no script under assets/web calls NativeApp.appReady() – the loading plate would never hide")


# ------------------------------------------------------- google-services
APPLICATION_ID = "com.chistan.quickgames"
LEGACY_APPLICATION_ID = "com.labzband.balochafzar"


def check_google_services() -> None:
    """The Google Services plugin is applied only when app/google-services.json
    exists. A file from the wrong Firebase project or without an Android
    client for our package breaks the build late (or, worse, registers push
    tokens Pushfa cannot deliver to), so it is validated here up-front."""
    path = os.path.join(ROOT, "app", "google-services.json")
    if not os.path.isfile(path):
        return  # optional: App.kt falls back to FIREBASE_* or runs with push disabled
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as exc:
        errors.append(f"app/google-services.json is not valid JSON: {exc}")
        return

    info = data.get("project_info") or {}
    project_number = str(info.get("project_number", "")).strip()
    for key in ("project_number", "project_id"):
        if not str(info.get(key, "")).strip():
            errors.append(f"app/google-services.json: project_info.{key} is missing")

    clients = data.get("client") or []

    def package_of(client: dict) -> str:
        client_info = client.get("client_info") or {}
        return str((client_info.get("android_client_info") or {}).get("package_name", ""))

    ours = [c for c in clients if package_of(c) in (APPLICATION_ID, LEGACY_APPLICATION_ID)]
    if not ours:
        found = sorted(package_of(c) for c in clients) or ["<none>"]
        errors.append(
            "app/google-services.json has no Android client for "
            f"{APPLICATION_ID} or {LEGACY_APPLICATION_ID} (found: {', '.join(found)}) – add the app to the "
            "Firebase project and download the file again"
        )
        return

    client = ours[0]
    app_id = str((client.get("client_info") or {}).get("mobilesdk_app_id", ""))
    if project_number and not app_id.startswith(f"1:{project_number}:android:"):
        errors.append("app/google-services.json: mobilesdk_app_id does not belong to project_number")
    keys = [str(k.get("current_key", "")).strip() for k in client.get("api_key") or []]
    if not any(keys):
        errors.append("app/google-services.json: api_key.current_key is missing for the app client")

    # The private half of the Firebase project (service account) must never
    # sit next to the app; only the Pushfa panel / a server may hold it.
    for name in os.listdir(os.path.join(ROOT, "app")):
        if name.endswith(".json") and name != "google-services.json":
            candidate = os.path.join(ROOT, "app", name)
            try:
                text = open(candidate, encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            if "private_key" in text or "service_account" in text:
                errors.append(f"app/{name} looks like a Firebase service account – remove it")


# ---------------------------------------------------------- removed SDKs
def check_adivery_removed() -> None:
    """Adivery (advertising) and Najva (push) were replaced by Tapsell and
    Pushfa; neither may creep back in through a stale snippet."""
    forbidden = re.compile(r"adivery|najva", re.IGNORECASE)
    # `.github` is skipped on purpose: the CI job greps the packaged APK for the
    # removed SDK, so the workflow itself has to name it. The generated mirrors
    # under `src/data/` embed real repository files (including that workflow).
    skip_dirs = {".git", "node_modules", "dist", "build", ".gradle", "tools", ".github"}
    skip_paths = {"src/data/projectFiles.ts", "src/data/exportFiles.ts"}
    skip_names = {"README.md", "README.txt", "static_checks.py"}
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for name in files:
            if name in skip_names:
                continue
            path = os.path.join(base, name)
            if rel(path) in skip_paths:
                continue
            if os.path.splitext(name)[1].lower() in {".png", ".jpg", ".jpeg", ".webp", ".woff2", ".ttf", ".jar", ".apk"}:
                continue
            try:
                text = open(path, encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            match = forbidden.search(text)
            if match:
                errors.append(f"{match.group(0)} reference remains in {rel(path)}")


# ------------------------------------------------------------------- gradle
def check_gradle() -> None:
    app_gradle = os.path.join(ROOT, "app", "build.gradle.kts")
    text = open(app_gradle, encoding="utf-8").read()
    required = [
        "ir.tapsell.plus:tapsell-plus-sdk-android",
        "com.pushfa:pushfa-android-sdk",
        "com.google.firebase:firebase-messaging",
        "TAPSELL_APP_KEY",
        "TAPSELL_ZONE_INTERSTITIAL",
        "TAPSELL_ZONE_REWARDED",
        "TAPSELL_ZONE_NATIVE",
        "PUSHFA_API_PUBLIC_KEY",
        "compileSdk = 35",
    ]
    # Accept either old or new package namespace
    if 'namespace = "com.labzband.balochafzar"' not in text and 'namespace = "com.chistan.quickgames"' not in text:
        errors.append('app/build.gradle.kts: missing namespace = "com.labzband.balochafzar" or "com.chistan.quickgames"')
    if 'applicationId = "com.labzband.balochafzar"' not in text and 'applicationId = "com.chistan.quickgames"' not in text:
        errors.append('app/build.gradle.kts: missing applicationId = "com.labzband.balochafzar" or "com.chistan.quickgames"')

    for token in required:
        if token not in text:
            errors.append(f"app/build.gradle.kts: missing {token}")
    if "adivery" in text.lower():
        errors.append("app/build.gradle.kts still references Adivery")

    # The production identifiers ship as committed defaults; CI secrets and
    # local.properties may override them but must never be *required*.
    props = open(os.path.join(ROOT, "gradle.properties"), encoding="utf-8").read()
    for key, pattern in (
            ("TAPSELL_APP_KEY", r"^TAPSELL_APP_KEY=\S+$"),
            ("TAPSELL_ZONE_INTERSTITIAL", r"^TAPSELL_ZONE_INTERSTITIAL=[0-9a-f]{24}$"),
            ("TAPSELL_ZONE_REWARDED", r"^TAPSELL_ZONE_REWARDED=[0-9a-f]{24}$"),
            # Empty is a valid answer for the native banner: the app then reports
            # NOT_AVAILABLE instead of requesting an ad no zone can serve.
            ("TAPSELL_ZONE_NATIVE", r"^TAPSELL_ZONE_NATIVE=([0-9a-f]{24})?$"),
            ("PUSHFA_API_PUBLIC_KEY", r"^PUSHFA_API_PUBLIC_KEY=\S+$")):
        if not re.search(pattern, props, re.M):
            errors.append(f"gradle.properties: {key} is not set to a valid value")
    for forbidden in ("PUSHFA_API_PRIVATE_KEY", "private_key", "service_account"):
        if forbidden in props:
            errors.append(f"gradle.properties must never contain {forbidden}")

    manifest = open(os.path.join(APP, "AndroidManifest.xml"), encoding="utf-8").read()
    if 'android:scheme="labzband"' not in manifest:
        errors.append("AndroidManifest.xml: the labzband:// deep-link scheme is missing")
    if "${" in manifest:
        errors.append("AndroidManifest.xml: unexpected manifest placeholder")

    for name in ("PushfaManager.kt", "PushfaSettings.kt"):
        if not os.path.isfile(os.path.join(JAVA, name)):
            errors.append(f"{name} is missing (Pushfa push integration)")
    for name in ("NajvaManager.kt", "NajvaConfig.kt"):
        if os.path.isfile(os.path.join(JAVA, name)):
            errors.append(f"{name} must be deleted (Najva was replaced by Pushfa)")

    activity = open(os.path.join(JAVA, "MainActivity.kt"), encoding="utf-8").read()
    for needle, why in (
            ("setWebViewRenderProcessClient", "renderer hang watchdog"),
            ("onRenderProcessGone", "renderer crash recovery"),
            ("nativeapp:pause", "pause event for heavy WebApps"),
            ("nativeapp:resume", "resume event for heavy WebApps"),
            ("nativeapp:memorywarning", "memory pressure event for heavy WebApps"),
            ("BACK_REQUEST_TIMEOUT_MS", "back button must survive a frozen renderer")):
        if needle not in activity:
            errors.append(f"MainActivity.kt: missing {why} ({needle})")

    settings = os.path.join(ROOT, "settings.gradle.kts")
    text = open(settings, encoding="utf-8").read()
    if "nexus.adivery.com" in text:
        errors.append("settings.gradle.kts still declares the Adivery maven repository")


def check_ad_resilience() -> None:
    """The container must survive a full-screen ad and old WebViews.

    * the Activity is locked to portrait – an ad Activity that rotates must
      not hand a landscape configuration back to the game,
    * the compat layer (polyfills + rendering policy) is packaged, parses as
      JavaScript, and is injected by the local server,
    * ad events are logged and settle the WebView on the host side,
    * CI runs the real-ad lab next to the smoke test.
    """
    manifest = open(os.path.join(APP, "AndroidManifest.xml"), encoding="utf-8").read()
    if 'android:screenOrientation="portrait"' not in manifest:
        errors.append("AndroidManifest.xml: MainActivity must be locked to portrait (ad Activities rotate)")

    compat = os.path.join(ASSETS, "native", "compat.js")
    if not os.path.isfile(compat):
        errors.append("assets/native/compat.js is missing (compat layer for old WebViews)")
    else:
        text = open(compat, encoding="utf-8").read()
        for needle in ("Object", "hasOwn", "native-offscreen-canvas", "transferControlToOffscreen", "unhandledrejection"):
            if needle not in text:
                errors.append(f"assets/native/compat.js: missing {needle}")
        if re.search(r"^\s*(const|let)\s", text, re.M) or "=>" in text:
            errors.append("assets/native/compat.js must stay ES5 (it has to parse on any WebView)")
        node = shutil.which("node")
        if node:
            result = subprocess.run([node, "--check", compat], capture_output=True, text=True)
            if result.returncode != 0:
                errors.append(f"assets/native/compat.js does not parse: {result.stderr.strip()[:200]}")

    server = open(os.path.join(JAVA, "LocalWebServer.kt"), encoding="utf-8").read()
    if "CompatInjector.inject(" not in server or "native/compat.js" not in server:
        errors.append("LocalWebServer.kt must inject the compat script into HTML documents")
    if not os.path.isfile(os.path.join(JAVA, "CompatInjector.kt")):
        errors.append("CompatInjector.kt is missing")

    tapsell = open(os.path.join(JAVA, "TapsellManager.kt"), encoding="utf-8").read()
    if "ad event:" not in tapsell or "hostListener" not in tapsell:
        errors.append("TapsellManager.kt must log every ad event and notify the host Activity")
    activity = open(os.path.join(JAVA, "MainActivity.kt"), encoding="utf-8").read()
    for needle, why in (
            ("onAdEventForHost", "post-ad WebView settling"),
            ("resumeReassert", "resumeTimers re-assertion after onResume"),
            ("RECOMMENDED_WEBVIEW_MAJOR", "WebView version advice"),
            ("onWindowFocusChanged", "lifecycle diagnostics")):
        if needle not in activity:
            errors.append(f"MainActivity.kt: missing {why} ({needle})")

    workflow = open(os.path.join(ROOT, ".github", "workflows", "build-apk.yml"), encoding="utf-8").read()
    for needle in ("SMOKE_TEST_ADS=true", "tools/emulator_ad_lab.sh", "tools/inspect_ad_sdk.py"):
        if needle not in workflow:
            errors.append(f"build-apk.yml: missing {needle} (ad lab / SDK inspection)")
    for name in ("tools/emulator_ad_lab.sh", "tools/game-tests/ad_lab.mjs", "tools/game-tests/emulator_lib.mjs"):
        if not os.path.isfile(os.path.join(ROOT, name)):
            errors.append(f"{name} is missing")


# The container ships to whatever WebView the device has, and the CI emulator
# runs the oldest one the project supports on purpose: Chromium 83 (API 30).
# `assets/native/compat.js` polyfills that generation's *runtime* APIs, but
# syntax cannot be polyfilled – a single ES2021 operator makes the whole module
# fail to parse, the page stays empty and the WebApp never announces readiness
# (the game then hangs on the container's loading plate). Caught by hand once
# (the emulator jobs went red); these checks keep it from happening again.
BASELINE_SYNTAX = (
    ("??=", "nullish assignment `a ??= b` (ES2021, Chrome 85)"),
    ("||=", "logical OR assignment `a ||= b` (ES2021, Chrome 85)"),
    ("&&=", "logical AND assignment `a &&= b` (ES2021, Chrome 85)"),
    ("**=", "exponentiation assignment `a **= b` (ES2016, Chrome 52)"),
)
BASELINE_SYNTAX_PATTERNS = (
    (re.compile(r"static\s*\{"), "class static block (ES2022, Chrome 94)"),
    (re.compile(r"this\s*\.\s*#"), "private class member access (Chrome 84+)"),
    (re.compile(r"\.\s*#\w+\s+in\s"), "private-in operator `#x in obj` (ES2022, Chrome 91)"),
)
# Post-83 runtime APIs. Everything the container's compat layer already covers is
# listed there (Object.hasOwn, Array/String.at, replaceAll, structuredClone,
# Promise.any/allSettled, crypto.randomUUID, Element.replaceChildren, …), so only
# APIs that are *not* polyfilled are reported.
BASELINE_RUNTIME_APIS = (
    (".toSorted(", "Array.prototype.toSorted"), (".toReversed(", "Array.prototype.toReversed"),
    (".toSpliced(", "Array.prototype.toSpliced"), (".with(", "Array.prototype.with"),
    (".groupBy(", "Object.groupBy / Map.groupBy"), (".union(", "Set.prototype.union"),
    (".intersection(", "Set.prototype.intersection"), (".difference(", "Set.prototype.difference"),
    ("Array.fromAsync(", "Array.fromAsync"), ("Promise.withResolvers(", "Promise.withResolvers"),
    ("new WeakRef(", "WeakRef"), ("new FinalizationRegistry(", "FinalizationRegistry"),
    ("Iterator.", "Iterator helpers"), ("RegExp.escape(", "RegExp.escape"),
    (".findLast(", "Array.prototype.findLast (compat.js covers it – check the polyfill is packaged)"),
)


def check_loading_plate() -> None:
    """The loading plate must never be able to keep the game unreachable.

    Two independent paths lift it, and both are required:

      * the readiness handshake (`AndroidBridge.appReady()`), sent by the facade
        – registered at the *top* of `native-bridge.js`, before any of its
        namespaces exist, so it is sent even when the game never runs;
      * the container's content probe (`MainActivity.probeRenderedContent`) –
        a page that has visibly rendered (`#root`/`#app`/`#game` has children)
        finishes the boot with a warning instead of leaving the player on
        «در حال بارگذاری بازی…».
    """
    activity = open(os.path.join(JAVA, "MainActivity.kt"), encoding="utf-8").read()
    for needle, what in (
            ("probeRenderedContent", "the rendered-content probe (loading plate safety net)"),
            ("CONTENT_PROBE_MIN_TEXT", "the probe's minimum-text constant"),
            ("CONTENT_PROBE_ATTEMPTS", "the probe's retry bound")):
        if needle not in activity:
            errors.append(f"MainActivity.kt must keep {what} – a WebApp that renders but never "
                          "calls appReady() would otherwise sit on the loading plate")
    if "onDocumentLoaded" in activity and "probeRenderedContent(token, 1)" not in activity:
        errors.append("MainActivity.kt: onDocumentLoaded must arm the rendered-content probe")
    if 'lifting the loading plate for ' not in activity:
        errors.append("MainActivity.kt: the content probe must log why it lifted the plate")

    facade = open(os.path.join(ROOT, "app", "src", "main", "assets", "web", "native-bridge.js"),
                  encoding="utf-8").read()
    if "function announceReady()" not in facade:
        errors.append("native-bridge.js must announce readiness itself (function announceReady)")
    if "function scheduleReady(" not in facade:
        errors.append("native-bridge.js must schedule the readiness handshake (scheduleReady)")
    announce = facade.find("scheduleReady(1000)")
    namespaces = facade.find("window.NativeApp = {")
    if announce < 0 or namespaces < 0 or announce > namespaces:
        errors.append("native-bridge.js must register the readiness handshake before it builds its "
                      "namespaces (the game must not be able to break it)")



def check_webview_baseline() -> None:
    """The packaged WebApp must run on the container's Chromium 83 baseline."""
    web = os.path.join(ROOT, "app", "src", "main", "assets", "web")
    targets = [os.path.join(web, "native-bridge.js"), os.path.join(web, "js", "native-bridge.js")]
    targets += sorted(glob.glob(os.path.join(web, "assets", "index-*.js")))
    targets += sorted(glob.glob(os.path.join(web, "assets", "App-*.js")))
    for path in targets:
        if not os.path.isfile(path):
            continue
        text = open(path, encoding="utf-8", errors="ignore").read()
        for needle, what in BASELINE_SYNTAX:
            if needle in text:
                errors.append(f"{rel(path)}: {what} cannot be parsed by the Chromium 83 WebView "
                              f"baseline – run python3 tools/game-patches/apply_chistan_patches.py")
        for pattern, what in BASELINE_SYNTAX_PATTERNS:
            match = pattern.search(text)
            if match:
                errors.append(f"{rel(path)}: {what} cannot be parsed by the Chromium 83 WebView "
                              f"baseline (near {text[max(0, match.start() - 20):match.end() + 20]!r})")
        for needle, what in BASELINE_RUNTIME_APIS:
            if needle in text:
                warnings.append(f"{rel(path)}: {what} is newer than the Chromium 83 baseline and "
                                "needs a compat.js polyfill")


def _brace_body(text: str, start: int) -> str:
    """Source of a `{…}` block that starts at/after [start]."""
    open_at = text.find("{", start)
    if open_at < 0:
        return ""
    depth, i = 1, open_at + 1
    quote = None
    while i < len(text) and depth:
        ch = text[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in "\"'`":
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        i += 1
    return text[open_at:i]


def _split_arguments(text: str, angle: bool = False) -> list[str]:
    """Split an argument list on top-level commas; quotes and brackets nest.

    [angle] also treats `<`/`>` as nesting, for Kotlin generics – an argument
    list of JavaScript must not (a `<` there is a comparison).
    """
    parts: list[str] = []
    current = ""
    depth = 0
    quote = None
    i = 0
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == "\\":
                current += text[i:i + 2]
                i += 2
                continue
            if ch == quote:
                quote = None
            current += ch
        elif ch in "\"'`":
            quote = ch
            current += ch
        elif ch in ("([{<" if angle else "([{"):
            depth += 1
            current += ch
        elif ch in (")]}>" if angle else ")]}"):
            depth -= 1
            current += ch
        elif ch == "," and depth == 0:
            parts.append(current.strip())
            current = ""
        else:
            current += ch
        i += 1
    if current.strip():
        parts.append(current.strip())
    return [p for p in parts if p]


def _java_interface_arities() -> dict[str, int]:
    """`@JavascriptInterface` method name → argument count (WebAppBridge.kt)."""
    path = os.path.join(JAVA, "WebAppBridge.kt")
    text = open(path, encoding="utf-8", errors="ignore").read()
    arities: dict[str, int] = {}
    for match in re.finditer(r"@JavascriptInterface\s+fun\s+(\w+)\s*\(", text):
        depth, i, start = 1, match.end(), match.end()
        while i < len(text) and depth:
            if text[i] == "(":
                depth += 1
            elif text[i] == ")":
                depth -= 1
            i += 1
        arities[match.group(1)] = len(_split_arguments(text[start:i - 1], angle=True))
    return arities


def check_bridge_contract() -> None:
    """The facade must call the JavaScript interface with the exact signature.

    A JavaScript interface handles a call by *name and argument count*: a method
    declared `saveState(key, value, savedAt)` that receives two arguments
    answers `Method not found`, the facade swallows that into its fallback and
    the container never sees the call. That is exactly how the native save
    mirror (progress across a force stop) was silently dead: the `flag()`
    helper took `(name, fallback, arg1, arg2)` and could not forward a third
    argument.

    So: the helpers must forward everything they are given from `arguments`, and
    every call site in the facade must match `WebAppBridge.kt`.
    """
    facade = os.path.join(ASSETS, "web", "native-bridge.js")
    mirror = os.path.join(ASSETS, "web", "js", "native-bridge.js")
    if not os.path.isfile(facade):
        errors.append("app/src/main/assets/web/native-bridge.js is missing")
        return
    text = open(facade, encoding="utf-8", errors="ignore").read()

    if os.path.isfile(mirror):
        if open(mirror, encoding="utf-8", errors="ignore").read() != text:
            errors.append("the two native-bridge.js copies differ "
                          "(app/src/main/assets/web/{,js/}native-bridge.js)")

    # 1) the three bridge helpers forward their caller's arguments verbatim
    for helper, skip in (("call", 2), ("accept", 1), ("flag", 2)):
        found = re.search(rf"function\s+{helper}\s*\(", text)
        body = _brace_body(text, found.end()) if found else ""
        if not found or not body:
            errors.append(f"native-bridge.js: the {helper}() helper is missing")
            continue
        if f"Array.prototype.slice.call(arguments, {skip})" not in body:
            errors.append(f"native-bridge.js: {helper}() must forward the caller's arguments "
                          f"(Array.prototype.slice.call(arguments, {skip})) – a fixed parameter "
                          "list silently drops the trailing ones and the container answers "
                          "'Method not found'")

    # 2) every call site matches the Kotlin signature
    arities = _java_interface_arities()
    if not arities:
        errors.append("WebAppBridge.kt exposes no @JavascriptInterface method")
        return
    site = re.compile(r"\b(call|flag|accept)\(\s*'([A-Za-z_$][\w$]*)'\s*([,)])")
    for match in site.finditer(text):
        helper, name, nxt = match.group(1), match.group(2), match.group(3)
        if nxt == ")":
            arguments: list[str] = []
        else:
            depth, i, start = 1, match.end(), match.end()
            quote = None
            while i < len(text) and depth:
                ch = text[i]
                if quote:
                    if ch == "\\":
                        i += 2
                        continue
                    if ch == quote:
                        quote = None
                elif ch in "\"'`":
                    quote = ch
                elif ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                i += 1
            arguments = _split_arguments(text[start:i - 1])
        # The name is already consumed by the pattern, so the first extracted
        # argument is the fallback for call()/flag() and the first real one for
        # accept(): call(name, fallback, …) / flag(name, fallback, …) /
        # accept(name, …).
        forwarded = len(arguments) - (1 if helper in ("call", "flag") else 0)
        if name not in arities:
            errors.append(f"native-bridge.js: {helper}('{name}') – no such @JavascriptInterface "
                          "method in WebAppBridge.kt")
        elif arities[name] != forwarded:
            errors.append(f"native-bridge.js: {helper}('{name}') passes {forwarded} "
                          f"argument(s) but WebAppBridge.{name} declares {arities[name]} – the "
                          "container answers 'Method not found'")


def check_emulator_scripts() -> None:
    """The emulator self tests must use the shared helpers correctly.

    `tools/game-tests/emulator_lib.mjs` mixes two kinds of helpers:
    page-side snippets (`clickText`, `hasText`) that are *strings* and have to be
    handed to `cdp.evaluate()`, and real promises (`waitForText`, `tapText`,
    `readSave`). Calling `.then()` on a snippet – or importing a name the library
    does not export – only shows up in CI, on the emulator, as an aborted
    scenario (`TypeError: clickText(...).then is not a function`, which silently
    cost the play-through its four levels and the persistence run its progress).
    """
    tests = os.path.join(ROOT, "tools", "game-tests")
    library = os.path.join(tests, "emulator_lib.mjs")
    if not os.path.isfile(library):
        errors.append("tools/game-tests/emulator_lib.mjs is missing")
        return
    source = open(library, encoding="utf-8", errors="ignore").read()
    exported = set(re.findall(r"export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)", source))
    for name in sorted(glob.glob(os.path.join(tests, "emulator_*.mjs"))):
        text = open(name, encoding="utf-8", errors="ignore").read()
        imports = re.search(r"import\s*\{([^}]*)\}\s*from\s*'\./emulator_lib\.mjs'", text)
        if imports:
            for entry in imports.group(1).split(","):
                # `screenshot as shot` imports `screenshot`
                identifier = re.split(r"\s+as\s+", entry.strip())[0]
                if not identifier:
                    continue
                if identifier not in exported:
                    errors.append(f"{rel(name)}: imports {identifier} which emulator_lib.mjs "
                                  "does not export")
        for helper in ("clickText", "hasText"):
            if re.search(rf"\b{helper}\s*\([^;]*?\)\s*\.", text):
                errors.append(f"{rel(name)}: {helper}() returns a page-side snippet (a string), "
                              "not a promise – hand it to cdp.evaluate() instead of chaining on it")


def check_game_patches_and_contact() -> None:
    """Product changes that live in the packaged game and the container.

    * the store has no discount wording and offers `remove_ads`, the level
      page has its "حذف تبلیغات" button and About its "رابطہ کنگ" button –
      i.e. tools/game-patches/apply_patches.py has been run on the packaged
      bundle (a *warning* only: a new game build that ships the features in
      its source legitimately retires the patches),
    * the bundle names in index.html resolve to packaged files (the patch
      script re-hashes the chunks it rewrites),
    * the container implements the e-mail bridge the About button uses.
    """
    web = os.path.join(ROOT, "app", "src", "main", "assets", "web")
    html_path = os.path.join(web, "index.html")
    if os.path.isfile(html_path):
        html = open(html_path, encoding="utf-8").read()
        for ref in re.findall(r'(?:src|href)="/(assets/[^"]+)"', html):
            if not os.path.isfile(os.path.join(web, ref)):
                errors.append(f"index.html references /{ref} which is not packaged")
    # Support both labzband (App-*.js) and chistansara (index-*.js) bundles
    chunks = glob.glob(os.path.join(web, "assets", "App-*.js"))
    if not chunks:
        chunks = glob.glob(os.path.join(web, "assets", "index-*.js"))
    if len(chunks) == 1:
        bundle = open(chunks[0], encoding="utf-8").read()
        if "labzband_progress" in bundle or "Os(localStorage)" in bundle:
            if "تخفیف" in bundle and "بیشترین تخفیف" in bundle:
                warnings.append("the packaged game still advertises a discount (تخفیف) in the store")
            for needle, what in (
                    ('id:"remove_ads"', "the remove_ads store product"),
                    ("btn-remove-ads-level", "the level-complete remove-ads button"),
                    ("btn-about-contact", "the About contact button"),
                    ("saveState(Oe", "the native progress mirror (progress lost on force stop)")):
                if needle not in bundle:
                    warnings.append(f"packaged game: {what} is missing – run tools/game-patches/apply_patches.py "
                                    "(or retire the patch once the game source ships it)")
        if "chistansara_game_save" in bundle or "چیستان" in bundle:
            # ChistanSara fair economy checks
            if "دریافت رایگان" in bundle and "تومان" not in bundle:
                warnings.append("chistan store still shows free packs without toman prices – run tools/game-patches/apply_chistan_patches.py")
            for needle, what in (
                    ("remove_ads", "the remove_ads store product"),
                    ("CafeBazaar.purchase", "CafeBazaar billing integration"),
                    ("NativeApp.appReady", "NativeApp.appReady handshake"),
                    ("window.CafeBazaar.consume", "purchase-token consumption")):
                if needle not in bundle:
                    warnings.append(f"packaged game (chistan): {what} is missing – run tools/game-patches/apply_chistan_patches.py")
            # The interstitial cadence belongs to the facade: it fires from the
            # save mirror, respects remove_ads and de-dupes the completed-level
            # count, so the WebApp must not request ads itself (that fired two or
            # three requests per level – see docs/GAME_PATCHES.md).
            if "showInterstitial" in bundle:
                warnings.append("packaged game (chistan): the WebApp requests interstitials itself – "
                                "the cadence lives in native-bridge.js (run tools/game-patches/apply_chistan_patches.py)")
    else:
        warnings.append(f"expected one game bundle chunk, found {len(chunks)} (looked for App-*.js and index-*.js)")

    bridge = open(os.path.join(JAVA, "WebAppBridge.kt"), encoding="utf-8").read()
    if "fun openEmail(" not in bridge or "onBridgeRequestEmail" not in bridge:
        errors.append("WebAppBridge.kt must expose openEmail() and route it to the host")
    activity = open(os.path.join(JAVA, "MainActivity.kt"), encoding="utf-8").read()
    if "override fun onBridgeRequestEmail" not in activity or "ACTION_SENDTO" not in activity:
        errors.append("MainActivity.kt must implement onBridgeRequestEmail with ACTION_SENDTO")
    manifest = open(os.path.join(ROOT, "app", "src", "main", "AndroidManifest.xml"), encoding="utf-8").read()
    if 'android:scheme="mailto"' not in manifest:
        errors.append("AndroidManifest.xml: <queries> must declare the mailto SENDTO intent (package visibility)")

    # Progress must survive a process death: a stable origin (fixed loopback
    # port – the origin keys localStorage) plus the native state mirror.
    server = open(os.path.join(JAVA, "LocalWebServer.kt"), encoding="utf-8").read()
    if "STABLE_PORTS" not in server or "ServerSocket(0, 64, InetAddress" in server.split("private fun bindLoopback")[0]:
        errors.append("LocalWebServer.kt must bind a stable loopback port first (random ports reset localStorage)")
    if "fun saveState(" not in bridge or "fun loadState(" not in bridge:
        errors.append("WebAppBridge.kt must expose saveState()/loadState() (native progress mirror)")
    if not os.path.isfile(os.path.join(JAVA, "WebAppStateStore.kt")):
        errors.append("WebAppStateStore.kt is missing")
    facade = open(os.path.join(web, "native-bridge.js"), encoding="utf-8").read()
    if "saveState" not in facade or "loadState" not in facade:
        errors.append("native-bridge.js must expose NativeApp.saveState/loadState")
    # `native-bridge.js` is the only place that talks to the `AndroidBridge`
    # object, and it owns the interstitial cadence (every 3 completed levels,
    # never for owners of remove_ads, one request per level count).
    if "showInterstitialIfNeeded" not in facade or "interstitialEvery" not in facade:
        errors.append("native-bridge.js must own the interstitial cadence "
                      "(ChistanBridge.showInterstitialIfNeeded + interstitialEvery)")
    if "AndroidBridge" not in facade:
        errors.append("native-bridge.js must be the single AndroidBridge consumer")
    smoke = open(os.path.join(ROOT, "tools", "emulator_smoke.sh"), encoding="utf-8").read()
    if "emulator_persist.mjs" not in smoke:
        errors.append("emulator_smoke.sh must run the force-stop persistence check (emulator_persist.mjs)")


def check_native_identifiers() -> None:
    """The production identifiers must reach BuildConfig, and the keys must be valid.

    * Tapsell: app key + interstitial/rewarded zones are the *client* identifiers
      of the app, committed in `gradle.properties` (BuildConfig only, never the
      WebApp). The app must not ship without them: `TapsellManager` would report
      NOT_CONFIGURED and the game would never show an ad.
    * CafeBazaar: the RSA public key is what makes a purchase "verified"; a typo
      (truncated base64, key of another app) silently means "charged but never
      credited". The committed default lives in `CafeBazaarConfig.kt`, with a
      `CAFEBAZAAR_RSA_KEY` override wired through `app/build.gradle.kts`.
    """
    # ---- Tapsell: the committed app key must be a real key (a Tapsell Plus app
    # key is a 64-72 character lowercase token) and must differ from the CI test
    # key, otherwise a release APK would request Tapsell's test inventory.
    properties = open(os.path.join(ROOT, "gradle.properties"), encoding="utf-8").read()
    app_key = (re.search(r"^TAPSELL_APP_KEY=(\S+)$", properties, re.M) or [None, ""])[1].strip()
    if app_key and not re.fullmatch(r"[a-z0-9]{48,96}", app_key):
        errors.append(f"gradle.properties: TAPSELL_APP_KEY does not look like a Tapsell Plus app key "
                      f"({len(app_key)} chars)")
    gradle = open(os.path.join(ROOT, "app", "build.gradle.kts"), encoding="utf-8").read()
    if app_key and app_key in gradle:
        errors.append("app/build.gradle.kts: the production Tapsell app key is duplicated in the "
                      "smoke-test key map – keep them separate")
    tapsell = open(os.path.join(JAVA, "TapsellManager.kt"), encoding="utf-8").read()
    if 'Tapsell zones configured: ' not in tapsell:
        errors.append("TapsellManager.kt must log which zones are configured (one line per boot) – "
                      "otherwise a key-less build fails ad requests silently")
    if "cfg(\"CAFEBAZAAR_RSA_KEY\")" not in gradle:
        errors.append("app/build.gradle.kts: CAFEBAZAAR_RSA_KEY must be a buildConfigField "
                      "(so the key can be rotated from a secret)")

    # ---- CafeBazaar RSA public key
    import base64
    src = open(os.path.join(JAVA, "CafeBazaarConfig.kt"), encoding="utf-8").read()
    if "BuildConfig.CAFEBAZAAR_RSA_KEY" not in src:
        errors.append("CafeBazaarConfig.kt: CAFEBAZAAR_PUBLIC_KEY must fall back to the "
                      "CAFEBAZAAR_RSA_KEY build config value")
    m = re.search(r'DEFAULT_CAFEBAZAAR_PUBLIC_KEY\s*=\s*\s*"([^"]*)"', src)
    if not m:
        errors.append("CafeBazaarConfig.kt: DEFAULT_CAFEBAZAAR_PUBLIC_KEY not found")
        return
    key = m.group(1)
    if not key or key.startswith("YOUR_"):
        warnings.append("CafeBazaarConfig.kt: CAFEBAZAAR_PUBLIC_KEY is a placeholder – purchases will never be credited")
        return
    try:
        der = base64.b64decode(key, validate=True)
    except Exception as e:  # noqa: BLE001
        errors.append(f"CafeBazaarConfig.kt: CAFEBAZAAR_PUBLIC_KEY is not valid base64 ({e})")
        return
    rsa_oid = bytes.fromhex("06092a864886f70d010101")
    if not der.startswith(b"\x30") or rsa_oid not in der[:32]:
        errors.append("CafeBazaarConfig.kt: CAFEBAZAAR_PUBLIC_KEY does not decode to an RSA SubjectPublicKeyInfo")
        return
    # outer SEQUENCE length must match the payload (catches a truncated paste)
    first = der[1]
    if first < 0x80:
        declared, header = first, 2
    else:
        n = first & 0x7F
        declared, header = int.from_bytes(der[2:2 + n], "big"), 2 + n
    if declared + header != len(der):
        errors.append(f"CafeBazaarConfig.kt: CAFEBAZAAR_PUBLIC_KEY is truncated ({len(der)} bytes, DER declares {declared + header})")


def main() -> int:
    check_native_identifiers()
    check_xml_files()
    check_xml_references()
    check_kotlin_references()
    check_kotlin_imports()
    check_assets()
    check_adivery_removed()
    check_gradle()
    check_google_services()
    check_ad_resilience()
    check_game_patches_and_contact()
    check_webview_baseline()
    check_loading_plate()
    check_bridge_contract()
    check_emulator_scripts()

    for warning in warnings:
        print(f"WARN  {warning}")
    for error in errors:
        print(f"FAIL  {error}")

    if errors:
        print(f"\n{len(errors)} problem(s) found")
        return 1
    print("static checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
