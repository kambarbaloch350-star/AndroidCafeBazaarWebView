import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ---------------------------------------------------------------------------
// Firebase (transport used by the Pushfa push SDK).
//
// Pushfa delivers through Firebase Cloud Messaging. Drop the `google-services.json`
// of the Firebase project whose *Service Account* is pasted into the Pushfa panel
// next to this file and the Google Services plugin wires it in automatically.
// Without the file the plugin is skipped, the build still succeeds and `App.kt`
// falls back to the FIREBASE_* values below (or leaves push disabled).
// ---------------------------------------------------------------------------
if (file("google-services.json").exists()) {
    apply(plugin = "com.google.gms.google-services")
}

// ---------------------------------------------------------------------------
// Native configuration resolver.
//
// Advertising (Tapsell) and push (Pushfa) identifiers live **only** on the
// native side. They are resolved, in order of precedence, from:
//
//   1. Gradle CLI properties      -> ./gradlew assembleRelease -PTAPSELL_APP_KEY=...
//   2. local.properties           -> TAPSELL_APP_KEY=...   (never committed; CI writes secrets here)
//   3. Environment variables      -> TAPSELL_APP_KEY=...
//   4. gradle.properties          -> TAPSELL_APP_KEY=...   (committed defaults of this app)
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
    fun String?.clean(): String? = this?.trim()?.takeIf { it.isNotEmpty() }
    val fromCli = gradle.startParameter.projectProperties[key].clean()
    val fromLocal = localProperties.getProperty(key).clean()
    val fromEnv = System.getenv(key).clean()
    val fromGradleProperties = (project.findProperty(key) as? String).clean()
    return fromCli ?: fromLocal ?: fromEnv ?: fromGradleProperties ?: default
}

fun quoted(value: String): String = "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

// CI's emulator smoke test verifies the *container contract* (boot, bridge,
// deep links, back navigation, exit dialog). It must not depend on live ad or
// push traffic from a foreign data-centre IP, so `-PSMOKE_TEST_BUILD=true`
// blanks the advertising / push identifiers: the SDKs stay packaged, the
// bridge answers NOT_CONFIGURED deterministically. Never used for shipping.
val smokeTestBuild: Boolean =
    gradle.startParameter.projectProperties["SMOKE_TEST_BUILD"]?.equals("true", ignoreCase = true) == true

// `-PSMOKE_TEST_ADS=true` (only honoured together with SMOKE_TEST_BUILD) keeps
// Tapsell on its *official test* app key and zones instead of blanking them:
// the CI "ad lab" job plays the game through a real interstitial round trip
// on the emulator. Test creatives, no revenue, no production identifiers.
val smokeTestAds: Boolean = smokeTestBuild &&
    gradle.startParameter.projectProperties["SMOKE_TEST_ADS"]?.equals("true", ignoreCase = true) == true

// ---------------------------------------------------------------------------
// Release signing.
//
// The release APK is the artifact CI delivers (Telegram) and the one that is
// uploaded to the CafeBazaar panel, so it has to be *signed*: an unsigned
// `app-release-unsigned.apk` cannot be installed by anyone.
//
// The keystore is never committed. It is resolved like every other native
// setting (CLI property > local.properties > environment > gradle.properties):
//
//   RELEASE_KEYSTORE_PATH      path to the .jks/.keystore
//   RELEASE_KEYSTORE_PASSWORD  store password
//   RELEASE_KEY_ALIAS          key alias
//   RELEASE_KEY_PASSWORD       key password (defaults to the store password)
//
// In CI the keystore is written from the ANDROID_KEYSTORE_BASE64 secret and
// passed with -PRELEASE_KEYSTORE_PATH=… . Without a configured keystore the
// release variant is signed with the Android *debug* key so the delivered APK
// still installs (with a loud warning) – never left unsigned.
// ---------------------------------------------------------------------------
val releaseKeystorePath = cfg("RELEASE_KEYSTORE_PATH")
val releaseKeystoreFile = releaseKeystorePath.takeIf { it.isNotEmpty() }?.let { rootProject.file(it) }
val hasReleaseKeystore = releaseKeystoreFile?.exists() == true
if (releaseKeystorePath.isNotEmpty() && !hasReleaseKeystore) {
    logger.warn("RELEASE_KEYSTORE_PATH=$releaseKeystorePath does not exist – falling back to the debug key")
}

val tapsellTestKeys = mapOf(
    "TAPSELL_APP_KEY" to "alsoatsrtrotpqacegkehkaiieckldhrgsbspqtgqnbrrfccrtbdomgjtahflchkqtqosa",
    "TAPSELL_ZONE_INTERSTITIAL" to "5cfaa942e8d17f0001ffb292",
    "TAPSELL_ZONE_REWARDED" to "5cfaa802e8d17f0001ffb28e",
    "TAPSELL_ZONE_NATIVE" to "5cfaa9deaede570001d5553a"
)

fun sdkKey(key: String): String = when {
    smokeTestAds && key in tapsellTestKeys -> tapsellTestKeys.getValue(key)
    smokeTestBuild -> ""
    else -> cfg(key)
}

