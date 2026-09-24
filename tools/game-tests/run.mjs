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
 * (`tools/emulator_smoke.sh` + `emulator_play.mjs`); this harness covers the
 * WebApp/game logic against the container's *protocol*: the stub speaks the
 * exact TapsellManager event envelopes (`interstitial_shown/closed`,
 * `rewarded_completed`, `ad_error` with stable codes, delivered through both
 * `NativeAds.onEvent` and `nativeads:event`) and Poolakey purchase results
 * (`success`/`verified`/`purchaseToken`), so coins, levels, the spin wheel,
 * interstitials, coin packs and the rating button are exercised for real.
 *
 * Vite/webpack bundles (`<script type="module">`) are bundled with esbuild
 * into one classic script before they are handed to jsdom.
 *
 * Usage:
 *   node tools/game-tests/run.mjs [--scenarios <file.json>] [--dump]
 *
 * Scenario steps (tools/game-tests/scenarios.json):
 *   clearStorage, storage {key: value}, reload, click "text", clickSelector,
 *   clickUntil {selector, until, max, every}, wait, pressBack ('webapp' |
 *   'container'), adEvent {type, data}, evaluate "js" (+ expectValue),
 *   clearWebStorageOnly, setNativeState {key: {value, savedAt}},
 *   setRewardGranted, setAdsEnabled, setHoldAds, setOwnedPurchases [...],
 *   setPurchaseOutcome ('ok' | 'unverified' | 'cancelled'),
 *   expectSelector / expectNoSelector, expectText / expectNoText,
 *   expectCall / expectNoCall / expectCallCount, expectStorage,
 *   expectBackHandled, dump.
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
// The container injects its compatibility layer (polyfills + rendering policy)
// into every HTML document it serves; the harness runs the same file, in the
// same position (end of <head>, before the module bundle).
const COMPAT_SCRIPT = path.join(WEB_ROOT, '..', 'native', 'compat.js');

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
/**
 * Argument count of every `@JavascriptInterface` method of the container.
 *
 * A JavaScript interface resolves a call by name **and** argument count: a
 * method declared `saveState(key, value, savedAt)` invoked with two arguments
 * throws `Method not found`, which `native-bridge.js` turns into a warning and
 * its fallback – the call silently disappears. That is how the native save
 * mirror (progress across a force stop) was dead for a whole round: the
 * facade's `flag()` helper forwarded at most two arguments. The stub below
 * enforces the same rule, so the harness fails on an arity bug long before an
 * emulator would.
 */
const BRIDGE_ARITIES = (() => {
  const file = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'chistan',
    'quickgames', 'WebAppBridge.kt');
  const source = fs.readFileSync(file, 'utf8');
  const arities = new Map();
  for (const match of source.matchAll(/@JavascriptInterface\s+fun\s+(\w+)\s*\(([^)]*)\)/g)) {
    const params = match[2].trim();
    arities.set(match[1], params ? params.split(',').length : 0);
  }
  return arities;
})();

/**
 * The container as the WebView presents it: a call whose argument count does
 * not match the declaration throws `Method not found`. Trailing `undefined`s
 * are dropped first – the container's binding does that too, which is why
 * `flag('navigateBack', false)` (a fixed-parameter wrapper padding with two
 * `undefined`s) still worked on the device.
 */
function strictContainer(window, stub) {
  const rejected = [];
  window.__harness.rejected = rejected;
  const container = {};
  for (const key of Object.keys(stub)) {
    const member = stub[key];
    const arity = BRIDGE_ARITIES.get(key);
    if (typeof member !== 'function' || arity === undefined) {
      container[key] = member;
      continue;
    }
    container[key] = function (...args) {
      let used = args.length;
      while (used > 0 && args[used - 1] === undefined) used -= 1;
      if (used !== arity) {
        const detail = `${key}() called with ${used} argument(s), declared with ${arity}`;
        rejected.push(detail);
        throw new Error('Method not found');
      }
      return member.apply(this, args.slice(0, used));
    };
  }
  return container;
}

