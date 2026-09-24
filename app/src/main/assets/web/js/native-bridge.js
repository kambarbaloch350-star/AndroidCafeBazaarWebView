/**
 * Native container facade for چیستان‌سرا (ChistanSara)
 * ====================================================
 *
 * The container exposes exactly one JavaScript object – `window.AndroidBridge`
 * (`WebAppBridge.kt`) – and this file is its *only* intended consumer: it turns
 * the container's callback/event protocol into promises and DOM events a WebApp
 * can await, and it never invents a result the container did not produce (an ad
 * that was not shown, a purchase that was not verified, a reward that was not
 * granted).
 *
 * Calls used (all optional – every one degrades to a safe value in a browser):
 *   readiness   appReady, appLoaded, reportError
 *   environment isNativeApp, isProduction, getPackageName, getInfo,
 *               getDeviceProfile
 *   navigation  navigateBack, getStartupRoute, consumeStartupRoute,
 *               openEmail, composeEmail, openRatingPage, openStorePage
 *   save game   saveState, loadState, clearState
 *   ads         showInterstitial, showRewarded, showNative, showNativeAt,
 *               hideNative, isAdReady, isAdsAvailable, prepareAds
 *   billing     isBillingAvailable/isAvailable, connectBilling, buyProduct,
 *               buyProductWithPayload, consumePurchase, getPurchases,
 *               isRemoveAdsOwned
 *
 * Events consumed (both channels are always delivered by the container):
 *   `NativeAds.onEvent(json)` + `nativeads:event`            → ads:*
 *   `CafeBazaarBridge.onConnectionResult|onPurchaseResult|  → cafebazaar:*
 *    onConsumeResult|onPurchasesQueryResult|onOwnedProductsChanged`
 *   `NativeApp.onEvent(json)` + `nativeapp:ready`,           → app:*
 *    `nativeapp:resume|pause|memorywarning|resize|deeplink`
 *
 * Notes on the container contract (docs/WEBAPP_INTEGRATION.md):
 *   - no advertising / push / billing identifier is ever exposed here: the
 *     Tapsell key & zones and the CafeBazaar RSA key live in the native layer
 *     (`TapsellConfig.kt`, `CafeBazaarConfig.kt`);
 *   - a `show*()` request always settles (closed / skipped / error / timeout),
 *     and a settled request must release the slot so the next ad can be shown;
 *   - the hardware back button is answered through `NativeApp.onBackPressed()`
 *     (registered with `NativeApp.setBackHandler`) – the container dispatches
 *     the cancelable `nativeapp:back` event only when that returned `false`, so
 *     this facade must not run the handler a second time;
 *   - the WebApp owns its economy: the container never mints coins.
 *
 * Supports the older bridges as thin aliases: `TapsellBridge`, `PoolakeyBridge`,
 * `BazaarBridge` / `CafeBazaarBridge`, plus the چستان helpers `ChistanBridge`.
 */
