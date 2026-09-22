package com.emochi.quickgames

import android.app.Activity
import android.util.Log
import android.view.ViewGroup
import androidx.annotation.MainThread
import ir.tapsell.plus.AdHolder
import ir.tapsell.plus.AdRequestCallback
import ir.tapsell.plus.AdShowListener
import ir.tapsell.plus.TapsellPlus
import ir.tapsell.plus.TapsellPlusInitListener
import ir.tapsell.plus.model.AdNetworkError
import ir.tapsell.plus.model.AdNetworks
import ir.tapsell.plus.model.TapsellPlusAdModel
import ir.tapsell.plus.model.TapsellPlusErrorModel
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicBoolean

/**
 * TapsellManager
 * ==============
 *
 * Native controller around the official **Tapsell Plus** Android SDK
 * (interstitial, rewarded video and native ads).
 *
 * Design rules
 * ------------
 *  1. **Never block, never crash the WebApp.** Every SDK call is wrapped in
 *     [runCatching] and every failure is converted into an `ad_error` event
 *     that JavaScript can simply ignore.
 *  2. **Event driven.** Requests are queued (see [pendingInterstitial] /
 *     [pendingRewarded]) and satisfied as soon as the SDK reports a response –
 *     the WebApp never has to poll or wait on a blocking call.
 *  3. **No identifiers leak into JavaScript.** Zone IDs, response IDs and the
 *     Tapsell app key live exclusively here; the bridge only exposes logical
 *     ad types.
 *  4. **Warm-up once.** Ads are preloaded after SDK initialization and
 *     re-preloaded after each show, keeping the next request instant.
 */
class TapsellManager(private val activity: Activity) {

    companion object {
        private const val TAG = "TapsellManager"

        /** Hard timeout for a JS-originated request waiting on an ad. */
        private const val REQUEST_TIMEOUT_MS = 18_000L
    }

    /** Callbacks consumed by [WebAppBridge] and forwarded to JavaScript. */
    interface AdEventListener {
        fun onAdEvent(type: String, data: JSONObject)
    }

    private val activityRef = WeakReference(activity)
    private var listener: AdEventListener? = null

    private val initializing = AtomicBoolean(false)

    @Volatile
    var isInitialized: Boolean = false
        private set

    @Volatile
    private var initializationFailed: Boolean = false

    /** Ready-to-show response IDs produced by the Tapsell SDK. */
    @Volatile
    private var interstitialResponseId: String? = null

    @Volatile
    private var rewardedResponseId: String? = null

    @Volatile
    private var nativeResponseId: String? = null

    private var nativeAdHolder: AdHolder? = null

    /** Whether a request is currently in flight for each ad type. */
    private val interstitialLoading = AtomicBoolean(false)
    private val rewardedLoading = AtomicBoolean(false)
    private val nativeLoading = AtomicBoolean(false)

    /** True while the SDK is presenting a full screen ad. */
    @Volatile
    var isShowingAd: Boolean = false
        private set

    /** Serializes "ready immediate" events injected into the WebApp. */
    @Volatile
    private var interstitialShownCount: Int = 0

    @Volatile
    private var rewardedShownCount: Int = 0

    /** Views registered as native ad slots, keyed by slot name. */
    private val nativeSlots = HashMap<String, ViewGroup>()

    /**
     * Set by the host when the user owns the permanent `remove_ads` unlock.
     * Interstitial requests are acknowledged but silently skipped, so the
     * WebApp never has to know *why* no ad appeared (and can never re-enable
     * them by accident). Rewarded videos stay available – they are opt-in.
     */
    @Volatile
    var interstitialsSuppressed: Boolean = false

    // ------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------

    fun setEventListener(listener: AdEventListener?) {
        this.listener = listener
    }

