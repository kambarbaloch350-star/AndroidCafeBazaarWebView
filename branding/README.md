# Branding

Put the app logo here as **`branding/logo-source.png`** – one square PNG
(≥ 512 px, ideally 1024 px; the green لبزبند tile with the letter tiles).
Uploading it through GitHub (*Add file → Upload files* on the branch) is
enough: the *Apply branding* step of the build workflow then

1. renders every launcher icon (adaptive foreground/background, legacy and
   round, all densities) and the native loading-plate artwork,
2. writes the game's `logo.png` + web-manifest icons and patches the game's
   main-menu tile and About header to use it,
3. commits the result back to the branch (`branding/logo-source.sha256`
   remembers which source was applied, so nothing happens again until the PNG
   changes) and builds the APK with it.

Locally the same is `python3 tools/branding/apply_logo.py &&
python3 tools/game-patches/apply_patches.py` (needs ImageMagick `convert`).
