plugins {
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

    // Coroutines for background tasks if needed
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
