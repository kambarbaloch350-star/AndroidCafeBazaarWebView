import { ProjectFile } from '../types';

export const PROJECT_FILES: ProjectFile[] = [
  {
    path: 'settings.gradle.kts',
    name: 'settings.gradle.kts',
    category: 'gradle',
    language: 'kotlin',
    description: 'Root Gradle settings defining JitPack repository for Poolakey and Adivery Maven repository.',
    content: `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven { url = java.net.URI("https://jitpack.io") }
        maven { url = java.net.URI("https://nexus.adivery.com/repository/adivery/") }
    }
}

rootProject.name = "AndroidCafeBazaarWebView"
include(":app")`
  },
  {
    path: 'build.gradle.kts',
    name: 'build.gradle.kts',
    category: 'gradle',
    language: 'kotlin',
    description: 'Top-level Gradle build configuration declaring Android and Kotlin plugins.',
    content: `// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    id("com.android.application") version "8.3.2" apply false
    id("org.jetbrains.kotlin.android") version "2.1.10" apply false
}`
  },
  {
    path: 'app/build.gradle.kts',
    name: 'app/build.gradle.kts',
    category: 'gradle',
    language: 'kotlin',
    description: 'App module configuration for com.emochi.quickgames with CafeBazaar Poolakey and Adivery SDK.',
    content: `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.emochi.quickgames"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.emochi.quickgames"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation(platform("org.jetbrains.kotlin:kotlin-bom:2.1.10"))
    implementation("org.jetbrains.kotlin:kotlin-stdlib")

    // Official CafeBazaar In-App Billing SDK (Poolakey v2.2.0)
    implementation("com.github.cafebazaar.Poolakey:poolakey:2.2.0")

    // Official Adivery Mobile Advertising SDK (v4.9.0)
    implementation("com.adivery:sdk:4.9.0")

    // AndroidX & UI dependencies
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.activity:activity-ktx:1.8.2")
    implementation("androidx.webkit:webkit:1.10.0")

    // Coroutines for background tasks
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}`
  },
  {
    path: 'app/src/main/AndroidManifest.xml',
    name: 'AndroidManifest.xml',
    category: 'manifest',
    language: 'xml',
    description: 'Manifest declaring com.emochi.quickgames package, permissions, and CafeBazaar queries.',
    content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />

    <!-- Android 11+ Package Visibility declarations for CafeBazaar IPC -->
    <queries>
        <package android:name="com.farsitel.bazaar" />
        <intent>
            <action android:name="ir.cafebazaar.pardakht.InAppBillingService.BIND" />
        </intent>
    </queries>

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.AndroidCafeBazaarWebView"
        android:hardwareAccelerated="true">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:configChanges="orientation|screenSize|screenLayout|keyboardHidden|uiMode"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`
  },
  {
    path: 'app/src/main/java/com/emochi/quickgames/AdiveryConfig.kt',
    name: 'AdiveryConfig.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Adivery App ID, Banner, Interstitial, and Rewarded Video placements.',
    content: `package com.emochi.quickgames

object AdiveryConfig {
    const val APP_ID = "74c264e1-2b02-4751-8254-8c83e18a8031"
    const val PLACEMENT_BANNER = "b6f4a810-1e5b-4369-b1d5-824c16a50b73"
    const val PLACEMENT_INTERSTITIAL = "d1983c27-7756-4ca9-a86d-69e120f2b380"
    const val PLACEMENT_REWARDED = "f2719a04-5867-4221-83d2-3bf9b109e992"
    const val IS_PRODUCTION = true
}`
  },
  {
    path: 'app/src/main/java/com/emochi/quickgames/AdiveryManager.kt',
    name: 'AdiveryManager.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Production controller for Adivery Interstitial, Rewarded Video, and Banner ads with error fallback.',
    content: `package com.emochi.quickgames

import android.app.Activity
import com.adivery.sdk.Adivery
import com.adivery.sdk.AdiveryListener
import org.json.JSONObject

class AdiveryManager(
    private val activity: Activity,
    val bannerPlacementId: String = AdiveryConfig.PLACEMENT_BANNER,
    val interstitialPlacementId: String = AdiveryConfig.PLACEMENT_INTERSTITIAL,
    val rewardedPlacementId: String = AdiveryConfig.PLACEMENT_REWARDED
) {
    interface AdEventListener {
        fun onAdEvent(type: String, data: JSONObject)
    }

    private var eventListener: AdEventListener? = null
    private var isInterstitialLoaded = false
    private var isRewardedLoaded = false

    fun setEventListener(listener: AdEventListener?) {
        this.eventListener = listener
    }

    fun prepareAds() {
        if (interstitialPlacementId.isNotBlank()) Adivery.prepareInterstitialAd(activity, interstitialPlacementId)
        if (rewardedPlacementId.isNotBlank()) Adivery.prepareRewardedAd(activity, rewardedPlacementId)

        Adivery.addGlobalListener(object : AdiveryListener() {
            override fun onInterstitialAdLoaded(placementId: String) {
                if (placementId == interstitialPlacementId) isInterstitialLoaded = true
                dispatchAdPlacementEvent("interstitial_loaded", placementId)
            }
            override fun onInterstitialAdShown(placementId: String) {
                dispatchAdPlacementEvent("interstitial_shown", placementId)
            }
            override fun onInterstitialAdClosed(placementId: String) {
                isInterstitialLoaded = false
                dispatchAdPlacementEvent("interstitial_closed", placementId)
                if (interstitialPlacementId.isNotBlank()) Adivery.prepareInterstitialAd(activity, interstitialPlacementId)
            }
            override fun onRewardedAdLoaded(placementId: String) {
                if (placementId == rewardedPlacementId) isRewardedLoaded = true
                dispatchAdPlacementEvent("rewarded_loaded", placementId)
            }
            override fun onRewardedAdShown(placementId: String) {
                dispatchAdPlacementEvent("rewarded_shown", placementId)
            }
            override fun onRewardedAdClosed(placementId: String, isRewarded: Boolean) {
                isRewardedLoaded = false
                val payload = JSONObject().apply {
                    put("placementId", placementId)
                    put("rewardGranted", isRewarded)
                }
                dispatchAdEvent("rewarded_closed", payload)
                if (rewardedPlacementId.isNotBlank()) Adivery.prepareRewardedAd(activity, rewardedPlacementId)
            }
            override fun onInterstitialAdClicked(placementId: String) {
                dispatchAdPlacementEvent("interstitial_clicked", placementId)
            }
            override fun onRewardedAdClicked(placementId: String) {
                dispatchAdPlacementEvent("rewarded_clicked", placementId)
            }
        })
    }

    fun dispatchAdError(placementId: String, reason: String) {
        val payload = JSONObject().apply {
            put("placementId", placementId)
            put("error", reason)
        }
        dispatchAdEvent("ad_error", payload)
    }

    fun showInterstitial(placementId: String? = null): Boolean {
        val targetId = if (!placementId.isNullOrBlank()) placementId else interstitialPlacementId
        return if (Adivery.isLoaded(targetId)) {
            Adivery.showAd(targetId)
            true
        } else {
            Adivery.prepareInterstitialAd(activity, targetId)
            val payload = JSONObject().apply {
                put("placementId", targetId)
                put("error", "INTERSTITIAL_NOT_LOADED")
            }
            dispatchAdEvent("ad_error", payload)
            false
        }
    }

    fun showRewarded(placementId: String? = null): Boolean {
        val targetId = if (!placementId.isNullOrBlank()) placementId else rewardedPlacementId
        return if (Adivery.isLoaded(targetId)) {
            Adivery.showAd(targetId)
            true
        } else {
            Adivery.prepareRewardedAd(activity, targetId)
            val payload = JSONObject().apply {
                put("placementId", targetId)
                put("error", "REWARDED_NOT_LOADED")
            }
            dispatchAdEvent("ad_error", payload)
            false
        }
    }

    fun isAdLoaded(placementId: String? = null): Boolean {
        val targetId = if (!placementId.isNullOrBlank()) placementId else interstitialPlacementId
        return Adivery.isLoaded(targetId)
    }

    private fun dispatchAdPlacementEvent(type: String, placementId: String) {
        val data = JSONObject().apply { put("placementId", placementId) }
        dispatchAdEvent(type, data)
    }

    private fun dispatchAdEvent(type: String, data: JSONObject) {
        eventListener?.onAdEvent(type, data)
    }
}`
  },
  {
    path: 'app/src/main/java/com/emochi/quickgames/WebAppBridge.kt',
    name: 'WebAppBridge.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'JavaScript Interface bridging CafeBazaar billing and Adivery ads with full parameter overloads.',
    content: `package com.emochi.quickgames

import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import org.json.JSONObject
import java.lang.ref.WeakReference

class WebAppBridge(
    activity: ComponentActivity,
    webView: WebView,
    private val billingManager: CafeBazaarBillingManager,
    private val adiveryManager: AdiveryManager
) : CafeBazaarBillingManager.BillingEventListener, AdiveryManager.AdEventListener {

    private val activityRef = WeakReference(activity)
    private val webViewRef = WeakReference(webView)

    init {
        billingManager.setEventListener(this)
        adiveryManager.setEventListener(this)
    }

    @JavascriptInterface
    fun isNativeApp(): Boolean = true

    @JavascriptInterface
    fun isProduction(): Boolean = true

    @JavascriptInterface
    fun getPackageName(): String = "com.emochi.quickgames"

    @JavascriptInterface
    fun isAvailable(): Boolean = billingManager.isBillingAvailable()

    @JavascriptInterface
    fun buyProduct(productId: String) = buyProductWithPayload(productId, null)

    @JavascriptInterface
    fun buyProductWithPayload(productId: String, payload: String?) {
        activityRef.get()?.runOnUiThread {
            billingManager.purchase(productId, payload)
        }
    }

    @JavascriptInterface
    fun consumePurchase(purchaseToken: String) {
        activityRef.get()?.runOnUiThread {
            billingManager.consumePurchase(purchaseToken)
        }
    }

    @JavascriptInterface
    fun getPurchases() {
        activityRef.get()?.runOnUiThread {
            billingManager.queryPurchases()
        }
    }

    @JavascriptInterface
    fun connectBilling() {
        activityRef.get()?.runOnUiThread {
            billingManager.startConnection()
        }
    }

    @JavascriptInterface
    fun isAdiveryAvailable(): Boolean = true

    @JavascriptInterface
    fun showBanner(): Boolean {
        val act = activityRef.get()
        if (act is MainActivity) {
            act.runOnUiThread { act.showBannerAd() }
            return true
        }
        return false
    }

    @JavascriptInterface
    fun hideBanner(): Boolean {
        val act = activityRef.get()
        if (act is MainActivity) {
            act.runOnUiThread { act.hideBannerAd() }
            return true
        }
        return false
    }

    @JavascriptInterface
    fun showInterstitial(): Boolean = showInterstitial(null)

    @JavascriptInterface
    fun showInterstitial(placementId: String?): Boolean {
        val target = if (!placementId.isNullOrBlank()) placementId else adiveryManager.interstitialPlacementId
        val loaded = adiveryManager.isAdLoaded(target)
        activityRef.get()?.runOnUiThread {
            adiveryManager.showInterstitial(target)
        }
        return loaded
    }

    @JavascriptInterface
    fun showRewarded(): Boolean = showRewarded(null)

    @JavascriptInterface
    fun showRewarded(placementId: String?): Boolean {
        val target = if (!placementId.isNullOrBlank()) placementId else adiveryManager.rewardedPlacementId
        val loaded = adiveryManager.isAdLoaded(target)
        activityRef.get()?.runOnUiThread {
            adiveryManager.showRewarded(target)
        }
        return loaded
    }

    @JavascriptInterface
    fun isAdLoaded(): Boolean = isAdLoaded(null)

    @JavascriptInterface
    fun isAdLoaded(placementId: String?): Boolean {
        return adiveryManager.isAdLoaded(placementId)
    }

    @JavascriptInterface
    fun isInterstitialLoaded(): Boolean = adiveryManager.isAdLoaded(adiveryManager.interstitialPlacementId)

    @JavascriptInterface
    fun isRewardedLoaded(): Boolean = adiveryManager.isAdLoaded(adiveryManager.rewardedPlacementId)

    @JavascriptInterface
    fun prepareAds() {
        activityRef.get()?.runOnUiThread {
            adiveryManager.prepareAds()
        }
    }

    override fun onConnectionStatusChanged(result: ConnectionResult) {
        dispatchJs("window.CafeBazaarBridge && window.CafeBazaarBridge.onConnectionResult(\${result.toJson()});")
    }

    override fun onPurchaseResult(result: PurchaseResult) {
        dispatchJs("window.CafeBazaarBridge && window.CafeBazaarBridge.onPurchaseResult(\${result.toJson()});")
    }

    override fun onConsumeResult(result: ConsumeResult) {
        dispatchJs("window.CafeBazaarBridge && window.CafeBazaarBridge.onConsumeResult(\${result.toJson()});")
    }

    override fun onPurchasesQueryResult(result: QueryPurchasesResult) {
        dispatchJs("window.CafeBazaarBridge && window.CafeBazaarBridge.onPurchasesQueryResult(\${result.toJson()});")
    }

    override fun onAdEvent(type: String, data: JSONObject) {
        val payload = JSONObject().apply {
            put("type", type)
            put("data", data)
        }
        val jsonString = payload.toString()
        dispatchJs("""
            try {
                if (window.AdiveryBridge && typeof window.AdiveryBridge.onAdEvent === 'function') {
                    window.AdiveryBridge.onAdEvent($jsonString);
                }
                window.dispatchEvent(new CustomEvent('adivery:event', { detail: $jsonString }));
            } catch (e) {
                console.error(e);
            }
        """.trimIndent())
    }

    private fun dispatchJs(script: String) {
        webViewRef.get()?.post {
            try {
                webViewRef.get()?.evaluateJavascript(script, null)
            } catch (e: Exception) {}
        }
    }

    fun cleanUp() {
        webViewRef.clear()
        activityRef.clear()
    }
}`
  },
  {
    path: 'app/src/main/java/com/emochi/quickgames/MainActivity.kt',
    name: 'MainActivity.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Host activity configuring WebView, Poolakey billing, and Adivery ads with non-clobbering bridge injection.',
    content: `package com.emochi.quickgames

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
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

        Adivery.configure(application, AdiveryConfig.APP_ID)
        Adivery.setLoggingEnabled(!AdiveryConfig.IS_PRODUCTION)
        adiveryManager = AdiveryManager(this)
        adiveryManager.prepareAds()

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
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                webView.post {
                    webView.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('CafeBazaarBridgeReady')); window.dispatchEvent(new CustomEvent('AdiveryBridgeReady'));",
                        null
                    )
                }
            }
        }
    }

    fun showBannerAd() {
        runOnUiThread {
            if (bannerAdView == null) {
                bannerAdView = AdiveryBannerAdView(this).apply {
                    setPlacementId(AdiveryConfig.PLACEMENT_BANNER)
                }
                bannerContainer.removeAllViews()
                bannerContainer.addView(bannerAdView)
                bannerAdView?.loadAd()
            }
            bannerContainer.visibility = android.view.View.VISIBLE
        }
    }

    fun hideBannerAd() {
        runOnUiThread {
            bannerContainer.visibility = android.view.View.GONE
        }
    }

    override fun onDestroy() {
        billingManager.destroy()
        webAppBridge.cleanUp()
        webView.destroy()
        super.onDestroy()
    }
}`
  },
  {
    path: 'app/src/main/assets/js/android-bridge.js',
    name: 'android-bridge.js',
    category: 'assets',
    language: 'javascript',
    description: 'Fixed Universal JavaScript Bridge exposing window.CafeBazaar and window.Adivery.',
    content: `// Universal Production Bridge for CafeBazaar (Poolakey) and Adivery (Fixed Version)
