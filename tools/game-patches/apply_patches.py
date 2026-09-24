#!/usr/bin/env python3
"""
Container-side patches for the packaged game bundle (Vite/React build in
app/src/main/assets/web/).

The game ships as a *built* bundle – its React source is not in this
repository – so product changes requested for the packaged game are applied
here, as exact, anchored string edits of the minified `App-*.js` chunk:

  1. Store (دکان): no discount wording (pack names / badges).
  2. Store: a `remove_ads` product row (۲۰,۰۰۰ تومان) in the coin-pack design,
     with an "owned" state, wired to CafeBazaar like the coin packs
     (verified purchase -> `adsRemoved` in the saved progress; restored on
     `getPurchases()`; the container's `isRemoveAdsOwned()` is honoured too).
  3. Level-complete overlay ("passing page"): a "حذف تبلیغات" button in the
     main-menu button design that starts the same purchase.
  4. About dialog (مئے بابت ءَ): a "رابطہ کنگ" button that opens an e-mail to
     balochappps@gmail.com through the container (`NativeApp.openEmail`,
     falling back to a `mailto:` navigation).
  4b. Coin packs at a flat 50 tomans per coin (200/1,000/2,500/5,000/10,000
     coins = 10,000/50,000/125,000/250,000/500,000 tomans), no bonus coins.
  4c. Quiz (لوز): answers shuffled per question (the data lists the correct
     meaning first).
  4d. Wording: استالاں→استال, quiz title/buttons, level-complete subtitle,
     کمک→سوج (hint).
  4e. Progress persistence: every save is mirrored natively
     (`NativeApp.saveState`) and the newer valid copy is restored at boot, so
     a force stop / process death / changed loopback port never resets the
     player to level 1.
  5. Logo: the main-menu tile and the About header show `/logo.png` when that
     file exists in the web root (see tools/branding/apply_logo.py).

Every patch is applied only when its anchor occurs exactly once and is
skipped when it has already been applied, so the script is idempotent and
fails loudly when a new game build changes the code it targets.

Because `App-*.js` / `index-*.js` are content-hashed and served with
`Cache-Control: immutable`, patched chunks are renamed to a fresh hash and the
references (`index-*.js` <-> `App-*.js`, `index.html`) are rewritten, so a
WebView that cached the previous build picks the change up on the next start.

Usage: python3 tools/game-patches/apply_patches.py [--check]
  --check  exit 1 when a patch is neither applied nor applicable (CI guard).
"""
import base64
import glob
import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(ROOT, "app", "src", "main", "assets", "web")
ASSETS = os.path.join(WEB, "assets")

CONTACT_EMAIL = "balochappps@gmail.com"
REMOVE_ADS_PRICE_DISPLAY = "۲۰,۰۰۰ تومان"
REMOVE_ADS_PRICE_TOMANS = "2e4"

# ---------------------------------------------------------------------------
# Patches: (id, old, new). `old` must occur exactly once.
# ---------------------------------------------------------------------------
PATCHES = []


def patch(pid, old, new):
    PATCHES.append((pid, old, new))


# --- icons (lucide-react, same factory `T` the bundle uses) ---------------
patch(
    "icons",
    'Ge=T("shopping-bag",Ns);',
    'Ge=T("shopping-bag",Ns),'
    'Xz=T("mail",[["path",{d:"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7",key:"132q7q"}],'
    '["rect",{x:"2",y:"4",width:"20",height:"16",rx:"2",key:"izxlao"}]]),'
    'Yz=T("ban",[["path",{d:"M4.929 4.929 19.07 19.071",key:"196cmz"}],'
    '["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]]);',
)

