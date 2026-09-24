package com.chistan.quickgames

import android.webkit.MimeTypeMap
import java.util.Locale

/**
 * MIME resolution for the embedded HTTP server.
 *
 * The platform `MimeTypeMap` is used as a fallback, but the explicit table
 * below is authoritative because several modern WebApp formats are either
 * missing or wrong on older Android releases (notably `.wasm`, `.mjs`, `.webp`
 * and the font formats).
 */
object MimeTypes {

    private const val DEFAULT = "application/octet-stream"

    private val EXPLICIT: Map<String, String> = mapOf(
        // Documents
        "html" to "text/html; charset=utf-8",
        "htm" to "text/html; charset=utf-8",
        "xhtml" to "application/xhtml+xml",
        "txt" to "text/plain; charset=utf-8",
        "xml" to "application/xml; charset=utf-8",

        // Scripts & data
        "js" to "text/javascript; charset=utf-8",
        "mjs" to "text/javascript; charset=utf-8",
        "cjs" to "text/javascript; charset=utf-8",
        "jsx" to "text/javascript; charset=utf-8",
        "json" to "application/json; charset=utf-8",
        "jsonld" to "application/ld+json; charset=utf-8",
        "map" to "application/json; charset=utf-8",
        "webmanifest" to "application/manifest+json; charset=utf-8",
        "wasm" to "application/wasm",
        "data" to "application/octet-stream",
        "csv" to "text/csv; charset=utf-8",

        // Styles
        "css" to "text/css; charset=utf-8",

        // Images
        "png" to "image/png",
        "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg",
        "jfif" to "image/jpeg",
        "gif" to "image/gif",
        "webp" to "image/webp",
        "avif" to "image/avif",
        "bmp" to "image/bmp",
        "ico" to "image/x-icon",
        "svg" to "image/svg+xml",
        "svgz" to "image/svg+xml",

        // Fonts
        "woff" to "font/woff",
        "woff2" to "font/woff2",
        "ttf" to "font/ttf",
        "otf" to "font/otf",
        "eot" to "application/vnd.ms-fontobject",

        // Audio
        "mp3" to "audio/mpeg",
        "m4a" to "audio/mp4",
        "aac" to "audio/aac",
        "oga" to "audio/ogg",
        "ogg" to "audio/ogg",
        "opus" to "audio/ogg",
        "wav" to "audio/wav",
        "weba" to "audio/webm",
        "flac" to "audio/flac",
        "mid" to "audio/midi",
        "midi" to "audio/midi",

        // Video
        "mp4" to "video/mp4",
        "m4v" to "video/mp4",
        "webm" to "video/webm",
        "ogv" to "video/ogg",
        "mov" to "video/quicktime",
        "mkv" to "video/x-matroska",
        "ts" to "video/mp2t",

        // Archives / misc
        "zip" to "application/zip",
        "gz" to "application/gzip",
        "pdf" to "application/pdf",
        "glb" to "model/gltf-binary",
        "gltf" to "model/gltf+json",
        "hdr" to "image/vnd.radiance",
        "ktx2" to "image/ktx2",
        "basis" to "application/octet-stream",
        "bin" to "application/octet-stream",
        "plist" to "application/xml"
    )

    private val COMPRESSIBLE_PREFIXES = listOf(
        "text/",
        "application/javascript",
        "application/json",
        "application/xml",
        "application/manifest+json",
        "application/ld+json",
        "image/svg+xml",
        "font/woff",
        "font/ttf",
        "font/otf",
        "application/vnd.ms-fontobject"
    )

    /** Never gzip these: already compressed or expensive to buffer. */
    private val INCOMPRESSIBLE_EXTENSIONS = setOf(
        "png", "jpg", "jpeg", "gif", "webp", "avif", "woff2",
        "mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac",
        "mp4", "webm", "m4v", "ogv", "mov", "mkv",
        "zip", "gz", "pdf", "wasm", "ktx2", "basis"
    )

    fun extensionOf(path: String): String {
        val name = path.substringAfterLast('/')
        val dot = name.lastIndexOf('.')
        if (dot < 0 || dot == name.length - 1) return ""
        return name.substring(dot + 1).lowercase(Locale.ROOT)
    }

    /** @return a complete `Content-Type` header value (may include charset). */
    fun forPath(path: String): String {
        val ext = extensionOf(path)
        EXPLICIT[ext]?.let { return it }
        if (ext.isEmpty()) return DEFAULT
        val fromPlatform = try {
            MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
        } catch (e: Exception) {
            null
        }
        return fromPlatform ?: DEFAULT
    }

    /** True when the payload is textual (or otherwise safe to gzip). */
    fun isCompressible(mimeType: String): Boolean {
        val mime = mimeType.substringBefore(';').trim().lowercase(Locale.ROOT)
        if (mime == DEFAULT) return false
        return COMPRESSIBLE_PREFIXES.any { mime.startsWith(it) }
    }

    /** Same as [isCompressible] but also honours known-binary extensions. */
    fun isCompressible(path: String, mimeType: String): Boolean {
        if (extensionOf(path) in INCOMPRESSIBLE_EXTENSIONS) return false
        return isCompressible(mimeType)
    }

    /** True when the payload should be treated as text. */
    fun isTextual(mimeType: String): Boolean {
        val mime = mimeType.substringBefore(';').trim().lowercase(Locale.ROOT)
        return mime.startsWith("text/") ||
                mime.contains("json") ||
                mime.contains("javascript") ||
                mime.contains("xml") ||
                mime == "image/svg+xml"
    }
}
