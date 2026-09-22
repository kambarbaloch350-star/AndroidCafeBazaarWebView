/**
 * native-bridge.js
 * =================
 *
 * Thin, dependency-free JavaScript facade over the native container.
 *
 * The WebApp only ever talks to logical APIs – it never sees a Tapsell app key,
 * an ad-zone id, a Najva website id or a push token. Everything is native:
 *
 *   Android App -> Local HTTP Server -> WebView -> assets/web/index.html
 *
 * Public API
 * ----------
 *   NativeApp.appReady()                  tell the container the WebApp is ready
 *   NativeApp.setBackHandler(fn)          handle the phone's back button
 *   NativeApp.isNative()                  true inside the container
 *   NativeApp.getInfo()                   container metadata (JsonObject)
 *   NativeApp.getStartupRoute()           deep-link route that opened the app
 *   NativeApp.onBackPressed               optional hook for hardware back
 *   NativeApp.onEvent(event)              override to receive container events
 *   NativeApp.on(eventName, handler)      subscribe to container events
 *
 *   NativeAds.showInterstitial()          -> Promise<AdResult>
 *   NativeAds.showRewarded()              -> Promise<AdResult>
 *   NativeAds.showNative()                -> Promise<AdResult>
 *   NativeAds.hideNative()
 *   NativeAds.isReady(type)               boolean
 *   NativeAds.prepare()
 *   NativeAds.on(eventName, handler)      ad lifecycle events
 *
 *   CafeBazaar.isAvailable() / purchase() / consume()
 *
 * Reliability rules enforced here:
 *   - every promise ALWAYS settles (timeout fallback), so a missing native
 *     callback can never leave the WebApp awaiting forever;
 *   - every failure is reported as a resolved `{ ok: false, reason }` result
 *     instead of an unhandled rejection, so ads can never break the WebApp.
 */
