/**
 * android-bridge.js
 * Universal Production Bridge for CafeBazaar In-App Billing (Poolakey)
 * and Adivery Mobile Advertising Network.
 * Application: com.emochi.quickgames
 */
(function (window) {
    'use strict';

    // =========================================================================
    // 1. CafeBazaar In-App Billing Bridge
    // =========================================================================
    const bazaarListeners = {
        connection: [],
        purchase: [],
        consume: [],
        query: []
    };

    const pendingPurchasePromises = new Map();
    const pendingConsumePromises = new Map();
    const pendingQueryPromises = [];

    window.CafeBazaarBridge = {
        onConnectionResult: function (result) {
            if (typeof result === 'string') {
                try { result = JSON.parse(result); } catch (_) {}
            }
            bazaarListeners.connection.forEach(fn => {
                try { fn(result); } catch (e) { console.error(e); }
            });
            window.dispatchEvent(new CustomEvent('cafebazaar:connection', { detail: result }));
        },
        onPurchaseResult: function (result) {
            if (typeof result === 'string') {
                try { result = JSON.parse(result); } catch (_) {}
            }
            if (result.productId && pendingPurchasePromises.has(result.productId)) {
                const resolver = pendingPurchasePromises.get(result.productId);
                pendingPurchasePromises.delete(result.productId);
                if (result.success) {
                    resolver.resolve(result);
                } else {
                    resolver.reject(result);
                }
            }
            bazaarListeners.purchase.forEach(fn => {
                try { fn(result); } catch (e) { console.error(e); }
            });
            window.dispatchEvent(new CustomEvent('cafebazaar:purchase', { detail: result }));
        },
        onConsumeResult: function (result) {
            if (typeof result === 'string') {
                try { result = JSON.parse(result); } catch (_) {}
            }
            if (result.purchaseToken && pendingConsumePromises.has(result.purchaseToken)) {
                const resolver = pendingConsumePromises.get(result.purchaseToken);
                pendingConsumePromises.delete(result.purchaseToken);
                if (result.success) {
                    resolver.resolve(result);
                } else {
                    resolver.reject(result);
                }
            }
            bazaarListeners.consume.forEach(fn => {
                try { fn(result); } catch (e) { console.error(e); }
            });
            window.dispatchEvent(new CustomEvent('cafebazaar:consume', { detail: result }));
        },
        onPurchasesQueryResult: function (result) {
            if (typeof result === 'string') {
                try { result = JSON.parse(result); } catch (_) {}
            }
            while (pendingQueryPromises.length > 0) {
                const resolver = pendingQueryPromises.shift();
                if (result.success) {
                    resolver.resolve(result.purchases || []);
                } else {
                    resolver.reject(result);
                }
            }
            bazaarListeners.query.forEach(fn => {
                try { fn(result); } catch (e) { console.error(e); }
            });
            window.dispatchEvent(new CustomEvent('cafebazaar:query', { detail: result }));
        }
    };

    const CafeBazaar = {
        isNativeBridgeAvailable: function () {
            return typeof window.AndroidBridge !== 'undefined';
        },
        isAvailable: function () {
            if (this.isNativeBridgeAvailable() && typeof window.AndroidBridge.isAvailable === 'function') {
                return window.AndroidBridge.isAvailable();
            }
            return false;
        },
        connect: function () {
            if (this.isNativeBridgeAvailable() && typeof window.AndroidBridge.connectBilling === 'function') {
                window.AndroidBridge.connectBilling();
            }
        },
        purchase: function (productId, payload = null) {
            return new Promise((resolve, reject) => {
                if (!productId) {
                    return reject({ success: false, message: 'productId cannot be empty' });
                }
                if (!this.isNativeBridgeAvailable()) {
                    // Browser preview mock for seamless testing
                    setTimeout(() => {
                        resolve({
                            success: true,
                            productId: productId,
                            purchaseToken: 'mock_token_' + Date.now(),
                            orderId: 'mock_order_' + Date.now(),
                            message: 'Browser simulated purchase'
                        });
                    }, 400);
                    return;
                }
                pendingPurchasePromises.set(productId, { resolve, reject });
                if (payload) {
                    window.AndroidBridge.buyProductWithPayload(productId, payload);
                } else {
                    window.AndroidBridge.buyProduct(productId);
                }
            });
        },
        consumePurchase: function (purchaseToken) {
            return new Promise((resolve, reject) => {
                if (!purchaseToken) {
                    return reject({ success: false, message: 'purchaseToken cannot be empty' });
                }
                if (!this.isNativeBridgeAvailable()) {
                    resolve({ success: true, purchaseToken: purchaseToken });
                    return;
                }
                pendingConsumePromises.set(purchaseToken, { resolve, reject });
                window.AndroidBridge.consumePurchase(purchaseToken);
            });
        },
        getPurchases: function () {
            return new Promise((resolve, reject) => {
                if (!this.isNativeBridgeAvailable()) {
                    resolve([]);
                    return;
                }
                pendingQueryPromises.push({ resolve, reject });
                window.AndroidBridge.getPurchases();
            });
        },
        on: function (eventType, callback) {
            if (bazaarListeners[eventType]) {
                bazaarListeners[eventType].push(callback);
            }
        },
        off: function (eventType, callback) {
            if (bazaarListeners[eventType]) {
                bazaarListeners[eventType] = bazaarListeners[eventType].filter(fn => fn !== callback);
            }
        }
    };

    window.CafeBazaar = CafeBazaar;
    window.BazaarBridge = CafeBazaar;

    // =========================================================================
    // 2. Adivery Mobile Advertising Bridge
    // =========================================================================
    let pendingInterstitialResolver = null;
    let pendingRewardedResolver = null;
    const adListeners = [];

    function resolvePendingRewarded(data) {
        if (window.__pendingRewarded) {
            try {
                if (typeof window.__pendingRewarded === 'function') {
                    window.__pendingRewarded(data);
                } else if (typeof window.__pendingRewarded.resolve === 'function') {
                    window.__pendingRewarded.resolve(data);
                }
            } catch (e) {
                console.error('[Adivery] Error resolving __pendingRewarded:', e);
            }
            window.__pendingRewarded = null;
        }
        if (pendingRewardedResolver) {
            try {
                pendingRewardedResolver(data);
            } catch (e) {
                console.error('[Adivery] Error resolving pendingRewardedResolver:', e);
            }
            pendingRewardedResolver = null;
        }
    }

    function resolvePendingInterstitial(success) {
        if (window.__pendingInterstitial) {
            try {
                if (typeof window.__pendingInterstitial === 'function') {
                    window.__pendingInterstitial(success);
                } else if (typeof window.__pendingInterstitial.resolve === 'function') {
                    window.__pendingInterstitial.resolve(success);
                }
            } catch (e) {
                console.error('[Adivery] Error resolving __pendingInterstitial:', e);
            }
            window.__pendingInterstitial = null;
        }
        if (pendingInterstitialResolver) {
            try {
                pendingInterstitialResolver(success);
            } catch (e) {
                console.error('[Adivery] Error resolving pendingInterstitialResolver:', e);
            }
            pendingInterstitialResolver = null;
        }
    }

    const AdiveryBridgeReceiver = {
        onAdEvent: function (event) {
            if (typeof event === 'string') {
                try { event = JSON.parse(event); } catch (_) {}
            }
            if (!event || !event.type) return;

            // Notify custom ad listeners
            adListeners.forEach(fn => {
                try { fn(event); } catch (e) { console.error(e); }
            });

            // Dispatch lifecycle results to pending Promises
            if (event.type === 'rewarded_closed') {
                const data = event.data || { rewardGranted: false };
                resolvePendingRewarded(data);
            } else if (event.type === 'interstitial_closed') {
                resolvePendingInterstitial(true);
            } else if (event.type === 'ad_error') {
                const errorMsg = event.data?.error || 'AD_ERROR';
                resolvePendingRewarded({ rewardGranted: false, error: errorMsg });
                resolvePendingInterstitial(false);
            }

            window.dispatchEvent(new CustomEvent('adivery:event', { detail: event }));
        }
    };

    const Adivery = {
        isNativeBridgeAvailable: function () {
            return typeof window.AndroidBridge !== 'undefined';
        },
        showBanner: function () {
            if (this.isNativeBridgeAvailable() && typeof window.AndroidBridge.showBanner === 'function') {
                return window.AndroidBridge.showBanner();
            }
            return true;
        },
        hideBanner: function () {
            if (this.isNativeBridgeAvailable() && typeof window.AndroidBridge.hideBanner === 'function') {
                return window.AndroidBridge.hideBanner();
            }
            return true;
        },
        showInterstitial: function (placementId) {
            return new Promise(resolve => {
                if (!this.isNativeBridgeAvailable()) {
                    // Browser preview simulation: simulate ad display
                    console.log('[Adivery] Browser preview: showing interstitial simulation');
                    setTimeout(() => resolve(true), 600);
                    return;
                }
                pendingInterstitialResolver = resolve;
                window.__pendingInterstitial = resolve;

                let shown = false;
                try {
                    if (placementId) {
                        shown = window.AndroidBridge.showInterstitial(placementId);
                    } else {
                        shown = window.AndroidBridge.showInterstitial();
                    }
                } catch (e) {
                    console.error('[Adivery] Native showInterstitial error:', e);
                    shown = false;
                }

                if (!shown) {
                    // Ad was not ready/loaded
                    resolvePendingInterstitial(false);
                }
            });
        },
        showRewarded: function (placementId) {
            return new Promise(resolve => {
                if (!this.isNativeBridgeAvailable()) {
                    // Browser preview simulation: simulate rewarded video watch
                    console.log('[Adivery] Browser preview: watching rewarded video...');
                    setTimeout(() => {
                        resolve({ rewardGranted: true });
                    }, 1000);
                    return;
                }
                pendingRewardedResolver = resolve;
                window.__pendingRewarded = resolve;

                let shown = false;
                try {
                    if (placementId) {
                        shown = window.AndroidBridge.showRewarded(placementId);
                    } else {
                        shown = window.AndroidBridge.showRewarded();
                    }
                } catch (e) {
                    console.error('[Adivery] Native showRewarded error:', e);
                    shown = false;
                }

                if (!shown) {
                    resolvePendingRewarded({ rewardGranted: false, error: 'NOT_LOADED' });
                }
            });
        },
        isLoaded: function (placementId) {
            if (this.isNativeBridgeAvailable() && typeof window.AndroidBridge.isAdLoaded === 'function') {
                try {
                    return placementId ? window.AndroidBridge.isAdLoaded(placementId) : window.AndroidBridge.isAdLoaded();
                } catch (_) {
                    return false;
                }
            }
            return true;
        },
        on: function (callback) {
            if (typeof callback === 'function') {
                adListeners.push(callback);
            }
        },
        off: function (callback) {
            const idx = adListeners.indexOf(callback);
            if (idx !== -1) {
                adListeners.splice(idx, 1);
            }
        }
    };

    window.Adivery = Adivery;
    window.AdiveryBridge = window.AdiveryBridge || {};
    Object.assign(window.AdiveryBridge, AdiveryBridgeReceiver, Adivery);

    // Announce readiness
    window.dispatchEvent(new CustomEvent('CafeBazaarBridgeReady'));
    window.dispatchEvent(new CustomEvent('AdiveryBridgeReady'));

})(window);
