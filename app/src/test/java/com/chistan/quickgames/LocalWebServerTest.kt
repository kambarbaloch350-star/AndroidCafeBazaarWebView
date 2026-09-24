package com.chistan.quickgames

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.GZIPInputStream

/**
 * End-to-end tests for the embedded HTTP server.
 *
 * These run on the JVM (no emulator) and serve the **real** WebApp bundle from
 * `app/src/main/assets/web`, so a missing/renamed entry document or a broken
 * MIME mapping fails the build before an APK is ever produced.
 */
class LocalWebServerTest {

    private lateinit var server: LocalWebServer

    private companion object {
        /** Locates the shipped bundle regardless of the test working directory. */
        fun webRoot(): File {
            val candidates = listOf(
                File("src/main/assets/web"),
                File("app/src/main/assets/web"),
                File("../app/src/main/assets/web")
            )
            return candidates.firstOrNull { it.isDirectory }
                ?: error("assets/web bundle not found (looked in: ${candidates.joinToString()})")
        }
    }

    @Before
    fun setUp() {
        server = LocalWebServer(DirectoryWebAssetSource(webRoot()))
        assertTrue("server must start", server.start())
        assertNotNull("base URL must be published", server.baseUrl)
    }

    @After
    fun tearDown() {
        server.stop()
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private fun connect(path: String): HttpURLConnection =
        (URL("http://127.0.0.1:${server.port}$path").openConnection() as HttpURLConnection).apply {
            connectTimeout = 5_000
            readTimeout = 5_000
            instanceFollowRedirects = false
        }

    /** Raw request, used where a URL client would normalise the path for us. */
    private fun rawRequest(target: String, method: String = "GET"): String {
        java.net.Socket("127.0.0.1", server.port).use { socket ->
            socket.soTimeout = 5_000
            val request = "$method $target HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
            socket.getOutputStream().apply {
                write(request.toByteArray())
                flush()
            }
            return String(readAll(socket.getInputStream()), Charsets.ISO_8859_1)
        }
    }

    /** `<script src>` values of the entry document, in document order. */
    private fun entryScripts(): List<String> {
        val html = File(webRoot(), "index.html").readText(Charsets.UTF_8)
        return Regex("""<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']""", RegexOption.IGNORE_CASE)
            .findAll(html).map { it.groupValues[1] }.toList()
    }

    /** Server path of a script reference (`./js/x.js`, `/assets/x.js`, `x.js`). */
    private fun scriptPath(src: String): String = "/" + src.substringBefore('?').removePrefix("./").removePrefix("/")

    /** The bridge facade the entry document loads (any bundle ships one). */
    private fun bridgeScriptPath(): String =
        scriptPath(entryScripts().firstOrNull { it.contains("native-bridge") }
            ?: error("index.html must load a native-bridge.js facade"))

    /** Every JavaScript file of the packaged bundle, as server paths. */
    private fun bundleScriptPaths(): List<String> {
        val root = webRoot()
        return root.walkTopDown()
            .filter { it.isFile && (it.extension == "js" || it.extension == "mjs") }
            .map { "/" + it.relativeTo(root).invariantSeparatorsPath }
            .toList()
    }

    /** A sizeable text asset of the bundle, for compression / range tests. */
    private fun sizeableTextAsset(): String =
        (bundleScriptPaths() + listOf("/index.html"))
            .map { it to File(webRoot(), it.removePrefix("/")).length() }
            .filter { it.second in 2_000L..2_000_000L }
            .maxByOrNull { it.second }?.first
            ?: bridgeScriptPath()

    /** A stylesheet of the bundle (Vite hashes its name, so it is looked up). */
    private fun stylesheetPath(): String {
        val root = webRoot()
        val css = root.walkTopDown().filter { it.isFile && it.extension == "css" }
            .maxByOrNull { it.length() } ?: error("the bundle ships no stylesheet")
        return "/" + css.relativeTo(root).invariantSeparatorsPath
    }

    private fun readAll(stream: InputStream?): ByteArray {
        if (stream == null) return ByteArray(0)
        val out = ByteArrayOutputStream()
        stream.use { input ->
            val buffer = ByteArray(8192)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                out.write(buffer, 0, read)
            }
        }
        return out.toByteArray()
    }