# --- 1. no discounts in the store -----------------------------------------
patch(
    "store-no-discount-name",
    'nameFarsi:"صندوقچه الماس (تخفیف ۵۰٪)"',
    'nameFarsi:"صندوقچه الماس"',
)
patch(
    "store-no-discount-badge",
    'badge:"بیشترین تخفیف",badgeColor:"bg-amber-600 text-white",iconType:"vault"}],He=new Set;',
    'badge:"بزرگ‌ترین بسته",badgeColor:"bg-amber-600 text-white",iconType:"vault"}],He=new Set,'
    # --- 2. remove_ads product + helpers (module scope) ---
    'Rz={id:"remove_ads",nameBalochi:"حذف تبلیغات",nameFarsi:"حذف دائمی تبلیغات",coins:0,bonusCoins:0,'
    "priceTomans:" + REMOVE_ADS_PRICE_TOMANS + ',priceDisplay:"' + REMOVE_ADS_PRICE_DISPLAY + '"},'
    "Az=()=>{try{return ae.get().adsRemoved===!0||window.CafeBazaar.isRemoveAdsOwned()===!0}catch{return!1}},"
    'Wz=()=>{const s="' + CONTACT_EMAIL + '";'
    'try{if(window.NativeApp&&typeof window.NativeApp.openEmail=="function"&&window.NativeApp.openEmail(s)===!0)return!0}catch{}'
    'try{window.location.href="mailto:"+s+"?subject="+encodeURIComponent("لبزبند")}catch{}return!1};',
)
patch(
    "remove-ads-purchase-functions",
    "async function tn(s){return Ye.some(n=>n.id===s)?Xe(await window.CafeBazaar.purchase(s)):!1}",
    "function Ez(s){if(!s||s.productId!==Rz.id||s.success!==!0||s.verified!==!0)return!1;"
    "return ae.update(l=>l.adsRemoved===!0?l:{...l,adsRemoved:!0}),!0}"
    "async function Mz(){return Az()?!0:Ez(await window.CafeBazaar.purchase(Rz.id))}"
    "async function tn(s){return s===Rz.id?Mz():Ye.some(n=>n.id===s)?Xe(await window.CafeBazaar.purchase(s)):!1}",
)
patch(
    "remove-ads-restore-on-query",
    "for(const n of s.purchases)await Xe(n)}",
    "for(const n of s.purchases)Ez(n),await Xe(n)}",
)
patch(
    "remove-ads-purchase-event",
    "n=i=>{Xe(i.detail).catch(o)}",
    "n=i=>{Ez(i.detail),Xe(i.detail).catch(o)}",
)

