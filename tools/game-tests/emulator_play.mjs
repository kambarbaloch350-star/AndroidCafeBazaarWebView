#!/usr/bin/env node
/**
 * Plays the packaged game inside the installed debug APK, on the emulator,
 * over the Chrome DevTools Protocol – and re-enacts the bug that was reported
 * in production ("after the first interstitial the buttons flash and the screen
 * goes white"), against the *current* game (چیستان‌سرا):
 *
 *   1. seed a fresh save game and reload the page in the running WebView,
 *   2. play three levels (شروع بازی → رد کردن → مرحله بعدی …),
 *   3. no interstitial may be requested for the first two completed levels; the
 *      third must produce exactly one request (the cadence lives in
 *      `native-bridge.js`: every 3 completed levels),
 *   4. simulate the full-screen ad: another Activity covers the app for a few
 *      seconds (the container goes through onPause/onStop/onStart/onResume,
 *      exactly like with a served Tapsell ad), then the app comes back,
 *   5. deliver `interstitial_shown` / `interstitial_closed` through the same
 *      two channels WebAppBridge.onAdEvent uses,
 *   6. the level-complete overlay must still be there and level 4 must be
 *      playable, without a page reload, renderer loss or uncaught JavaScript
 *      error.
 *
 * The ad request itself is intercepted at the `window.AndroidBridge` boundary
 * (a Proxy in the page), so the scenario runs with the smoke-test build that
 * has no Tapsell keys and never depends on live ad inventory. The round trip
 * with a *real* (test) interstitial is `ad_lab.mjs`.
 *
 * The game's UI carries no stable element ids, so everything is driven by the
 * visible Persian labels (the same labels the jsdom contract uses).
 *
 * Usage: node tools/game-tests/emulator_play.mjs [--pkg <id>] [--out <dir>] [--port <n>]
 * Exit code 1 when a check fails; every check is printed as PASS/FAIL.
 */
import {
  adbQuiet, argValue, bodyText, connectPage, createReporter, js, logMarker, logcatSince,
  MENU_LABELS, pageErrors, readSave, reloadPage, screenshot as shot, seedChistan, sleep,
  tapText, waitForMenu, waitForText, waitFor as waitForSel, waitForCondition
} from './emulator_lib.mjs';

const PKG = argValue('--pkg', 'com.chistan.quickgames');
const OUT = argValue('--out', 'ci-artifacts');
const PORT = Number(argValue('--port', '9223'));

const reporter = createReporter('play');
const { note, pass, fail, check } = reporter;
const screenshot = name => shot(OUT, name);
const waitFor = (cdp, selector, timeoutMs, label) => waitForSel(cdp, selector, timeoutMs, label, reporter);
// `clickText()` is the serialized page-side snippet (a string, not a promise),
// so it always goes through `cdp.evaluate()` – `tapText()` does exactly that and
// reports the failure with the page text when the label is not there.
const tap = (cdp, text, timeoutMs = 25000) => tapText(cdp, text, timeoutMs, reporter);

const SHIM = js`(function () {
  if (window.__playShim) return window.__playShim.mode;
  var real = window.AndroidBridge;
  var shim = { mode: 'none', pending: false, requests: 0, resolve: null };
  window.__playShim = shim;
  if (!real) return shim.mode;
  var overrides = {
    showInterstitial: function () { shim.requests++; shim.pending = true; return true; },
    isAdsAvailable: function () { return true; },
    isAdReady: function () { return true; },
    prepareAds: function () { return true; }
  };
  try {
    var proxy = new Proxy(real, {
      get: function (target, key) {
        if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
        var value = target[key];
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
    window.AndroidBridge = proxy;
    if (window.AndroidBridge === proxy) shim.mode = 'bridge-proxy';
  } catch (e) { /* fall through */ }
  if (shim.mode === 'none' && window.NativeAds) {
    // The injected object cannot be replaced on this WebView: intercept one
    // level up, at the facade the game calls.
    window.NativeAds.showInterstitial = function () {
      shim.requests++; shim.pending = true;
      return new Promise(function (resolve) { shim.resolve = resolve; });
    };
    shim.mode = 'facade';
  }
  return shim.mode;
})()`;

