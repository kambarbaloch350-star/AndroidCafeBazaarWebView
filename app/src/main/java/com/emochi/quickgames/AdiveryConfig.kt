package com.emochi.quickgames

/**
 * Configuration parameters for Adivery Advertising Network.
 * Application: com.emochi.quickgames
 */
object AdiveryConfig {
    /**
     * Adivery Application ID from https://panel.adivery.com/
     */
    const val APP_ID = "7e27fb38-5aff-473a-998f-437b89426f66"

    /**
     * Placement IDs for Banner, Interstitial, and Rewarded Video Ads
     */
    const val PLACEMENT_BANNER = "2f71ec44-f30a-4043-9cc1-f32347a07f8b"
    const val PLACEMENT_INTERSTITIAL = "0045a4aa-1498-4790-9eed-6e33ac870e5f"
    const val PLACEMENT_REWARDED = "3f97dc4d-3e09-4024-acaf-931862c03ba8"

    /**
     * Production setting: Disable debug logs to optimize release performance.
     */
    const val IS_PRODUCTION = true
}
