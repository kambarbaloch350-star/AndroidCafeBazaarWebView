package com.emochi.quickgames

/**
 * Native-only Tapsell configuration.
 *
 * Every identifier is injected at build time through `app/build.gradle.kts`
 * (`BuildConfig.TAPSELL_*`) so that:
 *
 *  1. no Tapsell ID is ever hard-coded in source control,
 *  2. no Tapsell ID is ever shipped to the WebApp / JavaScript sandbox.
 *
 * Configure them in `local.properties` (preferred, never committed) or
 * `gradle.properties`:
 *
 * ```
 * TAPSELL_APP_KEY=your-app-key
 * TAPSELL_ZONE_INTERSTITIAL=your-interstitial-zone
 * TAPSELL_ZONE_REWARDED=your-rewarded-zone
 * TAPSELL_ZONE_NATIVE=your-native-zone
 * ```
 */
object TapsellConfig {

    /** Tapsell dashboard "App Key". */
    val APP_KEY: String = BuildConfig.TAPSELL_APP_KEY

    /** Ad zone used by `NativeAds.showInterstitial()`. */
    val ZONE_INTERSTITIAL: String = BuildConfig.TAPSELL_ZONE_INTERSTITIAL

    /** Ad zone used by `NativeAds.showRewarded()`. */
    val ZONE_REWARDED: String = BuildConfig.TAPSELL_ZONE_REWARDED

    /** Ad zone used by `NativeAds.showNative()`. */
    val ZONE_NATIVE: String = BuildConfig.TAPSELL_ZONE_NATIVE

    /** True when an app key was provided at build time. */
    val isConfigured: Boolean
        get() = APP_KEY.isNotBlank() && !APP_KEY.startsWith("YOUR_")

    val hasInterstitial: Boolean get() = ZONE_INTERSTITIAL.isNotBlank()
    val hasRewarded: Boolean get() = ZONE_REWARDED.isNotBlank()
    val hasNative: Boolean get() = ZONE_NATIVE.isNotBlank()

    /** Verbose SDK logging in debug builds only. */
    val isDebug: Boolean get() = BuildConfig.DEBUG

    /**
     * Every zone the container knows about, keyed by the logical ad type the
     * WebApp asks for. The WebApp never sees the values.
     */
    fun zoneFor(type: String): String = when (type.lowercase()) {
        "interstitial" -> ZONE_INTERSTITIAL
        "rewarded", "rewarded_video", "rewardedvideo" -> ZONE_REWARDED
        "native", "native_banner", "nativebanner" -> ZONE_NATIVE
        else -> ""
    }
}
