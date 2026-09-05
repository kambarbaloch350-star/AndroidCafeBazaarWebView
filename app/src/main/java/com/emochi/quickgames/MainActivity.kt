package com.emochi.quickgames

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import com.adivery.sdk.Adivery
import com.adivery.sdk.AdiveryBannerAdView

/**
 * Main Activity hosting the native WebView wrapper for HTML5/JS application.
 * Application Package: com.emochi.quickgames
 * Integrates:
 * 1. CafeBazaar In-App Billing (Poolakey SDK)
 * 2. Adivery Mobile Advertising SDK (Banner, Interstitial, Rewarded Video)
 * 3. Virtual HTTPS Asset Resolution for Node.js / HTML5 games
 */
class MainActivity : AppCompatActivity() {

    companion object {
        const val TAG = "QuickGames"
    }

    private lateinit var webView: WebView
    private lateinit var bannerContainer: FrameLayout
    private var bannerAdView: AdiveryBannerAdView? = null
    private lateinit var billingManager: CafeBazaarBillingManager
    private lateinit var adiveryManager: AdiveryManager
    private lateinit var webAppBridge: WebAppBridge
    private lateinit var assetResolver: WebAppAssetResolver

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        setupImmersiveMode()

        webView = findViewById(R.id.webView)
        bannerContainer = findViewById(R.id.bannerContainer)

        // 1. Initialize Adivery SDK in Production mode
        Adivery.configure(application, AdiveryConfig.APP_ID)
        Adivery.setLoggingEnabled(!AdiveryConfig.IS_PRODUCTION)
        adiveryManager = AdiveryManager(this)
        adiveryManager.prepareAds()

        // 2. Initialize CafeBazaar Billing Manager
        billingManager = CafeBazaarBillingManager(this)

        // 3. Initialize Bridge & Asset Resolver
        webAppBridge = WebAppBridge(this, webView, billingManager, adiveryManager)
        assetResolver = WebAppAssetResolver(this)

        // 4. Configure WebView
        setupWebView()

        // 5. Back Navigation
        setupBackNavigation()

        // 6. Connect to CafeBazaar Billing service
        billingManager.startConnection()

        // 7. Load Web Application from Virtual HTTPS Origin
        val entryUrl = assetResolver.findEntryPointUrl()
        webView.loadUrl(entryUrl)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val settings: WebSettings = webView.settings

        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true

        settings.allowFileAccess = true
        settings.allowContentAccess = true
        @Suppress("DEPRECATION")
        settings.allowFileAccessFromFileURLs = true
        @Suppress("DEPRECATION")
        settings.allowUniversalAccessFromFileURLs = true

        settings.mediaPlaybackRequiresUserGesture = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        // Register native bridge interface
        webView.addJavascriptInterface(webAppBridge, WebAppBridge.JS_INTERFACE_NAME)

