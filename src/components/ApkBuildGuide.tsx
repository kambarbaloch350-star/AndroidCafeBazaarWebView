import React, { useState } from 'react';
import { 
  Download, 
  Package, 
  Copy, 
  Check, 
  Cpu, 
  ShieldCheck, 
  AlertCircle, 
  GitBranch, 
  FolderCheck,
  Terminal,
  Tv
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
            Build & Obtain Your APK
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed">
            The native Android Studio Kotlin project, Poolakey SDK, and the fixed Adivery Mobile Ads bridge are ready. Download the complete ready-to-compile project or build via GitHub Actions.
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

      {/* Adivery & CafeBazaar Bridge Status */}
      <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-4 flex items-start gap-3 text-slate-300 text-xs leading-relaxed">
        <Tv className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-emerald-300">Adivery Bridge Fix Applied:</span>
          <p className="mt-1 text-slate-400">
            Resolved promise hanging in <code className="text-slate-200">showRewarded()</code> and <code className="text-slate-200">showInterstitial()</code> by aligning <code className="text-slate-200">AdiveryBridge.onAdEvent</code>, adding Kotlin <code className="text-slate-200">@JavascriptInterface</code> zero-arg parameter overloads in <code className="text-slate-200">WebAppBridge.kt</code>, preventing script clobbering in <code className="text-slate-200">MainActivity.kt</code>, and adding error fallbacks.
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
              <li>Click <strong className="text-emerald-400">Download (.ZIP)</strong> above and extract.</li>
              <li>Open <strong>Android Studio</strong> & choose <strong>Open</strong>.</li>
              <li>Select the unzipped folder and allow Gradle to sync.</li>
              <li>Go to: <code className="text-emerald-300 bg-slate-950 px-1 py-0.5 rounded">Build &gt; Build Bundle(s) / APK(s) &gt; Build APK(s)</code>.</li>
              <li>Android Studio outputs your APK in under a minute!</li>
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
            <ol className="text-xs text-slate-300 space-y-2 list-decimal list-inside">
              <li>In AI Studio top menu, click <strong>Export to GitHub</strong> or push your code.</li>
              <li>Go to your GitHub repo &gt; <strong>Actions</strong> tab.</li>
              <li>Select <strong>Build Android APK</strong> &gt; click <strong>Run workflow</strong>.</li>
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
                  className="text-slate-400 hover:text-white p-1 cursor-pointer"
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

      {/* Checklist */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
        <div className="flex items-center gap-2.5 border-b border-slate-800 pb-3">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-white">
            Production Setup Checklist (CafeBazaar + Adivery)
          </h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 text-white font-bold">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px]">1</span>
              Adivery App ID &amp; Placements
            </div>
            <p className="text-slate-400 leading-relaxed">
              In <code className="text-emerald-300">AdiveryConfig.kt</code>, ensure your Adivery App ID and placement IDs for Banner, Interstitial, and Rewarded ads match your panel settings on <a href="https://panel.adivery.com" target="_blank" rel="noreferrer" className="text-indigo-400 underline">panel.adivery.com</a>.
            </p>
          </div>
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 text-white font-bold">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px]">2</span>
              Package Name (Application ID)
            </div>
            <p className="text-slate-400 leading-relaxed">
              Configured as <code className="text-emerald-300">com.emochi.quickgames</code> in <code className="text-emerald-300">app/build.gradle.kts</code>. Ensure this matches your registered app in CafeBazaar Pishkhan.
            </p>
          </div>
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 text-white font-bold">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px]">3</span>
              Automatic Coin Pack Consumption
            </div>
            <p className="text-slate-400 leading-relaxed">
              Consumable coin packs are automatically consumed in the background upon successful purchase, allowing repeated purchases without token lock errors.
            </p>
          </div>
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/80 space-y-2">
            <div className="flex items-center gap-2 text-white font-bold">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-[10px]">4</span>
              HTML5 / Node.js Virtual Domain Support
            </div>
            <p className="text-slate-400 leading-relaxed">
              Assets are served over <code className="text-indigo-300">https://appassets.androidplatform.net/</code>, resolving CORS and ES Module restrictions on mobile WebViews.
            </p>
          </div>
        </div>
      </div>

      {/* Included files */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <FolderCheck className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">
              Project Architecture Components
            </h3>
          </div>
          <span className="text-xs font-mono text-emerald-400">
            Poolakey v2.2.0 • Adivery v4.9.0 • Gradle 8.5
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
            <span className="text-emerald-400">✓</span> AdiveryManager.kt
          </div>
          <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 flex items-center gap-2">
            <span className="text-emerald-400">✓</span> AdiveryConfig.kt
          </div>
          <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 flex items-center gap-2">
            <span className="text-emerald-400">✓</span> CafeBazaarBillingManager.kt
          </div>
          <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 flex items-center gap-2">
            <span className="text-emerald-400">✓</span> android-bridge.js
          </div>
          <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 flex items-center gap-2">
            <span className="text-emerald-400">✓</span> bazaar-bridge.esm.js
          </div>
          <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-300 flex items-center gap-2">
            <span className="text-emerald-400">✓</span> build-apk.yml (CI)
          </div>
        </div>
      </div>
    </div>
  );
};