# --- store modal: the remove_ads row, in the coin-pack design -------------
STORE_ROW = (
    '(()=>{const R=Az();return e.jsxs("div",{id:"coin-package-remove_ads",'
    'className:`group relative p-3.5 rounded-2xl border transition-all duration-200 flex items-center justify-between ${R?"bg-emerald-50 border-2 border-emerald-300":"bg-gradient-to-r from-teal-50/90 to-emerald-50/70 border-2 border-teal-600 shadow-sm"}`,'
    'children:[e.jsx("span",{className:`absolute -top-2.5 right-4 px-2.5 py-0.5 rounded-full text-[9px] font-black shadow-xs ${R?"bg-emerald-600 text-white":"bg-amber-600 text-white"}`,children:R?"فعال":"یک بار برای همیشه"}),'
    'e.jsxs("div",{className:"flex items-center gap-3",children:['
    'e.jsx("div",{className:"w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border bg-amber-100 border-amber-300 text-amber-700",children:e.jsx(Yz,{className:"w-6 h-6 text-amber-600"})}),'
    'e.jsxs("div",{children:['
    'e.jsx("div",{className:"flex items-center gap-1.5",children:e.jsx("span",{className:"text-lg font-black text-stone-900",children:Rz.nameBalochi})}),'
    'e.jsx("div",{className:"flex items-center gap-1 text-[11px] text-stone-500",children:e.jsx("span",{children:R?"تبلیغات حذف شده است":"حذف دائمی تبلیغات بین لیول‌ها"})})]})]}),'
    'R?e.jsxs("span",{id:"remove-ads-owned",className:"px-3.5 py-2 rounded-xl bg-emerald-600 text-white font-black text-xs shadow-md border-b-2 border-emerald-800 flex flex-col items-center justify-center min-w-[96px]",'
    'children:[e.jsx(ot,{className:"w-4 h-4"}),e.jsx("span",{className:"text-[9px] text-emerald-200 font-normal",children:"خریداری شده"})]})'
    ':e.jsxs("button",{type:"button",onClick:()=>E(Rz),id:"btn-buy-remove_ads",'
    'className:"px-3.5 py-2 rounded-xl bg-gradient-to-b from-teal-600 to-teal-800 hover:from-teal-700 hover:to-teal-900 text-white font-black text-xs shadow-md border-b-2 border-teal-950 active:translate-y-0.5 cursor-pointer flex flex-col items-center justify-center min-w-[96px] transition-all",'
    'children:[e.jsx("span",{className:"text-white text-xs",children:Rz.priceDisplay}),e.jsx("span",{className:"text-[9px] text-teal-200 font-normal",children:"خرید با بازار"})]})]})})(),'
)
patch(
    "store-remove-ads-row",
    '},x.id)}),e.jsxs("div",{className:"p-3 rounded-2xl bg-amber-50/80 border border-amber-200 flex items-center justify-between",children:[e.jsxs("div",{className:"flex items-center gap-2.5",children:[e.jsx("div",{className:"w-10 h-10 rounded-xl bg-amber-200/80 text-amber-800 flex items-center justify-center shrink-0",children:e.jsx(pt,{className:"w-5 h-5"})})',
    "},x.id)})," + STORE_ROW + 'e.jsxs("div",{className:"p-3 rounded-2xl bg-amber-50/80 border border-amber-200 flex items-center justify-between",children:[e.jsxs("div",{className:"flex items-center gap-2.5",children:[e.jsx("div",{className:"w-10 h-10 rounded-xl bg-amber-200/80 text-amber-800 flex items-center justify-center shrink-0",children:e.jsx(pt,{className:"w-5 h-5"})})',
)
# confirmation sheet: coin line / success copy for remove_ads
SHEET_COINS = (
    'e.jsxs("div",{className:"flex items-center justify-between text-xs",children:[e.jsx("span",{className:"text-stone-600",children:"تعداد سکه دریافتی:"}),'
    'e.jsxs("span",{className:"font-black text-teal-800 flex items-center gap-1",children:[e.jsx(we,{className:"w-3.5 h-3.5 text-amber-500"}),(o.coins+o.bonusCoins).toLocaleString("fa-IR")," سِکہ"]})]})'
)
patch(
    "store-sheet-remove-ads-line",
    SHEET_COINS,
    'o.id===Rz.id?e.jsxs("div",{className:"flex items-center justify-between text-xs",children:[e.jsx("span",{className:"text-stone-600",children:"نوع خرید:"}),'
    'e.jsxs("span",{className:"font-black text-teal-800 flex items-center gap-1",children:[e.jsx(Yz,{className:"w-3.5 h-3.5 text-amber-500"}),"حذف دائمی تبلیغات"]})]}):' + SHEET_COINS,
)
patch(
    "store-success-remove-ads-copy",
    'e.jsxs("p",{className:"text-sm font-bold text-emerald-700 mb-3",children:["+",(o.coins+o.bonusCoins).toLocaleString("fa-IR")," سِکہ به حساب شما افزوده شد"]})',
    'o.id===Rz.id?e.jsx("p",{className:"text-sm font-bold text-emerald-700 mb-3",children:"تبلیغات برای همیشه حذف شد"}):'
    'e.jsxs("p",{className:"text-sm font-bold text-emerald-700 mb-3",children:["+",(o.coins+o.bonusCoins).toLocaleString("fa-IR")," سِکہ به حساب شما افزوده شد"]})',
)
patch(
    "store-success-remove-ads-button",
    'children:"شروع بازی با سکه‌های جدید"})',
    'children:o.id===Rz.id?"ادامه بازی بدون تبلیغات":"شروع بازی با سکه‌های جدید"})',
)