    /**
     * Initializes the Tapsell SDK and pre-warms every configured zone.
     * Idempotent – repeated calls are ignored.
     */
    @MainThread
    fun initialize() {
        if (isInitialized || initializationFailed) return
        if (!TapsellConfig.isConfigured) {
            initializationFailed = true
            Log.w(TAG, "Tapsell app key is not configured – ads stay disabled")
            dispatch("ad_error", payload(error = "NOT_CONFIGURED", adType = "sdk"))
            return
        }
        val activityInstance = activityRef.get()
        if (activityInstance == null) {
            initializationFailed = true
            return
        }
        if (!initializing.compareAndSet(false, true)) return

        runCatching {
            TapsellPlus.setDebugMode(if (TapsellConfig.isDebug) Log.DEBUG else Log.ERROR)
            TapsellPlus.initialize(activityInstance, TapsellConfig.APP_KEY,
                object : TapsellPlusInitListener {
                    override fun onInitializeSuccess(adNetworks: AdNetworks?) {
                        initializing.set(false)
                        isInitialized = true
                        Log.i(TAG, "Tapsell initialized (network=${adNetworks?.name})")
                        dispatch(
                            "ads_ready",
                            JSONObject().apply { put("network", adNetworks?.name ?: "TAPSELL") }
                        )
                        preloadAll()
                    }

                    override fun onInitializeFailed(
                        adNetworks: AdNetworks?,
                        adNetworkError: AdNetworkError?
                    ) {
                        initializing.set(false)
                        isInitialized = true // SDK is usable, the ad network is not.
                        Log.w(
                            TAG,
                            "Tapsell init failed: ${adNetworks?.name} ${adNetworkError?.errorMessage}"
                        )
                        dispatch(
                            "ad_error",
                            payload(
                                error = "INIT_FAILED",
                                adType = "sdk",
                                message = adNetworkError?.errorMessage
                            )
                        )
                    }
                })
        }.onFailure {
            initializing.set(false)
            initializationFailed = true
            Log.e(TAG, "Tapsell initialize threw", it)
            dispatch("ad_error", payload(error = "INIT_EXCEPTION", adType = "sdk", message = it.message))
        }
    }

    /** Preloads every configured zone (best effort, never throws). */
    fun preloadAll() {
        if (!isInitialized) return
        preloadInterstitial()
        preloadRewarded()
    }

