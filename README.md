# Android WebView Wrapper with CafeBazaar In-App Billing (Poolakey)

A production-ready Android Studio project that embeds an HTML5/CSS/JavaScript web application inside a native Android `WebView`, complete with a bidirectional JavaScript ↔ Kotlin bridge and the official **CafeBazaar In-App Billing SDK (Poolakey v2.2.0)** for consumable and non-consumable in-app purchases.

---

## Table of Contents
1. [Project Overview & Architecture](#project-overview--architecture)
2. [Project Directory Structure](#project-directory-structure)
3. [How to Open the Project in Android Studio](#how-to-open-the-project-in-android-studio)
4. [Where to Put HTML, CSS, and JS Files](#where-to-put-html-css-and-js-files)
5. [Where to Configure CafeBazaar Credentials](#where-to-configure-cafebazaar-credentials)
6. [How to Add Product IDs (SKUs)](#how-to-add-product-ids-skus)
7. [JavaScript Bridge API & Examples](#javascript-bridge-api--examples)
8. [How Native Android Sends Results to JavaScript](#how-native-android-sends-results-to-javascript)
9. [Purchase Flow & Consumable Token Consumption](#purchase-flow--consumable-token-consumption)
10. [Building the APK](#building-the-apk)
11. [Testing CafeBazaar Purchases](#testing-cafebazaar-purchases)
12. [Common Errors & Troubleshooting](#common-errors--troubleshooting)
13. [Production Security & Server-Side Verification](#production-security--server-side-verification)

---

## 1. Project Overview & Architecture

- **Platform**: Android (minSdk 24, targetSdk 34, compileSdk 34)
- **Language**: Kotlin 1.9+, Java 17
- **Official Billing SDK**: `com.github.cafebazaar.Poolakey:poolakey:2.2.0` (official CafeBazaar Kotlin SDK)
- **WebView Capabilities**: JavaScript enabled, DOM Storage (`localStorage`), safe asset loading (`file:///android_asset/index.html`), hardware acceleration, and restricted external link handling.
- **Bridge Architecture**:
  - Native layer: `WebAppBridge.kt` exposed as `AndroidBridge` via `webView.addJavascriptInterface`.
  - Web layer: `android-bridge.js` exposing the clean `CafeBazaar` namespace with Promise and event-driven patterns.
  - UI-Thread Safety: All asynchronous native events dispatch onto the WebView main thread using `webView.post { evaluateJavascript(...) }`.

---

## 2. Project Directory Structure

```
.
├── app/
│   ├── build.gradle.kts                   # App module Gradle configuration & Poolakey dependency
│   └── src/
│       └── main/
│           ├── AndroidManifest.xml        # Permissions, queries for CafeBazaar service, hardware acceleration
│           ├── assets/                    # Web application frontend assets
│           │   ├── css/
│           │   │   └── style.css          # Responsive mobile styling for WebView
│           │   ├── js/
│           │   │   ├── android-bridge.js  # JavaScript SDK exposing window.CafeBazaar
│           │   │   └── app.js             # Store logic, coin balance, event handlers
│           │   └── index.html             # Entry point loaded as file:///android_asset/index.html
│           ├── java/com/example/webapp/
│           │   ├── BillingResult.kt       # Data classes for JSON serialization of billing outcomes
│           │   ├── CafeBazaarBillingManager.kt # Isolated Poolakey SDK management
│           │   ├── CafeBazaarConfig.kt    # App ID, RSA public key, product SKUs
│           │   ├── MainActivity.kt        # Activity lifecycle, WebView setup, immersive mode
│           │   └── WebAppBridge.kt        # @JavascriptInterface bridge implementation
│           └── res/
│               ├── layout/
│               │   └── activity_main.xml  # Layout hosting the WebView
│               └── values/
│                   ├── colors.xml
│                   ├── strings.xml
│                   └── themes.xml
├── build.gradle.kts                       # Root project build configuration
├── settings.gradle.kts                    # Includes JitPack repository for Poolakey
├── gradle.properties
└── README.md
```

---

## 3. How to Open the Project in Android Studio

1. **Launch Android Studio** (Hedgehog, Iguana, Jellyfish, or newer recommended).
2. Select **File > Open...** and browse to this directory.
3. Android Studio will automatically recognize the Gradle build files (`settings.gradle.kts`, `build.gradle.kts`, `app/build.gradle.kts`).
4. Wait for the **Gradle Sync** to finish. Android Studio will download:
   - Android SDK 34 build tools
   - Poolakey `2.2.0` from JitPack (`https://jitpack.io`)
   - AndroidX dependencies (`core-ktx`, `appcompat`, `webkit`)
5. If prompted, select a JDK version of **Java 17** or higher in **Settings > Build, Execution, Deployment > Build Tools > Gradle > Gradle JDK**.

---

## 4. Where to Put HTML, CSS, and JS Files

All web application assets reside inside the `app/src/main/assets/` folder:

- **Entry Point**: `app/src/main/assets/index.html`
- **Styles**: `app/src/main/assets/css/` (e.g., `style.css`)
- **JavaScript**: `app/src/main/assets/js/` (e.g., `android-bridge.js`, `app.js`)
- **Images / Audio / Data**: You can place images in `app/src/main/assets/images/`, audio in `app/src/main/assets/audio/`, and JSON files in `app/src/main/assets/data/`.

They are loaded automatically at startup via:
```kotlin
webView.loadUrl("file:///android_asset/index.html")
```

---

## 5. Where to Configure CafeBazaar Credentials

Edit `app/src/main/java/com/example/webapp/CafeBazaarConfig.kt`:

```kotlin
object CafeBazaarConfig {
    // 1. Your CafeBazaar registered package name
    const val APP_ID = "com.example.webapp"

    // 2. RSA Public Key from CafeBazaar Developer Console (Pishkhan)
    // Used for on-device signature verification of purchases.
    // Leave blank ("") during early testing or if validating on your backend server.
    const val CAFEBAZAAR_PUBLIC_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQ..."

    // 3. Product IDs (SKUs)
    const val PRODUCT_COINS_100 = "coins_100"
    const val PRODUCT_COINS_500 = "coins_500"
    const val PRODUCT_COINS_1000 = "coins_1000"
}
```

---

## 6. How to Add Product IDs (SKUs)

1. Log in to the [CafeBazaar Developer Panel](https://pishkhan.cafebazaar.ir/).
2. Select your application and navigate to **In-App Billing (پرداخت درون‌برنامه‌ای) > Products**.
3. Create new products:
   - For consumable items (e.g., coins, gems, extra lives), select **Consumable (مصرفی)**.
   - Enter your SKU (e.g., `coins_100`, `coins_500`).
4. Add the SKU to `CafeBazaarConfig.kt` and to your HTML/JS store buttons:
```html
<button onclick="CafeBazaar.purchase('coins_100')">
    Buy 100 Coins
</button>
```

---

## 7. JavaScript Bridge API & Examples

The file `assets/js/android-bridge.js` exposes the global `window.CafeBazaar` object.

### A. Checking Availability
```javascript
if (CafeBazaar.isAvailable()) {
    console.log("CafeBazaar billing is connected and available!");
} else {
    console.log("CafeBazaar billing is currently connecting or unavailable.");
}
```

### B. Making a Purchase (Promise-based)
```javascript
// Example: Purchasing 100 Coins
CafeBazaar.purchase("coins_100", "optional_developer_payload")
    .then(result => {
        console.log("Purchase succeeded!", result);
        console.log("Product ID:", result.productId);
        console.log("Purchase Token:", result.purchaseToken);
        console.log("Order ID:", result.orderId);

        // For consumable items, consume the token so it can be bought again:
        return CafeBazaar.consumePurchase(result.purchaseToken);
    })
    .then(consumeResult => {
        console.log("Token consumed successfully!", consumeResult);
        // Safely grant the coins in game
    })
    .catch(error => {
        console.error("Purchase or consume failed:", error.message, error.errorCode);
    });
```

### C. Event-Driven Subscriptions
```javascript
// Listen to all purchase outcomes
CafeBazaar.on('purchase', (result) => {
    if (result.success) {
        alert("Thank you for your purchase! Token: " + result.purchaseToken);
    } else {
        alert("Purchase error: " + result.message);
    }
});

// Listen to all consume outcomes
CafeBazaar.on('consume', (result) => {
    if (result.success) {
        console.log("Item consumed: " + result.purchaseToken);
    }
});

// Listen to billing service connection status
CafeBazaar.on('connection', (result) => {
    console.log("Billing connection changed:", result.success, result.message);
});
```

### D. Restoring / Querying Active Purchases
```javascript
CafeBazaar.getPurchases()
    .then(purchases => {
        console.log("User currently owns:", purchases);
        purchases.forEach(p => {
            console.log(`Product: ${p.productId}, Token: ${p.purchaseToken}`);
            // Check if there are unconsumed consumable tokens to process
        });
    })
    .catch(err => {
        console.error("Failed to query purchases:", err);
    });
```

---

## 8. How Native Android Sends Results to JavaScript

Native Android executes callbacks asynchronously through `WebAppBridge.kt`.

1. When CafeBazaar's native activity returns a result, `CafeBazaarBillingManager` triggers the corresponding listener callback.
2. `WebAppBridge.kt` converts the result data class into a clean JSON string using Android's native `org.json.JSONObject`.
3. To prevent race conditions or cross-thread crashes, `WebAppBridge` dispatches the callback onto the Android Main UI Thread:
   ```kotlin
   webView.post {
       webView.evaluateJavascript(
           "window.CafeBazaarBridge && window.CafeBazaarBridge.onPurchaseResult($jsonString);",
           null
       )
   }
   ```
4. `android-bridge.js` receives the JSON payload, resolves any pending Promises, and notifies registered event listeners.

---

## 9. Purchase Flow & Consumable Token Consumption

### The Complete Flow

```
[JavaScript / HTML]
        |
        | CafeBazaar.purchase("coins_100")
        v
[android-bridge.js]
        |
        | AndroidBridge.buyProduct("coins_100")
        v
[WebAppBridge.kt] (Runs on JS bridge thread)
        |
        | activity.runOnUiThread { billingManager.purchase(...) }
        v
[CafeBazaarBillingManager.kt]
        |
        | payment.purchaseProduct(activityResultRegistry, request)
        v
[CafeBazaar App / Poolakey SDK] (Native Purchase Dialog)
        |
        | User approves payment
        v
[purchaseSucceed callback in CafeBazaarBillingManager.kt]
        |
        | Event listener -> onPurchaseResult(PurchaseResult)
        v
[WebAppBridge.kt]
        |
        | webView.post { evaluateJavascript("window.CafeBazaarBridge.onPurchaseResult(...)") }
        v
[android-bridge.js & app.js]
        |
        | Web app receives purchaseToken
        v
[JavaScript requests consumption]
        |
        | CafeBazaar.consumePurchase(purchaseToken)
        v
[payment.consumeProduct(purchaseToken)] (Poolakey native API)
        |
        | CafeBazaar marks token consumed
        v
[consumeSucceed callback]
        |
        | webView.post { evaluateJavascript("window.CafeBazaarBridge.onConsumeResult(...)") }
        v
[JavaScript receives consume success]
        |
        User can now repurchase the item whenever desired!
```

---

## 10. Building the APK

### In Android Studio:
1. Go to **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
2. The generated APK will be in:
   `app/build/outputs/apk/debug/app-debug.apk`

### From Terminal / Command Line:
```bash
# Debug APK
./gradlew assembleDebug

# Release APK (requires signing key configured in app/build.gradle.kts)
./gradlew assembleRelease
```

---

## 11. Testing CafeBazaar Purchases

To test in-app billing with CafeBazaar:

1. **Install CafeBazaar**: Ensure the real **CafeBazaar** app is installed and logged in on your Android physical device or emulator.
2. **Match Package Name**: Ensure `applicationId` in `app/build.gradle.kts` matches the package name of your registered app in CafeBazaar Pishkhan.
3. **Upload an Initial APK**: CafeBazaar requires an initial APK to be uploaded as a draft in the developer console before in-app products can be queried.
4. **Test Accounts**: Add your Bazaar account email as a **Test Account** under **Settings > Test Users** in the CafeBazaar console. This allows testing without real monetary charges.
5. **Logcat Monitoring**: Filter Android Logcat by `tag:CafeBazaarBilling` to inspect every step of the connection, purchase, and consumption lifecycle.

---

## 12. Common Errors & Troubleshooting

| Error | Root Cause | Solution |
|---|---|---|
| `CONNECTION_FAILED` / `Service unavailable` | CafeBazaar is not installed or device is missing Bazaar background service. | Install the official CafeBazaar app on the device/emulator and log in to a Bazaar account. |
| `FAILED_TO_BEGIN_FLOW` | Android 11+ package visibility restriction. | Verify `<queries>` section in `AndroidManifest.xml` includes `com.farsitel.bazaar`. |
| `USER_CANCELED` | The user closed the CafeBazaar payment bottom sheet without paying. | Handled gracefully in `app.js`; UI informs user without crashing. |
| `ITEM_ALREADY_OWNED` | Consumable item was previously purchased but never consumed. | Call `CafeBazaar.getPurchases()`, find the unconsumed token, and call `CafeBazaar.consumePurchase(token)`. |
| `Security verification failed` | RSA Public Key in `CafeBazaarConfig.kt` does not match the one in Pishkhan. | Copy the exact public key from CafeBazaar developer panel or leave as `""` for testing. |

---

## 13. Production Security & Server-Side Verification

> ⚠️ **CRITICAL SECURITY BEST PRACTICE**
>
> JavaScript running inside a client-side WebView can be inspected and altered on rooted or modified devices. **Never rely solely on client-side JavaScript to grant high-value virtual currency or entitlements.**

For production environments:
1. **Send Token to Backend**: When `CafeBazaar.purchase()` succeeds, send the `purchaseToken` and `productId` to your secure backend API server.
2. **Backend Validation with CafeBazaar API**:
   Your server calls CafeBazaar's REST verification endpoint:
   ```
   GET https://pardakht.cafebazaar.ir/api/validate/{package_name}/inapp/{product_id}/purchases/{purchase_token}/?access_token={oauth_token}
   ```
3. **Grant Currency**: Once your server confirms the transaction is authentic and has not been refunded or duplicated, credit the user's database balance.
4. **Consume Server-Side or Client-Side**: Once verified, the token can be consumed either server-side or via `CafeBazaar.consumePurchase(token)`.