# --- 3. level-complete overlay: "حذف تبلیغات" in the main-menu design -----
patch(
    "level-complete-props",
    'const Vs=({levelNumber:s,isOpen:n,solvedWords:a,onNextLevel:l,onReplay:o,onOpenMenu:i,coinsEarned:m,willShowAdNext:f,fontClass:M="font-sans-arabic"})=>',
    'const Vs=({levelNumber:s,isOpen:n,solvedWords:a,onNextLevel:l,onReplay:o,onOpenMenu:i,coinsEarned:m,willShowAdNext:f,fontClass:M="font-sans-arabic",adsRemoved:Nz=!1,onRemoveAds:Pz})=>',
)
LEVEL_BUTTON = (
    '!Nz&&typeof Pz=="function"&&e.jsxs("button",{type:"button",id:"btn-remove-ads-level",onClick:()=>{g.playClick(),Pz()},'
    'className:"w-full group relative rounded-3xl bg-gradient-to-b from-teal-600 via-teal-700 to-teal-800 text-white p-3.5 border-2 border-teal-400 game-btn-3d flex items-center justify-between cursor-pointer active:translate-y-1.5 shadow-xl shadow-teal-900/20",'
    'children:[e.jsx("div",{className:"absolute top-1 left-4 right-4 h-2 bg-white/20 rounded-full pointer-events-none"}),'
    'e.jsxs("div",{className:"flex items-center gap-3",children:['
    'e.jsx("div",{className:"w-12 h-12 rounded-2xl bg-white/20 border border-white/30 flex items-center justify-center shadow-inner group-hover:scale-105 transition-transform",children:e.jsx(Yz,{className:"w-6 h-6 text-white"})}),'
    'e.jsxs("div",{className:"text-right",children:['
    'e.jsx("span",{className:"text-[10px] font-bold text-teal-200 block uppercase tracking-wider",children:"کافه‌بازار • یک بار برای همیشه"}),'
    'e.jsx("span",{className:`text-xl font-black text-white block ${M}`,children:Rz.nameBalochi})]})]}),'
    'e.jsxs("div",{className:"flex flex-col items-center px-2.5 py-1.5 rounded-2xl bg-white/20 border border-white/30 shrink-0",children:['
    'e.jsx("span",{className:"text-sm font-black text-amber-300",children:Rz.priceDisplay.split(" ")[0]}),'
    'e.jsx("span",{className:"text-[9px] text-teal-100 font-bold",children:"تومان"})]})]}),'
)
NEXT_LEVEL_TAIL = (
    'children:[e.jsx("span",{children:"دیمتریں لیول (Next Level)"}),e.jsx(Qe,{className:"w-4 h-4 transform rotate-180"})]}),'
)
REPLAY_ROW_HEAD = 'e.jsxs("div",{className:"flex items-center gap-2 w-full",children:[e.jsxs("button",{type:"button",id:"btn-replay-level"'
# Below "Next level" (the primary action stays first), above replay / menu.
patch(
    "level-complete-remove-ads-button",
    NEXT_LEVEL_TAIL + REPLAY_ROW_HEAD,
    NEXT_LEVEL_TAIL + LEVEL_BUTTON + REPLAY_ROW_HEAD,
)
patch(
    "level-complete-wiring",
    'e.jsx(Vs,{isOpen:d,levelNumber:l,solvedWords:Ee,onNextLevel:Pe,onReplay:Be,onOpenMenu:()=>{u(!1),n("menu")},coinsEarned:L,willShowAdNext:!1,fontClass:D})',
    'e.jsx(Vs,{isOpen:d,levelNumber:l,solvedWords:Ee,onNextLevel:Pe,onReplay:Be,onOpenMenu:()=>{u(!1),n("menu")},coinsEarned:L,willShowAdNext:!1,fontClass:D,adsRemoved:Az(),onRemoveAds:Oz})',
)
patch(
    "level-complete-purchase-handler",
    "te=()=>{window.CafeBazaar.openRatingPage()||j(Ce)};",
    "te=()=>{window.CafeBazaar.openRatingPage()||j(Ce)},"
    "Oz=async()=>{if(Az())return;try{const w=await window.CafeBazaar.purchase(Rz.id);"
    'Ez(w)?(g.playLevelVictory(),ne("تبلیغات حذف شد!",null)):w&&(w.errorCode==="USER_CANCELED"||w.errorCode==="CANCELLED")||j(Ce)}catch{j(Ce)}};',
)

