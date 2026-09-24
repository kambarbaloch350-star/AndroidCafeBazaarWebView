/*
 * Container compatibility layer
 * =============================
 *
 * Served by LocalWebServer at /__native/compat.js and injected at the end of
 * <head> of every HTML document of the packaged WebApp (see CompatInjector).
 * It runs before the bundle's module scripts (those are deferred until the
 * document is parsed) and after the document's <meta> tags.
 *
 * Two jobs:
 *
 *  1. Polyfills. A Vite/webpack bundle built for "modern browsers" uses
 *     Object.hasOwn, Array.prototype.at, String.prototype.replaceAll, … without
 *     guards. Android System WebView is a separately updated app, and devices
 *     that cannot reach Google Play keep the Chromium they shipped with –
 *     Chromium 83 on the CI emulator, Chromium 7x–9x on many Android 7–10
 *     phones. On those, a single missing built-in throws inside the game's
 *     logic (a level cannot be completed, a purchase is not credited, …).
 *     Everything here is guarded: on a current WebView nothing is changed.
 *
 *  2. Rendering policy of the container. Read from <meta name="native-…">
 *     tags of the document, applied before the bundle evaluates:
 *
 *       <meta name="native-offscreen-canvas" content="on">
 *           keeps HTMLCanvasElement.prototype.transferControlToOffscreen.
 *           By default it is removed: a Worker-driven OffscreenCanvas layer
 *           is not repaired after the GPU context loss that a full-screen ad
 *           (or any background trip) causes on many Android WebViews – the
 *           layer flickers or paints white until the page is reloaded. Canvas
 *           libraries (canvas-confetti, PixiJS, Construct, …) fall back to a
 *           main-thread canvas when the transfer API is absent.
 *
 *  3. Field diagnostics. Uncaught errors and unhandled promise rejections are
 *     mirrored to console.error, which the container writes to logcat
 *     (`adb logcat -s WebApp`) in release builds too.
 *
 * Written in ES5 on purpose: it must parse on any WebView.
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var added = [];
  var policy = [];

  function define(obj, name, value) {
    if (!obj || typeof obj[name] === 'function') return false;
    try {
      Object.defineProperty(obj, name, { value: value, writable: true, configurable: true, enumerable: false });
    } catch (e) {
      try { obj[name] = value; } catch (e2) { return false; }
    }
    return typeof obj[name] === 'function';
  }

  function polyfill(owner, ownerName, name, value) {
    if (define(owner, name, value)) added.push(ownerName + '.' + name);
  }

  // -------------------------------------------------------------------------
  // 1. ECMAScript built-ins
  // -------------------------------------------------------------------------
  if (typeof global.globalThis === 'undefined') {
    try { global.globalThis = global; added.push('globalThis'); } catch (e) { /* ignore */ }
  }

  polyfill(Object, 'Object', 'hasOwn', function hasOwn(o, key) {
    return Object.prototype.hasOwnProperty.call(Object(o), key);
  });

  polyfill(Object, 'Object', 'fromEntries', function fromEntries(iterable) {
    var out = {};
    var list = Array.isArray(iterable) ? iterable : Array.from(iterable);
    for (var i = 0; i < list.length; i++) out[list[i][0]] = list[i][1];
    return out;
  });

  function at(n) {
    var len = this.length >>> 0;
    n = Math.trunc(n) || 0;
    if (n < 0) n += len;
    if (n < 0 || n >= len) return undefined;
    return this[n];
  }
  polyfill(Array.prototype, 'Array.prototype', 'at', at);
  polyfill(String.prototype, 'String.prototype', 'at', at);

  polyfill(Array.prototype, 'Array.prototype', 'findLast', function findLast(fn, thisArg) {
    for (var i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return this[i];
    return undefined;
  });
  polyfill(Array.prototype, 'Array.prototype', 'findLastIndex', function findLastIndex(fn, thisArg) {
    for (var i = this.length - 1; i >= 0; i--) if (fn.call(thisArg, this[i], i, this)) return i;
    return -1;
  });
  polyfill(Array.prototype, 'Array.prototype', 'flat', function flat(depth) {
    depth = depth === undefined ? 1 : Math.trunc(depth) || 0;
    var out = [];
    (function walk(arr, d) {
      for (var i = 0; i < arr.length; i++) {
        if (Array.isArray(arr[i]) && d > 0) walk(arr[i], d - 1);
        else if (i in arr) out.push(arr[i]);
      }
    })(this, depth);
    return out;
  });
  polyfill(Array.prototype, 'Array.prototype', 'flatMap', function flatMap(fn, thisArg) {
    return Array.prototype.flat.call(Array.prototype.map.call(this, fn, thisArg), 1);
  });

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  polyfill(String.prototype, 'String.prototype', 'replaceAll', function replaceAll(search, replacement) {
    if (search instanceof RegExp) {
      if (!search.global) throw new TypeError('replaceAll must be called with a global RegExp');
      return this.replace(search, replacement);
    }
    return this.replace(new RegExp(escapeRegExp(search), 'g'), replacement);
  });
  polyfill(String.prototype, 'String.prototype', 'trimStart', function trimStart() { return this.replace(/^\s+/, ''); });
  polyfill(String.prototype, 'String.prototype', 'trimEnd', function trimEnd() { return this.replace(/\s+$/, ''); });

  if (typeof global.AggregateError !== 'function') {
    global.AggregateError = function AggregateError(errors, message) {
      var err = new Error(message);
      err.name = 'AggregateError';
      err.errors = Array.from(errors);
      return err;
    };
    added.push('AggregateError');
  }
  if (typeof Promise === 'function') {
    polyfill(Promise, 'Promise', 'allSettled', function allSettled(iterable) {
      return Promise.all(Array.from(iterable).map(function (p) {
        return Promise.resolve(p).then(
          function (value) { return { status: 'fulfilled', value: value }; },
          function (reason) { return { status: 'rejected', reason: reason }; }
        );
      }));
    });
    polyfill(Promise, 'Promise', 'any', function any(iterable) {
      var list = Array.from(iterable);
      return new Promise(function (resolve, reject) {
        var errors = new Array(list.length);
        var pending = list.length;
        if (!pending) { reject(new global.AggregateError([], 'All promises were rejected')); return; }
        list.forEach(function (p, i) {
          Promise.resolve(p).then(resolve, function (err) {
            errors[i] = err;
            if (--pending === 0) reject(new global.AggregateError(errors, 'All promises were rejected'));
          });
        });
      });
    });
  }

  if (typeof global.queueMicrotask !== 'function' && typeof Promise === 'function') {
    global.queueMicrotask = function queueMicrotask(cb) {
      Promise.resolve().then(cb).catch(function (e) { setTimeout(function () { throw e; }, 0); });
    };
    added.push('queueMicrotask');
  }

  if (typeof global.structuredClone !== 'function') {
    global.structuredClone = function structuredClone(value) {
      var seen = typeof Map === 'function' ? new Map() : null;
      function clone(v) {
        if (v === null || typeof v !== 'object') {
          if (typeof v === 'function' || typeof v === 'symbol') throw new Error('DataCloneError: ' + typeof v + ' could not be cloned.');
          return v;
        }
        if (seen && seen.has(v)) return seen.get(v);
        var out;
        if (v instanceof Date) out = new Date(v.getTime());
        else if (v instanceof RegExp) out = new RegExp(v.source, v.flags);
        else if (typeof Map === 'function' && v instanceof Map) {
          out = new Map();
          if (seen) seen.set(v, out);
          v.forEach(function (val, key) { out.set(clone(key), clone(val)); });
          return out;
        } else if (typeof Set === 'function' && v instanceof Set) {
          out = new Set();
          if (seen) seen.set(v, out);
          v.forEach(function (val) { out.add(clone(val)); });
          return out;
        } else if (typeof ArrayBuffer === 'function' && v instanceof ArrayBuffer) out = v.slice(0);
        else if (typeof ArrayBuffer === 'function' && ArrayBuffer.isView(v)) out = new v.constructor(v);
        else if (Array.isArray(v)) {
          out = [];
          if (seen) seen.set(v, out);
          for (var i = 0; i < v.length; i++) out[i] = clone(v[i]);
          return out;
        } else {
          out = {};
          if (seen) seen.set(v, out);
          for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = clone(v[k]);
          return out;
        }
        if (seen) seen.set(v, out);
        return out;
      }
      return clone(value);
    };
    added.push('structuredClone');
  }

  if (global.AbortSignal && typeof global.AbortController === 'function' && typeof global.AbortSignal.timeout !== 'function') {
    try {
      global.AbortSignal.timeout = function timeout(ms) {
        var controller = new global.AbortController();
        setTimeout(function () { controller.abort(); }, ms);
        return controller.signal;
      };
      added.push('AbortSignal.timeout');
    } catch (e) { /* ignore */ }
  }

  if (global.crypto && typeof global.crypto.getRandomValues === 'function' && typeof global.crypto.randomUUID !== 'function') {
    try {
      global.crypto.randomUUID = function randomUUID() {
        var bytes = global.crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        var hex = Array.prototype.map.call(bytes, function (b) { return (b + 0x100).toString(16).slice(1); }).join('');
        return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
      };
      added.push('crypto.randomUUID');
    } catch (e) { /* ignore */ }
  }

  // -------------------------------------------------------------------------
  // 1b. DOM built-ins
  // -------------------------------------------------------------------------
  if (global.Element && global.Element.prototype) {
    polyfill(global.Element.prototype, 'Element.prototype', 'replaceChildren', function replaceChildren() {
      while (this.lastChild) this.removeChild(this.lastChild);
      for (var i = 0; i < arguments.length; i++) {
        var node = arguments[i];
        this.appendChild(typeof node === 'string' ? doc.createTextNode(node) : node);
      }
    });
    polyfill(global.Element.prototype, 'Element.prototype', 'toggleAttribute', function toggleAttribute(name, force) {
      var has = this.hasAttribute(name);
      if (force === undefined ? has : !force) { if (has) this.removeAttribute(name); return false; }
      if (!has) this.setAttribute(name, '');
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // 2. Rendering policy (from <meta name="native-…"> tags in <head>)
  // -------------------------------------------------------------------------
  function meta(name) {
    if (!doc || typeof doc.querySelector !== 'function') return '';
    var el = doc.querySelector('meta[name="' + name + '"]');
    return el ? String(el.getAttribute('content') || '').trim().toLowerCase() : '';
  }

  var offscreen = meta('native-offscreen-canvas');
  var canvasProto = global.HTMLCanvasElement && global.HTMLCanvasElement.prototype;
  if (offscreen !== 'on' && canvasProto && typeof canvasProto.transferControlToOffscreen === 'function') {
    try { delete canvasProto.transferControlToOffscreen; } catch (e) { /* ignore */ }
    if (typeof canvasProto.transferControlToOffscreen === 'function') {
      try {
        Object.defineProperty(canvasProto, 'transferControlToOffscreen', { value: undefined, writable: true, configurable: true });
      } catch (e2) { /* ignore */ }
    }
    if (typeof canvasProto.transferControlToOffscreen !== 'function') policy.push('offscreen-canvas-transfer:off');
  }

  // -------------------------------------------------------------------------
  // 3. Field diagnostics
  // -------------------------------------------------------------------------
  try {
    global.addEventListener('error', function (event) {
      var msg = event && event.message ? event.message : 'Script error';
      var where = event && event.filename ? ' @ ' + event.filename + ':' + event.lineno + ':' + event.colno : '';
      console.error('[uncaught] ' + msg + where);
    });
    global.addEventListener('unhandledrejection', function (event) {
      var reason = event && event.reason;
      var text = reason && reason.stack ? String(reason.stack).split('\n').slice(0, 2).join(' ') : String(reason);
      console.error('[unhandledrejection] ' + text);
    });
  } catch (e) { /* ignore */ }

  // -------------------------------------------------------------------------
  // Report (visible to the page, to tests and to `adb logcat -s WebApp`)
  // -------------------------------------------------------------------------
  var chrome = 0;
  try {
    var m = /Chrome\/(\d+)/.exec(global.navigator && global.navigator.userAgent || '');
    chrome = m ? parseInt(m[1], 10) : 0;
  } catch (e) { /* ignore */ }
  global.__nativeCompat = { chrome: chrome, polyfills: added.slice(), policy: policy.slice() };
  try {
    doc.documentElement.setAttribute('data-native-compat', added.concat(policy).join(' ') || 'none');
  } catch (e) { /* ignore */ }
  if (added.length && global.console && typeof console.info === 'function') {
    console.info('[native-compat] Chromium ' + chrome + ': polyfilled ' + added.join(', '));
  }
})(typeof window !== 'undefined' ? window : this);
