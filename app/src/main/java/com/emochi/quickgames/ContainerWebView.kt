package com.emochi.quickgames

import android.content.Context
import android.util.AttributeSet
import android.view.ActionMode
import android.view.HapticFeedbackConstants
import android.view.View
import android.webkit.WebView

/**
 * ContainerWebView
 * ================
 *
 * A [WebView] that behaves like a **game surface**, not like a document:
 *
 *  · **No text selection, no copy.** Long-pressing used to start the selection
 *    handle and raise the copy/paste toolbar; both entry points
 *    ([startActionMode]) are refused and the long press is consumed, so nothing
 *    can be selected, copied or shared out of a page.
 *  · **No long-press buzz.** The platform fires
 *    [HapticFeedbackConstants.LONG_PRESS] when a hold gesture is recognised on a
 *    selectable element – that is the vibration a browser makes. It is
 *    suppressed here ([performHapticFeedback] always answers `false`), while
 *    deliberate vibration requested by the WebApp keeps working (a WebApp that
 *    calls `navigator.vibrate()` is not affected; only the platform's own
 *    long-press feedback is).
 *
 * Everything else is inherited unchanged, so rendering, media, canvas and the
 * JavaScript bridge are untouched.
 */
class ContainerWebView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : WebView(context, attrs, defStyleAttr) {

    init {
        // The long press must never reach the selection machinery.
        isLongClickable = false
        isHapticFeedbackEnabled = false
        setOnLongClickListener { true }
    }

    /** Suppresses the platform's own long-press / click haptics. */
    override fun performHapticFeedback(feedbackConstant: Int): Boolean = false

    override fun performHapticFeedback(feedbackConstant: Int, flags: Int): Boolean = false

    /** Refuses the floating (text selection) action mode. */
    override fun startActionMode(callback: ActionMode.Callback?, type: Int): ActionMode? = null

    /** Refuses the classic (text selection / copy) action mode. */
    override fun startActionMode(callback: ActionMode.Callback?): ActionMode? = null

    /**
     * Belt and braces: some OEM WebViews still raise the selection toolbar from
     * inside the long-click handling, which never reaches [startActionMode].
     */
    override fun onLongClick(view: View?): Boolean = true
}
