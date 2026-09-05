import { PROJECT_FILES } from './projectFiles';

export interface ExportableFile {
  path: string;
  content: string;
}

export const EXTRA_PROJECT_FILES: ExportableFile[] = [
  {
    path: 'gradle.properties',
    content: `# Project-wide Gradle settings.
org.gradle.jvmargs=-Xmx1024m -XX:MaxMetaspaceSize=384m -Dfile.encoding=UTF-8
kotlin.daemon.jvmargs=-Xmx512m
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
`
  },
  {
    path: 'gradlew',
    content: `#!/bin/sh

#
# Copyright © 2015-2021 the original authors.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

APP_BASE_NAME=\`basename "$0"\`
APP_HOME="\`pwd -P\`"

# Resolve links: $0 may be a link
PRG="$0"
while [ -h "$PRG" ] ; do
    ls=\`ls -ld "$PRG"\`
    link=\`expr "$ls" : '.*-> \\(.*\\)$'\`
    if expr "$link" : '/.*' > /dev/null; then
        PRG="$link"
    else
        PRG=\`dirname "$PRG"\`"/$link"
    fi
done
SAVED="\`pwd\`"
cd "\`dirname \\"$PRG\\"\`/" >/dev/null
APP_HOME="\`pwd -P\`"
cd "$SAVED" >/dev/null

CLASSPATH=$APP_HOME/gradle/wrapper/gradle-wrapper.jar

# Auto-download gradle-wrapper.jar if missing
if [ ! -f "$CLASSPATH" ]; then
    mkdir -p "$APP_HOME/gradle/wrapper"
    curl -fsSL https://raw.githubusercontent.com/gradle/gradle/v8.5.0/gradle/wrapper/gradle-wrapper.jar -o "$CLASSPATH" 2>/dev/null || true
fi

if [ -n "$JAVA_HOME" ] ; then
    if [ -x "$JAVA_HOME/jre/sh/java" ] ; then
        JAVACMD="$JAVA_HOME/jre/sh/java"
    else
        JAVACMD="$JAVA_HOME/bin/java"
    fi
    if [ ! -x "$JAVACMD" ] ; then
        echo "ERROR: JAVA_HOME is set to an invalid directory: $JAVA_HOME" >&2
        exit 1
    fi
else
    JAVACMD="java"
    which java >/dev/null 2>&1 || { echo "ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH." >&2; exit 1; }
fi

exec "$JAVACMD" "-Dorg.gradle.appname=$APP_BASE_NAME" -classpath "$CLASSPATH" org.gradle.wrapper.GradleWrapperMain "$@"
`
  },
  {
    path: 'gradlew.bat',
    content: `@if "%DEBUG%"=="" @echo off
@rem ##########################################################################
@rem
@rem  Gradle startup script for Windows
@rem
@rem ##########################################################################

if "%OS%"=="Windows_NT" setlocal

set DIRNAME=%~dp0
if "%DIRNAME%"=="" set DIRNAME=.
set APP_BASE_NAME=%~n0
set APP_HOME=%DIRNAME%

for %%i in ("%APP_HOME%") do set APP_HOME=%%~fi

set DEFAULT_JVM_OPTS=-Dfile.encoding=UTF-8 "-Xmx64m" "-Xms64m"

if defined JAVA_HOME goto findJavaFromJavaHome

set JAVA_EXE=java.exe
%JAVA_EXE% -version >NUL 2>&1
if %ERRORLEVEL% equ 0 goto execute

echo.
echo ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.
echo.
echo Please set the JAVA_HOME variable in your environment to match the
echo location of your Java installation.
goto fail

:findJavaFromJavaHome
set JAVA_HOME=%JAVA_HOME:"=%
set JAVA_EXE=%JAVA_HOME%/bin/java.exe

if exist "%JAVA_EXE%" goto execute

echo.
echo ERROR: JAVA_HOME is set to an invalid directory: %JAVA_HOME%
echo.
echo Please set the JAVA_HOME variable in your environment to match the
echo location of your Java installation.
goto fail

:execute
set CLASSPATH=%APP_HOME%\\gradle\\wrapper\\gradle-wrapper.jar

"%JAVA_EXE%" %DEFAULT_JVM_OPTS% %JAVA_OPTS% %GRADLE_OPTS% "-Dorg.gradle.appname=%APP_BASE_NAME%" -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*

:end
if %ERRORLEVEL% equ 0 goto mainEnd

:fail
set EXIT_CODE=%ERRORLEVEL%
if %EXIT_CODE% equ 0 set EXIT_CODE=1
exit /b %EXIT_CODE%

:mainEnd
if "%OS%"=="Windows_NT" endlocal
`
  },
  {
    path: 'gradle/wrapper/gradle-wrapper.properties',
    content: `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.5-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`
  },
  {
    path: '.github/workflows/build-apk.yml',
    content: `name: Build Android APK

on:
  push:
    branches: [ "**" ]
  pull_request:
    branches: [ "**" ]
  workflow_dispatch:

jobs:
  build:
    name: Build Debug APK
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@v3

      - name: Ensure Gradle Wrapper & Permissions
        run: |
          chmod +x gradlew || true
          if [ ! -f gradle/wrapper/gradle-wrapper.jar ]; then
            echo "gradle-wrapper.jar not found in workspace. Downloading official Gradle 8.5 wrapper..."
            mkdir -p gradle/wrapper
            curl -fsSL https://raw.githubusercontent.com/gradle/gradle/v8.5.0/gradle/wrapper/gradle-wrapper.jar -o gradle/wrapper/gradle-wrapper.jar || gradle wrapper --gradle-version 8.5
          fi
          test -f gradle/wrapper/gradle-wrapper.jar && echo "Gradle wrapper jar is verified."

      - name: Build Debug APK with Gradle
        run: ./gradlew assembleDebug --stacktrace --no-daemon

      - name: Upload Debug APK Artifact
        uses: actions/upload-artifact@v4
        with:
          name: app-debug-apk
          path: app/build/outputs/apk/debug/*.apk
          if-no-files-found: error
`
  },
  {
    path: '.gitignore',
    content: `# Dependencies & Builds
node_modules/
build/
app/build/
dist/
coverage/
.gradle/

# Never ignore gradle wrapper
!gradle/wrapper/gradle-wrapper.jar

# Misc
.DS_Store
*.log
.env*
!.env.example
`
  },
  {
    path: 'app/proguard-rules.pro',
    content: `# ProGuard and R8 rules for Android WebView and CafeBazaar Poolakey SDK

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
`
  },
  {
    path: 'app/src/main/res/layout/activity_main.xml',
    content: `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/rootLayout"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/background">

    <WebView
        android:id="@+id/webView"
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:background="@color/background" />

    <FrameLayout
        android:id="@+id/bannerContainer"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_gravity="bottom"
        android:visibility="gone" />

</FrameLayout>
`
  },
  {
    path: 'app/src/main/res/values/strings.xml',
    content: `<resources>
    <string name="app_name">QuickGames</string>
</resources>
`
  },
  {
    path: 'app/src/main/res/values/colors.xml',
    content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="primary">#0E9F6E</color>
    <color name="primary_dark">#046C4E</color>
    <color name="accent">#10B981</color>
    <color name="background">#0F172A</color>
    <color name="surface">#1E293B</color>
    <color name="white">#FFFFFF</color>
</resources>
`
  },
  {
    path: 'app/src/main/res/values/themes.xml',
    content: `<resources>
    <style name="Theme.AndroidCafeBazaarWebView" parent="Theme.MaterialComponents.DayNight.NoActionBar">
        <item name="colorPrimary">@color/primary</item>
        <item name="colorPrimaryVariant">@color/primary_dark</item>
        <item name="colorOnPrimary">@color/white</item>
        <item name="colorSecondary">@color/accent</item>
        <item name="colorSecondaryVariant">@color/primary_dark</item>
        <item name="colorOnSecondary">@color/white</item>
        <item name="android:statusBarColor">@color/background</item>
        <item name="android:navigationBarColor">@color/background</item>
        <item name="android:windowBackground">@color/background</item>
    </style>
</resources>
`
  },
  {
    path: 'app/src/main/res/drawable/ic_launcher_background.xml',
    content: `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#0E9F6E"
        android:pathData="M0,0h108v108h-108z" />
    <path
        android:fillColor="#046C4E"
        android:pathData="M9,0L108,99L108,108L0,108L0,9Z" />
</vector>
`
  },
  {
    path: 'app/src/main/res/drawable/ic_launcher_foreground.xml',
    content: `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M38,36c0,-8.84 7.16,-16 16,-16s16,7.16 16,16h-6c0,-5.52 -4.48,-10 -10,-10s-10,4.48 -10,10h-6z" />
    <path
        android:fillColor="#FFFFFF"
        android:pathData="M32,36l-4,42c0,3.31 2.69,6 6,6h40c3.31,0 6,-2.69 6,-6l-4,-42H32zm22,34c-6.63,0 -12,-5.37 -12,-12s5.37,-12 12,-12 12,5.37 12,12 -5.37,12 -12,12z" />
    <path
        android:fillColor="#10B981"
        android:pathData="M54,50c-4.41,0 -8,3.59 -8,8s3.59,8 8,8 8,-3.59 8,-8 -3.59,-8 -8,-8zm0,11c-1.66,0 -3,-1.34 -3,-3s1.34,-3 3,-3 3,1.34 3,3 -1.34,3 -3,3z" />
</vector>
`
  },
  {
    path: 'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml',
    content: `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`
  },
  {
    path: 'app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml',
    content: `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>
`
  }
];

export const ALL_EXPORT_FILES: ExportableFile[] = [
  ...PROJECT_FILES.map(f => ({ path: f.path, content: f.content })),
  ...EXTRA_PROJECT_FILES
];
