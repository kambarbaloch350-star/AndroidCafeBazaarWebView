/**
 * bazaar-bridge.esm.js
 * ES Module wrapper for games and web apps built with Node.js, Vite, Webpack, React, Vue, Svelte, or Phaser.
 * Exposes both CafeBazaar In-App Billing and Adivery Mobile Ads.
 */

export const CafeBazaar = {
  isNativeAvailable() {
    return typeof window !== 'undefined' && typeof window.AndroidBridge !== 'undefined';
  },
  isBillingConnected() {
    return this.isNativeAvailable() && Boolean(window.AndroidBridge.isAvailable?.());
  },
  connect() {
    if (this.isNativeAvailable() && typeof window.AndroidBridge.connectBilling === 'function') {
      window.AndroidBridge.connectBilling();
    }
  },
  purchase(productId, payload = null) {
    if (typeof window !== 'undefined' && window.CafeBazaar?.purchase) {
      return window.CafeBazaar.purchase(productId, payload);
    }
    return Promise.reject(new Error('CafeBazaar billing bridge is not initialized'));
  },
  consume(purchaseToken) {
    if (typeof window !== 'undefined' && (window.CafeBazaar?.consumePurchase || window.CafeBazaar?.consume)) {
      const fn = window.CafeBazaar.consumePurchase || window.CafeBazaar.consume;
      return fn(purchaseToken);
    }
    return Promise.reject(new Error('CafeBazaar billing bridge is not initialized'));
  },
  queryPurchases() {
    if (typeof window !== 'undefined' && window.CafeBazaar?.getPurchases) {
      return window.CafeBazaar.getPurchases();
    }
    return Promise.reject(new Error('CafeBazaar billing bridge is not initialized'));
  },
  on(event, callback) {
    if (typeof window === 'undefined') return () => {};
    const eventName = event === 'ready' ? 'CafeBazaarBridgeReady' : `cafebazaar:${event}`;
    const handler = (e) => callback(e.detail);
    window.addEventListener(eventName, handler);
    return () => window.removeEventListener(eventName, handler);
  }
};

export const Adivery = {
  isNativeAvailable() {
    return typeof window !== 'undefined' && typeof window.AndroidBridge !== 'undefined';
  },
  showBanner() {
    if (typeof window !== 'undefined' && window.Adivery?.showBanner) {
      return window.Adivery.showBanner();
    }
    return false;
  },
  hideBanner() {
    if (typeof window !== 'undefined' && window.Adivery?.hideBanner) {
      return window.Adivery.hideBanner();
    }
    return false;
  },
  showInterstitial(placementId = null) {
    if (typeof window !== 'undefined' && window.Adivery?.showInterstitial) {
      return window.Adivery.showInterstitial(placementId);
    }
    return Promise.resolve(false);
  },
  showRewarded(placementId = null) {
    if (typeof window !== 'undefined' && window.Adivery?.showRewarded) {
      return window.Adivery.showRewarded(placementId);
    }
    return Promise.resolve({ rewardGranted: false, error: 'NOT_INITIALIZED' });
  },
  isLoaded(placementId = null) {
    if (typeof window !== 'undefined' && window.Adivery?.isLoaded) {
      return window.Adivery.isLoaded(placementId);
    }
    return false;
  },
  on(callback) {
    if (typeof window === 'undefined') return () => {};
    const handler = (e) => callback(e.detail);
    window.addEventListener('adivery:event', handler);
    return () => window.removeEventListener('adivery:event', handler);
  }
};

export default {
  CafeBazaar,
  Adivery
};
