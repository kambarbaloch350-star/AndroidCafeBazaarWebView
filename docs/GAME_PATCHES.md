# Product changes applied to the packaged game

The game in `app/src/main/assets/web/` is a **built** Vite/React bundle
(`assets/index-*.js`); its source lives outside this repository. Product changes
that were requested for the packaged game are therefore applied to the built
chunk by `tools/game-patches/apply_chistan_patches.py` – exact, anchored,
idempotent string edits (a `None` target *deletes* its anchor) – and covered by
the jsdom contract tests (`tools/game-tests/chistan_scenarios.json`). This page
lists them so they can be ported into the game's source; once a change ships in
the source, delete its entry (the script fails loudly when an anchor is gone).

Run after every new game build is copied into `assets/web/`:

```bash
python3 tools/branding/apply_logo.py                    # only after branding/logo-source.png changes
python3 tools/game-patches/apply_chistan_patches.py     # applies / validates the patches below
python3 tools/game-patches/apply_chistan_patches.py --check   # CI guard, exit 0 = up to date
python3 tools/static_checks.py
node tools/game-tests/run.mjs                           # boots the chunk in jsdom (21 scenarios)
```

The script holds **12 product patches + the ES2019 syntax floor** (16 rewritten
sites, see below) and verifies 19 invariants over the result; a run without
`--check` re-hashes the chunk and rewrites `index.html` when anything changed.

The patched chunk gets a **new content hash** and `index.html` is rewritten
because the local server serves hashed chunks with `Cache-Control: immutable`: a
WebView that cached the previous build must see new file names.
`tools/game-patches/apply_patches.py` is the retired **labzband** patcher – this
bundle has no `App-*.js` any more, neither locally nor in CI.

---

## ChistanSara (چیستان‌سرا) – current bundle (`index-*.js`)

Packaged from `chistan-src` (Vite + React, 1347 riddles). The container is
Persian-first: loading screen «چیستان‌سرا / در حال بارگذاری بازی… / ۱۳۴۷ چیستان
جذاب فارسی», no "A Game By BalochAfzar" credit (`loading_credit` empty, view
gone), app name چیستان‌سرا, package `com.chistan.quickgames`.

### Fair economy (1 coin = 50 tomans, no free coin packs)

* `level-reward-fair` – level reward 20 → **30 coins** (+10 streak bonus).
* `hint-cost-letter-60`, `hint-cost-eliminate-100`, `hint-cost-clue-150`,
  `hint-spend-clue-150`, `hint-cost-answer-150` – hint costs 100/150/250/250 →
  **60/100/150/150**.
* `store-packs-fair` – the four free packs → **9 priced SKUs** with toman display
  and a CafeBazaar `sku`:

  | SKU | coins | price | badge |
  |-----|------:|------:|-------|
  | `pack_starter` | 200 | ۱۰,۰۰۰ تومان | کیسه کوچک |
  | `chistan_pack_500` | 500 | ۲۵,۰۰۰ تومان | کیسه سکه |
  | `pack_popular` | 1000 | ۵۰,۰۰۰ تومان | محبوب‌ترین |
  | `chistan_pack_1500` | 1500 | ۷۵,۰۰۰ تومان | صندوق گنج |
  | `pack_super` | 2500 | ۱۲۵,۰۰۰ تومان | گنجینه فرزانگان |
  | `chistan_pack_4000` | 4000 | ۲۰۰,۰۰۰ تومان | خزانه پادشاه |
  | `pack_royal` | 5000 | ۲۵۰,۰۰۰ تومان | گنجینه سلطنتی |
  | `pack_vault` | 10000 | ۵۰۰,۰۰۰ تومان | خزانه سلطنتی |
  | `remove_ads` | 0 | ۲۰,۰۰۰ تومان | حذف تبلیغات |

  The packs are consumable, `remove_ads` is not; the panel prices must match
  (`CafeBazaarConfig.kt` holds the same table for the native side).

### Billing – CafeBazaar

* The store buys through `await window.CafeBazaar.purchase(sku)` and credits coins
  only for `res.success === true && res.verified === true` (Poolakey validated the
  signature). Cancelled/failed/unverified purchases show a toast and credit
  nothing – there is no free fallback any more.
