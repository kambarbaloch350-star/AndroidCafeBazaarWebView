# چیستان‌سرا (ChistanSara) — Android WebApp Container

`com.chistan.quickgames` · app name **چیستان‌سرا** · ۱۳۴۷ چیستان فارسی

> This branch packages **ChistanSara** (چیستان‌سرا) – 1347 Persian riddles, fair economy (1 coin = 50 tomans), interstitial every 3 levels, Persian loading screen, no "A Game By" credit. The container is published as package `com.chistan.quickgames`.

A production-ready **Android container for heavy local WebApps**.

```
Android App  →  Local HTTP Server (127.0.0.1)  →  WebView  →  assets/web/index.html
```

The WebApp is shipped *inside* the APK (`app/src/main/assets/web/`) and is served over a real
loopback HTTP origin, so bundlers (Vite / Webpack / Next / Angular), ES modules, WebAssembly,
Canvas/WebGL, media, IndexedDB and SPA routing all behave exactly as they do in a browser —
without `file://` limitations and without intercepting `shouldInterceptRequest`.

---

## 1. What is in the container

| Layer | File | Responsibility |
| --- | --- | --- |
| Entry point | `App.kt` | Firebase bootstrap, notification channels, Pushfa init (native only) |
| UI + boot pipeline | `MainActivity.kt` | Loading plate → HTTP server → WebView → `NativeApp.appReady()` |
| HTTP server | `LocalWebServer.kt` | HTTP/1.1, gzip, byte ranges, ETag/304, MIME table, SPA fallback |
| Server lifetime | `WebAppServerController.kt` | One server per process, stable origin across Activity recreation |
| Asset access | `WebAssetSource.kt` | APK assets in production, a directory in JVM tests |
| MIME types | `MimeTypes.kt` | wasm / mjs / webmanifest / fonts / media / 3D + gzip policy |
| JS bridge | `WebAppBridge.kt` | `window.AndroidBridge` — ads, billing, navigation, readiness |
| Advertising | `TapsellManager.kt` + `TapsellConfig.kt` | Tapsell Plus: interstitial, rewarded, native (IDs stay native) |
| Push | `PushfaManager.kt` + `PushfaSettings.kt` | Pushfa system notifications, channels, deep links (100% native) |
| Deep links | `DeepLinkBus.kt` | Buffers tap routes until the WebApp reports readiness |
| Billing | `CafeBazaarBillingManager.kt` | Poolakey (CafeBazaar) — unchanged, fully preserved |

### Heavy-WebApp performance

* Real origin → Service Workers, Cache API, IndexedDB, cookies and `SharedArrayBuffer`
  (COOP `same-origin` + COEP `credentialless`: WebAssembly threads work **and** CDN scripts,
  web fonts, remote images and third-party APIs keep loading).
* `localStorage`/IndexedDB survive rotation and process restore because the origin
  (`http://127.0.0.1:<port>` via the stable `/redirect` bootstrap) never changes.
* Gzip on compressible assets, `immutable` caching for content-hashed bundles,
  `ETag`/`304` revalidation, `Range`/`206` support for media seeking.
* Hardware acceleration, `largeHeap`, renderer priority `IMPORTANT`, DOM storage, media
  playback without a gesture, mixed content blocked, fullscreen video, file chooser,
  safe-area insets.

### Heavy animations never hang the app

* **Renderer watchdog** – Chromium reports a renderer that stops answering input (blocked JS
  main thread). Short stalls are logged; after 20 s the container terminates the renderer and
  reboots the WebApp behind the loading plate instead of ending in an ANR dialog.
* **Renderer crash recovery** – `onRenderProcessGone` (OOM, GPU fault, system kill) rebuilds
  the WebView and reloads the WebApp; the process is never torn down. A crash while another
  Activity covers the game (a full-screen ad) is rebooted once the container is visible again,
  and after 3 crashes within 3 minutes the error plate takes over instead of a reload loop –
  each recovery logs a memory summary under the `MainActivity` tag.