        // Intercept requests and serve local assets over virtual domain
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val uri = request?.url ?: return null
                val response = assetResolver.resolve(uri)
                if (response != null) {
                    return response
                }
                return super.shouldInterceptRequest(view, request)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith("https://${WebAppAssetResolver.ASSET_DOMAIN}") ||
                    url.startsWith("http://${WebAppAssetResolver.ASSET_DOMAIN}") ||
                    url.startsWith("file:///android_asset/")
                ) {
                    return false
                }
                // Route external URLs to system intent
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(intent)
                } catch (e: Exception) {
                    Log.e(TAG, "Cannot launch external URL: ${e.message}")
                }
                return true
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                injectBridgeHelper()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                injectBridgeHelper()
                webView.post {
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('CafeBazaarBridgeReady')); window.dispatchEvent(new CustomEvent('AdiveryBridgeReady'));",
                        null
                    )
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                return true
            }
        }
    }

    fun showBannerAd() {
        runOnUiThread {
            if (bannerAdView == null) {
                bannerAdView = AdiveryBannerAdView(this).apply {
                    setPlacementId(AdiveryConfig.PLACEMENT_BANNER)
                    setBannerSize(com.adivery.sdk.BannerSize.BANNER)
                }
                bannerContainer.removeAllViews()
                bannerContainer.addView(
                    bannerAdView,
                    FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.WRAP_CONTENT
                    )
                )
                bannerAdView?.loadAd()
            }
            bannerContainer.visibility = View.VISIBLE
        }
    }

    fun hideBannerAd() {
        runOnUiThread {
            bannerContainer.visibility = View.GONE
        }
    }

    /**
     * Injects bridge fallback helpers without overwriting existing android-bridge.js functions.
     */
    private fun injectBridgeHelper() {
        val script = """
            (function() {
                // Ensure base namespaces exist
                window.CafeBazaarBridge = window.CafeBazaarBridge || {};
                window.AdiveryBridge = window.AdiveryBridge || {};

                // 1. Fallback CafeBazaar object if android-bridge.js not included
                if (!window.CafeBazaar) {
                    window.CafeBazaar = {
                        isNativeBridgeAvailable: function() { return typeof window.AndroidBridge !== 'undefined'; },
                        isAvailable: function() { return typeof window.AndroidBridge !== 'undefined' && window.AndroidBridge.isAvailable(); },
                        connect: function() { if (window.AndroidBridge) window.AndroidBridge.connectBilling(); },
                        purchase: function(id, payload) {
                            if (!window.AndroidBridge) return Promise.reject(new Error('AndroidBridge not available'));
                            return new Promise(function(resolve, reject) {
                                window.__pendingPurchases = window.__pendingPurchases || {};
                                window.__pendingPurchases[id] = { resolve: resolve, reject: reject };
                                if (payload) window.AndroidBridge.buyProductWithPayload(id, payload);
                                else window.AndroidBridge.buyProduct(id);
                            });
                        },
                        consumePurchase: function(token) {
                            if (!window.AndroidBridge) return Promise.reject(new Error('AndroidBridge not available'));
                            return new Promise(function(resolve, reject) {
                                window.__pendingConsumes = window.__pendingConsumes || {};
                                window.__pendingConsumes[token] = { resolve: resolve, reject: reject };
                                window.AndroidBridge.consumePurchase(token);
                            });
                        },
                        getPurchases: function() {
                            if (!window.AndroidBridge) return Promise.reject(new Error('AndroidBridge not available'));
                            return new Promise(function(resolve, reject) {
                                window.__pendingQuery = { resolve: resolve, reject: reject };
                                window.AndroidBridge.getPurchases();
                            });
                        }
                    };
                    window.BazaarBridge = window.CafeBazaar;
                }

                // 2. Fallback Adivery object if android-bridge.js not included
                if (!window.Adivery) {
                    window.Adivery = {
                        isNativeBridgeAvailable: function() { return typeof window.AndroidBridge !== 'undefined'; },
                        showBanner: function() {
                            if (window.AndroidBridge) return window.AndroidBridge.showBanner();
                            return false;
                        },
                        hideBanner: function() {
                            if (window.AndroidBridge) return window.AndroidBridge.hideBanner();
                            return false;
                        },
                        showInterstitial: function(placementId) {
                            if (!window.AndroidBridge) return Promise.resolve(false);
                            return new Promise(function(resolve) {
                                window.__pendingInterstitial = resolve;
                                var shown = window.AndroidBridge.showInterstitial(placementId || '');
                                if (!shown) {
                                    window.__pendingInterstitial = null;
                                    resolve(false);
                                }
                            });
                        },
                        showRewarded: function(placementId) {
                            if (!window.AndroidBridge) return Promise.resolve({ rewardGranted: true });
                            return new Promise(function(resolve) {
                                window.__pendingRewarded = resolve;
                                var shown = window.AndroidBridge.showRewarded(placementId || '');
                                if (!shown) {
                                    window.__pendingRewarded = null;
                                    resolve({ rewardGranted: false, error: 'NOT_READY' });
                                }
                            });
                        },
                        isLoaded: function(placementId) {
                            if (window.AndroidBridge) return window.AndroidBridge.isAdLoaded(placementId || '');
                            return false;
                        }
                    };
                }

                // 3. Keep references synced
                if (!window.AdiveryBridge.showRewarded && window.Adivery) {
                    Object.assign(window.AdiveryBridge, window.Adivery);
                }

                // 4. Fallback onAdEvent ONLY if not already defined
                if (typeof window.AdiveryBridge.onAdEvent !== 'function') {
                    window.AdiveryBridge.onAdEvent = function(event) {
                        if (typeof event === 'string') {
                            try { event = JSON.parse(event); } catch (_) {}
                        }
                        if (!event) return;
                        if (event.type === 'rewarded_closed') {
                            var data = event.data || { rewardGranted: false };
                            if (window.__pendingRewarded) {
                                if (typeof window.__pendingRewarded === 'function') window.__pendingRewarded(data);
                                else if (typeof window.__pendingRewarded.resolve === 'function') window.__pendingRewarded.resolve(data);
                                window.__pendingRewarded = null;
                            }
                        } else if (event.type === 'interstitial_closed') {
                            if (window.__pendingInterstitial) {
                                if (typeof window.__pendingInterstitial === 'function') window.__pendingInterstitial(true);
                                else if (typeof window.__pendingInterstitial.resolve === 'function') window.__pendingInterstitial.resolve(true);
                                window.__pendingInterstitial = null;
                            }
                        } else if (event.type === 'ad_error') {
                            var err = (event.data && event.data.error) ? event.data.error : 'AD_ERROR';
                            if (window.__pendingRewarded) {
                                var res = { rewardGranted: false, error: err };
                                if (typeof window.__pendingRewarded === 'function') window.__pendingRewarded(res);
                                else if (typeof window.__pendingRewarded.resolve === 'function') window.__pendingRewarded.resolve(res);
                                window.__pendingRewarded = null;
                            }
                            if (window.__pendingInterstitial) {
                                if (typeof window.__pendingInterstitial === 'function') window.__pendingInterstitial(false);
                                else if (typeof window.__pendingInterstitial.resolve === 'function') window.__pendingInterstitial.resolve(false);
                                window.__pendingInterstitial = null;
                            }
                        }
                    };
                }
            })();
        """.trimIndent()
        webView.post {
            webView.evaluateJavascript(script, null)
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })
    }

    private fun setupImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false
    }

    override fun onDestroy() {
        billingManager.destroy()
        webAppBridge.cleanUp()
        webView.destroy()
        super.onDestroy()
    }
}
