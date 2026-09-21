/**
 * app.js — sample WebApp that exercises every container capability.
 *
 * Replace this file with your own bundle. The container only requires:
 *
 *   1. index.html (your app) inside assets/web/
 *   2. a call to NativeApp.appReady() when your app is interactive
 *
 * Everything else below is a reference implementation / self-test harness:
 * SPA hash routing, fetch() over the local HTTP server, IndexedDB, Canvas,
 * WebGL, WebAssembly, <video>/<audio>, file input, native ads and deep links.
 */
(function () {
  'use strict';

  var app = document.getElementById('view');
  var bootSplash = document.getElementById('web-boot');
  var runtimeBadge = document.getElementById('runtime-badge');
  var statusText = document.getElementById('status-text');
  var statusDot = document.getElementById('status-dot');
  var toastEl = document.getElementById('toast');

  var state = {
    ready: false,
    native: typeof window.AndroidBridge !== 'undefined',
    info: {},
    capabilities: {},
    logs: [],
    startedAt: Date.now()
  };

  // ------------------------------------------------------------------ utils
  function log(message) {
    var stamp = new Date().toISOString().substring(11, 23);
    state.logs.unshift('[' + stamp + '] ' + message);
    if (state.logs.length > 120) state.logs.pop();
    var el = document.getElementById('log-view');
    if (el) el.textContent = state.logs.join('\n');
    // Mirrored to the WebView console so the native side (and `adb logcat`)
    // can follow the boot handshake without a remote debugger.
    try {
      console.log('[webapp] ' + message);
    } catch (err) {
      /* console is always present in a WebView; never let logging break the app */
    }
  }

  function toast(message, ms) {
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () {
      toastEl.classList.remove('is-visible');
    }, ms || 2400);
  }

  function setStatus(text, kind) {
    statusText.textContent = text;
    statusDot.className = 'status-bar__dot' +
      (kind === 'ok' ? ' is-ok' : kind === 'warn' ? ' is-warn' : kind === 'err' ? ' is-err' : '');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function el(html) {
    var wrapper = document.createElement('div');
    wrapper.innerHTML = html.trim();
    return wrapper.firstElementChild;
  }

  // --------------------------------------------------------------- routing
  var routes = {};

  function currentRoute() {
    var hash = (location.hash || '').replace(/^#\/?/, '');
    return hash.split('?')[0] || 'ads';
  }

  function render() {
    var name = currentRoute();
    var view = routes[name] || routes['ads'];
    app.innerHTML = '';
    app.appendChild(view());
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      var target = (tab.getAttribute('href') || '').replace(/^#\/?/, '');
      tab.classList.toggle('is-active', target === name);
    });
    window.scrollTo(0, 0);
    log('route -> #/' + name);
    if (name === 'capabilities') mountCanvasDemo();
  }

  // NOTE: the listener resolves `render` at call time on purpose – the wrapper
  // further down adds the container/info repaint for in-page navigation.
  window.addEventListener('hashchange', function () {
    render();
  });

  // ------------------------------------------------------------------ views
  routes.ads = function () {
    var card = el(
      '<section class="card">' +
        '<h2>تبلیغات بومی (Tapsell)</h2>' +
        '<p class="hint">تبلیغات کاملاً بومی اجرا می‌شوند؛ شناسه‌ها هرگز به این صفحه ارسال نمی‌شوند و هیچ خطایی ' +
        'نمی‌تواند اجرای برنامه را متوقف کند. همه متدها یک Promise برمی‌گردانند که همیشه با موفقیت/شکست پایان می‌یابد.</p>' +
        '<div class="grid grid--two">' +
          '<button class="btn btn--primary" id="btn-interstitial">تبلیغ تمام‌صفحه</button>' +
          '<button class="btn btn--primary" id="btn-rewarded">ویدیوی جایزه‌دار</button>' +
          '<button class="btn" id="btn-native">تبلیغ بومی</button>' +
          '<button class="btn btn--ghost" id="btn-hide-native">بستن تبلیغ بومی</button>' +
        '</div>' +
        '<div class="cap-row"><span class="cap-row__name">وضعیت SDK</span>' +
          '<span class="cap-pill" id="ads-status">—</span></div>' +
        '<pre class="log" id="ad-log">آماده…</pre>' +
      '</section>'
    );

    var adLog = card.querySelector('#ad-log');
    function adLogLine(text) {
      adLog.textContent = text + '\n' + adLog.textContent.split('\n').slice(0, 20).join('\n');
    }

    card.querySelector('#btn-interstitial').addEventListener('click', function () {
      adLogLine('showInterstitial() …');
      NativeAds.showInterstitial().then(function (res) {
        adLogLine('interstitial -> ' + JSON.stringify(res));
        toast(res.ok ? 'تبلیغ تمام‌صفحه بسته شد' : 'نمایش تبلیغ ممکن نشد: ' + (res.reason || ''));
      });
    });

    card.querySelector('#btn-rewarded').addEventListener('click', function () {
      adLogLine('showRewarded() …');
      NativeAds.showRewarded().then(function (res) {
        adLogLine('rewarded -> ' + JSON.stringify(res));
        toast(res.rewardGranted ? '🎉 جایزه دریافت شد' : 'جایزه‌ای ثبت نشد: ' + (res.reason || ''));
      });
    });

    card.querySelector('#btn-native').addEventListener('click', function () {
      adLogLine('showNative() …');
      NativeAds.showNative().then(function (res) {
        adLogLine('native -> ' + JSON.stringify(res));
        toast(res.ok ? 'تبلیغ بومی نمایش داده شد' : 'تبلیغ بومی موجود نیست');
      });
    });

    card.querySelector('#btn-hide-native').addEventListener('click', function () {
      NativeAds.hideNative();
      adLogLine('hideNative()');
    });

    var status = card.querySelector('#ads-status');
    status.textContent = NativeAds.isAvailable() ? 'READY' : 'INITIALIZING';
    status.className = 'cap-pill ' + (NativeAds.isAvailable() ? 'cap-pill--ok' : '');

    NativeAds.prepare();
    NativeAds.on('error', function (data) {
      adLogLine('ad_error: ' + JSON.stringify(data));
    });
    NativeAds.on('rewarded:granted', function () {
      adLogLine('reward granted by native layer');
    });

    return card;
  };

  routes.capabilities = function () {
    var card = el(
      '<section class="card">' +
        '<h2>گزارش قابلیت‌های مرورگر</h2>' +
        '<p class="hint">این بخش به‌صورت واقعی اجرا می‌شود تا مطمئن شویم نمایشگر وب برای برنامه‌های سنگین آماده است ' +
        '(ماژول‌های ES، وب‌اسمبلی، IndexedDB، Canvas/WebGL، رسانه و درخواست‌های شبکه روی سرور داخلی).</p>' +
        '<div id="caps"></div>' +
        '<div class="stage" style="margin-top:14px"><canvas id="demo-canvas" width="640" height="360"></canvas></div>' +
        '<pre class="log" id="log-view" style="margin-top:14px"></pre>' +
      '</section>'
    );
    return card;
  };

  routes.container = function () {
    return el(
      '<section class="card">' +
        '<h2>جزئیات کانتینر</h2>' +
        '<p class="hint">شناسه‌های تبلیغات و پوش هرگز به این لایه ارسال نمی‌شوند. فقط اطلاعات عمومی برنامه در دسترس است.</p>' +
        '<dl class="kv" id="info-list"></dl>' +
      '</section>' +
      '<section class="card">' +
        '<h2>مسیر‌یابی عمیق (Deep Link)</h2>' +
        '<p class="hint">با لمس اعلان‌های نجوا، برنامه باز و مسیر درخواستی پس از آماده‌شدن رابط کاربری به این لایه تحویل داده می‌شود.</p>' +
        '<div class="grid grid--two">' +
          '<button class="btn" id="btn-simulate-deeplink">شبیه‌سازی مسیر عمیق</button>' +
          '<button class="btn btn--ghost" id="btn-clear-log">پاک‌کردن گزارش</button>' +
        '</div>' +
        '<pre class="log" id="log-view" style="margin-top:14px"></pre>' +
      '</section>'
    );
  };

  routes.about = function () {
    return el(
      '<section class="card">' +
        '<h2>معماری</h2>' +
        '<p class="hint" style="direction:ltr;text-align:left">Android App → Local HTTP Server → WebView → assets/web/index.html</p>' +
        '<dl class="kv">' +
          '<div><dt>سرور داخلی</dt><dd>127.0.0.1</dd></div>' +
          '<div><dt>پروتکل</dt><dd>HTTP/1.1 + gzip</dd></div>' +
          '<div><dt>پوش</dt><dd>Najva (native)</dd></div>' +
          '<div><dt>تبلیغات</dt><dd>Tapsell (native)</dd></div>' +
          '<div><dt>پرداخت</dt><dd>CafeBazaar / Poolakey</dd></div>' +
        '</dl>' +
        '<p class="hint" style="margin-top:14px">برای جایگزینی این برنامه، کافی است محتویات ' +
        '<code>assets/web/</code> را با خروجی بیلد خود (Vite / Webpack / Next …) جایگزین کنید و در پایان مقداردهی، ' +
        '<code>NativeApp.appReady()</code> را فراخوانی کنید.</p>' +
      '</section>'
    );
  };

  // ------------------------------------------------- capability self-testing
  function probe(name, title, hint, test) {
    var pill = '<span class="cap-pill" data-cap="' + name + '">CHECK…</span>';
    var row = el(
      '<div class="cap-row"><span class="cap-row__name">' + title +
      '<small>' + escapeHtml(hint) + '</small></span>' + pill + '</div>'
    );
    Promise.resolve()
      .then(test)
      .then(function (value) {
        state.capabilities[name] = { ok: true, value: value };
        var p = row.querySelector('.cap-pill');
        p.textContent = 'OK' + (value ? ' · ' + String(value).slice(0, 28) : '');
        p.classList.add('cap-pill--ok');
        log(name + ': OK ' + (value == null ? '' : value));
      })
      .catch(function (error) {
        state.capabilities[name] = { ok: false, error: String(error && error.message || error) };
        var p = row.querySelector('.cap-pill');
        p.textContent = 'FAIL';
        p.classList.add('cap-pill--no');
        log(name + ': FAIL ' + (error && error.message ? error.message : error));
      });
    return row;
  }

  function runCapabilityReport() {
    var host = document.getElementById('caps');
    if (!host) return;

    host.appendChild(probe('http', 'سرور HTTP داخلی', 'fetch("/__health")', function () {
      return fetch('/__health', { cache: 'no-store' })
        .then(function (r) { return r.text().then(function (t) { return t + ' (' + r.status + ')'; }); });
    }));

    host.appendChild(probe('module', 'ماژول‌های ES', 'dynamic import()', function () {
      return import('./js/module-demo.js').then(function (mod) { return mod.describe(); });
    }));

    host.appendChild(probe('idb', 'IndexedDB', 'structured storage', function () {
      return new Promise(function (resolve, reject) {
        var request = indexedDB.open('container-probe', 1);
        request.onupgradeneeded = function () {
          request.result.createObjectStore('probe', { keyPath: 'id' });
        };
        request.onerror = function () { reject(request.error); };
        request.onsuccess = function () {
          var db = request.result;
          var tx = db.transaction('probe', 'readwrite');
          tx.objectStore('probe').put({ id: 'hello', at: Date.now(), payload: new Uint8Array([1, 2, 3, 4]) });
          tx.oncomplete = function () { db.close(); resolve('write+typed-array ok'); };
          tx.onerror = function () { reject(tx.error); };
        };
      });
    }));

    host.appendChild(probe('wasm', 'WebAssembly', 'instantiate + Math', function () {
      // Minimal valid module: (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add)
      var bytes = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
        0x03, 0x02, 0x01, 0x00,
        0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
        0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b
      ]);
      return WebAssembly.instantiate(bytes.buffer)
        .then(function (result) { return 'add(20,22)=' + result.instance.exports.add(20, 22); });
    }));

    host.appendChild(probe('webgl', 'WebGL', 'hardware acceleration', function () {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl2') || canvas.getContext('webgl') ||
        canvas.getContext('experimental-webgl');
      if (!gl) throw new Error('no WebGL context');
      var dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return (gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1') +
        (dbg ? ' · ' + gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '');
    }));

    host.appendChild(probe('canvas2d', 'Canvas 2D', 'rAF rendering', function () {
      return new Promise(function (resolve, reject) {
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no 2d context'));
        requestAnimationFrame(function () {
          ctx.fillStyle = '#10B981';
          ctx.fillRect(0, 0, 10, 10);
          var data = ctx.getImageData(0, 0, 1, 1).data;
          resolve('pixel rgba(' + Array.prototype.join.call(data, ',') + ')');
        });
      });
    }));

    host.appendChild(probe('media', 'ویدیو و صدا', '<video> element', function () {
      var video = document.createElement('video');
      var canPlay = typeof video.canPlayType === 'function' &&
        (video.canPlayType('video/mp4') || video.canPlayType('video/webm'));
      if (!canPlay) throw new Error('no supported video codec reported');
      return canPlay;
    }));

    host.appendChild(probe('storage', 'localStorage', 'persistent origin', function () {
      var key = 'container-probe';
      var value = String(Date.now());
      localStorage.setItem(key, value);
      var read = localStorage.getItem(key);
      if (read !== value) throw new Error('round-trip mismatch');
      return location.origin;
    }));

    host.appendChild(probe('sw', 'Service Worker', 'available API', function () {
      if (!('serviceWorker' in navigator)) throw new Error('unsupported');
      return 'navigator.serviceWorker present';
    }));

    host.appendChild(probe('dpr', 'نمایشگر', 'devicePixelRatio + viewport', function () {
      return window.devicePixelRatio + 'x · ' + window.innerWidth + '×' + window.innerHeight;
    }));
  }

  // ------------------------------------------------------------ canvas demo
  function mountCanvasDemo() {
    var canvas = document.getElementById('demo-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var width = canvas.clientWidth || 320;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor((width * 9 / 16) * dpr);
    ctx.scale(dpr, dpr);

    var particles = [];
    for (var i = 0; i < 42; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * (width * 9 / 16),
        r: 1 + Math.random() * 3.4,
        vx: (Math.random() - 0.5) * 0.7,
        vy: (Math.random() - 0.5) * 0.7
      });
    }

    var start = performance.now();
    function frame(now) {
      if (!document.body.contains(canvas)) return;
      var w = canvas.width / dpr;
      var h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);

      var gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, 'rgba(16,185,129,0.14)');
      gradient.addColorStop(1, 'rgba(4,120,87,0.05)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      particles.forEach(function (p) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(16,185,129,0.75)';
        ctx.fill();
      });

      ctx.fillStyle = 'rgba(6,78,59,0.9)';
      ctx.font = '600 13px Vazirmatn, system-ui';
      ctx.fillText('requestAnimationFrame · ' +
        ((now - start) / 1000).toFixed(1) + 's', 12, h - 12);

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    log('canvas demo mounted (' + canvas.width + '×' + canvas.height + ')');
  }

  // ------------------------------------------------------------ container UI
  function paintInfo() {
    var list = document.getElementById('info-list');
    if (!list) return;
    var info = state.info || {};
    var rows = [
      ['پلتفرم', info.platform || 'web'],
      ['نسخه اندروید', info.sdkInt || '—'],
      ['نسخه برنامه', info.appVersion || '—'],
      ['پورت سرور داخلی', info.serverPort || '—'],
      ['حالت اشکال‌زدایی', info.debug ? 'true' : 'false'],
      ['تبلیغات بومی', info.adsReady ? 'آماده' : 'در حال آماده‌سازی'],
      ['مجوز اعلان', info.pushEnabled ? 'صادر شده' : 'صادر نشده'],
      ['نشانی مبدأ', location.origin]
    ];
    list.innerHTML = rows.map(function (row) {
      return '<div><dt>' + escapeHtml(row[0]) + '</dt><dd>' + escapeHtml(row[1]) + '</dd></div>';
    }).join('');
  }

  function bindContainerView() {
    var simulate = document.getElementById('btn-simulate-deeplink');
    if (simulate) {
      simulate.addEventListener('click', function () {
        var route = 'capabilities';
        location.hash = '#/' + route;
        toast('مسیر عمیق اجرا شد: ' + route);
        log('simulated deep link -> ' + route);
      });
    }
    var clear = document.getElementById('btn-clear-log');
    if (clear) {
      clear.addEventListener('click', function () {
        state.logs = [];
        var view = document.getElementById('log-view');
        if (view) view.textContent = '';
      });
    }
  }

  // ------------------------------------------------------------- self test
  /**
   * Scripted probe used by the container's CI smoke test: it exercises the ad
   * bridge **without** any SDK keys configured, proving that a failing ad
   * request never blocks or crashes the WebApp.
   */
  function runAutotest() {
    var summary = {
      native: NativeApp.isNative(),
      adsAvailable: NativeAds.isAvailable(),
      health: null,
      interstitial: null
    };
    console.log('AUTOTEST begin ' + JSON.stringify(summary));

    fetch('/__health')
      .then(function (response) { return response.text(); })
      .then(function (body) { summary.health = body.trim(); })
      .catch(function (error) { summary.health = 'error: ' + error; })
      .then(function () { return NativeAds.showInterstitial(); })
      .then(function (result) { summary.interstitial = result; })
      .catch(function (error) { summary.interstitial = { ok: false, reason: String(error) }; })
      .then(function () {
        console.log('AUTOTEST done ' + JSON.stringify(summary));
      });
  }

  // ------------------------------------------------------------ deep linking
  window.DeepLink = {
    handle: function (route) {
      var target = String(route || '').replace(/^#\/?/, '').replace(/^\//, '');
      if (!target) return false;
      if (target === 'autotest') {
        location.hash = '#/container';
        runAutotest();
        return true;
      }
      if (routes[target]) {
        location.hash = '#/' + target;
      } else {
        // Unknown route: keep the WebApp's own router in charge.
        location.hash = '#/' + target;
      }
      toast('مسیر باز شد: ' + target);
      log('deep link handled -> ' + target);
      return true;
    }
  };

  NativeApp.on('deeplink', function (route) {
    window.DeepLink.handle(route);
  });

  // Hardware back: let the WebApp close overlays / pop internal history first.
  NativeApp.onBackPressed = function () {
    if (history.length > 1 && currentRoute() !== 'ads') {
      history.back();
      return true;
    }
    return false;
  };

  window.addEventListener('nativeapp:resize', function () {
    log('resize -> ' + window.innerWidth + '×' + window.innerHeight);
    if (currentRoute() === 'capabilities') mountCanvasDemo();
  });

  // ------------------------------------------------------------------- boot
  function boot() {
    state.info = NativeApp.getInfo();
    state.native = NativeApp.isNative();

    runtimeBadge.textContent = state.native ? 'NATIVE CONTAINER' : 'BROWSER';
    runtimeBadge.className = 'badge ' + (state.native ? 'badge--ok' : 'badge--warn');

    render();
    paintInfo();
    runCapabilityReport();
    bindContainerView();

    // The startup route (from a push notification tap) is consumed here.
    var route = NativeApp.getStartupRoute();
    if (route) {
      log('startup route from container -> ' + route);
      window.DeepLink.handle(route);
    }

    // Everything above runs synchronously; the app is interactive now.
    setStatus('برنامه آماده است', 'ok');
    bootSplash.hidden = true;

    // ---- readiness handshake with the native container ----
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var acknowledged = NativeApp.appReady();
        log('NativeApp.appReady() -> ' + acknowledged);
        if (!acknowledged && !state.native) {
          setStatus('حالت مرورگر: کانتینر بومی در دسترس نیست', 'warn');
        }
      });
    });
  }

  // Re-paint the container view whenever it is shown.
  var originalRender = render;
  render = function () {
    originalRender();
    if (currentRoute() === 'container') paintInfo();
    if (currentRoute() === 'container' || currentRoute() === 'about') bindContainerView();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Global error visibility: never let a JS error leave the user staring at a
  // blank screen – report it and keep the app usable.
  window.addEventListener('error', function (event) {
    log('window error: ' + (event.message || event.type));
  });
  window.addEventListener('unhandledrejection', function (event) {
    log('unhandled rejection: ' + (event.reason && event.reason.message || event.reason));
  });
})();