(function (window) {
  'use strict';

  // ------------------------------------------------------------------ core
  var BRIDGE = 'AndroidBridge';
  var AD_TIMEOUT_MS = { interstitial: 6000, rewarded: 18000, native: 6000 };

  function warn() { try { if (window.console && window.console.warn) window.console.warn.apply(window.console, arguments); } catch (_) {} }
  function bridge() { return window[BRIDGE] || null; }
  function method(name) {
    var b = bridge();
    return b && typeof b[name] === 'function' ? b[name] : null;
  }
  /** Calls a container method; returns `fallback` when it is unavailable/failed. */
  function call(name, fallback) {
    var fn = method(name);
    if (!fn) return fallback;
    try { return fn.apply(bridge(), Array.prototype.slice.call(arguments, 2)); }
    catch (e) { warn('[NativeBridge] ' + name + '() failed', e); return fallback; }
  }
  /** Calls a void-returning container method; `true` when it accepted the request. */
  function accept(name) {
    var fn = method(name);
    if (!fn) return false;
    try { fn.apply(bridge(), Array.prototype.slice.call(arguments, 1)); return true; }
    catch (e) { warn('[NativeBridge] ' + name + '() failed', e); return false; }
  }
  /** Calls a boolean-returning container method. */
  function flag(name, fallback, arg1, arg2) {
    return call(name, fallback === undefined ? false : fallback, arg1, arg2) === true;
  }
  function parse(value) {
    try {
      var data = typeof value === 'string' ? JSON.parse(value) : value;
      return data && typeof data === 'object' ? data : {};
    } catch (_) { return {}; }
  }
  function fail(reason) {
    return { ok: false, success: false, rewardGranted: false, reason: reason, errorCode: reason };
  }
  function emit(name, data) {
    (listeners[name] || []).slice().forEach(function (fn) {
      try { fn(data); } catch (e) { (window.console && console.error) && console.error(e); }
    });
  }
  function on(name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
    return function () {
      listeners[name] = listeners[name].filter(function (item) { return item !== fn; });
    };
  }
  function event(name, data) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: data })); } catch (_) {}
  }
  /**
   * The container delivers the same event through two channels (`X.onEvent(json)`
   * *and* a DOM event, in the same tick); a facade listener must fire once.
   */
  function emitOnce(name, data) {
    var key = name + '|' + JSON.stringify(data === undefined ? null : data);
    if (lastEmit[name] === key) return;
    lastEmit[name] = key;
    setTimeout(function () { if (lastEmit[name] === key) lastEmit[name] = null; }, 0);
    emit(name, data);
  }

  var listeners = Object.create(null);
  var lastEmit = Object.create(null);

  // ------------------------------------------------------------------ audio
  // Keep every Web Audio context under lifecycle control. WebView.onPause()
  // does not reliably suspend a page-created AudioContext on all Android
  // WebView versions, so background music must be stopped explicitly.
  var nativeAudioContexts = [];
  function trackAudioContext(Ctor) {
    if (!Ctor || Ctor.__nativeTracked) return;
    var Original = Ctor;
    function TrackedAudioContext() {
      var ctx = Reflect.construct(Original, Array.prototype.slice.call(arguments), TrackedAudioContext);
      nativeAudioContexts.push(ctx);
      return ctx;
    }
    TrackedAudioContext.prototype = Original.prototype;
    TrackedAudioContext.__nativeTracked = true;
    try { window[Original.name || 'AudioContext'] = TrackedAudioContext; } catch (_) {}
  }
  trackAudioContext(window.AudioContext);
  trackAudioContext(window.webkitAudioContext);
  function pauseWebAudio() {
    nativeAudioContexts.forEach(function (ctx) { try { ctx.suspend(); } catch (_) {} });
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {}
    try { document.querySelectorAll('audio,video').forEach(function (media) { media.pause(); }); } catch (_) {}
  }
  function resumeWebAudio() {
    nativeAudioContexts.forEach(function (ctx) { try { ctx.resume(); } catch (_) {} });
  }

  // --------------------------------------------------------------- pending
  // One request per kind: the container serialises ads and purchases, so a
  // second request while one is pending is answered BUSY instead of queueing a
  // promise that can never settle. Every timer releases the slot it owns.
  var adPending = null, purchasePending = null, queryPending = null, connectPending = null;
  var consumePending = Object.create(null);
  var ready = false, backHandler = null, removeAdsOwned = false, billingConnected = false;
  var lastAdEnvelope = null;
  var lastCompletedCount = 0;
  var interstitialEvery = 3; // show an interstitial every 3 completed levels
  var SAVE_KEY = 'chistansara_game_save_v2';
  var SAVE_KEY_ALT = 'labzband_progress_v4'; // legacy support

  /**
   * Promise + timeout. [onTimeout] releases the slot the request occupies, so a
   * container that never answers (no ad fill, SDK stall) cannot wedge the
   * bridge: without it one timed-out interstitial answered BUSY to every later
   * ad request for the rest of the session.
   */
  function request(timeout, onTimeout) {
    var entry = { done: false };
    entry.promise = new Promise(function (resolve) {
      entry.finish = function (result) {
        if (entry.done) return;
        entry.done = true;
        clearTimeout(entry.timer);
        resolve(result);
      };
      entry.timer = setTimeout(function () {
        if (typeof onTimeout === 'function') { try { onTimeout(entry); } catch (_) {} }
        entry.finish(fail('TIMEOUT'));
      }, timeout);
    });
    return entry;
  }

  /** Requests a full-screen ad and settles when the container reports the end. */
  function show(kind, name, args) {
    if (adPending) return Promise.resolve(fail('BUSY'));
    var entry = request(AD_TIMEOUT_MS[kind] || 6000, function () {
      if (adPending === entry) adPending = null;
    });
    entry.kind = kind;
    entry.reward = false;
    adPending = entry;
    var accepted = accept.apply(null, [name].concat(args || []));
    if (!accepted) {
      adPending = null;
      entry.finish(fail('NOT_AVAILABLE'));
    }
    return entry.promise;
  }

  function adEvent(value) {
    var e = parse(value), data = parse(e.data), type = e.type, entry = adPending;
    var key = type + '|' + JSON.stringify(data);
    if (key === lastAdEnvelope) return;
    lastAdEnvelope = key;
    setTimeout(function () { if (lastAdEnvelope === key) lastAdEnvelope = null; }, 0);

    if (entry) {
      if (entry.kind === 'rewarded' && (type === 'reward_granted' || type === 'rewarded_completed')) entry.reward = true;
      var closed = type === entry.kind + '_closed' || (entry.kind === 'native' && type === 'native_shown');
      var skipped = type === entry.kind + '_skipped';
      var error = type === 'ad_error' && (!data.adType || data.adType === entry.kind || data.adType === 'sdk');
      if (closed || skipped || error) {
        adPending = null;
        var granted = !error && (entry.reward || data.rewardGranted === true);
        entry.finish(error ? fail(data.error || 'AD_ERROR') : {
          ok: entry.kind !== 'rewarded' || granted,
          type: entry.kind,
          rewardGranted: entry.kind === 'rewarded' && granted,
          success: !error,
          verified: !error,
          reason: skipped ? 'SKIPPED' : (entry.kind === 'rewarded' && !granted ? 'NOT_REWARDED' : undefined),
          data: data
        });
      }
    }
    emit('ads:' + type, data);
    emit('ads:event', e);
  }

  // -------------------------------------------------------------- container
  // Lifecycle events arrive as `nativeapp:*` DOM events from MainActivity and
  // are re-emitted under the documented `NativeApp.on(...)` names (`pause`,
  // `resume`, `memorywarning`, `resize`, `deeplink`, `ready`).
  var LIFECYCLE = {
    'nativeapp:pause': 'pause',
    'nativeapp:resume': 'resume',
    'nativeapp:memorywarning': 'memorywarning',
    'nativeapp:resize': 'resize'
  };
  Object.keys(LIFECYCLE).forEach(function (domName) {
    window.addEventListener(domName, function (e) {
      var data = (e && e.detail) || {};
      if (domName === 'nativeapp:pause') pauseWebAudio();
      if (domName === 'nativeapp:resume') resumeWebAudio();
      emitOnce('app:' + LIFECYCLE[domName], data);
    });
  });
  // `nativeapp:ready` / `container:ready` carry `{ route, pushSupported }`.
  ['nativeapp:ready', 'container:ready'].forEach(function (domName) {
    window.addEventListener(domName, function (e) {
      ready = true;
      emitOnce('app:ready', (e && e.detail) || {});
    });
  });
  // Deep links: the container also calls NativeApp.onEvent({type:'deep_link'}),
  // so `emitOnce` keeps a listener from firing twice for one link.
  window.addEventListener('nativeapp:deeplink', function (e) {
    var detail = (e && e.detail) || {};
    var route = detail.route !== undefined ? detail.route : '';
    emitOnce('app:deeplink', { route: route });
    emitOnce('app:deep_link', { route: route });
  });
  window.addEventListener('nativeads:event', function (e) { adEvent(e.detail); });

  // ---------------------------------------------------------------- NativeApp
  window.NativeApp = {
    isNative: function () { return !!bridge(); },
    isNativeApp: function () { return flag('isNativeApp', !!bridge()); },
    isProduction: function () { return flag('isProduction', false); },
    getPackageName: function () { return call('getPackageName', ''); },
    appReady: function () {
      if (!ready) {
        ready = call('appReady', false) === true;
        if (ready) emitOnce('app:ready', {});
      }
      return ready;
    },
    appLoaded: function () { return window.NativeApp.appReady(); },
    getInfo: function () { return parse(call('getInfo', '{}')); },
    getDeviceProfile: function () {
      var profile = parse(call('getDeviceProfile', '{}'));
      if (!Object.keys(profile).length) {
        var info = window.NativeApp.getInfo();
        if (info && info.device) profile = info.device;
      }
      return profile;
    },
    /**
     * DPR a heavy Canvas/WebGL game should render at: the container's advice for
     * the device tier, never above the real device pixel ratio.
     */
    getRenderPixelRatio: function () {
      var real = window.devicePixelRatio || 1;
      var suggested = window.NativeApp.getDeviceProfile().suggestedPixelRatio;
      if (typeof suggested !== 'number' || !(suggested > 0)) return real;
      return Math.min(suggested, real);
    },
    getStartupRoute: function () {
      var route = call('getStartupRoute', '');
      call('consumeStartupRoute', null);
      return route || '';
    },
    reportError: function (message) { call('reportError', null, String(message)); },
    navigateBack: function () { return flag('navigateBack', false); },
    /** Hardware back: registered once, answered by the container before its own chain. */
    setBackHandler: function (fn) { backHandler = typeof fn === 'function' ? fn : null; },
    onBackPressed: function () {
      try { return !!backHandler && backHandler() === true; } catch (e) {
        warn('[NativeApp] back handler failed', e);
        return false;
      }
    },
    openEmail: function (address, subject) {
      if (subject === undefined || subject === null || subject === '') return flag('openEmail', false, String(address));
      return flag('composeEmail', false, String(address), String(subject));
    },
    composeEmail: function (address, subject) { return flag('composeEmail', false, String(address), String(subject)); },
    openStorePage: function () { return flag('openStorePage', false); },
    openRatingPage: function () { return flag('openRatingPage', false); },
    isRemoveAdsOwned: function () { return window.CafeBazaar.isRemoveAdsOwned(); },
    saveState: function (key, value, savedAt) {
      if (key === undefined || key === null) return false;
      return flag('saveState', false, String(key), String(value), String(savedAt == null ? Date.now() : savedAt));
    },
    loadState: function (key) {
      var raw = call('loadState', null, String(key));
      if (!raw || typeof raw !== 'string') return null;
      try {
        var o = JSON.parse(raw);
        return o && typeof o === 'object' && typeof o.value === 'string' ? o : null;
      } catch (_) { return null; }
    },
    clearState: function (key) { return flag('clearState', false, String(key)); },
    on: function (name, fn) { return on('app:' + name, fn); },
    /**
     * Container → WebApp event envelope. `{type:'deep_link',data:{route}}` is a
     * push/deep-link route, a payload without a type is the container-ready
     * announcement.
     */
    onEvent: function (value) {
      var e = parse(value);
      var type = e.type || (e.route !== undefined || e.pushSupported !== undefined ? 'ready' : 'event');
      if (type === 'deep_link' || type === 'deeplink') {
        var route = (e.data && e.data.route !== undefined) ? e.data.route : (e.route || '');
        emitOnce('app:deeplink', { route: route });
        emitOnce('app:deep_link', { route: route });
        emitOnce('app:event', e);
        return;
      }
      if (type === 'ready') {
        ready = true;
        emitOnce('app:ready', e.data || e);
      }
      emitOnce('app:' + type, e.data || e);
      emitOnce('app:event', e);
    }
  };

  // --------------------------------------------------------------- NativeAds
  window.NativeAds = {
    showInterstitial: function () { return show('interstitial', 'showInterstitial'); },
    /**
     * Rewarded video. Resolves `{ ok, rewardGranted, reason }`; the container
     * grants the reward (`rewarded_completed`) and the WebApp decides what it is
     * worth. Only a `rewardGranted === true` result may credit the player.
     */
    showRewarded: function () { return show('rewarded', 'showRewarded'); },
    showNative: function () { return show('native', 'showNative'); },
    showNativeAt: function (x, y, w, h) {
      return show('native', 'showNativeAt', [x | 0, y | 0, w | 0, h | 0]);
    },
    hideNative: function () { return accept('hideNative'); },
    isReady: function (type) { return flag('isAdReady', false, type); },
    isAvailable: function () { return flag('isAdsAvailable', false); },
    prepare: function () { return accept('prepareAds'); },
    on: function (name, fn) { return on('ads:' + name, fn); },
    onEvent: adEvent
  };

  // -------------------------------------------------------------- CafeBazaar
  window.CafeBazaar = {
    isNativeBridgeAvailable: window.NativeApp.isNative,
    isAvailable: function () {
      if (method('isBillingAvailable') || method('isAvailable')) {
        return flag('isBillingAvailable', flag('isAvailable', billingConnected));
      }
      return billingConnected;
    },
    isRemoveAdsOwned: function () { return removeAdsOwned || flag('isRemoveAdsOwned', false); },
    /**
     * Starts the billing connection. The container answers through
     * `CafeBazaarBridge.onConnectionResult` → `cafebazaar:connection`; the
     * return value is "the request was accepted" (the container's own call
     * returns nothing), which is what callers use to fall back to a toast.
     */
    connect: function () { return accept('connectBilling'); },
    /** Resolves with the connection result (`{ success, message }`). */
    connectAsync: function (timeout) {
      var entry = request(timeout || 10000, function () { if (connectPending === entry) connectPending = null; });
      if (!connectPending) {
        connectPending = entry;
        if (!accept('connectBilling')) {
          connectPending = null;
          entry.finish({ success: false, message: 'BILLING_UNAVAILABLE', errorCode: 'NOT_AVAILABLE' });
        }
      }
      return entry.promise;
    },
    getInfo: window.NativeApp.getInfo,
    openRatingPage: function () { return flag('openRatingPage', false); },
    openStorePage: function () { return flag('openStorePage', false); },
    purchase: function (productId, payload) {
      if (!productId) return Promise.resolve({ success: false, verified: false, errorCode: 'INVALID_PRODUCT' });
      if (purchasePending) {
        return Promise.resolve({ success: false, verified: false, productId: productId, errorCode: 'BUSY' });
      }
      var entry = request(300000, function () { if (purchasePending === entry) purchasePending = null; });
      entry.productId = productId;
      purchasePending = entry;
      var accepted = (payload === undefined || payload === null)
        ? accept('buyProduct', productId)
        : accept('buyProductWithPayload', productId, String(payload));
      if (!accepted) {
        purchasePending = null;
        entry.finish({ success: false, verified: false, productId: productId, errorCode: 'NOT_AVAILABLE' });
      }
      return entry.promise;
    },
    consume: function (token) {
      if (!token) return Promise.resolve({ success: false, errorCode: 'INVALID_TOKEN' });
      if (consumePending[token]) return consumePending[token].promise;
      var entry = request(30000, function () { if (consumePending[token] === entry) delete consumePending[token]; });
      consumePending[token] = entry;
      if (!accept('consumePurchase', token)) {
        delete consumePending[token];
        entry.finish({ success: false, purchaseToken: token, errorCode: 'NOT_AVAILABLE' });
      }
      return entry.promise;
    },
    getPurchases: function () {
      if (queryPending) return queryPending.promise;
      var entry = request(30000, function () { if (queryPending === entry) queryPending = null; });
      queryPending = entry;
      if (!accept('getPurchases')) {
        queryPending = null;
        entry.finish({ success: false, errorCode: 'NOT_AVAILABLE', purchases: [] });
      }
      return entry.promise;
    }
  };
  window.CafeBazaar.buyProduct = window.CafeBazaar.purchase.bind(window.CafeBazaar);
  window.CafeBazaar.buyProductWithPayload = window.CafeBazaar.buyProduct;
  window.CafeBazaar.consumePurchase = window.CafeBazaar.consume;
  window.CafeBazaar.rateApp = window.CafeBazaar.openRatingPage;
  window.CafeBazaar.getStoreInfo = window.CafeBazaar.getInfo;
  window.BazaarBridge = window.CafeBazaar;
  window.CafeBazaarBridge = {
    onConnectionResult: function (value) {
      var data = parse(value);
      billingConnected = data.success === true;
      if (connectPending) { var entry = connectPending; connectPending = null; entry.finish(data); }
      event('cafebazaar:connection', data);
    },
    onPurchaseResult: function (value) {
      var data = parse(value);
      if (data.productId === 'remove_ads' && data.success === true && data.verified === true) removeAdsOwned = true;
      if (purchasePending && (!data.productId || data.productId === purchasePending.productId)) {
        var entry = purchasePending;
        purchasePending = null;
        entry.finish(data);
      }
      event('cafebazaar:purchase', data);
    },
    onConsumeResult: function (value) {
      var data = parse(value), entry = consumePending[data.purchaseToken];
      if (entry) { delete consumePending[data.purchaseToken]; entry.finish(data); }
      event('cafebazaar:consume', data);
    },
    onPurchasesQueryResult: function (value) {
      var data = parse(value);
      try {
        (data.purchases || []).forEach(function (p) {
          if (p && p.productId === 'remove_ads' && p.success === true && p.verified === true) removeAdsOwned = true;
        });
      } catch (_) {}
      if (queryPending) { var entry = queryPending; queryPending = null; entry.finish(data); }
      event('cafebazaar:purchases', data);
    },
    onOwnedProductsChanged: function (value) {
      var data = parse(value);
      if (data.removeAdsOwned === true) removeAdsOwned = true;
      event('cafebazaar:ownedproducts', data);
      emitOnce('app:ownedproducts', data);
    }
  };

  // ------------------------------------------------------- legacy compat API
  // Identifiers stay native: `TapsellConfig.kt` holds the Tapsell app key and
  // zone ids, `CafeBazaarConfig.kt` the CafeBazaar RSA public key. The objects
  // below only keep the shape older WebApps read so they can fall back to the
  // bridge instead of hard-coding anything.
  window.BAZAAR_RSA_KEY = '';
  window.TAPSELL_CONFIG = {
    appKey: '',
    zones: { banner: '', interstitial: '', native: '', rewarded: '' },
    managedBy: 'native'
  };

  window.TapsellBridge = {
    init: function () { return window.NativeAds.prepare(); },
    showBanner: function () { return window.NativeAds.showNative(); },   // rendered by the native plate
    hideBanner: function () { return window.NativeAds.hideNative(); },
    requestInterstitial: function () { return window.NativeAds.isReady('interstitial'); },
    showInterstitial: function () { return window.NativeAds.showInterstitial(); },
    requestRewarded: function () { return window.NativeAds.isReady('rewarded'); },
    showRewarded: function () { return window.NativeAds.showRewarded(); },
    showNativeAt: function (zoneId, x, y, w, h) { return window.NativeAds.showNativeAt(x, y, w, h); },
    moveNative: function (x, y, w, h) { return window.NativeAds.showNativeAt(x, y, w, h); },
    hideNative: function () { return window.NativeAds.hideNative(); }
  };

  window.PoolakeyBridge = {
    connect: function () { return window.CafeBazaar.connectAsync(); },
    disconnect: function () { return true; },
    purchase: function (productId, payload) {
      return window.CafeBazaar.purchase(productId, payload).then(function (res) {
        if (res && res.success === true && res.verified === true) {
          return {
            status: 'success',
            purchase: {
              orderId: res.orderId || res.purchaseToken || ('order-' + Date.now()),
              productId: res.productId,
              purchaseToken: res.purchaseToken,
              payload: res.payload || payload || '',
              purchaseTime: res.purchaseTime || Date.now()
            }
          };
        }
        if (res && (res.errorCode === 'USER_CANCELED' || res.errorCode === 'CANCELLED')) return { status: 'canceled' };
        return { status: 'failed', message: (res && res.errorCode) || 'FAILED' };
      });
    },
    consume: function (token) {
      return window.CafeBazaar.consume(token).then(function (res) { return !!res && res.success !== false; });
    },
    getPurchasedProducts: function () {
      return window.CafeBazaar.getPurchases().then(function (res) {
        var list = [];
        try {
          if (res && Array.isArray(res.purchases)) {
            list = res.purchases.map(function (p) {
              return {
                orderId: p.orderId || p.purchaseToken || '',
                productId: p.productId,
                purchaseToken: p.purchaseToken,
                payload: p.payload || '',
                purchaseTime: p.purchaseTime || Date.now()
              };
            });
          }
        } catch (_) {}
        return list;
      });
    },
    getSkuDetails: function () { return Promise.resolve([]); }
  };

  // ------------------------------------------------------- چستان helpers
  function saveKeyFor(key) { return key === SAVE_KEY || key === SAVE_KEY_ALT; }

  function getCompletedCount() {
    try {
      var data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (data && data.completedLevels && typeof data.completedLevels === 'object') {
        return Object.keys(data.completedLevels).length;
      }
    } catch (_) {}
    return 0;
  }

  function removeAdsOwnedLocally() {
    try { if (localStorage.getItem('chistan_remove_ads') === '1') return true; } catch (_) {}
    return window.CafeBazaar.isRemoveAdsOwned();
  }

  function shouldShowAd(newCount) {
    if (newCount <= 0) return false;
    if (newCount % interstitialEvery !== 0) return false;
    if (newCount === lastCompletedCount) return false;
    // Never trust the WebApp's own flag alone: the container knows whether the
    // remove_ads product is really owned.
    return !removeAdsOwnedLocally();
  }

  /**
   * Interstitial every [interstitialEvery] completed levels, driven by the save
   * mirror: the WebApp's own level-complete handler may already have requested
   * one, and the container answers BUSY for a second request, so this stays a
   * single call per level count.
   */
  function tryShowInterstitial() {
    var count = getCompletedCount();
    if (shouldShowAd(count)) {
      lastCompletedCount = count;
      setTimeout(function () {
        window.NativeAds.showInterstitial().catch(function () {});
      }, 800);
    } else {
      lastCompletedCount = count;
    }
  }

  window.ChistanBridge = {
    getEconomy: function () {
      return {
        coinsPerLevel: 30,
        hintCosts: { letter: 60, eliminate: 100, clue: 150, answer: 150 },
        dailyRewards: [50, 75, 100, 125, 150, 200, 350],
        packs: [
          { id: 'pack_starter', sku: 'pack_starter', coins: 200, toman: 10000, priceDisplay: '۱۰,۰۰۰ تومان' },
          { id: 'chistan_pack_500', sku: 'chistan_pack_500', coins: 500, toman: 25000, priceDisplay: '۲۵,۰۰۰ تومان' },
          { id: 'pack_popular', sku: 'pack_popular', coins: 1000, toman: 50000, priceDisplay: '۵۰,۰۰۰ تومان' },
          { id: 'chistan_pack_1500', sku: 'chistan_pack_1500', coins: 1500, toman: 75000, priceDisplay: '۷۵,۰۰۰ تومان' },
          { id: 'pack_super', sku: 'pack_super', coins: 2500, toman: 125000, priceDisplay: '۱۲۵,۰۰۰ تومان' },
          { id: 'chistan_pack_4000', sku: 'chistan_pack_4000', coins: 4000, toman: 200000, priceDisplay: '۲۰۰,۰۰۰ تومان' },
          { id: 'pack_royal', sku: 'pack_royal', coins: 5000, toman: 250000, priceDisplay: '۲۵۰,۰۰۰ تومان' },
          { id: 'pack_vault', sku: 'pack_vault', coins: 10000, toman: 500000, priceDisplay: '۵۰۰,۰۰۰ تومان' },
          { id: 'remove_ads', sku: 'remove_ads', coins: 0, toman: 20000, priceDisplay: '۲۰,۰۰۰ تومان' }
        ],
        removeAds: { sku: 'remove_ads', toman: 20000, priceDisplay: '۲۰,۰۰۰ تومان' },
        interstitialEvery: interstitialEvery
      };
    },
    isRemoveAdsOwned: function () { return window.CafeBazaar.isRemoveAdsOwned(); },
    showInterstitialIfNeeded: tryShowInterstitial,
    purchaseCoins: function (sku, coins) {
      return window.CafeBazaar.purchase(sku).then(function (res) {
        if (res && res.success === true && res.verified === true) {
          if (res.purchaseToken) window.CafeBazaar.consume(res.purchaseToken).catch(function () {});
          return { success: true, coins: coins };
        }
        return { success: false, error: (res && res.errorCode) || 'FAILED' };
      });
    },
    purchaseRemoveAds: function () {
      return window.CafeBazaar.purchase('remove_ads').then(function (res) {
        if (res && res.success === true && res.verified === true) {
          removeAdsOwned = true;
          return { success: true };
        }
        return { success: false, error: (res && res.errorCode) || 'FAILED' };
      });
    },
    /**
     * Acknowledges a reward the WebApp has already credited in its own state
     * (`docs/GAME_PATCHES.md`). The container never mints coins: crediting them
     * here as well would double every rewarded bonus, and coin packs stay the
     * only purchasable currency.
     */
    addCoins: function (coins) { return Number(coins) > 0; }
  };

  // -------------------------------------------------- save mirror (force stop)
  // `localStorage` alone is not safe inside a WebView: Chromium commits it
  // lazily and the origin is only stable because the container binds a fixed
  // loopback port. Mirror every save natively (SharedPreferences) and restore
  // the newer copy at boot.
  (function () {
    var originalSetItem = null;
    try { originalSetItem = window.Storage ? window.Storage.prototype.setItem : localStorage.setItem; } catch (_) {}
    if (typeof originalSetItem !== 'function') { try { originalSetItem = localStorage.setItem; } catch (_) {} }

    function stampKey(key) { return key + ':savedAt'; }

    var hookedSetItem = function (key, value) {
      var result;
      try { result = originalSetItem.apply(this, arguments); }
      catch (_) { try { Storage.prototype.setItem.apply(this, arguments); } catch (__) { return; } }
      if (saveKeyFor(key)) {
        var at = Date.now();
        try { originalSetItem.call(this, stampKey(key), String(at)); } catch (_) {}
        window.NativeApp.saveState(key, String(value), at); // native mirror, written at once
        try { tryShowInterstitial(); } catch (_) {}
      }
      return result;
    };

    try { Object.defineProperty(localStorage, 'setItem', { value: hookedSetItem, writable: true, configurable: true }); }
    catch (_) { try { localStorage.setItem = hookedSetItem; } catch (__) {} }
    try {
      if (window.Storage && window.Storage.prototype && window.Storage.prototype.setItem !== hookedSetItem) {
        Object.defineProperty(window.Storage.prototype, 'setItem', { value: hookedSetItem, writable: true, configurable: true });
      }
    } catch (_) {}

    // Boot: the newer *valid* copy of the save wins (native mirror vs. web).
    [SAVE_KEY, SAVE_KEY_ALT].forEach(function (key) {
      var mirror = window.NativeApp.loadState(key);
      if (!mirror || !mirror.value) return;
      var webRaw = null, webAt = 0;
      try {
        webRaw = localStorage.getItem(key);
        webAt = Number(localStorage.getItem(stampKey(key))) || 0;
      } catch (_) {}
      if (!webRaw) {
        try { originalSetItem.call(localStorage, key, mirror.value); originalSetItem.call(localStorage, stampKey(key), String(mirror.savedAt || 0)); } catch (_) {}
        return;
      }
      var usable = false;
      try { usable = !!JSON.parse(webRaw); } catch (_) {}
      if (!usable || Number(mirror.savedAt || 0) > webAt) {
        try { originalSetItem.call(localStorage, key, mirror.value); originalSetItem.call(localStorage, stampKey(key), String(mirror.savedAt || 0)); } catch (_) {}
      }
    });
    lastCompletedCount = getCompletedCount();
  })();

  // ------------------------------------------------------------- boot hooks
  var booted = false;
  function autoReady() {
    if (booted) return;
    booted = true;
    window.NativeApp.appReady();
    window.NativeAds.prepare();
    window.CafeBazaar.connect();
    window.CafeBazaar.getPurchases().catch(function () {});
  }
  // Safety net only: the WebApp performs the real handshake once it finished
  // booting. These fire well after a normal boot and still before the
  // container's own 6 s watchdog, so a WebApp that never calls appReady() does
  // not leave the loading plate on screen.
  function scheduleAutoReady() { setTimeout(autoReady, 3000); }
  if (document.readyState === 'complete' || document.readyState === 'interactive') scheduleAutoReady();
  else window.addEventListener('DOMContentLoaded', scheduleAutoReady);
  window.addEventListener('load', scheduleAutoReady);
})(window);