(function (window, document) {
  'use strict';

  var TIMEOUT_MS = 20000;

  function bridge() {
    return (typeof window.AndroidBridge !== 'undefined' && window.AndroidBridge) || null;
  }

  function native() {
    return bridge() !== null;
  }

  /** Safe call: never throws, always returns a value (or the fallback). */
  function call(method, fallback) {
    var args = Array.prototype.slice.call(arguments, 2);
    var b = bridge();
    if (!b || typeof b[method] !== 'function') return fallback;
    try {
      var result = b[method].apply(b, args);
      return result === undefined ? fallback : result;
    } catch (e) {
      if (window.console && console.warn) {
        console.warn('[NativeBridge] ' + method + ' failed', e);
      }
      return fallback;
    }
  }

  function parse(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(value);
    } catch (e) {
      return fallback;
    }
  }

  // ---------------------------------------------------------------------
  // Tiny event emitter
  // ---------------------------------------------------------------------
  function createEmitter() {
    var listeners = {};
    return {
      on: function (name, handler) {
        if (typeof handler !== 'function') return function () {};
        (listeners[name] = listeners[name] || []).push(handler);
        return function () { this.off(name, handler); }.bind(this);
      },
      off: function (name, handler) {
        var list = listeners[name];
        if (!list) return;
        var index = list.indexOf(handler);
        if (index >= 0) list.splice(index, 1);
      },
      emit: function (name, payload) {
        (listeners[name] || []).slice().forEach(function (handler) {
          try {
            handler(payload);
          } catch (e) {
            if (window.console && console.warn) {
              console.warn('[NativeBridge] listener for "' + name + '" threw', e);
            }
          }
        });
        (listeners['*'] || []).slice().forEach(function (handler) {
          try { handler({ type: name, payload: payload }); } catch (e) {}
        });
      }
    };
  }

  var appEmitter = createEmitter();
  var adEmitter = createEmitter();

  // ---------------------------------------------------------------------
  // Pending promise bookkeeping
  // ---------------------------------------------------------------------
  var pending = {
    interstitial: null,
    rewarded: null,
    native: null
  };

  function settle(kind, result) {
    var entry = pending[kind];
    if (!entry) return;
    pending[kind] = null;
    clearTimeout(entry.timer);
    entry.resolve(result);
  }

  function begin(kind) {
    // Any previous request for the same ad type settles immediately, so
    // promises can never pile up or leak.
    settle(kind, { ok: false, reason: 'SUPERSEDED' });
    var entry = {};
    var promise = new Promise(function (resolve) {
      entry.resolve = resolve;
      entry.timer = setTimeout(function () {
        if (pending[kind] === entry) {
          pending[kind] = null;
          resolve({ ok: false, reason: 'TIMEOUT' });
        }
      }, TIMEOUT_MS);
    });
    pending[kind] = entry;
    return promise;
  }

  // ---------------------------------------------------------------------
  // NativeApp
  // ---------------------------------------------------------------------
  var appReadySent = false;
  var backHandler = null;

  var NativeApp = {
    /** True when running inside the Android container. */
    isNative: function () { return native(); },

    /**
     * Announces that the WebApp finished initializing. The native loading
     * screen stays visible until this is called – call it after your framework
     * mounted and your first screen rendered.
     *
     * @returns {boolean} true when the container acknowledged readiness.
     */
    appReady: function () {
      if (appReadySent) return true;
      appReadySent = true;
      var acknowledged = call('appReady', false);
      appEmitter.emit('ready', { native: acknowledged });
      return !!acknowledged;
    },

    /** Container metadata: { platform, appVersion, serverPort, pushEnabled, ... } */
    getInfo: function () { return parse(call('getInfo', '{}'), {}); },

    /** Deep-link route that opened the app (e.g. "game/42"), or ''. */
    getStartupRoute: function () {
      var b = bridge();
      if (b && typeof b.consumeStartupRoute === 'function') {
        var route = call('getStartupRoute', '');
        call('consumeStartupRoute', undefined);
        return route || '';
      }
      return '';
    },

    /** Reports a fatal boot error so the container can show its retry state. */
    reportError: function (message) { call('reportError', undefined, String(message || '')); },

    /** Asks the container to navigate back. */
    navigateBack: function () { return !!call('navigateBack', false); },

    /**
     * Registers the handler the container calls when the phone's back button is
     * pressed. Return `true` when the WebApp navigated one page back (or closed
     * a modal) – the container then stays in the app. Return `false` (or do not
     * register a handler at all) and the container shows its exit dialog.
     *
     * @param {function(): boolean} handler
     * @returns {boolean} true when the handler was accepted.
     *
     * @example
     *   NativeApp.setBackHandler(function () {
     *     if (closeAnyOpenModal()) return true;   // modal closed
     *     if (state.screen === 'level') { state.goto('chapters'); return true; }
     *     return false;                           // nothing left -> exit dialog
     *   });
     */
    setBackHandler: function (handler) {
      backHandler = typeof handler === 'function' ? handler : null;
      return backHandler !== null;
    },

    /**
     * Entry point used by the container. Calls the registered back handler; a
     * WebApp may also override this function directly.
     *
     * The container dispatches a cancelable `nativeapp:back` DOM event when this
     * returns false, so `document.addEventListener('nativeapp:back', e => {
     * e.preventDefault(); … })` works as well.
     *
     * @returns {boolean} true when the back press was handled inside the page.
     */
    onBackPressed: function () {
      if (!backHandler) return false;
      try {
        return backHandler() === true;
      } catch (e) {
        if (window.console && console.warn) console.warn('[NativeApp] back handler failed', e);
        return false;
      }
    },

    /** Show/hide the native ad plate. */
    showNativeAd: function () { return !!call('showNative', false); },
    hideNativeAd: function () { return !!call('hideNative', false); },

    on: function (name, handler) { return appEmitter.on(name, handler); },
    off: function (name, handler) { return appEmitter.off(name, handler); },

    /**
     * Native -> JS event sink. Called by the container.
     * @param {Object|string} event { type, data }
     */
    onEvent: function (event) {
      var payload = parse(event, {});
      var type = payload.type || 'event';

      if (type === 'deep_link') {
        var route = (payload.data && payload.data.route) || '';
        appEmitter.emit('deeplink', route);
        if (window.DeepLink && typeof window.DeepLink.handle === 'function') {
          try { window.DeepLink.handle(route); } catch (e) {}
        }
      }

      appEmitter.emit(type, payload.data || payload);
      appEmitter.emit('event', payload);
    },

    /**
     * Optional hook. Return `true` to tell the container your router handled
     * the hardware back press; return `false` (or omit) to let the container
     * use the WebView history / exit the app.
     */
    onBackPressed: null
  };

  // ---------------------------------------------------------------------
  // NativeAds
  // ---------------------------------------------------------------------
  var NativeAds = {
    /**
     * Shows an interstitial ad.
     * @returns {Promise<{ok:boolean, reason?:string, type:string, rewardGranted?:boolean}>}
     */
    showInterstitial: function () {
      var promise = begin('interstitial');
      var accepted = !!call('showInterstitial', false);
      if (!accepted) {
        settle('interstitial', { ok: false, reason: 'NOT_AVAILABLE', type: 'interstitial' });
      }
      return promise;
    },

    /**
     * Shows a rewarded video.
     * The promise resolves with `rewardGranted: true` only when the user
     * actually earned the reward.
     */
    showRewarded: function () {
      var promise = begin('rewarded');
      var accepted = !!call('showRewarded', false);
      if (!accepted) {
        settle('rewarded', { ok: false, reason: 'NOT_AVAILABLE', type: 'rewarded', rewardGranted: false });
      }
      return promise;
    },

    /** Shows a native ad in the container's native ad plate. */
    showNative: function () {
      var promise = begin('native');
      var accepted = !!call('showNative', false);
      if (!accepted) {
        settle('native', { ok: false, reason: 'NOT_AVAILABLE', type: 'native' });
      }
      return promise;
    },

    /** Removes the native ad plate. */
    hideNative: function () { return !!call('hideNative', false); },

    /** Positions + shows the native plate (CSS pixels inside the viewport). */
    showNativeAt: function (x, y, width, height) {
      var promise = begin('native');
      var accepted = !!call('showNativeAt', false, x | 0, y | 0, width | 0, height | 0);
      if (!accepted) {
        settle('native', { ok: false, reason: 'NOT_AVAILABLE', type: 'native' });
      }
      return promise;
    },

    /** @param {'interstitial'|'rewarded'|'native'} type */
    isReady: function (type) { return !!call('isAdReady', false, String(type || '')); },

    /** Warm up the ad pipeline (safe to call repeatedly). */
    prepare: function () { call('prepareAds', undefined); },

    isAvailable: function () { return !!call('isAdsAvailable', false); },

    on: function (name, handler) { return adEmitter.on(name, handler); },
    off: function (name, handler) { return adEmitter.off(name, handler); },

    /** Native -> JS event sink. */
    onEvent: function (event) {
      var payload = parse(event, {});
      var type = payload.type || 'event';
      var data = payload.data || {};

      switch (type) {
        case 'interstitial_closed':
          settle('interstitial', { ok: true, type: 'interstitial', data: data });
          break;
        case 'interstitial_shown':
          adEmitter.emit('interstitial:shown', data);
          break;
        case 'interstitial_loaded':
          adEmitter.emit('interstitial:loaded', data);
          break;

        case 'rewarded_completed':
        case 'reward_granted':
          adEmitter.emit('rewarded:granted', data);
          break;
        case 'rewarded_closed':
          settle('rewarded', {
            ok: !!data.rewardGranted,
            type: 'rewarded',
            rewardGranted: !!data.rewardGranted,
            reason: data.rewardGranted ? undefined : 'NOT_REWARDED',
            data: data
          });
          break;
        case 'rewarded_shown':
          adEmitter.emit('rewarded:shown', data);
          break;

        case 'native_shown':
          settle('native', { ok: true, type: 'native', data: data });
          adEmitter.emit('native:shown', data);
          break;
        case 'native_loaded':
          adEmitter.emit('native:loaded', data);
          break;

        case 'ad_request_queued':
          adEmitter.emit('queued', data);
          break;

        case 'ad_error':
          settle(data.adType || 'interstitial', {
            ok: false,
            type: data.adType || 'interstitial',
            reason: data.error || 'AD_ERROR',
            message: data.message,
            data: data
          });
          settle(data.adType || 'rewarded', {
            ok: false,
            type: data.adType || 'rewarded',
            reason: data.error || 'AD_ERROR',
            message: data.message,
            data: data,
            rewardGranted: false
          });
          adEmitter.emit('error', data);
          break;

        default:
          break;
      }

      adEmitter.emit(type, data);
      adEmitter.emit('event', payload);
    }
  };

  // ---------------------------------------------------------------------
  // CafeBazaar (in-app billing) – kept for backwards compatibility
  // ---------------------------------------------------------------------
  var CafeBazaar = {
    isNativeBridgeAvailable: native,
    isAvailable: function () { return !!call('isBillingAvailable', false); },
    connect: function () { return !!call('connectBilling', false); },
    getInfo: function () { return parse(call('getInfo', '{}'), {}); },

    buyProduct: function (productId) { return this.purchase(productId); },
    buyProductWithPayload: function (productId, payload) {
      call('buyProductWithPayload', undefined, String(productId), String(payload || ''));
      return true;
    },
    purchase: function (productId, payload) {
      return new Promise(function (resolve, reject) {
        window.CafeBazaarBridge.__pendingPurchase = window.CafeBazaarBridge.__pendingPurchase || {};
        window.CafeBazaarBridge.__pendingPurchase[productId] = { resolve: resolve, reject: reject };
        if (payload) {
          call('buyProductWithPayload', undefined, String(productId), String(payload));
        } else {
          call('buyProduct', undefined, String(productId));
        }
      });
    },
    consumePurchase: function (purchaseToken) {
      call('consumePurchase', undefined, String(purchaseToken));
      return true;
    },
    getPurchases: function () { return !!call('getPurchases', false); },
    /**
     * True when the permanent `remove_ads` unlock is owned. Interstitials are
     * already suppressed natively in that case, so this is only needed to hide
     * the offer.
     */
    isRemoveAdsOwned: function () { return !!call('isRemoveAdsOwned', false); },

    // ---- CafeBazaar store intents (rating / app page) ----
    /** Opens the CafeBazaar rating dialog for this app. */
    openRatingPage: function () { return !!call('openRatingPage', false); },
    /** Opens the CafeBazaar app page (updates, comments). */
    openStorePage: function () { return !!call('openStorePage', false); },
    /** Legacy alias. */
    rateApp: function () { return !!call('openRatingPage', false); }
  };

  // ---------------------------------------------------------------------
  // CafeBazaarBridge (native -> JS sink)
  // ---------------------------------------------------------------------
  window.CafeBazaarBridge = window.CafeBazaarBridge || {
    __pendingPurchase: {},

    onConnectionResult: function (result) {
      var data = parse(result, {});
      window.dispatchEvent(new CustomEvent('cafebazaar:connection', { detail: data }));
    },

    onPurchaseResult: function (result) {
      var data = parse(result, {});
      var entry = window.CafeBazaarBridge.__pendingPurchase[data.productId];
      if (entry) {
        delete window.CafeBazaarBridge.__pendingPurchase[data.productId];
        if (data.success) entry.resolve(data); else entry.reject(data);
      }
      window.dispatchEvent(new CustomEvent('cafebazaar:purchase', { detail: data }));
    },

    onConsumeResult: function (result) {
      window.dispatchEvent(new CustomEvent('cafebazaar:consume', { detail: parse(result, {}) }));
    },

    onPurchasesQueryResult: function (result) {
      window.dispatchEvent(new CustomEvent('cafebazaar:purchases', { detail: parse(result, {}) }));
    },

    /** Fired when the set of permanent unlocks changes (bought / restored). */
    onOwnedProductsChanged: function (result) {
      var data = parse(result, {});
      window.dispatchEvent(new CustomEvent('cafebazaar:ownedproducts', { detail: data }));
    }
  };

  // ---------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------
  window.NativeApp = window.NativeApp || NativeApp;
  window.NativeAds = window.NativeAds || NativeAds;
  window.CafeBazaar = window.CafeBazaar || CafeBazaar;
  window.BazaarBridge = window.CafeBazaar;

  // Convenience: forward native DOM events to the emitter API as well.
  window.addEventListener('nativeapp:deeplink', function (e) {
    if (e && e.detail) appEmitter.emit('deeplink', e.detail.route || '');
  });
  window.addEventListener('nativeads:event', function (e) {
    if (e && e.detail) adEmitter.emit('event', e.detail);
  });
  window.addEventListener('nativeapp:ready', function (e) {
    if (e && e.detail) appEmitter.emit('container:ready', e.detail);
  });
  window.addEventListener('nativeapp:ownedproducts', function (e) {
    if (e && e.detail) appEmitter.emit('ownedproducts', e.detail);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      appEmitter.emit('container:dom', { native: native() });
    });
  }
})(window, document);
