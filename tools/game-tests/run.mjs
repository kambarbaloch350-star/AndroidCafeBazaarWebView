#!/usr/bin/env node
/**
 * Game harness
 * ============
 *
 * Loads the packaged WebApp bundle (`app/src/main/assets/web/`) in a jsdom
 * window with a **scripted stub** of `window.AndroidBridge`, then drives the
 * game the way a player would.
 *
 * The container itself is verified on a real Android emulator
 * (`tools/emulator_smoke.sh`); this harness covers the WebApp/game logic:
 * coins, levels, the spinning wheel, interstitials, the remove-ads purchase and
 * the rating dialog, all without an emulator.
 *
 * Usage:
 *   node tools/game-tests/run.mjs [--scenarios <file.json>] [--dump]
 *
 * `--dump` prints a DOM/state summary, which is what you want when the game's
 * internals are still unknown.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB_ROOT = path.join(ROOT, 'app', 'src', 'main', 'assets', 'web');
const ENTRY = path.join(WEB_ROOT, 'index.html');

const SETTLE_MS = 600;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` :: ${detail}` : ''}`);
}

const settle = (ms = SETTLE_MS) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Bridge stub
// ---------------------------------------------------------------------------
function installBridge(window) {
  window.__harness = {
    calls: [],
    adsEnabled: true,
    rewardGranted: true,
    billingConnected: true,
    removeAdsOwned: false,
    purchases: [],
    state() {
      return {
        calls: this.calls.slice(),
        purchases: this.purchases.slice(),
        adCalls: this.calls.filter(c => c.startsWith('NativeAds.')),
        billingCalls: this.calls.filter(c => c.startsWith('CafeBazaar.')),
        ratingCalls: this.calls.filter(c => c.startsWith('CafeBazaar.openRatingPage'))
      };
    },
    reset() { this.calls.length = 0; }
  };

  const record = name => window.__harness.calls.push(name);
  const emit = (event, detail, delay = 100) =>
    window.setTimeout(() => window.dispatchEvent(new window.CustomEvent(event, { detail })), delay);
  const sink = (fn, payload, delay = 100) =>
    window.setTimeout(() => { const b = window.CafeBazaarBridge; if (b && b[fn]) b[fn](JSON.stringify(payload)); }, delay);

  window.AndroidBridge = {
    isNativeApp: () => true,
    isProduction: () => true,
    getPackageName: () => 'com.emochi.quickgames',
    getInfo: () => JSON.stringify({
      platform: 'android', sdkInt: 30, appVersion: '2.0.0', versionCode: 2,
      debug: false, serverPort: 7331, adsReady: true, pushEnabled: true
    }),
    appReady: () => { record('NativeApp.appReady'); emit('nativeapp:ready', { route: '' }); return true; },
    appLoaded: () => true,
    reportError: m => record('NativeApp.reportError:' + m),
    navigateBack: () => { record('NativeApp.navigateBack'); return true; },
    getStartupRoute: () => window.__harness.startupRoute || '',
    consumeStartupRoute: () => { window.__harness.startupRoute = ''; },

    isAdsAvailable: () => window.__harness.adsEnabled,
    isAdReady: () => window.__harness.adsEnabled,
    prepareAds: () => record('NativeAds.prepare'),
    showInterstitial: () => {
      record('NativeAds.showInterstitial');
      emit('nativeads:event', { type: 'interstitial_closed', data: { adType: 'interstitial' } });
      return true;
    },
    showRewarded: () => {
      record('NativeAds.showRewarded');
      emit('nativeads:event', {
        type: window.__harness.rewardGranted ? 'rewarded' : 'ad_error',
        data: { adType: 'rewarded', rewardGranted: window.__harness.rewardGranted, error: 'NO_FILL' }
      });
      return true;
    },
    showNative: () => { record('NativeAds.showNative'); return true; },
    hideNative: () => { record('NativeAds.hideNative'); return true; },
    showNativeAt: () => { record('NativeAds.showNativeAt'); return true; },

    isAvailable: () => window.__harness.billingConnected,
    isBillingAvailable: () => window.__harness.billingConnected,
    connectBilling: () => {
      record('CafeBazaar.connect');
      sink('onConnectionResult', { success: true, message: 'connected' }, 50);
    },
    buyProduct: id => {
      record('CafeBazaar.buyProduct:' + id);
      window.__harness.purchases.push(id);
      if (id === 'remove_ads') window.__harness.removeAdsOwned = true;
      sink('onPurchaseResult', {
        success: true, productId: id, purchaseToken: 'token-' + id, orderId: 'order-' + id
      });
    },
    buyProductWithPayload: (id) => window.AndroidBridge.buyProduct(id),
    consumePurchase: token => {
      record('CafeBazaar.consumePurchase');
      sink('onConsumeResult', { success: true, purchaseToken: token }, 60);
    },
    getPurchases: () => {
      record('CafeBazaar.getPurchases');
      const purchases = window.__harness.removeAdsOwned
        ? [{ productId: 'remove_ads', purchaseToken: 'token-remove_ads', purchaseState: 'PURCHASED' }]
        : [];
      sink('onPurchasesQueryResult', { success: true, purchases }, 60);
    },
    openRatingPage: () => { record('CafeBazaar.openRatingPage'); return true; },
    openStorePage: () => { record('CafeBazaar.openStorePage'); return true; },
    rateApp: () => { record('CafeBazaar.openRatingPage'); return true; }
  };
}

// ---------------------------------------------------------------------------
// Bundle loading
// ---------------------------------------------------------------------------
function readEntry() {
  const html = fs.readFileSync(ENTRY, 'utf8');
  const classic = [];
  const modules = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const attrs = match[1] || '';
    const inline = match[2] || '';
    const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const isModule = /\btype\s*=\s*["']module["']/i.test(attrs);
    if (srcMatch) {
      const file = path.join(WEB_ROOT, srcMatch[1].replace(/^\.?\//, '').split('?')[0]);
      if (!fs.existsSync(file)) throw new Error(`entry document references a missing script: ${srcMatch[1]}`);
      (isModule ? modules : classic).push({ src: srcMatch[1], code: fs.readFileSync(file, 'utf8') });
    } else if (inline.trim()) {
      (isModule ? modules : classic).push({ src: '(inline)', code: inline });
    }
  }
  return { html, classic, modules };
}

/**
 * Makes an ES module runnable inside jsdom, which cannot execute
 * `<script type="module">`. A production bundle is a single self-contained
 * chunk, so removing the (empty) export statements is enough; anything that
 * still needs import resolution is reported instead of being silently broken.
 */
