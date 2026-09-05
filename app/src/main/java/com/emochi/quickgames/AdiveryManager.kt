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
    companion object {
        const val TAG = "AdiveryManager"
    }

    interface AdEventListener {
        fun onAdEvent(type: String, data: JSONObject)
    }

    private var eventListener: AdEventListener? = null
    private var isInterstitialLoaded = false
    private var isRewardedLoaded = false

    fun setEventListener(listener: AdEventListener?) {
        this.eventListener = listener
    }

    fun prepareAds() {
        if (interstitialPlacementId.isNotBlank()) {
            Adivery.prepareInterstitialAd(activity, interstitialPlacementId)
        }
        if (rewardedPlacementId.isNotBlank()) {
            Adivery.prepareRewardedAd(activity, rewardedPlacementId)
        }

        Adivery.addGlobalListener(object : AdiveryListener() {
            override fun onInterstitialAdLoaded(placementId: String) {
                if (placementId == interstitialPlacementId) {
                    isInterstitialLoaded = true
                }
                dispatchAdPlacementEvent("interstitial_loaded", placementId)
            }

            override fun onInterstitialAdShown(placementId: String) {
                dispatchAdPlacementEvent("interstitial_shown", placementId)
            }

            override fun onInterstitialAdClosed(placementId: String) {
                isInterstitialLoaded = false
                dispatchAdPlacementEvent("interstitial_closed", placementId)
                // Pre-cache next interstitial ad for seamless flow
                if (interstitialPlacementId.isNotBlank()) {
                    Adivery.prepareInterstitialAd(activity, interstitialPlacementId)
                }
            }

            override fun onRewardedAdLoaded(placementId: String) {
                if (placementId == rewardedPlacementId) {
                    isRewardedLoaded = true
                }
                dispatchAdPlacementEvent("rewarded_loaded", placementId)
            }

            override fun onRewardedAdShown(placementId: String) {
                dispatchAdPlacementEvent("rewarded_shown", placementId)
            }

            override fun onRewardedAdClosed(placementId: String, isRewarded: Boolean) {
                isRewardedLoaded = false
                val payload = JSONObject().apply {
                    put("placementId", placementId)
                    put("rewardGranted", isRewarded)
                }
                dispatchAdEvent("rewarded_closed", payload)
                // Pre-cache next rewarded ad
                if (rewardedPlacementId.isNotBlank()) {
                    Adivery.prepareRewardedAd(activity, rewardedPlacementId)
                }
            }

            override fun onInterstitialAdClicked(placementId: String) {
                dispatchAdPlacementEvent("interstitial_clicked", placementId)
            }

            override fun onRewardedAdClicked(placementId: String) {
                dispatchAdPlacementEvent("rewarded_clicked", placementId)
            }

            override fun onError(placementId: String, reason: String) {
                val payload = JSONObject().apply {
                    put("placementId", placementId)
                    put("error", reason)
                }
                dispatchAdEvent("ad_error", payload)
            }
        })
    }

    fun showInterstitial(placementId: String? = null): Boolean {
        val targetId = if (!placementId.isNullOrBlank()) placementId else interstitialPlacementId
        return if (Adivery.isLoaded(targetId)) {
            Adivery.showAd(targetId)
            true
        } else {
            Adivery.prepareInterstitialAd(activity, targetId)
            // Dispatch ad_error so web listener does not hang if ad is not loaded
            val payload = JSONObject().apply {
                put("placementId", targetId)
                put("error", "INTERSTITIAL_NOT_LOADED")
            }
            dispatchAdEvent("ad_error", payload)
            false
        }
    }

    fun showRewarded(placementId: String? = null): Boolean {
        val targetId = if (!placementId.isNullOrBlank()) placementId else rewardedPlacementId
        return if (Adivery.isLoaded(targetId)) {
            Adivery.showAd(targetId)
            true
        } else {
            Adivery.prepareRewardedAd(activity, targetId)
            // Dispatch ad_error so web listener does not hang if ad is not loaded
            val payload = JSONObject().apply {
                put("placementId", targetId)
                put("error", "REWARDED_NOT_LOADED")
            }
            dispatchAdEvent("ad_error", payload)
            false
        }
    }

    fun isAdLoaded(placementId: String? = null): Boolean {
        val targetId = if (!placementId.isNullOrBlank()) placementId else interstitialPlacementId
        return Adivery.isLoaded(targetId)
    }

    private fun dispatchAdPlacementEvent(type: String, placementId: String) {
        val data = JSONObject().apply { put("placementId", placementId) }
        dispatchAdEvent(type, data)
    }

    private fun dispatchAdEvent(type: String, data: JSONObject) {
        eventListener?.onAdEvent(type, data)
    }
}
