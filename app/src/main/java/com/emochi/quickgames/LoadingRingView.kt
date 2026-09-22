package com.emochi.quickgames

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.SweepGradient
import android.util.AttributeSet
import android.view.View
import android.view.animation.AccelerateDecelerateInterpolator
import androidx.core.content.ContextCompat
import kotlin.math.sin

/**
 * LoadingRingView
 * ===============
 *
 * The rotating comet ring drawn around the Labzband logo on the native loading
 * screen: a faint full circle plus a green sweep-gradient arc whose length
 * breathes while the whole thing turns.
 *
 * It is a plain [View] (no dependency, no Lottie, no animation drawable per
 * frame) so it stays cheap on low-end devices: one shader rebuild on size
 * change, one [ValueAnimator] while it is running.
 *
 * The animation is always started/stopped explicitly by the host
 * ([start] / [stop]) so nothing keeps burning frames once the loading screen is
 * gone.
 */
class LoadingRingView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private val density = resources.displayMetrics.density

    /** Ring thickness – a hairline that scales with the screen density. */
    private val strokeWidth = 3.5f * density

    private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeWidth = this@LoadingRingView.strokeWidth
        color = ContextCompat.getColor(context, R.color.plate_inner_ring)
    }

    private val arcPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeWidth = this@LoadingRingView.strokeWidth
    }

    private val bounds = RectF()
    private val shaderMatrix = Matrix()
    private var shader: SweepGradient? = null

    /** 0…1 progress of the running animation. */
    private var phase = 0f

    private var animator: ValueAnimator? = null

    private val update = ValueAnimator.AnimatorUpdateListener { value ->
        phase = value.animatedValue as Float
        invalidate()
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val cx = w / 2f
        val cy = h / 2f
        shader = SweepGradient(
            cx,
            cy,
            intArrayOf(
                ContextCompat.getColor(context, R.color.plate_ring),
                ContextCompat.getColor(context, R.color.green_600),
                ContextCompat.getColor(context, R.color.plate_ring)
            ),
            floatArrayOf(0f, 0.45f, 1f)
        )
        arcPaint.shader = shader
        val inset = strokeWidth / 2f + density
        bounds.set(inset, inset, w - inset, h - inset)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val cx = width / 2f
        val cy = height / 2f

        canvas.drawArc(bounds, 0f, 360f, false, trackPaint)

        // The sweep grows and shrinks so the ring feels alive instead of
        // mechanically spinning at a constant length.
        val breathe = (sin(phase * 2.0 * Math.PI).toFloat() + 1f) / 2f // 0…1
        val sweep = 70f + 130f * breathe

        shader?.let {
            shaderMatrix.setRotate(phase * 360f, cx, cy)
            it.setLocalMatrix(shaderMatrix)
        }
        canvas.drawArc(bounds, phase * 360f, sweep, false, arcPaint)
    }

    /** Starts (or restarts) the ring animation. Safe to call repeatedly. */
    fun start() {
        if (animator != null) return
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 1900L
            repeatCount = ValueAnimator.INFINITE
            interpolator = AccelerateDecelerateInterpolator()
            addUpdateListener(update)
            start()
        }
    }

    /** Stops the animation and releases the animator. Safe to call repeatedly. */
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
}