const DELIVER = js`(function () {
  var shim = window.__playShim;
  var deliver = function (type, extra) {
    var envelope = { type: type, data: Object.assign({ adType: 'interstitial', provider: 'tapsell', simulated: true }, extra || {}) };
    var json = JSON.stringify(envelope);
    if (window.NativeAds && typeof window.NativeAds.onEvent === 'function') window.NativeAds.onEvent(json);
    window.dispatchEvent(new CustomEvent('nativeads:event', { detail: JSON.parse(json) }));
  };
  deliver('interstitial_shown');
  deliver('interstitial_closed', { shownCount: 1 });
  if (shim && shim.mode === 'facade' && shim.resolve) shim.resolve({ ok: true, type: 'interstitial', data: { simulated: true } });
  if (shim) shim.pending = false;
  return true;
})()`;

const WIN_DIALOG = 'چیستان گشوده شد';

/**
 * Plays one level: advances to the board (whatever button is offered), reveals
 * the answer with «رد کردن» and waits for the win dialog. Returns true when the
 * level was completed.
 */
async function playLevel(cdp, index) {
  let entered = false;
  for (const label of ['مرحله بعدی', ...MENU_LABELS]) {
    if (await waitForText(cdp, label, index === 1 ? 30000 : 8000)) {
      await tap(cdp, label);
      entered = true;
      break;
    }
  }
  if (!entered) {
    reporter.fail(`no way to enter level ${index} (menu or next-level button)`, await bodyText(cdp));
    return false;
  }
  if (!await waitForText(cdp, 'رد کردن', 20000, `the level ${index} board`, reporter)) return false;
  await tap(cdp, 'رد کردن');
  return await waitForText(cdp, WIN_DIALOG, 20000, `the win dialog of level ${index}`, reporter);
}

async function requests(cdp) {
  return Number(await cdp.evaluate('window.__playShim ? window.__playShim.requests : -1'));
}