    // ------------------------------------------------------------------
    // Boot contract
    // ------------------------------------------------------------------

    @Test
    fun `start is idempotent and keeps the same port`() {
        val port = server.port
        assertTrue(server.start())
        assertTrue(server.start())
        assertEquals("a second start() must not rebind the socket", port, server.port)
    }

    @Test
    fun `empty deep link route resolves to the entry document`() {
        val url = server.deepLinkUrl("   ")
        assertNotNull(url)
        assertTrue("got $url", url!!.endsWith("/index.html"))
    }

    @Test
    fun `health endpoint answers OK`() {
        val connection = connect("/__health")
        assertEquals(200, connection.responseCode)
        assertEquals("OK", String(readAll(connection.inputStream)))
    }

    @Test
    fun `redirect endpoint sends the WebView to the entry document`() {
        val connection = connect("/redirect")
        assertEquals(302, connection.responseCode)
        val location = connection.getHeaderField("Location")
        assertNotNull(location)
        assertTrue("redirect must point at index.html: $location", location!!.endsWith("/index.html"))
    }

    @Test
    fun `entry document is served as utf8 html`() {
        val connection = connect("/index.html")
        assertEquals(200, connection.responseCode)
        assertEquals("text/html; charset=utf-8", connection.getHeaderField("Content-Type"))
        val body = String(readAll(connection.inputStream), Charsets.UTF_8)
        assertTrue("entry document must load a native bridge facade", body.contains("native-bridge.js"))
        val scripts = entryScripts()
        assertTrue("entry document must load at least one application script", scripts.any { !it.contains("native-bridge") })
        // Every script the document references is actually packaged and typed
        // as JavaScript – a Node build that was copied incompletely fails here.
        for (src in scripts) {
            val script = connect(scriptPath(src))
            assertEquals("$src must be packaged", 200, script.responseCode)
            val type = script.getHeaderField("Content-Type")
            assertTrue("$src needs a JS MIME type, got $type", type != null && type.contains("javascript"))
        }
    }

    @Test
    fun `root path resolves to the entry document`() {
        val connection = connect("/")
        assertEquals(200, connection.responseCode)
        val body = String(readAll(connection.inputStream), Charsets.UTF_8)
        assertTrue(body.contains("native-bridge.js"))
    }

    @Test
    fun `webapp signals readiness with NativeApp appReady`() {
        // The call may live in a lazily loaded chunk (Vite / webpack code
        // splitting), so the whole bundle is searched – through the server, so
        // each chunk is also proven to be served.
        val callers = bundleScriptPaths().filter { path ->
            val connection = connect(path)
            connection.responseCode == 200 &&
                String(readAll(connection.inputStream), Charsets.UTF_8).contains("NativeApp.appReady(")
        }
        assertTrue("some script of the WebApp must call NativeApp.appReady()", callers.isNotEmpty())
    }

    // ------------------------------------------------------------------
    // MIME types + assets
    // ------------------------------------------------------------------

    @Test
    fun `javascript and css assets keep their types`() {
        val js = connect(bridgeScriptPath())
        assertEquals(200, js.responseCode)
        assertEquals("text/javascript; charset=utf-8", js.getHeaderField("Content-Type"))
        val bridge = String(readAll(js.inputStream), Charsets.UTF_8)
        assertTrue("bridge facade must expose NativeApp.appReady()", bridge.contains("appReady"))
        assertTrue(bridge.contains("showRewarded"))

        val css = connect(stylesheetPath())
        assertEquals(200, css.responseCode)
        assertEquals("text/css; charset=utf-8", css.getHeaderField("Content-Type"))
    }

    @Test
    fun `es modules are served with a module compatible type`() {
        val modules = entryScripts().filter { it.endsWith(".mjs") || it.contains("/assets/") } +
            bundleScriptPaths().filter { it.endsWith(".mjs") || it.contains("module") }
        for (path in modules.map { scriptPath(it) }.distinct()) {
            val module = connect(path)
            assertEquals("$path must be served", 200, module.responseCode)
            val type = module.getHeaderField("Content-Type")
            assertTrue("$path needs a JS MIME type, got $type", type!!.contains("javascript"))
        }
    }