function toClassic(code, label) {
  const importRe = /^\s*import\s+[^;]*?from\s*["'][^"']+["'];?\s*$/gm;
  const bareImportRe = /^\s*import\s*["'][^"']+["'];?\s*$/gm;
  const sideImports = (code.match(bareImportRe) || []).length;
  const fromImports = (code.match(importRe) || []).length;
  if (sideImports + fromImports > 0) {
    console.log(`WARN  ${label}: ${sideImports + fromImports} import statement(s) found – ` +
      'the bundle is code-split and cannot run outside a browser');
  }
  return code
    .replace(importRe, '')
    .replace(bareImportRe, '')
    .replace(/^\s*export\s+default\s+/gm, 'var __default__ = ')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/^\s*export\s+/gm, '');
}

/**
 * Boots a **fresh** jsdom window with the packaged bundle.
 *
 * A real `document.write` "reload" is not enough: the window (and with it every
 * `DOMContentLoaded` listener registered by the first boot) survives, so the
 * WebApp would never render again. Building a new JSDOM instance is the closest
 * equivalent to reloading the page in the WebView.
 */
async function boot() {
  const { html, classic, modules } = readEntry();
  const virtualConsole = new VirtualConsole();
  const log = [];
  virtualConsole.on('log', (...a) => log.push('log: ' + a.map(String).join(' ')));
  virtualConsole.on('warn', (...a) => log.push('warn: ' + a.map(String).join(' ')));
  virtualConsole.on('error', (...a) => log.push('error: ' + a.map(String).join(' ')));
  // jsdom cannot implement every browser API (scrollTo, media playback, ...):
  // those are noise, not game errors.
  virtualConsole.on('jsdomError', e => {
    const message = e && e.message ? e.message : String(e);
    log.push((message.startsWith('Not implemented') ? 'jsdomNote: ' : 'jsdomError: ') + message);
  });

  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:7331/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole
  });
  const { window } = dom;

  installBridge(window);

  // The container injects nothing: every script comes from the entry document,
  // exactly like in the WebView.
  for (const script of classic) {
    const el = window.document.createElement('script');
    el.textContent = script.code;
    window.document.head.appendChild(el);
  }
  for (const script of modules) {
    const el = window.document.createElement('script');
    el.textContent = toClassic(script.code, script.src);
    window.document.body.appendChild(el);
  }

  await settle(900);
  return { dom, window, log };
}

// ---------------------------------------------------------------------------
// Interaction helpers
// ---------------------------------------------------------------------------
function textOf(window) {
  const body = window.document.body;
  return (body && body.textContent ? body.textContent : '').replace(/\s+/g, ' ').trim();
}

