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
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
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

        // Enable edge-to-edge display for game experience
        setupImmersiveMode()

        webView = findViewById(R.id.webView)
        bannerContainer = findViewById(R.id.bannerContainer)

        // 1. Initialize Adivery SDK in Production mode
        Adivery.configure(application, AdiveryConfig.APP_ID)
        Adivery.setLoggingEnabled(!AdiveryConfig.IS_PRODUCTION) // Disable debug logs in production
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

        // JavaScript & Storage
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true

        // Local asset permissions
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        @Suppress("DEPRECATION")
        settings.allowFileAccessFromFileURLs = true
        @Suppress("DEPRECATION")
        settings.allowUniversalAccessFromFileURLs = true

        // Media & Performance
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

                // Route external URLs to system intent (e.g. CafeBazaar app page)
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
                // Keep console messages minimal in production
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
     * Injects the universal bridge helpers for both CafeBazaar and Adivery into any loaded web page.
     */
    private fun injectBridgeHelper() {
        val script = """
            (function() {
                if (window.__bridgesInjected) return;
                window.__bridgesInjected = true;
                
                // 1. CafeBazaar In-App Billing Bridge
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
                        },
                        on: function(event, callback) {
                            window.__bazaarListeners = window.__bazaarListeners || {};
                            window.__bazaarListeners[event] = window.__bazaarListeners[event] || [];
                            window.__bazaarListeners[event].push(callback);
                        }
                    };
                }

                // 2. Adivery Mobile Advertising Bridge
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
                                window.__pendingInterstitial = { resolve: resolve };
                                var shown = window.AndroidBridge.showInterstitial(placementId || '');
                                if (!shown) resolve(false);
                            });
                        },
                        showRewarded: function(placementId) {
                            if (!window.AndroidBridge) return Promise.resolve({ rewardGranted: true });
                            return new Promise(function(resolve) {
                                window.__pendingRewarded = { resolve: resolve };
                                var shown = window.AndroidBridge.showRewarded(placementId || '');
                                if (!shown) resolve({ rewardGranted: false, error: 'NOT_READY' });
                            });
                        },
                        isLoaded: function(placementId) {
                            if (window.AndroidBridge) return window.AndroidBridge.isAdLoaded(placementId || '');
                            return false;
                        }
                    };
                }
                window.AdiveryBridge = window.Adivery;
                window.BazaarBridge = window.CafeBazaar;

                // Event Dispatchers
                window.CafeBazaarBridge = window.CafeBazaarBridge || {};
                window.CafeBazaarBridge.onPurchaseResult = function(data) {
                    if (window.__pendingPurchases && window.__pendingPurchases[data.productId]) {
                        if (data.success) window.__pendingPurchases[data.productId].resolve(data);
                        else window.__pendingPurchases[data.productId].reject(data);
                        delete window.__pendingPurchases[data.productId];
                    }
                    if (window.__bazaarListeners && window.__bazaarListeners['purchase']) {
                        window.__bazaarListeners['purchase'].forEach(function(fn) { fn(data); });
                    }
                };
                window.CafeBazaarBridge.onConsumeResult = function(data) {
                    if (window.__pendingConsumes && window.__pendingConsumes[data.purchaseToken]) {
                        if (data.success) window.__pendingConsumes[data.purchaseToken].resolve(data);
                        else window.__pendingConsumes[data.purchaseToken].reject(data);
                        delete window.__pendingConsumes[data.purchaseToken];
                    }
                    if (window.__bazaarListeners && window.__bazaarListeners['consume']) {
                        window.__bazaarListeners['consume'].forEach(function(fn) { fn(data); });
                    }
                };
                window.CafeBazaarBridge.onConnectionResult = function(data) {
                    if (window.__bazaarListeners && window.__bazaarListeners['connection']) {
                        window.__bazaarListeners['connection'].forEach(function(fn) { fn(data); });
                    }
                };
                window.CafeBazaarBridge.onPurchasesQueryResult = function(data) {
                    if (window.__pendingQuery) {
                        if (data.success) window.__pendingQuery.resolve(data.purchases || []);
                        else window.__pendingQuery.reject(data);
                        window.__pendingQuery = null;
                    }
                    if (window.__bazaarListeners && window.__bazaarListeners['query']) {
                        window.__bazaarListeners['query'].forEach(function(fn) { fn(data); });
                    }
                };

                // Adivery Event Handler
                window.AdiveryBridge.onAdEvent = function(event) {
                    if (event.type === 'rewarded_closed') {
                        if (window.__pendingRewarded) {
                            window.__pendingRewarded.resolve(event.data || { rewardGranted: false });
                            window.__pendingRewarded = null;
                        }
                    } else if (event.type === 'interstitial_closed') {
                        if (window.__pendingInterstitial) {
                            window.__pendingInterstitial.resolve(true);
                            window.__pendingInterstitial = null;
                        }
                    } else if (event.type === 'ad_error') {
                        if (window.__pendingRewarded) {
                            window.__pendingRewarded.resolve({ rewardGranted: false, error: event.data.error });
                            window.__pendingRewarded = null;
                        }
                        if (window.__pendingInterstitial) {
                            window.__pendingInterstitial.resolve(false);
                            window.__pendingInterstitial = null;
                        }
                    }
                };
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
