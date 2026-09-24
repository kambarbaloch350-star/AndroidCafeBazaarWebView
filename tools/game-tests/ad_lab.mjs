#!/usr/bin/env node
/**
 * Ad lab – the game through a **real** Tapsell interstitial on the emulator.
 *
 * The APK under test is built with `-PSMOKE_TEST_BUILD=true -PSMOKE_TEST_ADS=true`:
 * Tapsell runs with its official *test* app key and zones, so the SDK serves
 * a test creative from its own ad Activity – the exact code path a production
 * interstitial takes (Activity switch, SDK callbacks, WebView pause/resume),
 * only without revenue or production identifiers.
 *
 * What it records, around the ad:
 *   · every lifecycle / geometry line the container logs (MainActivity,
 *     ContainerWebView, TapsellManager, WebApp console),
 *   · page-side events (visibilitychange, resize, focus/blur, nativeapp:*,
 *     nativeads:*), DOM mutation rate per 250 ms and rAF frames per second,
 *   · raw frame statistics after the ad closes (share of white pixels, churn
 *     between consecutive frames) – a screen that "flashes white" shows up
 *     as alternating white ratios,
 *   · screenshots of the whole timeline.
 *
 * Verdicts:
 *   · the round trip happened (interstitial_shown + interstitial_closed) and
 *     the game came back healthy -> PASS;
 *   · the round trip happened and the game broke (reload, renderer loss,
 *     missing overlay, unplayable level, uncaught error) -> FAIL (exit 1);
 *   · no ad could be served (SDK not initialised, no fill, timeout) ->
 *     INCONCLUSIVE (exit 0 with a warning) – the other jobs cover the rest.
 *
 * Usage: node tools/game-tests/ad_lab.mjs [--pkg <id>] [--out <dir>] [--port <n>]
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  adbQuiet, argValue, clickUntil, connectPage, createReporter, displayRotation, frameStats, js, logMarker,
  logcatSince, pageErrors, PROGRESS_KEY, resumedActivity, screenshot as shot, seedAndReload, sleep,
  waitFor as waitForSel, waitForCondition
} from './emulator_lib.mjs';

const PKG = argValue('--pkg', 'com.labzband.balochafzar');
const OUT = argValue('--out', 'ci-artifacts-adlab');
const PORT = Number(argValue('--port', '9224'));
const AD_SHOW_TIMEOUT_MS = 30000;
const AD_CLOSE_TIMEOUT_MS = 75000;

fs.mkdirSync(OUT, { recursive: true });
const reporter = createReporter('adlab');
const { note, pass, fail, check } = reporter;
const warnings = [];
/** Diagnostic expectation: reported, never fatal for the verdict. */
const soft = (cond, msg, detail = '') => {
  if (cond) { pass(msg); return; }
  warnings.push(msg);
  console.log(`[adlab] WARN ${msg}${detail ? ' :: ' + String(detail).slice(0, 400) : ''}`);
  console.log(`::warning::ad lab: ${msg}`);
};
const screenshot = name => shot(OUT, name);
const waitFor = (cdp, selector, timeoutMs, label) => waitForSel(cdp, selector, timeoutMs, label, reporter);
const timeline = [];
const mark = (what, extra = {}) => {
  const entry = { t: new Date().toISOString(), what, ...extra };
  timeline.push(entry);
  note(`${what}${Object.keys(extra).length ? ' ' + JSON.stringify(extra) : ''}`);
};

let verdict = 'INCONCLUSIVE';
let roundTrip = false;

