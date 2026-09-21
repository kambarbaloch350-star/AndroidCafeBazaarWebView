import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ---------------------------------------------------------------------------
// Native configuration resolver.
//
// Advertising (Tapsell) and push (Najva) identifiers live **only** on the
// native side. They are resolved, in order of precedence, from:
//
//   1. Gradle CLI properties      -> ./gradlew assembleRelease -PTAPSELL_APP_KEY=...
//   2. gradle.properties          -> TAPSELL_APP_KEY=...
//   3. local.properties           -> TAPSELL_APP_KEY=...   (never committed)
//   4. Environment variables      -> TAPSELL_APP_KEY=...
//
// Nothing is ever shipped to the WebApp: the JavaScript layer only ever sees
// the generic bridge API (NativeAds.showInterstitial(), ...).
// ---------------------------------------------------------------------------
val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) {
        file.inputStream().use { load(it) }
    }
}

fun cfg(key: String, default: String = ""): String {
    val fromCli = (project.findProperty(key) as? String)?.trim()?.takeIf { it.isNotEmpty() }
    val fromLocal = localProperties.getProperty(key)?.trim()?.takeIf { it.isNotEmpty() }
    val fromEnv = System.getenv(key)?.trim()?.takeIf { it.isNotEmpty() }
    return fromCli ?: fromLocal ?: fromEnv ?: default
}

fun quoted(value: String): String = "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

android {
    namespace = "com.emochi.quickgames"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.emochi.quickgames"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "2.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        vectorDrawables {
            useSupportLibrary = true
        }

        // ---- Tapsell (native advertising) - never exposed to the WebApp ----
        buildConfigField("String", "TAPSELL_APP_KEY", quoted(cfg("TAPSELL_APP_KEY")))
        buildConfigField("String", "TAPSELL_ZONE_INTERSTITIAL", quoted(cfg("TAPSELL_ZONE_INTERSTITIAL")))
        buildConfigField("String", "TAPSELL_ZONE_REWARDED", quoted(cfg("TAPSELL_ZONE_REWARDED")))
        buildConfigField("String", "TAPSELL_ZONE_NATIVE", quoted(cfg("TAPSELL_ZONE_NATIVE")))

        // ---- Najva (native push) - never exposed to the WebApp ----
        manifestPlaceholders["najvaApiKey"] = cfg("NAJVA_API_KEY")
        manifestPlaceholders["najvaWebsiteId"] = cfg("NAJVA_WEBSITE_ID")

        // ---- Firebase (optional: allows FCM to run without google-services.json) ----
        buildConfigField("String", "FIREBASE_APP_ID", quoted(cfg("FIREBASE_APP_ID")))
        buildConfigField("String", "FIREBASE_API_KEY", quoted(cfg("FIREBASE_API_KEY")))
        buildConfigField("String", "FIREBASE_PROJECT_ID", quoted(cfg("FIREBASE_PROJECT_ID")))
        buildConfigField("String", "FIREBASE_SENDER_ID", quoted(cfg("FIREBASE_SENDER_ID")))
        buildConfigField("String", "FIREBASE_STORAGE_BUCKET", quoted(cfg("FIREBASE_STORAGE_BUCKET")))
    }

    buildTypes {
        debug {
            isDebuggable = true
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += listOf("-Xjvm-default=all")
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += setOf(
                "META-INF/DEPENDENCIES",
                "META-INF/LICENSE",
                "META-INF/LICENSE.txt",
                "META-INF/license.txt",
                "META-INF/NOTICE",
                "META-INF/NOTICE.txt",
                "META-INF/notice.txt",
                "META-INF/*.kotlin_module"
            )
        }
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

dependencies {
    // Kotlin BOM: keeps every transitive stdlib/coroutines version aligned.
    implementation(platform("org.jetbrains.kotlin:kotlin-bom:2.1.10"))
    implementation("org.jetbrains.kotlin:kotlin-stdlib")

    // Official CafeBazaar In-App Billing SDK (Poolakey)
    implementation("com.github.cafebazaar.Poolakey:poolakey:2.2.0")

    // Official Tapsell advertising SDK (interstitial / rewarded / native)
    // https://docs.tapsell.ir/en/plus-sdk/android/main/
    implementation("ir.tapsell.plus:tapsell-plus-sdk-android:2.3.3")

    // Najva push notification SDK (native system notifications only)
    // https://central.sonatype.com/artifact/com.najva/sdk
    implementation("com.najva:sdk:1.8.4")
    implementation("com.google.firebase:firebase-messaging:23.3.1")

    // AndroidX & UI
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.11.0")
}
