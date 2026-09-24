package com.chistan.quickgames

import android.Manifest
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.pushfa.sdk.Pushfa
import com.pushfa.sdk.PushfaConfig
import com.pushfa.sdk.PushfaResult
import com.pushfa.sdk.PushfaState

/**
 * PushfaManager
 * =============
 *
 * 100% native Pushfa (https://pushfa.com) push-notification integration.
 *
 *  - The SDK is initialized **only** in the native layer (see [App]) with the
 *    public key from [PushfaSettings]; the WebApp never sees any identifier.
 *  - Notifications are rendered by the Pushfa SDK as **normal Android system
 *    notifications** (channel, icon and accent colour are handed over here).
 *    Nothing about notifications lives in `index.html`, the WebApp or the
 *    WebView.
 *  - A tap re-opens [MainActivity] through the SDK's own click Activity. A
 *    relative link (`/game/42`) arrives as `Pushfa.EXTRA_TARGET_URL`, is turned
 *    into a WebApp route by [DeepLinkBus] and buffered until the WebApp reports
 *    readiness.
 *  - Android 13+: the FCM token is registered with Pushfa only after the
 *    `POST_NOTIFICATIONS` permission has been granted ([registerForPush]).
 *
 * Firebase Cloud Messaging is the transport. Without a Firebase configuration
 * (`google-services.json` or `FIREBASE_*` build values) the subscriber is still
 * created on the Pushfa side, but no push token can be obtained; the SDK reports
 * that as a failed result which is logged here – the container never crashes
 * because of push.
 */
object PushfaManager {

    private const val TAG = "PushfaManager"

    @Volatile
    private var initialized = false

    @Volatile
    private var sdkStarted = false

    @Volatile
    var lastError: String? = null
        private set

    /** Pushfa subscriber id once the backend acknowledged this install. */
    @Volatile
    var subscriberId: String? = null
        private set

    /** True once a push token was registered with Pushfa in this process. */
    @Volatile
    var hasPushToken: Boolean = false
        private set

    // ------------------------------------------------------------------
    // Initialization
    // ------------------------------------------------------------------

    /**
     * Initializes Pushfa exactly once per process.
     *
     * Called from [App.onCreate]; safe to call again (idempotent).
     */
    fun initialize(app: Application) {
        if (initialized) return
        synchronized(this) {
            if (initialized) return
            initialized = true

            // Channels are cheap and safe to create even without credentials.
            createNotificationChannels(app)

            // Without a public key the SDK cannot talk to the Pushfa backend;
            // starting it anyway only produces stack traces, so the container
            // degrades gracefully and logs a single actionable line.
            if (!PushfaSettings.isConfigured) {
                Log.i(
                    TAG,
                    "Pushfa public key is missing (PUSHFA_API_PUBLIC_KEY) – " +
                            "push notifications stay disabled until it is provided."
                )
                return
            }

            runCatching {
                val config = PushfaConfig(
                    apiPublicKey = PushfaSettings.API_PUBLIC_KEY,
                    // Token registration is attempted right away on devices that
                    // already allow notifications (Android < 13 or permission
                    // granted earlier); MainActivity triggers it after the
                    // runtime permission dialog otherwise.
                    autoRegister = true,
                    autoDisplayNotifications = true,
                    trackVisits = true,
                    notificationChannelId = PushfaSettings.CHANNEL_ID,
                    notificationChannelName = app.getString(R.string.notification_channel_default_name),
                    notificationChannelImportance = NotificationManager.IMPORTANCE_HIGH,
                    smallIconResId = R.drawable.ic_notification,
                    accentColor = ContextCompat.getColor(app, R.color.primary)
                )

                if (BuildConfig.DEBUG) {
                    // Observe deliveries in logcat; `false` keeps the SDK renderer
                    // in charge of the system notification.
                    Pushfa.setNotificationListener { message ->
                        Log.d(TAG, "Notification received: id=${message.id} title=${message.title}")
                        false
                    }
                }

                Pushfa.initialize(app, config) { result -> onStateResult("initialize", result) }
                sdkStarted = true
                Log.i(TAG, "Pushfa SDK ${Pushfa.VERSION} started")
            }.onFailure {
                lastError = it.message
                Log.e(TAG, "Pushfa initialization failed", it)
            }
        }
    }