# --- 4. About: "رابطہ کنگ" -> e-mail ---------------------------------------
patch(
    "about-contact-button",
    'e.jsx("span",{className:"h-1.5 w-1.5 rounded-full bg-teal-300"})]})]})}),e.jsxs("footer"',
    'e.jsx("span",{className:"h-1.5 w-1.5 rounded-full bg-teal-300"})]}),'
    'e.jsxs("button",{type:"button",id:"btn-about-contact",onClick:()=>{g.playClick(),Wz()},'
    'className:"mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-teal-600 to-teal-800 px-5 py-3 text-sm font-black text-white shadow-md border-b-2 border-teal-950 transition hover:from-teal-700 hover:to-teal-900 active:translate-y-0.5 cursor-pointer",'
    'children:[e.jsx(Xz,{className:"w-4 h-4"}),e.jsx("span",{children:"رابطہ کنگ"})]}),'
    'e.jsx("p",{dir:"ltr",className:"mt-2 text-[11px] font-semibold text-teal-700",children:"' + CONTACT_EMAIL + '"})'
    ']})}),e.jsxs("footer"',
)

# --- 1b. coin packs: flat 50 tomans per coin, no bonus coins, no "value" badge
# (anchored on the array *after* the two no-discount edits above)
PACKS_OLD = '{id:"pack_popular",nameBalochi:"عامیں بستہ",nameFarsi:"بسته نقره\u200cای محبوب",coins:500,bonusCoins:50,priceTomans:2e4,priceDisplay:"۲۰,۰۰۰ تومان",badge:"محبوب ترین",badgeColor:"bg-teal-600 text-white",iconType:"sack",popular:!0},{id:"pack_super",nameBalochi:"مزنیں بستہ",nameFarsi:"بسته طلایی ویژه",coins:1200,bonusCoins:200,priceTomans:4e4,priceDisplay:"۴۰,۰۰۰ تومان",badge:"پرفروش",badgeColor:"bg-rose-600 text-white",iconType:"chest"},{id:"pack_royal",nameBalochi:"شاہانہ بستہ",nameFarsi:"بسته زمردین شاهانه",coins:3e3,bonusCoins:800,priceTomans:9e4,priceDisplay:"۹۰,۰۰۰ تومان",badge:"ارزش عالی",badgeColor:"bg-purple-700 text-white",iconType:"royal"},{id:"pack_vault",nameBalochi:"گنجینه\u200cءِ سِکہ",nameFarsi:"صندوقچه الماس",coins:7500,bonusCoins:2500,priceTomans:19e4,priceDisplay:"۱۹۰,۰۰۰ تومان",badge:"بزرگ\u200cترین بسته",badgeColor:"bg-amber-600 text-white",iconType:"vault"}'
PACKS_NEW = '{id:"pack_popular",nameBalochi:"عامیں بستہ",nameFarsi:"بسته نقره\u200cای محبوب",coins:1e3,bonusCoins:0,priceTomans:5e4,priceDisplay:"۵۰,۰۰۰ تومان",badge:"محبوب ترین",badgeColor:"bg-teal-600 text-white",iconType:"sack",popular:!0},{id:"pack_super",nameBalochi:"مزنیں بستہ",nameFarsi:"بسته طلایی ویژه",coins:2500,bonusCoins:0,priceTomans:125e3,priceDisplay:"۱۲۵,۰۰۰ تومان",badge:"پرفروش",badgeColor:"bg-rose-600 text-white",iconType:"chest"},{id:"pack_royal",nameBalochi:"شاہانہ بستہ",nameFarsi:"بسته زمردین شاهانه",coins:5e3,bonusCoins:0,priceTomans:25e4,priceDisplay:"۲۵۰,۰۰۰ تومان",iconType:"royal"},{id:"pack_vault",nameBalochi:"گنجینه\u200cءِ سِکہ",nameFarsi:"صندوقچه الماس",coins:1e4,bonusCoins:0,priceTomans:5e5,priceDisplay:"۵۰۰,۰۰۰ تومان",badge:"بزرگ\u200cترین بسته",badgeColor:"bg-amber-600 text-white",iconType:"vault"}'
patch("store-pack-prices", PACKS_OLD, PACKS_NEW)