async function main() {
  note(`looking for the WebView devtools target of ${PKG}`);
  const cdp = await connectPage(PKG, PORT, note);

  const ua = await cdp.evaluate('navigator.userAgent');
  note(`WebView: ${ua}`);
  check(await cdp.evaluate('!!window.AndroidBridge && !!window.NativeApp && !!window.NativeAds'),
    'the page sees AndroidBridge, NativeApp and NativeAds');

  // 1. a fresh save game + a page reload inside the running WebView
  await seedChistan(cdp, { completions: 0, coins: 500 });
  await reloadPage(cdp, 3000);
  const menu = await waitForMenu(cdp, 40000, 'the main menu (after reload)');
  if (!menu) {
    fail('the main menu (after reload) did not appear within 40000 ms', await bodyText(cdp));
    return;
  }
  pass(`the game reloads with the seeded save and shows the main menu ("${menu}")`);
  await waitForCondition(cdp, 'document.documentElement.hasAttribute("data-native-tier")', 8000);
  const tier = await cdp.evaluate('document.documentElement.getAttribute("data-native-tier") || ""');
  check(tier !== '', `the container applied its rendering profile (data-native-tier="${tier}")`);
  const compat = await cdp.evaluate('document.documentElement.getAttribute("data-native-compat") || ""');
  check(compat !== '', `the container's compat layer ran before the bundle (data-native-compat="${compat}")`);
  const lang = await cdp.evaluate('document.documentElement.getAttribute("lang") || ""');
  const dir = await cdp.evaluate('document.documentElement.getAttribute("dir") || ""');
  check(lang === 'fa' && dir === 'rtl', `the WebApp is Persian right-to-left (lang=${lang} dir=${dir})`);

  // 2. intercept interstitial requests at the bridge boundary
  const mode = await cdp.evaluate(SHIM);
  check(mode === 'bridge-proxy' || mode === 'facade', `interstitial requests are intercepted (${mode})`);
  await cdp.evaluate('window.__playMarker = "alive"; true');

  // 3. three levels: no ad for the first two, exactly one after the third
  for (let level = 1; level <= 3; level++) {
    const done = await playLevel(cdp, level);
    check(done, `level ${level} completes (رد کردن → win dialog)`, await bodyText(cdp));
    if (!done) {
      screenshot(`20-play-level${level}-stuck`);
      fail('cannot continue without a completed level', await bodyText(cdp));
      return;
    }
    const seen = await requests(cdp);
    if (level < 3) {
      check(seen === 0, `no interstitial is requested after ${level} completed level(s)`, `requests=${seen}`);
    } else {
      if (!await waitForCondition(cdp, 'window.__playShim.requests === 1', 8000)) {
        check(false, 'the game asks for an interstitial after the third level',
          `requests=${await requests(cdp)} ${pageErrors(cdp)}`);
        return;
      }
      pass('the game asks for exactly one interstitial after the third level');
    }
    screenshot(`2${level}-play-level${level}-complete`);
  }
  check(await requests(cdp) === 1, `exactly one interstitial was requested (${await requests(cdp)})`);

  // 4. simulate the full-screen ad: another Activity covers the app
  logMarker('SmokePlay', 'play-ad-begin');
  note('simulating the ad: another Activity covers the app for 6 s');
  adbQuiet('shell', 'am', 'start', '-a', 'android.settings.SETTINGS');
  await sleep(6000);
  screenshot('24-play-ad-foreign-activity');
  adbQuiet('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
  await sleep(2500);
  screenshot('25-play-back-from-ad');

  const alive = await cdp.evaluate('window.__playMarker === "alive"');
  check(alive, 'the page survived the activity switch without a reload');
  const foreground = adbQuiet('shell', 'dumpsys', 'activity', 'activities').includes(`${PKG}/.MainActivity`);
  check(foreground, 'the app is back in the foreground');

  // 5. the container reports the ad as closed
  const t0 = Date.now();
  await cdp.evaluate(DELIVER);
  const overlay = await waitForText(cdp, WIN_DIALOG, 12000, `the win dialog after the ad`, reporter);
  if (overlay) pass(`the game resumed ${Date.now() - t0} ms after interstitial_closed`);
  screenshot('26-play-after-ad');

  // 6. keep playing: level 4 must be playable and the progress must be saved
  const level4 = await playLevel(cdp, 4);
  check(level4, 'level 4 is playable after the ad', await bodyText(cdp));
  screenshot('27-play-level4-complete');
  const save = await readSave(cdp);
  note(`save after the play-through: ${JSON.stringify(save)}`);
  check(save.completions === 4, `progress was saved (completions=${save.completions})`);
  check(await requests(cdp) === 1, `still exactly one interstitial was requested (${await requests(cdp)})`);

  // 7. health of the run
  const log = logcatSince('play-ad-begin');
  check(!/Render process gone|rebuilding the WebView|renderer crash/i.test(log),
    'the renderer stayed alive through the ad');
  check(!/FATAL EXCEPTION/.test(log), 'no native crash during the ad cycle');
  check(cdp.exceptions.length === 0, 'no uncaught JavaScript exception', cdp.exceptions.join(' | '));
  if (cdp.consoleErrors.length) note(`console.error lines: ${cdp.consoleErrors.slice(0, 3).join(' | ')}`);

  cdp.close();
}

let exitCode = 0;
try {
  await main();
} catch (e) {
  fail('scenario aborted', e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : String(e));
  screenshot('29-play-aborted');
} finally {
  adbQuiet('forward', '--remove', `tcp:${PORT}`);
  exitCode = reporter.summary() ? 1 : 0;
}
process.exit(exitCode);
