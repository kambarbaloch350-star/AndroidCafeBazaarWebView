package com.chistan.quickgames

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.util.AttributeSet
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import androidx.core.content.ContextCompat
import kotlin.math.max

/**
 * LoadingBarView
 * ==============
 *
 * The slim progress line under «لیب لوڈ بوھگ ءَ ایں۔» on the loading screen: a
 * pale green rounded track with a green gradient segment sliding along it.
 *
 * There is no circling, no spinner and no ring – just a calm, premium-looking
 * indeterminate bar (~140 dp wide, 4 dp high) that says "working" without
 * shouting.
 */
class LoadingBarView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private val density = resources.displayMetrics.density

    private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        color = ContextCompat.getColor(context, R.color.loading_spinner_track)
    }

    private val barPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.FILL
        shader = LinearGradient(
            0f, 0f, 1f, 0f,
            intArrayOf(
                ContextCompat.getColor(context, R.color.plate_ring),
                ContextCompat.getColor(context, R.color.green_600)
            ),
            null,
            Shader.TileMode.CLAMP
        )
    }

    private val trackBounds = RectF()
    private val barBounds = RectF()

    /** 0…1 position of the travelling segment. */
    private var progress = 0f

    private var animator: ValueAnimator? = null

    private val update = ValueAnimator.AnimatorUpdateListener { value ->
        progress = value.animatedValue as Float
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val radius = h / 2f
        trackBounds.set(0f, 0f, w.toFloat(), h.toFloat())
        (barPaint.shader as? LinearGradient)?.let {
            it.setLocalMatrix(null)
        }
        trackRadius = radius
    }

    private var trackRadius = 0f

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()

        canvas.drawRoundRect(trackBounds, trackRadius, trackRadius, trackPaint)

        // The segment is a fifth of the track, eased so it slows at both ends the
        // way a real progress indicator feels.
        val segment = max(w * 0.22f, h)
        val travel = w - segment
        val left = travel * progress
        barBounds.set(left, 0f, left + segment, h)
        canvas.drawRoundRect(barBounds, trackRadius, trackRadius, barPaint)
    }

    /** Starts the sliding animation. Safe to call repeatedly. */
    fun start() {
        if (animator != null) return
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 1500L
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.RESTART
            interpolator = AccelerateDecelerateInterpolator()
            addUpdateListener(update)
            start()
        }
    }

    /** Stops the animation and releases the animator. */
    fun stop() {
        animator?.let {
            it.removeUpdateListener(update)
            it.cancel()
        }
        animator = null
    }

    override fun onDetachedFromWindow() {
        stop()
        super.onDetachedFromWindow()
    }

    /** Unused colour helper kept intentionally close to the paint setup. */
    internal fun dp(value: Float): Float = value * density
}
