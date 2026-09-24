# WebApp integration contract

Everything the game's `index.html` needs to talk to the Android container.
The container loads the bundle from `assets/web/index.html` through a local HTTP
server and exposes exactly one JavaScript object: **`window.AndroidBridge`**.

`app/src/main/assets/web/js/native-bridge.js` is a thin, optional convenience
layer on top of it (`NativeApp`, `NativeAds`, `CafeBazaar`). Copy it into your
bundle or call `AndroidBridge` directly — both are supported, and every method
is safe to call when the page runs in a normal browser (`AndroidBridge` is simply
`undefined`).

```js
const native = !!window.AndroidBridge;
```

> Identifiers never cross the bridge: Tapsell zone IDs, the Pushfa key and the
> CafeBazaar public key live only in the native layer.

---

## 1. Loading screen & readiness  ⚠️ **required**

The native loading screen (white, animated, ~3 s) stays visible until the WebApp
says it is ready. Call this **once**, after your framework mounted and the first
screen has rendered:

```js
window.AndroidBridge.appReady();   // or: window.NativeApp.appReady()
```

If it never arrives the container shows its error/retry state instead of
revealing a half-drawn game. There is a safety net (a finished page that stays
silent for 6 s is treated as ready with a warning), but the explicit call is what
you want.

---

## 2. Hardware back button  ⚠️ **required for in-game navigation**

Pressing back runs this chain inside the container:

1. `window.NativeApp.onBackPressed()` — if it returns `true`, the container stops.
2. a cancelable `nativeapp:back` DOM event — `event.preventDefault()` counts as handled.
3. `history.back()` when the page pushed history entries.
4. otherwise the container shows the **exit confirmation** ("می‌خواهید از بازی خارج شوید؟").

Register a handler that walks your own screen stack and returns `true` whenever
it moved one page back:

```js
// Option A – the helper (needs js/native-bridge.js)
NativeApp.setBackHandler(() => {
  if (closeTopModal()) return true;            // modal/overlay closed
  if (screen === 'level')    { go('chapters'); return true; }
  if (screen === 'chapters') { go('menu');     return true; }
  return false;                                // main menu -> exit dialog
});
```

```js
// Option B – no helper, plain DOM
window.NativeApp = window.NativeApp || {};
window.NativeApp.onBackPressed = () => { /* … */ return handled; };
window.addEventListener('nativeapp:back', (e) => { e.preventDefault(); /* … */ });
```

React sketch:

```jsx
useEffect(() => {
  const handler = () => {
    setScreen(prev => {
      if (prev === 'level') { setScreen('chapters'); return prev; }  // handled
      return null;                                                   // not handled
    });
    return screenRef.current !== 'menu';
  };
  window.NativeApp?.setBackHandler?.(handler);
  return () => window.NativeApp?.setBackHandler?.(null);
}, []);
```

Returning `false` at the root is what makes the container show the exit dialog —
so "back on the main menu" never kills the app abruptly.

---

## 3. Advertising (Tapsell, native)

```js
// Interstitial – after every 2 levels passed
NativeAds.showInterstitial();   // resolves { ok, reason } – never throws

// Rewarded video – the spin wheel requires a *complete* view
const result = await NativeAds.showRewarded();
if (result.rewardGranted) grantSpin();

// Optional native banner rendered by the container
NativeAds.showNative();  NativeAds.hideNative();
```

Events: `nativeads:event` on `window`, or `NativeAds.on('event', fn)`. Every
event is an envelope `{ type, data }`; `data` always carries `adType`
(`interstitial` | `rewarded` | `native` | `sdk`) and `provider: "tapsell"`.
The container delivers each event through **both** channels
(`NativeAds.onEvent(json)` and the `nativeads:event` DOM event) so either
integration style works – a facade that listens to both must de-duplicate
(the shipped `native-bridge.js` does).

| Type | Meaning |
|------|---------|
| `interstitial_loaded` / `rewarded_loaded` / `native_loaded` | an ad is cached and ready |
| `interstitial_shown` / `rewarded_shown` / `native_shown` | the ad Activity is in front of the game |
| `rewarded_completed` | the video was watched to the end – `data.rewardGranted === true` |
| `interstitial_closed` / `rewarded_closed` / `native_closed` | the game is back in front (`rewarded_closed` repeats `rewardGranted`) |
| `interstitial_skipped` | the container suppressed the ad (`data.reason`: `REMOVE_ADS_OWNED`) – treat it as closed |
| `ad_request_queued` | no ad cached yet; the container is loading one and will show it as soon as it arrives |
| `ad_error` | `data.error` is a stable code: `*_NOT_CONFIGURED`, `SDK_NOT_READY`, `*_LOAD_FAILED`, `*_SHOW_FAILED`, `INTERSTITIAL_TIMEOUT` (no ad within 6 s), `REWARDED_TIMEOUT` (18 s), `SDK_INIT_FAILED` (`adType: "sdk"`) |

