package com.emochi.quickgames

import android.app.Activity
import com.adivery.sdk.Adivery
import com.adivery.sdk.AdiveryListener
import org.json.JSONObject

class AdiveryManager(
    private val activity: Activity,
    val bannerPlacementId: String = AdiveryConfig.PLACEMENT_BANNER,
    val interstitialPlacementId: String = AdiveryConfig.PLACEMENT_INTERSTITIAL,
    val rewardedPlacementId: String = AdiveryConfig.PLACEMENT_REWARDED
) {
    interface AdEventListener {
        fun onAdEvent(type: String, data: JSONObject)
    }

    private var eventListener: AdEventListener? = null

    fun setEventListener(listener: AdEventListener?) {
        this.eventListener = listener
    }

    fun prepareAds() {
        if (interstitialPlacementId.isNotBlank()) Adivery.prepareInterstitialAd(activity, interstitialPlacementId)
        if (rewardedPlacementId.isNotBlank()) Adivery.prepareRewardedAd(activity, rewardedPlacementId)

        Adivery.addGlobalListener(object : AdiveryListener() {
            override fun onInterstitialAdLoaded(placementId: String) {
                dispatchAdEvent("interstitial_loaded", placementId)
            }
            override fun onInterstitialAdClosed(placementId: String) {
                dispatchAdEvent("interstitial_closed", placementId)
                Adivery.prepareInterstitialAd(activity, interstitialPlacementId)
            }
            override fun onRewardedAdClosed(placementId: String, isRewarded: Boolean) {
                val payload = JSONObject().apply {
                    put("placementId", placementId)
                    put("rewardGranted", isRewarded)
                }
                dispatchAdEvent("rewarded_closed", payload)
                Adivery.prepareRewardedAd(activity, rewardedPlacementId)
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
            false
        }
    }

    fun isAdLoaded(placementId: String): Boolean = Adivery.isLoaded(placementId)

    private fun dispatchAdEvent(type: String, placementId: String) {
        val data = JSONObject().apply { put("placementId", placementId) }
        eventListener?.onAdEvent(type, data)
    }

    private fun dispatchAdEvent(type: String, data: JSONObject) {
        eventListener?.onAdEvent(type, data)
    }
}