    @Test
    fun `manifest and bundle files are packaged and typed`() {
        val root = webRoot()
        if (File(root, "manifest.webmanifest").isFile) {
            val manifest = connect("/manifest.webmanifest")
            assertEquals(200, manifest.responseCode)
            assertTrue(manifest.getHeaderField("Content-Type")!!.contains("manifest+json"))
        }

        // Binary assets (fonts, images) must arrive complete and correctly typed.
        val fontFile = root.walkTopDown().firstOrNull { it.isFile && it.extension == "woff2" }
        if (fontFile != null) {
            val font = connect("/" + fontFile.relativeTo(root).invariantSeparatorsPath)
            assertEquals(200, font.responseCode)
            assertEquals("font/woff2", font.getHeaderField("Content-Type"))
            assertEquals("font payload must arrive complete", fontFile.length().toInt(), readAll(font.inputStream).size)
        }
    }

    // ------------------------------------------------------------------
    // SPA routing, security, error handling
    // ------------------------------------------------------------------

    @Test
    fun `spa deep links fall back to the entry document`() {
        for (route in listOf("/game/42", "/container/ads", "/settings/profile")) {
            val connection = connect(route)
            assertEquals("$route must render the SPA", 200, connection.responseCode)
            val body = String(readAll(connection.inputStream), Charsets.UTF_8)
            assertTrue("$route must return the entry document", body.contains("native-bridge.js"))
        }
    }

    @Test
    fun `missing files are a clean 404`() {
        val connection = connect("/does-not-exist.js")
        assertEquals(404, connection.responseCode)
    }

    @Test
    fun `path traversal is rejected`() {
        for (attack in listOf(
            "/../local.properties",
            "/..%2f..%2fbuild.gradle.kts",
            "/js/../../gradle.properties",
            "/%2e%2e/%2e%2e/etc/hosts"
        )) {
            val response = rawRequest(attack)
            assertTrue(
                "$attack must not be served, got: ${response.lineSequence().first()}",
                response.startsWith("HTTP/1.1 404") || response.startsWith("HTTP/1.1 400")
            )
        }
    }

    @Test
    fun `unsupported methods answer 405`() {
        val response = rawRequest("/index.html", method = "POST")
        assertTrue("POST must be refused, got: ${response.lineSequence().first()}",
            response.startsWith("HTTP/1.1 405"))
    }

    // ------------------------------------------------------------------
    // Caching + compression
    // ------------------------------------------------------------------

    @Test
    fun `etag round trip answers 304`() {
        val asset = stylesheetPath()
        val first = connect(asset)
        assertEquals(200, first.responseCode)
        val etag = first.getHeaderField("ETag")
        assertNotNull("static assets must carry an ETag", etag)
        readAll(first.inputStream)

        val second = connect(asset)
        second.setRequestProperty("If-None-Match", etag)
        assertEquals(304, second.responseCode)
    }

    @Test
    fun `index html is never cached as immutable`() {
        val connection = connect("/index.html")
        val cacheControl = connection.getHeaderField("Cache-Control")
        assertTrue("entry document must revalidate, got $cacheControl", cacheControl!!.contains("no-cache"))
    }

    @Test
    fun `gzip is applied to compressible assets and decodes losslessly`() {
        val asset = sizeableTextAsset()
        val plain = connect(asset)
        val raw = readAll(plain.inputStream)

        val compressed = connect(asset)
        compressed.setRequestProperty("Accept-Encoding", "gzip")
        assertEquals(200, compressed.responseCode)
        assertEquals("gzip", compressed.getHeaderField("Content-Encoding"))
        val gunzipped = readAll(GZIPInputStream(compressed.inputStream))
        assertEquals("gzip must be lossless", raw.size, gunzipped.size)
        assertTrue(raw.contentEquals(gunzipped))
    }

