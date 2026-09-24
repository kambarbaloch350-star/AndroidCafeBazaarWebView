package com.chistan.quickgames

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Native mirror of the WebApp's saved state (`AndroidBridge.saveState` /
 * `loadState`, exposed to the game as `NativeApp.saveState` / `loadState`).
 *
 * The game keeps its progress in `localStorage`. That store is keyed by
 * *origin* and Chromium commits it to disk lazily (batched, rate-limited), so
 * progress was lost in two ways the player cannot understand:
 *
 * * a different loopback port after a process death meant a different origin
 *   and therefore an **empty** store (fixed separately by
 *   [LocalWebServer.STABLE_PORTS]);
 * * "Force stop" (and any other hard kill) ends the renderer before pending
 *   localStorage commits reach disk.
 *
 * The WebApp therefore mirrors every save here – `SharedPreferences`, written
 * with `commit()` on one background thread (atomic file replace, finished
 * within milliseconds, included in Android auto-backup) – and restores the
 * newer of the two copies at boot. Values carry the WebApp's own `savedAt`
 * stamp so both copies can be compared exactly.
 *
 * Writes coalesce: a burst of saves for the same key results in one file
 * write with the latest value. Reads see an in-flight value immediately.
 */
class WebAppStateStore private constructor(context: Context) {

    companion object {
        private const val TAG = "WebAppStateStore"
        private const val PREFS = "webapp_state"
        private const val SAVED_AT_SUFFIX = "::savedAt"

        /** Keys are opaque identifiers chosen by the WebApp; keep them tame. */
        private val KEY = Regex("^[A-Za-z0-9_.:-]{1,64}$")

        /** A saved game is a few KB; anything near this is a bug, not state. */
        private const val MAX_VALUE_CHARS = 1_000_000

        @Volatile
        private var instance: WebAppStateStore? = null

        /** Process-wide instance (WebView reboots create new bridges). */
        fun get(context: Context): WebAppStateStore =
            instance ?: synchronized(this) {
                instance ?: WebAppStateStore(context.applicationContext).also { instance = it }
            }
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Latest value per key that has not reached disk yet. */
    private val pending = ConcurrentHashMap<String, Pair<String, Long>>()

    // Non-daemon: a write that is already queued should finish even while the
    // process is winding down.
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "webapp-state").apply { isDaemon = false }
    }

    /**
     * Queues [value] for [key]. [savedAt] is the WebApp's millisecond stamp
     * (as a string – JS numbers do not map cleanly onto `long`); the current
     * time is used when it is missing or invalid.
     *
     * @return true when the value was accepted (it is visible to [load] at
     *         once and reaches disk on the background thread).
     */
    fun save(key: String?, value: String?, savedAt: String?): Boolean {
        val k = key?.takeIf { KEY.matches(it) } ?: return false
        val v = value ?: return false
        if (v.length > MAX_VALUE_CHARS) {
            Log.w(TAG, "Refusing to mirror $k: ${v.length} chars")
            return false
        }
        val at = savedAt?.trim()?.toLongOrNull()?.takeIf { it > 0 } ?: System.currentTimeMillis()
        pending[k] = v to at
        executor.execute { flush(k) }
        return true
    }

    private fun flush(key: String) {
        // A later save for the same key already flushed everything newer.
        val (value, at) = pending.remove(key) ?: return
        val ok = prefs.edit()
            .putString(key, value)
            .putLong(key + SAVED_AT_SUFFIX, at)
            .commit()
        if (!ok) Log.w(TAG, "commit() failed for $key")
    }

    /**
     * Mirrored value for [key] as `{"key","value","savedAt"}` JSON, or null
     * when nothing was ever saved. An in-flight value wins over the disk copy.
     */
    fun load(key: String?): String? {
        val k = key?.takeIf { KEY.matches(it) } ?: return null
        val (value, at) = pending[k]
            ?: (prefs.getString(k, null) ?: return null) to prefs.getLong(k + SAVED_AT_SUFFIX, 0L)
        return JSONObject()
            .put("key", k)
            .put("value", value)
            .put("savedAt", at)
            .toString()
    }

    /** Removes the mirror for [key] (used by the WebApp's own "reset"). */
    fun clear(key: String?): Boolean {
        val k = key?.takeIf { KEY.matches(it) } ?: return false
        pending.remove(k)
        executor.execute {
            prefs.edit().remove(k).remove(k + SAVED_AT_SUFFIX).commit()
        }
        return true
    }

    /** Diagnostics: keys currently mirrored (disk + in flight). */
    fun keys(): Set<String> =
        (prefs.all.keys.filterNot { it.endsWith(SAVED_AT_SUFFIX) } + pending.keys).toSet()
}