android {
    namespace = "com.chistan.quickgames"
    // Pushfa 2.x (androidx.core 1.15 / WorkManager 2.10 underneath) must be
    // compiled against API 35. targetSdk deliberately stays at 34: targeting 35
    // would force edge-to-edge on Android 15 and change the system-bar layout
    // the container relies on.
    compileSdk = 35

    defaultConfig {
        applicationId = "com.chistan.quickgames"
        minSdk = 24
        targetSdk = 34
        // First CafeBazaar release of چیستان. Bump versionCode by one for every
        // upload to the CafeBazaar panel (it must always increase).
        versionCode = 2
        versionName = "2.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        vectorDrawables {
            useSupportLibrary = true
        }

        // ---- Tapsell (native advertising) - never exposed to the WebApp ----
        // True only for the CI emulator builds (blank identifiers / test ads):
        // UI that would get in the way of an unattended run (the WebView
        // update advice) is skipped when it is set.
        buildConfigField("boolean", "SMOKE_TEST_BUILD", smokeTestBuild.toString())
        buildConfigField("boolean", "SMOKE_TEST_ADS", smokeTestAds.toString())
        buildConfigField("String", "TAPSELL_APP_KEY", quoted(sdkKey("TAPSELL_APP_KEY")))
        buildConfigField("String", "TAPSELL_ZONE_INTERSTITIAL", quoted(sdkKey("TAPSELL_ZONE_INTERSTITIAL")))
        buildConfigField("String", "TAPSELL_ZONE_REWARDED", quoted(sdkKey("TAPSELL_ZONE_REWARDED")))
        buildConfigField("String", "TAPSELL_ZONE_NATIVE", quoted(sdkKey("TAPSELL_ZONE_NATIVE")))

        // ---- Pushfa (native push) - public key only, never the private one ----
        buildConfigField("String", "PUSHFA_API_PUBLIC_KEY", quoted(sdkKey("PUSHFA_API_PUBLIC_KEY")))

        // ---- Firebase (optional: allows FCM to run without google-services.json) ----
        buildConfigField("String", "FIREBASE_APP_ID", quoted(cfg("FIREBASE_APP_ID")))
        buildConfigField("String", "FIREBASE_API_KEY", quoted(cfg("FIREBASE_API_KEY")))
        buildConfigField("String", "FIREBASE_PROJECT_ID", quoted(cfg("FIREBASE_PROJECT_ID")))
        buildConfigField("String", "FIREBASE_SENDER_ID", quoted(cfg("FIREBASE_SENDER_ID")))
        buildConfigField("String", "FIREBASE_STORAGE_BUCKET", quoted(cfg("FIREBASE_STORAGE_BUCKET")))
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = releaseKeystoreFile
                storePassword = cfg("RELEASE_KEYSTORE_PASSWORD")
                keyAlias = cfg("RELEASE_KEY_ALIAS")
                keyPassword = cfg("RELEASE_KEY_PASSWORD").ifEmpty { cfg("RELEASE_KEYSTORE_PASSWORD") }
            }
        }
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
            // Signed so the CI artifact (Telegram delivery) can be installed;
            // the debug key is only a fallback for keystore-less environments.
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
            if (!hasReleaseKeystore) {
                logger.warn(
                    "release variant signed with the Android DEBUG key " +
                        "(set RELEASE_KEYSTORE_PATH/RELEASE_KEYSTORE_PASSWORD/RELEASE_KEY_ALIAS to ship with the real key)"
                )
            }
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

    // The HTTP server, MIME table and asset routing are covered by plain JVM
    // unit tests. `returnDefaultValues` keeps android.util.Log silent instead of
    // throwing "not mocked" from the stub android.jar.
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    // Kotlin BOM: keeps every transitive stdlib/coroutines version aligned.
    // 2.2.20 matches the stdlib the Pushfa SDK is compiled against; the 2.1
    // compiler reads 2.2 library metadata (Kotlin guarantees N+1 compatibility).
    implementation(platform("org.jetbrains.kotlin:kotlin-bom:2.2.20"))
    implementation("org.jetbrains.kotlin:kotlin-stdlib")

    // Official CafeBazaar In-App Billing SDK (Poolakey)
    implementation("com.github.cafebazaar.Poolakey:poolakey:2.2.0")

    // Official Tapsell advertising SDK (interstitial / rewarded / native)
    // https://docs.tapsell.ir/en/plus-sdk/android/main/
    implementation("ir.tapsell.plus:tapsell-plus-sdk-android:2.3.3")

    // Pushfa push notification SDK (native system notifications only)
    // https://github.com/pushfa/pushfa-android-sdk – Maven Central artifact.
    // It declares firebase-messaging as an `api` dependency; the explicit line
    // below pins the same version so App.kt can bootstrap Firebase itself.
    implementation("com.pushfa:pushfa-android-sdk:2.0.4")
    implementation("com.google.firebase:firebase-messaging:24.1.2")

    // Tests
    testImplementation("junit:junit:4.13.2")

    // AndroidX & UI
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
}
