package com.emochi.quickgames

import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * Universal JavaScript Bridge interface exposed to WebView as window.AndroidBridge.
 * Exposes native CafeBazaar In-App Billing and Adivery Advertising functionalities.
 */
class WebAppBridge(
    activity: ComponentActivity,
    webView: WebView,
    private val billingManager: CafeBazaarBillingManager,
    private val adiveryManager: AdiveryManager
) : CafeBazaarBillingManager.BillingEventListener, AdiveryManager.AdEventListener {

    companion object {
        const val TAG = "WebAppBridge"
        const val JS_INTERFACE_NAME = "AndroidBridge"
    }

    private val activityRef = WeakReference(activity)
    private val webViewRef = WeakReference(webView)

    init {
        billingManager.setEventListener(this)
        adiveryManager.setEventListener(this)
    }

    // =========================================================================
    // System & Environment Info
    // =========================================================================
    @JavascriptInterface
    fun isNativeApp(): Boolean = true

    @JavascriptInterface
    fun isProduction(): Boolean = true

    @JavascriptInterface
    fun getPackageName(): String = "com.emochi.quickgames"

    // =========================================================================
    // CAFE BAZAAR IN-APP BILLING METHODS
    // =========================================================================
    @JavascriptInterface
    fun isAvailable(): Boolean {
        return billingManager.isBillingAvailable()
    }

    @JavascriptInterface
    fun buyProduct(productId: String) {
        buyProductWithPayload(productId, null)
    }

    @JavascriptInterface
    fun buyProductWithPayload(productId: String, payload: String?) {
        val activity = activityRef.get() ?: return
        activity.runOnUiThread {
            billingManager.purchase(productId, payload)
        }
    }

    @JavascriptInterface
    fun consumePurchase(purchaseToken: String) {
        val activity = activityRef.get() ?: return
        activity.runOnUiThread {
            billingManager.consumePurchase(purchaseToken)
        }
    }

    @JavascriptInterface
    fun getPurchases() {
        val activity = activityRef.get() ?: return
        activity.runOnUiThread {
            billingManager.queryPurchases()
        }
    }

    @JavascriptInterface
    fun connectBilling() {
        val activity = activityRef.get() ?: return
        activity.runOnUiThread {
            billingManager.startConnection()
        }
    }

    // =========================================================================
    // ADIVERY ADVERTISING METHODS (Zero-arg & Single-arg Overloads for WebView)
    // =========================================================================
    @JavascriptInterface
    fun isAdiveryAvailable(): Boolean = true

    @JavascriptInterface
    fun showBanner(): Boolean {
        val activity = activityRef.get()
        if (activity is MainActivity) {
            activity.runOnUiThread {
                activity.showBannerAd()
            }
            return true
        }
        return false
    }


    @JavascriptInterface
    fun showBannerAt(x: Int, y: Int, width: Int, height: Int, cssScale: Float): Boolean {
        val activity = activityRef.get()
        if (activity is MainActivity) {
            activity.showBannerAdAt(x, y, width, height, cssScale, true)
            return true
        }
        return false
    }

    @JavascriptInterface
    fun hideBanner(): Boolean {
        val activity = activityRef.get()
        if (activity is MainActivity) {
            activity.runOnUiThread {
                activity.hideBannerAd()
            }
            return true
        }
        return false
    }

    @JavascriptInterface
    fun showInterstitial(): Boolean {
        return showInterstitial(null)
    }

    @JavascriptInterface
    fun showInterstitial(placementId: String?): Boolean {
        val activity = activityRef.get() ?: return false
        val target = if (!placementId.isNullOrBlank()) placementId else adiveryManager.interstitialPlacementId
        val loaded = adiveryManager.isAdLoaded(target)
        activity.runOnUiThread {
            adiveryManager.showInterstitial(target)
        }
        return loaded
    }

    @JavascriptInterface
    fun showRewarded(): Boolean {
        return showRewarded(null)
    }

    @JavascriptInterface
    fun showRewarded(placementId: String?): Boolean {
        val activity = activityRef.get() ?: return false
        val target = if (!placementId.isNullOrBlank()) placementId else adiveryManager.rewardedPlacementId
        activity.runOnUiThread {
            adiveryManager.showRewarded(target)
        }
        // The manager may queue the request while the rewarded ad loads.
        // Returning true keeps the JS promise alive until the native event arrives.
        return true
    }

    @JavascriptInterface
    fun isAdLoaded(): Boolean {
        return isAdLoaded(null)
    }

    @JavascriptInterface
    fun isAdLoaded(placementId: String?): Boolean {
        return adiveryManager.isAdLoaded(placementId)
    }

    @JavascriptInterface
    fun isInterstitialLoaded(): Boolean {
        return adiveryManager.isAdLoaded(adiveryManager.interstitialPlacementId)
    }

    @JavascriptInterface
    fun isRewardedLoaded(): Boolean {
        return adiveryManager.isAdLoaded(adiveryManager.rewardedPlacementId)
    }

    @JavascriptInterface
    fun prepareAds() {
        val activity = activityRef.get() ?: return
        activity.runOnUiThread {
            adiveryManager.prepareAds()
        }
    }

    // =========================================================================
    // Callbacks from BillingManager & AdiveryManager -> Dispatched to Web Layer
    // =========================================================================
    override fun onConnectionStatusChanged(result: ConnectionResult) {
        val jsonString = result.toJson().toString()
        dispatchJsEvent("""
            if (window.CafeBazaarBridge && typeof window.CafeBazaarBridge.onConnectionResult === 'function') {
                window.CafeBazaarBridge.onConnectionResult($jsonString);
            }
        """.trimIndent())
    }

    override fun onPurchaseResult(result: PurchaseResult) {
        val jsonString = result.toJson().toString()
        dispatchJsEvent("""
            if (window.CafeBazaarBridge && typeof window.CafeBazaarBridge.onPurchaseResult === 'function') {
                window.CafeBazaarBridge.onPurchaseResult($jsonString);
            }
        """.trimIndent())
    }

    override fun onConsumeResult(result: ConsumeResult) {
        val jsonString = result.toJson().toString()
        dispatchJsEvent("""
            if (window.CafeBazaarBridge && typeof window.CafeBazaarBridge.onConsumeResult === 'function') {
                window.CafeBazaarBridge.onConsumeResult($jsonString);
            }
        """.trimIndent())
    }

    override fun onPurchasesQueryResult(result: QueryPurchasesResult) {
        val jsonString = result.toJson().toString()
        dispatchJsEvent("""
            if (window.CafeBazaarBridge && typeof window.CafeBazaarBridge.onPurchasesQueryResult === 'function') {
                window.CafeBazaarBridge.onPurchasesQueryResult($jsonString);
            }
        """.trimIndent())
    }

    override fun onAdEvent(type: String, data: JSONObject) {
        val payload = JSONObject().apply {
            put("type", type)
            put("data", data)
        }
        val jsonString = payload.toString()
        dispatchJsEvent("""
            try {
                if (window.AdiveryBridge && typeof window.AdiveryBridge.onAdEvent === 'function') {
                    window.AdiveryBridge.onAdEvent($jsonString);
                }
                window.dispatchEvent(new CustomEvent('adivery:event', { detail: $jsonString }));
            } catch (e) {
                console.error('[Bridge] Error dispatching onAdEvent:', e);
            }
        """.trimIndent())
    }

    private fun dispatchJsEvent(script: String) {
        val webView = webViewRef.get() ?: return
        webView.post {
            try {
                webView.evaluateJavascript(script, null)
            } catch (e: Exception) {
            }
        }
    }

    fun cleanUp() {
        webViewRef.clear()
        activityRef.clear()
    }
}
