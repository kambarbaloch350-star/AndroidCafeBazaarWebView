package com.chistan.quickgames

/**
 * Native-only Pushfa push configuration.
 *
 * The **public** API key is injected at build time (`BuildConfig`) and is never
 * exposed to the WebApp or the JavaScript bridge. The Pushfa *private* key and
 * the Firebase service account belong to the sending server only and must
 * never be embedded in the APK.
 *
 * ```
 * PUSHFA_API_PUBLIC_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 * ```
 */
object PushfaSettings {

    /** `api_public_key` of the Android service created in the Pushfa panel. */
    val API_PUBLIC_KEY: String = BuildConfig.PUSHFA_API_PUBLIC_KEY

    /** True when a public key was provided at build time. */
    val isConfigured: Boolean
        get() = API_PUBLIC_KEY.isNotBlank() && !API_PUBLIC_KEY.startsWith("YOUR_")

    /**
     * Notification channel used by every Pushfa notification.
     *
     * The id is also referenced by the manifest
     * (`com.google.firebase.messaging.default_notification_channel_id`) so the
     * rare FCM "notification" payload that bypasses the SDK renderer lands in
     * the same channel.
     */
    const val CHANNEL_ID = "labzband_default"

    /** Secondary channel offered to the user for heads-up / urgent messages. */
    const val CHANNEL_IMPORTANT_ID = "labzband_important"

    /** Permission request code used by the notification runtime permission flow. */
    const val PERMISSION_REQUEST_CODE = 0x5046 // "PF"
}
