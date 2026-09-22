package com.emochi.quickgames

import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.animation.ValueAnimator
import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.view.View
import android.view.Window
import android.view.WindowManager
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.LinearInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.TextView

/**
 * ExitConfirmationDialog
 * ======================
 *
 * "می‌خواهید از بازی خارج شوید؟" – the light green, animated confirmation sheet
 * shown when the player presses back and the game has nothing left to go back
 * to.
 *
 * The card contains the brand badge, the question, the rating nudge
 * ("امتیاز دادن به لبزبند کمک زیادی به ما می‌کند.") and three staggered actions:
 * **امتیاز بده** (CafeBazaar rating intent), **انصراف** and **خروج**.
 *
 * Animations: the window pops in through `@anim/dialog_enter`, the content is
 * revealed with a stagger, the badge floats and its halo breathes for as long
 * as the dialog lives. Every animator is cancelled in [dismiss] so a closed
 * dialog never keeps a reference to the Activity alive.
 *
 * Back press / tap outside = cancel (never "exit"); only the red button leaves
 * the app.
 */
class ExitConfirmationDialog(
    context: Context,
    private val callbacks: Callbacks
) : Dialog(context, R.style.Theme_QuickGames_ExitDialog) {

    /** What the player chose. */
    interface Callbacks {
        /** "امتیاز بده" – open the CafeBazaar rating page. */
        fun onRateRequested()

        /** "خروج" – really leave the app. */
        fun onExitConfirmed()

        /** "انصراف" / back / tap outside – stay in the game. */
        fun onDismissed()
    }

    private val animators = mutableListOf<ObjectAnimator>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestWindowFeature(Window.FEATURE_NO_TITLE)
        setContentView(R.layout.dialog_exit)
        setCanceledOnTouchOutside(true)

        window?.let { window ->
            window.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            window.setDimAmount(0.42f)
            window.setLayout(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT
            )
        }

        // RTL: the card mirrors correctly even on an English device.
        findViewById<View>(R.id.exitCard)?.layoutDirection = View.LAYOUT_DIRECTION_RTL

        findViewById<View>(R.id.exitRateButton)?.setOnClickListener {
            press(it) {
                closeSilently()
                callbacks.onRateRequested()
            }
        }
        findViewById<View>(R.id.exitCancelButton)?.setOnClickListener {
            press(it) { closeAndNotify() }
        }
        findViewById<View>(R.id.exitQuitButton)?.setOnClickListener {
            press(it) {
                closeSilently()
                callbacks.onExitConfirmed()
            }
        }

        // Back / outside tap means "stay in the game".
        setOnCancelListener { callbacks.onDismissed() }
    }

    /** Tiny press feedback, then the action – so a tap always feels answered. */
    private fun press(view: View, action: () -> Unit) {
        view.animate().cancel()
        view.animate()
            .scaleX(0.96f)
            .scaleY(0.96f)
            .setDuration(70)
            .withEndAction {
                view.scaleX = 1f
                view.scaleY = 1f
                action()
            }
            .start()
    }

    override fun show() {
        super.show()
        playIntro()
    }

    /** Staggered reveal of the card content: badge, copy, then the actions. */
    private fun playIntro() {
        val badge = findViewById<View>(R.id.exitBadge) ?: return
        val halo = findViewById<View>(R.id.exitBadgeHalo)
        val title = findViewById<View>(R.id.exitTitle)
        val message = findViewById<View>(R.id.exitMessage)
        val actions = listOfNotNull(
            findViewById<View>(R.id.exitRateButton),
            findViewById<View>(R.id.exitCancelButton),
            findViewById<View>(R.id.exitQuitButton)
        )

        listOfNotNull(badge, title, message).plus(actions).forEach {
            it.alpha = 0f
            it.translationY = 14f * it.resources.displayMetrics.density
        }

        fadeIn(badge, delay = 40L, overshoot = false)
        title?.let { fadeIn(it, delay = 140L, overshoot = true) }
        message?.let { fadeIn(it, delay = 220L, overshoot = true) }
        actions.forEachIndexed { index, view -> fadeIn(view, delay = 300L + index * 80L, overshoot = true) }

        // The badge floats up and down, its halo breathes: alive, never busy.
        val float = ObjectAnimator.ofPropertyValuesHolder(
            badge,
            PropertyValuesHolder.ofFloat(
                View.TRANSLATION_Y,
                0f,
                -7f * badge.resources.displayMetrics.density
            )
        ).apply {
            duration = 1600L
            repeatMode = ValueAnimator.REVERSE
            repeatCount = ValueAnimator.INFINITE
            startDelay = 320L
            interpolator = AccelerateDecelerateInterpolator()
        }
        animators += float.also { it.start() }

        halo?.let {
            it.scaleX = 0.92f
            it.scaleY = 0.92f
            it.alpha = 0.55f
            val pulse = ObjectAnimator.ofPropertyValuesHolder(
                it,
                PropertyValuesHolder.ofFloat(View.SCALE_X, 0.92f, 1.1f),
                PropertyValuesHolder.ofFloat(View.SCALE_Y, 0.92f, 1.1f),
                PropertyValuesHolder.ofFloat(View.ALPHA, 0.55f, 0.16f)
            ).apply {
                duration = 1400L
                repeatMode = ValueAnimator.REVERSE
                repeatCount = ValueAnimator.INFINITE
                interpolator = LinearInterpolator()
            }
            animators += pulse.also { it.start() }
        }
    }

    private fun fadeIn(view: View, delay: Long, overshoot: Boolean) {
        view.animate()
            .alpha(1f)
            .translationY(0f)
            .setStartDelay(delay)
            .setDuration(240)
            .setInterpolator(if (overshoot) OvershootInterpolator(0.9f) else LinearInterpolator())
            .start()
    }

    /** Closes without telling the callbacks (the caller already acted). */
    private fun closeSilently() {
        setOnCancelListener(null)
        stopAnimations()
        dismiss()
    }

    /** Closes and reports "the player stayed in the game". */
    private fun closeAndNotify() {
        setOnCancelListener(null)
        stopAnimations()
        callbacks.onDismissed()
        dismiss()
    }

    private fun stopAnimations() {
        animators.forEach { it.cancel() }
        animators.clear()
    }

    override fun onStop() {
        stopAnimations()
        super.onStop()
    }
}