* **Ad-aware lifecycle** – a full-screen ad is another Activity on top of the game. The
  container keeps the page alive underneath it (no reload), never calls the process-wide
  `pauseTimers()` while an ad presents (it would freeze the ad's own WebView), and the watchdog
  does not judge a covered page. `docs/WEBAPP_INTEGRATION.md` §3b lists what the game itself
  must do (pause/resume once, resize without rebuilding the renderer, handle WebGL context loss).
* **Bounded ad requests** – `showInterstitial()` / `showRewarded()` are settled within 6 s /
  18 s at the latest (`ad_error` `INTERSTITIAL_TIMEOUT` / `REWARDED_TIMEOUT`) and a queued
  request whose ad fails to load is dropped, so the game never sits behind a "please wait"
  overlay and no stale interstitial pops up in the middle of the next level.
* **Rendering profile** – every page load gets `<html data-native-tier="low|mid|high">`; on
  low/mid phones `backdrop-filter` blur is switched off (opt-out
  `<meta name="native-perf" content="off">`) and the WebView is painted in the page's own
  background colour, so resume / rotation / return-from-ad never flash white.
* **Portrait lock + post-ad settling** – the Activity is locked to portrait, so an ad
  Activity that rotates for a landscape creative can never hand a landscape → portrait
  relayout back to the game; every `*_closed` / `ad_error` event (and every `onResume`)
  re-asserts `onResume()` + `resumeTimers()` on the WebView and requests a frame, whatever the
  SDK's Activity did on its way out.
* **Compat layer for old WebViews** – `LocalWebServer` injects `assets/native/compat.js` at the
  end of `<head>` of every HTML document: guarded ES5 polyfills (`Object.hasOwn`,
  `Array.prototype.at`, `String.prototype.replaceAll`, `structuredClone`, `Promise.any`, …)
  that a Vite bundle uses unguarded and that Chromium < 93 lacks, a rendering policy (Worker
  `OffscreenCanvas` transfer is off unless `<meta name="native-offscreen-canvas" content="on">`
  – such layers are not repaired after the GPU context loss a full-screen ad causes), and
  uncaught-error mirroring to logcat. `<html data-native-compat="…">` lists what was applied.
* **WebView version advice** – the Tailwind v4 bundle paints every colour with `oklch()`
  (Chromium 111+). On an older Android System WebView the container shows a one-time dialog
  with a button to the store page instead of letting the game look broken.
* **Back button always works** – if the page does not answer the back request within 900 ms,
  the native exit dialog takes over.
* **Lifecycle & memory signals** – `nativeapp:pause` / `nativeapp:resume` /
  `nativeapp:memorywarning` DOM events (also `NativeApp.on('pause' | 'resume' |
  'memorywarning')`) let the game stop its loop, mute audio and drop caches.
* **Device profile** – `NativeApp.getDeviceProfile()` / `NativeApp.getRenderPixelRatio()` give
  the game a tier (`low | mid | high`), RAM, cores, refresh rate and a suggested pixel ratio so
  it can size its canvas for the phone it runs on (see `docs/WEBAPP_INTEGRATION.md`).

---

## 2. WebApp contract

Replace the contents of `app/src/main/assets/web/` with your own build and keep `index.html`
as the entry document. At the end of your initialization call:

```js
NativeApp.appReady();       // hides the native loading plate (no arbitrary delay)
```

`app/src/main/assets/web/native-bridge.js` is the **only** consumer of the container's
`window.AndroidBridge` object; everything else talks to the facade, which turns the callback /
event protocol into promises:

```js
NativeApp.appReady()                  // readiness handshake (hides the native loading plate)
NativeApp.isNative() / isProduction() / getPackageName()
NativeApp.getInfo()                   // { platform, sdkInt, appVersion, serverPort, device, ... }
NativeApp.getDeviceProfile()          // { tier, suggestedPixelRatio, totalRamMb, cpuCores, refreshRate, ... }
NativeApp.getRenderPixelRatio()       // DPR a heavy Canvas/WebGL game should render at
NativeApp.getStartupRoute()           // deep-link route that opened the app (consumed once)
NativeApp.reportError(message)        // native error/retry plate
NativeApp.navigateBack() / setBackHandler(fn) / onBackPressed()
NativeApp.openEmail(address, subject) / composeEmail() / openRatingPage() / openStorePage()
NativeApp.saveState(key, value, savedAt) / loadState(key) / clearState(key)
NativeApp.on('ready' | 'deeplink' | 'pause' | 'resume' | 'memorywarning' | 'resize' | 'event' | 'ownedproducts', handler)

NativeAds.showInterstitial()          // Promise, always settles: { ok, type, reason, success }
NativeAds.showRewarded()              // { ok, rewardGranted, reason } – credit only when rewardGranted === true
NativeAds.showNative() / showNativeAt(x, y, w, h) / hideNative()
NativeAds.isReady(type) / isAvailable() / prepare()

CafeBazaar.connect() / connectAsync() / isAvailable() / isRemoveAdsOwned()
CafeBazaar.purchase(sku)              // Promise -> { success, verified, productId, purchaseToken, ... }
CafeBazaar.consume(token)             // consumable packs only – never the permanent remove_ads unlock
CafeBazaar.getPurchases()
CafeBazaarBridge.onPurchaseResult(v) / onConsumeResult(v) / onConnectionResult(v)
CafeBazaarBridge.onPurchasesQueryResult(v) / onOwnedProductsChanged(v)

ChistanBridge.getEconomy()            // the fair economy (reward 30/level, hints 60/100/150/150)
ChistanBridge.purchaseCoins(sku, coins) / purchaseRemoveAds()
ChistanBridge.showInterstitialIfNeeded() / addCoins(coins)
```

**The container never mints coins**: a purchase is credited only when
`success === true && verified === true` (Poolakey validated the signature), and only
`remove_ads` is a permanent unlock. The interstitial cadence (every 3 completed levels, skipped
for `remove_ads` owners, one request per level count) lives in the facade and is driven by the
save mirror – the WebApp must not request ads itself.

**No advertising or push identifier is ever exposed to the WebApp**: Tapsell app key/zone ids and
the Pushfa public key live only in the native layer.

---

## 3. Native configuration

Identifiers are resolved (in order) from Gradle CLI properties (`-P`), `local.properties`,
environment variables, then `gradle.properties`. The production identifiers of چیستان‌سرا are the
committed defaults in `gradle.properties`:

```properties
# gradle.properties (committed defaults – public-side identifiers only)
TAPSELL_APP_KEY=tkonjgrn…jjtddh          # Tapsell Plus app key
TAPSELL_ZONE_INTERSTITIAL=6ab339cee237e15c69fbab2b   # «بنر آنی» (interstitial)
TAPSELL_ZONE_REWARDED=6ab339c3da860d2c9f00cfa9       # rewarded video
TAPSELL_ZONE_NATIVE=6ab339d96da4b558f3901bc1         # «بنر همسان» (native banner)
PUSHFA_API_PUBLIC_KEY=0820…b328aa        # Pushfa api_public_key (never the private key)
```

Override any of them per machine or per CI run without touching the repository:

```properties
# local.properties (never committed; CI writes repository secrets here)
sdk.dir=/path/to/Android/sdk
TAPSELL_APP_KEY=...
PUSHFA_API_PUBLIC_KEY=...
FIREBASE_APP_ID=1:1234567890:android:abcdef
FIREBASE_API_KEY=AIza...
FIREBASE_PROJECT_ID=your-project
FIREBASE_SENDER_ID=1234567890
```

Missing keys are **not** fatal: ads report `NOT_AVAILABLE`, push logs one actionable line and the
container keeps working (`./gradlew assembleRelease` succeeds with an empty configuration).

### CafeBazaar billing – release checklist

* `CafeBazaarConfig.kt` → `CAFEBAZAAR_PUBLIC_KEY` must hold the RSA public key of **this**
  app from the CafeBazaar developer console. Purchases are reported to the game with
  `verified: true` only when Poolakey validated the signature with that key; the game credits
  coins **only for verified purchases**, so with a wrong/empty key every paid pack would be
  charged but never credited.
* Create the SKUs the game sells as *consumable* in-app products in the console, at the
  prices the game displays (1 coin = 50 tomans, no bonus coins, no discounts):
  `pack_starter` 200 coins = 10,000, `pack_popular` 1,000 = 50,000, `pack_super` 2,500 = 125,000,
  `pack_royal` 5,000 = 250,000, `pack_vault` 10,000 = 500,000 tomans (the game consumes them
  itself after crediting); **`remove_ads` as a non-consumable at 20,000 tomans** – the store row
  and the level-complete "حذف تبلیغات" button sell it (`docs/GAME_PATCHES.md`).
* Test with a Bazaar test account before release – the emulator has no Bazaar client, the
  jsdom harness covers the game side of the flow (`tools/game-tests/chistan_scenarios.json`).

### Push (Pushfa) – Firebase project

Pushfa delivers through Firebase Cloud Messaging, so the app needs the Firebase project whose
**Service Account** is pasted into the Pushfa panel (Android service → Firebase).

* `app/google-services.json` is committed: Firebase project **`ninemanhills`**
  (`930784178753`), Android app `com.chistan.quickgames`. The Google Services plugin is applied
  automatically because the file exists; `python3 tools/static_checks.py` verifies that the file
  still contains a client for this package.
* To move to another Firebase project, replace the file (Firebase console → project settings →
  Android app `com.chistan.quickgames` → download) **and** upload that project's Service Account
  in the Pushfa panel – both sides must be the same project or tokens cannot be delivered.
* Without the file `App.kt` falls back to the `FIREBASE_*` values, and without those the app runs
  with push disabled (`GOOGLE_SERVICES_JSON` CI secret, when set, overrides the committed file).
* The Pushfa public key is wired through `PUSHFA_API_PUBLIC_KEY`. Notifications are rendered by
  the Pushfa SDK on the `labzband_default` channel with the app's monochrome icon; a notification
  link such as `/game/42` re-opens the app and reaches the WebApp as deep-link route `game/42`.
* Never commit the Pushfa private key or the Firebase Service Account JSON – they belong to the
  Pushfa panel / a server only (the static checks refuse a service-account file under `app/`).

## 4. Build, test, verify

```bash
./gradlew testDebugUnitTest    # JVM tests: HTTP server, compat injection, MIME table, ranges, SPA routing
./gradlew assembleRelease      # the only shipped variant: R8 + resource shrinking + signing
python3 tools/static_checks.py # repository invariants (no removed SDK, resources resolve, ...)
node tools/game-tests/run.mjs  # WebApp bridge contract (jsdom; needs jsdom + esbuild)
```

Product changes made to the **packaged game chunk** (fair economy, toman store, CafeBazaar
billing, the ad cadence, the coin credits) are applied by
`tools/game-patches/apply_chistan_patches.py`, the branding by
`tools/branding/apply_logo.py` – re-run both after copying a new game build into
`assets/web/` (see `docs/GAME_PATCHES.md`). The patcher is idempotent; `--check` is the CI
guard.

### Telegram delivery (repository secrets)

Every push builds **one** variant (release) and delivers that APK to your Telegram chat
instead of publishing an artifact. Add these repository secrets
(*Settings → Secrets and variables → Actions*):

| Secret | Purpose |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | bot token from [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | your chat / group id (write to the bot first, then `getUpdates`) |
| `TELEGRAM_MESSAGE_THREAD_ID` | *optional* – topic id for a forum group |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 release.jks` – the release signing key |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias inside the keystore |
| `ANDROID_KEY_PASSWORD` | *optional* – key password when it differs from the store password |

The release APK goes to Telegram and nowhere else – **it is never uploaded as a build
artifact**, not even when the send fails (a failed send fails the job; re-run it to rebuild and
send again). Without the Telegram secrets the send step is skipped with a `::warning::` – that
is the case for pull requests from forks, where repository secrets are not exposed. Without the
keystore secrets the release APK is signed with the Android debug key – installable, but not the
key CafeBazaar accepts.
`tools/send_apk_telegram.sh` can also be run locally:
`TELEGRAM_BOT_TOKEN=… TELEGRAM_CHAT_ID=… bash tools/send_apk_telegram.sh app/build/outputs/apk/release/app-release.apk`.

CI (`.github/workflows/build-apk.yml`) runs on every push:

1. `Static architecture checks` + `Unit tests` — the tests boot the **real** `LocalWebServer`
   against the shipped `assets/web` bundle, so a broken bundle fails the build.
2. `assembleRelease`, then `Verify APK contents` asserts that
   `assets/web/**` and the Vazirmatn fonts are packaged and that the removed advertising SDK is
   absent from every dex. The APK is then sent to Telegram (see above).
3. `WebApp bridge contract (jsdom)` — `tools/game-tests/run.mjs` bundles the packaged game
   with esbuild, boots it in jsdom against a scripted `AndroidBridge` that speaks the exact
   TapsellManager / Poolakey event protocol and plays `tools/game-tests/chistan_scenarios.json`: menu,
   spin wheel (reward granted / denied / ad error), coin packs (verified, unverified,
   cancelled, restored), remove-ads (store row, level-complete button, cancelled, unverified,
   restored at boot → no interstitial), About → contact e-mail, two levels → interstitial →
   third level, ad time-outs, duplicate event delivery, back button. It also boots the page
   **without the game's scripts** and asserts the facade keeps the container contract alive on
   its own (readiness handshake, native save mirror, ads/billing) – the container must survive a
   game that cannot boot. **101 checks.**
4. `Emulator smoke test` — installs the APK on an API 30 emulator (Chromium 83 WebView – the
   compat layer and the syntax baseline are exercised for real: the packaged chunk must be
   parseable by it, `tools/static_checks.py` fails the build otherwise), boots it and verifies the
   runtime contract (server up
   → WebView on `127.0.0.1` → readiness handshake → no crash, no bridge thread violation, exit
   dialog, copy protection, night mode, rotation, activity switch, **progress survives a
   force stop** – stable loopback origin + native state mirror), then
   `tools/game-tests/emulator_play.mjs` drives the real game over the DevTools protocol:
   levels 1–2, interstitial request, a foreign Activity covering the app like an ad,
   `interstitial_closed`, level 3 — no reload, no renderer loss, no JS exception. Screenshots
   are published as commit comments.
5. `Emulator ad lab` — a second APK built with `-PSMOKE_TEST_BUILD=true -PSMOKE_TEST_ADS=true`
   (Tapsell's **official test** app key / zones, push blanked) on an API 34 emulator.
   `tools/game-tests/ad_lab.mjs` plays the game into a **real** Tapsell test interstitial –
   the SDK's own ad Activity, its callbacks, our pause/resume – closes it, and records the
   container's lifecycle log, the page's events (`visibilitychange`, `resize`,
   `nativeads:*`), DOM churn, rAF rate and raw frame statistics (white ratio / churn) for
   the seconds after the ad. It fails only when the round trip happened and the game came
   back broken; no fill from the CI network is reported as *inconclusive*. The `build` job
   additionally prints `tools/inspect_ad_sdk.py`: the ad SDK's Activities in the merged
   manifest and a scan of its classes for `pauseTimers` / orientation / window calls.

The emulator report publishes the page console (the container mirrors it to logcat with the tag
`WebApp`, including uncaught JS errors) plus the WebView's parse/URL errors, so a red run says
*why* the WebView refused to run the bundle instead of only timing out.

Field diagnosis on a real phone (no debug build needed):

```bash
adb logcat -s MainActivity ContainerWebView TapsellManager WebAppBridge WebApp
```

prints the lifecycle (`onPause` … `onResume` with WebView size / focus / rotation), every
surface resize, every ad event (`ad event: interstitial_shown …`), the post-ad state with a
memory summary, and the page's own warnings, errors and unhandled rejections.

## 5. Local (Vite) showcase

The `src/` Vite app in this repository is an interactive preview of the container: the boot
pipeline, the ad/push simulators, the packaged file tree and the build guide.

```bash
npm install
npm run dev
```