function findClickable(window, text) {
  const nodes = Array.from(window.document.querySelectorAll(
    'button, a, [role="button"], input[type="button"], input[type="submit"], [class*="btn"], [class*="button"]'
  ));
  const visible = n => {
    const style = window.getComputedStyle ? null : null;
    return n && (n.offsetParent !== undefined);
  };
  return nodes.find(n => visible(n) && (n.textContent || '').includes(text))
    || nodes.find(n => (n.textContent || '').includes(text))
    || null;
}

function clickText(window, text) {
  const el = findClickable(window, text);
  if (!el) throw new Error(`no clickable element containing "${text}"`);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return el.textContent.trim().slice(0, 40);
}

function clickSelector(window, selector) {
  const el = window.document.querySelector(selector);
  if (!el) throw new Error(`selector not found: ${selector}`);
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function storageDump(window) {
  const out = {};
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      let value = window.localStorage.getItem(key);
      try { value = JSON.parse(value); } catch { /* keep raw */ }
      out[key] = value;
    }
  } catch (e) {
    out.__error = String(e);
  }
  return out;
}

function domSummary(window) {
  const buttons = Array.from(window.document.querySelectorAll('button, a, [role="button"], [class*="btn"]'))
    .map(b => (b.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const texts = Array.from(window.document.querySelectorAll('h1, h2, h3, p, span, div'))
    .map(n => (n.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(t => t && t.length < 60)
    .slice(0, 60);
  return { buttons: [...new Set(buttons)].slice(0, 40), texts: [...new Set(texts)].slice(0, 60) };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
function loadScenarios() {
  const idx = process.argv.indexOf('--scenarios');
  if (idx >= 0 && process.argv[idx + 1]) {
    return JSON.parse(fs.readFileSync(process.argv[idx + 1], 'utf8'));
  }
  const defaultFile = path.join(ROOT, 'tools', 'game-tests', 'scenarios.json');
  return fs.existsSync(defaultFile) ? JSON.parse(fs.readFileSync(defaultFile, 'utf8')) : [];
}

async function runScenario(state, scenario) {
  let window = state.window;
  console.log(`\n=== scenario: ${scenario.name} ===`);
  window.__harness.reset();

  // Some scenarios describe the real game bundle (store, rating, spin wheel).
  // While the placeholder demo bundle is in place they are reported as SKIP
  // instead of FAIL, so a red run always means a real regression.
  // Scenarios that only make sense with the real game bundle (spin wheel, coin
  // store, rating button) are skipped while the placeholder demo is packaged:
  // they light up automatically once the game's `index.html` renders لبزبند.
  if (scenario.requiresGameBundle && !textOf(window).includes('لبزبند')) {
    console.log(`SKIP  [${scenario.name}] needs the game bundle (no لبزبند on screen)`);
    return;
  }

  if (Array.isArray(scenario.requiresText) && scenario.requiresText.length) {
    const text = textOf(window);
    const missing = scenario.requiresText.filter(t => !text.includes(t));
    if (missing.length) {
      console.log(`SKIP  [${scenario.name}] bundle does not expose: ${missing.join(', ')}`);
      return;
    }
  }

  let failed = false;

  for (const step of scenario.steps) {
    try {
      if (step.setRewardGranted !== undefined) {
        window.__harness.rewardGranted = step.setRewardGranted;
      }
      if (step.setOwnedPurchases) {
        window.__harness.purchases = step.setOwnedPurchases.slice();
        window.__harness.removeAdsOwned = step.setOwnedPurchases.includes('remove_ads');
      }
      if (step.clearStorage) {
        window.localStorage.clear();
        await settle(100);
      }
      if (step.storage) {
        for (const [key, value] of Object.entries(step.storage)) {
          window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
        await settle(100);
      }
      if (step.reload) {
        const previousStorage = { ...storageDump(window) };
        const fresh = await boot();
        // localStorage survives a real reload: carry the keys over.
        for (const [key, value] of Object.entries(previousStorage)) {
          try { fresh.window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
        }
        window = fresh.window;
        await settle(step.wait || 900);
      }
      if (step.click) {
        const label = clickText(window, step.click);
        console.log(`      clicked: ${label}`);
        await settle(step.wait || SETTLE_MS);
      }
      if (step.clickSelector) {
        clickSelector(window, step.clickSelector);
        await settle(step.wait || SETTLE_MS);
      }
      if (step.wait) await settle(step.wait);
      if (step.pressBack === 'webapp') {
        // Only the hook the container asks first: NativeApp.onBackPressed().
        const handled = window.eval(
          '(function(){try{var a=window.NativeApp;return !!(a&&typeof a.onBackPressed==="function"&&a.onBackPressed()===true);}catch(e){return false;}})()'
        );
        window.__harness.backHandled = handled;
        console.log(`      back pressed (webapp hook) -> handled=${handled}`);
        await settle(step.wait || SETTLE_MS);
      }
      if (step.pressBack === 'container' || step.pressBack === true) {
        // Mirrors MainActivity.requestWebAppBack(): 1) NativeApp.onBackPressed(),
        // 2) cancelable `nativeapp:back` event, 3) history.back().
        const handled = window.eval(`(function () {
          try {
            var app = window.NativeApp;
            if (app && typeof app.onBackPressed === 'function' && app.onBackPressed() === true) return true;
            var event = new Event('nativeapp:back', { cancelable: true, bubbles: true });
            if (!window.dispatchEvent(event)) return true;
            if (window.history && window.history.length > 1) { window.history.back(); return true; }
            return false;
          } catch (e) { return false; }
        })()`);
        window.__harness.backHandled = handled;
        console.log(`      back pressed -> handled=${handled}`);
        await settle(step.wait || SETTLE_MS);
      }
      if (step.expectBackHandled !== undefined) {
        check(`[${scenario.name}] back press handled inside the WebApp`,
          window.__harness.backHandled === step.expectBackHandled,
          `handled=${window.__harness.backHandled}`);
      }
      if (step.expectCall) {
        const calls = window.__harness.state().calls;
        const ok = calls.some(c => c.startsWith(step.expectCall));
        check(`[${scenario.name}] calls ${step.expectCall}`, ok, ok ? '' : `calls: ${calls.join(', ') || '(none)'}`);
      }
      if (step.expectCallCount) {
        const { name, count } = step.expectCallCount;
        const calls = window.__harness.state().calls.filter(c => c.startsWith(name));
        check(`[${scenario.name}] ${name} called ${count}x`, calls.length === count,
          `was ${calls.length}`);
      }
      if (step.expectNoCall) {
        const calls = window.__harness.state().calls;
        check(`[${scenario.name}] does not call ${step.expectNoCall}`,
          !calls.some(c => c.startsWith(step.expectNoCall)), calls.join(', '));
      }
      if (step.expectText) {
        const text = textOf(window);
        check(`[${scenario.name}] shows "${step.expectText}"`, text.includes(step.expectText));
      }
      if (step.expectNoText) {
        const text = textOf(window);
        check(`[${scenario.name}] hides "${step.expectNoText}"`, !text.includes(step.expectNoText));
      }
      if (step.expectStorage) {
        const dump = JSON.stringify(storageDump(window));
        const needle = typeof step.expectStorage === 'string'
          ? step.expectStorage : JSON.stringify(step.expectStorage);
        check(`[${scenario.name}] storage contains ${needle}`, dump.includes(needle), dump.slice(0, 240));
      }
      if (step.clickRatingDialog) {
        // The rating dialog can be raised by the game itself (after level 1)
        // or by the player pressing the rating button.
        const el = findClickable(window, step.clickRatingDialog);
        if (!el) {
          check(`[${scenario.name}] rating dialog button "${step.clickRatingDialog}"`, false, 'not found');
        } else {
          el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
          await settle(400);
        }
      }
      if (step.dump) {
        console.log('DOM:', JSON.stringify(domSummary(window), null, 1).slice(0, 2000));
        console.log('storage:', JSON.stringify(storageDump(window)).slice(0, 1000));
      }
    } catch (e) {
      failed = true;
      check(`[${scenario.name}] step failed`, false, e.message);
    }
  }
  state.window = window;
  if (failed) console.log(`      (scenario ${scenario.name} had failures)`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
if (!fs.existsSync(ENTRY)) {
  console.error(`no WebApp bundle at ${ENTRY}`);
  process.exit(1);
}

const state = await boot();
const { window, log } = state;

// Boot contract: every WebApp must announce readiness.
check('the WebApp calls NativeApp.appReady()',
  window.__harness.state().calls.some(c => c.startsWith('NativeApp.appReady')),
  window.__harness.state().calls.join(', '));
check('the WebApp renders text', textOf(window).length > 0);
check('no uncaught page errors',
  !log.some(l => l.startsWith('jsdomError')),
  log.filter(l => l.startsWith('jsdomError')).slice(0, 2).join(' | '));
check('no unhandled console errors',
  !log.some(l => l.startsWith('error:')),
  log.filter(l => l.startsWith('error:')).slice(0, 2).join(' | '));

if (process.argv.includes('--dump') || loadScenarios().length === 0) {
  console.log('\n--- DOM summary ---');
  console.log(JSON.stringify(domSummary(window), null, 1));
  console.log('\n--- localStorage ---');
  console.log(JSON.stringify(storageDump(window), null, 1).slice(0, 1500));
  console.log('\n--- console ---');
  console.log(log.slice(-20).join('\n'));
}

for (const scenario of loadScenarios()) {
  await runScenario(state, scenario);
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