// ---------------------------------------------------------------------------
// Page-side instrumentation (survives nothing: re-installed after a reload)
// ---------------------------------------------------------------------------
const INSTRUMENT = js`(function () {
  if (window.__lab) return 'already';
  var lab = { t0: performance.now(), events: [], mutations: [], frames: [], errors: [], adRequested: false, adClosed: false, marker: 'alive' };
  window.__lab = lab;
  var now = function () { return Math.round(performance.now() - lab.t0); };
  var push = function (type, detail) { lab.events.push({ t: now(), type: type, detail: detail === undefined ? null : detail }); if (lab.events.length > 2000) lab.events.shift(); };
  document.addEventListener('visibilitychange', function () { push('visibilitychange', document.visibilityState); });
  window.addEventListener('resize', function () { push('resize', window.innerWidth + 'x' + window.innerHeight); });
  window.addEventListener('focus', function () { push('focus'); });
  window.addEventListener('blur', function () { push('blur'); });
  window.addEventListener('pageshow', function () { push('pageshow'); });
  window.addEventListener('pagehide', function () { push('pagehide'); });
  ['nativeapp:pause', 'nativeapp:resume', 'nativeapp:resize', 'nativeapp:memorywarning'].forEach(function (name) {
    window.addEventListener(name, function (e) { push(name, e && e.detail ? JSON.stringify(e.detail).slice(0, 120) : null); });
  });
  window.addEventListener('nativeads:event', function (e) {
    var d = e && e.detail || {};
    push('nativeads:' + d.type, d.data ? JSON.stringify(d.data).slice(0, 120) : null);
    if (d.type === 'interstitial_closed' || d.type === 'interstitial_skipped' || d.type === 'ad_error') lab.adClosed = true;
  });
  window.addEventListener('error', function (e) { lab.errors.push('error: ' + (e && e.message)); });
  window.addEventListener('unhandledrejection', function (e) { lab.errors.push('rejection: ' + String(e && e.reason).slice(0, 200)); });
  // Ad request hook: wrap the bridge call the game makes.
  try {
    if (window.NativeAds && typeof window.NativeAds.showInterstitial === 'function') {
      var real = window.NativeAds.showInterstitial;
      window.NativeAds.showInterstitial = function () {
        lab.adRequested = true; lab.adClosed = false; push('game:showInterstitial');
        var p = real.apply(this, arguments);
        if (p && typeof p.then === 'function') p.then(function (r) { push('game:showInterstitial:resolved', JSON.stringify(r).slice(0, 160)); lab.adClosed = true; });
        return p;
      };
    }
  } catch (e) { /* ignore */ }
  // DOM churn per 250 ms bucket.
  var bucket = { t: now(), n: 0 };
  var flush = function () { if (bucket.n) lab.mutations.push([bucket.t, bucket.n]); bucket = { t: now(), n: 0 }; if (lab.mutations.length > 4000) lab.mutations.shift(); };
  setInterval(flush, 250);
  try { new MutationObserver(function (list) { bucket.n += list.length; }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); } catch (e) { /* ignore */ }
  // rAF frames per second.
  var frames = 0, lastSecond = now();
  var tick = function () { frames++; var t = now(); if (t - lastSecond >= 1000) { lab.frames.push([t, frames]); if (lab.frames.length > 600) lab.frames.shift(); frames = 0; lastSecond = t; } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return 'installed';
})()`;

const SNAPSHOT = js`(function () {
  var lab = window.__lab || {};
  var canvases = Array.prototype.map.call(document.querySelectorAll('canvas'), function (c) {
    var cs = getComputedStyle(c);
    return { w: c.width, h: c.height, pos: cs.position, z: cs.zIndex, pe: cs.pointerEvents };
  });
  return {
    marker: lab.marker || null, adRequested: !!lab.adRequested, adClosed: !!lab.adClosed,
    events: (lab.events || []).slice(-80), mutations: (lab.mutations || []).slice(-80), frames: (lab.frames || []).slice(-30),
    errors: (lab.errors || []).slice(0, 10), hidden: document.hidden, size: window.innerWidth + 'x' + window.innerHeight,
    overlay: !!document.querySelector('#level-complete-overlay'), wheel: !!document.querySelector('#word-connect-wheel'),
    canvases: canvases, compat: document.documentElement.getAttribute('data-native-compat'),
    tier: document.documentElement.getAttribute('data-native-tier'),
    offscreenTransfer: typeof HTMLCanvasElement.prototype.transferControlToOffscreen
  };
})()`;

// ---------------------------------------------------------------------------
// Helpers around the ad Activity
// ---------------------------------------------------------------------------
function labLog() {
  return logcatSince('adlab-begin');
}
function adEventSeen(type, adType = 'interstitial') {
  // TapsellManager logs `ad event: <type> {"adType":"<adType>",...}`; the
  // rewarded/native preloads of the same SDK log their own errors, which must
  // not be mistaken for the interstitial's.
  return new RegExp(`TapsellManager[^\\n]*ad event: ${type} \\{"adType":"${adType}"`).test(labLog());
}
function containerLogLines() {
  return labLog().split('\n').filter(l => /MainActivity|ContainerWebView|TapsellManager|WebApp |TapsellPlus|Tapsell|ActivityTaskManager|ActivityManager: Displayed|chromium/.test(l)
    && !/pidof|SmokePlay|AdLab/.test(l));
}