A `show*()` request is therefore **always settled** – by `*_closed`,
`*_skipped` or `ad_error` – within a bounded time; the container never leaves
the game waiting for an ad that is not coming, and a queued request that
fails to load is dropped instead of popping up in the middle of the next
level. Ad failures **never** block the game — always treat a missing ad as
"no reward, no crash".

If the user bought **`remove_ads`**, the container suppresses interstitials
natively (`interstitial_skipped`); you can also check
`AndroidBridge.isRemoveAdsOwned()`.

### 3b. Surviving a full-screen ad (interstitial / rewarded)

A full-screen ad is **another Activity on top of the game**. From the page's
point of view this is exactly a background/foreground cycle: `visibilitychange`
→ `hidden`, `nativeapp:pause`, no `requestAnimationFrame` callbacks while
covered, then `visibilitychange` → `visible`, `nativeapp:resume`, a
`focus`, sometimes one or two `resize` events (video ads may rotate the display
to landscape and back). The container keeps your page alive underneath the ad
(no reload, timers keep running) – but the game has to behave when it comes back.
The rules that matter for heavy engines:

* **Pause on the promise, resume on the promise – once.** Stop the game loop
  *before* `NativeAds.showInterstitial()` and start it again when the promise
  settles. Do **not** also restart it from `interstitial_closed`, `resume` and
  `visibilitychange`: three resume handlers start three loops, and a doubled
  loop is exactly what "buttons flicker / the screen flashes" looks like.

  ```js
  async function levelFinished() {
    game.pause();                                     // stop rAF, mute audio
    await NativeAds.showInterstitial();               // { ok, reason } – never throws
    game.resume();                                    // one place, one time
  }
  ```

* **Never rebuild the renderer on `resize`.** Handle `resize`/`nativeapp:resize`
  by resizing the existing canvas/renderer (`renderer.setSize`, Phaser
  `scale.refresh()`); debounce it (~100 ms) because the ad transition delivers
  several in a row. Creating a new WebGL context or a new Phaser/Pixi/Three
  instance per resize leaks GPU memory and ends in a renderer crash.
* **Handle WebGL context loss.** While the game is covered, Android may take
  the GPU context away from it. Listen to `webglcontextlost` (call
  `event.preventDefault()`) and `webglcontextrestored` (re-upload textures,
  restart the loop). Three.js fires both on `renderer.domElement`; PixiJS and
  recent Phaser releases ship their own recovery – check the version you use.
  Without this the game comes back as a white or black canvas.
* **Do not call `requestFullscreen()` from resume/resize handlers.** The
  container already fills the screen. Element fullscreen is supported, but a
  game that re-requests it every time it is exited (opening an ad can exit it)
  toggles the system bars and re-lays out the page in a loop –
  visibly a flashing screen. Request fullscreen only from a user gesture, if
  at all.
* **Budget memory for the ad.** A video interstitial easily costs a hundred
  MB in the same process. Free what you can on `nativeapp:memorywarning`, keep texture
  atlases ≤ 2048², and prefer compressed audio. If the renderer is killed by
  the OS the container reloads the game behind the loading screen (and after
  3 crashes in 3 minutes shows an error plate instead of looping) – you will
  see `Render process gone` and a memory summary in Logcat under the
  `MainActivity` tag.
* **Do not drive a canvas from a Worker (`OffscreenCanvas`).** A Worker-owned
  `OffscreenCanvas` layer (`canvas.transferControlToOffscreen()` – what
  `canvas-confetti` does with `useWorker: true`, what PixiJS/Construct do in
  "worker mode") is not repaired after the GPU context loss a full-screen ad
  or any background trip causes on many Android WebViews: the layer flickers
  or paints white until the page is reloaded. The container therefore removes
  the transfer API before your bundle evaluates, and every canvas library
  falls back to its main-thread path. If your engine really needs it, opt in
  with `<meta name="native-offscreen-canvas" content="on">` in `<head>` and
  handle context loss yourself.

What the container does on its side, so you can rely on it:

* the Activity is **locked to portrait** – an ad that rotates to landscape
  never hands a landscape → portrait relayout back to the page (no
  `orientationchange`, at most the `resize` events listed above);
