/**
 * Shared plumbing for the emulator scripts (`emulator_play.mjs`, `ad_lab.mjs`):
 * adb helpers, a minimal Chrome DevTools Protocol client, WebView target
 * discovery, page helpers and a PASS/FAIL reporter.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export const argValue = (flag, fallback) => {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
};

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------
export function createReporter(prefix) {
  const results = [];
  const note = msg => console.log(`[${prefix}] ${msg}`);
  const pass = msg => { results.push({ ok: true, msg }); console.log(`[${prefix}] PASS ${msg}`); };
  const fail = (msg, detail = '') => {
    results.push({ ok: false, msg });
    console.log(`[${prefix}] FAIL ${msg}${detail ? ' :: ' + String(detail).slice(0, 400) : ''}`);
  };
  const check = (cond, msg, detail) => (cond ? pass(msg) : fail(msg, detail));
  const summary = () => {
    const failed = results.filter(r => !r.ok).length;
    console.log(`[${prefix}] ${results.length - failed}/${results.length} checks passed`);
    return failed;
  };
  return { results, note, pass, fail, check, summary };
}

// ---------------------------------------------------------------------------
// adb helpers
// ---------------------------------------------------------------------------
export function adb(...args) {
  return execFileSync('adb', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\r/g, '');
}
export function adbQuiet(...args) {
  try { return adb(...args); } catch { return ''; }
}
export function screenshot(outDir, name) {
  const res = spawnSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 32 * 1024 * 1024 });
  if (res.status === 0 && res.stdout && res.stdout.length > 0) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${name}.png`), res.stdout);
    return true;
  }
  return false;
}
export function logMarker(tag, text) {
  adbQuiet('shell', 'log', '-t', tag, text);
}
export function logcatSince(marker) {
  const all = adbQuiet('logcat', '-d');
  const idx = all.lastIndexOf(marker);
  return idx >= 0 ? all.slice(idx) : all;
}
/** Component name of the resumed Activity, e.g. `com.foo/.MainActivity`. */
export function resumedActivity() {
  const dump = adbQuiet('shell', 'dumpsys', 'activity', 'activities');
  const m = /(?:mResumedActivity|ResumedActivity|topResumedActivity)[^\n]*?\{[^}]*?\s([\w.]+\/[\w.$]+)/.exec(dump);
  return m ? m[1] : '';
}
/** Display rotation (0..3) as reported by the window manager, or -1. */
export function displayRotation() {
  const dump = adbQuiet('shell', 'dumpsys', 'window', 'displays');
  const m = /(?:mCurrentRotation|mRotation)=(?:ROTATION_)?(\d)/.exec(dump) || /rotation=(\d)/.exec(dump);
  return m ? Number(m[1]) : -1;
}

/**
 * Raw frame statistics from `screencap` (no PNG decoding needed): the raw
 * dump is `w, h, format[, colorspace]` (u32 LE) followed by RGBA pixels.
 * A sub-sampled grid is analysed: share of near-white pixels, mean luma and
 * the share of pixels that changed against `previous` (churn).
 */
export function frameStats(previous) {
  const res = spawnSync('adb', ['exec-out', 'screencap'], { maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0 || !res.stdout || res.stdout.length < 16) return null;
  const buf = res.stdout;
  const w = buf.readUInt32LE(0);
  const h = buf.readUInt32LE(4);
  const pixelBytes = w * h * 4;
  if (!w || !h || buf.length < pixelBytes + 12) return null;
  const header = buf.length - pixelBytes; // 12 or 16 bytes
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 20000))); // ~20k samples
  const samples = [];
  let white = 0, luma = 0, n = 0, changed = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const o = header + (y * w + x) * 4;
      const r = buf[o], g = buf[o + 1], b = buf[o + 2];
      const l = (r * 299 + g * 587 + b * 114) / 1000;
      if (r > 235 && g > 235 && b > 235) white++;
      luma += l;
      if (previous && previous.samples && previous.samples.length > n && Math.abs(previous.samples[n] - l) > 40) changed++;
      samples.push(l);
      n++;
    }
  }
  return {
    width: w, height: h,
    whiteRatio: n ? +(white / n).toFixed(3) : 0,
    meanLuma: n ? Math.round(luma / n) : 0,
    churn: previous && n ? +(changed / n).toFixed(3) : 0,
    samples
  };
}

// ---------------------------------------------------------------------------
// Minimal CDP client (global WebSocket on Node >= 22, `ws` otherwise)
// ---------------------------------------------------------------------------
export async function webSocketImpl() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  const mod = await import('ws');
  return mod.default || mod.WebSocket;
}

