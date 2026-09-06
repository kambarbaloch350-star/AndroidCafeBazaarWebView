package com.emochi.quickgames

import android.app.Activity
import android.util.Log
import com.adivery.sdk.Adivery
import com.adivery.sdk.AdiveryListener
import org.json.JSONObject

/**
 * Production Controller for Adivery Mobile Advertising Network.
 * Handles Interstitial, Rewarded Video, and Banner ad lifecycles.
 */
class AdiveryManager(
    private val activity: Activity,
    val bannerPlacementId: String = AdiveryConfig.PLACEMENT_BANNER,
    val interstitialPlacementId: String = AdiveryConfig.PLACEMENT_INTERSTITIAL,
    val rewardedPlacementId: String = AdiveryConfig.PLACEMENT_REWARDED
) {
    companion object { const val TAG = "AdiveryManager" }
    interface AdEventListener { fun onAdEvent(type: String, data: JSONObject) }

    private var eventListener: AdEventListener? = null
    private var isInterstitialLoaded = false
    private var isRewardedLoaded = false
    private var listenerRegistered = false
    private var pendingRewardedPlacement: String? = null

    fun setEventListener(listener: AdEventListener?) { eventListener = listener }

    fun prepareAds() {
        registerGlobalListenerOnce()
        if (interstitialPlacementId.isNotBlank()) {
            runCatching { Adivery.prepareInterstitialAd(activity, interstitialPlacementId) }
                .onFailure { Log.e(TAG, "prepare interstitial failed", it) }
        }
        if (rewardedPlacementId.isNotBlank()) {
            runCatching { Adivery.prepareRewardedAd(activity, rewardedPlacementId) }
                .onFailure { Log.e(TAG, "prepare rewarded failed", it) }
        }
    }

    private fun registerGlobalListenerOnce() {
        if (listenerRegistered) return
        listenerRegistered = true
        Adivery.addGlobalListener(object : AdiveryListener() {
            override fun onInterstitialAdLoaded(placementId: String) {
                if (placementId == interstitialPlacementId) isInterstitialLoaded = true
                dispatchAdPlacementEvent("interstitial_loaded", placementId)
            }

            override fun onInterstitialAdShown(placementId: String) {
                dispatchAdPlacementEvent("interstitial_shown", placementId)
            }

            override fun onInterstitialAdClosed(placementId: String) {
                if (placementId == interstitialPlacementId) isInterstitialLoaded = false
                dispatchAdPlacementEvent("interstitial_closed", placementId)
                prepareInterstitial(placementId)
            }

            override fun onRewardedAdLoaded(placementId: String) {
                if (placementId == rewardedPlacementId) {
                    isRewardedLoaded = true
                    // If JS requested an ad while it was loading, show it now.
                    if (pendingRewardedPlacement == placementId) {
                        pendingRewardedPlacement = null
                        showRewardedNow(placementId)
                    }
                }
                dispatchAdPlacementEvent("rewarded_loaded", placementId)
            }

            override fun onRewardedAdShown(placementId: String) {
                dispatchAdPlacementEvent("rewarded_shown", placementId)
            }

            override fun onRewardedAdClosed(placementId: String, isRewarded: Boolean) {
                if (placementId == rewardedPlacementId) isRewardedLoaded = false

                // Emit the grant FIRST. The WebView can safely award immediately,
                // without depending on the close callback to deliver the reward.
                if (isRewarded) {
                    val granted = JSONObject().apply {
                        put("placementId", placementId)
                        put("rewardGranted", true)
                        put("rewarded", true)
                        put("success", true)
                    }
                    dispatchAdEvent("rewarded_completed", granted)
                    dispatchAdEvent("reward_granted", granted)
                }

                val closed = JSONObject().apply {
                    put("placementId", placementId)
                    put("rewardGranted", isRewarded)
                    put("rewarded", isRewarded)
                    put("success", isRewarded)
                }
                dispatchAdEvent("rewarded_closed", closed)
                prepareRewarded(placementId)
            }

            override fun onInterstitialAdClicked(placementId: String) {
                dispatchAdPlacementEvent("interstitial_clicked", placementId)
            }

            override fun onRewardedAdClicked(placementId: String) {
                dispatchAdPlacementEvent("rewarded_clicked", placementId)
            }
        })
    }

    fun dispatchAdError(placementId: String, reason: String) {
        val payload = JSONObject().apply {
            put("placementId", placementId)
            put("error", reason)
        }
        dispatchAdEvent("ad_error", payload)
    }

    fun showInterstitial(placementId: String? = null): Boolean {
        val targetId = if (!placementId.isNullOrBlank()) placementId else interstitialPlacementId
        if (targetId.isBlank()) return false
        if (safeIsLoaded(targetId)) {
            runCatching { Adivery.showAd(targetId) }
                .onFailure { dispatchAdError(targetId, "INTERSTITIAL_SHOW_FAILED:${it.message ?: "unknown"}") }
            return true
        }
        prepareInterstitial(targetId)
        dispatchAdError(targetId, "INTERSTITIAL_NOT_LOADED")
        return false
    }

    /**
     * Returns true when the request was accepted. If the rewarded ad is still
     * loading, the request is queued and shown automatically from onLoaded.
     */
    fun showRewarded(placementId: String? = null): Boolean {
        val targetId = if (!placementId.isNullOrBlank()) placementId else rewardedPlacementId
        if (targetId.isBlank()) return false
        if (safeIsLoaded(targetId)) {
            return showRewardedNow(targetId)
        }

        pendingRewardedPlacement = targetId
        prepareRewarded(targetId)
        dispatchAdPlacementEvent("rewarded_waiting", targetId)
        return true
    }

    private fun showRewardedNow(targetId: String): Boolean {
        return runCatching {
            Adivery.showAd(targetId)
            true
        }.getOrElse {
            dispatchAdError(targetId, "REWARDED_SHOW_FAILED:${it.message ?: "unknown"}")
            false
        }
    }

    private fun prepareRewarded(targetId: String) {
        runCatching { Adivery.prepareRewardedAd(activity, targetId) }
            .onFailure { dispatchAdError(targetId, "REWARDED_PREPARE_FAILED:${it.message ?: "unknown"}") }
    }

    private fun prepareInterstitial(targetId: String) {
        runCatching { Adivery.prepareInterstitialAd(activity, targetId) }
            .onFailure { dispatchAdError(targetId, "INTERSTITIAL_PREPARE_FAILED:${it.message ?: "unknown"}") }
    }

    private fun safeIsLoaded(targetId: String): Boolean {
        return runCatching { Adivery.isLoaded(targetId) }.getOrDefault(false)
    }

    fun isAdLoaded(placementId: String? = null): Boolean {
        val targetId = if (!placementId.isNullOrBlank()) placementId else rewardedPlacementId
        return safeIsLoaded(targetId) ||
            if (targetId == rewardedPlacementId) isRewardedLoaded else isInterstitialLoaded
    }

    fun isRewardedLoaded(): Boolean =
        isRewardedLoaded || (rewardedPlacementId.isNotBlank() && safeIsLoaded(rewardedPlacementId))

    fun isInterstitialLoaded(): Boolean =
        isInterstitialLoaded || (interstitialPlacementId.isNotBlank() && safeIsLoaded(interstitialPlacementId))

    private fun dispatchAdPlacementEvent(type: String, placementId: String) {
        val data = JSONObject().apply { put("placementId", placementId) }
        dispatchAdEvent(type, data)
    }

    private fun dispatchAdEvent(type: String, data: JSONObject) {
        eventListener?.onAdEvent(type, data)
    }
}
