package com.chistan.quickgames

/**
 * CompatInjector
 * ==============
 *
 * Adds the container's compatibility script (`assets/native/compat.js`, served
 * at `/__native/compat.js`) to an HTML document of the packaged WebApp.
 *
 * The tag is a classic, blocking `<script>` placed at the **end of `<head>`**:
 *
 *  · it runs before any `type="module"` bundle (module scripts are deferred
 *    until the document is parsed), so the polyfills exist when the game's
 *    code evaluates – `Object.hasOwn`, `Array.prototype.at`, … are missing
 *    on the WebViews still found on Android 7–10 devices that never received
 *    a Play update, and a Vite bundle uses them unguarded;
 *  · it runs after the document's `<meta>` tags, so the rendering policy it
 *    applies (`<meta name="native-offscreen-canvas">`, …) can be read.
 *
 * Pure string manipulation, no DOM: the entry document of a Vite/webpack build
 * is a few kilobytes, and the rewrite is done once per request in memory.
 */
object CompatInjector {

    /** Marker used to keep the injection idempotent. */
    private const val MARKER = "__native/compat.js"

    private val HEAD_CLOSE = Regex("</head\\s*>", RegexOption.IGNORE_CASE)
    private val HEAD_OPEN = Regex("<head(\\s[^>]*)?>", RegexOption.IGNORE_CASE)
    private val HTML_OPEN = Regex("<html(\\s[^>]*)?>", RegexOption.IGNORE_CASE)

    /**
     * @return [html] with the script tag inserted, or [html] unchanged when it
     *         already references the compat script or is not an HTML document.
     */
    fun inject(html: String, scriptUrl: String): String {
        if (html.contains(MARKER)) return html
        val tag = "<script src=\"$scriptUrl\"></script>"

        HEAD_CLOSE.find(html)?.let { m ->
            return html.substring(0, m.range.first) + tag + html.substring(m.range.first)
        }
        HEAD_OPEN.find(html)?.let { m ->
            return html.substring(0, m.range.last + 1) + tag + html.substring(m.range.last + 1)
        }
        HTML_OPEN.find(html)?.let { m ->
            return html.substring(0, m.range.last + 1) + tag + html.substring(m.range.last + 1)
        }
        // Fragment without <html>/<head> (unusual, but still a document the
        // WebView will render): the script goes first.
        return tag + html
    }
}