export class Cdp {
  constructor(WS, url) {
    this.ws = new WS(url);
    this.nextId = 0;
    this.pending = new Map();
    this.exceptions = [];
    this.consoleErrors = [];
    this.consoleLines = [];
  }
  open() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('devtools socket did not open')), 10000);
      this.ws.onopen = () => { clearTimeout(timer); resolve(); };
      this.ws.onerror = e => { clearTimeout(timer); reject(new Error('devtools socket error: ' + (e && e.message ? e.message : 'unknown'))); };
      this.ws.onmessage = m => this.onMessage(typeof m.data === 'string' ? m.data : m.data.toString());
    });
  }
  onMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message || 'CDP error'}`));
      else resolve(msg.result || {});
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params && msg.params.exceptionDetails;
      const text = d ? (d.exception && d.exception.description) || d.text || 'exception' : 'exception';
      this.exceptions.push(String(text).split('\n').slice(0, 2).join(' ').slice(0, 300));
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params) {
      const args = (msg.params.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || a.type));
      const line = args.join(' ').slice(0, 300);
      this.consoleLines.push(`${msg.params.type}: ${line}`);
      if (msg.params.type === 'error') this.consoleErrors.push(line);
    }
  }
  send(method, params = {}, timeout = 15000) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out after ${timeout} ms`)); }, timeout);
      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); }
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression, { awaitPromise = false, timeout = 15000 } = {}) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }, timeout);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('page exception: ' + ((d.exception && d.exception.description) || d.text || 'unknown').split('\n')[0]);
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

// ---------------------------------------------------------------------------
// Target discovery
// ---------------------------------------------------------------------------
export async function findTarget(pkg, port, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no WebView devtools socket';
  while (Date.now() < deadline) {
    const pid = adbQuiet('shell', 'pidof', '-s', pkg).trim();
    if (pid) {
      const sockets = adbQuiet('shell', 'cat', '/proc/net/unix')
        .split('\n').map(l => l.trim().split(/\s+/).pop() || '')
        .filter(n => n.includes('webview_devtools_remote'))
        .map(n => n.replace(/^@/, ''));
      const preferred = sockets.find(n => n.endsWith('_' + pid)) || sockets[0];
      if (preferred) {
        adbQuiet('forward', '--remove', `tcp:${port}`);
        adbQuiet('forward', `tcp:${port}`, `localabstract:${preferred}`);
        try {
          const res = await fetch(`http://127.0.0.1:${port}/json`);
          const targets = await res.json();
          const page = targets.find(t => t.type === 'page' && /^https?:\/\/127\.0\.0\.1/.test(t.url || ''))
            || targets.find(t => t.type === 'page');
          if (page && page.webSocketDebuggerUrl) return { page, socket: preferred, pid };
          lastError = `no page target in ${JSON.stringify(targets).slice(0, 200)}`;
        } catch (e) {
          lastError = `devtools http endpoint: ${e.message}`;
        }
      } else {
        lastError = `process ${pid} exposes no webview_devtools_remote socket`;
      }
    } else {
      lastError = `${pkg} is not running`;
    }
    await sleep(1000);
  }
  throw new Error(lastError);
}

/** Opens a CDP session on the app's page target (Runtime + Page enabled). */
export async function connectPage(pkg, port, note) {
  const WS = await webSocketImpl();
  const { page, socket, pid } = await findTarget(pkg, port);
  if (note) note(`devtools target: ${page.url} (pid ${pid}, socket ${socket})`);
  const cdp = new Cdp(WS, page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  return cdp;
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------
export const js = String.raw;

export async function waitFor(cdp, selector, timeoutMs, label = selector, reporter = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let found = false;
    try { found = await cdp.evaluate(js`!!document.querySelector(${JSON.stringify(selector)})`); } catch { /* page navigating */ }
    if (found) return true;
    await sleep(250);
  }
  if (reporter) reporter.fail(`${label} did not appear within ${timeoutMs} ms`, await domSummary(cdp));
  return false;
}

/** Polls a JavaScript expression until it is truthy. */
export async function waitForCondition(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await cdp.evaluate(expression)) return true; } catch { /* page navigating */ }
    await sleep(250);
  }
  return false;
}

export async function domSummary(cdp) {
  try {
    return await cdp.evaluate(js`(function () {
      var ids = Array.prototype.slice.call(document.querySelectorAll('[id]')).map(function (n) { return n.id; }).slice(0, 40);
      var text = (document.body && document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 240);
      return 'ids=' + ids.join(',') + ' text=' + text;
    })()`);
  } catch (e) {
    return 'dom unavailable: ' + e.message;
  }
}