# --- 6. quiz (لوز): shuffle the answers – the data lists the correct meaning
# first, so an unshuffled quiz could be passed by always tapping option 1.
# `Jz(q)` returns a copy with shuffled options (Fisher–Yates); the component
# memoises it per question index (hook added before the early return, so the
# hook order is stable across the closed/open renders).
patch(
    "quiz-shuffle-helper",
    ',Ae=Us,Ve=[{id:"sp_1"',
    ',Ae=Us,Jz=s=>{const n=[...s.options];for(let a=n.length-1;a>0;a--){const l=Math.floor(Math.random()*(a+1));[n[a],n[l]]=[n[l],n[a]]}return{...s,options:n}},Ve=[{id:"sp_1"',
)
patch(
    "quiz-shuffle-per-question",
    "[E,_]=h.useState(!1);if(!s)return null;const A=Ae[l],x=p=>{f||(m(p),M(!0),p===A.correctMeaning?",
    "[E,_]=h.useState(!1),Kz=h.useMemo(()=>Jz(Ae[l]),[l]);if(!s)return null;const A=Kz,x=p=>{f||(m(p),M(!0),p===A.correctMeaning?",
)

# --- 7. wording (Balochi copy supplied by the product owner) ---------------
for pid, old, new in (
        ("text-menu-stars", 'children:"استالاں"', 'children:"استال"'),
        ("text-quiz-title", 'children:"معنی فارسی لوز را انتخاب بکن ات"', 'children:"بلوچی لبز ءِ فارسی معنا ءَ گچین"'),
        ("text-quiz-retry", 'children:"دوبارہ جہد کن ات"', 'children:"پدا لئیب کن"'),
        ("text-quiz-close", 'children:"بند کن ات"', 'children:"بند کنی"'),
        ("text-level-complete-subtitle", 'children:"درائیں لوز سہی گچین کرت ات"', 'children:"درائیں لبز درگپت انت۔"'),
        ("text-hint-title", "title:`کمک گرگ (${i} سِکہ)`", "title:`سوج گرگ (${i} سِکہ)`"),
        ("text-hint-label", 'children:"کمک"}', 'children:"سوج"}'),
        ("text-wheel-free-hint", 'labelBalochi:"کمک مفت"', 'labelBalochi:"سوج مفت"'),
        ("text-store-subtitle", 'children:"سِکہ بہ گر ات و کمک کارمرز کن ات"', 'children:"سِکہ بہ گر ات و سوج کارمرز کن ات"'),
        ("text-hint-used-toast", 'ne("کمک کارمرز بوت!",null)', 'ne("سوج کارمرز بوت!",null)'),
        ("text-hint-won-toast", 'ne("کمک مل ات!",Re)', 'ne("سوج مل ات!",Re)')):
    patch(pid, old, new)