function installBridge(window) {
  window.__harness = {
    calls: [],
    /** Calls the container refused: name + argument count (WebView: 'Method not found'). */
    rejected: [],
    adsEnabled: true,
    rewardGranted: true,
    billingConnected: true,
    removeAdsOwned: false,
    purchases: [],
    /** 'ok' | 'unverified' | 'cancelled' – what the next purchase returns. */
    purchaseOutcome: 'ok',
    /** When true show* returns true but the ad is never settled by the stub. */
    holdAds: false,
    /** Native mirror of saved-state blobs (WebAppStateStore): key -> {value, savedAt}. */
    nativeState: {},
    state() {
      return {
        calls: this.calls.slice(),
        purchases: this.purchases.slice(),
        adCalls: this.calls.filter(c => c.startsWith('NativeAds.')),
        billingCalls: this.calls.filter(c => c.startsWith('CafeBazaar.')),
        ratingCalls: this.calls.filter(c => c.startsWith('CafeBazaar.openRatingPage')),
        rejected: this.rejected.slice()
      };
    },
    reset() {
      this.calls.length = 0;
      this.rejected.length = 0;
      // Every scenario starts from the same "device": ads served, rewards
      // granted, billing connected, nothing owned.
      this.adsEnabled = true;
      this.rewardGranted = true;
      this.billingConnected = true;
      this.removeAdsOwned = false;
      this.purchases = [];
      this.purchaseOutcome = 'ok';
      this.holdAds = false;
      this.nativeState = {};
    }
  };

  const record = name => window.__harness.calls.push(name);
  const emit = (event, detail, delay = 100) =>
    window.setTimeout(() => window.dispatchEvent(new window.CustomEvent(event, { detail })), delay);
  const sink = (fn, payload, delay = 100) =>
    window.setTimeout(() => { const b = window.CafeBazaarBridge; if (b && b[fn]) b[fn](JSON.stringify(payload)); }, delay);
  // Ad events travel exactly like WebAppBridge.onAdEvent delivers them: the
  // envelope goes to NativeAds.onEvent(json) *and* out as a `nativeads:event`
  // DOM event, in the same tick – a facade must cope with both.
  const adEvent = (type, data, delay = 100) => window.setTimeout(() => {
    const envelope = { type, data: Object.assign({ provider: 'tapsell' }, data) };
    const json = JSON.stringify(envelope);
    const ads = window.NativeAds;
    if (ads && typeof ads.onEvent === 'function') { try { ads.onEvent(json); } catch (e) { console.error(e); } }
    window.dispatchEvent(new window.CustomEvent('nativeads:event', { detail: JSON.parse(json) }));
  }, delay);
  window.__harness.adEvent = adEvent;

  const bridgeStub = {
    isNativeApp: () => true,
    isProduction: () => true,
    getPackageName: () => 'com.labzband.balochafzar',
    getInfo: () => JSON.stringify({
      platform: 'android', sdkInt: 30, appVersion: '2.0.0', versionCode: 2,
      debug: false, serverPort: 7331, adsReady: true, pushEnabled: true
    }),
    appReady: () => { record('NativeApp.appReady'); emit('nativeapp:ready', { route: '' }); return true; },
    appLoaded: () => true,
    reportError: m => record('NativeApp.reportError:' + m),
    navigateBack: () => { record('NativeApp.navigateBack'); return true; },
    openEmail: address => { record('NativeApp.openEmail:' + address); return true; },
    // Saved-state mirror – same contract as WebAppBridge.saveState/loadState.
    saveState: (key, value, savedAt) => {
      record('NativeApp.saveState:' + key);
      if (typeof key !== 'string' || typeof value !== 'string') return false;
      window.__harness.nativeState[key] = { value, savedAt: Number(savedAt) || Date.now() };
      return true;
    },
    loadState: key => {
      record('NativeApp.loadState:' + key);
      const entry = window.__harness.nativeState[key];
      return entry ? JSON.stringify({ key, value: entry.value, savedAt: entry.savedAt }) : null;
    },
    clearState: key => { record('NativeApp.clearState:' + key); delete window.__harness.nativeState[key]; return true; },
    getStartupRoute: () => window.__harness.startupRoute || '',
    consumeStartupRoute: () => { window.__harness.startupRoute = ''; },

    isAdsAvailable: () => window.__harness.adsEnabled,
    isAdReady: () => window.__harness.adsEnabled,
    isRemoveAdsOwned: () => window.__harness.removeAdsOwned,
    getDeviceProfile: () => JSON.stringify({ tier: 'mid', suggestedPixelRatio: 1.5, cpuCores: 8, totalRamMb: 4096 }),
    getRenderPixelRatio: () => 1.5,
    prepareAds: () => record('NativeAds.prepare'),
    showInterstitial: () => {
      record('NativeAds.showInterstitial');
      if (!window.__harness.adsEnabled) {
        adEvent('ad_error', { adType: 'interstitial', error: 'INTERSTITIAL_NOT_CONFIGURED' }, 20);
        return false;
      }
      if (window.__harness.holdAds) return true;   // the scenario settles it later
      adEvent('interstitial_shown', { adType: 'interstitial' }, 60);
      adEvent('interstitial_closed', { adType: 'interstitial', shownCount: 1 }, 160);
      return true;
    },
    showRewarded: () => {
      record('NativeAds.showRewarded');
      if (!window.__harness.adsEnabled) {
        adEvent('ad_error', { adType: 'rewarded', error: 'REWARDED_NOT_CONFIGURED' }, 20);
        return false;
      }
      if (window.__harness.holdAds) return true;   // the scenario settles it later
      const granted = window.__harness.rewardGranted;
      adEvent('rewarded_shown', { adType: 'rewarded' }, 60);
      if (granted) adEvent('rewarded_completed', { adType: 'rewarded', rewardGranted: true, rewarded: true, shownCount: 1 }, 120);
      adEvent('rewarded_closed', { adType: 'rewarded', rewardGranted: granted }, 180);
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
      const outcome = window.__harness.purchaseOutcome;
      if (outcome === 'cancelled') {
        sink('onPurchaseResult', {
          success: false, verified: false, productId: id, message: 'Purchase cancelled by user', errorCode: 'CANCELLED'
        });
        return;
      }
      window.__harness.purchases.push(id);
      if (id === 'remove_ads') window.__harness.removeAdsOwned = true;
      // Exactly what PurchaseResult.toJson() emits; `verified` is false when
      // the RSA key is not configured (Poolakey SecurityCheck disabled).
      sink('onPurchaseResult', {
        success: true, verified: outcome !== 'unverified', productId: id, purchaseToken: 'token-' + id,
        orderId: 'order-' + id, purchaseTime: Date.now(), message: 'Purchase completed successfully'
      });
    },
    buyProductWithPayload: (id) => window.AndroidBridge.buyProduct(id),
    consumePurchase: token => {
      record('CafeBazaar.consumePurchase');
      sink('onConsumeResult', { success: true, purchaseToken: token }, 60);
    },
    getPurchases: () => {
      record('CafeBazaar.getPurchases');
      // Mirrors QueryPurchasesResult.toJson(): every active purchase is a
      // PurchaseResult (success/verified/productId/purchaseToken/...).
      const purchases = window.__harness.purchases.map(id => ({
        success: true, verified: true, productId: id, purchaseToken: 'token-' + id,
        orderId: 'order-' + id, purchaseTime: Date.now(), message: 'Active purchase'
      }));
      sink('onPurchasesQueryResult', { success: true, purchases, message: `Found ${purchases.length}` }, 60);
    },
    openRatingPage: () => { record('CafeBazaar.openRatingPage'); return true; },
    openStorePage: () => { record('CafeBazaar.openStorePage'); return true; },
    rateApp: () => { record('CafeBazaar.openRatingPage'); return true; }
  };
  window.AndroidBridge = strictContainer(window, bridgeStub);
}

