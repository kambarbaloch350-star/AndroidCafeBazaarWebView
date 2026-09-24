package com.chistan.quickgames

import android.content.Intent
import android.net.Uri
import android.util.Log
import com.pushfa.sdk.Pushfa
import java.util.concurrent.CopyOnWriteArrayList

/**
 * DeepLinkBus
 * ===========
 *
 * Process-wide hand-off channel between the *native* push/openers and the
 * WebView.
 *
 * Push notifications are handled entirely in the native layer: Pushfa posts an
 * Android system notification, and a tap on it re-opens (or brings to front)
 * [MainActivity] with a deep-link route (`Pushfa.EXTRA_TARGET_URL`, plain
 * extras or the `data` URI).
 *
 * A tap can happen **before** the WebApp is ready (cold start), so routes are
 * buffered here until the page reports readiness through
 * `NativeApp.appReady()`. Only then is the route handed to the WebApp router.
 */
object DeepLinkBus {

    private const val TAG = "DeepLinkBus"

    /** Route prefix used by the WebApp one-page router (`#/route`). */
    private const val ROUTE_PREFIX = "/"

    private val pendingRoutes = CopyOnWriteArrayList<String>()

    @Volatile
    private var consumer: ((String) -> Boolean)? = null

    @Volatile
    var isWebAppReady: Boolean = false
        private set

    /** Called by the bridge once the WebApp signalled readiness. */
    fun setConsumer(consumer: ((String) -> Boolean)?) {
        this.consumer = consumer
    }

    fun markWebAppReady() {
        isWebAppReady = true
        flush()
    }

    fun markWebAppDestroyed() {
        isWebAppReady = false
    }

    /**
     * Publishes a route.
     *
     * @return true when it was delivered immediately, false when it was queued
     *         until the WebApp becomes ready.
     */
    fun publish(route: String): Boolean {
        val clean = normalize(route)
        if (clean.isEmpty()) return false

        val current = consumer
        if (isWebAppReady && current != null) {
            val delivered = runCatching { current(clean) }.getOrDefault(false)
            if (delivered) {
                Log.i(TAG, "Delivered deep link: $clean")
                return true
            }
        }
        // Keep only the most recent route: a newer notification supersedes an
        // undelivered older one.
        pendingRoutes.clear()
        pendingRoutes.add(clean)
        Log.i(TAG, "Queued deep link until the WebApp is ready: $clean")
        return false
    }

    /** Sends every buffered route to the WebApp (called on readiness). */
    fun flush() {
        val current = consumer ?: return
        if (!isWebAppReady) return
        val iterator = pendingRoutes.iterator()
        while (iterator.hasNext()) {
            val route = iterator.next()
            val delivered = runCatching { current(route) }.getOrDefault(false)
            if (delivered) {
                pendingRoutes.remove(route)
                Log.i(TAG, "Flushed deep link: $route")
            }
        }
    }

    /** @return true when at least one route is waiting for the WebApp. */
    fun hasPending(): Boolean = pendingRoutes.isNotEmpty()

    /**
     * Extracts a WebApp route from an [Intent]. Supports:
     *
     *  - `Pushfa.EXTRA_TARGET_URL` – relative link of a Pushfa notification
     *    (`/game/42`), or its absolute URL when no browser could open it
     *  - `https://<anything>/#/route` and `.../route`
     *  - custom scheme `labzband://open/game/123` (and legacy `quickgames://`)
     *  - plain extras: `EXTRA_TEXT`, `deeplink`, `route`, `url`
     */
    fun routeFromIntent(intent: Intent?): String? {
        intent ?: return null

        val candidates = ArrayList<String?>(7)
        candidates.add(runCatching { intent.getStringExtra(Pushfa.EXTRA_TARGET_URL) }.getOrNull())
        candidates.add(intent.getStringExtra(Intent.EXTRA_TEXT))
        candidates.add(intent.getStringExtra("deeplink"))
        candidates.add(intent.getStringExtra("deep_link"))
        candidates.add(intent.getStringExtra("route"))
        candidates.add(intent.getStringExtra("url"))
        candidates.add(intent.dataString)

        for (candidate in candidates) {
            val route = routeFromRaw(candidate)
            if (!route.isNullOrEmpty()) return route
        }
        return null
    }

    /** Normalizes any supported URL/route representation to a bare route path. */
    fun routeFromRaw(raw: String?): String? {
        val value = raw?.trim().orEmpty()
        if (value.isEmpty()) return null

        // Plain route such as "game/42" or "/game/42".
        if (!value.contains("://") && !value.startsWith("#")) {
            val cleaned = value.removePrefix("/").removePrefix("#").removePrefix("!")
            return if (cleaned.isEmpty()) null else cleaned
        }

        // Fragment based routes (SPA deep links).
        val hashIndex = value.indexOf('#')
        if (hashIndex >= 0) {
            val hash = value.substring(hashIndex + 1).trim().removePrefix("!").removePrefix("/")
            if (hash.isNotEmpty()) return hash
        }

        return runCatching {
            val uri = Uri.parse(value)
            val path = uri.path?.trim().orEmpty().removePrefix("/")
            val query = uri.getQueryParameter("route") ?: uri.getQueryParameter("path")
            when {
                !query.isNullOrBlank() -> query.removePrefix("/")
                path.isNotEmpty() -> path
                else -> null
            }
        }.getOrNull()
    }

    private fun normalize(route: String): String =
        route.trim().removePrefix("#").removePrefix("!").removePrefix(ROUTE_PREFIX)
}
