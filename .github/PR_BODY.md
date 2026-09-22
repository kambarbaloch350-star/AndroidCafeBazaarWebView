## What this PR does

Turns the app into a production-ready **native WebApp container** and adds the
native behaviour the game needs: an animated branded loading screen, in-game
back navigation, an exit confirmation that pushes the CafeBazaar rating, plus a
hardened billing/ad layer.

Architecture (fixed, as requested): **Android App → local HTTP server → WebView
→ `assets/web/index.html`**. No advertising SDK identifier ever crosses the JS
bridge; Adivery is gone, Tapsell and Najva are 100% native.

### 1. Loading screen — white canvas, green artwork, ~3 s

| | |
|---|---|
| White background | `loading_background_*`, `plate_surface*`, `system_bar` → `#FFFFFF` |
| Logo | `drawable-nodpi/logo_labzband.png` (small, centred, 86dp) |
| Title | **لبزبند** |
| Tagline | **بلوچی مئے وتی شہد ایں زبان ایں** |
| Loading line | **لیب لوڈ بوھگ ءَ ایں۔** |
| Credit (bottom) | **A Game By BalochAfzar** |

* Animation: logo pop-in with overshoot, slow float + breathing scale, a
  **shimmer sweep across the title** (`ShimmerTextView`), a sliding gradient
  progress line (`LoadingBarView`), staggered copy reveal, and a lifted
  cross-fade out. **No circles and no spinning ring anywhere.**
* System bars are white in both themes with **dark icons** (light icons on a
  white bar were invisible – fixed).
* `MIN_LOADING_VISIBLE_MS = 3000` is a **floor**, not an extra delay: the overlay
  is dismissed when the WebApp is ready *and* the floor elapsed. Verified on the
  emulator: `Loading screen visible for 1496 ms … keeps the stage 1504 ms longer`.
* Every glyph of the three Balochi/Persian lines was checked against the bundled
  Vazirmatn; RTL is forced in the layout.
* Boot failure still switches to the error/retry state, and retry replays the
  whole choreography.

### 2. Back button → previous page (not exit)

Back **never** leaves the app on its own – not even while the WebApp is still
booting. It asks the page first:

1. `window.NativeApp.onBackPressed()` (registered through
   `NativeApp.setBackHandler(fn)`) → returning `true` stops the chain;
2. a cancelable `nativeapp:back` DOM event (`event.preventDefault()` counts);
3. `history.back()` when the page pushed history entries.

Only when nothing handled it does the **exit confirmation** appear. During boot,
back leaves the app (nothing to go back to); while the exit sheet is open, back
cancels it.

`docs/WEBAPP_INTEGRATION.md` documents the full JS contract (readiness, back,
ads, billing, rating, deep links) so the game's `index.html` can adopt it — a
working reference handler is implemented in the bundled demo.

### 3. Exit confirmation (light green, animated, RTL)

`ExitConfirmationDialog` + `dialog_exit.xml`:

* brand badge with a breathing halo, floating while open;
* **می‌خواهید از بازی خارج شوید؟**
* **امتیاز دادن به لبزبند کمک زیادی به ما می‌کند.**
* three staggered actions, all Vazirmatn:
  * **امتیاز بده** → CafeBazaar rating intent (`ACTION_EDIT` +
    `bazaar://details?id=<package>`, package `com.farsitel.bazaar`), degrading to
    a toast when Bazaar is absent;
  * **انصراف** → close and stay;
  * **خروج** → the only path that leaves the app.
* window pop-in/out animations (`@anim/dialog_enter|dialog_exit`), press
  feedback, dim behind, back/tap-outside = cancel, all animators cancelled on
  dismissal so nothing leaks.

### 4. Billing & ads hardening

* `remove_ads` is now remembered (`SharedPreferences`) and **natively suppresses
  interstitials** (`interstitial_skipped` event); rewarded video stays opt-in.
* Prices are 2× the base rate; `CafeBazaarConfig.permanentUnlocks()` + 7 unit
  tests pin SKU rules, prices and graceful fallbacks.
* Bridge additions: `isRemoveAdsOwned()`, `getInfo().removeAdsOwned`,
  `CafeBazaarBridge.onOwnedProductsChanged` + `nativeapp:ownedproducts`.

### Verification

* `tools/static_checks.py` — architecture checks (no removed SDK, every resource
  reference resolves, bridge contract present, missing-import detector).
* JVM unit tests for the embedded HTTP server + MIME table and the billing rules.
* **jsdom WebApp contract** (`tools/game-tests/run.mjs`) now runs in CI: boots the
  packaged bundle with a scripted bridge and drives it (readiness, back
  navigation, ads, billing, rating). Game-only scenarios are reported as `SKIP`
  until the real game bundle is packaged.
* **Emulator smoke test** presses BACK and asserts both halves: in-page
  navigation when history exists, and the exit dialog on a fresh launch (then
  cancels it). Screenshots and the report are published as commit comments.
* CI run for `09d8cf8`: **Build Debug & Release APK ✅, Emulator smoke test ✅**.

### Review notes

* The bundled WebApp is still the placeholder demo (the game's own `index.html`,
  JS and CSS are supplied by the product owner). The demo implements the same
  contract, which is what the harness and the emulator run against.
* Tapsell/Najva keys are injected from repository secrets at build time and are
  never logged, shipped to JS, or embedded in the repo.

### Test plan

1. `python3 tools/static_checks.py`
2. `./gradlew testDebugUnitTest assembleDebug`
3. `node tools/game-tests/run.mjs` (jsdom contract)
4. `tools/emulator_smoke.sh` → look at `03-boot.png` (splash) and
   `12-backdialog.png` (exit sheet)