/**
 * Clicks `selector` until `until` shows up (or, for the play-through, until
 * the ad shim reports a request). Returns the number of clicks made.
 */
export async function clickUntil(cdp, selector, until, { max = 40, every = 160 } = {}) {
  return cdp.evaluate(js`(async function () {
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var clicks = 0, shim = window.__playShim, lab = window.__lab;
    var adPending = function () { return !!(shim && shim.pending) || !!(lab && lab.adRequested && !lab.adClosed); };
    var done = function () { return !!document.querySelector(${JSON.stringify(until)}) || adPending(); };
    while (!done() && clicks < ${max}) {
      var b = document.querySelector(${JSON.stringify(selector)});
      if (!b) break;
      b.click(); clicks++;
      await sleep(${every});
    }
    await sleep(600);
    return { clicks: clicks, reached: !!document.querySelector(${JSON.stringify(until)}), adRequested: adPending() };
  })()`, { awaitPromise: true, timeout: max * every + 15000 });
}

// ---------------------------------------------------------------------------
// ChistanSara game helpers (text driven – the packaged UI has no stable ids)
// ---------------------------------------------------------------------------
/**
 * Main-menu labels of the game. The play/resume button reads «شروع بازی» on a
 * fresh save and «ادامه بازی» once there is progress, so both must be accepted.
 */
export const MENU_LABELS = ['ادامه بازی', 'شروع بازی'];
/** The label that advances to the next level inside the win dialog. */
export const NEXT_LEVEL_LABEL = 'مرحله بعدی';

/** Waits for the main menu (either play/resume label). */
export async function waitForMenu(cdp, timeoutMs, label = 'the main menu') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const text of MENU_LABELS) {
      let found = false;
      try { found = await cdp.evaluate(hasText(text)); } catch { /* navigating */ }
      if (found) return text;
    }
    await sleep(300);
  }
  return null;
}

/** The game's save key; the native mirror uses the same key. */
export const SAVE_KEY = 'chistansara_game_save_v2';
/** Legacy key of the labzband build – kept so a stale install still reads. */
export const LEGACY_SAVE_KEY = 'labzband_progress_v4';

/** Clicks the innermost clickable element whose visible text matches `text`. */
export function clickText(text) {
  return js`(function () {
    var wanted = ${JSON.stringify(text)};
    var nodes = document.querySelectorAll('button,[role="button"],a,div,span,p');
    var best = null;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var label = (node.innerText || node.textContent || '').trim();
      if (label !== wanted) continue;
      var rect = node.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) continue;
      if (node.disabled === true) continue;
      // innermost match wins (a button wrapping its label, not the page shell)
      best = (!best || node.contains(best)) ? node : best;
    }
    if (!best) return null;
    var target = best.closest ? (best.closest('button,[role="button"],a') || best) : best;
    var r = target.getBoundingClientRect();
    var x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    try {
      target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
      target.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: x, clientY: y }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
      target.click();
    } catch (e) { return 'error: ' + e.message; }
    return (target.tagName || '') + ' @ ' + x + ',' + y;
  })()`;
}

export function hasText(text) {
  return js`(function () {
    var wanted = ${JSON.stringify(text)};
    var nodes = document.querySelectorAll('button,[role="button"],a,div,span,p,h1,h2,h3');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if ((node.innerText || node.textContent || '').trim() !== wanted) continue;
      var rect = node.getBoundingClientRect();
      if (rect.width >= 2 && rect.height >= 2) return true;
    }
    return false;
  })()`;
}

export function bodyText(cdp) {
  return cdp.evaluate('(document.body && document.body.innerText || "").slice(0, 400)');
}

/** Polls for a visible element carrying exactly `text`. */
export async function waitForText(cdp, text, timeoutMs, label = text, reporter = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let found = false;
    try { found = await cdp.evaluate(hasText(text)); } catch { /* navigating */ }
    if (found) return true;
    await sleep(300);
  }
  if (reporter) reporter.fail(`${label} did not appear within ${timeoutMs} ms`, await bodyText(cdp));
  return false;
}

/** Clicks `text` (waiting for it first) and reports what was clicked. */
export async function tapText(cdp, text, timeoutMs = 20000, reporter = null) {
  if (!await waitForText(cdp, text, timeoutMs, `"${text}"`, reporter)) return false;
  const clicked = await cdp.evaluate(clickText(text));
  if (!clicked) {
    if (reporter) reporter.fail(`"${text}" could not be clicked`, await bodyText(cdp));
    return false;
  }
  return true;
}

