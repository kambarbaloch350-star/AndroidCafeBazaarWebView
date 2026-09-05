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
            bazaarListeners.connection.forEach(fn => {
                try { fn(result); } catch (e) { console.error(e); }
            });
            window.dispatchEvent(new CustomEvent('cafebazaar:connection', { detail: result }));
        },

        onPurchaseResult: function (result) {
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
            if (this.isNativeBridgeAvailable()) {
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
                    }, 500);
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

    window.AdiveryBridge = {
        onAdEvent: function (event) {
            if (typeof event === 'string') {
                try { event = JSON.parse(event); } catch (_) {}
            }

            adListeners.forEach(fn => {
                try { fn(event); } catch (e) { console.error(e); }
            });

            if (event.type === 'rewarded_closed') {
                if (pendingRewardedResolver) {
                    pendingRewardedResolver(event.data || { rewardGranted: false });
                    pendingRewardedResolver = null;
                }
            } else if (event.type === 'interstitial_closed') {
                if (pendingInterstitialResolver) {
                    pendingInterstitialResolver(true);
                    pendingInterstitialResolver = null;
                }
            } else if (event.type === 'ad_error') {
                if (pendingRewardedResolver) {
                    pendingRewardedResolver({ rewardGranted: false, error: event.data?.error || 'AD_ERROR' });
                    pendingRewardedResolver = null;
                }
                if (pendingInterstitialResolver) {
                    pendingInterstitialResolver(false);
                    pendingInterstitialResolver = null;
                }
            }

            window.dispatchEvent(new CustomEvent('adivery:event', { detail: event }));
        }
    };

    const Adivery = {
        isNativeBridgeAvailable: function () {
            return typeof window.AndroidBridge !== 'undefined';
        },

        showBanner: function () {
            if (this.isNativeBridgeAvailable()) {
                return window.AndroidBridge.showBanner();
            }
            return true;
        },

        hideBanner: function () {
            if (this.isNativeBridgeAvailable()) {
                return window.AndroidBridge.hideBanner();
            }
            return true;
        },

        showInterstitial: function (placementId) {
            return new Promise(resolve => {
                if (!this.isNativeBridgeAvailable()) {
                    // Browser preview simulation: simulate ad shown and closed
                    console.log('[Adivery] Browser preview: showing interstitial ad simulation');
                    setTimeout(() => resolve(true), 800);
                    return;
                }

                pendingInterstitialResolver = resolve;
                const shown = window.AndroidBridge.showInterstitial(placementId || '');
                if (!shown) {
                    pendingInterstitialResolver = null;
                    resolve(false);
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
                    }, 1200);
                    return;
                }

                pendingRewardedResolver = resolve;
                const shown = window.AndroidBridge.showRewarded(placementId || '');
                if (!shown) {
                    pendingRewardedResolver = null;
                    resolve({ rewardGranted: false, error: 'NOT_LOADED' });
                }
            });
        },

        isLoaded: function (placementId) {
            if (this.isNativeBridgeAvailable()) {
                return window.AndroidBridge.isAdLoaded(placementId || '');
            }
            return true;
        },

        on: function (callback) {
            adListeners.push(callback);
        }
    };

    window.Adivery = Adivery;
    // Keep window.AdiveryBridge pointing to the full API
    Object.assign(window.AdiveryBridge, Adivery);

})(window);