/**
 * Browser APIs a Node-built game touches at boot that jsdom does not provide.
 * They are stubbed – not emulated – so the game boots the same way it does in
 * the WebView; anything visual (canvas, audio, workers) simply does nothing.
 */
function installBrowserShims(window) {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = query => ({
      matches: false, media: String(query), onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
      dispatchEvent() { return false; }
    });
  }
  if (typeof window.fetch !== 'function') {
    // Vite's modulepreload polyfill prefetches chunks with fetch(); the chunks
    // are already bundled, so a resolved promise is the right answer.
    window.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') });
  }
  if (typeof window.scrollTo !== 'function' || /not implemented/i.test(String(window.scrollTo))) {
    window.scrollTo = () => {};
  }
  if (window.HTMLElement && !('scrollIntoView' in window.HTMLElement.prototype)) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  if (!window.IntersectionObserver) {
    window.IntersectionObserver = class {
      constructor() {}
      observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
    };
  }
  if (window.HTMLCanvasElement) {
    // jsdom logs "not implemented" for getContext; a null context is what a
    // browser returns when 2D/WebGL is unavailable, and every engine copes.
    window.HTMLCanvasElement.prototype.getContext = () => null;
  }
  if (window.HTMLMediaElement) {
    window.HTMLMediaElement.prototype.play = () => Promise.resolve();
    window.HTMLMediaElement.prototype.pause = () => {};
    window.HTMLMediaElement.prototype.load = () => {};
  }
}

