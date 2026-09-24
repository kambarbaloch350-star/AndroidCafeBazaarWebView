package com.chistan.quickgames

import android.content.Context
import android.content.res.AssetManager
import java.io.File
import java.io.FileInputStream
import java.io.InputStream

/**
 * Abstraction over the storage the WebApp bundle is served from.
 *
 * The production implementation reads from the APK's `assets/` directory, while
 * the JVM unit tests point at a real directory on disk. Keeping this seam means
 * the HTTP server itself – routing, MIME types, gzip, ETag, SPA fallback – is
 * covered by plain unit tests without an emulator.
 */
interface WebAssetSource {

    /** Paths are relative to the asset namespace, e.g. `web/index.html`. */
    fun open(path: String): InputStream?

    fun exists(path: String): Boolean

    /** True when [path] is missing or an empty directory. */
    fun isEmptyDir(path: String): Boolean

    /** @return the total size in bytes, or -1 when unknown. */
    fun length(path: String): Long = open(path)?.use { stream ->
        try {
            stream.available().toLong()
        } catch (e: Exception) {
            -1L
        }
    } ?: -1L
}

/** Reads the WebApp bundle straight from the APK (`app/src/main/assets/`). */
class AndroidWebAssetSource(context: Context) : WebAssetSource {

    private val assets: AssetManager = context.applicationContext.assets

    override fun open(path: String): InputStream? = try {
        assets.open(path)
    } catch (e: Exception) {
        null
    }

    override fun exists(path: String): Boolean = try {
        assets.open(path).use { }
        true
    } catch (e: Exception) {
        false
    }

    override fun isEmptyDir(path: String): Boolean = try {
        assets.list(path).isNullOrEmpty()
    } catch (e: Exception) {
        true
    }
}

/** Reads the WebApp bundle from an unpacked directory (unit tests, tooling). */
class DirectoryWebAssetSource(private val root: File) : WebAssetSource {

    private fun file(path: String): File? {
        val clean = path.trimStart('/')
        if (clean.contains("..")) return null
        val candidate = File(root, clean)
        return if (candidate.canonicalPath.startsWith(root.canonicalPath)) candidate else null
    }

    override fun open(path: String): InputStream? {
        val f = file(path) ?: return null
        if (!f.isFile) return null
        return try {
            FileInputStream(f)
        } catch (e: Exception) {
            null
        }
    }

    override fun exists(path: String): Boolean = file(path)?.isFile == true

    override fun isEmptyDir(path: String): Boolean {
        val f = file(path) ?: return true
        return !f.isDirectory || f.list()?.isEmpty() != false
    }
}