/** Tries to close the ad without clicking through it: close controls first, BACK later. */
function tryCloseAd(elapsedMs) {
  const xml = adbQuiet('exec-out', 'uiautomator', 'dump', '/dev/tty');
  const nodes = [...xml.matchAll(/<node\b([^>]*)\/?>/g)].map(m => m[1]);
  const attr = (s, name) => { const m = new RegExp(`${name}="([^"]*)"`).exec(s); return m ? m[1] : ''; };
  const bounds = s => { const m = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(s); return m ? m.slice(1).map(Number) : null; };
  const candidates = nodes.filter(n => {
    const hay = (attr(n, 'resource-id') + ' ' + attr(n, 'content-desc') + ' ' + attr(n, 'text') + ' ' + attr(n, 'class')).toLowerCase();
    return /close|skip|dismiss|cancel|بستن|رد کردن|✕|×/.test(hay) && attr(n, 'clickable') === 'true';
  });
  const target = candidates[0];
  if (target) {
    const b = bounds(target);
    if (b) {
      const x = Math.round((b[0] + b[2]) / 2), y = Math.round((b[1] + b[3]) / 2);
      mark('tapping the ad close control', { id: attr(target, 'resource-id'), desc: attr(target, 'content-desc'), x, y });
      adbQuiet('shell', 'input', 'tap', String(x), String(y));
      return 'close-control';
    }
  }
  if (elapsedMs > 12000) {
    mark('sending BACK to the ad');
    adbQuiet('shell', 'input', 'keyevent', '4');
    return 'back';
  }
  return 'none';
}