// ---------------------------------------------------------------------------
// Bundle loading
// ---------------------------------------------------------------------------
let entryCache = null;

async function readEntry() {
  if (entryCache) return entryCache;
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
      if (isModule) {
        modules.push({ src: srcMatch[1], code: await bundleModule(file, srcMatch[1]) });
      } else {
        classic.push({ src: srcMatch[1], code: fs.readFileSync(file, 'utf8') });
      }
    } else if (inline.trim()) {
      (isModule ? modules : classic).push({ src: '(inline)', code: isModule ? toClassic(inline, '(inline module)') : inline });
    }
  }
  entryCache = { html, classic, modules };
  return entryCache;
}

/**
 * jsdom cannot execute `<script type="module">`. A Node-built game (Vite,
 * webpack) ships a code-split module graph – an entry chunk that imports the
 * framework chunk and lazy-loads the app, levels and dictionary chunks – so
 * the graph is bundled into one classic IIFE script with esbuild, exactly what
 * the browser ends up executing. Dynamic `import()` calls are inlined, which is
 * fine here: the harness tests game logic, not loading behaviour.
 */
async function bundleModule(file, label) {
  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch {
    console.log(`WARN  ${label}: esbuild is not installed – falling back to a textual module rewrite ` +
      '(run: npm install --no-save esbuild)');
    return toClassic(fs.readFileSync(file, 'utf8'), label);
  }
  const result = await esbuild.build({
    entryPoints: [file],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    write: false,
    minify: false,
    sourcemap: false,
    logLevel: 'silent',
    absWorkingDir: WEB_ROOT,
    define: { 'import.meta.url': JSON.stringify('http://127.0.0.1:7331' + label) }
  });
  const out = result.outputFiles.find(f => f.path.endsWith('.js')) || result.outputFiles[0];
  return out.text;
}