* `store-remove-ads-not-consumed` – the `remove_ads` branch consumed the purchase
  token. `remove_ads` is a **permanent (non-consumable)** unlock: consuming it
  erases the entitlement on CafeBazaar and lets the same user be charged again, so
  the stray `CafeBazaar.consume()` call is removed. Coin packs keep consuming (a
  consumable must be consumed to be bought again); `CafeBazaarBillingManager`
  additionally refuses to consume a token it knows belongs to a non-consumable.

### Ads – one interstitial every 3 completed levels (`interstitial-cadence-in-facade`)

* The cadence lives in `app/src/main/assets/web/native-bridge.js`:
  `ChistanBridge.showInterstitialIfNeeded()` is called from the save mirror (the
  `localStorage.setItem` hook), requires
  `Object.keys(completedLevels).length % interstitialEvery === 0` (`interstitialEvery = 3`),
  is de-duplicated through `lastCompletedCount` and is skipped for owners of
  `remove_ads` (native `CafeBazaar.isRemoveAdsOwned()` or the local
  `chistan_remove_ads` flag).
* The level-complete handler requested an interstitial itself **and** through
  `ChistanBridge.showInterstitialIfNeeded()` – two requests in the same tick, and
  a third once the save was mirrored. The patch **deletes the whole in-game block**:
  the facade owns the policy, measured by the level count that is actually saved.

### Coin credits – no double credit, no lost credit

* `triple-coins-state` – the ×3 bonus dispatched `chistan:coins` and then wrote
  the coins straight into `localStorage`, which the game's save effect overwrote on
  the next state change (the HUD never showed them). The patch drops that write.
* `coin-event-listener` – adds the missing `chistan:coins` listener to the App
  component, which credits the coins through the game's own coin updater
  (`p(coins)`), so the HUD and the save both see them.
* `free-coins-credit` – the store's rewarded row promises «دریافت +۱۵۰ سکه رایگان»
  but credited nothing; the patch credits 150 coins once
  `rewardGranted === true`.
* `ChistanBridge.addCoins()` is a no-op acknowledgement in the facade: the
  container never mints coins, they are only ever credited through verified
  `CafeBazaar.purchase()` or the game's own economy.

### Bridges – the facade contract

`app/src/main/assets/web/native-bridge.js` is the **only** consumer of the
container's `window.AndroidBridge` object; the game talks to the facade:

* `NativeApp`: isNative, isProduction, getPackageName, appReady/appLoaded, getInfo,
  getDeviceProfile, getRenderPixelRatio, getStartupRoute, reportError, navigateBack,
  setBackHandler, onBackPressed, openEmail, composeEmail, openStorePage,
  openRatingPage, isRemoveAdsOwned, saveState/loadState/clearState, on/onEvent.
* `NativeAds`: showInterstitial, showRewarded, showNative, showNativeAt, hideNative,
  isReady, isAvailable, prepare, on/onEvent. Every call returns a promise that
  *always* settles (`{ ok, type, rewardGranted, reason, success }`), a second
  request while one is pending answers `BUSY`, and the event envelope is de-duped.
* `CafeBazaar`: isNativeBridgeAvailable, isAvailable, connect/connectAsync,
  purchase, consume, getPurchases, isRemoveAdsOwned, openRatingPage, openStorePage.
* `CafeBazaarBridge` / `TapsellBridge` / `PoolakeyBridge`: the callback and legacy
  names the game and older builds may use, all routed into the namespaces above.
* `ChistanBridge`: getEconomy, purchaseCoins, purchaseRemoveAds,
  showInterstitialIfNeeded, addCoins.
* No advertising or push identifier reaches the WebApp (`TAPSELL_CONFIG` and
  `BAZAAR_RSA_KEY` are gone from the chunk).

### Persistence – force-stop survival

* Save key `chistansara_game_save_v2` (alt `labzband_progress_v4`) is mirrored
  natively on every `localStorage.setItem` (`NativeApp.saveState`) and restored at
  boot when the web copy is missing or older.
* The `localStorage.setItem` hook defines the property on the instance **and** on
  `Storage.prototype` (jsdom-safe).