(function (window) {
    'use strict';

    // 1. CafeBazaar In-App Billing Bridge
    const pendingPurchases = new Map();
    const pendingConsumes = new Map();

    window.CafeBazaarBridge = {
        onPurchaseResult: function (res) {
            if (typeof res === 'string') { try { res = JSON.parse(res); } catch (_) {} }
            if (res.productId && pendingPurchases.has(res.productId)) {
                const p = pendingPurchases.get(res.productId);
                pendingPurchases.delete(res.productId);
                if (res.success) p.resolve(res); else p.reject(res);
            }
            window.dispatchEvent(new CustomEvent('cafebazaar:purchase', { detail: res }));
        },
        onConsumeResult: function (res) {
            if (typeof res === 'string') { try { res = JSON.parse(res); } catch (_) {} }
            if (res.purchaseToken && pendingConsumes.has(res.purchaseToken)) {
                const p = pendingConsumes.get(res.purchaseToken);
                pendingConsumes.delete(res.purchaseToken);
                if (res.success) p.resolve(res); else p.reject(res);
            }
            window.dispatchEvent(new CustomEvent('cafebazaar:consume', { detail: res }));
        }
    };

    window.CafeBazaar = {
        isAvailable: () => typeof window.AndroidBridge !== 'undefined' && window.AndroidBridge.isAvailable(),
        purchase: (sku) => new Promise((resolve, reject) => {
            if (!window.AndroidBridge) {
                setTimeout(() => resolve({ success: true, productId: sku, purchaseToken: 'mock_' + Date.now() }), 400);
                return;
            }
            pendingPurchases.set(sku, { resolve, reject });
            window.AndroidBridge.buyProduct(sku);
        }),
        consumePurchase: (token) => new Promise((resolve, reject) => {
            if (!window.AndroidBridge) { resolve({ success: true, purchaseToken: token }); return; }
            pendingConsumes.set(token, { resolve, reject });
            window.AndroidBridge.consumePurchase(token);
        })
    };

    // 2. Adivery Mobile Advertising Bridge
    let pendingRewarded = null;
    let pendingInterstitial = null;

    window.AdiveryBridge = {
        onAdEvent: function (event) {
            if (typeof event === 'string') { try { event = JSON.parse(event); } catch (_) {} }
            if (!event) return;

            if (event.type === 'rewarded_closed') {
                const data = event.data || { rewardGranted: false };
                if (pendingRewarded) { pendingRewarded(data); pendingRewarded = null; }
                if (window.__pendingRewarded) {
                    if (typeof window.__pendingRewarded === 'function') window.__pendingRewarded(data);
                    else if (window.__pendingRewarded.resolve) window.__pendingRewarded.resolve(data);
                    window.__pendingRewarded = null;
                }
            } else if (event.type === 'interstitial_closed') {
                if (pendingInterstitial) { pendingInterstitial(true); pendingInterstitial = null; }
                if (window.__pendingInterstitial) {
                    if (typeof window.__pendingInterstitial === 'function') window.__pendingInterstitial(true);
                    else if (window.__pendingInterstitial.resolve) window.__pendingInterstitial.resolve(true);
                    window.__pendingInterstitial = null;
                }
            } else if (event.type === 'ad_error') {
                const err = (event.data && event.data.error) ? event.data.error : 'AD_ERROR';
                if (pendingRewarded) { pendingRewarded({ rewardGranted: false, error: err }); pendingRewarded = null; }
                if (pendingInterstitial) { pendingInterstitial(false); pendingInterstitial = null; }
            }
            window.dispatchEvent(new CustomEvent('adivery:event', { detail: event }));
        }
    };

    window.Adivery = {
        isNativeBridgeAvailable: () => typeof window.AndroidBridge !== 'undefined',
        showBanner: () => window.AndroidBridge?.showBanner() ?? true,
        hideBanner: () => window.AndroidBridge?.hideBanner() ?? true,
        showInterstitial: (placementId) => new Promise((resolve) => {
            if (!window.AndroidBridge) { setTimeout(() => resolve(true), 600); return; }
            pendingInterstitial = resolve;
            window.__pendingInterstitial = resolve;
            const shown = placementId ? window.AndroidBridge.showInterstitial(placementId) : window.AndroidBridge.showInterstitial();
            if (!shown) { pendingInterstitial = null; resolve(false); }
        }),
        showRewarded: (placementId) => new Promise((resolve) => {
            if (!window.AndroidBridge) { setTimeout(() => resolve({ rewardGranted: true }), 1000); return; }
            pendingRewarded = resolve;
            window.__pendingRewarded = resolve;
            const shown = placementId ? window.AndroidBridge.showRewarded(placementId) : window.AndroidBridge.showRewarded();
            if (!shown) { pendingRewarded = null; resolve({ rewardGranted: false, error: 'NOT_LOADED' }); }
        }),
        isLoaded: (placementId) => {
            if (!window.AndroidBridge) return true;
            return placementId ? window.AndroidBridge.isAdLoaded(placementId) : window.AndroidBridge.isAdLoaded();
        }
    };

    Object.assign(window.AdiveryBridge, window.Adivery);
    window.BazaarBridge = window.CafeBazaar;
})(window);`
  }
];