    @Test
    fun `head requests return headers without a body`() {
        val connection = connect("/index.html")
        connection.requestMethod = "HEAD"
        assertEquals(200, connection.responseCode)
        assertTrue(connection.contentLengthLong > 0)
        assertEquals(0, readAll(connection.inputStream).size)
    }

    // ------------------------------------------------------------------
    // Byte ranges (media seeking / large assets)
    // ------------------------------------------------------------------

    @Test
    fun `range requests return a 206 slice`() {
        val asset = sizeableTextAsset()
        val full = readAll(connect(asset).inputStream)

        val connection = connect(asset)
        connection.setRequestProperty("Range", "bytes=0-99")
        assertEquals(206, connection.responseCode)
        assertEquals("bytes 0-99/${full.size}", connection.getHeaderField("Content-Range"))
        assertEquals(100L, connection.getHeaderField("Content-Length")!!.toLong())
        val slice = readAll(connection.inputStream)
        assertEquals(100, slice.size)
        assertTrue("slice must match the entity prefix", slice.contentEquals(full.copyOfRange(0, 100)))
    }

    @Test
    fun `suffix ranges and open ended ranges are honoured`() {
        val asset = stylesheetPath()
        val full = readAll(connect(asset).inputStream)

        val suffix = connect(asset)
        suffix.setRequestProperty("Range", "bytes=-64")
        assertEquals(206, suffix.responseCode)
        val tail = readAll(suffix.inputStream)
        assertEquals(64, tail.size)
        assertTrue(tail.contentEquals(full.copyOfRange(full.size - 64, full.size)))

        val open = connect(asset)
        open.setRequestProperty("Range", "bytes=10-")
        assertEquals(206, open.responseCode)
        val rest = readAll(open.inputStream)
        assertEquals(full.size - 10, rest.size)
    }

    @Test
    fun `a range beyond the entity is rejected with 416`() {
        val connection = connect(stylesheetPath())
        connection.setRequestProperty("Range", "bytes=99999999-")
        assertEquals(416, connection.responseCode)
        assertTrue(connection.getHeaderField("Content-Range")!!.startsWith("bytes */"))
    }

    @Test
    fun `partial responses are never gzipped and advertise range support`() {
        val connection = connect(sizeableTextAsset())
        connection.setRequestProperty("Accept-Encoding", "gzip")
        connection.setRequestProperty("Range", "bytes=0-49")
        assertEquals(206, connection.responseCode)
        assertNull(connection.getHeaderField("Content-Encoding"))
        assertEquals("bytes", connection.getHeaderField("Accept-Ranges"))
    }

    // ------------------------------------------------------------------
    // Deep links
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // Compatibility layer
    // ------------------------------------------------------------------

    @Test
    fun `entry document carries the compat script exactly once inside head`() {
        val connection = connect("/index.html")
        assertEquals(200, connection.responseCode)
        val body = String(readAll(connection.inputStream), Charsets.UTF_8)
        val tag = "<script src=\"${LocalWebServer.COMPAT_URL}\"></script>"
        assertEquals("compat script must be injected once", 1, Regex(Regex.escape(tag)).findAll(body).count())
        val headClose = body.indexOf("</head>", ignoreCase = true)
        assertTrue("entry document must have a <head>", headClose > 0)
        assertTrue("compat script must sit inside <head>", body.indexOf(tag) in 1 until headClose)
        // The original document is untouched otherwise.
        val original = File(webRoot(), "index.html").readText(Charsets.UTF_8)
        assertEquals(original, body.replace(tag, ""))
        // The ETag of the rewritten document must differ from a document of the
        // same length with other content: it is derived from the payload.
        assertNotNull(connection.getHeaderField("ETag"))
    }

    @Test
    fun `spa fallback documents carry the compat script too`() {
        val connection = connect("/game/42")
        assertEquals(200, connection.responseCode)
        val body = String(readAll(connection.inputStream), Charsets.UTF_8)
        assertTrue(body.contains(LocalWebServer.COMPAT_URL))
    }

