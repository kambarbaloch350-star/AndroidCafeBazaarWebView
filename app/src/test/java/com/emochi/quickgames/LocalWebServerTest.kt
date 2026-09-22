package com.emochi.quickgames

import org.junit.After
import org.junit.Assert.assertEquals
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
        assertTrue("entry document must load the native bridge", body.contains("js/native-bridge.js"))
        assertTrue("entry document must load the app bundle", body.contains("js/app.js"))
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
        val connection = connect("/js/app.js")
        val body = String(readAll(connection.inputStream), Charsets.UTF_8)
        assertTrue("the WebApp boot path must call NativeApp.appReady()", body.contains("NativeApp.appReady()"))
    }

    // ------------------------------------------------------------------
    // MIME types + assets
    // ------------------------------------------------------------------

    @Test
    fun `javascript and css assets keep their types`() {
        val js = connect("/js/native-bridge.js")
        assertEquals(200, js.responseCode)
        assertEquals("text/javascript; charset=utf-8", js.getHeaderField("Content-Type"))
        val bridge = String(readAll(js.inputStream), Charsets.UTF_8)
        assertTrue("bridge facade must expose NativeApp.appReady()", bridge.contains("appReady"))
        assertTrue(bridge.contains("showRewarded"))

        val css = connect("/css/style.css")
        assertEquals(200, css.responseCode)
        assertEquals("text/css; charset=utf-8", css.getHeaderField("Content-Type"))
    }

    @Test
    fun `es modules are served with a module compatible type`() {
        val module = connect("/js/module-demo.js")
        assertEquals(200, module.responseCode)
        val type = module.getHeaderField("Content-Type")
        assertTrue("module needs a JS MIME type, got $type", type!!.contains("javascript"))
    }

    @Test
    fun `manifest and bundle files are packaged and typed`() {
        val manifest = connect("/manifest.webmanifest")
        assertEquals(200, manifest.responseCode)
        assertTrue(manifest.getHeaderField("Content-Type")!!.contains("manifest+json"))

        val font = connect("/fonts/vazirmatn-variable.woff2")
        assertEquals(200, font.responseCode)
        assertEquals("font/woff2", font.getHeaderField("Content-Type"))
        assertTrue("font payload must not be empty", readAll(font.inputStream).size > 10_000)
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
        val first = connect("/css/style.css")
        assertEquals(200, first.responseCode)
        val etag = first.getHeaderField("ETag")
        assertNotNull("static assets must carry an ETag", etag)
        readAll(first.inputStream)

        val second = connect("/css/style.css")
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
        val plain = connect("/js/native-bridge.js")
        val raw = readAll(plain.inputStream)

        val compressed = connect("/js/native-bridge.js")
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
        val full = readAll(connect("/js/native-bridge.js").inputStream)

        val connection = connect("/js/native-bridge.js")
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
        val full = readAll(connect("/css/style.css").inputStream)

        val suffix = connect("/css/style.css")
        suffix.setRequestProperty("Range", "bytes=-64")
        assertEquals(206, suffix.responseCode)
        val tail = readAll(suffix.inputStream)
        assertEquals(64, tail.size)
        assertTrue(tail.contentEquals(full.copyOfRange(full.size - 64, full.size)))

        val open = connect("/css/style.css")
        open.setRequestProperty("Range", "bytes=10-")
        assertEquals(206, open.responseCode)
        val rest = readAll(open.inputStream)
        assertEquals(full.size - 10, rest.size)
    }

    @Test
    fun `a range beyond the entity is rejected with 416`() {
        val connection = connect("/css/style.css")
        connection.setRequestProperty("Range", "bytes=99999999-")
        assertEquals(416, connection.responseCode)
        assertTrue(connection.getHeaderField("Content-Range")!!.startsWith("bytes */"))
    }

    @Test
    fun `partial responses are never gzipped and advertise range support`() {
        val connection = connect("/js/native-bridge.js")
        connection.setRequestProperty("Accept-Encoding", "gzip")
        connection.setRequestProperty("Range", "bytes=0-49")
        assertEquals(206, connection.responseCode)
        assertNull(connection.getHeaderField("Content-Encoding"))
        assertEquals("bytes", connection.getHeaderField("Accept-Ranges"))
    }

    // ------------------------------------------------------------------
    // Deep links
    // ------------------------------------------------------------------

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
