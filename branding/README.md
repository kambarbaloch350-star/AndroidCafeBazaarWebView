# Branding

Put the app logo here as **`branding/logo-source.png`** – one square PNG
(≥ 512 px, ideally 1024 px; the green tile with the letter tiles).
Uploading it through GitHub (*Add file → Upload files* on the branch) is
enough: the *Apply branding* step of the build workflow then

1. renders every launcher icon (adaptive foreground/background, legacy and
   round, all densities) and the native loading-plate artwork
   (`app/src/main/res/drawable-nodpi/logo_labzband.png`, the drawable the
   loading screen and the exit dialog use – the name is legacy, the artwork is
   the current logo),
2. writes the game's `logo.png` + web-manifest icons,
3. re-runs the game patcher (`tools/game-patches/apply_chistan_patches.py`),
4. commits the result back to the branch (`branding/logo-source.sha256`
   remembers which source was applied, so nothing happens again until the PNG
   changes) and builds the APK with it.

Locally the same is `python3 tools/branding/apply_logo.py &&
python3 tools/game-patches/apply_chistan_patches.py` (needs ImageMagick
`convert`).

The ChistanSara game renders its own logo from inside its bundle, so unlike the
retired labzband bundle there is no `logo.png` tile to patch: the branding step
covers the launcher, the native loading plate and the web-manifest icons.
