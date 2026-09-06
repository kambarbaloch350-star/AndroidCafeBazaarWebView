package com.emochi.quickgames

/**
 * Configuration parameters for Adivery Advertising Network.
 * Application: com.emochi.quickgames
 */
object AdiveryConfig {
    /**
     * Adivery Application ID from https://panel.adivery.com/
     */
    const val APP_ID = "0fe6a925-bca2-4333-b19a-fdf90f79b8d0"

    /**
     * Placement IDs for Banner, Interstitial, and Rewarded Video Ads
     */
    const val PLACEMENT_BANNER = "01667fcf-72bb-4d0a-bedc-6cc6af7f69e4"
    const val PLACEMENT_INTERSTITIAL = "7706ee77-15c1-4402-bf76-f06c0c4e45ae"
    const val PLACEMENT_REWARDED = "428f35e8-88f9-4456-977a-537b4bc87905"

    /**
     * Production setting: Disable debug logs to optimize release performance.
     */
    const val IS_PRODUCTION = true
}