# --- 8. progress persistence: native mirror + recovery ----------------------
# The game keeps everything in one localStorage key (`Oe`). localStorage is
# keyed by origin and committed to disk lazily by Chromium, so a changed
# loopback port or a force stop used to reset the player to level 1. Every
# save is now mirrored through `NativeApp.saveState` (SharedPreferences, see
# WebAppStateStore.kt) with a shared `savedAt` stamp; at boot the newer valid
# copy wins, an unreadable web copy is replaced by the mirror instead of
# crashing the boot, and a fresh start is only taken when neither exists.
OS_OLD = (
    'function Os(s){const n=s.getItem(Oe);let a;n?(a=JSON.parse(n),De(a)):(a=Ps(JSON.parse(s.getItem("labzband_word_connect_v3")||"{}")),De(a),s.setItem(Oe,JSON.stringify(a)));'
    'const l=new Set;return{get:()=>a,subscribe:o=>(l.add(o),()=>{l.delete(o)}),update:o=>{const i=o(a);return De(i),s.setItem(Oe,JSON.stringify(i)),a=i,l.forEach(m=>m()),i}}}'
)
OS_NEW = (
    # helpers (function declarations – hoisted, so their position is irrelevant)
    'function Iz(){try{const s=window.NativeApp;return s&&typeof s.loadState=="function"&&typeof s.saveState=="function"?s:null}catch{return null}}'
    'function Vz(s){if(!s)return!1;try{return De(JSON.parse(s)),!0}catch{return!1}}'
    'function Hz(s){const n=s.getItem(Oe),t=Number(s.getItem(Oe+":savedAt"))||0,b=Iz();let m=null;if(b)try{m=b.loadState(Oe)}catch{}'
    'const v=m&&typeof m.value=="string"&&m.value||null,u=v?Number(m.savedAt)||0:0,w=Vz(n);'
    'if(v&&(!w||u>t)&&Vz(v)){try{s.setItem(Oe,v),s.setItem(Oe+":savedAt",String(u))}catch{}return v}'
    'if(w)return n;'
    'if(n){try{s.removeItem(Oe)}catch{}try{window.NativeApp&&window.NativeApp.reportError&&window.NativeApp.reportError("saved progress unreadable; starting fresh")}catch{}}'
    'return null}'
    'function Gz(s,v){const t=Date.now();try{s.setItem(Oe+":savedAt",String(t))}catch{}const b=Iz();if(b)try{b.saveState(Oe,v,String(t))}catch{}}'
    # the store itself
    'function Os(s){const n=Hz(s);let a;if(n)a=JSON.parse(n),De(a);else{a=Ps(JSON.parse(s.getItem("labzband_word_connect_v3")||"{}")),De(a);const f=JSON.stringify(a);s.setItem(Oe,f),Gz(s,f)}'
    'const l=new Set;return{get:()=>a,subscribe:o=>(l.add(o),()=>{l.delete(o)}),update:o=>{const i=o(a);De(i);const f=JSON.stringify(i);return s.setItem(Oe,f),Gz(s,f),a=i,l.forEach(m=>m()),i}}}'
)
patch("progress-native-mirror", OS_OLD, OS_NEW)

# --- 5. logo (only when /logo.png exists in the web root) -----------------
LOGO_PATCHES = [
    (
        "about-logo",
        'e.jsx("span",{className:"flex h-16 w-16 items-center justify-center rounded-3xl bg-white/95 text-3xl font-black text-teal-800 shadow-lg ring-4 ring-white/30",children:"لٻ"})',
        'e.jsx("img",{src:"/logo.png",alt:"لبزبند",draggable:!1,className:"h-16 w-16 rounded-3xl shadow-lg ring-4 ring-white/30 bg-white/95",style:{objectFit:"cover"}})',
    ),
    (
        "menu-logo",
        'e.jsxs("div",{className:"w-full h-full rounded-2xl bg-white flex flex-col items-center justify-center border border-teal-200 relative overflow-hidden",children:[e.jsx("div",{className:"absolute inset-0 opacity-10 doch-border-top"}),e.jsx("span",{className:"text-4xl font-black text-teal-900 drop-shadow-sm font-vazir",children:"ل"}),e.jsx("span",{className:"text-[9px] font-black tracking-widest text-teal-700 uppercase",children:"LABZBAND"})]})',
        'e.jsx("img",{src:"/logo.png",alt:"لبزبند",draggable:!1,className:"w-full h-full rounded-2xl bg-white border border-teal-200",style:{objectFit:"cover"}})',
    ),
]


# ---------------------------------------------------------------------------
def vite_hash(data: bytes) -> str:
    """8 chars in Vite's alphabet ([A-Za-z0-9_-]) derived from the content."""
    digest = hashlib.sha256(data).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")[:8]


def single(pattern):
    matches = glob.glob(pattern)
    if len(matches) != 1:
        raise SystemExit(f"expected exactly one {pattern}, found {matches}")
    return matches[0]


