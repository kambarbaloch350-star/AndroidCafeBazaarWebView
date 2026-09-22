package com.emochi.quickgames

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Shader
import android.util.AttributeSet
import android.view.animation.LinearInterpolator
import androidx.appcompat.widget.AppCompatTextView
import androidx.core.content.ContextCompat

/**
 * ShimmerTextView
 * ===============
 *
 * The app title on the loading screen. Instead of being painted flat, a soft
 * light band keeps travelling across the letters: the text colour stays green
 * while a lighter highlight sweeps over it every couple of seconds.
 *
 * Implementation notes
 * --------------------
 *  · The band is a [LinearGradient] installed on the view's own text paint and
 *    moved with a [Matrix] – no layers, no bitmaps, one invalidate per frame
 *    while the shimmer is running.
 *  · The animation only lives while the view is attached and [start] has been
 *    called, so the loading screen costs nothing once it is gone.
 */
class ShimmerTextView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : AppCompatTextView(context, attrs, defStyleAttr) {

    private val baseColor = ContextCompat.getColor(context, R.color.loading_title)
    private val highlightColor = ContextCompat.getColor(context, R.color.green_400)

    private val shaderMatrix = Matrix()
    private var shader: LinearGradient? = null
    private var animator: ValueAnimator? = null

    /** -1 … 1 sweep position, mapped over the view width. */
    private var phase = 0f

    private val update = ValueAnimator.AnimatorUpdateListener { value ->
        phase = value.animatedValue as Float
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        shader = if (w > 0) {
            LinearGradient(
                0f, 0f, w.toFloat(), 0f,
                intArrayOf(baseColor, highlightColor, baseColor),
                // A narrow highlight band instead of a soft wash.
                floatArrayOf(0f, 0.5f, 1f),
                Shader.TileMode.CLAMP
            )
        } else {
            null
        }
    }

    override fun onDraw(canvas: Canvas) {
        val gradient = shader
        if (gradient == null) {
            super.onDraw(canvas)
            return
        }
        // The band is one view-width wide and travels from left to right.
        shaderMatrix.setTranslate(phase * width, 0f)
        gradient.setLocalMatrix(shaderMatrix)
        paint.shader = gradient
        super.onDraw(canvas)
    }

    /** Starts the sweep. Safe to call repeatedly. */
    fun start() {
        if (animator != null || width == 0) return
        animator = ValueAnimator.ofFloat(-1f, 1f).apply {
            duration = 2200L
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.RESTART
            interpolator = LinearInterpolator()
            // A short pause between sweeps keeps it elegant instead of busy.
            startDelay = 500L
            addUpdateListener(update)
            start()
        }
    }

    /** Stops the sweep and releases the animator. */
    fun stop() {
        animator?.let {
            it.removeUpdateListener(update)
            it.cancel()
        }
        animator = null
        paint.shader = null
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (width > 0) start()
    }

    override fun onDetachedFromWindow() {
        stop()
        super.onDetachedFromWindow()
    }
}
