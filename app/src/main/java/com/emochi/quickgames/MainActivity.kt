package com.emochi.quickgames

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * MainActivity – the native container.
 *
 * Boot sequence (strictly ordered, no arbitrary delays):
 *
 * ```
 *  1. Native loading plate appears immediately (green plate + Vazirmatn + RTL)
 *  2. Local HTTP server starts on a worker thread   -> "راهاندازی سرور داخلی"
 *  3. WebView is created, tuned and attached        -> "آمادهسازی نمایشگر وب"
 *  4. WebView loads http://127.0.0.1:<port>/index.html
 *  5. onPageFinished                                -> "در انتظار آمادهشدن برنامه"
 *  6. WebApp calls NativeApp.appReady()
 *  7. Plate fades out, WebView becomes interactive
 * ```
 *
 * Any failure before step 6 lands in the error/retry state instead of leaving
 * the user in front of a spinner forever.
 */
class MainActivity : AppCompatActivity(), WebAppBridge.HostListener {

    companion object {
        private const val TAG = "MainActivity"

        /** Time allowed for the local server to come up. */
        private const val SERVER_TIMEOUT_MS = 7_000L

        /** Time allowed for the initial document load. */
        private const val PAGE_LOAD_TIMEOUT_MS = 30_000L

        /** Time the WebApp has to report readiness after the page finished. */
        private const val APP_READY_TIMEOUT_MS = 45_000L

        /** Delay before asking for the notification permission (after first paint). */
        private const val NOTIFICATION_PERMISSION_DELAY_MS = 900L
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------
    private lateinit var webViewContainer: FrameLayout
    private lateinit var loadingOverlay: View
    private lateinit var loadingContent: View
    private lateinit var loadingStage: TextView
    private lateinit var errorContent: View
    private lateinit var errorMessage: TextView
    private lateinit var nativeAdPlate: View
    private lateinit var nativeAdContainer: FrameLayout
    private lateinit var nativeAdStatus: TextView
    private lateinit var fullscreenContainer: FrameLayout

    // ---------------------------------------------------------------------
    // Core components
    // ---------------------------------------------------------------------
    private var webView: WebView? = null
    private var billingManager: CafeBazaarBillingManager? = null
    private var tapsellManager: TapsellManager? = null
    private var bridge: WebAppBridge? = null
    private var backCallback: OnBackPressedCallback? = null

    // ---------------------------------------------------------------------
    // State
    // ---------------------------------------------------------------------
    private val handler = Handler(Looper.getMainLooper())
    private val bootExecutor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "container-boot").apply { isDaemon = true }
    }

    @Volatile
    private var isWebAppReady = false

    @Volatile
    private var isBootFailed = false

    @Volatile
    private var serverReady = false

    private val bootStarted = AtomicBoolean(false)
    private var bootToken = 0

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    private var pendingDeepLinkRoute: String? = null

    // ---------------------------------------------------------------------
    // Activity results
    // ---------------------------------------------------------------------
    private var fileChooserCallback: android.webkit.ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileChooserCallback
            fileChooserCallback = null
            if (callback == null) return@registerForActivityResult

            val data = result.data
            val uris: Array<Uri>? = when {
                result.resultCode != RESULT_OK -> null
                data?.clipData != null -> {
                    val clip = data.clipData!!
                    Array(clip.itemCount) { index -> clip.getItemAt(index).uri }
                }
                data?.data != null -> arrayOf(data.data!!)
                else -> null
            }
            runCatching { callback.onReceiveValue(uris) }
        }

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            Log.i(TAG, "POST_NOTIFICATIONS permission granted=$granted")
        }

    // =====================================================================
    // Lifecycle
    // =====================================================================

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        bindViews()
        configureSystemBars()

        // 1. Native loading plate first – before any I/O or SDK call.
        showLoadingStage(getString(R.string.loading_stage_boot))

        // Advertising + billing are native services: they warm up in parallel
        // with the WebView boot and can never block or crash the WebApp.
        tapsellManager = TapsellManager(this).also { manager ->
            manager.initialize()
        }
        billingManager = CafeBazaarBillingManager(this)

        // A notification tap (or external intent) may have opened this Activity.
        pendingDeepLinkRoute = DeepLinkBus.routeFromIntent(intent)

        startBootSequence()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLink(DeepLinkBus.routeFromIntent(intent))
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
        webView?.resumeTimers()
    }

    override fun onPause() {
        webView?.onPause()
        super.onPause()
    }

    override fun onStop() {
        // Keep JS timers running while media plays so background audio and long
        // WebAssembly tasks are not frozen mid-flight.
        if (!isAudioPlaying()) {
            webView?.pauseTimers()
        }
        super.onStop()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        bootExecutor.shutdownNow()

        val view = webView
        webView = null
        if (view != null) {
            runCatching {
                view.stopLoading()
                view.webChromeClient = null
                view.webViewClient = WebViewClient()
                (view.parent as? ViewGroup)?.removeView(view)
                view.removeAllViews()
                view.destroy()
            }
        }

        bridge?.cleanUp()
        bridge = null
        fileChooserCallback = null
        tapsellManager?.dispose()
        billingManager?.destroy()
        DeepLinkBus.markWebAppDestroyed()
        NajvaManager.detachActivity(this)

        // The local HTTP server is deliberately NOT stopped here: it is owned by
        // the process ([WebAppServerController]) so the WebView origin – and with
        // it localStorage / IndexedDB / cookies / HTTP cache – survives Activity
        // recreation (rotation, theme change, process restore).
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // The manifest declares these changes, so the Activity is not recreated
        // and the WebApp keeps its runtime state. Notify the page so it can
        // re-layout / re-measure its canvas.
        webView?.let { view ->
            val orientation =
                if (newConfig.orientation == Configuration.ORIENTATION_LANDSCAPE) "landscape"
                else "portrait"
            view.evaluateJavascript(
                "(function(){try{window.dispatchEvent(new CustomEvent('nativeapp:resize'," +
                        "{detail:{width:${view.width},height:${view.height}," +
                        "orientation:'$orientation',dpr:window.devicePixelRatio||1}}));}catch(e){}})();",
                null
            )
        }
        configureSystemBars()
    }

    // =====================================================================
    // Boot sequence
    // =====================================================================

    private fun startBootSequence() {
        if (!bootStarted.compareAndSet(false, true)) {
            Log.d(TAG, "Boot already in progress – ignoring duplicate start")
            return
        }
        val token = ++bootToken
        isBootFailed = false
        isWebAppReady = false
        serverReady = false
        showLoadingStage(getString(R.string.loading_stage_boot))

        // 2. The server must exist before the WebView can navigate.
        bootExecutor.execute {
            val started = WebAppServerController.getOrStart(applicationContext)
            handler.post {
                if (token != bootToken) return@post
                if (started == null) {
                    Log.e(TAG, "Local server failed: ${WebAppServerController.lastError}")
                    showErrorState(getString(R.string.error_message_default))
                } else {
                    serverReady = true
                    Log.i(TAG, "Local server ready on port ${started.port}")
                    attachWebView(token)
                }
            }
        }

        // Safety net: if the server never reports back, fail fast with retry.
        handler.postDelayed({
            if (token == bootToken && !serverReady && !isBootFailed) {
                Log.e(TAG, "Server start timed out")
                showErrorState(getString(R.string.error_message_default))
            }
        }, SERVER_TIMEOUT_MS)
    }

    /**
     * Creates the WebView exactly once and starts the initial navigation.
     * Re-entrant calls (retry, renderer crash recovery) reuse the instance.
     */
    private fun attachWebView(token: Int) {
        if (isBootFailed) return

        if (webView == null) {
            if (BuildConfig.DEBUG) {
                WebView.setWebContentsDebuggingEnabled(true)
            }
            val view = createWebView()
            webView = view
            webViewContainer.addView(
                view,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            )

            bridge = WebAppBridge(this, view, billingManager!!, tapsellManager!!).also { b ->
                b.hostListener = this
                b.pendingRouteForWebApp = pendingDeepLinkRoute
                view.addJavascriptInterface(b, WebAppBridge.JS_INTERFACE_NAME)
            }

            // Warm the renderer up as soon as possible.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
            }
            setupBackNavigation()
        }

        showLoadingStage(getString(R.string.loading_stage_webview))

        val entry = WebAppServerController.entryUrl()
        if (entry == null) {
            showErrorState(getString(R.string.error_message_default))
            return
        }

        // Never load twice: after a configuration change the WebView is already
        // on the target document.
        val current = webView?.url
        if (current != null && current.startsWith(entry.substringBeforeLast('/'))) {
            Log.d(TAG, "WebView already on $current – skipping duplicate load")
            onDocumentLoaded(token)
            return
        }

        webView?.loadUrl(entry)
        handler.postDelayed({ onPageLoadTimeout(token) }, PAGE_LOAD_TIMEOUT_MS)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView {
        val view = WebView(this)
        view.setBackgroundColor(getColor(R.color.webview_background))
        view.isVerticalScrollBarEnabled = true
        view.isHorizontalScrollBarEnabled = false
        view.overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
        view.settings.configureForHeavyWebApps()
        view.webViewClient = containerWebViewClient
        view.webChromeClient = containerChromeClient
        return view
    }

    /**
     * WebView tuning for demanding WebApps: large JS bundles, Canvas, WebGL,
     * WebAssembly, media playback, IndexedDB and SPA routing.
     */
    @SuppressLint("SetJavaScriptEnabled")
    private fun WebSettings.configureForHeavyWebApps() {
        // ---- JavaScript & storage ----
        javaScriptEnabled = true
        domStorageEnabled = true
        @Suppress("DEPRECATION")
        databaseEnabled = true
        javaScriptCanOpenWindowsAutomatically = true
        setSupportMultipleWindows(false)

        // ---- Layout / rendering ----
        useWideViewPort = true
        loadWithOverviewMode = true
        setSupportZoom(false)
        builtInZoomControls = false
        displayZoomControls = false
        textZoom = 100

        // ---- Media & local resources ----
        mediaPlaybackRequiresUserGesture = false
        @Suppress("DEPRECATION")
        allowFileAccess = false
        allowContentAccess = true
        @Suppress("DEPRECATION")
        allowFileAccessFromFileURLs = false
        @Suppress("DEPRECATION")
        allowUniversalAccessFromFileURLs = false
        mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE

        // ---- Caching: our server sends ETags + immutable hashed bundles ----
        cacheMode = WebSettings.LOAD_DEFAULT

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            safeBrowsingEnabled = !BuildConfig.DEBUG
        }

        // ---- AndroidX WebKit features (feature-guarded: never crash) ----
        runCatching {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.OFF_SCREEN_PRERASTER)) {
                // Smoother Canvas / WebGL / video scrolling.
                WebSettingsCompat.setOffscreenPreRaster(this, true)
            }
        }
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)
            ) {
                // WebApps own their palette; never let the platform invert them.
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(this, false)
            }
        }
    }

    // =====================================================================
    // WebViewClient
    // =====================================================================

    private val containerWebViewClient = object : WebViewClient() {

        override fun shouldInterceptRequest(
            view: WebView?,
            request: WebResourceRequest?
        ): WebResourceResponse? = null // Everything is served by our own HTTP server.

        override fun shouldOverrideUrlLoading(
            view: WebView?,
            request: WebResourceRequest?
        ): Boolean {
            val uri = request?.url ?: return false
            val scheme = uri.scheme?.lowercase(Locale.ROOT).orEmpty()

            // Same-origin navigation (assets, SPA routes scrolled via #) stays in-app.
            if (isInternalUrl(uri)) return false

            return when (scheme) {
                "http", "https" -> {
                    if (request.isForMainFrame) {
                        // External websites open in the user's browser.
                        openExternally(uri)
                        true
                    } else {
                        // Sub-resources / third-party iframes (CDNs, embeds, APIs)
                        // are allowed to load inside the WebView.
                        false
                    }
                }
                "about", "data", "blob", "javascript" -> false
                else -> {
                    // tel:, mailto:, market:, bazaar:, intent:, ...
                    openExternally(uri)
                    true
                }
            }
        }

        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            super.onPageStarted(view, url, favicon)
            if (BuildConfig.DEBUG) Log.d(TAG, "onPageStarted: $url")
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            if (BuildConfig.DEBUG) Log.d(TAG, "onPageFinished: $url")
            onDocumentLoaded(bootToken)
            bridge?.notifyContainerReady(pendingDeepLinkRoute)
        }

        override fun onReceivedError(
            view: WebView?,
            request: WebResourceRequest?,
            error: WebResourceError?
        ) {
            super.onReceivedError(view, request, error)
            if (request?.isForMainFrame == true) {
                val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) error?.errorCode else null
                Log.e(TAG, "Main-frame load error ($code): ${error?.description}")
                showErrorState(getString(R.string.error_message_webview))
            }
        }

        @Deprecated("Required for API < 23 WebView versions")
        override fun onReceivedError(
            view: WebView?,
            errorCode: Int,
            description: String?,
            failingUrl: String?
        ) {
            super.onReceivedError(view, errorCode, description, failingUrl)
            Log.e(TAG, "Legacy main-frame load error ($errorCode): $description")
            showErrorState(getString(R.string.error_message_webview))
        }

        override fun onReceivedHttpError(
            view: WebView?,
            request: WebResourceRequest?,
            errorResponse: WebResourceResponse?
        ) {
            super.onReceivedHttpError(view, request, errorResponse)
            if (request?.isForMainFrame == true) {
                val status = errorResponse?.statusCode ?: -1
                Log.e(TAG, "Main-frame HTTP error $status for ${request.url}")
                if (status >= 500) showErrorState(getString(R.string.error_message_webview))
            }
        }

        override fun onRenderProcessGone(
            view: WebView?,
            detail: RenderProcessGoneDetail?
        ): Boolean {
            // The WebApp's renderer died – typically OOM with huge canvases.
            // Recover instead of letting the whole process be torn down.
            val didCrash = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                detail?.didCrash() ?: true
            } else {
                true
            }
            Log.e(TAG, "Render process gone (crash=$didCrash) – rebuilding WebView")

            runCatching {
                (view?.parent as? ViewGroup)?.removeView(view)
                view?.destroy()
            }
            webView = null
            bridge?.cleanUp()
            bridge = null
            isWebAppReady = false
            backCallback?.isEnabled = false
            backCallback = null

            handler.postDelayed({
                bootStarted.set(false)
                startBootSequence()
            }, 400)
            return true
        }
    }

    // =====================================================================
    // WebChromeClient (media, fullscreen, console, file chooser)
    // =====================================================================

    private val containerChromeClient = object : WebChromeClient() {

        override fun onProgressChanged(view: WebView?, newProgress: Int) {
            super.onProgressChanged(view, newProgress)
            if (newProgress in 1..99 && !isWebAppReady && !isBootFailed) {
                showLoadingStage(getString(R.string.loading_stage_webapp))
            }
        }

        override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
            if (BuildConfig.DEBUG && consoleMessage != null) {
                Log.d(
                    "WebApp",
                    "[${consoleMessage.messageLevel()}] ${consoleMessage.message()} " +
                            "(${consoleMessage.sourceId()}:${consoleMessage.lineNumber()})"
                )
            }
            return true
        }

        override fun onPermissionRequest(request: PermissionRequest?) {
            // Camera / microphone are granted to our own WebApp origin only.
            val host = request?.origin?.host
            val trusted = host == "127.0.0.1" || host == "localhost"
            if (trusted) {
                runCatching { request?.grant(request.resources) }
            } else {
                runCatching { request?.deny() }
            }
        }

        override fun onGeolocationPermissionsShowPrompt(
            origin: String?,
            callback: android.webkit.GeolocationPermissions.Callback?
        ) {
            callback?.invoke(origin, false, false)
        }

        override fun onShowFileChooser(
            webView: WebView?,
            filePathCallback: android.webkit.ValueCallback<Array<Uri>>?,
            fileChooserParams: FileChooserParams?
        ): Boolean {
            // `<input type="file">` support – essential for real WebApps.
            fileChooserCallback?.onReceiveValue(null)
            fileChooserCallback = filePathCallback
            return try {
                val intent = fileChooserParams?.createIntent()
                if (intent == null) {
                    fileChooserCallback = null
                    false
                } else {
                    fileChooserLauncher.launch(intent)
                    true
                }
            } catch (e: Exception) {
                Log.w(TAG, "File chooser failed: ${e.message}")
                fileChooserCallback = null
                false
            }
        }

        override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
            if (customView != null) {
                callback?.onCustomViewHidden()
                return
            }
            if (view == null) return

            customView = view
            customViewCallback = callback

            fullscreenContainer.addView(
                view,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            )
            fullscreenContainer.visibility = View.VISIBLE
            webView?.visibility = View.INVISIBLE
            enterFullscreen()
            Log.d(TAG, "Entered fullscreen")
        }

        override fun onHideCustomView() {
            val view = customView
            customView = null
            if (view != null) {
                runCatching { fullscreenContainer.removeView(view) }
            }
            fullscreenContainer.visibility = View.GONE
            webView?.visibility = View.VISIBLE
            exitFullscreen()
            customViewCallback?.onCustomViewHidden()
            customViewCallback = null
            Log.d(TAG, "Exited fullscreen")
        }
    }

    // =====================================================================
    // WebAppBridge.HostListener
    // =====================================================================

    override fun onWebAppReady() {
        if (isWebAppReady) return
        isWebAppReady = true
        isBootFailed = false
        handler.removeCallbacksAndMessages(null)
        showLoadingStage(getString(R.string.loading_stage_finishing))

        // Give the plate one frame to paint the final stage, then fade out.
        // The WebApp is already running behind it – nothing is delayed here.
        loadingOverlay.animate()
            .alpha(0f)
            .setDuration(260)
            .withEndAction {
                loadingOverlay.visibility = View.GONE
                loadingOverlay.alpha = 1f
            }
            .start()

        // Deliver a route that arrived through a push notification tap, now that
        // the WebApp's router exists.
        handler.postDelayed({
            pendingDeepLinkRoute?.let { route ->
                DeepLinkBus.publish(route)
                pendingDeepLinkRoute = null
            }
            DeepLinkBus.flush()
        }, 120)

        // Ask for the notification permission only after a successful first
        // paint, so the system dialog never covers the loading plate.
        handler.postDelayed({
            requestNotificationPermissionIfNeeded()
        }, NOTIFICATION_PERMISSION_DELAY_MS)
    }

    override fun onWebAppError(message: String) {
        showErrorState(message)
    }

    override fun onBridgeRequestBack() {
        onBackPressedDispatcher.onBackPressed()
    }

    override fun onBridgeRequestNativeAd(
        visible: Boolean,
        x: Int,
        y: Int,
        width: Int,
        height: Int
    ) {
        if (visible) showNativeAd(x, y, width, height) else hideNativeAd()
    }

    // =====================================================================
    // Native ad plate (Tapsell)
    // =====================================================================

    private fun showNativeAd(x: Int, y: Int, width: Int, height: Int) {
        val manager = tapsellManager ?: return
        val density = resources.displayMetrics.density

        val margin = (12 * density).toInt()
        val params = nativeAdPlate.layoutParams as FrameLayout.LayoutParams
        params.width = ViewGroup.LayoutParams.MATCH_PARENT
        params.height = ViewGroup.LayoutParams.WRAP_CONTENT
        params.leftMargin = margin
        params.rightMargin = margin
        params.gravity = android.view.Gravity.BOTTOM
        // `y` is the distance of the plate from the bottom of the WebApp
        // viewport, expressed in CSS pixels (0 = bottom aligned).
        params.bottomMargin = if (y > 0) {
            (y * density).toInt().coerceAtLeast(margin)
        } else {
            margin
        }
        nativeAdPlate.layoutParams = params

        nativeAdContainer.removeAllViews()
        nativeAdStatus.visibility = View.VISIBLE
        nativeAdStatus.text = getString(R.string.native_ad_loading)
        nativeAdPlate.visibility = View.VISIBLE

        manager.attachNativeContainer(nativeAdContainer)
        if (!manager.showNative()) {
            nativeAdStatus.text = getString(R.string.native_ad_unavailable)
        }
    }

    private fun hideNativeAd() {
        tapsellManager?.destroyNative()
        nativeAdContainer.removeAllViews()
        nativeAdPlate.visibility = View.GONE
    }

    // =====================================================================
    // Loading / error UI
    // =====================================================================

    private fun showLoadingStage(stage: String) {
        if (isBootFailed) return
        loadingContent.visibility = View.VISIBLE
        errorContent.visibility = View.GONE
        loadingStage.text = stage
    }

    private fun showErrorState(message: String) {
        if (isBootFailed) return
        isBootFailed = true
        handler.removeCallbacksAndMessages(null)

        loadingOverlay.visibility = View.VISIBLE
        loadingOverlay.alpha = 1f
        loadingContent.visibility = View.GONE
        errorContent.visibility = View.VISIBLE
        errorMessage.text = message
        Log.e(TAG, "Boot failed: $message")
    }

    private fun retryBoot() {
        Log.i(TAG, "Retrying boot")
        handler.removeCallbacksAndMessages(null)
        isBootFailed = false
        isWebAppReady = false
        bootStarted.set(false)
        loadingOverlay.visibility = View.VISIBLE
        loadingOverlay.alpha = 1f
        errorContent.visibility = View.GONE
        loadingContent.visibility = View.VISIBLE
        showLoadingStage(getString(R.string.loading_stage_boot))

        val view = webView
        val token = ++bootToken
        val entry = WebAppServerController.entryUrl()
        if (view != null && entry != null && WebAppServerController.isRunning()) {
            view.loadUrl(entry)
            handler.postDelayed({ onPageLoadTimeout(token) }, PAGE_LOAD_TIMEOUT_MS)
            return
        }
        // Server is gone: rebuild the whole stack (the controller restarts it).
        if (view != null) {
            runCatching {
                (view.parent as? ViewGroup)?.removeView(view)
                view.destroy()
            }
            webView = null
            bridge?.cleanUp()
            bridge = null
            backCallback?.isEnabled = false
            backCallback = null
        }
        serverReady = false
        startBootSequence()
    }

    private fun onDocumentLoaded(token: Int) {
        if (isWebAppReady || isBootFailed) return
        showLoadingStage(getString(R.string.loading_stage_webapp))
        handler.postDelayed({ onAppReadyTimeout(token) }, APP_READY_TIMEOUT_MS)
    }

    private fun onPageLoadTimeout(token: Int) {
        if (token != bootToken || isWebAppReady || isBootFailed) return
        Log.w(TAG, "Page load timed out")
        showErrorState(getString(R.string.error_message_webview))
    }

    private fun onAppReadyTimeout(token: Int) {
        if (token != bootToken || isWebAppReady || isBootFailed) return
        Log.w(TAG, "WebApp never called NativeApp.appReady()")
        showErrorState(getString(R.string.error_message_webview))
    }

    // =====================================================================
    // Back navigation
    // =====================================================================

    private fun setupBackNavigation() {
        if (backCallback != null) return
        val callback = object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // 1. Media / canvas fullscreen closes first.
                if (customView != null) {
                    containerChromeClient.onHideCustomView()
                    return
                }
                // 2. Native ad plate.
                if (nativeAdPlate.visibility == View.VISIBLE) {
                    hideNativeAd()
                    return
                }
                // 3. Let the WebApp intercept back first (SPA history / modals).
                val view = webView
                if (view != null && isWebAppReady) {
                    view.evaluateJavascript(
                        "(function(){try{return (window.NativeApp && " +
                                "typeof window.NativeApp.onBackPressed === 'function') " +
                                "? !!window.NativeApp.onBackPressed() : false;}catch(e){return false;}})();"
                    ) { result ->
                        if (result == "true") return@evaluateJavascript
                        performDefaultBack()
                    }
                    return
                }
                performDefaultBack()
            }
        }
        backCallback = callback
        onBackPressedDispatcher.addCallback(this, callback)
    }

    private fun performDefaultBack() {
        val view = webView
        if (view != null && view.canGoBack()) {
            view.goBack()
            return
        }
        // Nothing left inside the container: leave the app.
        backCallback?.isEnabled = false
        onBackPressedDispatcher.onBackPressed()
    }

    // =====================================================================
    // Fullscreen (media / canvas)
    // =====================================================================

    private fun enterFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }

    private fun exitFullscreen() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.show(WindowInsetsCompat.Type.systemBars())
        configureSystemBars()
    }

    // =====================================================================
    // Permissions & deep links
    // =====================================================================

    /** Android 13+ runtime permission required before Najva can show notifications. */
    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (NajvaManager.hasNotificationPermission(this)) return
        runCatching { notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) }
            .onFailure { Log.w(TAG, "Notification permission request failed: ${it.message}") }
    }

    private fun handleDeepLink(route: String?) {
        if (route.isNullOrBlank()) return
        Log.i(TAG, "Deep link received: $route")
        pendingDeepLinkRoute = route
        bridge?.pendingRouteForWebApp = route
        // Buffered inside DeepLinkBus until the WebApp calls appReady().
        DeepLinkBus.publish(route)
        if (isWebAppReady) {
            DeepLinkBus.flush()
            pendingDeepLinkRoute = null
        }
    }

    // =====================================================================
    // Helpers
    // =====================================================================

    private fun bindViews() {
        webViewContainer = findViewById(R.id.webViewContainer)
        loadingOverlay = findViewById(R.id.loadingOverlay)
        loadingContent = findViewById(R.id.loadingContent)
        loadingStage = findViewById(R.id.loadingStage)
        errorContent = findViewById(R.id.errorContent)
        errorMessage = findViewById(R.id.errorMessage)
        nativeAdPlate = findViewById(R.id.nativeAdPlate)
        nativeAdContainer = findViewById(R.id.nativeAdContainer)
        nativeAdStatus = findViewById(R.id.nativeAdStatus)
        fullscreenContainer = findViewById(R.id.fullscreenContainer)

        findViewById<View>(R.id.retryButton).setOnClickListener { retryBoot() }
        findViewById<View>(R.id.nativeAdClose).setOnClickListener { hideNativeAd() }
    }

    private fun configureSystemBars() {
        // System bars stay visible; the WebView owns the content area below them.
        WindowCompat.setDecorFitsSystemWindows(window, true)
        window.statusBarColor = getColor(R.color.system_bar)
        window.navigationBarColor = getColor(R.color.system_bar)

        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
                Configuration.UI_MODE_NIGHT_YES
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !night
        controller.isAppearanceLightNavigationBars = !night

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
    }

    private fun isInternalUrl(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return false
        if (scheme != "http" && scheme != "https") return false
        val host = uri.host?.lowercase(Locale.ROOT) ?: return false
        if (host != "127.0.0.1" && host != "localhost") return false
        val port = WebAppServerController.current()?.port
        return port == null || uri.port == -1 || uri.port == port
    }

    private fun openExternally(uri: Uri) {
        runCatching {
            startActivity(
                Intent(Intent.ACTION_VIEW, uri).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
        }.onFailure { Log.w(TAG, "No activity can handle $uri: ${it.message}") }
    }

    private fun isAudioPlaying(): Boolean = runCatching {
        val audioManager = getSystemService(AUDIO_SERVICE) as? AudioManager ?: return false
        audioManager.isMusicActive
    }.getOrDefault(false)
}
