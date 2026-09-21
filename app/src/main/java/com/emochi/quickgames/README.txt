Native container – source map
=============================

Architecture
------------
    Android App -> Local HTTP Server -> WebView -> assets/web/index.html

App.kt                     Application entry point: Firebase bootstrap,
                           native notification channels, Najva push init.
MainActivity.kt            The container: loading plate state machine, WebView
                           configuration (heavy WebApps), fullscreen media,
                           back navigation, family lifecycle, native ad plate.
WebAppServerController.kt  Process-wide owner of the single LocalWebServer so
                           the WebView origin survives Activity recreation.
LocalWebServer.kt          Embedded HTTP/1.1 server (loopback only): gzip,
                           ETag/304, correct MIME types, SPA fallback,
                           cross-origin isolation headers.
MimeTypes.kt               MIME table for modern web formats (wasm, mjs, ...).
WebAppBridge.kt            window.AndroidBridge – the only JS surface.
DeepLinkBus.kt             Buffers push/deep-link routes until the WebApp is
                           ready (NativeApp.appReady()).

Advertising (native only)
-------------------------
TapsellConfig.kt           Build-time injected app key + ad zones.
TapsellManager.kt          Interstitial / rewarded / native lifecycle, request
                           queueing, error containment (ads never crash the app).

Push notifications (native only)
--------------------------------
NajvaConfig.kt             Native Najva metadata + notification channel ids.
NajvaManager.kt            Najva client init, channels, foreground/background
                           handling, tap -> deep link -> WebView route.

In-app billing (unchanged)
--------------------------
CafeBazaarConfig.kt        Product ids / prices / RSA key.
CafeBazaarBillingManager.kt Poolakey connection, purchase, consume, query.
BillingResult.kt           JSON payloads sent to JavaScript.

Removed
-------
The previous advertising SDK (config object, manager, gradle dependency, maven
repository, placement ids, bridge methods, proguard rules and web assets) was
deleted completely. Tapsell is now the only advertising provider.

Notes
-----
* JavaScript never receives a Tapsell or Najva identifier.
* `/redirect` on the local server is a stable boot URL (302) that keeps the
  WebView origin constant across Activity recreation.
