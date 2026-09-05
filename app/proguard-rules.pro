# ProGuard and R8 rules for Android WebView and CafeBazaar Poolakey SDK

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

-keepattributes JavascriptInterface
-keepclassmembers class com.example.webapp.WebAppBridge {
    <methods>;
}

-keep class ir.cafebazaar.poolakey.** { *; }
-dontwarn ir.cafebazaar.poolakey.**

-keep class com.example.webapp.** { *; }
