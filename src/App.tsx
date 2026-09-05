import React, { useState, useEffect } from 'react';
import { 
  Smartphone, 
  Code2, 
  FolderTree, 
  Terminal, 
  CheckCircle2, 
  Copy, 
  Check, 
  Download, 
  Package, 
  Play, 
  ShieldCheck, 
  Coins, 
  Trophy,
  Sparkles,
  Zap,
  Volume2,
  Tv,
  Eye
} from 'lucide-react';
import { PROJECT_FILES } from './data/projectFiles';
import { ProjectFile, BillingLogItem } from './types';
import { downloadAndroidProjectZip } from './utils/zipExport';
import { ApkBuildGuide } from './components/ApkBuildGuide';

export default function App() {
  const [activeTab, setActiveTab] = useState<'preview' | 'apk' | 'code' | 'logcat'>('preview');
  const [selectedFile, setSelectedFile] = useState<ProjectFile>(PROJECT_FILES[4]); // CafeBazaarConfig.kt or MainActivity
  const [copied, setCopied] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState('');

  // Game & Bridge Simulator State
  const [coins, setCoins] = useState<number>(50);
  const [currentLevel, setCurrentLevel] = useState<number>(1);
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [wheelAngle, setWheelAngle] = useState<number>(0);
  const [showInterstitialAd, setShowInterstitialAd] = useState<boolean>(false);
  const [showRewardedAd, setShowRewardedAd] = useState<boolean>(false);
  const [rewardedCountdown, setRewardedCountdown] = useState<number>(3);
  const [isPurchaseSheetOpen, setIsPurchaseSheetOpen] = useState<boolean>(false);
  const [showBanner, setShowBanner] = useState<boolean>(true);

  const [sheetProduct, setSheetProduct] = useState<{ id: string; name: string; price: string; coins: number }>({
    id: 'coin_pack_250',
    name: 'بسته ۲۵۰ سکه',
    price: '۲۰,۰۰۰ تومان (4X)',
    coins: 250
  });

  // Logcat stream
  const [logs, setLogs] = useState<BillingLogItem[]>([
    {
      id: '1',
      timestamp: '10:00:01.100',
      tag: 'QuickGames',
      level: 'I',
      message: 'MainActivity onCreate: Initialized com.emochi.quickgames'
    },
    {
      id: '2',
      timestamp: '10:00:01.180',
      tag: 'AdiveryManager',
      level: 'I',
      message: 'Adivery SDK configured in Production mode. Pre-caching Interstitial & Rewarded placements'
    },
    {
      id: '3',
      timestamp: '10:00:01.320',
      tag: 'CafeBazaarBilling',
      level: 'I',
      message: 'Poolakey connected: 6 coin pack SKUs loaded with 4x market pricing'
    },
    {
      id: '4',
      timestamp: '10:00:01.500',
      tag: 'WebAppBridge',
      level: 'I',
      message: 'Exposed window.CafeBazaar and window.Adivery to HTML5 web game'
    }
  ]);

  const addLog = (tag: BillingLogItem['tag'], level: BillingLogItem['level'], message: string) => {
    const d = new Date();
    const ts = d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
    setLogs(prev => [
      ...prev,
      {
        id: Math.random().toString(36).substring(7),
        timestamp: ts,
        tag,
        level,
        message
      }
    ]);
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

  // Level Progression Logic: Every 2 levels -> Show Adivery Interstitial Ad!
  const handleLevelUp = () => {
    const nextLevel = currentLevel + 1;
    setCurrentLevel(nextLevel);
    setCoins(prev => prev + 30);
    addLog('WebAppConsole', 'I', `Level ${currentLevel} cleared! +30 coins granted.`);

    if (nextLevel % 2 === 0) {
      addLog('AdiveryManager', 'I', `Level ${nextLevel} reached (every 2 levels): Triggering Adivery Interstitial Ad`);
      setShowInterstitialAd(true);
    }
  };

  // Lucky Spinning Wheel Logic: Adivery Rewarded Video Ad -> Spin -> Prize
  const handleSpinClick = () => {
    if (isSpinning) return;
    addLog('AdiveryManager', 'I', 'Requesting Adivery Rewarded Ad for Lucky Wheel spin');
    setShowRewardedAd(true);
    setRewardedCountdown(3);
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showRewardedAd && rewardedCountdown > 0) {
      timer = setTimeout(() => {
        setRewardedCountdown(prev => prev - 1);
      }, 1000);
    } else if (showRewardedAd && rewardedCountdown === 0) {
      // Ad finished, reward granted!
      setShowRewardedAd(false);
      addLog('AdiveryManager', 'I', 'Adivery Rewarded Video completed! Reward granted: 1 Wheel Spin');
      spinTheWheel();
    }
    return () => clearTimeout(timer);
  }, [showRewardedAd, rewardedCountdown]);

  const spinTheWheel = () => {
    setIsSpinning(true);
    const prizeOptions = [50, 100, 250, 500, 1000, 2500, 75, 300];
    const prize = prizeOptions[Math.floor(Math.random() * prizeOptions.length)];
    const extraRotations = 1800 + Math.floor(Math.random() * 360);
    setWheelAngle(prev => prev + extraRotations);

    setTimeout(() => {
      setIsSpinning(false);
      setCoins(prev => prev + prize);
      addLog('WebAppConsole', 'I', `Lucky Wheel stopped! You won +${prize} coins!`);
    }, 3200);
  };

  // 4x Market Price Coin Packs
  const COIN_PACKS = [
    { id: 'coin_pack_250', name: 'بسته ۲۵۰ سکه', price: '۲۰,۰۰۰ تومان', coins: 250 },
    { id: 'coin_pack_750', name: 'بسته ۷۵۰ سکه', price: '۶۰,۰۰۰ تومان', coins: 750 },
    { id: 'coin_pack_2000', name: 'بسته ۲,۰۰۰ سکه (محبوب)', price: '۱۴۰,۰۰۰ تومان', coins: 2000, featured: true },
    { id: 'coin_pack_5000', name: 'بسته ۵,۰۰۰ سکه', price: '۳۰۰,۰۰۰ تومان', coins: 5000 },
    { id: 'coin_pack_10000', name: 'بسته ۱۰,۰۰۰ سکه', price: '۵۰۰,۰۰۰ تومان', coins: 10000 },
    { id: 'coin_pack_25000', name: 'بسته ۲۵,۰۰۰ سکه مگا', price: '۱,۰۰۰,۰۰۰ تومان', coins: 25000, jackpot: true }
  ];

  const startPurchaseFlow = (pack: typeof COIN_PACKS[0]) => {
    setSheetProduct(pack);
    addLog('WebAppConsole', 'I', `CafeBazaar.purchase("${pack.id}") called from game UI`);
    setIsPurchaseSheetOpen(true);
  };

  const confirmPurchase = () => {
    setIsPurchaseSheetOpen(false);
    const token = 'cb_tok_' + Math.random().toString(36).substring(2, 12);
    addLog('PoolakeySDK', 'I', `Purchase SUCCEEDED for ${sheetProduct.id} (token=${token})`);
    // Automatic consumption in background (removing manual token management)
    addLog('CafeBazaarBilling', 'I', `Auto-consuming purchase token for consumable pack: ${sheetProduct.id}`);
    setCoins(prev => prev + sheetProduct.coins);
    addLog('WebAppConsole', 'I', `Credited +${sheetProduct.coins} coins to player wallet. Ready for next purchase!`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-white">
      {/* App Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-4 lg:px-8 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold text-lg">
            🎮
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-white tracking-tight">
                QuickGames
              </h1>
              <span className="px-2 py-0.5 text-[11px] font-mono rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-800/40">
                com.emochi.quickgames
              </span>
            </div>
            <p className="text-xs text-slate-400">
              CafeBazaar In-App Billing (4X Prices) &bull; Adivery Interstitial &amp; Rewarded Ads
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-800/80 p-1 rounded-xl border border-slate-700/60">
            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'preview'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              Game Preview
            </button>
            <button
              onClick={() => setActiveTab('apk')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'apk'
                  ? 'bg-amber-400 text-slate-950 shadow-sm'
                  : 'text-amber-400/90 hover:text-amber-300'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              Build &amp; Get APK
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'code'
                  ? 'bg-indigo-500 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              Source Code
            </button>
            <button
              onClick={() => setActiveTab('logcat')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
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
            {downloadingZip ? 'Packaging...' : 'Export ZIP'}
          </button>
        </div>
      </header>

      {/* Main View Area */}
      <main className="flex-1 flex overflow-hidden">
        {activeTab === 'apk' && (
          <ApkBuildGuide
            onDownloadZip={handleDownloadZip}
            downloadingZip={downloadingZip}
            downloadProgress={downloadProgress}
            downloadStatus={downloadStatus}
          />
        )}

        {/* Device Preview */}
        {activeTab === 'preview' && (
          <div className="flex-1 flex flex-col lg:flex-row p-6 gap-6 overflow-y-auto max-w-7xl mx-auto w-full items-start justify-center">
            {/* Phone Mockup */}
            <div className="w-[390px] h-[780px] bg-slate-900 border-4 border-slate-700 rounded-[44px] shadow-2xl overflow-hidden flex flex-col relative shrink-0">
              {/* Camera Notch */}
              <div className="h-7 bg-slate-900 flex items-center justify-center shrink-0">
                <div className="w-20 h-4 bg-slate-950 rounded-b-xl flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-slate-800 mr-2"></div>
                  <div className="w-8 h-1 rounded-full bg-slate-800"></div>
                </div>
              </div>

              {/* Status Bar */}
              <div className="px-5 py-1 bg-slate-950 text-[10px] text-slate-400 flex justify-between items-center select-none shrink-0 border-b border-slate-900">
                <span>12:00</span>
                <span className="font-mono text-emerald-400">Adivery &bull; CafeBazaar</span>
                <span>100%</span>
              </div>

              {/* WebView Game Canvas */}
              <div className="flex-1 bg-[#090d16] text-slate-100 p-4 overflow-y-auto flex flex-col gap-3.5 relative select-none">
                {/* Game Top Header */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">🎮</span>
                    <div>
                      <div className="text-xs font-bold text-white">QuickGames</div>
                      <div className="text-[10px] text-slate-400 font-mono">com.emochi.quickgames</div>
                    </div>
                  </div>
                  <div className="bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-full flex items-center gap-1.5">
                    <span className="text-xs">🪙</span>
                    <span className="text-sm font-extrabold text-amber-400">{coins.toLocaleString()}</span>
                    <span className="text-[10px] text-slate-400">سکه</span>
                  </div>
                </div>

                {/* 1. Level Progression (Interstitial every 2 levels) */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 flex flex-col gap-2.5">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                      <span>⚔️</span>
                      <span>پیشرفت مراحل بازی</span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-950/80 text-indigo-400 border border-indigo-800/40 font-bold">
                      مرحله {currentLevel}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-gradient-to-r from-emerald-500 to-indigo-500 transition-all duration-300"
                      style={{ width: `${(currentLevel % 2 === 0) ? 100 : 50}%` }}
                    ></div>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    با عبور از هر ۲ مرحله، تبلیغ بین‌راهی ادیوری (Interstitial) فعال می‌شود.
                  </p>
                  <button
                    onClick={handleLevelUp}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 active:scale-98 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Zap className="w-3.5 h-3.5 text-amber-300" />
                    پایان مرحله و دریافت جایزه (+۳۰ سکه)
                  </button>
                </div>

                {/* 2. Lucky Spinning Wheel (Adivery Rewarded Video) */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 flex flex-col items-center gap-3">
                  <div className="w-full flex justify-between items-center">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                      <span>🎡</span>
                      <span>گردونه شانس (ادیوری ویدیویی)</span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-400 border border-emerald-800/40 font-semibold">
                      پاداش‌دار
                    </span>
                  </div>

                  {/* Wheel Graphical Circle */}
                  <div className="relative w-36 h-36 flex items-center justify-center my-1">
                    <div className="absolute -top-1.5 text-red-500 text-lg z-10">▼</div>
                    <div 
                      className="w-32 h-32 rounded-full border-4 border-slate-700 shadow-lg relative overflow-hidden"
                      style={{
                        background: 'conic-gradient(#f59e0b 0deg 45deg, #6366f1 45deg 90deg, #10b981 90deg 135deg, #ec4899 135deg 180deg, #3b82f6 180deg 225deg, #8b5cf6 225deg 270deg, #14b8a6 270deg 315deg, #f97316 315deg 360deg)',
                        transform: `rotate(${wheelAngle}deg)`,
                        transition: isSpinning ? 'transform 3.2s cubic-bezier(0.15, 0.9, 0.25, 1)' : 'none'
                      }}
                    >
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-8 h-8 rounded-full bg-slate-900 border-2 border-amber-400 flex items-center justify-center text-xs">🎯</div>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleSpinClick}
                    disabled={isSpinning}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Tv className="w-3.5 h-3.5" />
                    {isSpinning ? 'گردونه در حال چرخش...' : 'چرخاندن با تماشای تبلیغ ادیوری'}
                  </button>
                </div>

                {/* 3. CafeBazaar Store (All 6 SKUs at 4x Market Prices) */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 flex flex-col gap-2.5">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                      <span>🛒</span>
                      <span>فروشگاه سکه کافه‌بازار (نرخ ۴ برابری)</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-950/80 text-red-400 border border-red-800/40 font-bold">
                      4X Pricing
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {COIN_PACKS.map(pack => (
                      <div 
                        key={pack.id} 
                        className={`bg-slate-950/90 border rounded-xl p-2.5 flex flex-col justify-between gap-1.5 ${
                          pack.jackpot ? 'border-purple-500/40 bg-purple-950/20' : 
                          pack.featured ? 'border-amber-500/40 bg-amber-950/20' : 'border-slate-800'
                        }`}
                      >
                        <div className="text-[11px] font-bold text-white truncate">{pack.name}</div>
                        <div className="text-[9px] font-mono text-slate-400">{pack.id}</div>
                        <div className="text-xs font-extrabold text-amber-400 mt-1">{pack.price}</div>
                        <button
                          onClick={() => startPurchaseFlow(pack)}
                          className="w-full py-1 bg-slate-800 hover:bg-slate-700 active:scale-95 text-white rounded-lg text-[11px] font-bold transition-all mt-1"
                        >
                          خرید
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bottom Banner Ad */}
                {showBanner && (
                  <div className="mt-auto bg-slate-900 border border-slate-800 rounded-xl p-2 flex items-center justify-between text-[11px] text-slate-400">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 bg-slate-800 text-[9px] rounded font-bold">تبلیغ ادیوری</span>
                      <span>بنر تبلیغاتی پایینی (Adivery Banner)</span>
                    </div>
                    <span className="text-emerald-400 font-bold">فعال</span>
                  </div>
                )}

                {/* Simulated Interstitial Ad Overlay */}
                {showInterstitialAd && (
                  <div className="absolute inset-0 bg-black/90 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-6 text-center animate-in fade-in">
                    <div className="w-14 h-14 rounded-2xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 mb-3">
                      <Tv className="w-8 h-8" />
                    </div>
                    <span className="text-xs uppercase font-bold tracking-wider text-indigo-400 mb-1">
                      تبلیغ بین‌راهی ادیوری (Adivery Interstitial)
                    </span>
                    <h3 className="text-base font-bold text-white mb-2">
                      مرحله {currentLevel} تکمیل شد!
                    </h3>
                    <p className="text-xs text-slate-400 mb-6 max-w-xs">
                      این تبلیغ تمام‌صفحه به صورت خودکار بعد از هر ۲ مرحله اجرا می‌شود.
                    </p>
                    <button
                      onClick={() => setShowInterstitialAd(false)}
                      className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold cursor-pointer"
                    >
                      بستن تبلیغ و ادامه بازی
                    </button>
                  </div>
                )}

                {/* Simulated Rewarded Ad Video Overlay */}
                {showRewardedAd && (
                  <div className="absolute inset-0 bg-black/95 backdrop-blur-md z-30 flex flex-col items-center justify-center p-6 text-center animate-in fade-in">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 mb-3">
                      <Play className="w-8 h-8" />
                    </div>
                    <span className="text-xs uppercase font-bold tracking-wider text-emerald-400 mb-1">
                      ویدیوی پاداش‌دار ادیوری (Adivery Rewarded Video)
                    </span>
                    <h3 className="text-base font-bold text-white mb-2">
                      در حال پخش ویدیوی تبلیغاتی...
                    </h3>
                    <div className="w-12 h-12 rounded-full border-2 border-emerald-500 flex items-center justify-center text-lg font-bold text-emerald-400 my-4 animate-pulse">
                      {rewardedCountdown}
                    </div>
                    <p className="text-xs text-slate-400">
                      لطفاً تا پایان شمارش صبر کنید تا شانس گردونه فعال شود.
                    </p>
                  </div>
                )}

                {/* CafeBazaar Payment Sheet */}
                {isPurchaseSheetOpen && (
                  <div className="absolute inset-0 bg-black/75 flex flex-col justify-end p-3 z-30 animate-in fade-in">
                    <div className="bg-slate-900 border border-slate-700 rounded-3xl p-4 shadow-2xl flex flex-col gap-3">
                      <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="p-1 rounded bg-emerald-500 text-slate-950 font-bold text-xs">کافه‌بازار</span>
                          <span className="text-xs font-bold text-white">پرداخت درون‌برنامه‌ای</span>
                        </div>
                        <button onClick={() => setIsPurchaseSheetOpen(false)} className="text-slate-400 text-xs">✕</button>
                      </div>
                      <div className="text-xs text-slate-300">
                        خرید <strong className="text-white">{sheetProduct.name}</strong>
                      </div>
                      <div className="text-lg font-extrabold text-amber-400">{sheetProduct.price}</div>
                      <div className="flex gap-2 mt-2">
                        <button
                          onClick={confirmPurchase}
                          className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-bold cursor-pointer"
                        >
                          تایید پرداخت
                        </button>
                        <button
                          onClick={() => setIsPurchaseSheetOpen(false)}
                          className="py-2 px-4 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold cursor-pointer"
                        >
                          انصراف
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Architecture & Instructions Overview */}
            <div className="flex-1 flex flex-col gap-4 max-w-xl">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
                <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  ویژگی‌های پیاده‌سازی شده در QuickGames
                </h3>
                <ul className="text-xs text-slate-300 space-y-2.5 list-disc list-inside">
                  <li>
                    <strong className="text-emerald-400">نام بسته جدید:</strong> شناسه بسته به <code className="text-emerald-300 bg-slate-950 px-1 py-0.5 rounded">com.emochi.quickgames</code> تغییر یافت.
                  </li>
                  <li>
                    <strong className="text-emerald-400">تبلیغات ادیوری (Adivery):</strong>
                    <ul className="pl-5 mt-1 space-y-1 list-circle text-slate-400">
                      <li>تبلیغ تمام‌صفحه (Interstitial) به صورت خودکار هر ۲ مرحله یک‌بار نمایش داده می‌شود.</li>
                      <li>گردونه شانس با ویدیوی جایزه‌دار (Rewarded Ad) یکپارچه شد.</li>
                      <li>بنر تبلیغاتی استاندارد در پایین صفحه قرار گرفت.</li>
                    </ul>
                  </li>
                  <li>
                    <strong className="text-emerald-400">فروشگاه سکه ۴ برابری (4X Pricing):</strong>
                    تمام ۶ شناسه درخواستی با نرخ ۴ برابر بازار تعریف شدند:
                    <code className="block text-[11px] text-amber-300 bg-slate-950 p-2 rounded-lg mt-1 font-mono">
                      coin_pack_250 (20k), coin_pack_750 (60k), coin_pack_2000 (140k),<br/>
                      coin_pack_5000 (300k), coin_pack_10000 (500k), coin_pack_25000 (1M)
                    </code>
                  </li>
                  <li>
                    <strong className="text-emerald-400">حذف مدیریت دستی توکن و مصرف:</strong>
                    بخش دستی توکن‌ها از رابط کاربری حذف شد و تمام بسته‌های سکه پس از پرداخت موفقیت‌آمیز، به صورت خودکار مصرف (Consume) و سکه‌ها واریز می‌شوند.
                  </li>
                  <li>
                    <strong className="text-emerald-400">حالت Production:</strong>
                    لاگ‌های دیباگ غیرفعال شده و پروژه کاملاً آماده بیلد نهایی و گیت‌هاب اکشنز است.
                  </li>
                </ul>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => setActiveTab('code')}
                  className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Code2 className="w-4 h-4" />
                  مشاهده کدهای کاتلین و تنظیمات گریدل
                </button>
                <button
                  onClick={() => setActiveTab('apk')}
                  className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Package className="w-4 h-4" />
                  راهنمای بیلد APK در گیت‌هاب
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Source Code Inspector Tab */}
        {activeTab === 'code' && (
          <div className="flex-1 flex overflow-hidden">
            {/* File List */}
            <div className="w-80 border-r border-slate-800 bg-slate-900/50 p-3 overflow-y-auto shrink-0 flex flex-col gap-1">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-2 py-1 mb-1">
                Project Files ({PROJECT_FILES.length})
              </span>
              {PROJECT_FILES.map(file => (
                <button
                  key={file.path}
                  onClick={() => setSelectedFile(file)}
                  className={`text-left px-2.5 py-2 rounded-lg text-xs font-mono transition-all flex items-center justify-between ${
                    selectedFile.path === file.path
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <span className="truncate">{file.name}</span>
                  <span className="text-[10px] uppercase font-sans text-slate-500">{file.category}</span>
                </button>
              ))}
            </div>

            {/* Code Content */}
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-950">
              <div className="border-b border-slate-800 px-4 py-2.5 flex justify-between items-center bg-slate-900/70">
                <div>
                  <div className="text-xs font-bold text-white font-mono">{selectedFile.path}</div>
                  <div className="text-[11px] text-slate-400">{selectedFile.description}</div>
                </div>
                <button
                  onClick={handleCopyCode}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="flex-1 p-4 overflow-auto text-xs font-mono text-slate-200 leading-relaxed">
                <code>{selectedFile.content}</code>
              </pre>
            </div>
          </div>
        )}

        {/* Logcat Tab */}
        {activeTab === 'logcat' && (
          <div className="flex-1 flex flex-col p-4 bg-slate-950 overflow-hidden">
            <div className="border border-slate-800 rounded-2xl flex-1 flex flex-col overflow-hidden bg-slate-900/60">
              <div className="border-b border-slate-800 px-4 py-3 flex justify-between items-center bg-slate-900">
                <span className="text-xs font-bold text-white font-mono">Live Bridge Logcat</span>
                <button
                  onClick={() => setLogs([])}
                  className="text-xs text-slate-400 hover:text-white px-2.5 py-1 bg-slate-800 rounded-lg"
                >
                  Clear
                </button>
              </div>
              <div className="flex-1 p-3 overflow-y-auto font-mono text-xs space-y-1.5">
                {logs.map(log => (
                  <div key={log.id} className="flex gap-2">
                    <span className="text-slate-500 shrink-0">{log.timestamp}</span>
                    <span className="text-emerald-400 font-bold shrink-0">[{log.tag}]</span>
                    <span className="text-slate-300">{log.message}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
