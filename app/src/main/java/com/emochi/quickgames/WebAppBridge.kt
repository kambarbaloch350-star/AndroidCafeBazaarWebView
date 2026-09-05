package com.emochi.quickgames

import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import org.json.JSONObject
import java.lang.ref.WeakReference

class WebAppBridge(
    activity: ComponentActivity,
    webView: WebView,
    private val billingManager: CafeBazaarBillingManager,
    private val adiveryManager: AdiveryManager
) : CafeBazaarBillingManager.BillingEventListener, AdiveryManager.AdEventListener {

    private val activityRef = WeakReference(activity)
    private val webViewRef = WeakReference(webView)

    init {
        billingManager.setEventListener(this)
        adiveryManager.setEventListener(this)
    }

    @JavascriptInterface
    fun isNativeApp(): Boolean = true

    @JavascriptInterface
    fun isProduction(): Boolean = true

    @JavascriptInterface
    fun getPackageName(): String = "com.emochi.quickgames"

    @JavascriptInterface
    fun isAvailable(): Boolean = billingManager.isBillingAvailable()

    @JavascriptInterface
    fun buyProduct(productId: String) = buyProductWithPayload(productId, null)

    @JavascriptInterface
    fun buyProductWithPayload(productId: String, payload: String?) {
        activityRef.get()?.runOnUiThread {
            billingManager.purchase(productId, payload)
        }
    }

    @JavascriptInterface
    fun consumePurchase(purchaseToken: String) {
        activityRef.get()?.runOnUiThread {
            billingManager.consumePurchase(purchaseToken)
        }
    }

    @JavascriptInterface
    fun showBanner(): Boolean {
        val act = activityRef.get()
        if (act is MainActivity) {
            act.runOnUiThread { act.showBannerAd() }
            return true
        }
        return false
    }

    @JavascriptInterface
    fun hideBanner(): Boolean {
        val act = activityRef.get()
        if (act is MainActivity) {
            act.runOnUiThread { act.hideBannerAd() }
            return true
        }
        return false
    }

    @JavascriptInterface
    fun showInterstitial(placementId: String? = null): Boolean {
        return adiveryManager.showInterstitial(placementId)
    }

    @JavascriptInterface
    fun showRewarded(placementId: String? = null): Boolean {
        return adiveryManager.showRewarded(placementId)
    }

    override fun onPurchaseResult(result: PurchaseResult) {
        dispatchJs("window.CafeBazaarBridge && window.CafeBazaarBridge.onPurchaseResult(${result.toJson()});")
    }

    override fun onConsumeResult(result: ConsumeResult) {
        dispatchJs("window.CafeBazaarBridge && window.CafeBazaarBridge.onConsumeResult(${result.toJson()});")
    }

    override fun onConnectionStatusChanged(result: ConnectionResult) {
        dispatchJs("window.CafeBazaarBridge && window.CafeBazaarBridge.onConnectionResult(${result.toJson()});")
    }

    override fun onPurchasesQueryResult(result: QueryPurchasesResult) {
        dispatchJs("window.CafeBazaarBridge && window.CafeBazaarBridge.onPurchasesQueryResult(${result.toJson()});")
    }

    override fun onAdEvent(type: String, data: JSONObject) {
        val payload = JSONObject().apply {
            put("type", type)
            put("data", data)
        }
        dispatchJs("window.AdiveryBridge && window.AdiveryBridge.onAdEvent($payload);")
    }

    private fun dispatchJs(script: String) {
        webViewRef.get()?.post {
            webViewRef.get()?.evaluateJavascript(script, null)
        }
    }

    fun cleanUp() {
        webViewRef.clear()
        activityRef.clear()
    }
}