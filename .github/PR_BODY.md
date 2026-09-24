## What this PR does

1. **CI delivers the APK to Telegram instead of publishing it as an artifact.**
2. **The debug build is gone** – one release variant is built, verified and shipped.
3. **The packaged game uses the JS bridge correctly** – the facade, the game chunk
   and the native billing manager were all wrong in the same places, and the
   jsdom contract tests now pin the behaviour.
4. The rest of the repository was reviewed against those three changes (package
   name, proguard keeps, generated files, docs, showcase text).

### 1. Telegram delivery (`tools/send_apk_telegram.sh` + workflow)

* New `Send release APK to Telegram` step (`sendDocument`, caption with the commit,
  size and `sha256[:16]`), driven by the repository secrets
  **`TELEGRAM_BOT_TOKEN`**, **`TELEGRAM_CHAT_ID`** and the optional
  `TELEGRAM_MESSAGE_THREAD_ID`.
* `Telegram delivery configured?` decides at runtime: without the secrets the send
  is skipped with a `::warning::` (fork PRs). The send step is a **required**
  step – `continue-on-error` and the `Upload release APK (fallback)` step are
  gone: the release APK is never uploaded as a build artifact, so a failed send
  fails the job and the run is simply repeated.
* `tools/send_apk_telegram.sh` can be run locally; it validates the token with
  `getMe`, refuses files above Telegram's 50 MB bot limit and exits `0`/`1`/`2`/`3`
  (delivered / API error / unconfigured / too large).

### 2. No debug build

* `Build debug APK`, `Upload debug APK` and the debug half of `Verify APK contents`
  are removed; `assembleDebug` is not built anywhere in the workflow.
* The release APK is the only output that is verified (release path, Vazirmatn
  fonts counted instead of matched by directory – aapt2 shortens paths in
  release) and it is delivered to Telegram only.
* The emulator jobs are unchanged: they build their **own** debug variant with
  `-PSMOKE_TEST_BUILD=true` (ads/push blanked, or Tapsell test keys), which is what
  their DevTools-driven checks need.
* Release signing: `signingConfigs.release` is created when
  `RELEASE_KEYSTORE_PATH` exists (store/key password, alias from
  `local.properties` or `-P`); the workflow decodes `ANDROID_KEYSTORE_BASE64` into
  `$RUNNER_TEMP`, appends the four `RELEASE_*` keys and validates the keystore with
  `keytool`. Without a keystore the release variant is signed with the Android
  debug key so the delivered APK stays installable (with a warning).

### 3. Bridge usage

**`app/src/main/assets/web/native-bridge.js`** is now the only consumer of the
container's `window.AndroidBridge` object (previously the game and the facade both
called into it, with two different result shapes):

* every container call becomes a promise that *always* settles, with per-call
  timeouts and a single pending slot (`BUSY` for a concurrent request);
* the event envelopes (`NativeAds.onEvent` + the `nativeads:*` DOM events) are
  de-duplicated;
* the state store is mirrored natively on every save (`NativeApp.saveState`) and
  the newer copy is restored at boot;
* `NativeApp.appReady()` is forwarded, with a 3 s auto-ready safety net.

**The packaged game chunk** (`tools/game-patches/apply_chistan_patches.py`, now
with `--check` as a CI guard, `None`-target removals and a fresh content hash after
patching) is corrected where it used the bridge wrongly:

* `interstitial-cadence-in-facade` – the level-complete handler requested an
  interstitial **and** called `ChistanBridge.showInterstitialIfNeeded()`: two
  requests in one tick for a single level, plus a third once the save was mirrored.
  The whole in-game trigger is deleted; the cadence (every 3 completed levels,
  never for `remove_ads` owners, one request per level count) lives in the facade
  and fires from the save mirror.
* `store-remove-ads-not-consumed` – the store consumed the purchase token of
  `remove_ads`, a **permanent** product: consuming it erases the entitlement and
  lets the same user be charged again. `CafeBazaarBillingManager` additionally
  protects the tokens of non-consumables (`NON_CONSUMABLE` refusal) and still
  auto-consumes coin packs on connect and after each purchase.
* `triple-coins-state` / `coin-event-listener` – the ×3 bonus wrote coins straight
  into `localStorage` (overwritten by the game's own save effect, so the bonus was
  lost) and dispatched `chistan:coins` that nothing listened to. The wallet write
  is gone; the listener credits the bonus through the game's own coin updater.
* `free-coins-credit` – the rewarded row promised «+۱۵۰ سکه رایگان» but credited
  nothing; it now credits after `rewardGranted === true`.

### 4. Repository consistency

* `app/proguard-rules.pro` kept the old `com.labzband.balochafzar.*` classes – the
  app is `com.chistan.quickgames`, so R8 would have stripped the JS bridge, the
  billing payloads and the launcher classes from the release build.
* CI branding now calls the patcher that matches the packaged chunk (the labzband
  `apply_patches.py` targets `App-*.js`, which this bundle no longer contains, so
  the step used to fail whenever the logo changed).