/**
 * Textual fallback for a single self-contained module chunk: removes the
 * (empty) export statements; anything that still needs import resolution is
 * reported instead of being silently broken.
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
const HARNESS_KNOBS = ['adsEnabled', 'rewardGranted', 'billingConnected', 'removeAdsOwned', 'purchases', 'purchaseOutcome', 'holdAds', 'nativeState'];

async function boot(initialStorage = {}, harnessKnobs = {}, options = {}) {
  const { html, classic, modules } = await readEntry();
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
  installBrowserShims(window);
  // A reload keeps the "device state" of the stub (owned purchases, ad
  // availability, ...) – only the page is new.
  for (const key of HARNESS_KNOBS) {
    if (harnessKnobs[key] !== undefined) {
      window.__harness[key] = Array.isArray(harnessKnobs[key]) ? harnessKnobs[key].slice() : harnessKnobs[key];
    }
  }
  // Seed localStorage *before* the game boots – a reload keeps the saved
  // progress, and the game reads it synchronously during start-up.
  for (const [key, value] of Object.entries(initialStorage)) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  // Same order as the WebView: the container's compat script (end of <head>),
  // then the document's own classic scripts, then the module bundle.
  if (fs.existsSync(COMPAT_SCRIPT)) {
    const el = window.document.createElement('script');
    el.textContent = fs.readFileSync(COMPAT_SCRIPT, 'utf8');
    window.document.head.appendChild(el);
  }
  for (const script of classic) {
    const el = window.document.createElement('script');
    el.textContent = script.code;
    window.document.head.appendChild(el);
  }
  // `skipGame` boots the page without the game's own scripts: that is the
  // container contract test for "the WebApp never finishes booting" (old
  // WebView, broken/hanging game start-up) – the facade must still announce
  // readiness and keep the native save mirror alive.
  if (!options.skipGame) {
    for (const script of modules) {
      const el = window.document.createElement('script');
      el.textContent = toClassic(script.code, script.src);
      window.document.body.appendChild(el);
    }
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
  // jsdom has no layout, so "visible" means: not disabled, not hidden by an
  // attribute / inline style, and not inside a closed dialog or hidden subtree.
  const visible = n => {
    for (let node = n; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
      const style = (node.getAttribute('style') || '').replace(/\s+/g, '');
      if (style.includes('display:none') || style.includes('visibility:hidden')) return false;
    }
    return !n.disabled;
  };
  const matches = nodes.filter(n => (n.textContent || '').includes(text));
  // Prefer the most specific (innermost) visible match, then any match.
  const innermost = list => list.find(n => !list.some(o => o !== n && n.contains(o)));
  return innermost(matches.filter(visible)) || innermost(matches) || null;
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
  // Auto-detect chistan bundle: if the packaged game contains chistansara, use chistan scenarios
  try {
    const webAssets = path.join(ROOT, 'app', 'src', 'main', 'assets', 'web', 'assets');
    if (fs.existsSync(webAssets)) {
      const files = fs.readdirSync(webAssets);
      for (const f of files) {
        if (f.endsWith('.js')) {
          const content = fs.readFileSync(path.join(webAssets, f), 'utf8');
          if (content.includes('chistansara') || content.includes('چیستان‌سرا') || content.includes('چیستان')) {
            const chistanFile = path.join(ROOT, 'tools', 'game-tests', 'chistan_scenarios.json');
            if (fs.existsSync(chistanFile)) {
              console.log('Detected ChistanSara bundle – using chistan_scenarios.json');
              return JSON.parse(fs.readFileSync(chistanFile, 'utf8'));
            }
          }
          break;
        }
      }
    }
  } catch {}
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
      if (step.setPurchaseOutcome) window.__harness.purchaseOutcome = step.setPurchaseOutcome;
      if (step.setAdsEnabled !== undefined) window.__harness.adsEnabled = step.setAdsEnabled;
      if (step.setHoldAds !== undefined) window.__harness.holdAds = step.setHoldAds;
      if (step.adEvent) {
        // Deliver a container ad event by hand (used with setHoldAds to model
        // the activity switch of a real full-screen ad).
        const { type, data } = step.adEvent;
        window.__harness.adEvent(type, data || { adType: type.split('_')[0] }, 0);
        await settle(step.wait || SETTLE_MS);
      }
      if (step.clickUntil) {
        // Repeatedly click a control until a selector appears (e.g. buy hints
        // until the level-complete overlay shows up).
        const { selector, until, max = 40, every = 120 } = step.clickUntil;
        let clicks = 0;
        while (!window.document.querySelector(until) && clicks < max) {
          const target = window.document.querySelector(selector);
          if (!target) break;
          target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
          clicks++;
          await settle(every);
        }
        await settle(step.wait || SETTLE_MS);
        const reached = !!window.document.querySelector(until);
        console.log(`      clicked ${selector} ${clicks}x -> ${until} ${reached ? 'appeared' : 'MISSING'}`);
        check(`[${scenario.name}] ${until} appears after clicking ${selector}`, reached,
          reached ? '' : JSON.stringify(domSummary(window)).slice(0, 600));
      }
      if (step.evaluate) {
        // Runs JavaScript in the page (debugging aid; `expectValue` asserts on
        // the JSON-serialised result).
        let value;
        try { value = window.eval(step.evaluate); } catch (e) { value = 'ERROR: ' + e.message; }
        if (value && typeof value.then === 'function') value = await value;
        console.log(`      evaluate -> ${JSON.stringify(value)}`);
        if (step.expectValue !== undefined) {
          check(`[${scenario.name}] evaluate == ${JSON.stringify(step.expectValue)}`,
            JSON.stringify(value) === JSON.stringify(step.expectValue), JSON.stringify(value));
        }
        await settle(step.wait || 50);
      }
      if (step.expectSelector) {
        const ok = !!window.document.querySelector(step.expectSelector);
        check(`[${scenario.name}] renders ${step.expectSelector}`, ok, ok ? '' : JSON.stringify(domSummary(window)).slice(0, 400));
      }
      if (step.expectNoSelector) {
        const ok = !window.document.querySelector(step.expectNoSelector);
        check(`[${scenario.name}] does not render ${step.expectNoSelector}`, ok);
      }
      if (step.clearStorage) {
        // A fresh device: web storage *and* the native mirror.
        window.localStorage.clear();
        window.__harness.nativeState = {};
        await settle(100);
      }
      if (step.clearWebStorageOnly) {
        // A lost origin / wiped WebView store: the native mirror survives.
        window.localStorage.clear();
        await settle(100);
      }
      if (step.setNativeState) {
        for (const [key, entry] of Object.entries(step.setNativeState)) {
          const value = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
          window.__harness.nativeState[key] = { value, savedAt: Number(entry.savedAt) || 0 };
        }
      }
      if (step.storage) {
        for (const [key, value] of Object.entries(step.storage)) {
          window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
        await settle(100);
      }
      if (step.reload) {
        // localStorage survives a real reload: carry the raw strings over
        // (never the parsed objects – "[object Object]" is not valid JSON).
        const previousStorage = {};
        try {
          for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            previousStorage[key] = window.localStorage.getItem(key);
          }
        } catch (e) { /* ignore */ }
        const knobs = {};
        for (const key of HARNESS_KNOBS) knobs[key] = window.__harness[key];
        const fresh = await boot(previousStorage, knobs);
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

