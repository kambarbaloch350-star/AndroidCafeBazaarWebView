# Product changes applied to the packaged game

The game in `app/src/main/assets/web/` is a **built** Vite/React bundle; its
source lives outside this repository. Product changes that were requested for
the packaged game are therefore applied to the built chunk by
`tools/game-patches/apply_patches.py` (labzband) or `apply_chistan_patches.py`
(chistansara) – exact, anchored, idempotent string edits – and covered by the
jsdom contract tests (`scenarios.json` or `chistan_scenarios.json`). This page
lists them so they can be ported into the game's source; once a change is in
the source, delete its entry from the patch script (the script fails loudly
when an anchor is gone).

Run after every new game build is copied into `assets/web/`:

```bash
python3 tools/branding/apply_logo.py                    # once the logo source exists (see below)
python3 tools/game-patches/apply_patches.py             # labzband
python3 tools/game-patches/apply_chistan_patches.py     # chistansara
python3 tools/static_checks.py                          # warns when patches are pending or stale
node tools/game-tests/run.mjs                           # auto-detects bundle, 40+ checks for chistan
```

The patched `App-*.js` and `index-*.js` chunks get **new content hashes**
(and `index.html` is rewritten) because the local server serves hashed chunks
with `Cache-Control: immutable`; a WebView that cached the previous build must
see new file names.

---

## ChistanSara (چیستان‌سرا) – current bundle (`index-*.js`)

Packaged from `chistan-src` (Vite + React, 1347 riddles). The container is
Persian-first: loading screen "چیستان‌سرا / در حال بارگذاری بازی… / ۱۳۴۷ چیستان
جذاب فارسی", no "A Game By BalochAfzar" credit (`loading_credit` empty, view
gone), app_name چیستان‌سرا.

### Fair economy (1 coin = 50 tomans, no free coin packs)

* Level reward 20 → **30 coins** (+10 streak bonus) – generous enough to progress without purchases.
* Hint costs: letter 100→**60**, eliminate 150→**100**, clue 250→**150**, answer 250→**150**.
* Store packs rewritten from 4 free packs to **9 priced SKUs** with toman display:

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

  All coin packs consumable, remove_ads non-consumable. CafeBazaar panel prices must match.
  Button text changed from "دریافت رایگان" to price (e.g. "۱۰,۰۰۰ تومان").

* Free coins via rewarded video now **requires** `NativeAds.showRewarded()` – 150 coins only after ad completion.

### Ads – interstitial every 3 levels

* Original cadence every 2 levels (`%2`) → **every 3 levels** (`%3`), gated by `remove_ads` ownership.
* `native-bridge.js` overrides `localStorage.setItem` (via `Storage.prototype` defineProperty, jsdom-safe) to mirror `chistansara_game_save_v2` to `NativeApp.saveState` and trigger `NativeAds.showInterstitial()` when `Object.keys(completedLevels).length % 3 === 0`.
* Respects `CafeBazaar.isRemoveAdsOwned()` + local `chistan_remove_ads` flag + `getInfo().removeAdsOwned`.

### Billing – CafeBazaar integration

* Store buy function rewritten to `await CafeBazaar.purchase(sku)` → `consume()` for coins, sets `chistan_remove_ads=1` for remove_ads, shows fanfare toast.
* `CafeBazaarConfig.kt` updated: legacy `coin_pack_*` prices kept for unit-test compatibility (10k/30k/70k/150k/250k/500k), new chistan SKUs priced `coins*50` (fair, 1=50 tomans), `isConsumable` now checks `SUPPORTED_PRODUCTS`.

### Bridges – full contract

`native-bridge.js` unified bridge (436 lines) exposes:
* `NativeApp`: isNative, appReady (auto on DOMContentLoaded/load + explicit), appLoaded, getInfo, getStartupRoute, reportError, navigateBack, setBackHandler, openEmail, openStorePage, openRatingPage, saveState/loadState/clearState, on.
* `NativeAds`: showInterstitial, showRewarded, showNativeAt, hideNative, isReady, isAvailable, prepare, on.
* `CafeBazaar`: isNativeBridgeAvailable, isAvailable, connect, getInfo, isRemoveAdsOwned, openRatingPage, openStorePage, purchase, consume, getPurchases + aliases.
* Compat: `TapsellBridge` (init/showBanner/hideBanner/requestInterstitial/showInterstitial/requestRewarded/showRewarded/showNativeAt/moveNative/hideNative) → NativeAds, `PoolakeyBridge` (connect/disconnect/purchase/consume/getPurchasedProducts/getSkuDetails) → CafeBazaar, `BazaarBridge/CafeBazaarBridge` callbacks.
* `ChistanBridge` economy helper: getEconomy, purchaseCoins, purchaseRemoveAds, isRemoveAdsOwned.
* Constants: `BAZAAR_RSA_KEY`, `TAPSELL_CONFIG`.

### Persistence – force-stop survival

* Save key `chistansara_game_save_v2` (alt `labzband_progress_v4`) mirrored to native via `saveState` on every `setItem`, restored on boot if web storage empty but native has data.
* `localStorage.setItem` hook fixed for jsdom (assignment creates storage entry in jsdom – now uses `Object.defineProperty` on instance + `Storage.prototype`).

### Tests

* `chistan_scenarios.json` – 10 scenarios, 43 checks: boot, fair prices (toman), economy (30/60/3), bridges present, interstitial every 3, no ad when remove_ads, coin purchase flow, rewarded ad for free coins, progress mirror, Persian loading.
* `static_checks.py` updated to accept both `App-*.js` and `index-*.js` bundles.

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
