#!/usr/bin/env node
/**
 * Plays the packaged game inside the installed debug APK, on the emulator,
 * over the Chrome DevTools Protocol – and re-enacts the bug that was reported
 * in production ("after the first interstitial the buttons flash and the
 * screen goes white"):
 *
 *   1. seed a rich save game and reload the page in the running WebView,
 *   2. finish level 1 (no interstitial may be requested yet),
 *   3. finish level 2 -> the game asks the container for an interstitial,
 *   4. simulate the full-screen ad: another Activity covers the app for a few
 *      seconds (the container goes through onPause/onStop/onStart/onResume,
 *      exactly like with a served Tapsell ad), then the app comes back,
 *   5. deliver `interstitial_shown` / `interstitial_closed` through the same
 *      two channels WebAppBridge.onAdEvent uses,
 *   6. the level-complete overlay must appear and level 3 must be playable,
 *      without a page reload, renderer loss or uncaught JavaScript error.
 *
 * The ad request itself is intercepted at the `window.AndroidBridge` boundary
 * (a Proxy in the page), so the scenario runs with the smoke-test build that
 * has no Tapsell keys and never depends on live ad inventory. The round trip
 * with a *real* (test) interstitial is `ad_lab.mjs`.
 *
 * Usage: node tools/game-tests/emulator_play.mjs [--pkg <id>] [--out <dir>] [--port <n>]
 * Exit code 1 when a check fails; every check is printed as PASS/FAIL.
 */
import {
  adbQuiet, argValue, clickUntil, connectPage, createReporter, js, logMarker, logcatSince,
  pageErrors, PROGRESS_KEY, screenshot as shot, seedAndReload, sleep, waitFor as waitForSel, waitForCondition
} from './emulator_lib.mjs';

const PKG = argValue('--pkg', 'com.labzband.balochafzar');
const OUT = argValue('--out', 'ci-artifacts');
const PORT = Number(argValue('--port', '9223'));

const reporter = createReporter('play');
const { note, pass, fail, check } = reporter;
const screenshot = name => shot(OUT, name);
const waitFor = (cdp, selector, timeoutMs, label) => waitForSel(cdp, selector, timeoutMs, label, reporter);

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

async function main() {
  note(`looking for the WebView devtools target of ${PKG}`);
  const cdp = await connectPage(PKG, PORT, note);

  const ua = await cdp.evaluate('navigator.userAgent');
  note(`WebView: ${ua}`);
  check(await cdp.evaluate('!!window.AndroidBridge && !!window.NativeApp && !!window.NativeAds'),
    'the page sees AndroidBridge, NativeApp and NativeAds');

  // 1. rich save game + reload inside the running WebView
  await seedAndReload(cdp);
  if (!await waitFor(cdp, '#btn-game-play-giant', 30000, 'the main menu (after reload)')) return;
  pass('the game reloads with the seeded progress and shows the main menu');
  await waitForCondition(cdp, 'document.documentElement.hasAttribute("data-native-tier")', 8000);
  const tier = await cdp.evaluate('document.documentElement.getAttribute("data-native-tier") || ""');
  check(tier !== '', `the container applied its rendering profile (data-native-tier="${tier}")`);
  const compat = await cdp.evaluate('document.documentElement.getAttribute("data-native-compat") || ""');
  check(compat !== '', `the container's compat layer ran before the bundle (data-native-compat="${compat}")`);
  const bg = await cdp.evaluate('getComputedStyle(document.body).backgroundColor');
  note(`page background: ${bg}`);

  // 2. intercept interstitial requests
  const mode = await cdp.evaluate(SHIM);
  check(mode === 'bridge-proxy' || mode === 'facade', `interstitial requests are intercepted (${mode})`);
  await cdp.evaluate('window.__playMarker = "alive"; true');

  // 3. level 1
  await cdp.evaluate('document.querySelector("#btn-game-play-giant").click(); true');
  if (!await waitFor(cdp, '#word-connect-wheel', 15000, 'the level 1 board')) return;
  let r = await clickUntil(cdp, '#btn-wheel-hint', '#level-complete-overlay');
  check(r.reached, `level 1 completes with hints (${r.clicks} taps)`, JSON.stringify(r) + ' ' + pageErrors(cdp));
  check(!r.adRequested && await cdp.evaluate('window.__playShim.requests') === 0,
    'no interstitial is requested after the first level');
  screenshot('20-play-level1-complete');
  if (!r.reached) {
    fail('cannot continue without a completed level 1', await cdp.evaluate('document.body.innerText.slice(0, 300)'));
    return;
  }

  // 4. level 2 -> interstitial request
  await cdp.evaluate('document.querySelector("#btn-next-level").click(); true');
  if (!await waitFor(cdp, '#word-connect-wheel', 15000, 'the level 2 board')) return;
  r = await clickUntil(cdp, '#btn-wheel-hint', '#level-complete-overlay');
  const requested = r.adRequested || await waitForCondition(cdp, 'window.__playShim.pending === true', 5000);
  check(requested, `the game asks for an interstitial after the second level (${r.clicks} taps)`, JSON.stringify(r) + ' ' + pageErrors(cdp));
  check(!await cdp.evaluate('!!document.querySelector("#level-complete-overlay")'),
    'the level-complete overlay waits for the ad to close');
  screenshot('21-play-ad-requested');

  // 5. simulate the full-screen ad activity
  logMarker('SmokePlay', 'play-ad-begin');
  note('simulating the ad: another Activity covers the app for 6 s');
  adbQuiet('shell', 'am', 'start', '-a', 'android.settings.SETTINGS');
  await sleep(6000);
  screenshot('22-play-ad-foreign-activity');
  adbQuiet('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
  await sleep(2500);
  screenshot('23-play-back-from-ad');

  const alive = await cdp.evaluate('window.__playMarker === "alive"');
  check(alive, 'the page survived the activity switch without a reload');
  const foreground = adbQuiet('shell', 'dumpsys', 'activity', 'activities').includes(`${PKG}/.MainActivity`);
  check(foreground, 'the app is back in the foreground');

  // 6. the container reports the ad as closed
  const t0 = Date.now();
  await cdp.evaluate(DELIVER);
  const overlay = await waitFor(cdp, '#level-complete-overlay', 10000, 'the level-complete overlay (after the ad)');
  if (overlay) pass(`the game resumed ${Date.now() - t0} ms after interstitial_closed`);
  screenshot('24-play-after-ad-overlay');
  const requests = await cdp.evaluate('window.__playShim.requests');
  check(requests === 1, `exactly one interstitial was requested (${requests})`);

  // 7. keep playing
  if (overlay) {
    await cdp.evaluate('document.querySelector("#btn-next-level").click(); true');
    if (await waitFor(cdp, '#word-connect-wheel', 15000, 'the level 3 board')) {
      r = await clickUntil(cdp, '#btn-wheel-hint', '#level-complete-overlay');
      check(r.reached, `level 3 is playable after the ad (${r.clicks} taps)`, JSON.stringify(r) + ' ' + pageErrors(cdp));
      screenshot('25-play-level3-complete');
      const completions = await cdp.evaluate(js`(function () {
        try { return JSON.parse(localStorage.getItem(${JSON.stringify(PROGRESS_KEY)})).completions; } catch (e) { return -1; }
      })()`);
      check(completions === 3, `progress was saved (completions=${completions})`);
    }
  }

  // 8. health of the run
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
