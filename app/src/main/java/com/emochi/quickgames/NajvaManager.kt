package com.emochi.quickgames

import android.Manifest
import android.app.Activity
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
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.najva.sdk.NajvaClient
import com.najva.sdk.NajvaConfiguration
import java.lang.ref.WeakReference

/**
 * NajvaManager
 * ============
 *
 * 100% native Najva push-notification integration.
 *
 *  - Najva is initialized **only** in the native layer (see [App]).
 *  - Notifications are rendered by the Najva SDK as **normal Android system
 *    notifications**. Nothing about notifications lives in `index.html`, the
 *    WebApp, or the WebView.
 *  - Foreground / background delivery, notification taps and "open in app"
 *    actions are handled natively; taps are converted into WebApp routes and
 *    buffered by [DeepLinkBus] until the WebApp reports readiness.
 *
 * The SDK is registered as an [Application.ActivityLifecycleCallbacks] so it
 * can track foreground state and keep subscriptions accurate. Doing this once
 * at process start prevents duplicate registration (which would double-deliver
 * every notification).
 */
object NajvaManager {

    private const val TAG = "NajvaManager"

    @Volatile
    private var registered = false

    @Volatile
    private var initialized = false

    @Volatile
    var lastError: String? = null
        private set

    @Volatile
    private var currentActivity: WeakReference<Activity> = WeakReference(null)

    /** True when an activity is between onResume and onPause. */
    @Volatile
    var isForeground: Boolean = false
        private set

    // ------------------------------------------------------------------
    // Initialization
    // ------------------------------------------------------------------

    /**
     * Initializes Najva exactly once per process.
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

            // Without real credentials the SDK cannot register with the Najva
            // backend; initializing it anyway only produces stack traces, so the
            // container degrades gracefully and logs a single actionable line.
            if (!isConfigured(app)) {
                Log.i(
                    TAG,
                    "Najva credentials are missing (NAJVA_API_KEY / NAJVA_WEBSITE_ID) – " +
                            "push notifications stay disabled until they are provided."
                )
                return
            }

            configureListeners()
            registerClient(app)
        }
    }

    /** True when the API key (UUID) and website id are present in the manifest. */
    fun isConfigured(context: Context): Boolean = runCatching {
        val info = context.packageManager.getApplicationInfo(
            context.packageName,
            PackageManager.GET_META_DATA
        )
        val meta = info.metaData
        val apiKey = meta?.getString(NajvaConfig.META_API_KEY).orEmpty()
        val websiteId = meta?.getString(NajvaConfig.META_WEBSITE_ID).orEmpty()
        apiKey.isNotBlank() && websiteId.isNotBlank()
    }.getOrDefault(false)

    private fun configureListeners() {
        runCatching {
            val configuration = NajvaConfiguration()

            // Notification shown by the Najva SDK while the app is in the
            // foreground: hand the small icon + channels over so the system
            // notification looks exactly like the background one.
            configuration.setNotificationSmallIcon(R.drawable.ic_notification)

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                configuration.setLowPriorityChannel(NajvaConfig.CHANNEL_DEFAULT_ID)
                configuration.setHighPriorityChannel(NajvaConfig.CHANNEL_IMPORTANT_ID)
            }

            // A notification was received (foreground or background).
            configuration.setReceiveNotificationListener { notificationId ->
                Log.d(TAG, "Notification received: $notificationId")
            }

            // Subscription token available (e.g. to sync with a backend).
            configuration.setUserSubscriptionListener { token ->
                Log.d(TAG, "Subscribed with token: ${token.take(8)}…")
            }

            NajvaClient.configuration = configuration
        }.onFailure {
            lastError = it.message
            Log.e(TAG, "Failed to configure Najva listeners", it)
        }
    }

    private fun registerClient(app: Application) {
        runCatching {
            // The SDK returns the lifecycle callbacks it needs; registering them
            // lets Najva track foreground/background state accurately (and is
            // what the official sample does).
            val callbacks = NajvaClient.getInstance(app, NajvaClient.configuration)
            if (callbacks != null) {
                app.registerActivityLifecycleCallbacks(callbacks)
            }
            NajvaClient.getInstance().setLogEnabled(BuildConfig.DEBUG)
        }.onFailure {
            lastError = it.message
            Log.e(TAG, "NajvaClient.getInstance failed", it)
        }

        runCatching {
            if (!registered) {
                registered = true
                app.registerActivityLifecycleCallbacks(object :
                    Application.ActivityLifecycleCallbacks {

                    override fun onActivityCreated(activity: Activity, savedInstanceState: android.os.Bundle?) {
                        currentActivity = WeakReference(activity)
                    }

                    override fun onActivityStarted(activity: Activity) {
                        currentActivity = WeakReference(activity)
                    }

                    override fun onActivityResumed(activity: Activity) {
                        currentActivity = WeakReference(activity)
                        isForeground = true
                    }

                    override fun onActivityPaused(activity: Activity) {
                        isForeground = false
                    }

                    override fun onActivityStopped(activity: Activity) = Unit

                    override fun onActivitySaveInstanceState(activity: Activity, outState: android.os.Bundle) = Unit

                    override fun onActivityDestroyed(activity: Activity) {
                        if (currentActivity.get() === activity) {
                            currentActivity = WeakReference(null)
                        }
                    }
                })
            }
        }.onFailure {
            Log.w(TAG, "Najva lifecycle registration failed: ${it.message}")
        }
    }

    /** Detaches the current foreground activity (called from Activity.onDestroy). */
    fun detachActivity(activity: Activity) {
        if (currentActivity.get() === activity) {
            currentActivity = WeakReference(null)
        }
    }

    /** Exposes the subscribed push token for diagnostics (never for the WebApp). */
    fun subscribedToken(): String? = runCatching {
        NajvaClient.getInstance().subscribedToken
    }.getOrNull()

    // ------------------------------------------------------------------
    // Notification channels
    // ------------------------------------------------------------------

    /** Creates the app's notification channels on Android 8+. */
    fun createNotificationChannels(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        runCatching {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE)
                    as? NotificationManager ?: return
            createChannel(
                manager,
                NajvaConfig.CHANNEL_DEFAULT_ID,
                context.getString(R.string.notification_channel_default_name),
                context.getString(R.string.notification_channel_default_description),
                NotificationManager.IMPORTANCE_DEFAULT
            )
            createChannel(
                manager,
                NajvaConfig.CHANNEL_IMPORTANT_ID,
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

    /** True when the app may post notifications. */
    fun hasNotificationPermission(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
    }

    /** Human-readable diagnostics used by the native loading screen logs. */
    fun describe(context: Context? = null): String = buildString {
        if (context != null) {
            append("configured=").append(isConfigured(context))
            append(", ")
        }
        append("initialized=").append(initialized)
        append(", foreground=").append(isForeground)
        append(", token=").append(if (subscribedToken().isNullOrEmpty()) "none" else "ok")
    }

    /** Notification priority helper used by diagnostics. */
    @Suppress("unused")
    fun defaultPriority(): Int = NotificationCompat.PRIORITY_DEFAULT
}
