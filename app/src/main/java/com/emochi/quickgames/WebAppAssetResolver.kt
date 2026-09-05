package com.emochi.quickgames

import android.content.Context
import android.net.Uri
import android.webkit.MimeTypeMap
import android.webkit.WebResourceResponse
import java.io.File
import java.io.InputStream
import java.util.Locale

/**
 * WebAppAssetResolver
 * Resolves local assets for HTML5 games and Node.js bundled builds (Vite, Webpack, React, Vue, Phaser).
 * Handles:
 * 1. Virtual HTTPS domain (https://appassets.androidplatform.net/) to fix ES Module and CORS restrictions.
 * 2. Dual-directory resolution (assets/ or assets/dist/).
 * 3. Extended MIME types for games (.wasm, .mjs, .ogg, .mp3, .wav, .json, .webp).
 * 4. Fallback to index.html for Single Page Applications (SPA client-side routing).
 */
class WebAppAssetResolver(private val context: Context) {

    companion object {
        const val ASSET_DOMAIN = "appassets.androidplatform.net"
        const val ASSET_PREFIX = "https://$ASSET_DOMAIN/"
        const val VIRTUAL_BASE_URL = "https://$ASSET_DOMAIN/index.html"
    }

    private val assetManager = context.assets

    /**
     * Cache whether dist/ subdirectory exists inside assets/
     */
    private val hasDistFolder: Boolean by lazy {
        try {
            val list = assetManager.list("dist")
            !list.isNullOrEmpty()
        } catch (e: Exception) {
            false
        }
    }

    fun findEntryPointUrl(): String {
        return VIRTUAL_BASE_URL
    }

    fun resolve(uri: Uri): WebResourceResponse? {
        val host = uri.host ?: return null
        if (!host.equals(ASSET_DOMAIN, ignoreCase = true)) {
            return null
        }

        var path = uri.path ?: ""
        if (path.startsWith("/")) {
            path = path.substring(1)
        }
        if (path.isEmpty()) {
            path = "index.html"
        }

        val candidates = mutableListOf<String>()
        if (hasDistFolder) {
            if (!path.startsWith("dist/")) {
                candidates.add("dist/$path")
            }
            candidates.add(path)
        } else {
            candidates.add(path)
            if (path.startsWith("assets/")) {
                candidates.add(path.substring("assets/".length))
            }
        }

        for (candidate in candidates) {
            val stream = openAssetStream(candidate)
            if (stream != null) {
                val mimeType = getMimeType(candidate)
                val encoding = if (isTextMime(mimeType)) "UTF-8" else null
                return WebResourceResponse(mimeType, encoding, stream)
            }
        }

        // SPA routing fallback: If no file extension and requesting an HTML route, serve index.html
        if (!path.contains(".") || path.endsWith(".html")) {
            val fallback = if (hasDistFolder) "dist/index.html" else "index.html"
            val fallbackStream = openAssetStream(fallback)
            if (fallbackStream != null) {
                return WebResourceResponse("text/html", "UTF-8", fallbackStream)
            }
        }

        return null
    }

    private fun openAssetStream(assetPath: String): InputStream? {
        return try {
            assetManager.open(assetPath)
        } catch (e: Exception) {
            null
        }
    }

    fun getMimeType(path: String): String {
        val extension = File(path).extension.lowercase(Locale.ROOT)
        return when (extension) {
            "html", "htm" -> "text/html"
            "js", "mjs" -> "application/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "svg" -> "image/svg+xml"
            "webp" -> "image/webp"
            "ico" -> "image/x-icon"
            "wasm" -> "application/wasm"
            "mp3" -> "audio/mpeg"
            "ogg" -> "audio/ogg"
            "wav" -> "audio/wav"
            "m4a" -> "audio/mp4"
            "mp4" -> "video/mp4"
            "webm" -> "video/webm"
            "woff" -> "font/woff"
            "woff2" -> "font/woff2"
            "ttf" -> "font/ttf"
            "otf" -> "font/otf"
            "txt" -> "text/plain"
            "xml" -> "text/xml"
            else -> {
                val fromMap = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
                fromMap ?: "application/octet-stream"
            }
        }
    }

    private fun isTextMime(mimeType: String): Boolean {
        return mimeType.startsWith("text/") ||
                mimeType == "application/javascript" ||
                mimeType == "application/json" ||
                mimeType == "image/svg+xml" ||
                mimeType == "text/css"
    }
}
