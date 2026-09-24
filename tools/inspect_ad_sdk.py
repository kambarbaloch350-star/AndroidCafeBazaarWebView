#!/usr/bin/env python3
"""
Prints what the advertising SDK brings into the app process – read-only,
never fails the build. Run after `assembleDebug` (needs the merged manifest
and the Gradle dependency cache).

  1. Activities of the merged manifest: which ones the SDK adds, and how they
     are declared (screenOrientation, configChanges, theme, hardware
     acceleration). A full-screen ad is one of these Activities in front of
     the container.
  2. For every Tapsell artifact in the Gradle cache: its own manifest entries
     and a constant-pool scan of its classes for the calls that can affect
     *our* WebView from another Activity of the same process – the
     process-wide `WebView.pauseTimers()/resumeTimers()`, orientation requests,
     window flags, WebView / media player usage.

Usage: python3 tools/inspect_ad_sdk.py [--gradle-cache <dir>]
"""
from __future__ import annotations

import glob
import io
import os
import re
import sys
import zipfile

NEEDLES = [
    # process-wide WebView state
    "pauseTimers", "resumeTimers", "setWebContentsDebuggingEnabled", "setDataDirectorySuffix",
    "enableSlowWholeDocumentDraw", "clearCache", "CookieManager",
    # orientation / window
    "setRequestedOrientation", "SCREEN_ORIENTATION", "setDecorFitsSystemWindows", "SYSTEM_UI_FLAG",
    "FLAG_FULLSCREEN", "WindowInsetsController", "setSystemUiVisibility", "FLAG_KEEP_SCREEN_ON",
    # rendering surfaces
    "android/webkit/WebView", "SurfaceView", "TextureView", "MediaPlayer", "ExoPlayer", "VideoView",
    # process hygiene
    "killProcess", "java/lang/System", "Runtime", "onTrimMemory", "onLowMemory",
]

ATTRS = ["android:name", "android:screenOrientation", "android:configChanges", "android:theme",
         "android:hardwareAccelerated", "android:launchMode", "android:exported", "android:excludeFromRecents"]


def find_merged_manifest() -> str | None:
    patterns = [
        "app/build/intermediates/merged_manifest/debug/**/AndroidManifest.xml",
        "app/build/intermediates/merged_manifests/debug/**/AndroidManifest.xml",
        "app/build/intermediates/**/debug/**/AndroidManifest.xml",
    ]
    for pattern in patterns:
        hits = sorted(glob.glob(pattern, recursive=True))
        hits = [h for h in hits if "merged" in h]
        if hits:
            return hits[0]
    return None


def activities(xml: str) -> list[dict[str, str]]:
    out = []
    for m in re.finditer(r"<activity\b([^>]*?)(/>|>)", xml, re.S):
        attrs = dict(re.findall(r'(android:[\w]+)="([^"]*)"', m.group(1)))
        out.append(attrs)
    return out


def print_activities(title: str, xml: str, only_foreign: bool = False) -> None:
    print(f"--- {title} ---")
    rows = activities(xml)
    ours = lambda a: a.get("android:name", "").startswith(("com.labzband", "com.chistan", "."))  # noqa: E731
    rows = [a for a in rows if not ours(a)] if only_foreign else [a for a in rows if ours(a)]
    if not rows:
        print("  (none)")
    for a in rows:
        parts = [f"{k.split(':')[1]}={a[k]}" for k in ATTRS if k in a]
        print("  " + "  ".join(parts))


def scan_jar(data: bytes) -> dict[str, list[str]]:
    hits: dict[str, list[str]] = {n: [] for n in NEEDLES}
    needles = {n: n.encode("utf-8") for n in NEEDLES}
    with zipfile.ZipFile(io.BytesIO(data)) as jar:
        for entry in jar.namelist():
            if not entry.endswith(".class"):
                continue
            blob = jar.read(entry)
            for name, needle in needles.items():
                if needle in blob:
                    hits[name].append(entry[:-6])
    return hits


def inspect_aar(path: str) -> None:
    print(f"=== {os.path.basename(path)} ===")
    try:
        with zipfile.ZipFile(path) as aar:
            names = aar.namelist()
            if "AndroidManifest.xml" in names:
                manifest = aar.read("AndroidManifest.xml").decode("utf-8", "replace")
                print_activities("manifest activities", manifest)
                for m in re.finditer(r"<(provider|service|receiver)\b[^>]*android:name=\"([^\"]+)\"", manifest):
                    print(f"  {m.group(1)}: {m.group(2)}")
            if "classes.jar" in names:
                hits = scan_jar(aar.read("classes.jar"))
                print("--- constant-pool scan (classes referencing …) ---")
                for name in NEEDLES:
                    classes = hits[name]
                    if classes:
                        sample = ", ".join(classes[:4]) + (" …" if len(classes) > 4 else "")
                        print(f"  {name:32s} {len(classes):4d}  {sample}")
                    else:
                        print(f"  {name:32s}    0")
    except zipfile.BadZipFile:
        print("  (not a zip archive)")


def main() -> int:
    cache = None
    if "--gradle-cache" in sys.argv:
        cache = sys.argv[sys.argv.index("--gradle-cache") + 1]
    cache = cache or os.path.join(os.path.expanduser("~"), ".gradle", "caches", "modules-2", "files-2.1")

    merged = find_merged_manifest()
    if merged:
        print(f"merged manifest: {merged}")
        xml = open(merged, encoding="utf-8", errors="replace").read()
        print_activities("activities the SDKs add to the app (merged manifest)", xml, only_foreign=True)
        print_activities("our own activities", xml)
    else:
        print("merged manifest not found (run assembleDebug first)")

    aars = sorted(glob.glob(os.path.join(cache, "ir.tapsell*", "**", "*.aar"), recursive=True))
    if not aars:
        print(f"no Tapsell artifacts under {cache}")
    for aar in aars:
        inspect_aar(aar)
    return 0


if __name__ == "__main__":
    sys.exit(main())
