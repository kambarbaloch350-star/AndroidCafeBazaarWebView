// Universal Production Bridge for CafeBazaar (Poolakey) and Adivery
(function(window) {
    'use strict';
    // Exposes window.CafeBazaar and window.Adivery
    window.CafeBazaar = {
        isAvailable: () => typeof window.AndroidBridge !== 'undefined' && window.AndroidBridge.isAvailable(),
        purchase: (sku) => {
            if (!window.AndroidBridge) return Promise.resolve({ success: true, productId: sku, purchaseToken: 'sim_' + Date.now() });
            return new Promise((resolve) => {
                window.__pendingPurchases = window.__pendingPurchases || {};
                window.__pendingPurchases[sku] = resolve;
                window.AndroidBridge.buyProduct(sku);
            });
        },
        consumePurchase: (token) => {
            if (window.AndroidBridge) window.AndroidBridge.consumePurchase(token);
            return Promise.resolve();
        }
    };
    window.Adivery = {
        showBanner: () => window.AndroidBridge?.showBanner() ?? true,
        hideBanner: () => window.AndroidBridge?.hideBanner() ?? true,
        showInterstitial: () => {
            if (window.AndroidBridge) return window.AndroidBridge.showInterstitial();
            return Promise.resolve(true);
        },
        showRewarded: () => {
            if (window.AndroidBridge) {
                return new Promise(resolve => {
                    window.__pendingRewarded = resolve;
                    window.AndroidBridge.showRewarded();
                });
            }
            return Promise.resolve({ rewardGranted: true });
        }
    };
    window.BazaarBridge = window.CafeBazaar;
    window.AdiveryBridge = window.Adivery;
})(window);