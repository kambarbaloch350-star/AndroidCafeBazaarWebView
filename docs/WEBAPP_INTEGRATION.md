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

> Identifiers never cross the bridge: Tapsell zone IDs, the Najva keys and the
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

Events: `nativeads:event` on `window`, or `NativeAds.on('event', fn)`. Types
include `interstitial_closed`, `rewarded_completed`, `rewarded_closed`,
`ad_error`, `ad_request_queued`. Ad failures **never** block the game — always
treat a missing ad as "no reward, no crash".

If the user bought **`remove_ads`**, the container suppresses interstitials
natively (`interstitial_skipped`); you can also check
`AndroidBridge.isRemoveAdsOwned()`.

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
if (purchase.success) addCoins(2000);                            // grant in your own state

CafeBazaar.getPurchases();   // -> 'cafebazaar:purchases' event (restores unlocks)
```

Coin packs are consumed automatically by the container (buyable again);
`remove_ads` stays in the purchase list and is remembered in
`SharedPreferences`, so a reinstall or a restart keeps ads off.

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

---

## 6. Push notifications (Najva)

100 % native: the container subscribes, shows the system notification and opens
the app with a route. Your only job is to handle the route:

```js
const route = NativeApp.getStartupRoute();     // e.g. "level/12"
window.addEventListener('nativeapp:deeplink', e => go(e.detail.route));
```

---

## 7. Quick reference

| Call | Purpose |
|------|---------|
| `AndroidBridge.appReady()` | boot finished – hide the loading screen |
| `NativeApp.setBackHandler(fn)` | hardware back → previous page |
| `NativeAds.showInterstitial()` | full-screen ad (every 2 levels) |
| `NativeAds.showRewarded()` | rewarded video (spin wheel) |
| `CafeBazaar.purchase(sku)` | coin pack / remove-ads |
| `CafeBazaar.getPurchases()` | restore permanent unlocks |
| `CafeBazaar.openRatingPage()` | CafeBazaar rating intent |
| `NativeApp.getInfo()` | `{ platform, appVersion, serverPort, pushEnabled, adsReady, removeAdsOwned }` |
