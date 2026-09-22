# QuickGames — Android WebApp Container

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
| Entry point | `App.kt` | Firebase bootstrap, notification channels, Najva init (native only) |
| UI + boot pipeline | `MainActivity.kt` | Loading plate → HTTP server → WebView → `NativeApp.appReady()` |
| HTTP server | `LocalWebServer.kt` | HTTP/1.1, gzip, byte ranges, ETag/304, MIME table, SPA fallback |
| Server lifetime | `WebAppServerController.kt` | One server per process, stable origin across Activity recreation |
| Asset access | `WebAssetSource.kt` | APK assets in production, a directory in JVM tests |
| MIME types | `MimeTypes.kt` | wasm / mjs / webmanifest / fonts / media / 3D + gzip policy |
| JS bridge | `WebAppBridge.kt` | `window.AndroidBridge` — ads, billing, navigation, readiness |
| Advertising | `TapsellManager.kt` + `TapsellConfig.kt` | Tapsell Plus: interstitial, rewarded, native (IDs stay native) |
| Push | `NajvaManager.kt` + `NajvaConfig.kt` | Najva system notifications, channels, deep links (100% native) |
| Deep links | `DeepLinkBus.kt` | Buffers tap routes until the WebApp reports readiness |
| Billing | `CafeBazaarBillingManager.kt` | Poolakey (CafeBazaar) — unchanged, fully preserved |

### Heavy-WebApp performance

* Real origin → Service Workers, Cache API, IndexedDB, cookies and `SharedArrayBuffer`
  isolation headers (COOP/COEP) all work.
* `localStorage`/IndexedDB survive rotation and process restore because the origin
  (`http://127.0.0.1:<port>` via the stable `/redirect` bootstrap) never changes.
* Gzip on compressible assets, `immutable` caching for content-hashed bundles,
  `ETag`/`304` revalidation, `Range`/`206` support for media seeking.
* Hardware acceleration, `largeHeap`, DOM storage, media playback without a gesture,
  mixed content blocked, fullscreen video, file chooser, safe-area insets.

---

## 2. WebApp contract

Replace the contents of `app/src/main/assets/web/` with your own build and keep `index.html`
as the entry document. At the end of your initialization call:

```js
NativeApp.appReady();       // hides the native loading plate (no arbitrary delay)
```

Available namespaces (thin facade in `assets/web/js/native-bridge.js`):

```js
NativeApp.appReady()                 // readiness handshake
NativeApp.getInfo()                  // { platform, sdkInt, appVersion, serverPort, ... }
NativeApp.getStartupRoute()          // deep-link route that opened the app
NativeApp.reportError(message)       // show the native error/retry plate
NativeApp.navigateBack()             // native back navigation
NativeApp.on('deeplink' | 'back' | 'resume' | 'pause', handler)
NativeApp.onBackPressed = () => true // let the WebApp consume the hardware back first

NativeAds.showInterstitial()         // Promise, always settles: { ok, reason, type }
NativeAds.showRewarded()             // { ok, rewardGranted, reason }
NativeAds.showNative()               // native ad plate inside the app view
NativeAds.showNativeAt(x, y, w, h)   // positioned in CSS pixels
NativeAds.hideNative()
NativeAds.isReady() / prepare() / isAvailable()

CafeBazaar.buyProduct(id) / consumePurchase(token) / getPurchases() / isAvailable()
```

**No advertising or push identifier is ever exposed to the WebApp**: Tapsell app key/zone ids and
the Najva API key/website id live only in the native layer.

---

## 3. Native configuration

Identifiers are resolved (in order) from Gradle CLI properties, `gradle.properties`,
`local.properties`, then environment variables — and are never committed:

```properties
# local.properties
sdk.dir=/path/to/Android/sdk
TAPSELL_APP_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
TAPSELL_ZONE_INTERSTITIAL=xxxxxxxxxxxxxxxxxxxx
TAPSELL_ZONE_REWARDED=xxxxxxxxxxxxxxxxxxxx
TAPSELL_ZONE_NATIVE=xxxxxxxxxxxxxxxxxxxx
NAJVA_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
NAJVA_WEBSITE_ID=12345
FIREBASE_APP_ID=1:1234567890:android:abcdef
FIREBASE_API_KEY=AIza...
FIREBASE_PROJECT_ID=your-project
FIREBASE_SENDER_ID=1234567890
```

Missing keys are **not** fatal: ads report `NOT_AVAILABLE`, push logs one actionable line and the
container keeps working (`./gradlew assembleDebug` succeeds with an empty configuration).

## 4. Build, test, verify

```bash
./gradlew testDebugUnitTest    # 25 JVM tests: HTTP server, MIME table, ranges, SPA routing
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease      # R8 + resource shrinking
python3 tools/static_checks.py # repository invariants (no removed SDK, resources resolve, ...)
```

CI (`.github/workflows/build-apk.yml`) runs on every push:

1. `Static architecture checks` + `Unit tests` — the tests boot the **real** `LocalWebServer`
   against the shipped `assets/web` bundle, so a broken bundle fails the build.
2. `assembleDebug` + `assembleRelease`, then `Verify APK contents` asserts that
   `assets/web/**` and the Vazirmatn fonts are packaged and that the removed advertising SDK is
   absent from every dex.
3. `Emulator smoke test` — installs the APK on an API 30 emulator, boots it and verifies the
   runtime contract (server up → WebView on `127.0.0.1` → readiness handshake → deep link
   routing → ad bridge degrading gracefully without keys → no crash, no bridge thread
   violation), capturing a screenshot timeline that is published as commit comments.

## 5. Local (Vite) showcase

The `src/` Vite app in this repository is an interactive preview of the container: the boot
pipeline, the ad/push simulators, the packaged file tree and the build guide.

```bash
npm install
npm run dev
```
