package com.chistan.quickgames

import android.content.Context
import android.util.Log
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayInputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.Locale
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.zip.GZIPOutputStream

/**
 * LocalWebServer
 * ==============
 *
 * A tiny, dependency-free embedded HTTP/1.1 server that serves the WebApp
 * shipped inside `app/src/main/assets/web/` (with a legacy fallback to the
 * asset root so older bundles keep working).
 *
 * Why a real HTTP server instead of `file:///android_asset`?
 * -----------------------------------------------------------------
 * Modern WebApps are produced by bundlers (Vite / Webpack / Next / Angular)
 * and rely on a *real* origin for:
 *
 *  - ES modules + `crossorigin` script/link tags        (same-origin, no CORS)
 *  - `fetch()` / `XMLHttpRequest` on relative URLs      (`file://` forbids it)
 *  - `WebAssembly.instantiateStreaming()`               (MIME + origin)
 *  - Service workers / Cache API / IndexedDB / cookies  (http(s) origin only)
 *  - `history.pushState` + SPA deep links               (real path routing)
 *  - `SharedArrayBuffer` for threads                    (COOP + COEP credentialless)
 *
 * The socket binds to the loopback interface only (127.0.0.1) on an ephemeral
 * port, so it is never reachable from outside the device. A stable boot URL is
 * provided by the `/redirect` endpoint (HTTP 302) which always redirects to the
 * current port, keeping the WebView's *origin* identical across Activity
 * recreation (rotation, theme change, process restore).
 *
 * Features:
 *  - On-the-fly gzip for text payloads (large JS bundles stay small)
 *  - Byte ranges (`206 Partial Content`) for media seeking / large assets
 *  - Strong ETags + `304 Not Modified`
 *  - Correct MIME types (wasm / mjs / fonts / media / json / map ...)
 *  - SPA history fallback: extension-less routes serve the entry document
 *  - Graceful 404 / 405 / 500 responses, never crashes the host app
 */