### WebView baseline – the ES2019 syntax floor (`es2019-syntax-floor`)

* The app runs on whatever WebView the device has (minSdk 24, Android 7+); the CI
  emulator deliberately runs the old one every job installs on: **Chromium 83**
  (API 30). `app/src/main/assets/native/compat.js` polyfills that generation's
  *runtime* APIs (`Object.hasOwn`, `Array.prototype.at`, `String.replaceAll`,
  `structuredClone`, `Promise.any/allSettled`, `crypto.randomUUID`, …) – but syntax
  cannot be polyfilled.
* Vite/React 19 ship ES2021 **logical assignment** (`a ??= b`, `a ||= b`,
  `a &&= b`, Chrome 85). On Chromium 83 the module does not even parse: the page
  stays empty, the game never boots and `appReady()` never arrives, so the
  container shows its error plate instead (page-load watchdog 30 s, `APP_READY_TIMEOUT_MS` 45 s). That is exactly what
  the emulator jobs reported (empty `#root`, `FAIL the WebApp never reported
  readiness`, `SyntaxError: Unexpected token '='`).
* The `es2019-syntax-floor` transform rewrites all 16 sites (20 operators) to the
  ES2019 equivalent – `a ??= b` → `a ?? (a = b)`, `a ||= b` → `a || (a = b)`,
  `a &&= b` → `a && (a = b)` – as one all-or-nothing unit: a partially applied
  state fails loudly. Every left-hand side is a plain identifier or member access
  on an ordinary object (`e`, `t`, `oe`, `e.title`, `this.musicTimer`, …), where
  the two forms are indistinguishable.
* `tools/static_checks.py` (`check_webview_baseline`) and the patcher's `verify()`
  both fail when a logical assignment, a class static block or a private-in
  expression is packaged, and warn about post-baseline APIs that `compat.js` does
  not cover – so a refreshed game build cannot silently break old devices again.

### Readiness handshake – who lifts the loading plate

* The container keeps its native plate on screen until `AndroidBridge.appReady()`
  arrives (minimum 3 s) and falls back to its error plate when it stays silent
  (`PAGE_LOAD_TIMEOUT_MS` 30 s, `APP_READY_TIMEOUT_MS` 45 s), so the
  handshake may not depend on the game finishing its own start-up.
* `native-bridge.js` registers it at the **top** of the file, before any of its
  namespaces are built: ~1 s after the document is ready, again on
  `DOMContentLoaded`/`load`, and retried (bounded, 400 ms) while the bridge stays
  unreachable. `NativeApp.appReady()` itself is idempotent, so the game's own call
  (`window.NativeApp.appReady()` right after its settings hydrate) shares it.
* Peripheral boot work (ad pipeline warm-up, billing connect, purchase restore)
  runs separately and cannot delay or break the handshake.
* `tools/game-tests/run.mjs` boots the page **without the game's scripts** and
  asserts the facade still announces readiness, installs the save mirror and keeps
  ads/billing running – the regression test for the failure above.

### Tests

* `tools/game-tests/chistan_scenarios.json` – 21 scenarios: boot, fair prices
  (toman, no «دریافت رایگان»), economy (30 / 60-100-150-150), the full bridge
  contract, interstitial every 3 levels (exactly one request), no interstitial for
  `remove_ads` owners, `remove_ads` bought but never consumed, coin purchase flow
  (success / cancelled / unverified / no free exploit / balance after refresh),
  the rewarded 150 coins, the ×3 bonus reaching the save, the progress mirror and
  the Persian loading screen – plus four facade-only boot checks (readiness without
  the game, the native save mirror, ads/billing support, no page errors).
  **101 checks, all green.**
* `tools/game-tests/run.mjs` auto-detects the bundle and selects that scenario file;
  `tools/static_checks.py` warns when the chunk requests interstitials itself or
  when a patch is pending, and fails on post-ES2019 syntax in the packaged assets.

---

## Labzband (لبزبند) – legacy bundle (`App-*.js`)

## 1. Store (دکان) – flat price, no discounts

