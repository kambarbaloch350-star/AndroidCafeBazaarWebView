import React from 'react';
import { Package, Github, Terminal, Download, Server, Bell, Zap, Shield, CheckCircle2 } from 'lucide-react';

interface ApkBuildGuideProps {
  onDownloadZip: () => void;
  downloadingZip: boolean;
  downloadProgress: number;
  downloadStatus: string;
}

export function ApkBuildGuide({
  onDownloadZip,
  downloadingZip,
  downloadProgress,
  downloadStatus
}: ApkBuildGuideProps) {
  const steps = [
    {
      title: '۱. دریافت پروژه',
      body: 'روی «Export ZIP» بزنید یا مخزن را clone کنید. پوشه app/src/main/assets/web همان WebApp شماست.',
      code: 'unzip ChistanSara-Android-Container.zip && cd AndroidCafeBazaarWebView'
    },
    {
      title: '۲. تنظیم شناسه‌های بومی',
      body:
        'شناسه‌های Tapsell و Pushfa در gradle.properties (پیش‌فرض) یا local.properties قرار می‌گیرند و هرگز به WebApp نمی‌رسند.',
      code: `# local.properties
sdk.dir=/Users/you/Library/Android/sdk
TAPSELL_APP_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
TAPSELL_ZONE_INTERSTITIAL=xxxxxxxxxxxxxxxxxxxx
TAPSELL_ZONE_REWARDED=xxxxxxxxxxxxxxxxxxxx
TAPSELL_ZONE_NATIVE=xxxxxxxxxxxxxxxxxxxx
PUSHFA_API_PUBLIC_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FIREBASE_APP_ID=1:1234567890:android:abcdef
FIREBASE_API_KEY=AIza...
FIREBASE_PROJECT_ID=your-project
FIREBASE_SENDER_ID=1234567890`
    },
    {
      title: '۳. جایگزینی WebApp',
      body:
        'خروجی بیلد خود (Vite/Webpack/Next/Phaser/Unity WebGL) را در app/src/main/assets/web بریزید و در پایان مقداردهی NativeApp.appReady() را صدا بزنید.',
      code: `npm run build
rm -rf app/src/main/assets/web/*
cp -r dist/* app/src/main/assets/web/

# index.html (پایان بوت)
NativeApp.appReady();`
    },
    {
      title: '۴. ساخت APK',
      body:
        'فقط نسخه ریلیز ساخته می‌شود (R8 و shrinkResources فعال، امضا با keystore خودتان). CI گیت‌هاب همان APK ریلیز را می‌سازد و مستقیم به تلگرام می‌فرستد؛ فقط اگر TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID تنظیم نشده باشند artifact ذخیره می‌شود.',
      code: `# local.properties (یا متغیرهای محیطی RELEASE_KEYSTORE_*)
RELEASE_KEYSTORE_PATH=/path/to/release.jks
RELEASE_KEYSTORE_PASSWORD=...
RELEASE_KEY_ALIAS=...
RELEASE_KEY_PASSWORD=...

./gradlew assembleRelease      # R8 + resource shrinking
# خروجی: app/build/outputs/apk/release/app-release.apk
# بدون keystore، بیلد با کلید دیباگ امضا می‌شود تا نصب‌شدنی بماند.`
    },
    {
      title: '۵. اجرا و پایش',
      body: 'نصب روی دستگاه و پیگیری زنجیره بوت، تبلیغات و پوش.',
      code: `adb install -r app/build/outputs/apk/release/app-release.apk
adb logcat -s MainActivity WebAppBridge LocalWebServer TapsellManager PushfaManager CafeBazaarBilling`
    }
  ];

  return (
    <div className="flex-1 overflow-y-auto p-6 lg:p-8 max-w-5xl mx-auto w-full flex flex-col gap-5">
      <section className="bg-gradient-to-br from-emerald-950/60 to-slate-900 border border-emerald-800/40 rounded-2xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <Package className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-bold text-white">
              ساخت APK کانتینر (Tapsell + Pushfa + CafeBazaar)
            </h2>
            <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
              پروژه آماده کامپایل است: Android 14 (API 34)، Gradle 8.5، Kotlin 2.1.10، Poolakey
              2.2.0، Tapsell Plus 2.3.3 و Pushfa 2.0.4. تمام شناسه‌های تبلیغات و پوش در لایه بومی
              تزریق می‌شوند و هیچ‌کدام به WebApp ارسال نمی‌شوند.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <a
                href="https://github.com/kambarbaloch350-star/AndroidCafeBazaarWebView/actions"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-white"
              >
                <Github className="w-3.5 h-3.5" /> مشاهده بیلدهای CI
              </a>
              <button
                onClick={onDownloadZip}
                disabled={downloadingZip}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 text-[11px] font-bold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                {downloadingZip ? `در حال بسته‌بندی… ${downloadProgress}%` : 'دانلود پروژه کامل (ZIP)'}
              </button>
            </div>
            {downloadingZip && downloadStatus && (
              <p className="text-[10px] text-emerald-300 mt-2 font-mono">{downloadStatus}</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-3">
        {[
          {
            icon: <Server className="w-4 h-4 text-emerald-400" />,
            title: 'سرور داخلی',
            body: 'HTTP/1.1 روی 127.0.0.1 با gzip، ETag، MIME کامل و fallback مسیرهای SPA.'
          },
          {
            icon: <Zap className="w-4 h-4 text-amber-400" />,
            title: 'تبلیغات Tapsell',
            body: 'Interstitial، ویدیوی جایزه‌دار و تبلیغ بومی؛ صف‌بندی درخواست‌ها و مهار کامل خطاها.'
          },
          {
            icon: <Bell className="w-4 h-4 text-indigo-400" />,
            title: 'پوش Pushfa',
            body: 'اعلان سیستمی اندروید، مدیریت کانال‌ها و مجوز اندروید ۱۳، مسیر‌یابی عمیق به WebApp.'
          }
        ].map(card => (
          <div key={card.title} className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              {card.icon}
              <span className="text-xs font-bold text-white">{card.title}</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">{card.body}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        {steps.map(step => (
          <div key={step.title} className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-400" />
              {step.title}
            </h3>
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">{step.body}</p>
            <pre className="mt-3 bg-slate-950 border border-slate-800 rounded-xl p-3 text-[10.5px] leading-relaxed font-mono text-emerald-300/90 overflow-x-auto" dir="ltr">
              <code>{step.code}</code>
            </pre>
          </div>
        ))}
      </section>

      <section className="bg-slate-900/70 border border-slate-800 rounded-2xl p-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-emerald-400" />
          چک‌لیست انتشار
        </h3>
        <ul className="text-[11px] text-slate-300 flex flex-col gap-2">
          {[
            'کلید امضای ریلیز (RELEASE_KEYSTORE_*) را تنظیم کنید؛ نسخه بدون آن با کلید دیباگ امضا می‌شود.',
            'شناسه‌های Tapsell (App Key + سه Zone) را در پنل تپسل بسازید.',
            'کلید عمومی Pushfa را در gradle.properties / local.properties بگذارید (پوش کاملاً بومی است).',
            'اعتبارنامه‌های Firebase (FCM) را برای پوش تنظیم کنید (اختیاری: بدون google-services.json پوش غیرفعال می‌شود).',
            'محصولات CafeBazaar را با همان شناسه‌ها بسازید: pack_starter … pack_vault و remove_ads (۲۰٬۰۰۰ تومان، غیر مصرفی).',
            'رازهای تحویل در GitHub: TELEGRAM_BOT_TOKEN و TELEGRAM_CHAT_ID (و در صورت نیاز TELEGRAM_MESSAGE_THREAD_ID).',
            'assets/web را با بیلد نهایی برنامه خود جایگزین و NativeApp.appReady() را صدا بزنید.'
          ].map(item => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
