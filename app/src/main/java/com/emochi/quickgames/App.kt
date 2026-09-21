package com.emochi.quickgames

import android.app.Application
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

/**
 * Application entry point.
 *
 * Responsibilities – all of them native, once per process:
 *
 *  1. **Najva push** initialization (channels + listeners + SDK client).
 *  2. **Firebase** bootstrap so FCM (used by Najva under the hood) can obtain
 *     its registration token even when the project is built without a
 *     `google-services.json` file – the values come from the same native
 *     configuration store as the Najva keys.
 *  3. Notification channel creation (Android 8+).
 *
 * The WebView, the local HTTP server and the Tapsell SDK are intentionally
 * *not* touched here: they are owned by [WebAppServerController] and
 * [MainActivity] so that the WebApp boots only when there is a UI to show.
 */
class App : Application() {

    override fun onCreate() {
        super.onCreate()

        // 1. Firebase must exist before any FCM-based SDK (Najva) requests a token.
        initializeFirebase()

        // 2. Notification channels first: Najva may deliver a message at any time.
        NajvaManager.createNotificationChannels(this)

        // 3. Najva push – 100% native, notifications are rendered by the system.
        NajvaManager.initialize(this)

        if (BuildConfig.DEBUG) {
            Log.i(TAG, "App ready: ${NajvaManager.describe()}")
        }
    }

    /**
     * Initializes Firebase without requiring `google-services.json`.
     *
     * If the Google Services Gradle plugin produced a default app, this is a
     * no-op. Otherwise the app is created programmatically from native build
     * configuration, which makes the container buildable out of the box while
     * still supporting real FCM credentials in production.
     */
    private fun initializeFirebase() {
        runCatching {
            if (FirebaseApp.getApps(this).isNotEmpty()) return

            val appId = BuildConfig.FIREBASE_APP_ID
            val apiKey = BuildConfig.FIREBASE_API_KEY
            val projectId = BuildConfig.FIREBASE_PROJECT_ID
            if (appId.isBlank() || apiKey.isBlank() || projectId.isBlank()) {
                if (BuildConfig.DEBUG) {
                    Log.i(TAG, "Firebase credentials absent – FCM push registration is disabled " +
                            "until FIREBASE_* values are provided.")
                }
                return
            }

            val options = FirebaseOptions.Builder()
                .setApplicationId(appId)
                .setApiKey(apiKey)
                .setProjectId(projectId)
                .apply {
                    if (BuildConfig.FIREBASE_SENDER_ID.isNotBlank()) {
                        setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID)
                    }
                    if (BuildConfig.FIREBASE_STORAGE_BUCKET.isNotBlank()) {
                        setStorageBucket(BuildConfig.FIREBASE_STORAGE_BUCKET)
                    }
                }
                .build()

            FirebaseApp.initializeApp(this, options)
            Log.i(TAG, "Firebase initialized programmatically for project $projectId")
        }.onFailure {
            Log.w(TAG, "Firebase initialization skipped: ${it.message}")
        }
    }

    companion object {
        private const val TAG = "App"
    }
}
