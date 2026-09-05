/**
 * bazaar-bridge.esm.js
 * ES Module wrapper for games and web apps built with Node.js, Vite, Webpack, React, Vue, Svelte, or Phaser.
 * 
 * Usage in your Node.js game:
 * import { CafeBazaar } from './bazaar-bridge.esm.js';
 * 
 * async function buyCoins() {
 *   try {
 *     const purchase = await CafeBazaar.purchase('coins_100');
 *     console.log('Purchase successful:', purchase.purchaseToken);
 *     await CafeBazaar.consume(purchase.purchaseToken);
 *     console.log('100 Coins credited!');
 *   } catch (error) {
 *     console.error('Purchase failed:', error.message);
 *   }
 * }
 */

export const CafeBazaar = {
  /**
   * Check if running inside the Android CafeBazaar WebView container
   */
  isNativeAvailable() {
    return typeof window !== 'undefined' && typeof window.AndroidBridge !== 'undefined';
  },

  /**
   * Check if CafeBazaar billing service is currently connected
   */
  isBillingConnected() {
    return this.isNativeAvailable() && Boolean(window.AndroidBridge.isAvailable?.());
  },

  /**
   * Connect or reconnect to CafeBazaar billing service
   */
  connect() {
    if (this.isNativeAvailable()) {
      window.AndroidBridge.connectBilling();
    }
  },

  /**
   * Purchase an in-app product SKU (e.g. 'coins_100')
   * @param {string} productId
   * @param {string} [payload]
   * @returns {Promise<{ success: boolean, productId: string, purchaseToken: string, orderId?: string }>}
   */
  purchase(productId, payload = null) {
    if (typeof window !== 'undefined' && window.CafeBazaar?.purchase) {
      return window.CafeBazaar.purchase(productId, payload);
    }
    return Promise.reject(new Error('CafeBazaar billing bridge is not initialized'));
  },

  /**
   * Consume a purchase token
   * @param {string} purchaseToken
   * @returns {Promise<{ success: boolean, purchaseToken: string }>}
   */
  consume(purchaseToken) {
    if (typeof window !== 'undefined' && (window.CafeBazaar?.consumePurchase || window.CafeBazaar?.consume)) {
      const fn = window.CafeBazaar.consumePurchase || window.CafeBazaar.consume;
      return fn(purchaseToken);
    }
    return Promise.reject(new Error('CafeBazaar billing bridge is not initialized'));
  },

  /**
   * Query active unconsumed purchases
   * @returns {Promise<Array<{ productId: string, purchaseToken: string, purchaseTime: number }>>}
   */
  queryPurchases() {
    if (typeof window !== 'undefined' && window.CafeBazaar?.queryPurchases) {
      return window.CafeBazaar.queryPurchases();
    }
    return Promise.reject(new Error('CafeBazaar billing bridge is not initialized'));
  },

  /**
   * Show native Android Toast message
   * @param {string} message
   */
  toast(message) {
    if (this.isNativeAvailable()) {
      window.AndroidBridge.showToast(message);
    }
  },

  /**
   * Exit the native Android application
   */
  exit() {
    if (this.isNativeAvailable()) {
      window.AndroidBridge.exitApp();
    }
  },

  /**
   * Listen for CafeBazaar events
   * @param {'connection' | 'purchase' | 'consume' | 'query' | 'ready'} event
   * @param {(detail: any) => void} callback
   * @returns {() => void} cleanup unsubscribe function
   */
  on(event, callback) {
    if (typeof window === 'undefined') return () => {};
    const eventName = event === 'ready' ? 'CafeBazaarBridgeReady' : `cafebazaar:${event}`;
    const handler = (e) => callback(e.detail);
    window.addEventListener(eventName, handler);
    return () => window.removeEventListener(eventName, handler);
  }
};

export default CafeBazaar;
