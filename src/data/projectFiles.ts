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
        // JitPack repository is required for CafeBazaar Poolakey SDK
        maven { url = java.net.URI("https://jitpack.io") }
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
        freeCompilerArgs = freeCompilerArgs + listOf(
            "-Xskip-metadata-version-check",
            "-Xskip-prerelease-check"
        )
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
    // Enforce Kotlin 2.1.10 BOM to align all transitive stdlib and coroutines
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

    <!-- Permissions required for network access, WebView, and Adivery ads -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />

    <!--
      Android 11+ Package Visibility declarations for CafeBazaar IPC
    -->
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
    path: 'app/src/main/java/com/emochi/quickgames/CafeBazaarConfig.kt',
    name: 'CafeBazaarConfig.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'SKU registry with 4x market pricing logic for coin packs.',
    content: `package com.emochi.quickgames

/**
 * CafeBazaar In-App Billing Configuration
 * Application: com.emochi.quickgames
 */
object CafeBazaarConfig {

    const val CAFEBAZAAR_PUBLIC_KEY = ""

    const val SKU_COIN_PACK_250 = "coin_pack_250"
    const val SKU_COIN_PACK_750 = "coin_pack_750"
    const val SKU_COIN_PACK_2000 = "coin_pack_2000"
    const val SKU_COIN_PACK_5000 = "coin_pack_5000"
    const val SKU_COIN_PACK_10000 = "coin_pack_10000"
    const val SKU_COIN_PACK_25000 = "coin_pack_25000"

    const val PRICE_MULTIPLIER = 4

    data class ProductInfo(
        val sku: String,
        val title: String,
        val coins: Int,
        val baseMarketPriceTomans: Long,
        val effectivePriceTomans: Long = baseMarketPriceTomans * PRICE_MULTIPLIER
    )

    val PRODUCTS = listOf(
        ProductInfo(SKU_COIN_PACK_250, "بسته ۲۵۰ سکه", 250, 5_000L),
        ProductInfo(SKU_COIN_PACK_750, "بسته ۷۵۰ سکه", 750, 15_000L),
        ProductInfo(SKU_COIN_PACK_2000, "بسته ۲,۰۰۰ سکه", 2000, 35_000L),
        ProductInfo(SKU_COIN_PACK_5000, "بسته ۵,۰۰۰ سکه", 5000, 75_000L),
        ProductInfo(SKU_COIN_PACK_10000, "بسته ۱۰,۰۰۰ سکه", 10000, 125_000L),
        ProductInfo(SKU_COIN_PACK_25000, "بسته ۲۵,۰۰۰ سکه مگا", 25000, 250_000L)
    )

    fun isSecurityCheckEnabled(): Boolean = CAFEBAZAAR_PUBLIC_KEY.isNotBlank()
}`
  },
  {
    path: 'app/src/main/java/com/emochi/quickgames/BillingResult.kt',
    name: 'BillingResult.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Data classes encapsulating purchase, consumption, connection, and query results for the bridge.',
    content: `package com.emochi.quickgames

import org.json.JSONArray
import org.json.JSONObject

/**
 * Encapsulates the result of a purchase operation sent back to JavaScript.
 */
data class PurchaseResult(
    val success: Boolean,
    val productId: String,
    val purchaseToken: String? = null,
    val orderId: String? = null,
    val purchaseTime: Long? = null,
    val payload: String? = null,
    val message: String,
    val errorCode: String? = null
) {
    fun toJson(): JSONObject {
        val json = JSONObject()
        json.put("success", success)
        json.put("productId", productId)
        purchaseToken?.let { json.put("purchaseToken", it) }
        orderId?.let { json.put("orderId", it) }
        purchaseTime?.let { json.put("purchaseTime", it) }
        payload?.let { json.put("payload", it) }
        json.put("message", message)
        errorCode?.let { json.put("errorCode", it) }
        return json
    }
}

/**
 * Encapsulates the result of a token consumption operation sent back to JavaScript.
 */
data class ConsumeResult(
    val success: Boolean,
    val purchaseToken: String,
    val message: String,
    val errorCode: String? = null
) {
    fun toJson(): JSONObject {
        val json = JSONObject()
        json.put("success", success)
        json.put("purchaseToken", purchaseToken)
        json.put("message", message)
        errorCode?.let { json.put("errorCode", it) }
        return json
    }
}

/**
 * Encapsulates the result of billing service connection status sent to JavaScript.
 */
data class ConnectionResult(
    val success: Boolean,
    val message: String,
    val errorCode: String? = null
) {
    fun toJson(): JSONObject {
        val json = JSONObject()
        json.put("success", success)
        json.put("message", message)
        errorCode?.let { json.put("errorCode", it) }
        return json
    }
}

/**
 * Encapsulates the result of querying active purchases from CafeBazaar.
 */
data class QueryPurchasesResult(
    val success: Boolean,
    val purchases: List<PurchaseResult>,
    val message: String,
    val errorCode: String? = null
) {
    fun toJson(): JSONObject {
        val json = JSONObject()
        json.put("success", success)
        json.put("message", message)
        errorCode?.let { json.put("errorCode", it) }

        val purchasesArray = JSONArray()
        for (item in purchases) {
            purchasesArray.put(item.toJson())
        }
        json.put("purchases", purchasesArray)
        return json
    }
}
`
  },
  {
    path: 'app/src/main/java/com/emochi/quickgames/AdiveryConfig.kt',
    name: 'AdiveryConfig.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Adivery App ID, Banner, Interstitial, and Rewarded Video placements.',
    content: `package com.emochi.quickgames

/**
 * Adivery Advertising Network Configuration
 * Application: com.emochi.quickgames
 */
object AdiveryConfig {
    const val APP_ID = "c213be57-quickgames-adivery"
    const val PLACEMENT_BANNER = "banner-placement-id"
    const val PLACEMENT_INTERSTITIAL = "interstitial-placement-id"
    const val PLACEMENT_REWARDED = "rewarded-placement-id"
    const val IS_PRODUCTION = true
}`
  },
  {
    path: 'app/src/main/java/com/emochi/quickgames/AdiveryManager.kt',
    name: 'AdiveryManager.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Production controller for Adivery Interstitial, Rewarded Video, and Banner ads.',
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

    fun setEventListener(listener: AdEventListener?) {
        this.eventListener = listener
    }

    fun prepareAds() {
        if (interstitialPlacementId.isNotBlank()) Adivery.prepareInterstitialAd(activity, interstitialPlacementId)
        if (rewardedPlacementId.isNotBlank()) Adivery.prepareRewardedAd(activity, rewardedPlacementId)

        Adivery.addGlobalListener(object : AdiveryListener() {
            override fun onInterstitialAdLoaded(placementId: String) {
                dispatchAdPlacementEvent("interstitial_loaded", placementId)
            }
            override fun onInterstitialAdClosed(placementId: String) {
                dispatchAdPlacementEvent("interstitial_closed", placementId)
                Adivery.prepareInterstitialAd(activity, interstitialPlacementId)
            }
            override fun onRewardedAdClosed(placementId: String, isRewarded: Boolean) {
                val payload = JSONObject().apply {
                    put("placementId", placementId)
                    put("rewardGranted", isRewarded)
                }
                dispatchAdEvent("rewarded_closed", payload)
                Adivery.prepareRewardedAd(activity, rewardedPlacementId)
            }
        })
    }

    fun showInterstitial(placementId: String? = null): Boolean {
        val targetId = if (!placementId.isNullOrBlank()) placementId else interstitialPlacementId
        return if (Adivery.isLoaded(targetId)) {
            Adivery.showAd(targetId)
            true
        } else {
            Adivery.prepareInterstitialAd(activity, targetId)
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
            false
        }
    }

    fun isAdLoaded(placementId: String): Boolean = Adivery.isLoaded(placementId)

    private fun dispatchAdPlacementEvent(type: String, placementId: String) {
        val data = JSONObject().apply { put("placementId", placementId) }
        eventListener?.onAdEvent(type, data)
    }

    private fun dispatchAdEvent(type: String, data: JSONObject) {
        eventListener?.onAdEvent(type, data)
    }
}`
  },
  {
    path: 'app/src/main/java/com/emochi/quickgames/CafeBazaarBillingManager.kt',
    name: 'CafeBazaarBillingManager.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Poolakey wrapper with auto-consumption for seamless coin pack purchases.',
    content: `package com.emochi.quickgames