/** Reads the game's progress from localStorage and its native mirror. */
export function readSave(cdp) {
  return cdp.evaluate(js`(function () {
    var key = ${JSON.stringify(SAVE_KEY)}, legacy = ${JSON.stringify(LEGACY_SAVE_KEY)};
    var out = { key: key, port: location.port, origin: location.origin, coins: null, completions: -1,
      current: -1, savedAt: null, mirror: null, info: null };
    var raw = null;
    try {
      raw = localStorage.getItem(key);
      if (raw === null) { key = legacy; raw = localStorage.getItem(key); out.key = key; }
      if (raw) {
        var p = JSON.parse(raw);
        out.coins = typeof p.coins === 'number' ? p.coins : null;
        out.completions = p.completedLevels ? Object.keys(p.completedLevels).length : -1;
        out.current = typeof p.currentLevel === 'number' ? p.currentLevel : -1;
      }
      out.savedAt = localStorage.getItem(key + ':savedAt');
    } catch (e) { out.error = String(e); }
    try {
      var m = window.NativeApp && window.NativeApp.loadState ? window.NativeApp.loadState(key) : null;
      if (m && m.value) {
        var q = JSON.parse(m.value);
        out.mirror = { completions: q.completedLevels ? Object.keys(q.completedLevels).length : -1,
          coins: typeof q.coins === 'number' ? q.coins : null, savedAt: m.savedAt };
      }
    } catch (e) { out.mirrorError = String(e); }
    try {
      var i = window.NativeApp.getInfo();
      out.info = { serverPort: i.serverPort, stableOrigin: i.stableOrigin, stateMirror: i.stateMirror };
    } catch (e) {}
    return out;
  })()`);
}

/** Seeds the game's save game (a *fresh* save unless levels are asked for). */
export async function seedChistan(cdp, { completions = 0, coins = 500, currentLevel = null } = {}) {
  await cdp.evaluate(js`(function () {
    var key = ${JSON.stringify(SAVE_KEY)};
    var levels = {};
    for (var i = 1; i <= ${completions}; i++) levels[i] = { stars: 3, solvedAt: i, completedAt: i };
    var save = {
      version: 2, coins: ${coins}, currentLevel: ${currentLevel === null ? completions + 1 : currentLevel},
      completedLevels: levels, streak: 0, currentStreak: 0, totalCorrect: ${completions},
      soundEnabled: true, musicEnabled: true, hintsUsed: 0, purchasedTokens: [], adsRemoved: false,
      savedAt: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(save));
    localStorage.setItem(key + ':savedAt', String(Date.now() + 1000));
    return true;
  })()`);
  await sleep(400);
}

/** Reloads the page inside the running WebView (the closest thing to a cold URL load). */
export async function reloadPage(cdp, waitMs = 2500) {
  await cdp.evaluate('setTimeout(function () { location.reload(); }, 50); true');
  await sleep(waitMs);
}

/** The save game used to skip the tutorial and afford unlimited hints. */
export const PROGRESS_KEY = 'labzband_progress_v4';
export const RICH_PROGRESS = {
  version: 4, coins: 100000, currentLevelNumber: 1, unlockedLevels: [1], levelStars: {}, completed: {},
  purchaseTokens: {}, adsRemoved: false, completions: 0, ratingPrompted: false, soundEnabled: false, showRomanized: true
};

/**
 * Seeds the save game and reloads the page inside the running WebView.
 *
 * The seed is stamped newer than anything saved so far: at boot the game
 * restores the newer of the web copy and its native mirror
 * (`NativeApp.saveState`, see WebAppStateStore.kt) – without the stamp the
 * mirror of the fresh state written at the first boot would win over the seed.
 */
export async function seedAndReload(cdp) {
  await cdp.evaluate(js`(function () {
    localStorage.setItem(${JSON.stringify(PROGRESS_KEY)}, ${JSON.stringify(JSON.stringify(RICH_PROGRESS))});
    localStorage.setItem(${JSON.stringify(PROGRESS_KEY + ':savedAt')}, String(Date.now() + 1000));
    setTimeout(function () { location.reload(); }, 50);
    return true;
  })()`);
  await sleep(1500);
}

/** Uncaught exceptions / console errors seen so far, for a failure detail. */
export function pageErrors(cdp) {
  const parts = [];
  if (cdp.exceptions.length) parts.push('exceptions: ' + cdp.exceptions.slice(0, 3).join(' | '));
  if (cdp.consoleErrors.length) parts.push('console.error: ' + cdp.consoleErrors.slice(0, 3).join(' | '));
  return parts.join(' ;; ');
}
