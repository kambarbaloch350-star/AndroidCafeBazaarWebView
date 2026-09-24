package com.chistan.quickgames

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CompatInjectorTest {

    private val url = "/__native/compat.js"
    private val tag = "<script src=\"$url\"></script>"

    @Test
    fun `script goes right before the closing head tag`() {
        val html = "<!doctype html><html><head><meta charset=\"utf-8\">" +
                "<script type=\"module\" src=\"/assets/index.js\"></script></head><body></body></html>"
        val out = CompatInjector.inject(html, url)
        assertEquals(
            "<!doctype html><html><head><meta charset=\"utf-8\">" +
                    "<script type=\"module\" src=\"/assets/index.js\"></script>$tag</head><body></body></html>",
            out
        )
    }

    @Test
    fun `closing head tag is matched case insensitively and with whitespace`() {
        val html = "<HTML><HEAD><title>x</title></HEAD ><BODY></BODY></HTML>"
        val out = CompatInjector.inject(html, url)
        assertEquals("<HTML><HEAD><title>x</title>$tag</HEAD ><BODY></BODY></HTML>", out)
    }

    @Test
    fun `falls back to the opening head tag when head is never closed`() {
        val html = "<html><head lang=\"fa\"><meta charset=\"utf-8\"><body>hi</body></html>"
        val out = CompatInjector.inject(html, url)
        assertEquals("<html><head lang=\"fa\">$tag<meta charset=\"utf-8\"><body>hi</body></html>", out)
    }

    @Test
    fun `header elements are not mistaken for head`() {
        val html = "<html><body><header>x</header></body></html>"
        val out = CompatInjector.inject(html, url)
        assertEquals("<html>$tag<body><header>x</header></body></html>", out)
    }

    @Test
    fun `fragments without html get the script first`() {
        assertEquals("$tag<p>hi</p>", CompatInjector.inject("<p>hi</p>", url))
    }

    @Test
    fun `injection is idempotent`() {
        val once = CompatInjector.inject("<html><head></head><body></body></html>", url)
        val twice = CompatInjector.inject(once, url)
        assertEquals(once, twice)
        assertTrue(once.indexOf(url) == once.lastIndexOf(url))
    }
}