import android.app.Activity
import androidx.activity.ComponentActivity
import ir.cafebazaar.poolakey.Connection
import ir.cafebazaar.poolakey.Payment
import ir.cafebazaar.poolakey.config.PaymentConfiguration
import ir.cafebazaar.poolakey.config.SecurityCheck
import ir.cafebazaar.poolakey.entity.PurchaseInfo
import ir.cafebazaar.poolakey.request.PurchaseRequest
import java.lang.ref.WeakReference

class CafeBazaarBillingManager(activity: ComponentActivity) {
    private val activityRef = WeakReference(activity)
    private var payment: Payment? = null
    private var paymentConnection: Connection? = null
    private var isConnected: Boolean = false

    interface BillingEventListener {
        fun onConnectionStatusChanged(result: ConnectionResult)
        fun onPurchaseResult(result: PurchaseResult)
        fun onConsumeResult(result: ConsumeResult)
        fun onPurchasesQueryResult(result: QueryPurchasesResult)
    }

    private var eventListener: BillingEventListener? = null

    init {
        val paymentConfig = PaymentConfiguration(localSecurityCheck = SecurityCheck.Disable)
        payment = Payment(context = activity.applicationContext, config = paymentConfig)
    }

    fun setEventListener(listener: BillingEventListener?) {
        this.eventListener = listener
    }

