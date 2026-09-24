package com.chistan.quickgames

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
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

        /** How long after a show request a full-screen ad is assumed to be in front. */
        private const val AD_PRESENTATION_GRACE_MS = 15_000L

        /**
         * How long a `show…()` request may wait for an ad that is still
         * loading. An interstitial sits between two levels: the player is
         * looking at a "please wait" screen, so a slow network gives up
         * quickly and the game moves on (the ad stays preloaded for the next
         * break). A rewarded video was asked for by the player, who is
         * willing to wait a little longer for the reward.
         */
        private const val INTERSTITIAL_WAIT_MS = 6_000L
        private const val REWARDED_WAIT_MS = 18_000L
    }

    /** Callbacks consumed by [WebAppBridge] and forwarded to JavaScript. */
    interface AdEventListener {
        fun onAdEvent(type: String, data: JSONObject)
    }

    private val activityRef = WeakReference(activity)
    private var listener: AdEventListener? = null

    /**
     * Second observer of the same event stream, for the host Activity: it
     * settles the WebView after a full-screen ad (`*_closed`, show errors)
     * independently of whether the WebApp listens. Always called on the main
     * thread.
     */
    var hostListener: ((type: String, data: JSONObject) -> Unit)? = null

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

    /** Uptime at which a full-screen ad was last handed to the SDK for display. */
    @Volatile
    private var showRequestedAt = 0L

    /**
     * True while a full-screen ad is (very likely) in front of the host: the
     * SDK reported it open, or it was asked to show one within the last
     * [AD_PRESENTATION_GRACE_MS] and has not closed it yet. Unlike [isShowingAd]
     * this also covers the moment between `showInterstitialAd()` and the SDK's
     * `onOpened`, when the host Activity is already being stopped.
     */
    fun isPresentingAd(): Boolean =
        isShowingAd || (showRequestedAt != 0L &&
                SystemClock.uptimeMillis() - showRequestedAt < AD_PRESENTATION_GRACE_MS)

    /**
     * Called from the host Activity's `onResume()`. A resumed host means no
     * full-screen ad Activity is in front of it any more – e.g. a notification
     * tap or deep link brought the app back over a running interstitial – so a
     * flag the SDK never cleared (its `onClosed` only fires when the ad Activity
     * finishes normally) must not keep swallowing the back button.
     */
    @MainThread
    fun onHostResumed() {
        if (isShowingAd) {
            Log.w(TAG, "Host resumed while an ad was marked as showing – clearing the stale flag")
            isShowingAd = false
        }
        showRequestedAt = 0L
    }

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
                    settlePending("interstitial")
                    showInterstitial()
                }
                "rewarded" -> if (pendingRewarded) {
                    settlePending("rewarded")
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
                        // The ad_error settles the WebApp's promise; a request
                        // that stayed queued would pop the *next* successfully
                        // loaded interstitial into the middle of a level.
                        settlePending("interstitial")
                        dispatch(
                            "ad_error",
                            payload(error = "INTERSTITIAL_REQUEST_FAILED", adType = "interstitial", message = message)
                        )
                    }
                })
        }.onFailure {
            interstitialLoading.set(false)
            settlePending("interstitial")
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
            queuePending("interstitial")
            initialize()
            dispatch("ad_request_queued", payload(adType = "interstitial"))
            return true
        }

        val responseId = interstitialResponseId
        if (responseId == null) {
            queuePending("interstitial")
            preloadInterstitial()
            dispatch("ad_request_queued", payload(adType = "interstitial", message = "loading"))
            return true
        }

        interstitialResponseId = null
        showRequestedAt = SystemClock.uptimeMillis()
        return runCatching {
            TapsellPlus.showInterstitialAd(activityInstance, responseId,
                object : AdShowListener() {
                    override fun onOpened(adModel: TapsellPlusAdModel?) {
                        isShowingAd = true
                        dispatch("interstitial_shown", payload(adType = "interstitial"))
                    }

                    override fun onClosed(adModel: TapsellPlusAdModel?) {
                        isShowingAd = false
                        showRequestedAt = 0L
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
                        showRequestedAt = 0L
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
            showRequestedAt = 0L
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
                        settlePending("rewarded")
                        dispatch(
                            "ad_error",
                            payload(error = "REWARDED_REQUEST_FAILED", adType = "rewarded", message = message)
                        )
                    }
                })
        }.onFailure {
            rewardedLoading.set(false)
            settlePending("rewarded")
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
            queuePending("rewarded")
            initialize()
            dispatch("ad_request_queued", payload(adType = "rewarded"))
            return true
        }

        val responseId = rewardedResponseId
        if (responseId == null) {
            queuePending("rewarded")
            preloadRewarded()
            dispatch("ad_request_queued", payload(adType = "rewarded", message = "loading"))
            return true
        }

        rewardedResponseId = null
        showRequestedAt = SystemClock.uptimeMillis()
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
                        showRequestedAt = 0L
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
                        showRequestedAt = 0L
                        dispatch(
                            "ad_error",
                            payload(error = "REWARDED_SHOW_FAILED", adType = "rewarded", message = error?.toString())
                        )
                        preloadRewarded()
                    }
                })
            true
        }.getOrElse {
            showRequestedAt = 0L
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

    private val mainHandler = Handler(Looper.getMainLooper())

    private val interstitialDeadline = Runnable {
        if (!pendingInterstitial) return@Runnable
        pendingInterstitial = false
        Log.w(TAG, "No interstitial ready within ${INTERSTITIAL_WAIT_MS} ms – the game continues without it")
        dispatch(
            "ad_error",
            payload(error = "INTERSTITIAL_TIMEOUT", adType = "interstitial", message = "no ad was ready in time")
        )
    }

    private val rewardedDeadline = Runnable {
        if (!pendingRewarded) return@Runnable
        pendingRewarded = false
        Log.w(TAG, "No rewarded video ready within ${REWARDED_WAIT_MS} ms")
        dispatch(
            "ad_error",
            payload(error = "REWARDED_TIMEOUT", adType = "rewarded", message = "no ad was ready in time")
        )
    }

    /**
     * Remembers a show request the SDK cannot satisfy yet and starts the
     * clock: a queued request is either fulfilled by [onAdReady], settled by
     * the preload's `ad_error`, or times out with an `ad_error` of its own.
     * Whatever happens, the WebApp's promise settles and the player is never
     * left on a "please wait" screen – nor surprised by an ad that pops up
     * minutes later in the middle of a level.
     */
    @MainThread
    private fun queuePending(adType: String) {
        when (adType) {
            "interstitial" -> {
                pendingInterstitial = true
                mainHandler.removeCallbacks(interstitialDeadline)
                mainHandler.postDelayed(interstitialDeadline, INTERSTITIAL_WAIT_MS)
            }
            "rewarded" -> {
                pendingRewarded = true
                mainHandler.removeCallbacks(rewardedDeadline)
                mainHandler.postDelayed(rewardedDeadline, REWARDED_WAIT_MS)
            }
        }
    }

    /** Clears a queued request and its deadline (fulfilled or failed). */
    private fun settlePending(adType: String) {
        when (adType) {
            "interstitial" -> {
                pendingInterstitial = false
                mainHandler.removeCallbacks(interstitialDeadline)
            }
            "rewarded" -> {
                pendingRewarded = false
                mainHandler.removeCallbacks(rewardedDeadline)
            }
        }
    }

    /** Cancels every queued request (used when the Activity is destroyed). */
    fun cancelPending() {
        settlePending("interstitial")
        settlePending("rewarded")
        pendingNative = false
    }

    fun dispose() {
        cancelPending()
        runCatching { destroyNative() }
        listener = null
        hostListener = null
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
        // Every ad event is logged at INFO: `adb logcat -s TapsellManager` is
        // the timeline used to diagnose "the game broke after the ad" reports.
        Log.i(TAG, "ad event: $type $data")
        runCatching { listener?.onAdEvent(type, data) }
            .onFailure { Log.w(TAG, "Listener failed for $type: ${it.message}") }
        val host = hostListener ?: return
        if (Looper.myLooper() == Looper.getMainLooper()) {
            runCatching { host(type, data) }
                .onFailure { Log.w(TAG, "Host listener failed for $type: ${it.message}") }
        } else {
            mainHandler.post {
                runCatching { host(type, data) }
                    .onFailure { Log.w(TAG, "Host listener failed for $type: ${it.message}") }
            }
        }
    }
}
