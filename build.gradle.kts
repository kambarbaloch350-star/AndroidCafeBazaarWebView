// Top-level build file where you can add configuration options common to all sub-projects/modules.
plugins {
    id("com.android.application") version "8.3.2" apply false
    id("org.jetbrains.kotlin.android") version "2.1.10" apply false
    // Firebase Cloud Messaging wiring for the Pushfa push SDK. The plugin is only
    // applied by :app when `app/google-services.json` exists, so the container
    // still builds (with push disabled) before the Firebase project is attached.
    id("com.google.gms.google-services") version "4.4.2" apply false
}
