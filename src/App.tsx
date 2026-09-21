import React, { useState, useEffect, useMemo } from 'react';
import {
  Smartphone,
  Code2,
  Terminal,
  Copy,
  Check,
  Download,
  Package,
  Server,
  Shield,
  Bell,
  Zap,
  Layers,
  RefreshCw,
  Play,
  RotateCcw
} from 'lucide-react';
import { PROJECT_FILES } from './data/projectFiles';
import { ProjectFile, BillingLogItem, BootStage, AdEventItem } from './types';
import { downloadAndroidProjectZip } from './utils/zipExport';
import { ApkBuildGuide } from './components/ApkBuildGuide';

/** The boot pipeline implemented natively in MainActivity.kt. */
const BOOT_STEPS: { stage: BootStage; fa: string; en: string; detail: string }[] = [
  {
    stage: 'server',
    fa: 'راه‌اندازی سرور داخلی…',
    en: 'Local HTTP server',
    detail: '127.0.0.1:<port> • gzip • ETag • SPA fallback'
  },
  {
    stage: 'webview',
    fa: 'آماده‌سازی نمایشگر وب…',
    en: 'WebView configuration',
    detail: 'JS • DOM storage • WebGL • WASM • media • COOP/COEP'
  },
  {
    stage: 'webapp',
    fa: 'در انتظار آماده‌شدن برنامه…',
    en: 'WebApp initialization',
    detail: 'index.html mounts, hydrates, first paint'
  },
  {
    stage: 'ready',
    fa: 'برنامه آماده است',
    en: 'NativeApp.appReady()',
    detail: 'loading plate fades out — no arbitrary delay'
  }
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'preview' | 'apk' | 'code' | 'logcat'>('preview');
  const [selectedFile, setSelectedFile] = useState<ProjectFile>(PROJECT_FILES[5]); // MainActivity.kt
  const [copied, setCopied] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState('');

  // ---------------------------------------------------------------- boot sim
  const [bootStage, setBootStage] = useState<BootStage>('server');
  const [bootLog, setBootLog] = useState<string[]>([]);

  // ------------------------------------------------------------ ad simulator
  const [adsReady, setAdsReady] = useState(false);
  const [adEvents, setAdEvents] = useState<AdEventItem[]>([]);
  const [adOverlay, setAdOverlay] = useState<'interstitial' | 'rewarded' | null>(null);
  const [rewardCountdown, setRewardCountdown] = useState(4);
  const [nativeAdVisible, setNativeAdVisible] = useState(false);
  const [rewardedTotal, setRewardedTotal] = useState(0);

  // ------------------------------------------------------------- push demo
  const [pushVisible, setPushVisible] = useState(false);
  const [route, setRoute] = useState<'ads' | 'capabilities' | 'container'>('ads');

  // ---------------------------------------------------------------- logcat
  const [logs, setLogs] = useState<BillingLogItem[]>([
    {
      id: '1',
      timestamp: '10:00:00.100',
      tag: 'Container',
      level: 'I',
      message: 'App.onCreate: notification channels created, Najva push initialized (native)'
    },
    {
      id: '2',
      timestamp: '10:00:00.240',
      tag: 'Container',
      level: 'I',
      message: 'MainActivity.onCreate: native loading plate shown (green plate, Vazirmatn, RTL)'
    },
    {
      id: '3',
      timestamp: '10:00:00.310',
      tag: 'LocalWebServer',
      level: 'I',
      message: 'Local HTTP server ready at http://127.0.0.1:41873/ (entry=web/index.html)'
    },
    {
      id: '4',
      timestamp: '10:00:00.420',
      tag: 'TapsellManager',
      level: 'I',
      message: 'Tapsell initialized — preloading interstitial & rewarded zones'
    },
    {
      id: '5',
      timestamp: '10:00:00.610',
      tag: 'WebAppConsole',
      level: 'I',
      message: 'NativeApp.appReady() -> true (loading plate hidden)'
    }
  ]);

  const addLog = (tag: BillingLogItem['tag'], level: BillingLogItem['level'], message: string) => {
    const now = new Date();
    const ts =
      now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    setLogs(prev => [
      ...prev.slice(-160),
      { id: Math.random().toString(36).substring(7), timestamp: ts, tag, level, message }
    ]);
  };

  const pushBootLog = (line: string) =>
    setBootLog(prev => [...prev.slice(-8), line]);

  const addAdEvent = (type: string, detail: string, ok: boolean) => {
    const at = new Date().toTimeString().split(' ')[0];
    setAdEvents(prev => [
      { id: Math.random().toString(36).substring(7), type, detail, ok, at },
      ...prev.slice(0, 11)
    ]);
  };

  // Deterministic boot animation – mirrors the native state machine exactly.
  useEffect(() => {
    if (bootStage === 'ready' || bootStage === 'error') return;
    const order: BootStage[] = ['server', 'webview', 'webapp', 'ready'];
    const index = order.indexOf(bootStage);
    const step = BOOT_STEPS.find(s => s.stage === bootStage);
    const timer = setTimeout(() => {
      if (step) {
        pushBootLog(`[container] ${step.en}: ${step.detail}`);
        addLog('Container', 'I', `${step.en} → ${step.detail}`);
      }
      const next = order[index + 1];
      if (next === 'ready') {
        setAdsReady(true);
        addLog('TapsellManager', 'I', 'Ad zones ready (interstitial, rewarded, native)');
        addLog('WebAppConsole', 'I', 'NativeApp.appReady() -> true');
      }
      setBootStage(next);
    }, 1100);
    return () => clearTimeout(timer);
  }, [bootStage]);

  // Rewarded video countdown
  useEffect(() => {
    if (adOverlay !== 'rewarded' || rewardCountdown === 0) return;
    const timer = setTimeout(() => setRewardCountdown(prev => prev - 1), 1000);
    return () => clearTimeout(timer);
  }, [adOverlay, rewardCountdown]);

  useEffect(() => {
    if (adOverlay !== 'rewarded' || rewardCountdown > 0) return;
    setAdOverlay(null);
    setRewardedTotal(prev => prev + 1);
    addLog('TapsellManager', 'I', 'onRewarded → reward granted (1 spin)');
    addAdEvent('rewarded_closed', 'rewardGranted: true', true);
  }, [adOverlay, rewardCountdown]);

  const showInterstitial = () => {
    if (!adsReady) {
      addLog('TapsellManager', 'W', 'showInterstitial() queued — SDK still initializing');
      addAdEvent('ad_error', 'INTERSTITIAL_REQUEST_FAILED (queued, WebApp unaffected)', false);
      return;
    }
    addLog('WebAppConsole', 'I', 'NativeAds.showInterstitial() called');
    setAdOverlay('interstitial');
    addAdEvent('interstitial_shown', 'zone: native-side only', true);
  };

  const showRewarded = () => {
    if (!adsReady) {
      addLog('TapsellManager', 'W', 'showRewarded() queued — SDK still initializing');
      addAdEvent('ad_error', 'REWARDED_REQUEST_FAILED (queued, WebApp unaffected)', false);
      return;
    }
    addLog('WebAppConsole', 'I', 'NativeAds.showRewarded() called');
    setRewardCountdown(4);
    setAdOverlay('rewarded');
    addAdEvent('rewarded_shown', 'zone: native-side only', true);
  };

  const showNative = () => {
    setNativeAdVisible(true);
    addLog('TapsellManager', 'I', 'showNativeAd → rendered into native ad plate');
    addAdEvent('native_shown', 'AdHolder(native_banner)', true);
  };

  /** Simulates a Najva system notification arriving while the app is open. */
  const simulatePush = () => {
    setPushVisible(true);
    addLog('NajvaManager', 'I', 'Push received (native system notification, foreground)');
  };

  /** A tap on the notification re-opens the app and routes the WebApp. */
  const tapPush = () => {
    setPushVisible(false);
    setRoute('capabilities');
    addLog('NajvaManager', 'I', 'Notification tapped → MainActivity intent route="capabilities"');
    addLog('Container', 'I', 'DeepLinkBus: route buffered until NativeApp.appReady()');
    addLog('WebAppConsole', 'I', 'deep link delivered → location.hash = "#/capabilities"');
  };

  const restartBoot = () => {
    setBootStage('server');
    setBootLog([]);
    setAdsReady(false);
    setAdEvents([]);
    setNativeAdVisible(false);
    setRewardedTotal(0);
    addLog('Container', 'I', 'Retry pressed → booting container again (no duplicate server)');
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadZip = async () => {
    try {
      setDownloadingZip(true);
      await downloadAndroidProjectZip((pct, status) => {
        setDownloadProgress(pct);
        setDownloadStatus(status);
      });
    } catch (err) {
      console.error('Failed to download project zip:', err);
    } finally {
      setDownloadingZip(false);
      setDownloadProgress(0);
      setDownloadStatus('');
    }
  };

  const booted = bootStage === 'ready';
  const currentStep = useMemo(
    () => BOOT_STEPS.find(s => s.stage === bootStage) ?? BOOT_STEPS[3],
    [bootStage]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
      {/* ------------------------------------------------------------ header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-4 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-lg">
            <Layers className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">WebApp Container</h1>
              <span className="px-2 py-0.5 text-[11px] font-mono rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-800/40">
                com.emochi.quickgames
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Local HTTP Server &rarr; WebView &bull; Tapsell Ads (native) &bull; Najva Push (native)
              &bull; CafeBazaar Billing
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-800/80 p-1 rounded-xl border border-slate-700/60">
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'preview'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              Container
            </button>
            <button
              onClick={() => setActiveTab('apk')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'apk'
                  ? 'bg-amber-400 text-slate-950 shadow-sm'
                  : 'text-amber-400/90 hover:text-amber-300'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              Build APK
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'code'
                  ? 'bg-indigo-500 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              Sources
            </button>
            <button
              onClick={() => setActiveTab('logcat')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'logcat'
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              Logcat ({logs.length})
            </button>
          </div>

          <button
            onClick={handleDownloadZip}
            disabled={downloadingZip}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white border border-slate-700 transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            {downloadingZip ? 'Packaging…' : 'Export ZIP'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {activeTab === 'apk' && (
          <ApkBuildGuide
            onDownloadZip={handleDownloadZip}
            downloadingZip={downloadingZip}
            downloadProgress={downloadProgress}
            downloadStatus={downloadStatus}
          />
        )}

        {/* ------------------------------------------------------- preview */}
        {activeTab === 'preview' && (
          <div className="flex-1 flex flex-col xl:flex-row p-6 gap-6 overflow-y-auto max-w-[1500px] mx-auto w-full items-start">
            {/* Phone mockup */}
            <div className="w-[390px] h-[780px] bg-slate-900 border-4 border-slate-700 rounded-[44px] shadow-2xl overflow-hidden flex flex-col relative shrink-0 mx-auto xl:mx-0">
              <div className="h-7 bg-slate-900 flex items-center justify-center shrink-0">
                <div className="w-20 h-4 bg-slate-950 rounded-b-xl flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-slate-800 mr-2" />
                  <div className="w-8 h-1 rounded-full bg-slate-800" />
                </div>
              </div>

              <div className="px-5 py-1 bg-slate-950 text-[10px] text-slate-400 flex justify-between items-center select-none shrink-0 border-b border-slate-900">
                <span>12:00</span>
                <span className="font-mono text-emerald-400">127.0.0.1 &bull; Tapsell &bull; Najva</span>
                <span>100%</span>
              </div>

              <div className="flex-1 relative overflow-hidden bg-[#04170F]">
                {/* ============ WebView content ============ */}
                <div className="absolute inset-0 overflow-y-auto p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between bg-emerald-900/30 border border-emerald-700/40 rounded-2xl p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                        <Server className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-emerald-100">assets/web/index.html</div>
                        <div className="text-[10px] text-emerald-400/80 font-mono">
                          http://127.0.0.1:41873
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {(['ads', 'capabilities', 'container'] as const).map(tab => (
                        <button
                          key={tab}
                          onClick={() => setRoute(tab)}
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${
                            route === tab
                              ? 'bg-emerald-500 text-slate-950'
                              : 'bg-slate-800/70 text-slate-300'
                          }`}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>
                  </div>

                  {route === 'ads' && (
                    <div className="bg-slate-900/80 border border-slate-700/50 rounded-2xl p-3.5 flex flex-col gap-2.5">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-400" />
                        <span className="text-xs font-bold text-white">
                          تبلیغات بومی (Tapsell)
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        شناسه‌ها فقط در لایه بومی هستند. متدها Promise برمی‌گردانند که همیشه پایان
                        می‌یابد؛ خطای تبلیغ هرگز برنامه را متوقف نمی‌کند.
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={showInterstitial}
                          className="py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer"
                        >
                          showInterstitial()
                        </button>
                        <button
                          onClick={showRewarded}
                          className="py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer"
                        >
                          showRewarded()
                        </button>
                        <button
                          onClick={showNative}
                          className="py-2 rounded-xl bg-slate-800 text-emerald-300 text-[11px] font-bold border border-slate-700 cursor-pointer"
                        >
                          showNative()
                        </button>
                        <button
                          onClick={() => {
                            setNativeAdVisible(false);
                            addLog('TapsellManager', 'I', 'hideNative() → plate removed');
                          }}
                          className="py-2 rounded-xl bg-slate-800 text-slate-300 text-[11px] font-bold border border-slate-700 cursor-pointer"
                        >
                          hideNative()
                        </button>
                      </div>
                      <div className="text-[10px] text-emerald-400/90 font-mono">
                        rewarded granted: {rewardedTotal} • sdk: {adsReady ? 'READY' : 'INIT…'}
                      </div>
                    </div>
                  )}

                  {route === 'capabilities' && (
                    <div className="bg-slate-900/80 border border-slate-700/50 rounded-2xl p-3.5 flex flex-col gap-2">
                      <span className="text-xs font-bold text-white">گزارش قابلیت‌ها</span>
                      {[
                        ['ES modules (import)', 'text/javascript'],
                        ['WebAssembly', 'application/wasm'],
                        ['IndexedDB + typed arrays', 'origin-scoped'],
                        ['Canvas / WebGL', 'hardware accelerated'],
                        ['fetch(/__health)', 'local HTTP server'],
                        ['SharedArrayBuffer', 'COOP + COEP headers']
                      ].map(([name, hint]) => (
                        <div
                          key={name}
                          className="flex items-center justify-between text-[10px] border-b border-slate-800 pb-1.5 last:border-0"
                        >
                          <span className="text-slate-200 font-semibold">{name}</span>
                          <span className="font-mono text-emerald-400">{hint}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {route === 'container' && (
                    <div className="bg-slate-900/80 border border-slate-700/50 rounded-2xl p-3.5 flex flex-col gap-2">
                      <span className="text-xs font-bold text-white">محتوا و مسیر‌یابی</span>
                      <button
                        onClick={simulatePush}
                        className="py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Bell className="w-3.5 h-3.5" />
                        شبیه‌سازی اعلان نجوا
                      </button>
                      <button
                        onClick={restartBoot}
                        className="py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-[11px] font-bold flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        اجرای مجدد چرخه راه‌اندازی
                      </button>
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        سیاست بازگشت: ابتدا رسانه تمام‌صفحه، سپس تبلیغ بومی، سپس هوک
                        <span className="font-mono text-emerald-300"> NativeApp.onBackPressed </span>
                        و در نهایت تاریخچه WebView و خروج از برنامه.
                      </p>
                    </div>
                  )}

                  {/* Native ad plate (rendered by the Activity, not by JS) */}
                  {nativeAdVisible && (
                    <div className="mt-auto relative bg-emerald-900/40 border border-emerald-600/50 rounded-2xl p-3">
                      <span className="absolute -top-2 right-3 text-[9px] font-bold bg-emerald-500 text-slate-950 px-1.5 py-0.5 rounded">
                        AD
                      </span>
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-300 text-lg">
                          ✦
                        </div>
                        <div className="flex-1">
                          <div className="text-[11px] font-bold text-emerald-100">
                            تبلیغ بومی تپسل
                          </div>
                          <div className="text-[10px] text-emerald-400/80">
                            AdHolder(ir.tapsell.plus.R.layout.native_banner)
                          </div>
                        </div>
                        <button
                          onClick={() => setNativeAdVisible(false)}
                          className="w-6 h-6 rounded-full bg-black/40 text-white text-[10px] cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* ============ Native loading plate ============ */}
                {!booted && (
                  <div className="absolute inset-0 bg-gradient-to-b from-[#F1FBF4] to-[#D6EFE0] flex flex-col items-center justify-center gap-4 px-8 transition-opacity">
                    <div className="relative w-[148px] h-[148px] flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full border-4 border-emerald-200" />
                      <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-emerald-500 animate-spin" />
                      <div className="w-[120px] h-[120px] rounded-full bg-white border-2 border-emerald-400 flex items-center justify-center shadow-lg">
                        <svg viewBox="0 0 48 48" className="w-16 h-16">
                          <rect width="48" height="48" rx="10" fill="#047857" />
                          <path
                            d="M18 17l-5 7 5 7M30 17l5 7-5 7"
                            stroke="#F1FBF4"
                            strokeWidth="3.4"
                            fill="none"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    </div>
                    <div className="text-center" dir="rtl">
                      <div className="text-xl font-extrabold text-emerald-900">QuickGames</div>
                      <div className="mt-1.5 text-[15px] font-semibold text-teal-700">
                        در حال بارگذاری...
                      </div>
                      <div className="mt-1 text-[11px] text-emerald-700/80">{currentStep.fa}</div>
                    </div>
                    <div className="w-full mt-2 flex flex-col gap-1.5" dir="rtl">
                      {BOOT_STEPS.map((step, index) => {
                        const active = step.stage === bootStage;
                        const done = BOOT_STEPS.findIndex(s => s.stage === bootStage) > index;
                        return (
                          <div
                            key={step.stage}
                            className={`flex items-center gap-2 text-[10px] font-mono ${
                              active ? 'text-emerald-800' : done ? 'text-emerald-600' : 'text-emerald-700/40'
                            }`}
                          >
                            <span className="w-3 text-center">{done ? '✓' : active ? '◉' : '○'}</span>
                            <span className="flex-1 text-left">{step.en}</span>
                            <span dir="rtl">{step.fa}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ============ Interstitial / rewarded overlay ============ */}
                {adOverlay && (
                  <div className="absolute inset-0 bg-black/85 backdrop-blur flex flex-col items-center justify-center gap-3 p-6 text-center">
                    <span className="text-[10px] font-bold bg-emerald-500 text-slate-950 px-2 py-0.5 rounded">
                      AD · TAPSELL
                    </span>
                    <div className="text-sm font-bold text-white">
                      {adOverlay === 'interstitial' ? 'تبلیغ تمام‌صفحه' : 'ویدیوی جایزه‌دار'}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {adOverlay === 'interstitial'
                        ? 'isShowingAd = true — WebView paused behind the ad activity'
                        : `پاداش پس از ${rewardCountdown} ثانیه`}
                    </div>
                    {adOverlay === 'rewarded' && (
                      <div className="w-40 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 transition-all duration-1000"
                          style={{ width: `${((4 - rewardCountdown) / 4) * 100}%` }}
                        />
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setAdOverlay(null);
                        addAdEvent(
                          adOverlay === 'interstitial' ? 'interstitial_closed' : 'rewarded_closed',
                          adOverlay === 'interstitial' ? 'ok: true' : 'rewardGranted: false (skipped)',
                          true
                        );
                        addLog(
                          'TapsellManager',
                          'I',
                          `${adOverlay === 'interstitial' ? 'onInterstitialClosed' : 'onRewardedClosed'} → reloading next ad`
                        );
                      }}
                      className="px-4 py-1.5 rounded-full bg-slate-800 text-slate-200 text-[11px] font-bold border border-slate-600 cursor-pointer"
                    >
                      بستن تبلیغ
                    </button>
                  </div>
                )}

                {/* ============ Najva system notification ============ */}
                {pushVisible && (
                  <button
                    onClick={tapPush}
                    className="absolute top-2 inset-x-2 bg-slate-900/95 border border-emerald-600/40 rounded-2xl p-3 text-right shadow-2xl cursor-pointer"
                    dir="rtl"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                        <Bell className="w-3.5 h-3.5 text-emerald-400" />
                      </div>
                      <div className="flex-1">
                        <div className="text-[11px] font-bold text-white">
                          QuickGames • اعلان سیستمی اندروید
                        </div>
                        <div className="text-[10px] text-slate-400">
                          تست قابلیت‌ها را ببین — برای ادامه لمس کنید
                        </div>
                      </div>
                    </div>
                  </button>
                )}
              </div>
            </div>

            {/* ---------------------------------------------- side panels */}
            <div className="flex-1 flex flex-col gap-4 min-w-0 w-full">
              <section className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-white flex items-center gap-2">
                    <Server className="w-4 h-4 text-emerald-400" />
                    Boot pipeline (native, deterministic)
                  </h2>
                  <button
                    onClick={restartBoot}
                    className="text-[11px] font-semibold text-slate-400 hover:text-white flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" /> replay
                  </button>
                </div>
                <div className="grid md:grid-cols-2 gap-2">
                  {BOOT_STEPS.map((step, index) => {
                    const activeIndex = BOOT_STEPS.findIndex(s => s.stage === bootStage);
                    const done = booted ? true : activeIndex > index;
                    const active = step.stage === bootStage;
                    return (
                      <div
                        key={step.stage}
                        className={`rounded-xl border p-3 transition-all ${
                          active
                            ? 'border-emerald-500/60 bg-emerald-950/40'
                            : done
                            ? 'border-emerald-800/40 bg-slate-900/60'
                            : 'border-slate-800 bg-slate-900/40'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-mono text-slate-400">
                            step {index + 1}
                          </span>
                          <span
                            className={`text-[10px] font-bold ${
                              done || active ? 'text-emerald-400' : 'text-slate-600'
                            }`}
                          >
                            {done ? 'DONE' : active ? 'RUNNING' : 'PENDING'}
                          </span>
                        </div>
                        <div className="text-xs font-bold text-white mt-1">{step.en}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{step.detail}</div>
                        <div className="text-[10px] text-emerald-400/90 mt-1" dir="rtl">
                          {step.fa}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <pre className="mt-3 bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-[10px] leading-relaxed text-emerald-300/90 font-mono max-h-32 overflow-auto">
                  {bootLog.length ? bootLog.join('\n') : 'waiting for container…'}
                </pre>
              </section>

              <div className="grid lg:grid-cols-2 gap-4">
                <section className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
                  <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
                    <Zap className="w-4 h-4 text-amber-400" />
                    Ad events (NativeAds.on)
                  </h2>
                  <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto">
                    {adEvents.length === 0 && (
                      <p className="text-[11px] text-slate-500">
                        No ad events yet — press an ad button in the phone mockup.
                      </p>
                    )}
                    {adEvents.map(event => (
                      <div
                        key={event.id}
                        className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-mono flex items-center gap-2 ${
                          event.ok
                            ? 'border-emerald-800/50 bg-emerald-950/30 text-emerald-300'
                            : 'border-amber-800/50 bg-amber-950/20 text-amber-300'
                        }`}
                      >
                        <span className="text-slate-500">{event.at}</span>
                        <span className="font-bold">{event.type}</span>
                        <span className="text-slate-400 truncate">{event.detail}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
                  <h2 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    Container guarantees
                  </h2>
                  <ul className="text-[11px] text-slate-300 flex flex-col gap-2 leading-relaxed">
                    <li>
                      • <span className="font-mono text-emerald-300">NativeApp.appReady()</span> is the
                      only way the loading plate disappears — no arbitrary delay.
                    </li>
                    <li>
                      • One server + one WebView per process: duplicate initialization is impossible
                      (server is owned by <span className="font-mono">WebAppServerController</span>).
                    </li>
                    <li>
                      • Ad and push failures are contained natively; every JS promise always settles.
                    </li>
                    <li>
                      • No Tapsell/Najva identifier ever reaches JavaScript.
                    </li>
                    <li>
                      • Renderer crash → WebView is rebuilt and the WebApp reboots (no app crash).
                    </li>
                  </ul>
                </section>
              </div>
            </div>
          </div>
        )}

        {/* ----------------------------------------------------------- code */}
        {activeTab === 'code' && (
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
            <aside className="lg:w-96 w-full border-b lg:border-b-0 lg:border-l border-slate-800 bg-slate-900/50 overflow-y-auto max-h-64 lg:max-h-none">
              <div className="p-4 border-b border-slate-800 sticky top-0 bg-slate-900/90 backdrop-blur z-10">
                <h2 className="text-sm font-bold text-white">Project files</h2>
                <p className="text-[11px] text-slate-400 mt-1">
                  {PROJECT_FILES.length} sources — generated from the real repository.
                </p>
              </div>
              <div className="p-2">
                {PROJECT_FILES.map(file => (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFile(file)}
                    className={`w-full text-right px-3 py-2 rounded-lg mb-1 transition-all cursor-pointer ${
                      selectedFile.path === file.path
                        ? 'bg-emerald-500/15 border border-emerald-600/40'
                        : 'hover:bg-slate-800/60 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-white truncate">{file.name}</span>
                      <span className="text-[9px] font-mono text-slate-500 uppercase">
                        {file.category}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono truncate" dir="ltr">
                      {file.path}
                    </div>
                  </button>
                ))}
              </div>
            </aside>

            <section className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 border-b border-slate-800 bg-slate-900/60 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-white font-mono truncate">
                    {selectedFile.path}
                  </h2>
                  <p className="text-[11px] text-slate-400 mt-1">{selectedFile.description}</p>
                </div>
                <button
                  onClick={handleCopyCode}
                  className="shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-white cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </>
                  )}
                </button>
              </div>
              <pre className="flex-1 overflow-auto p-4 text-[11px] leading-relaxed font-mono text-slate-300 bg-slate-950">
                <code>{selectedFile.content}</code>
              </pre>
            </section>
          </div>
        )}

        {/* --------------------------------------------------------- logcat */}
        {activeTab === 'logcat' && (
          <div className="flex-1 overflow-hidden flex flex-col p-6 gap-4 max-w-6xl mx-auto w-full">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                adb logcat simulator
              </h2>
              <div className="flex gap-2">
                <button
                  onClick={simulatePush}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[11px] font-bold text-white flex items-center gap-1.5 cursor-pointer"
                >
                  <Bell className="w-3.5 h-3.5" /> simulate push
                </button>
                <button
                  onClick={() => setLogs([])}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-[11px] font-bold text-slate-200 cursor-pointer"
                >
                  clear
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto bg-slate-950 border border-slate-800 rounded-2xl p-4 font-mono text-[11px] flex flex-col gap-1">
              {logs.length === 0 && <span className="text-slate-600">-- logcat buffer empty --</span>}
              {logs.map(log => (
                <div key={log.id} className="flex gap-2 items-start">
                  <span className="text-slate-600">{log.timestamp}</span>
                  <span
                    className={`font-bold ${
                      log.level === 'E'
                        ? 'text-red-400'
                        : log.level === 'W'
                        ? 'text-amber-400'
                        : log.level === 'D'
                        ? 'text-slate-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {log.level}
                  </span>
                  <span className="text-indigo-300 w-32 shrink-0 truncate">{log.tag}</span>
                  <span className="text-slate-300 flex-1">{log.message}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              Real device output: <span className="font-mono">adb logcat -s MainActivity WebAppBridge
              LocalWebServer TapsellManager NajvaManager</span>
            </p>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-800 px-6 py-3 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
        <span>
          Gradle 8.5 &bull; AGP 8.3.2 &bull; Kotlin 2.1.10 &bull; Poolakey 2.2.0 &bull; Tapsell Plus
          2.3.3 &bull; Najva 1.8.4
        </span>
        <span className="flex items-center gap-1.5">
          <Play className="w-3 h-3 text-emerald-500" />
          inspect → implement → build → fix → ship
        </span>
      </footer>
    </div>
  );
}
