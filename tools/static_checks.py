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
                            res[child.tag].add(name)

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

    # mipmap density folders also expose @mipmap/<name>
    for name in os.listdir(RES):
        if name.startswith("mipmap-"):
            for file in os.listdir(os.path.join(RES, name)):
                res["mipmap"].add(file.split(".")[0])
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


# ------------------------------------------------------------------- assets
REQUIRED_ASSETS = [
    "web/index.html",
    "web/js/native-bridge.js",
    "web/css/style.css",
]


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
    skip_dirs = {".git", "node_modules", "dist", "build", ".gradle", "tools"}
    skip_names = {"README.md", "README.txt", "static_checks.py"}
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for name in files:
            if name in skip_names:
                continue
            path = os.path.join(base, name)
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