* on every `interstitial_closed` / `rewarded_closed` / `interstitial_skipped`
  / `ad_error`, and 600 ms after every `onResume`, the WebView is resumed and
  its timers re-asserted (`WebView.onResume()` + `resumeTimers()`), then a
  frame is requested – whatever the ad SDK's Activity did on its way out;
* the page's `console.warn` / `console.error`, uncaught errors and unhandled
  rejections reach Logcat (`adb logcat -s WebApp`) in release builds too.

---

## 4. Coin packs (CafeBazaar billing through Poolakey)

Recommended SKUs (prices are 2× the base rate, authoritative price comes from
CafeBazaar):

| SKU | Coins | Fallback price (T) |
|-----|-------|--------------------|
| `coin_pack_250` | 250 | 10 000 |
| `coin_pack_750` | 750 | 30 000 |
| `coin_pack_2000` | 2 000 | 70 000 |
| `coin_pack_5000` | 5 000 | 150 000 |
| `coin_pack_10000` | 10 000 | 250 000 |
| `coin_pack_25000` | 25 000 | 500 000 |
| `remove_ads` | — | 49 000 |

```js
CafeBazaar.connect();
const purchase = await CafeBazaar.purchase('coin_pack_2000');   // resolves on success
if (purchase.success && purchase.verified) addCoins(2000);       // grant in your own state

CafeBazaar.getPurchases();   // -> 'cafebazaar:purchases' event (restores unlocks)
```

A purchase result (and every entry of a `getPurchases()` answer) looks like

```json
{ "success": true, "verified": true, "productId": "coin_pack_2000",
  "purchaseToken": "…", "orderId": "…", "purchaseTime": 1727000000000,
  "payload": "", "message": "Purchase completed successfully" }
```

`verified` is `true` only when Poolakey validated the purchase signature with
the RSA public key of the CafeBazaar console (`CafeBazaarConfig.kt`
`CAFEBAZAAR_PUBLIC_KEY`). With the key left empty the container still
completes purchases but reports `verified: false`; a game that – correctly –
grants coins only for verified purchases will then **not credit anything**,
so the key is a release requirement, not an option.

Coin packs whose SKU starts with `coin_pack_` are consumed automatically by the
container (buyable again). Any other consumable (the game's `pack_*` SKUs, for
example) is left to the game: call `CafeBazaar.consume(purchaseToken)` after
crediting it, and only credit a token once – `getPurchases()` re-delivers a
purchase until it is consumed. `remove_ads` stays in the purchase list and is
remembered in `SharedPreferences`, so a reinstall or a restart keeps ads off.

Events: `cafebazaar:connection`, `cafebazaar:purchase`, `cafebazaar:consume`,
`cafebazaar:purchases`, `cafebazaar:ownedproducts`.

---

## 5. Rating & the CafeBazaar store page

```js
CafeBazaar.openRatingPage();   // ACTION_EDIT + bazaar://details?id=<package>
CafeBazaar.openStorePage();    // ACTION_VIEW
```

Both return `false` (and the container toasts) when CafeBazaar is not installed.
The native **exit dialog already has an "امتیاز بده" button** that fires the same
intent, so the in-game rating button should simply call `openRatingPage()`.

### 5b. Contact / support e-mail

```js
NativeApp.openEmail('balochappps@gmail.com');              // -> true when accepted
AndroidBridge.composeEmail('balochappps@gmail.com', 'لبزبند'); // with a subject
```

The container composes the message natively: `ACTION_SENDTO` with a `mailto:`
URI (only mail apps answer it), Gmail first when it is installed, then the
system resolver, then a generic `ACTION_SEND` chooser. When nothing can send
mail the address is copied to the clipboard and the user is told so. A plain
`location.href = 'mailto:…'` also works (the WebView hands every non-http
scheme to the system), but it leaves the page when no mail app is installed –
prefer the bridge call and fall back to `mailto:` only when it returns `false`.

---

## 6. Push notifications (Pushfa)

100 % native: the container subscribes, shows the system notification and opens
the app with a route. Your only job is to handle the route:

```js
const route = NativeApp.getStartupRoute();     // e.g. "level/12"
window.addEventListener('nativeapp:deeplink', e => go(e.detail.route));
```

In the Pushfa panel (or the send API) use a **relative** link such as
`/level/12` – it reaches the WebApp as the route `level/12`. Full
`labzband://level/12` links work too, and absolute `https://` links open the
browser instead of the game.

---

## 6b. Heavy games & Node-built bundles (Vite / webpack / React / Phaser / Unity …)

The container is designed for bundles that were produced by a Node toolchain
and dropped into `assets/web/` unchanged (`npm run build` → copy `dist/*`).
Things that are handled natively and that you should know about:

