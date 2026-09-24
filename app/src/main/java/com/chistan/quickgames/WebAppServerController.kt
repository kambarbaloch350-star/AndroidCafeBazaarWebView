package com.chistan.quickgames

import android.content.Context
import android.util.Log
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Process-wide owner of the [LocalWebServer].
 *
 * A single server instance is shared by every Activity instance, which means:
 *
 *  - the server is started exactly once per process (no duplicate servers,
 *    no leaked sockets, no zombie threads),
 *  - the WebView **origin is stable across configuration changes** because the
 *    Origin header value (host + port) never changes.
 *
 * This is the core reason Activity recreation does not wipe WebApp storage:
 * `localStorage`, IndexedDB, cookies and the HTTP cache are all keyed by
 * origin.
 */
object WebAppServerController {

    private const val TAG = "WebAppServer"

    /** Stable URL the WebView always navigates to (302 -> current port). */
    const val STABLE_URL = "http://127.0.0.1:7331/redirect"

    private val lock = Any()
    private val started = AtomicBoolean(false)

    @Volatile
    private var server: LocalWebServer? = null

    @Volatile
    var lastError: String? = null
        private set

    /**
     * Starts (or reuses) the WebApp server. Safe to call concurrently and
     * repeatedly; only the first caller performs the work.
     *
     * @return the running server, or null when it could not be started.
     */
    fun getOrStart(context: Context): LocalWebServer? {
        server?.let { existing ->
            if (isHealthy(existing)) return existing
        }
        synchronized(lock) {
            server?.let { existing ->
                if (isHealthy(existing)) return existing
            }
            return try {
                val instance = LocalWebServer(context.applicationContext)
                val ok = instance.start()
                if (ok && isHealthy(instance)) {
                    server = instance
                    started.set(true)
                    lastError = null
                    instance
                } else {
                    lastError = "SERVER_START_FAILED"
                    instance.stop()
                    null
                }
            } catch (e: Exception) {
                lastError = e.message ?: "SERVER_START_EXCEPTION"
                Log.e(TAG, "Unable to start WebApp server", e)
                null
            }
        }
    }

    /** Currently running server, or null. */
    fun current(): LocalWebServer? = server

    fun isRunning(): Boolean = server?.let { isHealthy(it) } == true

    /** Absolute entry URL (`<host>:<port>/index.html`) or null when down. */
    fun entryUrl(): String? = server?.entryUrl()

    /** URL used to deliver a deep-link route to the WebApp, or null. */
    fun deepLinkUrl(route: String): String? = server?.deepLinkUrl(route)

    /** Stops the server – only used when the whole process is going away. */
    fun shutdown() {
        synchronized(lock) {
            runCatching { server?.stop() }
            server = null
            started.set(false)
        }
    }

    /** Diagnostics helper surfaced to the native loading screen. */
    fun describe(): String = server?.let { "port=${it.port}" } ?: "down"

    private fun isHealthy(target: LocalWebServer): Boolean = target.port > 0 && target.baseUrl != null
}
