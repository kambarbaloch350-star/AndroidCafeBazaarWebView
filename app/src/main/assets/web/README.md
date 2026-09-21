# `assets/web/` — the WebApp

Everything inside this folder is served by the app's **embedded loopback HTTP
server** (`127.0.0.1:<random port>`) and rendered by the native `WebView`:

```
Android App → Local HTTP Server → WebView → assets/web/index.html
```

Replace the contents of this folder with your own build output (Vite, Webpack,
Next.js, Angular, Phaser, Unity WebGL, Godot, …). No native code change is
required as long as `index.html` stays the entry document.

## Required contract

1. `index.html` exists (the server falls back to it for SPA routes).
2. At the moment your app becomes interactive, call:

   ```js
   NativeApp.appReady();   // provided by ./js/native-bridge.js
   ```

   The **native loading plate stays visible until this call arrives** — there is
   no arbitrary timeout. A retry state appears if booting fails.

That is the whole contract. Everything else is optional.

## Provided bridge (`./js/native-bridge.js`)

| API | Description |
| --- | --- |
| `NativeApp.appReady()` | signals readiness to the container |
| `NativeApp.getInfo()` | `{ platform, appVersion, serverPort, pushEnabled, adsReady, … }` |
| `NativeApp.getStartupRoute()` | deep-link route that opened the app |
| `NativeApp.on('deeplink', fn)` | push-notification / external deep links |
| `NativeApp.onBackPressed` | optional hook for the hardware back button |
| `NativeAds.showInterstitial()` | → `Promise<{ ok, reason }>` |
| `NativeAds.showRewarded()` | → `Promise<{ ok, rewardGranted }>` |
| `NativeAds.showNative()` | → `Promise<{ ok }>` (native ad plate) |
| `NativeAds.hideNative()` | removes the native ad plate |
| `NativeAds.on('error' \| 'rewarded:granted' \| …, fn)` | ad lifecycle events |
| `CafeBazaar.*` | CafeBazaar in-app billing (Poolakey) |

Ad promises **always settle** (success, failure or timeout), and ad errors are
reported as resolved results rather than rejections, so advertising can never
break your WebApp.

### Bundler note

If you use a bundler, import the bridge instead of loading it with a `<script>`
tag:

```js
import './native-bridge.js';       // attaches window.NativeApp / window.NativeAds
// or copy the file into your source tree and import it once at startup
```

The bridge is plain ES5-compatible JavaScript with no dependencies.

## What the native layer provides

* Real HTTP origin → ES modules, `fetch`, IndexedDB, localStorage, cookies,
  Service Workers, `history.pushState`, `WebAssembly.instantiateStreaming`.
* gzip + ETag caching and correct MIME types (`wasm`, `mjs`, fonts, media…).
* SPA history fallback: extension-less routes return `index.html`.
* Cross-origin isolation headers (`COOP`/`COEP`) for `SharedArrayBuffer`.
* Hardware acceleration, Canvas/WebGL, fullscreen video, file uploads.
* Native Tapsell ads and Najva push — all identifiers stay native.

## Sample app

The shipped `index.html` + `js/app.js` are a small reference app that verifies
the container end to end (ES modules, WebAssembly, IndexedDB, Canvas, WebGL,
local server, native ads, deep links). Delete them when you drop in your build.