def apply(text, patches, check_only):
    applied, skipped, failed = [], [], []
    for pid, old, new in patches:
        # Already applied when the replacement is present and the anchor is
        # gone – or when the replacement *contains* the anchor (a branch
        # prepended to the original code), in which case the anchor legitimately
        # survives inside it. A short replacement that merely occurs elsewhere
        # in the bundle (e.g. a label the game already uses) is not a match.
        if new in text and (old not in text or old in new):
            skipped.append(pid)
            continue
        n = text.count(old)
        if n == 1:
            if not check_only:
                text = text.replace(old, new)
            applied.append(pid)
        else:
            failed.append((pid, n))
    return text, applied, skipped, failed


def rename_chunks(app_old_path, app_text, idx_path):
    """Give the patched App chunk (and the index chunk that names it) fresh
    content hashes and rewrite every reference."""
    app_old = os.path.basename(app_old_path)
    idx_old = os.path.basename(idx_path)
    idx_text = open(idx_path, encoding="utf-8").read()

    app_new = "App-" + vite_hash(app_text.replace(idx_old, "__IDX__").encode("utf-8")) + ".js"
    if app_new == app_old:
        return app_old, idx_old
    # The index chunk's hash covers the App chunk's *new* name (the two
    # reference each other; the App hash above is taken with the index name
    # masked, so there is no cycle) – an immutable-cached index can therefore
    # never point at a stale App chunk.
    idx_new_text = idx_text.replace(app_old, app_new)
    idx_new = "index-" + vite_hash(idx_new_text.encode("utf-8")) + ".js"
    app_new_text = app_text.replace(idx_old, idx_new)
    idx_new_text = idx_new_text.replace(idx_old, idx_new)

    with open(os.path.join(ASSETS, app_new), "w", encoding="utf-8") as fh:
        fh.write(app_new_text)
    with open(os.path.join(ASSETS, idx_new), "w", encoding="utf-8") as fh:
        fh.write(idx_new_text)
    os.remove(app_old_path)
    os.remove(idx_path)

    html_path = os.path.join(WEB, "index.html")
    html = open(html_path, encoding="utf-8").read()
    if idx_old not in html:
        raise SystemExit(f"index.html does not reference {idx_old}")
    with open(html_path, "w", encoding="utf-8") as fh:
        fh.write(html.replace(idx_old, idx_new))

    # No other file may still name the old chunks.
    for path in glob.glob(os.path.join(WEB, "**", "*"), recursive=True):
        if os.path.isfile(path) and path.endswith((".js", ".html", ".css", ".webmanifest", ".json")):
            body = open(path, encoding="utf-8", errors="ignore").read()
            for stale in (app_old, idx_old):
                if stale in body:
                    raise SystemExit(f"{path} still references {stale}")
    return app_new, idx_new


def main():
    check_only = "--check" in sys.argv
    app_path = single(os.path.join(ASSETS, "App-*.js"))
    idx_path = single(os.path.join(ASSETS, "index-*.js"))
    text = open(app_path, encoding="utf-8").read()

    patches = list(PATCHES)
    logo_present = os.path.isfile(os.path.join(WEB, "logo.png"))
    if logo_present:
        patches += LOGO_PATCHES

    new_text, applied, skipped, failed = apply(text, patches, check_only)
    for pid in applied:
        print(f"{'would apply' if check_only else 'applied'}: {pid}")
    for pid in skipped:
        print(f"already applied: {pid}")
    for pid, n in failed:
        print(f"FAILED: {pid} – anchor found {n} times", file=sys.stderr)
    if not logo_present:
        print("note: web/logo.png missing – logo patches not applied (run tools/branding/apply_logo.py first)")
    if failed:
        return 1
    if check_only:
        return 1 if applied else 0
    if new_text == text:
        print("nothing to do")
        return 0

    app_new, idx_new = rename_chunks(app_path, new_text, idx_path)
    print(f"bundle: {os.path.basename(app_path)} -> {app_new}, {os.path.basename(idx_path)} -> {idx_new}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
