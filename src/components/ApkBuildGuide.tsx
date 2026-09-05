import React, { useState } from 'react';
import { 
  Download, 
  Package, 
  CheckCircle2, 
  Copy, 
  Check, 
  ExternalLink, 
  Terminal, 
  Cpu, 
  ShieldCheck, 
  AlertCircle, 
  GitBranch, 
  FolderCheck,
  Smartphone,
  Layers,
  Sparkles
} from 'lucide-react';

interface ApkBuildGuideProps {
  onDownloadZip: () => void;
  downloadingZip: boolean;
  downloadProgress: number;
  downloadStatus: string;
}

export const ApkBuildGuide: React.FC<ApkBuildGuideProps> = ({
  onDownloadZip,
  downloadingZip,
  downloadProgress,
  downloadStatus
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="flex-1 flex flex-col p-6 max-w-6xl mx-auto w-full overflow-y-auto space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-3xl p-6 lg:p-8 shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-2 max-w-2xl">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <Package className="w-6 h-6" />
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
              Android APK Generation
            </span>
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold text-white tracking-tight">
            How to Build & Obtain Your APK
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed">
            The complete native Android Studio Kotlin project, Poolakey SDK configuration, and WebView assets are ready. Because an APK binary requires the native Android SDK and AAPT2 toolchains, you can build your APK using the methods below.
          </p>
        </div>

        {/* Primary Download Action */}
        <div className="flex flex-col gap-2 w-full md:w-auto shrink-0">
          <button
            onClick={onDownloadZip}
            disabled={downloadingZip}
            className="flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/20 transition-all active:scale-98 disabled:opacity-50 cursor-pointer"
          >
            <Download className="w-5 h-5" />
            {downloadingZip ? `Packaging ${downloadProgress}%...` : 'Download Android Project (.ZIP)'}
          </button>
          {downloadStatus && (
            <div className="text-center text-xs font-mono text-emerald-400 animate-pulse">
              {downloadStatus}
            </div>
          )}
          <span className="text-[11px] text-slate-400 text-center">
            Contains all Kotlin code, Gradle build files, and HTML5 assets
          </span>
        </div>
      </div>

      {/* Cloud Environment Notice */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex items-start gap-3 text-slate-300 text-xs leading-relaxed">
        <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-white">Why cannot a cloud web container compile raw APKs directly?</span>
          <p className="mt-1 text-slate-400">
            Compiling an Android APK requires compiling Java bytecode, Dalvik/D8 dexing, resource packaging with AAPT2, and signing against the 2.5GB+ Android 34 SDK and Gradle daemon. Web containers are designed for frontend Node.js previews. However, with the files generated here, you can generate your APK in under 2 minutes using <strong className="text-slate-200">Android Studio</strong>, the included <strong className="text-slate-200">GitHub Actions</strong> cloud runner, or command line!
          </p>
        </div>
      </div>

      {/* 3 Methods Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Method 1: Android Studio */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4 hover:border-slate-700 transition-colors">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                <Cpu className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-bold text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800/40">
                Recommended
              </span>
            </div>
            <h3 className="text-base font-bold text-white">Method 1: Android Studio</h3>
            <p className="text-xs text-slate-400">
              The official, quickest, and most visual way to compile debug or release APKs.
            </p>
            <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside">
              <li>Click <strong className="text-emerald-400">Download (.ZIP)</strong> above and unzip.</li>
              <li>Open <strong>Android Studio</strong> & choose <strong>Open</strong>.</li>
              <li>Select the unzipped folder and allow Gradle to sync.</li>
              <li>Go to: <code className="text-emerald-300 bg-slate-950 px-1 py-0.5 rounded">Build &gt; Build Bundle(s) / APK(s) &gt; Build APK(s)</code>.</li>
              <li>Android Studio outputs your APK in seconds!</li>
            </ol>
          </div>
          <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 text-[11px] font-mono text-slate-400 break-all">
            Output: app/build/outputs/apk/debug/app-debug.apk
          </div>
        </div>

        {/* Method 2: GitHub Actions */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4 hover:border-slate-700 transition-colors">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">
                <GitBranch className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-bold text-indigo-400 px-2 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-800/40">
                Automated Cloud CI
              </span>
            </div>
            <h3 className="text-base font-bold text-white">Method 2: GitHub Actions Cloud</h3>
            <p className="text-xs text-slate-400">
              Push to GitHub and let GitHub Actions compile the APK in the cloud.
            </p>
            <div className="p-2.5 rounded-xl bg-slate-950 border border-emerald-800/40 text-[11px] text-emerald-300">
              <strong>Fixed for GitHub:</strong> <code className="text-emerald-200">gradle-wrapper.jar</code> has been added to <code className="text-emerald-200">gradle/wrapper/</code> and the workflow auto-verifies the wrapper, resolving the <code className="text-amber-300">GradleWrapperMain</code> error!
            </div>
            <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside">
              <li>In AI Studio top menu, click <strong>Export to GitHub</strong> or push your code.</li>
              <li>Go to your GitHub repo &gt; <strong>Actions</strong> tab.</li>
              <li>Select <strong>Build Android APK</strong> &gt; click <strong>Run workflow</strong> (or push a commit).</li>
              <li>Once finished (~1 min), download the <strong className="text-indigo-400">app-debug-apk</strong> artifact.</li>
            </ol>
          </div>
          <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 text-[11px] font-mono text-indigo-300 flex items-center justify-between">
            <span>.github/workflows/build-apk.yml</span>
            <span className="text-[10px] text-emerald-400 font-sans">Ready</span>
          </div>
        </div>

        {/* Method 3: Command Line */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4 hover:border-slate-700 transition-colors">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                <Terminal className="w-5 h-5" />
              </div>
              <span className="text-[11px] font-bold text-amber-400 px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-800/40">
                Terminal
              </span>
            </div>
            <h3 className="text-base font-bold text-white">Method 3: Gradle CLI</h3>
            <p className="text-xs text-slate-400">
              For developers with JDK 17 and Android SDK installed on their terminal.
            </p>
            <div className="space-y-2 text-xs text-slate-300">
              <p>Navigate to the project root and execute:</p>
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex items-center justify-between font-mono text-xs text-amber-300">
                <span>./gradlew assembleDebug</span>
                <button
                  onClick={() => copyToClipboard('./gradlew assembleDebug', 'cmd-debug')}
                  className="text-slate-400 hover:text-white p-1"
                  title="Copy command"
                >
                  {copiedId === 'cmd-debug' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">On Windows Command Prompt, run <code className="text-amber-300">gradlew.bat assembleDebug</code>.</p>
            </div>
          </div>
          <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800/80 text-[11px] font-mono text-slate-400 break-all">
            Output: app/build/outputs/apk/debug/app-debug.apk
          </div>
        </div>
      </div>

      {/* CafeBazaar Integration Checklist */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
        <div className="flex items-center gap-2.5 border-b border-slate-800 pb-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-white">
            Essential Checklist Before Uploading to CafeBazaar
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 text-white font-bold">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px]">1</span>
              Match Package Name (Application ID)
            </div>
            <p className="text-slate-400 leading-relaxed">
              Open <code className="text-emerald-300">app/build.gradle.kts</code> and change <code className="text-emerald-300">applicationId = &quot;com.example.webapp&quot;</code> to the exact package name registered in your CafeBazaar Pishkhan developer panel.
            </p>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 text-white font-bold">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px]">2</span>
              Configure RSA Public Key
            </div>
            <p className="text-slate-400 leading-relaxed">
              In <code className="text-emerald-300">CafeBazaarConfig.kt</code>, paste your Base64 RSA public key obtained from CafeBazaar developer dashboard for on-device cryptographic verification.
            </p>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 text-white font-bold">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px]">3</span>
              Upload Initial Draft APK
            </div>
            <p className="text-slate-400 leading-relaxed">
              CafeBazaar requires an initial APK to be uploaded as a draft once before Poolakey SDK can query or purchase your SKUs.
            </p>
          </div>

          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 text-white font-bold">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px]">4</span>
              Setup Test Accounts for Free Testing
            </div>
            <p className="text-slate-400 leading-relaxed">
              Add your CafeBazaar account email under <em>Settings &gt; Test Users</em> in the Bazaar console so you can test purchases without being charged real money.
            </p>
          </div>
        </div>
      </div>

      {/* Node.js / Vite / HTML5 Game Compatibility Guide */}
      <div className="bg-gradient-to-br from-indigo-950/40 via-slate-900 to-slate-900 border border-indigo-500/30 rounded-3xl p-6 lg:p-8 space-y-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-bold uppercase tracking-wider">
                Node.js &amp; HTML5 Game Engine Support
              </span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Using with Built Node.js Files (<code className="text-indigo-400 font-mono text-base">/dist</code> in <code className="text-indigo-400 font-mono text-base">/assets</code>)
            </h2>
            <p className="text-xs text-slate-300">
              Compatible out-of-the-box with Vite, Webpack, React, Vue, Svelte, Phaser, Pixi.js, Three.js, and Babylon.js.
            </p>
          </div>
          <span className="text-xs font-mono px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5 self-start md:self-auto">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            Virtual HTTPS Host Enabled
          </span>
        </div>

        {/* 3 Pillars of Node.js Compatibility */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
            <div className="font-semibold text-emerald-400 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center font-bold">1</span>
              ES Modules &amp; CORS Fixed
            </div>
            <p className="text-slate-400 leading-relaxed">
              Modern bundlers produce <code className="text-slate-300 font-mono">&lt;script type="module"&gt;</code> which Android blocks on <code className="text-slate-300 font-mono">file://</code>. Our <strong className="text-slate-200">WebAppAssetResolver</strong> serves assets over <code className="text-indigo-300 font-mono">https://appassets.androidplatform.net/</code>, allowing full module execution and CORS-free <code className="text-slate-300 font-mono">fetch()</code>.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
            <div className="font-semibold text-emerald-400 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center font-bold">2</span>
              Dual Directory Resolution
            </div>
            <p className="text-slate-400 leading-relaxed">
              Whether you paste your build output into <code className="text-indigo-300 font-mono">app/src/main/assets/</code> or directly as <code className="text-indigo-300 font-mono">app/src/main/assets/dist/</code>, the asset resolver detects <code className="text-slate-300 font-mono">index.html</code> and maps root paths (<code className="text-slate-300 font-mono">/assets/...</code>) automatically!
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
            <div className="font-semibold text-emerald-400 flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center font-bold">3</span>
              WebAssembly &amp; Game Audio
            </div>
            <p className="text-slate-400 leading-relaxed">
              Native support for <code className="text-slate-300 font-mono">.wasm</code> MIME types (<code className="text-slate-300 font-mono">application/wasm</code>), WebGL rendering, Web Audio with autoplay unlocked (<code className="text-slate-300 font-mono">mediaPlaybackRequiresUserGesture = false</code>), and IndexedDB for game progress saves.
            </p>
          </div>
        </div>

        {/* Step-by-Step Instructions */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            Quick 2-Step Integration For Your Game
          </h3>

          <div className="space-y-3">
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <span className="text-emerald-400">Step 1:</span> Build your game and copy <code className="text-emerald-300 font-mono">/dist</code> files into <code className="text-emerald-300 font-mono">assets/</code>
                </span>
                <button
                  onClick={() => copyToClipboard('npm run build && cp -r dist/* ../AndroidApp/app/src/main/assets/', 'step-build')}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copiedId === 'step-build' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  Copy command
                </button>
              </div>
              <div className="bg-slate-900 rounded-xl p-3 font-mono text-xs text-slate-300 overflow-x-auto">
                # Inside your Node.js game directory:
                <br />
                <span className="text-emerald-400">npm run build</span>
                <br />
                # Copy dist files into the Android project assets:
                <br />
                <span className="text-emerald-400">cp -r dist/* /path/to/android-project/app/src/main/assets/</span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <span className="text-emerald-400">Step 2:</span> Trigger CafeBazaar purchases in your game code (Promise API)
                </span>
                <button
                  onClick={() => copyToClipboard(`// In your JavaScript or TypeScript game code:
async function purchaseCoins() {
  try {
    // 1. Trigger CafeBazaar in-app purchase dialog
    const purchase = await window.CafeBazaar.purchase('coins_100');
    console.log('Purchase successful! Token:', purchase.purchaseToken);

    // 2. Consume token to grant virtual items (for consumable items)
    await window.CafeBazaar.consumePurchase(purchase.purchaseToken);
    
    // 3. Credit coins to player
    player.coins += 100;
    alert('Purchased 100 Coins successfully!');
  } catch (error) {
    console.error('Purchase failed or canceled:', error);
  }
}`, 'step-code')}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copiedId === 'step-code' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  Copy code
                </button>
              </div>
              <div className="bg-slate-900 rounded-xl p-3 font-mono text-xs text-slate-300 overflow-x-auto">
                <pre className="text-indigo-200">
{`// In your JavaScript, TypeScript, or game loop:
async function purchaseCoins() {
  try {
    const purchase = await window.CafeBazaar.purchase('coins_100');
    await window.CafeBazaar.consumePurchase(purchase.purchaseToken);
    player.coins += 100;
  } catch (error) {
    console.error('Purchase canceled:', error);
  }
}`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Project Structure Included in APK */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <FolderCheck className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              Files Included in Your Generated Android Project
            </h3>
          </div>
          <span className="text-xs font-mono text-emerald-400">
            Poolakey v2.2.0 • Gradle 8.5 • Kotlin 1.9.23
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-xs font-mono">
          <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 flex items-center gap-2">
            <span className="text-emerald-400">✓</span> MainActivity.kt
          </div>
          <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 flex items-center gap-2">
            <span className="text-emerald-400">✓</span> WebAppBridge.kt
          </div>
          <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 flex items-center gap-2">
            <span className="text-emerald-400">✓</span> CafeBazaarBillingManager.kt
          </div>
          <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 flex items-center gap-2">
            <span className="text-emerald-400">✓</span> CafeBazaarConfig.kt
          </div>
          <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 flex items-center gap-2">
            <span className="text-emerald-400">✓</span> AndroidManifest.xml
          </div>
          <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 flex items-center gap-2">
            <span className="text-emerald-400">✓</span> android-bridge.js
          </div>
          <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 flex items-center gap-2">
            <span className="text-emerald-400">✓</span> gradlew &amp; wrapper
          </div>
          <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 flex items-center gap-2">
            <span className="text-emerald-400">✓</span> build-apk.yml (CI)
          </div>
        </div>
      </div>
    </div>
  );
};
