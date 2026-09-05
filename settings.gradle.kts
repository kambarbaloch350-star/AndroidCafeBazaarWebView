pluginManagement {
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
        // Adivery repository
        maven { url = java.net.URI("https://nexus.adivery.com/repository/adivery/") }
    }
}

rootProject.name = "AndroidCafeBazaarWebView"
include(":app")