    /** True when a public key is configured (the SDK may or may not be reachable). */
    fun isConfigured(): Boolean = PushfaSettings.isConfigured

    /**
     * Registers (or refreshes) the FCM token with Pushfa.
     *
     * Call after the Android 13+ notification permission was granted; a no-op
     * when push is not configured or notifications are disabled by the user.
     */
    fun registerForPush(context: Context) {
        if (!sdkStarted) return
        if (!hasNotificationPermission(context)) {
            Log.d(TAG, "registerForPush skipped: notifications are not allowed")
            return
        }
        runCatching {
            Pushfa.registerForPush { result -> onStateResult("registerForPush", result) }
        }.onFailure {
            lastError = it.message
            Log.w(TAG, "Pushfa.registerForPush failed: ${it.message}")
        }
    }

    private fun onStateResult(operation: String, result: PushfaResult<PushfaState>) {
        if (result.isSuccess) {
            val state = result.value
            subscriberId = state?.subscriberId
            hasPushToken = !state?.pushToken.isNullOrBlank() || state?.hasPush == true
            lastError = null
            Log.i(
                TAG,
                "Pushfa $operation ok: subscriber=${state?.subscriberId?.take(8)}… " +
                        "push=${hasPushToken} topics=${state?.topics?.size ?: 0}"
            )
        } else {
            val error = result.error
            lastError = error?.message
            // A missing Firebase project shows up here as a failed token fetch;
            // it is a configuration issue, not a runtime fault.
            Log.w(TAG, "Pushfa $operation failed (http=${error?.httpStatus}): ${error?.message}")
        }
    }

    /** Push token known to the SDK (diagnostics only – never for the WebApp). */
    fun pushToken(): String? = runCatching { Pushfa.getPushToken() }.getOrNull()

    /** True when the device is registered for push with Pushfa. */
    fun isPushRegistered(): Boolean = hasPushToken || !pushToken().isNullOrBlank()

    // ------------------------------------------------------------------
    // Notification channels
    // ------------------------------------------------------------------

    /**
     * Creates the app's notification channels on Android 8+.
     *
     * The default channel id is the one handed to the Pushfa SDK, so the SDK
     * finds it already configured (description, lights, vibration, badge) and
     * never creates its bare fallback version.
     */
    fun createNotificationChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        runCatching {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE)
                    as? NotificationManager ?: return
            createChannel(
                manager,
                PushfaSettings.CHANNEL_ID,
                context.getString(R.string.notification_channel_default_name),
                context.getString(R.string.notification_channel_default_description),
                NotificationManager.IMPORTANCE_HIGH
            )
            createChannel(
                manager,
                PushfaSettings.CHANNEL_IMPORTANT_ID,
                context.getString(R.string.notification_channel_important_name),
                context.getString(R.string.notification_channel_important_description),
                NotificationManager.IMPORTANCE_HIGH
            )
        }.onFailure {
            Log.w(TAG, "Unable to create notification channels: ${it.message}")
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun createChannel(
        manager: NotificationManager,
        id: String,
        name: String,
        description: String,
        importance: Int
    ) {
        if (manager.getNotificationChannel(id) != null) return
        val channel = NotificationChannel(id, name, importance).apply {
            this.description = description
            enableLights(true)
            enableVibration(true)
            setShowBadge(true)
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .build()
            )
        }
        manager.createNotificationChannel(channel)
    }

    // ------------------------------------------------------------------
    // Runtime permission (Android 13+)
    // ------------------------------------------------------------------

    /** True when the app may post notifications (permission + user setting). */
    fun hasNotificationPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return false
        }
        return runCatching { NotificationManagerCompat.from(context).areNotificationsEnabled() }
            .getOrDefault(true)
    }

    /** Human-readable diagnostics used by the native logs. */
    fun describe(context: Context? = null): String = buildString {
        append("configured=").append(PushfaSettings.isConfigured)
        append(", started=").append(sdkStarted)
        if (context != null) {
            append(", allowed=").append(hasNotificationPermission(context))
        }
        append(", subscriber=").append(if (subscriberId.isNullOrEmpty()) "none" else "ok")
        append(", token=").append(if (isPushRegistered()) "ok" else "none")
        lastError?.let { append(", lastError=").append(it) }
    }
}