* `pack_vault`: `nameFarsi` "صندوقچه الماس (تخفیف ۵۰٪)" → "صندوقچه الماس".
* `pack_vault` badge "بیشترین تخفیف" → "بزرگ‌ترین بسته" (same amber badge style);
  `pack_royal` badge "ارزش عالی" removed. "محبوب ترین" / "پرفروش" stay (they do
  not claim a discount).
* Coin packs at **1 coin = 50 tomans**, no bonus coins anywhere:

  | SKU | coins | price |
  |-----|------:|------:|
  | `pack_starter` | 200 | ۱۰,۰۰۰ تومان |
  | `pack_popular` | 1,000 | ۵۰,۰۰۰ تومان |
  | `pack_super` | 2,500 | ۱۲۵,۰۰۰ تومان |
  | `pack_royal` | 5,000 | ۲۵۰,۰۰۰ تومان |
  | `pack_vault` | 10,000 | ۵۰۰,۰۰۰ تومان |
  | `remove_ads` | – | ۲۰,۰۰۰ تومان |

  The CafeBazaar developer panel prices must match this table (the game only
  *displays* these numbers; Bazaar charges what the panel says).

Source equivalent: edit the `COIN_PACKAGES` array (ids `pack_*`).

## 2. Store – "حذف تبلیغات" product (`remove_ads`, ۲۰,۰۰۰ تومان)

* A product row `#coin-package-remove_ads` after the coin packs, in the coin-pack
  row design (icon tile, name, subtitle, badge "یک بار برای همیشه") with the same
  purchase button (`#btn-buy-remove_ads`, "۲۰,۰۰۰ تومان / خرید با بازار").
* When owned (saved progress `adsRemoved === true` **or** the container's
  `CafeBazaar.isRemoveAdsOwned()`), the row turns green with a "خریداری شده"
  pill (`#remove-ads-owned`) instead of the button.
* The confirmation sheet shows "نوع خرید: حذف دائمی تبلیغات" instead of a coin
  count, the success view says "تبلیغات برای همیشه حذف شد" and the button
  "ادامه بازی بدون تبلیغات".
* Purchase logic (module scope, next to the coin-pack helpers):
  * `Ez(result)` – a **verified** purchase result / restored purchase for
    `remove_ads` sets `adsRemoved: true` in the saved progress (no consume:
    the product is permanent).
  * `Mz()` – `CafeBazaar.purchase('remove_ads')` → `Ez`.
  * `tn(id)` routes `remove_ads` to `Mz()`; `sn()` (restore on
    `getPurchases()`) and the `cafebazaar:purchase` listener call `Ez` too, so
    a purchase made on another device is restored at boot.
  * Unverified results (no RSA key in the container) are **not** persisted –
    exactly like coin packs – but the container still suppresses interstitials
    for an owned product, and the UI honours `isRemoveAdsOwned()`.
* The CafeBazaar developer panel must define the product `remove_ads`
  (non-consumable) at ۲۰,۰۰۰ تومان; the displayed price is the panel's.

Source equivalent: `REMOVE_ADS = { id: 'remove_ads', priceTomans: 20000, … }`,
`useProgress().adsRemoved`, a `<RemoveAdsRow>` in `CoinStoreModal`.

## 3. Level-complete page – "حذف تبلیغات" button

`LevelCompleteOverlay` gained `adsRemoved` / `onRemoveAds` props and renders
`#btn-remove-ads-level` – the main-menu "giant button" design (teal gradient,
`game-btn-3d`, icon tile, two-line label, price pill "۲۰,۰۰۰ تومان") – below
"Next level" and above replay / menu, only while ads are not removed. Tapping
it starts the CafeBazaar purchase directly; on success the button disappears
and no interstitial is requested from then on; a cancelled purchase is silent;
any other failure shows the game's generic error toast.

## 4. About (مئے بابت ءَ) – "رابطہ کنگ"

A full-width teal button `#btn-about-contact` (mail icon + "رابطہ کنگ") under
the About text, with the address `balochappps@gmail.com` printed beneath it.
It calls `NativeApp.openEmail('balochappps@gmail.com')` (native composer, see
`docs/WEBAPP_INTEGRATION.md` §5b) and falls back to a `mailto:` navigation
when the bridge is unavailable (browser preview).

