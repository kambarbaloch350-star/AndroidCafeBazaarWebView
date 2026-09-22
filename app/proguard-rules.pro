# =============================================================================
# ProGuard / R8 rules for the native WebApp container
# =============================================================================

# -----------------------------------------------------------------------------
# JavaScript bridge – the single surface exposed to the WebApp.
# Every @JavascriptInterface method must survive shrinking, otherwise the
# WebApp silently loses NativeApp / NativeAds / CafeBazaar.
# -----------------------------------------------------------------------------
-keepattributes JavascriptInterface
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keep class com.emochi.quickgames.WebAppBridge { *; }
-keep class com.emochi.quickgames.App { *; }
-keep class com.emochi.quickgames.MainActivity { *; }

# Bridge payloads are serialised/deserialised by reflection-free JSON code, but
# their public shape is part of the JS contract – keep them verbatim.
-keep class com.emochi.quickgames.PurchaseResult { *; }
-keep class com.emochi.quickgames.ConsumeResult { *; }
-keep class com.emochi.quickgames.ConnectionResult { *; }
-keep class com.emochi.quickgames.QueryPurchasesResult { *; }

# -----------------------------------------------------------------------------
# CafeBazaar Poolakey (in-app billing over AIDL)
# -----------------------------------------------------------------------------
-keep class ir.cafebazaar.poolakey.** { *; }
-keep interface ir.cafebazaar.poolakey.** { *; }
-dontwarn ir.cafebazaar.poolakey.**

# -----------------------------------------------------------------------------
# Tapsell advertising SDK (interstitial / rewarded / native)
# -----------------------------------------------------------------------------
-keep class ir.tapsell.plus.** { *; }
-keep interface ir.tapsell.plus.** { *; }
-dontwarn ir.tapsell.plus.**

-keep class ir.tapsell.sdk.** { *; }
-keep interface ir.tapsell.sdk.** { *; }
-dontwarn ir.tapsell.sdk.**

# Tapsell renders native ads from its own XML layouts: keep every referenced
# view class so the ad plate is always fully clickable.
-keep class * extends android.view.View {
    public <init>(android.content.Context);
    public <init>(android.content.Context, android.util.AttributeSet);
    public <init>(android.content.Context, android.util.AttributeSet, int);
}
-keepclassmembers class * extends android.view.View {
    public void set*(***);
    public *** get*();
}

# -----------------------------------------------------------------------------
# Najva push notification SDK + Firebase Messaging
# -----------------------------------------------------------------------------
-keep class com.najva.sdk.** { *; }
-keep interface com.najva.sdk.** { *; }
-dontwarn com.najva.sdk.**

-keep class com.google.firebase.** { *; }
-keep interface com.google.firebase.** { *; }
-dontwarn com.google.firebase.**

-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# Firebase services are instantiated by the framework.
-keep class * extends com.google.firebase.messaging.FirebaseMessagingService {
    public <init>();
}
-keep class * implements com.google.firebase.components.ComponentRegistrar { *; }
-keep class * extends com.google.firebase.components.ComponentRegistrar { *; }

# -----------------------------------------------------------------------------
# Android framework glue
# -----------------------------------------------------------------------------
# WebView clients are set programmatically but some SDKs reflect on them.
-keep class * extends android.webkit.WebViewClient { *; }
-keep class * extends android.webkit.WebChromeClient { *; }

# Enum switch support (used by the Tapsell SDK).
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Native methods.
-keepclasseswithmembernames class * {
    native <methods>;
}

# Parcelable / Serializable payloads.
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator *;
}
-keepclassmembers class * implements java.io.Serializable {
    private static final java.io.ObjectStreamField[] serialPersistentFields;
    private void writeObject(java.io.ObjectOutputStream);
    private void readObject(java.io.ObjectInputStream);
    java.lang.Object writeReplace();
    java.lang.Object readResolve();
}

# -----------------------------------------------------------------------------
# Optional dependencies pulled in transitively by ad networks / Firebase.
# The app never calls them directly, so R8 warnings are safe to silence.
# -----------------------------------------------------------------------------
-dontwarn org.jetbrains.annotations.**
-dontwarn javax.annotation.**
-dontwarn kotlin.**
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**
-dontwarn com.google.android.exoplayer2.**
-dontwarn com.google.ads.interactivemedia.**
-dontwarn com.unity3d.**
-dontwarn com.facebook.**
-dontwarn com.adcolony.**
-dontwarn com.applovin.**
-dontwarn com.vungle.**
-dontwarn com.mbridge.**
-dontwarn com.chartboost.**