* **Base path** – build with a *relative* base (`base: './'` in Vite,
  `publicPath: './'` or `'/'` in webpack, `"homepage": "."` in CRA). Absolute
  roots also work because the WebApp is served from `/`.
* **Routing** – unknown paths fall back to `index.html` (SPA history routing
  works); `.mjs`, `.wasm`, `.data`, `.pck`, `.unityweb`, `.glb`, source maps and
  media all have proper MIME types, gzip and byte-range support.
* **Threads / SharedArrayBuffer** – the origin is cross-origin isolated
  (COOP `same-origin`, COEP `credentialless`), so WebAssembly threads work while
  CDN scripts, fonts, images and third-party APIs keep loading.
* **A frozen page never freezes the app.** The renderer runs in its own process;
  if your JavaScript blocks the main thread the container logs it, keeps the
  back button working (the page gets 900 ms to answer) and after 20 s of silence
  terminates the renderer and reloads the game behind the loading screen. A
  renderer crash (OOM, GPU fault) is recovered the same way. You still want to
  avoid getting there – see the tips below.
* **Lifecycle events** – stop your game loop and audio when the app goes to the
  background, resume when it comes back:

  ```js
  NativeApp.on('pause',  () => game.pause());   // or window 'nativeapp:pause'
  NativeApp.on('resume', () => game.resume());  // or window 'nativeapp:resume'
  ```

* **Memory pressure** – Android tells the container when memory is tight; free
  texture atlases, decoded audio and object pools on this signal:

  ```js
  NativeApp.on('memorywarning', ({ level, critical }) => {
    cache.clear();
    if (critical) game.unloadInactiveScenes();
  });
  ```

* **Rendering profile** – on every page load the container tags the document
  with its device class, `<html data-native-tier="low|mid|high">`, and on
  `low`/`mid` phones injects a stylesheet that turns `backdrop-filter` off
  (a blurred overlay over an animated board re-renders the whole layer every
  frame on a budget GPU – the classic cause of a "laggy" modal). Opt out with
  `<meta name="native-perf" content="off">` if you must keep the blur, or use
  the attribute yourself: `html[data-native-tier="low"] .particles { display: none }`.
  The WebView (and the view behind it) is also painted in the page's own
  background colour, so a resume, a rotation or the return from an ad never
  flashes white.

* **Device tier** – size your canvas for the phone instead of the pixel count:

  ```js
  const profile = NativeApp.getDeviceProfile();
  // { tier: 'low'|'mid'|'high', suggestedPixelRatio, lowRam, totalRamMb,
  //   memoryClassMb, cpuCores, refreshRate, screenWidthPx, screenHeightPx, ... }
  const dpr = NativeApp.getRenderPixelRatio();          // 1 on low-end phones
  canvas.width  = Math.round(innerWidth  * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  if (profile.tier === 'low') settings.particles = 'few';
  ```

  Phaser: `resolution: NativeApp.getRenderPixelRatio()`; PixiJS:
  `new Application({ resolution: NativeApp.getRenderPixelRatio(), autoDensity: true })`;
  Three.js: `renderer.setPixelRatio(NativeApp.getRenderPixelRatio())`;
  Unity WebGL: `config.devicePixelRatio = NativeApp.getRenderPixelRatio()`.

* **Keep the main thread free** – prefer `requestAnimationFrame` over timers,
  move decoding/AI/pathfinding into a Web Worker (workers are fully supported),
  use `will-change`/`transform` animations instead of layout-triggering
  properties, and lazy-load levels (`import()` chunks are served with
  `immutable` caching, so code splitting is free).

---

### 6c. Old WebViews: the compat layer and the version advice

Android System WebView is updated separately from Android, and devices that
cannot reach Google Play keep the Chromium they shipped with (Chromium 7x–9x
on many Android 7–10 phones; the CI emulator runs Chromium 83 on purpose).
Two container features cover them:

* **`/__native/compat.js`** is injected by the local server at the end of
  `<head>` of every HTML document, before your module bundle runs. It adds
  guarded ES5 polyfills for the built-ins a Vite/webpack bundle uses unguarded
  (`Object.hasOwn`, `Array.prototype.at`, `String.prototype.replaceAll`,
  `Array.prototype.findLast`, `structuredClone`, `Promise.any`,
  `queueMicrotask`, `Element.replaceChildren`, `AbortSignal.timeout`,
  `crypto.randomUUID`, …), applies the rendering policy above, and mirrors
  uncaught errors to Logcat. Syntax the WebView cannot parse (`??=`, class
  static blocks, …) cannot be polyfilled – keep your build target at
  `chrome87`/`es2020` if you care about those devices. `<html
  data-native-compat="…">` and `window.__nativeCompat` list what was applied.