    /**
     * Called from the SDK's preload callbacks. A request that arrived before
     * the ad was ready is replayed on the main thread so the WebApp promise is
     * always resolved (either with the ad or with an `ad_error` event).
     */
    private fun onAdReady(adType: String) {
        val activityInstance = activityRef.get() ?: return
        activityInstance.runOnUiThread {
            when (adType) {
                "interstitial" -> if (pendingInterstitial) {
                    pendingInterstitial = false
                    showInterstitial()
                }
                "rewarded" -> if (pendingRewarded) {
                    pendingRewarded = false
                    showRewarded()
                }
                "native" -> if (pendingNative) {
                    pendingNative = false
                    renderNative()
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // Interstitial
    // ------------------------------------------------------------------

    private fun preloadInterstitial() {
        val zone = TapsellConfig.ZONE_INTERSTITIAL
        if (zone.isBlank()) return
        if (interstitialResponseId != null) return
        val activityInstance = activityRef.get() ?: return
        if (!interstitialLoading.compareAndSet(false, true)) return

        runCatching {
            TapsellPlus.requestInterstitialAd(activityInstance, zone,
                object : AdRequestCallback() {
                    override fun response(adModel: TapsellPlusAdModel?) {
                        interstitialLoading.set(false)
                        interstitialResponseId = adModel?.responseId
                        dispatch("interstitial_loaded", payload(adType = "interstitial"))
                        onAdReady("interstitial")
                    }

                    override fun error(message: String) {
                        interstitialLoading.set(false)
                        interstitialResponseId = null
                        dispatch(
                            "ad_error",
                            payload(error = "INTERSTITIAL_REQUEST_FAILED", adType = "interstitial", message = message)
                        )
                    }
                })
        }.onFailure {
            interstitialLoading.set(false)
            dispatch("ad_error", payload(error = "INTERSTITIAL_REQUEST_EXCEPTION", adType = "interstitial", message = it.message))
        }
    }

    /**
     * Shows an interstitial ad. When the SDK has not produced a response yet,
     * the request is remembered and fulfilled as soon as it arrives
     * (see [fulfilPendingRequests]); the returned [Boolean] only states whether
     * the request was *accepted*.
     */
    @MainThread
    fun showInterstitial(): Boolean {
        if (interstitialsSuppressed) {
            dispatch(
                "interstitial_skipped",
                payload(adType = "interstitial").apply { put("reason", "REMOVE_ADS_OWNED") }
            )
            return true
        }
        val activityInstance = activityRef.get() ?: return false
        val zone = TapsellConfig.ZONE_INTERSTITIAL
        if (zone.isBlank()) {
            dispatch("ad_error", payload(error = "INTERSTITIAL_NOT_CONFIGURED", adType = "interstitial"))
            return false
        }
        if (!isInitialized) {
            pendingInterstitial = true
            initialize()
            dispatch("ad_request_queued", payload(adType = "interstitial"))
            return true
        }

        val responseId = interstitialResponseId
        if (responseId == null) {
            pendingInterstitial = true
            preloadInterstitial()
            dispatch("ad_request_queued", payload(adType = "interstitial", message = "loading"))
            return true
        }

        interstitialResponseId = null
        return runCatching {
            TapsellPlus.showInterstitialAd(activityInstance, responseId,
                object : AdShowListener() {
                    override fun onOpened(adModel: TapsellPlusAdModel?) {
                        isShowingAd = true
                        dispatch("interstitial_shown", payload(adType = "interstitial"))
                    }

                    override fun onClosed(adModel: TapsellPlusAdModel?) {
                        isShowingAd = false
                        interstitialShownCount++
                        dispatch(
                            "interstitial_closed",
                            payload(adType = "interstitial").apply {
                                put("shownCount", interstitialShownCount)
                            }
                        )
                        preloadInterstitial()
                    }

                    override fun onError(error: TapsellPlusErrorModel?) {
                        isShowingAd = false
                        dispatch(
                            "ad_error",
                            payload(
                                error = "INTERSTITIAL_SHOW_FAILED",
                                adType = "interstitial",
                                message = error?.toString()
                            )
                        )
                        preloadInterstitial()
                    }
                })
            true
        }.getOrElse {
            Log.e(TAG, "showInterstitialAd threw", it)
            dispatch("ad_error", payload(error = "INTERSTITIAL_SHOW_EXCEPTION", adType = "interstitial", message = it.message))
            preloadInterstitial()
            false
        }
    }

    // ------------------------------------------------------------------
    // Rewarded video
    // ------------------------------------------------------------------

    private fun preloadRewarded() {
        val zone = TapsellConfig.ZONE_REWARDED
        if (zone.isBlank()) return
        if (rewardedResponseId != null) return
        val activityInstance = activityRef.get() ?: return
        if (!rewardedLoading.compareAndSet(false, true)) return

        runCatching {
            TapsellPlus.requestRewardedVideoAd(activityInstance, zone,
                object : AdRequestCallback() {
                    override fun response(adModel: TapsellPlusAdModel?) {
                        rewardedLoading.set(false)
                        rewardedResponseId = adModel?.responseId
                        dispatch("rewarded_loaded", payload(adType = "rewarded"))
                        onAdReady("rewarded")
                    }

                    override fun error(message: String) {
                        rewardedLoading.set(false)
                        rewardedResponseId = null
                        dispatch(
                            "ad_error",
                            payload(error = "REWARDED_REQUEST_FAILED", adType = "rewarded", message = message)
                        )
                    }
                })
        }.onFailure {
            rewardedLoading.set(false)
            dispatch("ad_error", payload(error = "REWARDED_REQUEST_EXCEPTION", adType = "rewarded", message = it.message))
        }
    }

    @MainThread
    fun showRewarded(): Boolean {
        val activityInstance = activityRef.get() ?: return false
        val zone = TapsellConfig.ZONE_REWARDED
        if (zone.isBlank()) {
            dispatch("ad_error", payload(error = "REWARDED_NOT_CONFIGURED", adType = "rewarded"))
            return false
        }
        if (!isInitialized) {
            pendingRewarded = true
            initialize()
            dispatch("ad_request_queued", payload(adType = "rewarded"))
            return true
        }

        val responseId = rewardedResponseId
        if (responseId == null) {
            pendingRewarded = true
            preloadRewarded()
            dispatch("ad_request_queued", payload(adType = "rewarded", message = "loading"))
            return true
        }

        rewardedResponseId = null
        return runCatching {
            TapsellPlus.showRewardedVideoAd(activityInstance, responseId,
                object : AdShowListener() {
                    override fun onOpened(adModel: TapsellPlusAdModel?) {
                        isShowingAd = true
                        dispatch("rewarded_shown", payload(adType = "rewarded"))
                    }

                    override fun onRewarded(adModel: TapsellPlusAdModel?) {
                        // Grant the reward immediately – waiting for onClosed
                        // would lose it when the user leaves the ad early.
                        rewardedShownCount++
                        dispatch(
                            "rewarded_completed",
                            payload(adType = "rewarded").apply {
                                put("rewardGranted", true)
                                put("rewarded", true)
                                put("shownCount", rewardedShownCount)
                            }
                        )
                    }

                    override fun onClosed(adModel: TapsellPlusAdModel?) {
                        isShowingAd = false
                        dispatch(
                            "rewarded_closed",
                            payload(adType = "rewarded").apply {
                                put("rewardGranted", rewardedShownCount > 0)
                            }
                        )
                        rewardedShownCount = 0
                        preloadRewarded()
                    }

                    override fun onError(error: TapsellPlusErrorModel?) {
                        isShowingAd = false
                        dispatch(
                            "ad_error",
                            payload(error = "REWARDED_SHOW_FAILED", adType = "rewarded", message = error?.toString())
                        )
                        preloadRewarded()
                    }
                })
            true
        }.getOrElse {
            Log.e(TAG, "showRewardedVideoAd threw", it)
            dispatch("ad_error", payload(error = "REWARDED_SHOW_EXCEPTION", adType = "rewarded", message = it.message))
            preloadRewarded()
            false
        }
    }

    // ------------------------------------------------------------------
    // Native ads
    // ------------------------------------------------------------------

    /**
     * Registers the container the native ad should be rendered into. Called by
     * the Activity when the WebApp requests a native ad.
     */
    fun attachNativeContainer(container: ViewGroup) {
        val activityInstance = activityRef.get() ?: return
        runCatching {
            // The SDK inflates its own view hierarchy; using its layout keeps the
            // ad fully clickable and avoids missing-view crashes on SDK updates.
            nativeAdHolder = TapsellPlus.createAdHolder(
                activityInstance,
                container,
                ir.tapsell.plus.R.layout.native_banner
            )
        }.onFailure {
            Log.e(TAG, "createAdHolder failed", it)
            nativeAdHolder = null
        }
    }

    /**
     * Requests and renders a native ad into the attached container.
     *
     * @return true when the request was accepted (the ad may still be loading).
     */
    @MainThread
    fun showNative(): Boolean {
        val zone = TapsellConfig.ZONE_NATIVE
        if (zone.isBlank()) {
            dispatch("ad_error", payload(error = "NATIVE_NOT_CONFIGURED", adType = "native"))
            return false
        }
        if (nativeAdHolder == null) {
            dispatch("ad_error", payload(error = "NATIVE_NO_CONTAINER", adType = "native"))
            return false
        }
        if (!isInitialized) {
            pendingNative = true
            initialize()
            dispatch("ad_request_queued", payload(adType = "native"))
            return true
        }
        if (nativeResponseId == null) {
            pendingNative = true
            preloadNative()
            dispatch("ad_request_queued", payload(adType = "native", message = "loading"))
            return true
        }
        return renderNative()
    }

    /** Fetches a native ad response without rendering it. */
    @MainThread
    private fun preloadNative() {
        val activityInstance = activityRef.get() ?: return
        val zone = TapsellConfig.ZONE_NATIVE
        if (zone.isBlank() || nativeResponseId != null) return
        if (!nativeLoading.compareAndSet(false, true)) return

        runCatching {
            TapsellPlus.requestNativeAd(activityInstance, zone,
                object : AdRequestCallback() {
                    override fun response(adModel: TapsellPlusAdModel?) {
                        nativeLoading.set(false)
                        nativeResponseId = adModel?.responseId
                        dispatch("native_loaded", payload(adType = "native"))
                        onAdReady("native")
                    }

                    override fun error(message: String) {
                        nativeLoading.set(false)
                        nativeResponseId = null
                        pendingNative = false
                        dispatch("ad_error", payload(error = "NATIVE_REQUEST_FAILED", adType = "native", message = message))
                    }
                })
        }.onFailure {
            nativeLoading.set(false)
            pendingNative = false
            dispatch("ad_error", payload(error = "NATIVE_REQUEST_EXCEPTION", adType = "native", message = it.message))
        }
    }

    @MainThread
    private fun renderNative(): Boolean {
        val activityInstance = activityRef.get() ?: return false
        val responseId = nativeResponseId ?: return false
        val holder = nativeAdHolder ?: return false
        nativeResponseId = null

        return runCatching {
            TapsellPlus.showNativeAd(activityInstance, responseId, holder,
                object : AdShowListener() {
                    override fun onOpened(adModel: TapsellPlusAdModel?) {
                        dispatch("native_shown", payload(adType = "native"))
                    }

                    override fun onClosed(adModel: TapsellPlusAdModel?) {
                        dispatch("native_closed", payload(adType = "native"))
                    }

                    override fun onError(error: TapsellPlusErrorModel?) {
                        dispatch(
                            "ad_error",
                            payload(error = "NATIVE_SHOW_FAILED", adType = "native", message = error?.toString())
                        )
                    }
                })
            true
        }.getOrElse {
            Log.e(TAG, "showNativeAd threw", it)
            dispatch("ad_error", payload(error = "NATIVE_SHOW_EXCEPTION", adType = "native", message = it.message))
            false
        }
    }

    /** Destroys the currently rendered native ad (called when hiding the plate). */
    @MainThread
    fun destroyNative() {
        val activityInstance = activityRef.get() ?: return
        val responseId = nativeResponseId
        runCatching {
            if (responseId != null) TapsellPlus.destroyNativeBanner(activityInstance, responseId)
        }
        nativeAdHolder = null
        nativeResponseId = null
    }

    // ------------------------------------------------------------------
    // Deferred requests (the WebApp asked before the ad was ready)
    // ------------------------------------------------------------------

    @Volatile
    private var pendingInterstitial: Boolean = false

    @Volatile
    private var pendingRewarded: Boolean = false

    @Volatile
    private var pendingNative: Boolean = false

    /** Cancels every queued request (used when the Activity is destroyed). */
    fun cancelPending() {
        pendingInterstitial = false
        pendingRewarded = false
        pendingNative = false
    }

    fun dispose() {
        cancelPending()
        runCatching { destroyNative() }
        listener = null
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private fun payload(adType: String, error: String? = null, message: String? = null): JSONObject =
        JSONObject().apply {
            put("adType", adType)
            put("provider", "tapsell")
            error?.let { put("error", it) }
            message?.let { put("message", it) }
        }

    private fun dispatch(type: String, data: JSONObject) {
        runCatching { listener?.onAdEvent(type, data) }
            .onFailure { Log.w(TAG, "Listener failed for $type: ${it.message}") }
    }
}
