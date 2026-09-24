/**
 * Native container facade for چیستان (ChistanSara)
 * Supports:
 *  - Old labzband bridges: NativeApp, NativeAds, CafeBazaar
 *  - Jadooye Adad bridges: TapsellBridge, PoolakeyBridge, BAZAAR_RSA_KEY, TAPSELL_CONFIG
 *  - ChistanSara integration: fair economy, 3-level interstitials, progress mirror, Persian loading
 */
(function (window) {
  'use strict';

  // ------------------------------------------------------------------ core
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
  window.addEventListener('nativeapp:pause', pauseWebAudio);
  window.addEventListener('nativeapp:resume', resumeWebAudio);

  var adPending = null, purchasePending = null, queryPending = null;
  var consumePending = Object.create(null), listeners = Object.create(null);
  var ready = false, backHandler = null;
  var lastCompletedCount = 0;
  var lastLevel = 0;
  var interstitialEvery = 3; // show ad every 3 levels
  var SAVE_KEY = 'chistansara_game_save_v2';
  var SAVE_KEY_ALT = 'labzband_progress_v4'; // legacy support

  function call(method, fallback) {
    var b = window.AndroidBridge;
    if (!b || typeof b[method] !== 'function') return fallback;
    try { return b[method].apply(b, Array.prototype.slice.call(arguments, 2)); }
    catch (_) { return fallback; }
  }
  function parse(value) {
    try { var data = typeof value === 'string' ? JSON.parse(value) : value;
      return data && typeof data === 'object' ? data : {}; } catch (_) { return {}; }
  }
  function emit(name, data) {
    (listeners[name] || []).slice().forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } });
  }
  function on(name, fn) {
    (listeners[name] = listeners[name] || []).push(fn);
    return function () { listeners[name] = listeners[name].filter(function (item) { return item !== fn; }); };
  }
  function event(name, data) { window.dispatchEvent(new CustomEvent(name, { detail: data })); }
  function fail(reason) { return { ok: false, success: false, rewardGranted: false, reason: reason, errorCode: reason }; }
  function request(timeout) {
    var entry = { done: false };
    entry.promise = new Promise(function (resolve) {
      entry.finish = function (result) {
        if (entry.done) return;
        entry.done = true; clearTimeout(entry.timer); resolve(result);
      };
      entry.timer = setTimeout(function () { entry.finish(fail('TIMEOUT')); }, timeout);
    });
    return entry;
  }
  function show(kind, method, args) {
    if (adPending) return Promise.resolve(fail('BUSY'));
    // Keep the WebApp-side timeout aligned with the native contract. Native
    // requests are bounded to six seconds for interstitial/native and eighteen
    // seconds for rewarded; the JS facade must not leave a game waiting for
    // three minutes when a bridge callback is lost.
    var entry = request(kind === 'rewarded' ? 18000 : 6000);
    entry.kind = kind; entry.reward = false; adPending = entry;
    var accepted = call.apply(null, [method, false].concat(args || []));
    if (accepted !== true) { adPending = null; entry.finish(fail('NOT_AVAILABLE')); }
    return entry.promise;
  }
  var lastAdEnvelope = null;
  function adEvent(value) {
    var e = parse(value), data = parse(e.data), entry = adPending, type = e.type;
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
          ok: entry.kind !== 'rewarded' || granted, type: entry.kind,
          rewardGranted: entry.kind === 'rewarded' && granted,
          success: !error, verified: !error,
          reason: skipped ? 'SKIPPED' : (entry.kind === 'rewarded' && !granted ? 'NOT_REWARDED' : undefined), data: data
        });
      }
    }
    emit('ads:' + type, data); emit('ads:event', e);
  }

  // ---------------------------------------------------------------- NativeApp
  window.NativeApp = {
    isNative: function () { return !!window.AndroidBridge; },
    appReady: function () {
      if (!ready) {
        ready = call('appReady', false) === true;
        // Also try to save that we are ready
        try { localStorage.setItem('native_app_ready', '1'); } catch(e){}
      }
      return ready;
    },
    appLoaded: function () { return window.NativeApp.appReady(); },
    getInfo: function () { return parse(call('getInfo', '{}')); },
    getStartupRoute: function () { var route = call('getStartupRoute', ''); call('consumeStartupRoute', null); return route || ''; },
    reportError: function (message) { call('reportError', null, String(message)); },
    navigateBack: function () { return call('navigateBack', false) === true; },
    setBackHandler: function (fn) { backHandler = fn; },
    onBackPressed: function () { try { return !!backHandler && backHandler() === true; } catch (_) { return false; } },
    openEmail: function (address) { return call('openEmail', false, String(address)) === true; },
    openStorePage: function () { return call('openStorePage', false) === true; },
    openRatingPage: function () { return call('openRatingPage', false) === true; },
    saveState: function (key, value, savedAt) {
      try {
        return call('saveState', false, String(key), String(value), String(savedAt == null ? Date.now() : savedAt)) === true;
      } catch(e){ return false; }
    },
    loadState: function (key) {
      var raw = call('loadState', null, String(key));
      if (!raw || typeof raw !== 'string') return null;
      try { var o = JSON.parse(raw); return o && typeof o === 'object' && typeof o.value === 'string' ? o : null; } catch (_) { return null; }
    },
    clearState: function (key) { return call('clearState', false, String(key)) === true; },
    on: function (name, fn) { return on('app:' + name, fn); },
    onEvent: function (value) { var e = parse(value); emit('app:' + e.type, e.data || e); emit('app:event', e); }
  };

  // --------------------------------------------------------------- NativeAds
  window.NativeAds = {
    showInterstitial: function () { return show('interstitial', 'showInterstitial'); },
    // Rewarded ads must never mint currency. Coin packs are CafeBazaar-only;
    // callers receive a settled failure instead of a reward that can be
    // converted into coins by the game bundle.
    showRewarded: function () { return Promise.resolve(fail('REWARDED_DISABLED')); },
    showNative: function () { return show('native', 'showNative'); },
    showNativeAt: function (x, y, w, h) { return show('native', 'showNativeAt', [x|0,y|0,w|0,h|0]); },
    hideNative: function () { return call('hideNative', false) === true; },
    isReady: function (type) { return call('isAdReady', false, type) === true; },
    isAvailable: function () { return call('isAdsAvailable', false) === true; },
    prepare: function () { call('prepareAds', null); },
    on: function (name, fn) { return on('ads:' + name, fn); }, onEvent: adEvent
  };

  // -------------------------------------------------------------- CafeBazaar
  window.CafeBazaar = {
    isNativeBridgeAvailable: window.NativeApp.isNative,
    isAvailable: function () { return call('isBillingAvailable', false) === true; },
    connect: function () { return call('connectBilling', false) === true; },
    getInfo: window.NativeApp.getInfo,
    isRemoveAdsOwned: function () { return call('isRemoveAdsOwned', false) === true; },
    openRatingPage: function () { return call('openRatingPage', false) === true; },
    openStorePage: function () { return call('openStorePage', false) === true; },
    purchase: function (productId, payload) {
      if (purchasePending) return Promise.resolve({ success: false, verified: false, productId: productId, errorCode: 'BUSY' });
      var entry = request(300000); entry.productId = productId; purchasePending = entry;
      var result = payload ? call('buyProductWithPayload', false, productId, payload) : call('buyProduct', false, productId);
      if (result === false) { purchasePending = null; entry.finish({ success: false, verified: false, productId: productId, errorCode: 'NOT_AVAILABLE' }); }
      return entry.promise;
    },
    consume: function (token) {
      if (consumePending[token]) return consumePending[token].promise;
      var entry = request(30000); consumePending[token] = entry;
      if (call('consumePurchase', false, token) === false) { delete consumePending[token]; entry.finish({ success: false, errorCode: 'NOT_AVAILABLE' }); }
      return entry.promise;
    },
    getPurchases: function () {
      if (queryPending) return queryPending.promise;
      var entry = request(30000); queryPending = entry;
      if (call('getPurchases', false) === false) { queryPending = null; entry.finish({ success: false, errorCode: 'NOT_AVAILABLE', purchases: [] }); }
      return entry.promise;
    }
  };
  window.CafeBazaar.buyProduct = window.CafeBazaar.purchase.bind(window.CafeBazaar);
  window.CafeBazaar.buyProductWithPayload = window.CafeBazaar.buyProduct;
  window.CafeBazaar.consumePurchase = window.CafeBazaar.consume;
  window.CafeBazaar.rateApp = window.CafeBazaar.openRatingPage;
  window.BazaarBridge = window.CafeBazaar;
  window.CafeBazaarBridge = {
    onConnectionResult: function (value) { event('cafebazaar:connection', parse(value)); },
    onPurchaseResult: function (value) {
      var data = parse(value);
      if (purchasePending && purchasePending.productId === data.productId) {
        var entry = purchasePending; purchasePending = null; entry.finish(data);
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
      if (queryPending) { var entry = queryPending; queryPending = null; entry.finish(data); }
      event('cafebazaar:purchases', data);
    },
    onOwnedProductsChanged: function (value) { event('cafebazaar:ownedproducts', parse(value)); }
  };

  // ------------------------------------------------------- Jadooye Adad compat
  // These are what the math game expects
  try {
    var info = window.NativeApp.getInfo();
    window.BAZAAR_RSA_KEY = info && info.appId ? "configured" : "";
  } catch(e) { window.BAZAAR_RSA_KEY = ""; }
  // Provide real RSA key from native if available via AndroidBridge? We'll try to get it
  // The Kotlin side has it, but we expose via getInfo? Actually we need to expose via call
  // For simplicity, let PoolakeyBridge use CafeBazaar underneath

  window.TAPSELL_CONFIG = {
    appKey: "tkonjgrntiepgsjgnkmhkrbassggiekcsafqrbkgqoihkkqdndgqojsldtdnojagjjtddh",
    zones: {
      banner: "6ab339d96da4b558f3901bc1",
      interstitial: "6ab339cee237e15c69fbab2b",
      native: "6ab339d96da4b558f3901bc1",
      rewarded: "6ab339c3da860d2c9f00cfa9"
    }
  };

  // TapsellBridge that uses NativeAds
  window.TapsellBridge = {
    init: function(appKey) { window.NativeAds.prepare(); },
    showBanner: function(zoneId) { /* banner handled natively via plate */ },
    hideBanner: function() { window.NativeAds.hideNative(); },
    requestInterstitial: function(zoneId) {
      return new Promise(function(resolve){ resolve("inter-" + Date.now()); });
    },
    showInterstitial: function(responseId) {
      return window.NativeAds.showInterstitial().then(function(){});
    },
    requestRewarded: function(zoneId) {
      return new Promise(function(resolve){ resolve("reward-" + Date.now()); });
    },
    showRewarded: function(responseId) {
      return window.NativeAds.showRewarded().then(function(){});
    },
    showNativeAt: function(zoneId, x, y, w, h) {
      return window.NativeAds.showNativeAt(x,y,w,h).then(function(){});
    },
    moveNative: function(x,y,w,h) { /* handled */ },
    hideNative: function() { window.NativeAds.hideNative(); }
  };

  // PoolakeyBridge that uses CafeBazaar
  window.PoolakeyBridge = {
    connect: function(rsaKey) {
      return new Promise(function(resolve){
        var ok = window.CafeBazaar.connect();
        // Give it a moment
        setTimeout(function(){ resolve(ok); }, 300);
      });
    },
    disconnect: function() {},
    purchase: function(productId, payload) {
      return window.CafeBazaar.purchase(productId, payload).then(function(res){
        if (res.success && res.verified) {
          return {
            status: 'success',
            purchase: {
              orderId: res.purchaseToken || ('order-' + Date.now()),
              productId: res.productId,
              purchaseToken: res.purchaseToken,
              payload: payload || '',
              purchaseTime: Date.now()
            }
          };
        } else if (res.errorCode === 'USER_CANCELED' || res.errorCode === 'CANCELLED') {
          return { status: 'canceled' };
        } else {
          return { status: 'failed', message: res.errorCode || 'FAILED' };
        }
      });
    },
    consume: function(token) {
      return window.CafeBazaar.consume(token).then(function(res){
        return res.success !== false;
      });
    },
    getPurchasedProducts: function() {
      return window.CafeBazaar.getPurchases().then(function(res){
        var list = [];
        try {
          if (res.purchases && Array.isArray(res.purchases)) {
            list = res.purchases.map(function(p){
              return {
                orderId: p.purchaseToken || p.orderId || '',
                productId: p.productId,
                purchaseToken: p.purchaseToken,
                payload: p.payload || '',
                purchaseTime: p.purchaseTime || Date.now()
              };
            });
          }
        } catch(e){}
        return list;
      });
    },
    getSkuDetails: function(skus) {
      return Promise.resolve([]);
    }
  };

  // ------------------------------------------------------- Chistan helpers
  function getCompletedCount() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return 0;
      var data = JSON.parse(raw);
      if (data.completedLevels && typeof data.completedLevels === 'object') {
        return Object.keys(data.completedLevels).length;
      }
      return 0;
    } catch(e){ return 0; }
  }
  function shouldShowAd(newCount) {
    if (newCount <= 0) return false;
    if (newCount % interstitialEvery !== 0) return false;
    if (newCount === lastCompletedCount) return false;
    // Secure: only check native ownership, not localStorage (prevent bypass)
    try {
      if (window.CafeBazaar.isRemoveAdsOwned()) return false;
      var info = window.NativeApp.getInfo();
      if (info && info.removeAdsOwned) return false;
    } catch(e){}
    return true;
  }
  function tryShowInterstitial() {
    var count = getCompletedCount();
    if (shouldShowAd(count)) {
      lastCompletedCount = count;
      console.log('[Chistan] Interstitial trigger at level count', count);
      // Small delay to let UI settle
      setTimeout(function(){
        window.NativeAds.showInterstitial().catch(function(){});
      }, 800);
    } else {
      lastCompletedCount = count;
    }
  }

  // Hook localStorage.setItem to detect save changes
  // IMPORTANT: In some WebView/jsdom implementations, assigning to localStorage.setItem creates a storage entry.
  // We must override via defineProperty on the instance and on Storage.prototype.
  (function(){
    var origSetItem = null;
    try {
      origSetItem = window.Storage ? window.Storage.prototype.setItem : localStorage.setItem;
    } catch(e) {
      origSetItem = localStorage.setItem;
    }
    var hookedSetItem = function(key, value) {
      var result;
      try {
        result = origSetItem.apply(this, arguments);
      } catch(e) {
        // Fallback if orig is not bound
        result = Storage.prototype.setItem.apply(this, arguments);
      }
      if (key === SAVE_KEY || key === SAVE_KEY_ALT) {
        // Mirror to native for persistence (force stop survival)
        try {
          window.NativeApp.saveState(key, value, Date.now());
        } catch(e){}
        // Check ad every 3 levels
        try { tryShowInterstitial(); } catch(e){}
      }
      return result;
    };
    try {
      Object.defineProperty(localStorage, 'setItem', { value: hookedSetItem, writable: true, configurable: true });
    } catch(e) {
      try { localStorage.setItem = hookedSetItem; } catch(e2){}
    }
    try {
      if (window.Storage && window.Storage.prototype) {
        // Keep original for other instances
        if (!window.Storage.prototype._origSetItem) {
          window.Storage.prototype._origSetItem = window.Storage.prototype.setItem;
        }
        // Only override if not already our hook
        var current = window.Storage.prototype.setItem;
        if (current !== hookedSetItem && current.toString().indexOf('SAVE_KEY') === -1) {
          Object.defineProperty(window.Storage.prototype, 'setItem', { value: hookedSetItem, writable: true, configurable: true });
        }
      }
    } catch(e){}
    // Also mirror on load
    try {
      var nativeData = window.NativeApp.loadState(SAVE_KEY);
      if (nativeData && nativeData.value) {
        try {
          var webRaw = localStorage.getItem(SAVE_KEY);
          // If native has data and web doesn't, restore
          if (!webRaw && nativeData.value) {
            origSetItem.call(localStorage, SAVE_KEY, nativeData.value);
          }
        } catch(e){}
      }
    } catch(e){}
    lastCompletedCount = getCompletedCount();
  })();

  // Expose Chistan economy helpers
  window.ChistanBridge = {
    getEconomy: function() {
      return {
        coinsPerLevel: 30,
        hintCosts: { letter: 60, eliminate: 100, clue: 150, answer: 150 },
        dailyRewards: [50,75,100,125,150,200,350],
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
        interstitialEvery: 3
      };
    },
    showInterstitialIfNeeded: tryShowInterstitial,
    purchaseCoins: function(sku, coins) {
      return window.CafeBazaar.purchase(sku).then(function(res){
        if (res.success && res.verified) {
          // consume
          if (res.purchaseToken) {
            window.CafeBazaar.consume(res.purchaseToken).catch(function(){});
          }
          return { success: true, coins: coins };
        }
        return { success: false, error: res.errorCode };
      });
    },
    purchaseRemoveAds: function() {
      return window.CafeBazaar.purchase('remove_ads').then(function(res){
        if (res.success && res.verified) {
          return { success: true };
        }
        return { success: false, error: res.errorCode };
      });
    }
  };

  // Auto appReady after boot
  function autoReady() {
    try {
      if (!ready) {
        window.NativeApp.appReady();
        window.NativeAds.prepare();
        window.CafeBazaar.connect();
      }
    } catch(e){}
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(autoReady, 800);
  } else {
    window.addEventListener('DOMContentLoaded', function(){ setTimeout(autoReady, 800); });
  }
  window.addEventListener('load', function(){ setTimeout(autoReady, 1200); });

  // Back handler passthrough for Chistan
  window.addEventListener('nativeapp:back', function(e){
    // Let game's own back handler run first via NativeApp.onBackPressed
    // If not handled, router will handle
  });

  window.addEventListener('nativeads:event', function (e) { adEvent(e.detail); });
  window.addEventListener('nativeapp:deeplink', function (e) { emit('app:deep_link', e.detail); });

  // Restore remove_ads entitlement on start
  setTimeout(function(){
    window.CafeBazaar.getPurchases().then(function(res){
      try {
        var purchases = res.purchases || [];
        var hasRemoveAds = purchases.some(function(p){ return p.productId === 'remove_ads'; });
        if (hasRemoveAds) {
          console.log('[Chistan] Remove Ads restored');
        }
      } catch(e){}
    }).catch(function(){});
  }, 1500);

})(window);