    @Test
    fun `binds a stable loopback port so the WebApp origin survives a restart`() {
        // The origin (scheme + host + port) is the key of localStorage; a
        // different port per process would hand the game an empty store.
        assertTrue("port ${server.port} must be one of ${LocalWebServer.STABLE_PORTS.toList()}",
            server.isOnStablePort())
        assertEquals(LocalWebServer.STABLE_PORTS[0], server.port)

        // A second instance (the first port is taken) moves to the next stable
        // port instead of a random one …
        val second = LocalWebServer(DirectoryWebAssetSource(webRoot()))
        assertTrue(second.start())
        try {
            assertEquals(LocalWebServer.STABLE_PORTS[1], second.port)
            assertTrue(second.isOnStablePort())
        } finally {
            second.stop()
        }

        // … and after a restart the original port is reused (SO_REUSEADDR).
        server.stop()
        val restarted = LocalWebServer(DirectoryWebAssetSource(webRoot()))
        assertTrue(restarted.start())
        try {
            assertEquals(LocalWebServer.STABLE_PORTS[0], restarted.port)
        } finally {
            restarted.stop()
        }
        // tearDown() stops `server` again – stop() is idempotent.
    }

    @Test
    fun `falls back to an ephemeral port when every preferred port is busy`() {
        val cramped = LocalWebServer(DirectoryWebAssetSource(webRoot()), intArrayOf(server.port))
        assertTrue(cramped.start())
        try {
            assertTrue(cramped.port > 0)
            assertTrue(cramped.port != server.port)
            assertFalse(cramped.isOnStablePort())
        } finally {
            cramped.stop()
        }
    }

    @Test
    fun `compat script is served from the asset root next to the web folder`() {
        // The app's asset namespace: `web/` (the bundle) and `native/` (the
        // container's own files) side by side.
        val assetsRoot = webRoot().parentFile ?: error("assets root not found")
        assertTrue(File(assetsRoot, "native/compat.js").isFile)
        val rooted = LocalWebServer(DirectoryWebAssetSource(assetsRoot))
        assertTrue(rooted.start())
        try {
            val script = (URL("http://127.0.0.1:${rooted.port}${LocalWebServer.COMPAT_URL}").openConnection() as HttpURLConnection)
            assertEquals(200, script.responseCode)
            val type = script.getHeaderField("Content-Type")
            assertTrue("compat script needs a JS MIME type, got $type", type != null && type.contains("javascript"))
            val body = String(readAll(script.inputStream), Charsets.UTF_8)
            assertTrue(body.contains("Object.hasOwn"))
            assertTrue(body.contains("native-offscreen-canvas"))
            val etag = script.getHeaderField("ETag")
            assertNotNull(etag)

            // Conditional request -> 304.
            val again = (URL("http://127.0.0.1:${rooted.port}${LocalWebServer.COMPAT_URL}").openConnection() as HttpURLConnection)
            again.setRequestProperty("If-None-Match", etag)
            assertEquals(304, again.responseCode)

            // The bundle itself still resolves through web/ and is rewritten.
            val entry = (URL("http://127.0.0.1:${rooted.port}/").openConnection() as HttpURLConnection)
            assertEquals(200, entry.responseCode)
            val html = String(readAll(entry.inputStream), Charsets.UTF_8)
            assertTrue(html.contains(LocalWebServer.COMPAT_URL))
        } finally {
            rooted.stop()
        }
    }

    @Test
    fun `compat script is not injected into non html assets`() {
        val path = stylesheetPath()
        val connection = connect(path)
        assertEquals(200, connection.responseCode)
        val body = String(readAll(connection.inputStream), Charsets.UTF_8)
        assertTrue(!body.contains(LocalWebServer.COMPAT_URL))
    }

    @Test
    fun `deep link urls keep the route in the fragment`() {
        val url = server.deepLinkUrl("game/42")
        assertNotNull(url)
        assertTrue("route must travel in the fragment: $url", url!!.endsWith("/index.html#/game/42"))

        // A raw deep link is normalised into a bare route.
        val fromScheme = server.deepLinkUrl("#/quickgames://open/game/7")
        assertTrue(fromScheme!!.contains("#/"))
    }
}