class LocalWebServer(
    private val assets: WebAssetSource,
    private val preferredPorts: IntArray = STABLE_PORTS
) {

    /** Convenience constructor used by the app (APK assets). */
    constructor(context: Context) : this(AndroidWebAssetSource(context))

    companion object {
        private const val TAG = "LocalWebServer"

        /**
         * Loopback ports tried in order before falling back to an ephemeral one.
         *
         * The port is part of the WebApp's **origin** (`http://127.0.0.1:<port>`),
         * and the origin is the key for `localStorage`, IndexedDB and Cache
         * Storage. A random port per process (the previous `ServerSocket(0)`)
         * therefore handed the game an *empty* store after every process death –
         * force stop, low-memory kill, reboot, update – and the player restarted
         * at level 1. Fixed ports keep the origin stable across launches; they
         * sit below Android's ephemeral range (32768+) so no outgoing connection
         * of another app can occupy them by chance, and a few alternatives cover
         * the rare case of another local server holding one (the WebApp's native
         * state mirror – `WebAppStateStore` – carries the progress over in that
         * case).
         */
        val STABLE_PORTS = intArrayOf(27182, 27183, 27184, 27185)

        /**
         * Bind retries for the canonical port ([STABLE_PORTS] `[0]`). A previous
         * instance may still be letting go of it: `ServerSocket.close()` only
         * *signals* the thread blocked in `accept()`, and the kernel keeps the
         * listener (hence the port) alive until that syscall has returned; a
         * dying process likewise holds its listener until it is torn down.
         * Landing on the next port instead would change the WebApp origin, so
         * the canonical port is worth ~0.5 s of patience (start() runs on a
         * background executor).
         */
        private const val FIRST_PORT_BIND_ATTEMPTS = 12
        private const val OTHER_PORT_BIND_ATTEMPTS = 2
        private const val BIND_RETRY_DELAY_MS = 40L

        /** How long stop() waits for the accept thread to leave `accept()`. */
        private const val ACCEPT_SHUTDOWN_TIMEOUT_MS = 1_000L

        /** Directory inside `assets/` that holds the WebApp. */
        private const val WEB_ROOT = "web"

        /** Assets above this size are gzip'd when the client accepts it. */
        private const val GZIP_MIN_BYTES = 1024L

        /** Safety cap for a single response body. */
        private const val MAX_BODY_BYTES = 192L * 1024L * 1024L

        /** Sentinel returned by [parseRange] for an unsatisfiable range. */
        private val INVALID_RANGE = LongRange.EMPTY

        /**
         * Container-side compatibility script, served at [COMPAT_URL] and
         * injected into every HTML document of the bundle (see [CompatInjector]).
         * It lives outside the WebApp root so a bundle can never shadow it.
         */
        private const val COMPAT_ASSET = "native/compat.js"
        const val COMPAT_URL = "/__native/compat.js"

        /** HTML documents above this size are streamed untouched. */
        private const val MAX_INJECT_BYTES = 4L * 1024L * 1024L
    }

    /** Base URL of the running server, e.g. `http://127.0.0.1:41235/`. */
    @Volatile
    var baseUrl: String? = null
        private set

    @Volatile
    var port: Int = -1
        private set

    private val running = AtomicBoolean(false)
    private var serverSocket: ServerSocket? = null
    private var acceptThread: Thread? = null
    private var pool: ExecutorService? = null

    private val activeConnections = AtomicInteger(0)

    /** True when `assets/web/` exists (new layout); false => asset root (legacy). */
    private val usesWebFolder: Boolean by lazy { !assets.isEmptyDir(WEB_ROOT) }

    /** Entry document inside the asset namespace, e.g. `web/index.html`. */
    val entryAssetPath: String by lazy {
        if (usesWebFolder) "$WEB_ROOT/index.html" else "index.html"
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    /**
     * Boots the server. Idempotent: repeated calls while the server is alive
     * are no-ops, which guards against duplicate initialization from
     * `onCreate` + retries + Activity recreation.
     */
    @Synchronized
    fun start(): Boolean {
        val current = serverSocket
        if (running.get() && current != null && !current.isClosed) {
            Log.d(TAG, "start() ignored – already running on port $port")
            return true
        }
        return try {
            // Loopback only – the WebApp is never exposed to the network.
            val socket = bindLoopback()
            serverSocket = socket
            port = socket.localPort
            baseUrl = "http://127.0.0.1:$port/"

            pool = Executors.newFixedThreadPool(
                (Runtime.getRuntime().availableProcessors() * 2).coerceIn(4, 12)
            ) { r -> Thread(r, "webapp-http-worker").apply { isDaemon = true } }

            running.set(true)
            acceptThread = Thread({ acceptLoop(socket) }, "webapp-http-accept").apply {
                isDaemon = true
                start()
            }
            Log.i(TAG, "Local HTTP server ready at $baseUrl (entry=$entryAssetPath)")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start local HTTP server", e)
            port = -1
            baseUrl = null
            running.set(false)
            false
        }
    }

    /**
     * Binds the first free port of [preferredPorts] on 127.0.0.1 (see
     * [STABLE_PORTS]); an ephemeral port is the last resort so the app keeps
     * working even when every preferred port is taken.
     */
    private fun bindLoopback(): ServerSocket {
        val loopback = InetAddress.getByName("127.0.0.1")
        preferredPorts.forEachIndexed { index, candidate ->
            val attempts = if (index == 0) FIRST_PORT_BIND_ATTEMPTS else OTHER_PORT_BIND_ATTEMPTS
            var lastError: String? = null
            for (attempt in 1..attempts) {
                val bound = tryBind(loopback, candidate) { lastError = it }
                if (bound != null) {
                    if (attempt > 1) Log.i(TAG, "Loopback port $candidate became free after $attempt attempts")
                    return bound
                }
                if (attempt < attempts) {
                    try {
                        Thread.sleep(BIND_RETRY_DELAY_MS)
                    } catch (e: InterruptedException) {
                        Thread.currentThread().interrupt()
                        break
                    }
                }
            }
            Log.w(TAG, "Loopback port $candidate unavailable ($lastError) – trying the next one")
        }
        Log.w(TAG, "All stable loopback ports are busy – using an ephemeral port (WebApp origin changes)")
        return ServerSocket(0, 64, loopback).apply { reuseAddress = true }
    }

    /** One bind attempt; returns null (and reports the reason) when the port is taken. */
    private inline fun tryBind(address: InetAddress, candidate: Int, onError: (String) -> Unit): ServerSocket? {
        val socket = ServerSocket()
        return try {
            socket.reuseAddress = true
            socket.bind(InetSocketAddress(address, candidate), 64)
            socket
        } catch (e: IOException) {
            runCatching { socket.close() }
            onError(e.message ?: e.javaClass.simpleName)
            null
        }
    }

    /** True when the server runs on one of the [STABLE_PORTS]. */
    fun isOnStablePort(): Boolean = port > 0 && preferredPorts.contains(port)

    /** Entry URL the WebView should navigate to: `<base>index.html`. */
    fun entryUrl(): String? = baseUrl?.let { it + "index.html" }

    /**
     * Stable, port-independent boot URL. Always keeps the same origin so
     * WebView storage (localStorage / IndexedDB / caches) survives restarts.
     */
    fun stableBootUrl(): String? = baseUrl?.let { it + "redirect" }

    /**
     * Deep-link URL handed to the WebApp. The route travels in the URL fragment
     * which is never sent to the server – interpreting it is entirely up to the
     * WebApp's own router.
     */
    fun deepLinkUrl(route: String): String? {
        val base = baseUrl ?: return null
        val clean = route.trim().removePrefix("#").removePrefix("!").removePrefix("/")
        return if (clean.isEmpty()) base + "index.html" else base + "index.html#/" + clean
    }

    @Synchronized
    fun stop() {
        if (!running.get() && serverSocket == null) return
        running.set(false)
        runCatching { serverSocket?.close() }
        serverSocket = null
        val acceptor = acceptThread
        acceptThread = null
        acceptor?.interrupt()
        pool?.shutdownNow()
        pool = null
        port = -1
        baseUrl = null
        // Do not report "stopped" while the acceptor is still inside accept():
        // the kernel keeps the listener – and its port – alive until that call
        // returns, and a restart in the meantime would land on the next port
        // (a different WebApp origin). The wake-up is a signal, so this join
        // normally takes well under a millisecond.
        if (acceptor != null && acceptor !== Thread.currentThread()) {
            runCatching { acceptor.join(ACCEPT_SHUTDOWN_TIMEOUT_MS) }
            if (acceptor.isAlive) Log.w(TAG, "accept thread still alive after ${ACCEPT_SHUTDOWN_TIMEOUT_MS}ms")
        }
        Log.i(TAG, "Local HTTP server stopped")
    }

    // ------------------------------------------------------------------
    // Networking
    // ------------------------------------------------------------------

    private fun acceptLoop(socket: ServerSocket) {
        while (running.get() && !socket.isClosed) {
            try {
                val client = socket.accept()
                val executor = pool
                if (executor == null || activeConnections.get() > 48) {
                    runCatching { client.close() }
                    continue
                }
                activeConnections.incrementAndGet()
                try {
                    executor.execute { handleClient(client) }
                } catch (e: Exception) {
                    activeConnections.decrementAndGet()
                    runCatching { client.close() }
                }
            } catch (e: IOException) {
                if (running.get()) Log.w(TAG, "accept() failed: ${e.message}")
            } catch (e: Exception) {
                if (running.get()) Log.w(TAG, "accept() error: ${e.message}")
            }
        }
    }

    private fun handleClient(socket: Socket) {
        var out: BufferedOutputStream? = null
        try {
            socket.soTimeout = 20_000
            socket.tcpNoDelay = true
            socket.sendBufferSize = 128 * 1024

            val input = BufferedInputStream(socket.getInputStream(), 16 * 1024)
            out = BufferedOutputStream(socket.getOutputStream(), 64 * 1024)

            val request = readRequest(input) ?: return
            serve(request, out)
        } catch (e: Exception) {
            Log.w(TAG, "Connection error: ${e.message}")
        } finally {
            activeConnections.decrementAndGet()
            runCatching { out?.flush() }
            runCatching { socket.close() }
        }
    }

    private class HttpRequest(
        val method: String,
        val path: String,
        val headers: Map<String, String>
    )

    private fun readRequest(input: BufferedInputStream): HttpRequest? {
        val line = readLine(input) ?: return null
        if (line.isBlank()) return null

        val parts = line.split(' ')
        if (parts.size < 2) return null
        val method = parts[0].uppercase(Locale.ROOT)
        val target = parts[1]

        val headers = HashMap<String, String>()
        var guard = 0
        while (guard++ < 128) {
            val h = readLine(input) ?: break
            if (h.isEmpty()) break
            val idx = h.indexOf(':')
            if (idx > 0) {
                headers[h.substring(0, idx).trim().lowercase(Locale.ROOT)] =
                    h.substring(idx + 1).trim()
            }
        }

        val queryIndex = target.indexOf('?')
        val path = if (queryIndex >= 0) target.substring(0, queryIndex) else target
        return HttpRequest(method, path, headers)
    }

    private fun readLine(input: InputStream): String? {
        val sb = StringBuilder(128)
        var b = input.read()
        if (b == -1) return null
        while (b != -1 && b != '\n'.code) {
            if (b != '\r'.code) sb.append(b.toInt().toChar())
            if (sb.length > 8192) return null
            b = input.read()
        }
        return sb.toString()
    }

    // ------------------------------------------------------------------
    // Routing
    // ------------------------------------------------------------------

    private fun serve(request: HttpRequest, out: BufferedOutputStream) {
        if (request.method != "GET" && request.method != "HEAD") {
            writeError(out, 405, "Method Not Allowed")
            return
        }
        val headOnly = request.method == "HEAD"

        // `/redirect` – stable boot URL. A 302 always preserves host+port,
        // so the WebView origin is identical after every Activity recreation.
        if (request.path == "/redirect" || request.path == "/redirect/") {
            val target = entryUrl()
            if (target == null) {
                writeError(out, 500, "Server not ready")
                return
            }
            val header = "HTTP/1.1 302 Found\r\n" +
                    "Location: $target\r\n" +
                    "Cache-Control: no-store\r\n" +
                    "Content-Length: 0\r\n" +
                    "Connection: close\r\n\r\n"
            out.write(header.toByteArray(Charsets.ISO_8859_1))
            out.flush()
            return
        }

        // Cheap health probe, used by the retry/error state.
        if (request.path == "/__health") {
            writeText(out, 200, "OK", "text/plain; charset=utf-8", headOnly, null, null)
            return
        }

        // Compatibility layer for old WebViews (polyfills + rendering policy).
        if (request.path == COMPAT_URL) {
            val script = assets.open(COMPAT_ASSET)?.use { String(it.readBytes(), Charsets.UTF_8) }
            if (script == null) {
                writeError(out, 404, "Not Found")
                return
            }
            val etag = "\"compat-" + Integer.toHexString(script.hashCode()) + "\""
            if (request.headers["if-none-match"]?.contains(etag) == true) {
                writeNotModified(out, etag, "application/javascript; charset=utf-8")
                return
            }
            writeText(
                out, 200, script, "application/javascript; charset=utf-8", headOnly, etag,
                "no-cache, must-revalidate"
            )
            return
        }

        val decodedPath = decodePath(request.path)
        val resolved = resolveAsset(decodedPath)
        if (resolved == null) {
            writeError(out, 404, "Not Found")
            return
        }

        val assetPath = resolved.first
        val isSpaFallback = resolved.second
        val opened = openAsset(assetPath)
        if (opened == null) {
            writeError(out, 404, "Not Found")
            return
        }
        var stream = opened.first
        var length = opened.second

        val mime = MimeTypes.forPath(assetPath)

        // HTML documents get the compatibility script injected. The document is
        // small (a Vite/webpack entry is a few kB), so it is rewritten in
        // memory; anything unexpectedly large is streamed untouched.
        var contentHash: Int? = null
        if (mime.startsWith("text/html") && length in 1..MAX_INJECT_BYTES) {
            val rewritten = runCatching {
                val raw = stream.use { it.readBytes() }
                CompatInjector.inject(String(raw, Charsets.UTF_8), COMPAT_URL).toByteArray(Charsets.UTF_8)
            }.getOrNull()
            if (rewritten == null) {
                // The stream was consumed: reopen and serve the original.
                val reopened = openAsset(assetPath)
                if (reopened == null) {
                    writeError(out, 404, "Not Found")
                    return
                }
                stream = reopened.first
                length = reopened.second
            } else {
                stream = ByteArrayInputStream(rewritten)
                length = rewritten.size.toLong()
                contentHash = rewritten.contentHashCode()
            }
        }

        // Never cache the SPA fallback with the entry document's ETag: the URL
        // and the payload differ, and a stale route would break navigation.
        val etag = when {
            isSpaFallback -> null
            contentHash != null -> "\"" + Integer.toHexString(contentHash) + "-" + length + "\""
            else -> "\"" + Integer.toHexString((assetPath + length).hashCode()) + "-" + length + "\""
        }

        val ifNoneMatch = request.headers["if-none-match"]
        if (etag != null && ifNoneMatch != null && ifNoneMatch.contains(etag)) {
            runCatching { stream.close() }
            writeNotModified(out, etag, mime)
            return
        }

        // Byte ranges: required by <video>/<audio> seeking and by players that
        // stream large assets. A single range is honoured; anything more exotic
        // (multi-range) simply falls back to a full 200 response.
        val range = parseRange(request.headers["range"], length)
        if (range == INVALID_RANGE) {
            runCatching { stream.close() }
            writeRangeNotSatisfiable(out, length)
            return
        }
        val isPartial = range != null
        val payloadLength = if (isPartial) range!!.last - range.first + 1 else length

        val acceptsGzip = (request.headers["accept-encoding"] ?: "")
            .lowercase(Locale.ROOT).contains("gzip")
        val compress = acceptsGzip &&
                !isPartial &&
                length >= GZIP_MIN_BYTES &&
                MimeTypes.isCompressible(assetPath, mime) &&
                request.headers["range"] == null

        val header = StringBuilder(320)
        header.append(if (isPartial) "HTTP/1.1 206 Partial Content\r\n" else "HTTP/1.1 200 OK\r\n")
        header.append("Content-Type: ").append(mime).append("\r\n")
        if (isPartial) {
            header.append("Content-Range: bytes ")
                .append(range!!.first).append('-').append(range!!.last)
                .append('/').append(length).append("\r\n")
        }
        etag?.let { header.append("ETag: ").append(it).append("\r\n") }
        if (compress) header.append("Content-Encoding: gzip\r\n")
        header.append("Cache-Control: ").append(cacheControlFor(assetPath)).append("\r\n")
        header.append("Accept-Ranges: bytes\r\n")
        header.append("X-Content-Type-Options: nosniff\r\n")
        // Cross-origin isolation (SharedArrayBuffer / WebAssembly threads used
        // by Godot, Unity and ffmpeg builds) without breaking the third-party
        // resources a bundled WebApp typically loads (CDN scripts, web fonts,
        // remote images, backend APIs): `credentialless` only strips cookies
        // from no-CORS cross-origin loads, whereas `require-corp` would block
        // them outright. WebViews older than Chromium 96 ignore the value and
        // simply run without isolation.
        header.append("Cross-Origin-Opener-Policy: same-origin\r\n")
        header.append("Cross-Origin-Embedder-Policy: credentialless\r\n")
        header.append("Cross-Origin-Resource-Policy: same-origin\r\n")
        if (compress) {
            // Compressed size is unknown up-front: close-delimited response.
            header.append("Connection: close\r\n")
        } else {
            header.append("Content-Length: ").append(payloadLength).append("\r\n")
            header.append("Connection: close\r\n")
        }
        header.append("\r\n")
        out.write(header.toString().toByteArray(Charsets.ISO_8859_1))
        out.flush()

        if (headOnly) {
            runCatching { stream.close() }
            return
        }

        try {
            when {
                compress -> {
                    val gzip = GZIPOutputStream(out, 64 * 1024, true)
                    pump(stream, gzip, MAX_BODY_BYTES)
                    gzip.finish()
                    gzip.flush()
                }
                isPartial -> {
                    skipFully(stream, range!!.first)
                    pump(stream, out, payloadLength)
                }
                else -> pump(stream, out, MAX_BODY_BYTES)
            }
            out.flush()
        } catch (e: Exception) {
            // Client aborted (very common with video seeking) – not an error.
            Log.d(TAG, "Stream aborted for $assetPath: ${e.message}")
        } finally {
            runCatching { stream.close() }
        }
    }

    /** Streams at most [limit] bytes from [input] to [out]. */
    private fun pump(input: InputStream, out: OutputStream, limit: Long) {
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (total < limit) {
            val wanted = minOf(buffer.size.toLong(), limit - total).toInt()
            val read = input.read(buffer, 0, wanted)
            if (read <= 0) break
            total += read
            out.write(buffer, 0, read)
        }
        if (total >= MAX_BODY_BYTES) {
            Log.w(TAG, "Response truncated at $MAX_BODY_BYTES bytes")
        }
    }

    /** Skips exactly [count] bytes (or as close as the stream allows). */
    private fun skipFully(input: InputStream, count: Long) {
        if (count <= 0) return
        var remaining = count
        val discard = ByteArray(16 * 1024)
        while (remaining > 0) {
            val skipped = try {
                input.skip(remaining)
            } catch (e: Exception) {
                0L
            }
            if (skipped > 0) {
                remaining -= skipped
                continue
            }
            val read = input.read(discard, 0, minOf(discard.size.toLong(), remaining).toInt())
            if (read <= 0) return
            remaining -= read
        }
    }

    /**
     * Parses a single `bytes=` range.
     *
     * @return `null` for "serve the whole entity", [INVALID_RANGE] when the
     *         request cannot be satisfied, otherwise the inclusive byte window.
     */
    private fun parseRange(header: String?, length: Long): LongRange? {
        if (header == null || length <= 0) return null
        val trimmed = header.trim().lowercase(Locale.ROOT)
        if (!trimmed.startsWith("bytes=")) return null
        val spec = trimmed.removePrefix("bytes=").trim()
        if (spec.contains(',')) return null // multi-range: answered with the full entity
        val dash = spec.indexOf('-')
        if (dash < 0) return null
        val rawStart = spec.substring(0, dash).trim()
        val rawEnd = spec.substring(dash + 1).trim()

        return try {
            if (rawStart.isEmpty()) {
                // Suffix range: the last N bytes.
                val suffix = rawEnd.toLong()
                if (suffix <= 0) return INVALID_RANGE
                val start = (length - suffix).coerceAtLeast(0)
                start until length
            } else {
                val start = rawStart.toLong()
                if (start < 0 || start >= length) return INVALID_RANGE
                val end = if (rawEnd.isEmpty()) length - 1 else rawEnd.toLong()
                if (end < start) return INVALID_RANGE
                start..minOf(end, length - 1)
            }
        } catch (e: NumberFormatException) {
            INVALID_RANGE
        }
    }

    private fun cacheControlFor(assetPath: String): String {
        val name = assetPath.lowercase(Locale.ROOT)
        return when {
            name.endsWith(".html") || name.endsWith(".htm") -> "no-cache, must-revalidate"
            // Content-hashed bundles (Vite/Webpack) are safe to pin forever.
            Regex("[.-][0-9a-zA-Z_-]{8,}\\.(js|mjs|css|woff2?|ttf|otf|png|jpe?g|webp|svg|wasm|mp4|webm|ogg|mp3|json)$")
                .containsMatchIn(name) -> "public, max-age=31536000, immutable"
            else -> "public, max-age=600"
        }
    }

    // ------------------------------------------------------------------
    // Asset resolution
    // ------------------------------------------------------------------

    /**
     * Maps a request path onto an asset.
     *
     *  - `/` and `""`                -> entry document
     *  - `/assets/main.js`           -> `web/assets/main.js`
     *  - `/game/42` (SPA deep link)  -> entry document (client-side routing)
     *  - `/sub/`                     -> `web/sub/index.html`
     *
     * @return asset path + whether this was the SPA fallback.
     */
    private fun resolveAsset(rawPath: String): Pair<String, Boolean>? {
        // Defence in depth: the server is loopback-only, but a path that tries
        // to escape the WebApp root must never resolve to anything.
        if (rawPath.contains("..")) return null

        var path = rawPath.trimStart('/')
        if (path.isEmpty()) path = "index.html"

        val prefix = if (usesWebFolder) "$WEB_ROOT/" else ""

        // 1. Exact asset (relative to the WebApp root).
        val direct = prefix + path
        if (assetExists(direct)) return direct to false

        // 2. Root-absolute paths that actually live at the asset root.
        if (prefix.isNotEmpty() && assetExists(path)) return path to false

        // 3. Directory request -> index.html inside it.
        if (path.endsWith("/")) {
            val index = prefix + path + "index.html"
            if (assetExists(index)) return index to false
        }

        // 4. SPA history fallback: routes without a file extension are handled
        //    by the client-side router, so the entry document is returned.
        val lastSegment = path.substringAfterLast('/')
        val looksLikeRoute = !lastSegment.contains('.') ||
                path.endsWith(".html") ||
                path.endsWith(".htm")
        if (looksLikeRoute && assetExists(entryAssetPath)) {
            return entryAssetPath to true
        }
        return null
    }

    private fun assetExists(path: String): Boolean = assets.exists(path)

    /** @return the asset stream plus its length in bytes, or null when missing. */
    private fun openAsset(path: String): Pair<InputStream, Long>? {
        val stream = assets.open(path) ?: return null
        val length = try {
            stream.available().toLong()
        } catch (e: Exception) {
            -1L
        }
        return stream to length
    }

    private fun decodePath(path: String): String = try {
        URLDecoder.decode(path.substringBefore('#'), "UTF-8")
    } catch (e: Exception) {
        path
    }

    // ------------------------------------------------------------------
    // Response helpers
    // ------------------------------------------------------------------

    private fun writeRangeNotSatisfiable(out: BufferedOutputStream, length: Long) {
        val header = "HTTP/1.1 416 Range Not Satisfiable\r\n" +
                "Content-Range: bytes */$length\r\n" +
                "Content-Length: 0\r\n" +
                "Connection: close\r\n\r\n"
        runCatching {
            out.write(header.toByteArray(Charsets.ISO_8859_1))
            out.flush()
        }
    }

    private fun writeNotModified(out: BufferedOutputStream, etag: String, mime: String) {
        val header = "HTTP/1.1 304 Not Modified\r\n" +
                "ETag: $etag\r\n" +
                "Content-Type: $mime\r\n" +
                "Cache-Control: no-cache, must-revalidate\r\n" +
                "Content-Length: 0\r\n" +
                "Connection: close\r\n\r\n"
        out.write(header.toByteArray(Charsets.ISO_8859_1))
        out.flush()
    }

    private fun writeText(
        out: BufferedOutputStream,
        status: Int,
        body: String,
        mime: String,
        headOnly: Boolean,
        etag: String?,
        cacheControl: String?
    ) {
        val bytes = body.toByteArray(Charsets.UTF_8)
        val sb = StringBuilder(256)
        sb.append("HTTP/1.1 ").append(status).append(' ').append(statusText(status)).append("\r\n")
        sb.append("Content-Type: ").append(mime).append("\r\n")
        etag?.let { sb.append("ETag: ").append(it).append("\r\n") }
        sb.append("Cache-Control: ").append(cacheControl ?: "no-store, must-revalidate").append("\r\n")
        sb.append("X-Content-Type-Options: nosniff\r\n")
        sb.append("Content-Length: ").append(bytes.size).append("\r\n")
        sb.append("Connection: close\r\n\r\n")
        out.write(sb.toString().toByteArray(Charsets.ISO_8859_1))
        if (!headOnly) out.write(bytes)
        out.flush()
    }

    private fun writeError(out: BufferedOutputStream, status: Int, message: String) {
        val html = "<!doctype html><html lang=\"fa\" dir=\"rtl\"><head><meta charset=\"utf-8\">" +
                "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
                "<title>$status</title></head>" +
                "<body style=\"font-family:system-ui,sans-serif;background:#F1FBF4;color:#065F46;" +
                "display:flex;align-items:center;justify-content:center;height:100vh;margin:0\">" +
                "<h2>$status — $message</h2></body></html>"
        runCatching { writeText(out, status, html, "text/html; charset=utf-8", false, null, null) }
    }

    private fun statusText(status: Int): String = when (status) {
        200 -> "OK"
        302 -> "Found"
        404 -> "Not Found"
        405 -> "Method Not Allowed"
        500 -> "Internal Server Error"
        else -> "OK"
    }

    @Suppress("unused")
    private fun closeQuietly(c: Closeable?) {
        runCatching { c?.close() }
    }
}
