#!/usr/bin/env python3
"""
Apply the game logo everywhere the container and the packaged game show one.

Source: one square PNG of the logo (the rounded green tile with the letter
tiles and the لبزبند word-mark), by default `branding/logo-source.png`.

Generated (ImageMagick 6 `convert` is required):

  app/src/main/res/drawable/icon_background.png   adaptive icon: solid logo green (1024²)
  app/src/main/res/drawable/icon_foreground.png   adaptive icon: green + logo in the safe zone (1008²)
  app/src/main/res/mipmap-*/ic_launcher.png       legacy launcher icon (full-bleed rounded tile)
  app/src/main/res/mipmap-*/ic_launcher_round.png legacy round icon (green disc + logo)
  app/src/main/res/mipmap-*/ic_launcher_foreground.png (unused legacy copies, kept in sync)
  app/src/main/res/drawable-nodpi/logo_labzband.png  native loading plate + exit dialog (384²)
  app/src/main/assets/web/logo.png                the game's main-menu / About tiles (512²)
  app/src/main/assets/web/icon-192.png, icon-512.png  web manifest icons (maskable)

The white (or transparent) corners around the rounded tile are made
transparent by flood-filling from the four corners, so the logo never shows a
white frame on a coloured surface. The adaptive-icon foreground places the
tile at 78 % of the canvas: its letter tiles land inside the 66 % safe zone
while the tile's own edges stay outside every launcher mask, and the
background layer uses the same green, so parallax never reveals a seam.

Usage:
  python3 tools/branding/apply_logo.py [--source branding/logo-source.png] [--out <dir>]
  --out redirects every output below <dir> (dry run / inspection).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RES = os.path.join("app", "src", "main", "res")
WEB = os.path.join("app", "src", "main", "assets", "web")

LEGACY_SIZES = {"ldpi": 36, "mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND_SCALE = 0.78
FUZZ = "10%"


def run(*args):
    result = subprocess.run(list(args), capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f"{' '.join(args)}\n{result.stderr.strip()}")
    return result.stdout.strip()


def convert(*args):
    return run("convert", *args)


def identify(path, fmt):
    return run("convert", path, "-format", fmt, "info:")


def ensure_dir(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", default=os.path.join("branding", "logo-source.png"))
    parser.add_argument("--out", default=ROOT, help="output root (default: the repository)")
    parser.add_argument("--scale", type=float, default=FOREGROUND_SCALE)
    args = parser.parse_args()

    source = args.source if os.path.isabs(args.source) else os.path.join(ROOT, args.source)
    if not os.path.isfile(source):
        print(f"source logo not found: {source}", file=sys.stderr)
        return 1
    if shutil.which("convert") is None:
        print("ImageMagick `convert` is required", file=sys.stderr)
        return 1
    out = args.out

    with tempfile.TemporaryDirectory() as tmp:
        # 1. square, 1024², corners transparent -------------------------------
        w, h = (int(v) for v in identify(source, "%w %h").split())
        side = max(w, h)
        squared = os.path.join(tmp, "squared.png")
        convert(source, "-background", "none", "-gravity", "center", "-extent", f"{side}x{side}", squared)
        master = os.path.join(tmp, "master.png")
        last = side - 1
        convert(
            squared, "-alpha", "set", "-fuzz", FUZZ, "-fill", "none",
            "-draw", "matte 0,0 floodfill", "-draw", f"matte {last},0 floodfill",
            "-draw", f"matte 0,{last} floodfill", "-draw", f"matte {last},{last} floodfill",
            "-filter", "Lanczos", "-resize", "1024x1024", master,
        )

        # 2. the tile's green: first opaque pixel on the middle row, 24 px in --
        green = None
        for x in range(0, 512, 4):
            alpha = float(identify(master, "%%[fx:p{%d,512}.a]" % x))
            if alpha > 0.98:
                green = identify(master, "%%[pixel:p{%d,512}]" % min(x + 24, 511))
                break
        if green is None:
            raise SystemExit("could not find the logo tile on the middle row of the source")
        print(f"logo green: {green}")

        # 3. adaptive icon layers --------------------------------------------
        # The tile is composited on a canvas of its own green; its outermost
        # 2 px (anti-aliased against the source's white corners) are eroded
        # away first so no light rim marks the seam.
        inner = os.path.join(tmp, "inner.png")
        convert(master, "-channel", "A", "-morphology", "Erode", "Disk:2", "+channel", inner)
        fg_size = 1008
        logo_px = int(round(fg_size * args.scale))
        bg_path = ensure_dir(os.path.join(out, RES, "drawable", "icon_background.png"))
        convert("-size", "1024x1024", f"xc:{green}", bg_path)
        fg_master = os.path.join(tmp, "fg.png")
        convert(
            "-size", f"{fg_size}x{fg_size}", f"xc:{green}",
            "(", inner, "-filter", "Lanczos", "-resize", f"{logo_px}x{logo_px}", ")",
            "-gravity", "center", "-composite", fg_master,
        )
        shutil.copyfile(fg_master, ensure_dir(os.path.join(out, RES, "drawable", "icon_foreground.png")))

        # round master: green disc + logo, circular alpha
        round_master = os.path.join(tmp, "round.png")
        convert(
            "-size", "1024x1024", "xc:none", "-fill", green, "-draw", "circle 512,512 512,0",
            "(", inner, "-filter", "Lanczos", "-resize", f"{int(1024 * args.scale)}x{int(1024 * args.scale)}", ")",
            "-gravity", "center", "-composite",
            "(", "-size", "1024x1024", "xc:black", "-fill", "white", "-draw", "circle 512,512 512,0", ")",
            "-alpha", "off", "-compose", "CopyOpacity", "-composite", round_master,
        )

        # 4. legacy mipmaps ---------------------------------------------------
        for density, px in LEGACY_SIZES.items():
            folder = os.path.join(out, RES, f"mipmap-{density}")
            convert(master, "-filter", "Lanczos", "-resize", f"{px}x{px}", ensure_dir(os.path.join(folder, "ic_launcher.png")))
            convert(round_master, "-filter", "Lanczos", "-resize", f"{px}x{px}", ensure_dir(os.path.join(folder, "ic_launcher_round.png")))
            convert(fg_master, "-filter", "Lanczos", "-resize", f"{px}x{px}", ensure_dir(os.path.join(folder, "ic_launcher_foreground.png")))

        # 5. loading plate / exit dialog ---------------------------------------
        convert(master, "-filter", "Lanczos", "-resize", "384x384",
                ensure_dir(os.path.join(out, RES, "drawable-nodpi", "logo_labzband.png")))

        # 6. web: game tiles + manifest icons ----------------------------------
        convert(master, "-filter", "Lanczos", "-resize", "512x512", ensure_dir(os.path.join(out, WEB, "logo.png")))
        for px in (192, 512):
            convert(fg_master, "-filter", "Lanczos", "-resize", f"{px}x{px}", ensure_dir(os.path.join(out, WEB, f"icon-{px}.png")))
        manifest_path = os.path.join(out, WEB, "manifest.webmanifest")
        source_manifest = os.path.join(ROOT, WEB, "manifest.webmanifest")
        if os.path.isfile(source_manifest):
            with open(source_manifest, encoding="utf-8") as fh:
                manifest = json.load(fh)
            manifest["icons"] = [
                {"src": "./logo.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
                {"src": "./icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
                {"src": "./icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
            ]
            manifest["background_color"] = green_hex(green) or manifest.get("background_color")
            manifest["theme_color"] = green_hex(green) or manifest.get("theme_color")
            with open(ensure_dir(manifest_path), "w", encoding="utf-8") as fh:
                json.dump(manifest, fh, ensure_ascii=False, indent=2)
                fh.write("\n")

    # 8-bit, metadata-free PNGs (aapt is happier, and the APK smaller).
    for folder, _dirs, files in os.walk(os.path.join(out, "app")):
        for name in files:
            if name.endswith(".png") and (name.startswith(("ic_launcher", "icon_", "icon-", "logo")) or name == "logo_labzband.png"):
                run("mogrify", "-depth", "8", "-strip", os.path.join(folder, name))

    print(f"logo applied under {out}")
    if os.path.abspath(out) == os.path.abspath(ROOT):
        print("next: python3 tools/game-patches/apply_chistan_patches.py  (validates/refreshes the packaged game chunk)")
    return 0


def green_hex(pixel):
    """`srgb(15,76,58)` / `srgba(15,76,58,1)` -> `#0F4C3A`."""
    try:
        inner = pixel[pixel.index("(") + 1:pixel.rindex(")")]
        parts = [p.strip() for p in inner.split(",")][:3]
        values = []
        for p in parts:
            if p.endswith("%"):
                values.append(int(round(float(p[:-1]) * 255 / 100)))
            else:
                values.append(int(round(float(p))))
        return "#%02X%02X%02X" % tuple(values)
    except Exception:
        return None


if __name__ == "__main__":
    sys.exit(main())
