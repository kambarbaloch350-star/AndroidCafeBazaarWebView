package com.emochi.quickgames

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.*
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import com.adivery.sdk.Adivery
import com.adivery.sdk.AdiveryBannerAdView

class MainActivity : AppCompatActivity() {

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

        webView = findViewById(R.id.webView)
        bannerContainer = findViewById(R.id.bannerContainer)

        // Production Adivery Setup
        Adivery.configure(application, AdiveryConfig.APP_ID)
        Adivery.setLoggingEnabled(false)
        adiveryManager = AdiveryManager(this)
        adiveryManager.prepareAds()

        // CafeBazaar Billing Setup
        billingManager = CafeBazaarBillingManager(this)
        webAppBridge = WebAppBridge(this, webView, billingManager, adiveryManager)
        assetResolver = WebAppAssetResolver(this)

        setupWebView()
        billingManager.startConnection()
        webView.loadUrl(assetResolver.findEntryPointUrl())
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true

        webView.addJavascriptInterface(webAppBridge, "AndroidBridge")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
                val uri = request?.url ?: return null
                return assetResolver.resolve(uri) ?: super.shouldInterceptRequest(view, request)
            }
        }
    }

    fun showBannerAd() {
        if (bannerAdView == null) {
            bannerAdView = AdiveryBannerAdView(this).apply {
                setPlacementId(AdiveryConfig.PLACEMENT_BANNER)
            }
            bannerContainer.addView(bannerAdView)
            bannerAdView?.loadAd()
        }
        bannerContainer.visibility = View.VISIBLE
    }

    fun hideBannerAd() {
        bannerContainer.visibility = View.GONE
    }
}