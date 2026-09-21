package com.emochi.quickgames

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The MIME table is what makes heavy WebApps work inside the WebView: a wrong
 * `Content-Type` breaks ES modules, `WebAssembly.instantiateStreaming()` and
 * `@font-face`. These assertions pin the formats the container must support.
 */
class MimeTypesTest {

    private val expected = mapOf(
        "index.html" to "text/html; charset=utf-8",
        "app.js" to "text/javascript; charset=utf-8",
        "bundle.mjs" to "text/javascript; charset=utf-8",
        "style.css" to "text/css; charset=utf-8",
        "data.json" to "application/json; charset=utf-8",
        "module.wasm" to "application/wasm",
        "manifest.webmanifest" to "application/manifest+json; charset=utf-8",
        "icon.svg" to "image/svg+xml",
        "shot.webp" to "image/webp",
        "hero.avif" to "image/avif",
        "vazirmatn.woff2" to "font/woff2",
        "vazirmatn.woff" to "font/woff",
        "vazirmatn.ttf" to "font/ttf",
        "scene.glb" to "model/gltf-binary",
        "texture.ktx2" to "image/ktx2",
        "clip.mp4" to "video/mp4",
        "sound.mp3" to "audio/mpeg",
        "level.map" to "application/json; charset=utf-8",
        "archive.zip" to "application/zip"
    )

    @Test
    fun `known webapp formats map to the right content type`() {
        for ((path, mime) in expected) {
            assertEquals("wrong type for $path", mime, MimeTypes.forPath(path))
        }
    }

    @Test
    fun `mime lookup ignores case, directories and query suffixes`() {
        assertEquals("text/html; charset=utf-8", MimeTypes.forPath("deep/nested/PAGE.HTML"))
        assertEquals("application/wasm", MimeTypes.forPath("/assets/module.WASM"))
        assertEquals("", MimeTypes.extensionOf("no-extension-here"))
    }

    @Test
    fun `unknown extensions fall back instead of throwing`() {
        val mime = MimeTypes.forPath("mystery.qqqq")
        assertFalse(mime.isBlank())
    }

    @Test
    fun `text payloads are compressible, media payloads are not`() {
        assertTrue(MimeTypes.isCompressible(MimeTypes.forPath("app.js")))
        assertTrue(MimeTypes.isCompressible(MimeTypes.forPath("style.css")))
        assertTrue(MimeTypes.isCompressible(MimeTypes.forPath("data.json")))
        assertTrue(MimeTypes.isCompressible(MimeTypes.forPath("icon.svg")))
    }

    @Test
    fun `already compressed payloads are never gzipped again`() {
        for (path in listOf(
            "vazirmatn.woff2", "shot.webp", "video.mp4", "sound.mp3",
            "bundle.wasm", "archive.zip", "texture.ktx2", "icon.png"
        )) {
            assertFalse(
                "$path must not be gzipped",
                MimeTypes.isCompressible(path, MimeTypes.forPath(path))
            )
        }
    }

    @Test
    fun `textual detection covers the entry document`() {
        assertTrue(MimeTypes.isTextual(MimeTypes.forPath("index.html")))
        assertTrue(MimeTypes.isTextual(MimeTypes.forPath("app.js")))
        assertFalse(MimeTypes.isTextual(MimeTypes.forPath("clip.mp4")))
    }
}
