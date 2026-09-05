package com.emochi.quickgames

/**
 * Configuration parameters for Adivery Advertising Network.
 * Application: com.emochi.quickgames
 */
object AdiveryConfig {
    /**
     * Adivery Application ID from https://panel.adivery.com/
     */
    const val APP_ID = "74c264e1-2b02-4751-8254-8c83e18a8031"

    /**
     * Placement IDs for Banner, Interstitial, and Rewarded Video Ads
     */
    const val PLACEMENT_BANNER = "b6f4a810-1e5b-4369-b1d5-824c16a50b73"
    const val PLACEMENT_INTERSTITIAL = "d1983c27-7756-4ca9-a86d-69e120f2b380"
    const val PLACEMENT_REWARDED = "f2719a04-5867-4221-83d2-3bf9b109e992"

    /**
     * Production setting: Disable debug logs to optimize release performance.
     */
    const val IS_PRODUCTION = true
}