    fun startConnection() {
        paymentConnection = payment?.connect {
            connectionSucceed {
                isConnected = true
                eventListener?.onConnectionStatusChanged(ConnectionResult(true, "Connected"))
            }
            connectionFailed { throwable ->
                isConnected = false
                eventListener?.onConnectionStatusChanged(ConnectionResult(false, throwable.message ?: "Failed"))
            }
            disconnected {
                isConnected = false
            }
        }
    }

    fun isBillingAvailable(): Boolean = isConnected

    fun purchase(productId: String, payload: String? = null) {
        val activity = activityRef.get() ?: return
        payment?.purchaseProduct(
            registry = activity.activityResultRegistry,
            request = PurchaseRequest(productId, payload ?: "order_\${System.currentTimeMillis()}")
        ) {
            purchaseSucceed { info ->
                eventListener?.onPurchaseResult(
                    PurchaseResult(true, info.productId, info.purchaseToken, info.orderId, info.purchaseTime, info.payload, "Success")
                )
                // Auto-consume consumable coin packs
                if (info.productId.startsWith("coin_pack_")) {
                    consumePurchase(info.purchaseToken)
                }
            }
            purchaseCanceled {
                eventListener?.onPurchaseResult(PurchaseResult(false, productId, message = "Canceled by user"))
            }
            purchaseFailed { throwable ->
                eventListener?.onPurchaseResult(PurchaseResult(false, productId, message = throwable.message ?: "Failed"))
            }
        }
    }

    fun consumePurchase(purchaseToken: String) {
        payment?.consumeProduct(purchaseToken) {
            consumeSucceed {
                eventListener?.onConsumeResult(ConsumeResult(true, purchaseToken, "Consumed"))
            }
            consumeFailed { throwable ->
                eventListener?.onConsumeResult(ConsumeResult(false, purchaseToken, throwable.message ?: "Error"))
            }
        }
    }

    fun queryPurchases() {
        payment?.getPurchasedProducts {
            querySucceed { purchases ->
                val list = purchases.map { PurchaseResult(true, it.productId, it.purchaseToken, it.orderId, it.purchaseTime, it.payload) }
                eventListener?.onPurchasesQueryResult(QueryPurchasesResult(true, list))
            }
        }
    }