* `tools/static_checks.py`: the interstitial requirement moved to the facade (the
  chunk must *not* request ads itself), the facade must stay the single
  `AndroidBridge` consumer, and the packaged WebApp must be parseable by the
  container's WebView baseline (`check_webview_baseline`).

### WebView baseline – what the first CI run on this branch exposed

The build job went green and the APK reached Telegram on the first run, but both
emulator jobs failed with `the WebApp never reported readiness` and the smoke
report showed an empty page (only the container's own `<div id="root">`), with
`SyntaxError: Unexpected token '='` in the page:

* The packaged Vite/React 19 chunk contains **ES2021 logical assignment**
  (`a ??= b`, `a ||= b`, `a &&= b` – Chrome 85). The container's baseline is
  **Chromium 83** (the API 30 emulator, and older WebViews on real Android 7-10
  phones): the module cannot be parsed at all, so the game never boots and nothing
  ever calls `appReady()`. New patch `es2019-syntax-floor` rewrites all 16 sites
  (20 operators) to `a ?? (a = b)` / `a || (a = b)` / `a && (a = b)` – all
  left-hand sides are plain identifiers/member accesses, where both forms are
  indistinguishable – and `verify()` plus `static_checks.py` now fail on any
  logical assignment, class static block or private-in expression in the packaged
  assets.
* The readiness handshake used to be tied to the game's start-up (a 3 s timer
  after the load event, i.e. after the game's own bundle executed). It now lives at
  the **top** of `native-bridge.js`, is registered before any namespace of the
  facade is built, fires ~1 s after the document is ready (`DOMContentLoaded` and
  `load` as well) and retries with a bounded backoff – so an unparseable or hanging
  game can no longer leave the container on its plate until the watchdog. The
  facade-only path is covered by four new harness checks that boot the page
  **without the game's scripts** (readiness, native save mirror, ads/billing
  startup, no page errors).
* The loading plate no longer depends on a single call: `MainActivity` probes the
  DOM 2.5 s after `onPageFinished` (12 attempts, once a second) and lifts the plate
  with a warning as soon as the page has rendered into `#root`/`#app`/`#game` – a
  WebView error page (no mount point) keeps the Persian error plate and its retry
  button. `static_checks.py` (`check_loading_plate`) fails if either path is
  removed. The emulator tests were rewritten for the current game (the old ones
  still clicked the labzband ids `#btn-game-play-giant` / `#word-connect-wheel` and
  read `labzband_progress_v4`, so they reported failures even when the game booted
  fine): `emulator_play.mjs` now plays three levels by their Persian labels
  (شروع بازی → رد کردن → مرحله بعدی), asserts *no* interstitial for the first two
  completed levels and exactly one after the third, simulates the full-screen ad,
  and checks level 4; `emulator_persist.mjs` uses the real save key
  (`chistansara_game_save_v2`).
* The emulator report no longer hides the cause: the smoke script prints the page
  console the container mirrors into logcat (`WebApp` tag, including uncaught JS
  errors) and the WebView's parse/URL errors, and tells the reader what a
  `SyntaxError` means; the ad lab prints the same on its readiness timeout. The
  pre-existing `grep: ci-artifacts/logcat.txt: No such file` warnings are gone
  (logcat is captured before those greps).
* `src/data/projectFiles.ts` / `exportFiles.ts` regenerated from the real
  repository (42 files; the old data pointed at deleted labzband sources and the
  pre-hash chunk), and the showcase copy follows the new reality
  (`com.chistan.quickgames`, release-only build, Telegram secrets).
* `README.md` §4 documents the delivery/signing secrets (the CI warning links
  there) and `docs/GAME_PATCHES.md` lists the current patch set.

### Verification

* `python3 tools/static_checks.py` – clean.
* `python3 tools/game-patches/apply_chistan_patches.py --check` – `bundle is up to
  date (12 patches, 1 syntax floor (16 sites), 19 invariants)`.
* `node tools/game-tests/run.mjs` – **101/101 checks**: exactly one interstitial per
  3 completed levels, none for `remove_ads` owners, `remove_ads` bought but never
  consumed, verified-only crediting, the rewarded 150 coins, the ×3 bonus reaching
  the save, the full lifecycle/bridge contract, and the facade-only boot contract
  (readiness + save mirror + ads/billing without the game).
* CI additionally runs the JVM unit tests, the emulator smoke test (install,
  boot, back-navigation, force-stop persistence) and the ad lab.

### Test plan

1. `python3 tools/static_checks.py`
2. `python3 tools/game-patches/apply_chistan_patches.py --check`
3. `python3 tools/game-tests/run.mjs` (needs `npm install --no-save jsdom@30 esbuild@0.25`)
4. `./gradlew testDebugUnitTest assembleRelease`
5. Add `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` (and optionally the
   `ANDROID_KEYSTORE_*` secrets), push, and check that the APK arrives in the chat.