* **Version advice** – `oklch()` colours (Tailwind v4) need Chromium 111. On
  an older WebView the container shows, once per WebView version, a dialog
  that opens the store page of *Android System WebView*; the game keeps
  running underneath.

---

## 6c. Saved progress that survives a force stop  ⚠️ **required for any save game**

`localStorage` alone is not a safe place for a save game inside a WebView:

* it is keyed by **origin** – `http://127.0.0.1:<port>`. The container now binds a
  fixed loopback port (`LocalWebServer.STABLE_PORTS`, 27182 first) so the origin
  is the same after every launch; a random port per process (the old behaviour)
  handed the game an *empty* store after each force stop / low-memory kill /
  reboot – "I reached level 4 and it started from level 1";
* Chromium commits localStorage lazily (batched and rate-limited). A hard kill
  ("Force stop" in Settings) ends the renderer before pending commits reach disk.

So mirror every save natively and restore the newer copy at boot:

```js
const KEY = 'labzband_progress_v4';

function save(state) {
  const json = JSON.stringify(state), at = Date.now();
  localStorage.setItem(KEY, json);
  localStorage.setItem(KEY + ':savedAt', String(at));
  NativeApp.saveState(KEY, json, at);           // SharedPreferences, written at once
}

function load() {
  const web = localStorage.getItem(KEY), webAt = Number(localStorage.getItem(KEY + ':savedAt')) || 0;
  const mirror = NativeApp.loadState(KEY);       // { key, value, savedAt } or null
  if (mirror && (!web || mirror.savedAt > webAt)) {
    localStorage.setItem(KEY, mirror.value);     // heal the web copy
    localStorage.setItem(KEY + ':savedAt', String(mirror.savedAt));
    return JSON.parse(mirror.value);
  }
  return web ? JSON.parse(web) : null;
}
```

Rules: keys `[A-Za-z0-9_.:-]{1,64}`, values up to 1 MB (a save game is a few
KB), `saveState` returns `true` when accepted, writes for the same key coalesce.
In a browser (no bridge) `saveState` returns `false` and `loadState` `null`.
The packaged game does exactly this (`docs/GAME_PATCHES.md` §8) and the
emulator smoke test force-stops the app and checks the progress afterwards.

---

## 7. Copy protection & touch behaviour (native, no work for the WebApp)

The container treats the page as a game surface, not a document:

* text selection, the copy/paste toolbar and the context menu are refused
  (`ContainerWebView` refuses both action modes and consumes long presses);
* the platform's long-press **vibration** is suppressed – holding anywhere on the
  page no longer buzzes (a deliberate `navigator.vibrate()` from the WebApp still
  works);
* the container injects a stylesheet that disables `user-select`,
  `-webkit-touch-callout` and image dragging on every page it loads, and it
  re-applies it after each navigation.

You do **not** need to add anything for this, but if you want the same behaviour
when the bundle is opened in a plain browser, put this at the top of your CSS:

```css
*:not(input):not(textarea) {
  -webkit-user-select: none; user-select: none;
  -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
}
img, a { -webkit-user-drag: none; }
```

## 8. Quick reference

| Call | Purpose |
|------|---------|
| `AndroidBridge.appReady()` | boot finished – hide the loading screen |
| `NativeApp.setBackHandler(fn)` | hardware back → previous page |
| `NativeAds.showInterstitial()` | full-screen ad (every 2 levels) |
| `NativeAds.showRewarded()` | rewarded video (spin wheel) |
| `CafeBazaar.purchase(sku)` | coin pack / remove-ads |
| `CafeBazaar.getPurchases()` | restore permanent unlocks |
| `CafeBazaar.openRatingPage()` | CafeBazaar rating intent |
| `NativeApp.openEmail(address)` | native e-mail composer (support / contact button) |
| `NativeApp.saveState(key, json, savedAt)` / `loadState(key)` | native mirror of the save game (survives force stop / origin change) |
| `NativeApp.getInfo()` | `{ platform, appVersion, serverPort, pushEnabled, adsReady, removeAdsOwned, device }` |
| `NativeApp.getDeviceProfile()` | `{ tier, suggestedPixelRatio, totalRamMb, cpuCores, refreshRate, ... }` |
| `NativeApp.getRenderPixelRatio()` | DPR to render a heavy canvas at (≤ real DPR) |
| `NativeApp.on('pause' \| 'resume')` | app went to background / foreground |
| `NativeApp.on('memorywarning')` | `{ level, critical }` – drop caches |
