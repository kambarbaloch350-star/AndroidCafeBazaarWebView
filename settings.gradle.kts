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
    }
}

rootProject.name = "AndroidCafeBazaarWebView"
include(":app")