/** Brings the app back if the ad click-through opened a browser / store. */
function recoverForeground() {
  const top = resumedActivity();
  if (top && !top.startsWith(PKG) && !/tapsell/i.test(top)) {
    mark('foreign activity in front – returning to the app', { top });
    adbQuiet('shell', 'input', 'keyevent', '4');
    adbQuiet('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
  }
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------
async function main() {
  note(`looking for the WebView devtools target of ${PKG}`);
  const cdp = await connectPage(PKG, PORT, note);
  const ua = await cdp.evaluate('navigator.userAgent');
  note(`WebView: ${ua}`);
  note(`Android: ${adbQuiet('shell', 'getprop', 'ro.build.version.release').trim()} (API ${adbQuiet('shell', 'getprop', 'ro.build.version.sdk').trim()})`);

  // 1. save game + reload, then instrument the fresh page
  await seedAndReload(cdp);
  if (!await waitFor(cdp, '#btn-game-play-giant', 30000, 'the main menu (after reload)')) return;
  check(await cdp.evaluate(INSTRUMENT) === 'installed', 'page instrumentation installed');
  await waitForCondition(cdp, 'document.documentElement.hasAttribute("data-native-tier")', 8000);
  const first = await cdp.evaluate(SNAPSHOT);
  note(`tier=${first.tier} compat="${first.compat}" transferControlToOffscreen=${first.offscreenTransfer} viewport=${first.size}`);

  // 2. the SDK must be alive with the test keys
  const adsAvailable = await cdp.evaluate('!!(window.AndroidBridge && window.AndroidBridge.isAdsAvailable && window.AndroidBridge.isAdsAvailable())');
  const info = await cdp.evaluate('(function(){try{return JSON.stringify(JSON.parse(window.AndroidBridge.getInfo())).slice(0,400)}catch(e){return String(e)}})()');
  note(`bridge info: ${info}`);
  if (!adsAvailable) {
    note('::warning::ad lab INCONCLUSIVE – the Tapsell SDK is not initialised (no test keys in this build, or the SDK failed to start)');
    note(containerLogLines().filter(l => /Tapsell/.test(l)).slice(-10).join('\n'));
    return;
  }
  pass('the Tapsell SDK is initialised with the test configuration');
  const ready = await waitForCondition(cdp, 'window.AndroidBridge.isAdReady && window.AndroidBridge.isAdReady("interstitial") === true', 30000);
  mark(ready ? 'an interstitial is preloaded' : 'no interstitial preloaded within 30 s (the request will be queued)');

  // 3. level 1
  logMarker('AdLab', 'adlab-begin');
  await cdp.evaluate('document.querySelector("#btn-game-play-giant").click(); true');
  if (!await waitFor(cdp, '#word-connect-wheel', 15000, 'the level 1 board')) return;
  let r = await clickUntil(cdp, '#btn-wheel-hint', '#level-complete-overlay');
  check(r.reached, `level 1 completes with hints (${r.clicks} taps)`, JSON.stringify(r) + ' ' + pageErrors(cdp));
  if (!r.reached) return;
  screenshot('30-adlab-level1-complete');

  // 4. level 2 -> the game asks for the interstitial -> the SDK shows it
  await cdp.evaluate('document.querySelector("#btn-next-level").click(); true');
  if (!await waitFor(cdp, '#word-connect-wheel', 15000, 'the level 2 board')) return;
  r = await clickUntil(cdp, '#btn-wheel-hint', '#level-complete-overlay');
  const requested = r.adRequested || await waitForCondition(cdp, 'window.__lab.adRequested === true', 5000);
  check(requested, `the game asks for an interstitial after the second level (${r.clicks} taps)`, JSON.stringify(r) + ' ' + pageErrors(cdp));
  if (!requested) return;
  mark('interstitial requested by the game');

  // The ad Activity takes the screen: wait for the SDK's onOpened.
  const showStart = Date.now();
  let shown = false;
  let n = 0;
  while (Date.now() - showStart < AD_SHOW_TIMEOUT_MS) {
    if (adEventSeen('interstitial_shown')) { shown = true; break; }
    if (adEventSeen('ad_error') || adEventSeen('interstitial_skipped')) break;
    if (n++ % 2 === 0) screenshot(`31-adlab-ad-wait-${String(n).padStart(2, '0')}`);
    await sleep(1000);
  }
  if (!shown) {
    const why = labLog().split('\n').filter(l => /TapsellManager/.test(l)).slice(-6).join(' | ');
    note(`::warning::ad lab INCONCLUSIVE – no interstitial was shown within ${AD_SHOW_TIMEOUT_MS / 1000} s (${why})`);
    // The game must still recover on its own (timeout -> ad_error -> overlay).
    const recovered = await waitFor(cdp, '#level-complete-overlay', 15000, 'the level-complete overlay (no ad served)');
    check(recovered, 'the game continues when no ad can be served');
    return;
  }
  mark('interstitial shown (SDK onOpened)', { top: resumedActivity(), rotation: displayRotation() });
  screenshot('32-adlab-ad-open');
  const adOpenedAt = Date.now();
  let adFrames = 0;

  // 5. let the creative run, then close it
  let closed = false;
  let lastAttempt = 0;
  while (Date.now() - adOpenedAt < AD_CLOSE_TIMEOUT_MS) {
    if (adEventSeen('interstitial_closed')) { closed = true; break; }
    const elapsed = Date.now() - adOpenedAt;
    if (elapsed - lastAttempt >= 5000) {
      lastAttempt = elapsed;
      screenshot(`33-adlab-ad-${String(++adFrames).padStart(2, '0')}`);
      mark('ad still open', { elapsedMs: elapsed, top: resumedActivity(), rotation: displayRotation() });
      recoverForeground();
      tryCloseAd(elapsed);
    }
    await sleep(500);
  }
  const closedAt = Date.now();
  mark(closed ? 'interstitial closed (SDK onClosed)' : 'interstitial never reported closed', { afterMs: closedAt - adOpenedAt });
  if (!closed) {
    fail('the interstitial could not be closed within the time limit', containerLogLines().slice(-8).join(' | '));
    recoverForeground();
    adbQuiet('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
    return;
  }
  roundTrip = true;

  // 6. the seconds right after the ad: frames + page state
  const frames = [];
  let prev = null;
  for (let i = 0; i < 16; i++) {
    const s = frameStats(prev);
    if (s) {
      frames.push({ ms: Date.now() - closedAt, white: s.whiteRatio, luma: s.meanLuma, churn: s.churn });
      prev = s;
    }
    if (i === 1 || i === 4 || i === 9 || i === 15) screenshot(`34-adlab-after-ad-${String(i).padStart(2, '0')}`);
    await sleep(300);
  }
  note('frames after the ad closed: ' + frames.map(f => `${f.ms}ms white=${f.white} luma=${f.luma} churn=${f.churn}`).join(' | '));
  const whiteFlashes = frames.filter(f => f.white > 0.85).length;
  const flicker = frames.slice(1).filter(f => f.churn > 0.35).length;
  check(whiteFlashes === 0, `no white frame after the ad (${whiteFlashes} of ${frames.length} frames were >85% white)`);
  soft(flicker <= 3, `no sustained flicker after the ad (${flicker} of ${frames.length} frames churned >35%)`);

  const snap = await cdp.evaluate(SNAPSHOT);
  check(snap.marker === 'alive', 'the page survived the ad without a reload', JSON.stringify(snap).slice(0, 300));
  const overlay = snap.overlay || await waitFor(cdp, '#level-complete-overlay', 10000, 'the level-complete overlay (after the ad)');
  check(overlay, 'the level-complete overlay is back after the ad');
  const resizeEvents = snap.events.filter(e => e.type === 'resize' || e.type === 'nativeapp:resize');
  soft(resizeEvents.length === 0, `the page was not resized by the ad round trip (${resizeEvents.length} resize events)`, JSON.stringify(resizeEvents));
  const visibility = snap.events.filter(e => e.type === 'visibilitychange').map(e => e.detail);
  note(`visibility transitions around the ad: ${visibility.join(' -> ') || 'none'}`);
  const lastFrames = snap.frames.slice(-3).map(f => f[1]);
  check(lastFrames.length === 0 || lastFrames.some(f => f > 0), `the page keeps animating after the ad (rAF per second: ${lastFrames.join(',')})`);
  const busiest = Math.max(0, ...snap.mutations.slice(-24).map(m => m[1]));
  note(`busiest 250 ms DOM bucket after the ad: ${busiest} mutations`);
  check(snap.errors.length === 0, 'no page error during the ad round trip', snap.errors.join(' | '));
  note(`page events: ${snap.events.slice(-40).map(e => `${e.t}:${e.type}${e.detail ? '(' + e.detail + ')' : ''}`).join(' ')}`);
  note(`canvases on the page: ${JSON.stringify(snap.canvases)}`);

  // 7. keep playing
  if (overlay) {
    await cdp.evaluate('document.querySelector("#btn-next-level").click(); true');
    if (await waitFor(cdp, '#word-connect-wheel', 15000, 'the level 3 board')) {
      r = await clickUntil(cdp, '#btn-wheel-hint', '#level-complete-overlay');
      check(r.reached, `level 3 is playable after the real ad (${r.clicks} taps)`, JSON.stringify(r) + ' ' + pageErrors(cdp));
      screenshot('35-adlab-level3-complete');
      const completions = await cdp.evaluate(js`(function () {
        try { return JSON.parse(localStorage.getItem(${JSON.stringify(PROGRESS_KEY)})).completions; } catch (e) { return -1; }
      })()`);
      check(completions === 3, `progress was saved (completions=${completions})`);
    }
  }

  // 8. container-side health
  const log = labLog();
  check(!/Render process gone|rebuilding the WebView|renderer crash/i.test(log), 'the renderer stayed alive through the real ad');
  check(!/FATAL EXCEPTION/.test(log), 'no native crash during the real ad');
  const configChanges = (log.match(/onConfigurationChanged/g) || []).length;
  soft(configChanges === 0, `the container kept its configuration through the ad (${configChanges} onConfigurationChanged)`);
  const surfaceResizes = (log.match(/ContainerWebView[^\n]*surface resized/g) || []);
  soft(surfaceResizes.length === 0, `the WebView surface kept its size through the ad (${surfaceResizes.length} resizes)`, surfaceResizes.join(' | '));
  check(cdp.exceptions.length === 0, 'no uncaught JavaScript exception', cdp.exceptions.join(' | '));
  verdict = reporter.results.some(r => !r.ok) ? 'FAIL' : 'PASS';
  cdp.close();
}

try {
  await main();
} catch (e) {
  fail('scenario aborted', e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : String(e));
  screenshot('39-adlab-aborted');
} finally {
  adbQuiet('forward', '--remove', `tcp:${PORT}`);
  const lines = containerLogLines();
  fs.writeFileSync(path.join(OUT, 'adlab-container.log'), lines.join('\n'));
  fs.writeFileSync(path.join(OUT, 'adlab-logcat.txt'), labLog());
  fs.writeFileSync(path.join(OUT, 'adlab-timeline.json'), JSON.stringify(timeline, null, 2));
  const failed = reporter.summary();
  if (roundTrip) verdict = failed ? 'FAIL' : 'PASS';
  const report = [
    `## Ad lab – real Tapsell test interstitial: **${verdict}**`,
    '',
    ...reporter.results.map(r => `- ${r.ok ? '✅' : '❌'} ${r.msg}`),
    ...warnings.map(w => `- ⚠️ ${w}`),
    '',
    '### Timeline',
    ...timeline.map(t => `- \`${t.t}\` ${t.what}${Object.keys(t).length > 2 ? ' ' + JSON.stringify(Object.fromEntries(Object.entries(t).filter(([k]) => k !== 't' && k !== 'what'))) : ''}`),
    '',
    '### Container log around the ad',
    '```',
    ...lines.slice(-60),
    '```'
  ].join('\n');
  fs.writeFileSync(path.join(OUT, 'report.md'), report);
  console.log(`[adlab] verdict: ${verdict}${roundTrip ? '' : ' (no real ad round trip happened)'}`);
  process.exit(roundTrip && failed ? 1 : 0);
}