// Container protocol: a JavaScript interface resolves a call by name *and*
// argument count, and answers `Method not found` when the two disagree. The
// facade turns that into a warning and a fallback, so a mismatch is invisible
// at runtime – it just silently disables whatever the call was for (that is how
// the native save mirror died: `saveState(key, value, savedAt)` invoked with
// two arguments). `strictContainer()` above refuses such a call the way the
// WebView does, so the harness fails here instead.
{
  const rejected = window.__harness.state().rejected;
  check('every container call matches its WebAppBridge.kt signature',
    rejected.length === 0, rejected.slice(0, 4).join(' | '));
}

// Container contract: the native loading plate is lifted by
// `AndroidBridge.appReady()`, and the container gives up (error plate) when it
// never arrives. The game may not be the one who sends it – its own start-up can
// be slow, can hang or cannot even parse on the WebView the app ships to (that
// is exactly what broke the emulator jobs: an ES2021 operator in the bundle on
// the Chromium 83 baseline). So the facade owns the handshake: it must announce
// readiness on its own and mirror saves natively even when the game never boots.
{
  const facadeOnly = await boot({}, {}, { skipGame: true });
  await settle(1200);   // the handshake fires ~1 s after the document is ready
  const calls = () => facadeOnly.window.__harness.state().calls;
  check('the facade announces readiness even when the game never boots',
    calls().some(c => c.startsWith('NativeApp.appReady')), calls().join(', ') || '(no bridge call)');
  check('the facade installs the native save mirror',
    (() => {
      facadeOnly.window.localStorage.setItem('chistansara_game_save_v2',
        JSON.stringify({ coins: 1, completedLevels: { 1: true }, savedAt: Date.now() }));
      return calls().includes('NativeApp.saveState:chistansara_game_save_v2');
    })(), calls().join(', ') || '(no bridge call)');
  check('the facade keeps working without the game (ads and billing booted)',
    calls().includes('NativeAds.prepare') && calls().includes('CafeBazaar.connect'),
    calls().join(', ') || '(no bridge call)');
  check('the facade without the game calls the container with the declared signatures',
    facadeOnly.window.__harness.state().rejected.length === 0,
    facadeOnly.window.__harness.state().rejected.slice(0, 4).join(' | '));
  check('the facade without the game throws nothing',
    !facadeOnly.log.some(l => l.startsWith('jsdomError')),
    facadeOnly.log.filter(l => l.startsWith('jsdomError')).slice(0, 2).join(' | '));
}

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
