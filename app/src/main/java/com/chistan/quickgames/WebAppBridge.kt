package com.chistan.quickgames

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import android.util.Log
import android.view.Display
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.webkit.WebViewCompat
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * WebAppBridge
 * ============
 *
 * The single, narrow JavaScript surface exposed to the WebApp as
 * `window.AndroidBridge`.
 *
 * Everything returns a `String` (JSON) or a primitive so no exotic type ever
 * crosses the bridge, and every method is defensive: a misbehaving WebApp can
 * never crash the container.
 *
 * JavaScript namespaces (thin wrappers live in `assets/web/js/native-bridge.js`):
 *
 *  - `NativeAds.showInterstitial()`  → Tapsell interstitial
 *  - `NativeAds.showRewarded()`      → Tapsell rewarded video
 *  - `NativeAds.showNative()`        → Tapsell native ad in the native plate
 *  - `NativeAds.hideNative()`        → removes the native plate
 *  - `NativeApp.appReady()`          → WebApp announces it finished booting
 *  - `NativeApp.getStartupRoute()`   → deep-link route that opened the app
 *
 * No advertising or push identifier is ever exposed here; those stay in the
 * native layer (`TapsellConfig` / `PushfaSettings`).
 */
class WebAppBridge(
    activity: ComponentActivity,
    webView: WebView,
    private val billingManager: CafeBazaarBillingManager,
    private val tapsellManager: TapsellManager
) : CafeBazaarBillingManager.BillingEventListener, TapsellManager.AdEventListener {

    companion object {
        /** Loose but safe `local@domain.tld` check for the contact address. */
        private val EMAIL_ADDRESS = Regex("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$")
        private const val TAG = "WebAppBridge"

        /** `window.AndroidBridge` */
        const val JS_INTERFACE_NAME = "AndroidBridge"
    }

    /** Implemented by [MainActivity]. */
    interface HostListener {
        fun onWebAppReady()
        fun onWebAppError(message: String)
        fun onBridgeRequestBack()
        fun onBridgeRequestNativeAd(visible: Boolean, x: Int, y: Int, width: Int, height: Int)

        /** Opens the CafeBazaar page of this app so the user can rate it. */
        fun onBridgeRequestRating(): Boolean

        /** Opens the CafeBazaar page of this app (updates / comments). */
        fun onBridgeRequestStorePage(): Boolean

        /**
         * Opens the user's e-mail app with a message to [address]
         * (`ACTION_SENDTO` + `mailto:`). Runs on the main thread.
         */
        fun onBridgeRequestEmail(address: String, subject: String): Boolean

        /**
         * Permanent unlocks changed (`remove_ads` bought / restored). The
         * container uses this to keep its own ad policy in sync; the WebApp is
         * informed separately through `CafeBazaarBridge`.
         */
        fun onBridgeOwnedProductsChanged(owned: Set<String>)
    }

    private val activityRef = WeakReference(activity)
    private val webViewRef = WeakReference(webView)

    /** Native mirror of the WebApp's saved state – see [WebAppStateStore]. */
    private val stateStore = WebAppStateStore.get(activity.applicationContext)

    /**
     * URL of the document currently displayed by the WebView.
     *
     * `@JavascriptInterface` methods are invoked on the WebView's `JavaBridge`
     * thread, and **every** WebView getter must run on the main thread – reading
     * `webView.url` from the bridge thread throws
     * *"A WebView method was called on thread 'JavaBridge'"* and would disable
     * the whole bridge. The value is therefore cached here and refreshed by
     * [MainActivity] inside its `WebViewClient` callbacks (main thread).
     */
    @Volatile
    private var currentUrl: String? = null

    var hostListener: HostListener? = null

    /** Route that opened the app, delivered after `appReady()` when unconsumed. */
    @Volatile
    var pendingRouteForWebApp: String? = null

    /**
     * Static device capabilities, captured once on the main thread (the bridge
     * is created there) and exposed through `getInfo().device` so a heavy
     * WebApp can pick its quality tier before it allocates canvases, textures
     * or audio buffers.
     */
    private val deviceProfile: JSONObject = buildDeviceProfile(activity)

    /** Coarse device tier (`low` / `mid` / `high`) the container tunes rendering for. */
    val deviceTier: String get() = deviceProfile.optString("tier", "mid")

    init {
        billingManager.setEventListener(this)
        tapsellManager.setEventListener(this)
        DeepLinkBus.setConsumer { route -> deliverRoute(route) }
    }

    // =====================================================================
    // Environment
    // =====================================================================

    @JavascriptInterface
    fun isNativeApp(): Boolean = true

    @JavascriptInterface
    fun isProduction(): Boolean = !BuildConfig.DEBUG

    @JavascriptInterface
    fun getPackageName(): String = BuildConfig.APPLICATION_ID

    /** JSON blob with container metadata – never contains ad/push identifiers. */
    @JavascriptInterface
    fun getInfo(): String = safe("{}") {
        val context: Context? = activityRef.get()
        JSONObject().apply {
            put("platform", "android")
            put("sdkInt", Build.VERSION.SDK_INT)
            put("appId", BuildConfig.APPLICATION_ID)
            put("appVersion", BuildConfig.VERSION_NAME)
            put("versionCode", BuildConfig.VERSION_CODE)
            put("debug", BuildConfig.DEBUG)
            put("serverPort", WebAppServerController.current()?.port ?: -1)
            put("stableOrigin", WebAppServerController.current()?.isOnStablePort() == true)
            put("stateMirror", true)
            put("pushEnabled", context != null && PushfaManager.hasNotificationPermission(context))
            put("pushToken", PushfaManager.isPushRegistered())
            put("adsReady", tapsellManager.isInitialized)
            put("removeAdsOwned", billingManager.isRemoveAdsOwned())
            put("ownedProducts", JSONObject.wrap(billingManager.ownedNonConsumables()))
            put("device", deviceProfile)
            put("deviceTier", deviceProfile.optString("tier", "mid"))
        }.toString()
    }

    /** JSON blob describing the device class (also available as `getInfo().device`). */
    @JavascriptInterface
    fun getDeviceProfile(): String = safe("{}") { deviceProfile.toString() }

    /**
     * Collects the numbers a game needs to choose a quality preset. Every value
     * is best-effort; a failure leaves the key out instead of failing the call.
     */
    private fun buildDeviceProfile(activity: ComponentActivity): JSONObject {
        val profile = JSONObject()
        var totalRamMb = -1L
        var memoryClassMb = -1
        var lowRam = false
        runCatching {
            val am = activity.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
            if (am != null) {
                lowRam = am.isLowRamDevice
                memoryClassMb = am.memoryClass
                val info = ActivityManager.MemoryInfo()
                am.getMemoryInfo(info)
                totalRamMb = info.totalMem / (1024L * 1024L)
                profile.put("lowRam", lowRam)
                profile.put("memoryClassMb", memoryClassMb)
                profile.put("largeMemoryClassMb", am.largeMemoryClass)
                profile.put("totalRamMb", totalRamMb)
            }
        }
        val cores = runCatching { Runtime.getRuntime().availableProcessors() }.getOrDefault(1)
        profile.put("cpuCores", cores)
        runCatching {
            profile.put("refreshRate", (currentDisplay(activity)?.refreshRate ?: 60f).toDouble())
        }
        runCatching {
            val metrics = activity.resources.displayMetrics
            profile.put("densityDpi", metrics.densityDpi)
            profile.put("density", metrics.density.toDouble())
            profile.put("screenWidthPx", metrics.widthPixels)
            profile.put("screenHeightPx", metrics.heightPixels)
        }
        runCatching {
            val pkg = WebViewCompat.getCurrentWebViewPackage(activity)
            profile.put("webViewPackage", pkg?.packageName ?: "")
            profile.put("webViewVersion", pkg?.versionName ?: "")
        }
        profile.put("sdkInt", Build.VERSION.SDK_INT)
        profile.put("manufacturer", Build.MANUFACTURER.orEmpty())
        profile.put("model", Build.MODEL.orEmpty())

        // Coarse tier: what a heavy Canvas / WebGL game should assume by default.
        val tier = when {
            lowRam || (memoryClassMb in 1..128) || (totalRamMb in 1L..2559L) -> "low"
            (totalRamMb >= 5632L && cores >= 8) -> "high"
            else -> "mid"
        }
        profile.put("tier", tier)
        // Rendering at full device pixel ratio is the usual reason a heavy
        // game stutters on a low/mid phone; this is the ratio it should use.
        val suggestedDpr = when (tier) {
            "low" -> 1.0
            "mid" -> 1.5
            else -> 2.0
        }
        profile.put("suggestedPixelRatio", suggestedDpr)
        return profile
    }

    @Suppress("DEPRECATION")
    private fun currentDisplay(activity: ComponentActivity): Display? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) activity.display
        else activity.windowManager.defaultDisplay

    // =====================================================================
    // Readiness handshake
    // =====================================================================

    /**
     * Called by `index.html` once the WebApp has completely initialized:
     * framework mounted, stores hydrated, assets and fonts ready.
     *
     * The native loading screen stays visible until this call arrives – there is
     * no arbitrary delay anywhere in the boot path.
     */
    @JavascriptInterface
    fun appReady(): Boolean = safe(false) {
        Log.i(TAG, "WebApp reported readiness")
        DeepLinkBus.markWebAppReady()
        post { hostListener?.onWebAppReady() }
        true
    }

    /** Alias for WebApps that prefer a `loaded()` naming convention. */
    @JavascriptInterface
    fun appLoaded(): Boolean = appReady()

    /** Lets the WebApp report a fatal boot error to the container. */
    @JavascriptInterface
    fun reportError(message: String?) {
        val text = message?.take(500) ?: "UNKNOWN"
        Log.w(TAG, "WebApp reported a boot error: $text")
        post { hostListener?.onWebAppError(text) }
    }

    // =====================================================================
    // Navigation helpers
    // =====================================================================

    /** Requests native back navigation (WebView history first, then the app). */
    @JavascriptInterface
    fun navigateBack(): Boolean = safe(false) {
        post { hostListener?.onBridgeRequestBack() }
        true
    }

    /**
     * Deep-link route that opened the app, if any. The WebApp may consume it
     * during boot; otherwise the container delivers it after [appReady].
     */
    @JavascriptInterface
    fun getStartupRoute(): String = safe("") { pendingRouteForWebApp ?: "" }

    /** Marks the startup route as consumed so it is not delivered twice. */
    @JavascriptInterface
    fun consumeStartupRoute() {
        pendingRouteForWebApp = null
    }

    // =====================================================================
    // Store interactions (rating / app page – CafeBazaar intent)
    // =====================================================================

    /**
     * Opens the CafeBazaar *rating* dialog for this app (Bazaar intent
     * `ACTION_EDIT` + `bazaar://details?id=<package>`).
     *
     * @return true when an activity able to handle the intent was found.
     */
    @JavascriptInterface
    fun openRatingPage(): Boolean = requestStore(true)

    /** Opens the CafeBazaar app page (updates, comments, install). */
    @JavascriptInterface
    fun openStorePage(): Boolean = requestStore(false)

    /** Legacy alias used by older WebApp builds. */
    @JavascriptInterface
    fun rateApp(): Boolean = openRatingPage()

    /**
     * Opens the user's e-mail app addressed to [address] (the game's
     * "رابطہ کنگ" / contact button). The message is composed natively –
     * `ACTION_SENDTO` with a `mailto:` URI, Gmail preferred, then any mail
     * app – because a `mailto:` navigation inside the WebView would only work
     * when the system resolves it and would leave the page otherwise.
     *
     * @return true when the request was accepted (an e-mail app is opened
     *         asynchronously on the main thread); false for an invalid address
     *         or when no host is attached.
     */
    @JavascriptInterface
    fun openEmail(address: String?): Boolean = composeEmail(address, "")

    // ---------------------------------------------------------------------
    // Saved-state mirror (progress must survive force stop / process death)
    // ---------------------------------------------------------------------

    /**
     * Mirrors the WebApp's saved-state blob [value] under [key] natively.
     * [savedAt] is the WebApp's millisecond stamp as a string. Cheap and
     * synchronous for the caller: the value is queued and written on a
     * background thread (see [WebAppStateStore]).
     */
    @JavascriptInterface
    fun saveState(key: String?, value: String?, savedAt: String?): Boolean =
        safe(false) { stateStore.save(key, value, savedAt) }

    /** `{"key","value","savedAt"}` JSON of the mirrored blob, or null. */
    @JavascriptInterface
    fun loadState(key: String?): String? = safe<String?>(null) { stateStore.load(key) }

    /** Drops the mirrored blob for [key]. */
    @JavascriptInterface
    fun clearState(key: String?): Boolean = safe(false) { stateStore.clear(key) }

    /** Same as [openEmail] with a pre-filled subject. */
    @JavascriptInterface
    fun composeEmail(address: String?, subject: String?): Boolean = safe(false) {
        val to = address?.trim().orEmpty()
        if (!EMAIL_ADDRESS.matches(to)) return@safe false
        val listener = hostListener ?: return@safe false
        val target: Any? = activityRef.get() ?: webViewRef.get() ?: return@safe false
        val line = subject?.trim().orEmpty().take(200)
        val open = { listener.onBridgeRequestEmail(to, line) }
        when (target) {
            is ComponentActivity -> target.runOnUiThread { runCatching { open() } }
            is WebView -> target.post { runCatching { open() } }
            else -> return@safe false
        }
        true
    }

    private fun requestStore(rating: Boolean): Boolean {
        val listener = hostListener ?: return false
        val target: Any? = activityRef.get() ?: webViewRef.get() ?: return false
        val open = { if (rating) listener.onBridgeRequestRating() else listener.onBridgeRequestStorePage() }
        when (target) {
            is ComponentActivity -> target.runOnUiThread { runCatching { open() } }
            is WebView -> target.post { runCatching { open() } }
            else -> return false
        }
        return true
    }

    // =====================================================================
    // Advertising (Tapsell – all identifiers stay native)
    // =====================================================================

    @JavascriptInterface
    fun isAdsAvailable(): Boolean = tapsellManager.isInitialized

    /** @return true when the request was accepted (the ad may still be loading). */
    @JavascriptInterface
    fun showInterstitial(): Boolean = safe(false) {
        if (!isTrustedOrigin()) return@safe false
        post { tapsellManager.showInterstitial() }
        true
    }

    @JavascriptInterface
    fun showRewarded(): Boolean = safe(false) {
        if (!isTrustedOrigin()) return@safe false
        post { tapsellManager.showRewarded() }
        true
    }

    @JavascriptInterface
    fun showNative(): Boolean = safe(false) {
        if (!isTrustedOrigin()) return@safe false
        post { hostListener?.onBridgeRequestNativeAd(true, 0, 0, 0, 0) }
        true
    }

    @JavascriptInterface
    fun hideNative(): Boolean = safe(false) {
        post { hostListener?.onBridgeRequestNativeAd(false, 0, 0, 0, 0) }
        true
    }

    /**
     * Positions the native ad plate. Coordinates are CSS pixels inside the
     * WebApp viewport; the container converts them to device pixels.
     */
    @JavascriptInterface
    fun showNativeAt(x: Int, y: Int, width: Int, height: Int): Boolean = safe(false) {
        if (!isTrustedOrigin()) return@safe false
        post { hostListener?.onBridgeRequestNativeAd(true, x, y, width, height) }
        true
    }

    /**
     * Readiness probe for a logical ad type.
     * @param type `interstitial` | `rewarded` | `native`
     */
    @JavascriptInterface
    fun isAdReady(type: String?): Boolean = safe(false) {
        when (type?.lowercase()) {
            "interstitial" -> tapsellManager.isInitialized && TapsellConfig.hasInterstitial
            "rewarded", "rewarded_video" -> tapsellManager.isInitialized && TapsellConfig.hasRewarded
            "native", "native_banner" -> tapsellManager.isInitialized && TapsellConfig.hasNative
            else -> false
        }
    }

    /** Re-arms the ad pipeline (`NativeAds.prepare()`). */
    @JavascriptInterface
    fun prepareAds() {
        post { tapsellManager.preloadAll() }
    }

    // =====================================================================
    // CafeBazaar In-App Billing
    // =====================================================================

    @JavascriptInterface
    fun isAvailable(): Boolean = safe(false) { billingManager.isBillingAvailable() }

    /**
     * True when the permanent `remove_ads` unlock is owned. Interstitials are
     * suppressed natively in that case, so the WebApp only needs this to hide
     * the "remove ads" offer.
     */
    @JavascriptInterface
    fun isRemoveAdsOwned(): Boolean = safe(false) { billingManager.isRemoveAdsOwned() }

    @JavascriptInterface
    fun isBillingAvailable(): Boolean = isAvailable()

    @JavascriptInterface
    fun buyProduct(productId: String?) {
        buyProductWithPayload(productId, null)
    }

    @JavascriptInterface
    fun buyProductWithPayload(productId: String?, payload: String?) {
        val id = productId ?: return
        if (!isTrustedOrigin()) return
        post { billingManager.purchase(id, payload) }
    }

    @JavascriptInterface
    fun consumePurchase(purchaseToken: String?) {
        val token = purchaseToken ?: return
        if (!isTrustedOrigin()) return
        post { billingManager.consumePurchase(token) }
    }

    @JavascriptInterface
    fun getPurchases() {
        if (!isTrustedOrigin()) return
        post { billingManager.queryPurchases() }
    }

    @JavascriptInterface
    fun connectBilling() {
        post { billingManager.startConnection() }
    }

    // =====================================================================
    // Native -> Web events
    // =====================================================================

    override fun onConnectionStatusChanged(result: ConnectionResult) {
        dispatch("CafeBazaarBridge", "onConnectionResult", result.toJson().toString())
    }

    override fun onOwnedProductsChanged(owned: Set<String>) {
        // Keep the native ad policy in sync with what the user actually owns.
        tapsellManager.interstitialsSuppressed = owned.contains(CafeBazaarConfig.SKU_REMOVE_ADS)
        post { hostListener?.onBridgeOwnedProductsChanged(owned) }
        val payload = JSONObject().apply {
            put("removeAdsOwned", owned.contains(CafeBazaarConfig.SKU_REMOVE_ADS))
            put("owned", JSONObject.wrap(owned))
        }.toString()
        dispatch("CafeBazaarBridge", "onOwnedProductsChanged", payload, "nativeapp:ownedproducts")
    }

    override fun onPurchaseResult(result: PurchaseResult) {
        dispatch("CafeBazaarBridge", "onPurchaseResult", result.toJson().toString())
    }

    override fun onConsumeResult(result: ConsumeResult) {
        dispatch("CafeBazaarBridge", "onConsumeResult", result.toJson().toString())
    }

    override fun onPurchasesQueryResult(result: QueryPurchasesResult) {
        dispatch("CafeBazaarBridge", "onPurchasesQueryResult", result.toJson().toString())
    }

    override fun onAdEvent(type: String, data: JSONObject) {
        val envelope = JSONObject().apply {
            put("type", type)
            put("data", data)
        }
        dispatch("NativeAds", "onEvent", envelope.toString(), "nativeads:event")
    }

    /** Tells the WebApp the container finished booting the page. */
    fun notifyContainerReady(route: String?) {
        val payload = JSONObject().apply {
            put("route", route ?: "")
            put("pushSupported", true)
        }
        dispatch("NativeApp", "onEvent", payload.toString(), "nativeapp:ready", "container:ready")
    }

    // =====================================================================
    // Internals
    // =====================================================================

    private fun deliverRoute(route: String): Boolean {
        val webView = webViewRef.get() ?: return false
        val escaped = JSONObject.quote(route)
        val script = """
            (function () {
              try {
                var evt = { type: 'deep_link', data: { route: $escaped } };
                if (window.NativeApp && typeof window.NativeApp.onEvent === 'function') {
                  window.NativeApp.onEvent(evt);
                }
                if (window.DeepLink && typeof window.DeepLink.handle === 'function') {
                  window.DeepLink.handle($escaped);
                }
                window.dispatchEvent(new CustomEvent('nativeapp:deeplink', { detail: { route: $escaped } }));
                window.dispatchEvent(new CustomEvent('nativeapp:event', { detail: evt }));
              } catch (e) {
                if (window.console && console.warn) console.warn('[NativeApp] deep link dispatch failed', e);
              }
            })();
        """.trimIndent()
        evaluate(script)
        pendingRouteForWebApp = null
        return true
    }

    private fun dispatch(
        namespace: String,
        method: String,
        json: String,
        vararg extraEventNames: String
    ) {
        val extras = extraEventNames.joinToString(separator = "") {
            "window.dispatchEvent(new CustomEvent('$it', { detail: $json }));"
        }
        val script = """
            (function () {
              try {
                if (window.$namespace && typeof window.$namespace.$method === 'function') {
                  window.$namespace.$method($json);
                }
                $extras
              } catch (e) {
                if (window.console && console.warn) console.warn('[$namespace] dispatch failed', e);
              }
            })();
        """.trimIndent()
        evaluate(script)
    }

    private fun post(block: () -> Unit) {
        val target: Any? = activityRef.get() ?: webViewRef.get() ?: return
        when (target) {
            is ComponentActivity -> target.runOnUiThread { runCatching(block) }
            is WebView -> target.post { runCatching(block) }
        }
    }

    private fun evaluate(script: String) {
        // Always dispatched to the main thread: `evaluateJavascript` is a
        // WebView method and must not be called from the JavaBridge thread.
        post {
            val webView = webViewRef.get() ?: return@post
            runCatching { webView.evaluateJavascript(script, null) }
                .onFailure { Log.w(TAG, "evaluateJavascript failed: ${it.message}") }
        }
    }

    /**
     * Hardening: bridge calls are only honoured while the WebView displays a
     * document served by our own loopback server. Third-party iframes embedded
     * by a WebApp also receive `window.AndroidBridge`, and this keeps them from
     * driving native advertising/billing APIs.
     */
    private fun isTrustedOrigin(): Boolean {
        val url = currentUrl ?: return true // only the container's own document can call this
        val trusted = url.startsWith("http://127.0.0.1:") ||
                url.startsWith("http://localhost:") ||
                url.startsWith("http://[::1]:")
        if (!trusted) Log.w(TAG, "Bridge call rejected from untrusted origin: $url")
        return trusted
    }

    /**
     * Called by [MainActivity] from `WebViewClient` callbacks (main thread) so
     * the trust check never has to touch the WebView from the bridge thread.
     */
    fun onPageUrlChanged(url: String?) {
        currentUrl = url
    }

    private inline fun <T> safe(fallback: T, block: () -> T): T =
        try {
            block()
        } catch (e: Throwable) {
            Log.w(TAG, "Bridge method failed: ${e.message}")
            fallback
        }

    fun cleanUp() {
        DeepLinkBus.setConsumer(null)
        hostListener = null
        billingManager.setEventListener(null)
        tapsellManager.setEventListener(null)
    }
}
