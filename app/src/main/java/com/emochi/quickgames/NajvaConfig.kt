package com.emochi.quickgames

/**
 * Native-only Najva push configuration.
 *
 * Values are injected at build time (`BuildConfig`/manifest placeholders) and
 * are **never** exposed to the WebApp or the JavaScript bridge:
 *
 * ```
 * NAJVA_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * NAJVA_WEBSITE_ID=12345
 * ```
 */
object NajvaConfig {

    /** Najva `apiKey`, read from the SDK's manifest meta-data (single source of truth). */
    const val META_API_KEY = "com.najva.sdk.metadata.API_KEY"

    /** Najva `websiteId`, read from the SDK's manifest meta-data. */
    const val META_WEBSITE_ID = "com.najva.sdk.metadata.WEBSITE_ID"

    /**
     * Notification channel IDs. High priority notifications use the "important"
     * channel (heads-up), everything else the default one.
     */
    const val CHANNEL_DEFAULT_ID = "quickgames_default"
    const val CHANNEL_IMPORTANT_ID = "quickgames_important"

    /** Permission request code used by the notification runtime permission flow. */
    const val PERMISSION_REQUEST_CODE = 0x4E41 // "NA"
}
