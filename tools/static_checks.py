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
  6. no leftover Adivery references anywhere in the project

Exits non-zero when a problem is found.
"""
from __future__ import annotations

import os
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(ROOT, "app", "src", "main")
RES = os.path.join(APP, "res")
KOTLIN = os.path.join(APP, "java")
JAVA = os.path.join(APP, "java", "com", "emochi", "quickgames")
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
        if target == "najvaApiKey":
            continue  # manifest placeholder injected by the build
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
    """The loading screen must be white in *every* theme, and the WebView must
    refuse text selection / copy and the platform's long-press vibration."""
    colors = {}
    for folder in ("values", "values-night"):
        path = os.path.join(RES, folder, "colors.xml")
        if not os.path.isfile(path):
            continue
        for name, value in re.findall(
                r'<color name="([^"]+)">([^<]+)</color>', open(path, encoding="utf-8").read()):
            colors.setdefault(name, []).append((folder, value.upper()))

    for name in ("loading_background_top", "loading_background_bottom",
                 "plate_surface", "plate_surface_end"):
        entries = colors.get(name)
        if not entries:
            errors.append(f"missing colour {name} (loading screen surface)")
            continue
        for folder, value in entries:
            if value not in ("#FFFFFFFF", "#FFF", "#FFFFFF"):
                errors.append(f"{folder}/colors.xml: {name} is {value}, the loading screen must stay white")

    layout = open(os.path.join(RES, "layout", "activity_main.xml"), encoding="utf-8").read()
    if "@color/white" not in layout:
        errors.append("activity_main.xml: the loading overlay must use a plain white background")

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


check_splash_and_touch_surface()

# ------------------------------------------------------------------- assets
REQUIRED_ASSETS = [
    "web/index.html",
    "web/js/native-bridge.js",
    "web/css/style.css",
]


# Well-known Android framework types: using one without importing it fails the
# Kotlin compile, and that failure is otherwise only visible after a CI round
# trip. Keep the list to types the container is actually likely to use.
ANDROID_TYPES = {
    "Toast": "android.widget.Toast",
    "AlertDialog": "android.app.AlertDialog",
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
                if fq in imports:
                    continue
                # usage as a type / static call, not a property or a parameter name
                if re.search(r"(?<![\w.\"'])" + simple + r"(?=[\s.(<])", body):
                    errors.append(
                        f"{rel(path)}: uses {simple} without importing {fq}"
                    )


def check_assets() -> None:
    for relative in REQUIRED_ASSETS:
        path = os.path.join(ASSETS, relative)
        if not os.path.isfile(path):
            errors.append(f"missing required asset: assets/{relative}")

    bridge = os.path.join(ASSETS, "web/js/native-bridge.js")
    if os.path.isfile(bridge):
        text = open(bridge, encoding="utf-8").read()
        for symbol in ("NativeApp", "NativeAds", "appReady", "showInterstitial",
                       "showRewarded", "showNative"):
            if symbol not in text:
                errors.append(f"native-bridge.js does not expose {symbol}")

    index = os.path.join(ASSETS, "web/index.html")
    if os.path.isfile(index):
        text = open(index, encoding="utf-8").read()
        if "native-bridge.js" not in text:
            errors.append("web/index.html does not load the native bridge")


# ------------------------------------------------------------------ adivery
def check_adivery_removed() -> None:
    forbidden = re.compile(r"adivery", re.IGNORECASE)
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
            if forbidden.search(text):
                errors.append(f"Adivery reference remains in {rel(path)}")


# ------------------------------------------------------------------- gradle
def check_gradle() -> None:
    app_gradle = os.path.join(ROOT, "app", "build.gradle.kts")
    text = open(app_gradle, encoding="utf-8").read()
    required = [
        "ir.tapsell.plus:tapsell-plus-sdk-android",
        "com.najva:sdk",
        "com.google.firebase:firebase-messaging",
        "TAPSELL_APP_KEY",
        "NAJVA_API_KEY",
    ]
    for token in required:
        if token not in text:
            errors.append(f"app/build.gradle.kts: missing {token}")
    if "adivery" in text.lower():
        errors.append("app/build.gradle.kts still references Adivery")

    settings = os.path.join(ROOT, "settings.gradle.kts")
    text = open(settings, encoding="utf-8").read()
    if "nexus.adivery.com" in text:
        errors.append("settings.gradle.kts still declares the Adivery maven repository")


def main() -> int:
    check_xml_files()
    check_xml_references()
    check_kotlin_references()
    check_kotlin_imports()
    check_assets()
    check_adivery_removed()
    check_gradle()

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
