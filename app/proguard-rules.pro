# ProGuard and R8 rules for Android WebView and CafeBazaar Poolakey SDK
# Keep JavascriptInterface methods for WebAppBridge
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-keepclassmembers class com.emochi.quickgames.WebAppBridge {
    <methods>;
}

# Keep CafeBazaar Poolakey classes
-keep class ir.cafebazaar.poolakey.** { *; }
-dontwarn ir.cafebazaar.poolakey.**

# Keep Adivery SDK classes
-keep class com.adivery.sdk.** { *; }
-keep interface com.adivery.sdk.** { *; }
-dontwarn com.adivery.sdk.**

# Keep models and data classes
-keep class com.emochi.quickgames.** { *; }