## 5. Quiz (لوز) – shuffled answers

The quiz data lists the correct meaning as the first option of every question,
so the unpatched quiz could be passed by always tapping option 1. `Jz(question)`
returns a copy with Fisher–Yates-shuffled options; the quiz memoises it per
question index (`useMemo(…, [index])`, added before the component's early
return so the hook order is stable). The order is random per session and
stays put while a question is on screen.

Source equivalent: `const question = useMemo(() => shuffleOptions(QUESTIONS[i]), [i])`.

## 6. Wording

| where | before | after |
|-------|--------|-------|
| main menu stats | استالاں | استال |
| quiz title | معنی فارسی لوز را انتخاب بکن ات | بلوچی لبز ءِ فارسی معنا ءَ گچین |
| quiz result – retry | دوبارہ جہد کن ات | پدا لئیب کن |
| quiz result – close | بند کن ات | بند کنی |
| level complete subtitle | درائیں لوز سہی گچین کرت ات | درائیں لبز درگپت انت۔ |
| hint button / tooltip / wheel prize / store subtitle / toasts | کمک … | سوج … |

## 7. Logo

`tools/branding/apply_logo.py <logo.png>` turns one square logo PNG into the
launcher icon (adaptive + legacy + round, every density), the native loading
plate / exit-dialog artwork (`drawable-nodpi/logo_labzband.png`), the game's
`logo.png` and the web-manifest icons. When `assets/web/logo.png` exists,
`apply_patches.py` also switches the game's main-menu tile and the About
header from the old "ل / LABZBAND" text tiles to `<img src="/logo.png">`.

Source equivalent: `<img src="/logo.png">` in `MainMenu` and `AboutDialog`.

Hands-free path: commit the artwork as `branding/logo-source.png` (GitHub →
*Add file* → *Upload files* on the branch is enough). The **Apply branding**
step of `.github/workflows/build-apk.yml` runs both scripts, records the
source hash in `branding/logo-source.sha256`, commits the generated icons and
patched bundle back to the branch and builds the APK with them. It is a no-op
until the PNG changes.

## 8. Progress persistence (force stop / process death)

Root cause of "I reached level 4, force-stopped the app and it started from
level 1": the container served the game from `http://127.0.0.1:<random port>`;
the port is part of the origin and the origin keys `localStorage`, so every
cold start (force stop, low-memory kill, reboot, update) got an empty store.
While the process stayed alive (home button and back) the port – and the
progress – stayed the same, which is why it looked like a force-stop problem.

Fixes (both are needed):

* **Stable origin** – `LocalWebServer.STABLE_PORTS` (27182 first, three
  alternatives, ephemeral only as a last resort). The canonical port gets a
  short bind-retry budget (12 × 40 ms) and `stop()` joins the accept thread:
  closing a `ServerSocket` only *signals* the thread blocked in `accept()`,
  and the kernel keeps the listener – and the port – until that call returns,
  so an immediate restart used to land on 27183 (seen once in CI as a flaky
  `LocalWebServerTest`).
* **Native mirror** – the game's single store (`Os(localStorage)`, key
  `labzband_progress_v4`) now also calls `NativeApp.saveState(key, json,
  savedAt)` on every write and stores the same stamp in
  `labzband_progress_v4:savedAt`. At boot (`Hz`) the newer *valid* copy wins,
  an unreadable web copy is replaced by the mirror instead of crashing the
  boot (`Invalid saved progress`), and a fresh state is created only when
  neither exists (reported through `NativeApp.reportError`). The mirror lives
  in SharedPreferences (`WebAppStateStore.kt`), written with `commit()` on a
  background thread – it survives a force stop, a changed port and Chromium's
  lazy localStorage commits, and is part of Android auto-backup.

Source equivalent: see `docs/WEBAPP_INTEGRATION.md` §6c (`save()` / `load()`).

## Element ids used by the tests

`#coin-package-remove_ads`, `#btn-buy-remove_ads`, `#remove-ads-owned`,
`#btn-remove-ads-level`, `#btn-about-contact`, `#btn-mode-quiz`, `#quiz-modal-dialog`,
`#btn-quiz-next` – keep them when porting.