    fun destroy() {
        paymentConnection?.disconnect()
    }
}`
  },
  {
    path: 'app/src/main/java/com/emochi/quickgames/WebAppBridge.kt',
    name: 'WebAppBridge.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'JavaScript Interface bridging CafeBazaar billing and Adivery ads to WebView.',
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
    fun showInterstitial(placementId: String? = null): Boolean {
        return adiveryManager.showInterstitial(placementId)
    }

    @JavascriptInterface
    fun showRewarded(placementId: String? = null): Boolean {
        return adiveryManager.showRewarded(placementId)
    }

    override fun onPurchaseResult(result: PurchaseResult) {
        dispatchJs("window.CafeBazaarBridge && window.CafeBazaarBridge.onPurchaseResult(\${result.toJson()});")
    }

    override fun onConsumeResult(result: ConsumeResult) {
        dispatchJs("window.CafeBazaarBridge && window.CafeBazaarBridge.onConsumeResult(\${result.toJson()});")
    }

    override fun onConnectionStatusChanged(result: ConnectionResult) {
        dispatchJs("window.CafeBazaarBridge && window.CafeBazaarBridge.onConnectionResult(\${result.toJson()});")
    }

    override fun onPurchasesQueryResult(result: QueryPurchasesResult) {
        dispatchJs("window.CafeBazaarBridge && window.CafeBazaarBridge.onPurchasesQueryResult(\${result.toJson()});")
    }

    override fun onAdEvent(type: String, data: JSONObject) {
        val payload = JSONObject().apply {
            put("type", type)
            put("data", data)
        }
        dispatchJs("window.AdiveryBridge && window.AdiveryBridge.onAdEvent(\$payload);")
    }

    private fun dispatchJs(script: String) {
        webViewRef.get()?.post {
            webViewRef.get()?.evaluateJavascript(script, null)
        }
    }

    fun cleanUp() {
        webViewRef.clear()
        activityRef.clear()
    }
}`
  },
  {
    path: 'app/src/main/java/com/emochi/quickgames/WebAppAssetResolver.kt',
    name: 'WebAppAssetResolver.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Intercepts WebView requests and serves local assets over virtual HTTPS domain to resolve CORS and ES Modules.',
    content: `package com.emochi.quickgames

import android.content.Context
import android.net.Uri
import android.webkit.MimeTypeMap
import android.webkit.WebResourceResponse
import java.io.File
import java.io.InputStream
import java.util.Locale

class WebAppAssetResolver(private val context: Context) {

    companion object {
        const val ASSET_DOMAIN = "appassets.androidplatform.net"
        const val ASSET_PREFIX = "https://$ASSET_DOMAIN/"
        const val VIRTUAL_BASE_URL = "https://$ASSET_DOMAIN/index.html"
    }

    private val assetManager = context.assets

    private val hasDistFolder: Boolean by lazy {
        try {
            val list = assetManager.list("dist")
            !list.isNullOrEmpty()
        } catch (e: Exception) {
            false
        }
    }

    fun findEntryPointUrl(): String = VIRTUAL_BASE_URL

    fun resolve(uri: Uri): WebResourceResponse? {
        val host = uri.host ?: return null
        if (!host.equals(ASSET_DOMAIN, ignoreCase = true)) {
            return null
        }

        var path = uri.path ?: ""
        if (path.startsWith("/")) path = path.substring(1)
        if (path.isEmpty()) path = "index.html"

        val candidates = mutableListOf<String>()
        if (hasDistFolder) {
            if (!path.startsWith("dist/")) candidates.add("dist/$path")
            candidates.add(path)
        } else {
            candidates.add(path)
            if (path.startsWith("assets/")) candidates.add(path.substring("assets/".length))
        }

        for (candidate in candidates) {
            val stream = openAssetStream(candidate)
            if (stream != null) {
                val mimeType = getMimeType(candidate)
                val encoding = if (isTextMime(mimeType)) "UTF-8" else null
                return WebResourceResponse(mimeType, encoding, stream)
            }
        }

        if (!path.contains(".") || path.endsWith(".html")) {
            val fallback = if (hasDistFolder) "dist/index.html" else "index.html"
            val fallbackStream = openAssetStream(fallback)
            if (fallbackStream != null) {
                return WebResourceResponse("text/html", "UTF-8", fallbackStream)
            }
        }

        return null
    }

    private fun openAssetStream(assetPath: String): InputStream? {
        return try {
            assetManager.open(assetPath)
        } catch (e: Exception) {
            null
        }
    }

    fun getMimeType(path: String): String {
        val extension = File(path).extension.lowercase(Locale.ROOT)
        return when (extension) {
            "html", "htm" -> "text/html"
            "js", "mjs" -> "application/javascript"
            "css" -> "text/css"
            "json" -> "application/json"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "gif" -> "image/gif"
            "svg" -> "image/svg+xml"
            "webp" -> "image/webp"
            "ico" -> "image/x-icon"
            "wasm" -> "application/wasm"
            "mp3" -> "audio/mpeg"
            "ogg" -> "audio/ogg"
            "wav" -> "audio/wav"
            "m4a" -> "audio/mp4"
            "mp4" -> "video/mp4"
            "webm" -> "video/webm"
            "woff" -> "font/woff"
            "woff2" -> "font/woff2"
            "ttf" -> "font/ttf"
            "otf" -> "font/otf"
            "txt" -> "text/plain"
            "xml" -> "text/xml"
            else -> {
                val fromMap = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
                fromMap ?: "application/octet-stream"
            }
        }
    }

    private fun isTextMime(mimeType: String): Boolean {
        return mimeType.startsWith("text/") ||
                mimeType == "application/javascript" ||
                mimeType == "application/json" ||
                mimeType == "image/svg+xml" ||
                mimeType == "text/css"
    }
}
`
  },
  {
    path: 'app/src/main/java/com/emochi/quickgames/MainActivity.kt',
    name: 'MainActivity.kt',
    category: 'kotlin',
    language: 'kotlin',
    description: 'Host activity configuring WebView, Poolakey billing, and Adivery ads in production mode.',
    content: `package com.emochi.quickgames

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
}`
  },
  {
    path: 'app/src/main/assets/index.html',
    name: 'index.html',
    category: 'assets',
    language: 'html',
    description: 'HTML5 Game UI with Lucky Wheel, Level Progression, and 4x Coin Store.',
    content: `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>QuickGames - CafeBazaar & Adivery</title>
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <div class="container">
        <!-- Game Header & Coins Balance -->
        <header class="header">
            <div class="header-brand">
                <div class="brand-avatar">🎮</div>
                <div class="title-group">
                    <h1>QuickGames</h1>
                    <p>com.emochi.quickgames</p>
                </div>
            </div>
            <div class="wallet-badge">
                <span class="coin-icon">🪙</span>
                <span id="coinBalance" class="balance-amount">50</span>
                <span class="balance-unit">سکه</span>
            </div>
        </header>

        <!-- Level Progression (Adivery Interstitial every 2 levels) -->
        <section class="game-section">
            <div class="section-header">
                <h2>پیشرفت مراحل بازی</h2>
                <span class="ad-notice-tag">تبلیغ بین‌راهی هر ۲ مرحله</span>
            </div>
            <div class="game-card">
                <div class="level-progress-bar-wrap">
                    <div id="levelProgressBar" class="level-progress-bar" style="width: 50%;"></div>
                </div>
                <button id="btnCompleteLevel" class="btn-primary btn-game" onclick="handleLevelUp()">
                    پایان مرحله و دریافت جایزه (+۳۰ سکه)
                </button>
            </div>
        </section>

        <!-- Lucky Spinning Wheel (Adivery Rewarded Video) -->
        <section class="wheel-section">
            <div class="section-header">
                <h2>گردونه شانس (جایزه ویدیویی ادیوری)</h2>
                <span class="reward-tag">ویدیو پاداش‌دار</span>
            </div>
            <div class="wheel-card">
                <div class="wheel-container">
                    <div class="wheel-pointer">▼</div>
                    <div id="luckyWheel" class="lucky-wheel">
                        <div class="wheel-center">🎯</div>
                    </div>
                </div>
                <button id="btnSpinWheel" class="btn-spin" onclick="handleSpinWheel()">
                    چرخاندن گردونه با تماشای تبلیغ ادیوری
                </button>
            </div>
        </section>

        <!-- CafeBazaar Store (4x Market Prices) -->
        <section class="store-section">
            <div class="section-header">
                <h2>فروشگاه سکه کافه‌بازار (نرخ ۴ برابری)</h2>
                <span class="bazaar-tag">پرداخت درون‌برنامه‌ای</span>
            </div>
            <div class="products-grid">
                <!-- coin_pack_250: 20,000 Tomans -->
                <div class="product-card">
                    <div class="product-names">
                        <h3>بسته ۲۵۰ سکه</h3>
                        <span class="sku-label">coin_pack_250</span>
                    </div>
                    <div class="price-box">۲۰,۰۰۰ تومان (4X)</div>
                    <button class="btn-buy" onclick="handlePurchase('coin_pack_250')">خرید</button>
                </div>
                <!-- coin_pack_750: 60,000 Tomans -->
                <div class="product-card">
                    <div class="product-names">
                        <h3>بسته ۷۵۰ سکه</h3>
                        <span class="sku-label">coin_pack_750</span>
                    </div>
                    <div class="price-box">۶۰,۰۰۰ تومان (4X)</div>
                    <button class="btn-buy" onclick="handlePurchase('coin_pack_750')">خرید</button>
                </div>
                <!-- coin_pack_2000: 140,000 Tomans -->
                <div class="product-card featured">
                    <div class="product-names">
                        <h3>بسته ۲,۰۰۰ سکه</h3>
                        <span class="sku-label">coin_pack_2000</span>
                    </div>
                    <div class="price-box">۱۴۰,۰۰۰ تومان (4X)</div>
                    <button class="btn-buy" onclick="handlePurchase('coin_pack_2000')">خرید</button>
                </div>
                <!-- coin_pack_5000: 300,000 Tomans -->
                <div class="product-card">
                    <div class="product-names">
                        <h3>بسته ۵,۰۰۰ سکه</h3>
                        <span class="sku-label">coin_pack_5000</span>
                    </div>
                    <div class="price-box">۳۰۰,۰۰۰ تومان (4X)</div>
                    <button class="btn-buy" onclick="handlePurchase('coin_pack_5000')">خرید</button>
                </div>
                <!-- coin_pack_10000: 500,000 Tomans -->
                <div class="product-card">
                    <div class="product-names">
                        <h3>بسته ۱۰,۰۰۰ سکه</h3>
                        <span class="sku-label">coin_pack_10000</span>
                    </div>
                    <div class="price-box">۵۰۰,۰۰۰ تومان (4X)</div>
                    <button class="btn-buy" onclick="handlePurchase('coin_pack_10000')">خرید</button>
                </div>
                <!-- coin_pack_25000: 1,000,000 Tomans -->
                <div class="product-card jackpot">
                    <div class="product-names">
                        <h3>بسته ۲۵,۰۰۰ سکه مگا</h3>
                        <span class="sku-label">coin_pack_25000</span>
                    </div>
                    <div class="price-box">۱,۰۰۰,۰۰۰ تومان (4X)</div>
                    <button class="btn-buy" onclick="handlePurchase('coin_pack_25000')">خرید مگا</button>
                </div>
            </div>
        </section>
        <div id="toastContainer" class="toast-container"></div>
    </div>
    <script src="js/android-bridge.js"></script>
    <script src="js/app.js"></script>
</body>
</html>`
  },
  {
    path: 'app/src/main/assets/js/android-bridge.js',
    name: 'android-bridge.js',
    category: 'assets',
    language: 'javascript',
    description: 'Universal JavaScript Bridge exposing window.CafeBazaar and window.Adivery.',
    content: `// Universal Production Bridge for CafeBazaar (Poolakey) and Adivery
(function(window) {
    'use strict';
    // Exposes window.CafeBazaar and window.Adivery
    window.CafeBazaar = {
        isAvailable: () => typeof window.AndroidBridge !== 'undefined' && window.AndroidBridge.isAvailable(),
        purchase: (sku) => {
            if (!window.AndroidBridge) return Promise.resolve({ success: true, productId: sku, purchaseToken: 'sim_' + Date.now() });
            return new Promise((resolve) => {
                window.__pendingPurchases = window.__pendingPurchases || {};
                window.__pendingPurchases[sku] = resolve;
                window.AndroidBridge.buyProduct(sku);
            });
        },
        consumePurchase: (token) => {
            if (window.AndroidBridge) window.AndroidBridge.consumePurchase(token);
            return Promise.resolve();
        }
    };
    window.Adivery = {
        showBanner: () => window.AndroidBridge?.showBanner() ?? true,
        hideBanner: () => window.AndroidBridge?.hideBanner() ?? true,
        showInterstitial: () => {
            if (window.AndroidBridge) return window.AndroidBridge.showInterstitial();
            return Promise.resolve(true);
        },
        showRewarded: () => {
            if (window.AndroidBridge) {
                return new Promise(resolve => {
                    window.__pendingRewarded = resolve;
                    window.AndroidBridge.showRewarded();
                });
            }
            return Promise.resolve({ rewardGranted: true });
        }
    };
    window.BazaarBridge = window.CafeBazaar;
    window.AdiveryBridge = window.Adivery;
})(window);`
  }
];
