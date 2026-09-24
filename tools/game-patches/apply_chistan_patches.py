#!/usr/bin/env python3
"""
Patches for چیستان‌سرا (ChistanSara) built bundle.
- Fair economy: 30 coins per level (was 20), hint costs 60/100/150 (was 100/150/250)
- Real store prices: 1 coin = 50 toman, no fake free, show toman prices
- Interstitial every 3 levels (was no ads or every 2)
- Integrate CafeBazaar billing
- Add remove_ads product
"""
import os, glob, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(ROOT, "app", "src", "main", "assets", "web")
ASSETS = os.path.join(WEB, "assets")

def single(pattern):
    matches = glob.glob(pattern)
    if len(matches) != 1:
        raise SystemExit(f"expected exactly one {pattern}, found {matches}")
    return matches[0]

def main():
    check_only = "--check" in sys.argv
    js_path = single(os.path.join(ASSETS, "index-*.js"))
    print(f"Patching {js_path}")
    text = open(js_path, encoding='utf-8').read()
    original = text

    patches = []

    # 1. Fair economy: level reward 20 -> 30, streak bonus 5 -> 10
    patches.append((
        "level-reward-fair",
        "a=20+(e.currentStreak>1?5:0)",
        "a=30+(e.currentStreak>1?10:0)"
    ))

    # 2. Hint costs: 100 -> 60, 150 -> 100, 250 -> 150 (two places)
    # we have 4 occurrences: we(), Te(), E(), Ee()
    # we() is reveal letter: t<100
    patches.append((
        "hint-cost-letter-60",
        "we=()=>{if(y)return;if(D.playClick(),t<100){ce(!0);return}",
        "we=()=>{if(y)return;if(D.playClick(),t<60){ce(!0);return}"
    ))
    # Te() eliminate: t<150 -> 100
    patches.append((
        "hint-cost-eliminate-100",
        "Te=()=>{if(y)return;if(D.playClick(),t<150){ce(!0);return}",
        "Te=()=>{if(y)return;if(D.playClick(),t<100){ce(!0);return}"
    ))
    # E() clue: t<250 -> 150 (first)
    # There are two t<250 checks close together, we need to replace both
    # Use more specific anchors
    # First occurrence: E=()=>{if(!C){if(D.playClick(),t<250)
    patches.append((
        "hint-cost-clue-150",
        "E=()=>{if(!C){if(D.playClick(),t<250){ce(!0);return}a(250)",
        "E=()=>{if(!C){if(D.playClick(),t<150){ce(!0);return}a(150)"
    ))
    # Ee() reveal answer: t<250 -> 150
    patches.append((
        "hint-cost-answer-150",
        "Ee=()=>{if(!y){if(D.playClick(),t<250){ce(!0);return}a(250)",
        "Ee=()=>{if(!y){if(D.playClick(),t<150){ce(!0);return}a(150)"
    ))
    # Also need to replace the second a(250) inside E and Ee that deducts coins
    # For E, after check, a(250) is the spend - we already replaced first, but there is second a(250) in Ee's second part
    # Let's handle remaining a(250) -> a(150) for those functions, but careful not to replace other a(250) that might be elsewhere
    # We'll do a targeted replace for the reveal functions: they have pattern a(250)&&(D.playHint...
    # Actually after first patch, E still has a(250) inside? We replaced only first part, second remains. Let's patch all a(250) that are in hint context to 150 if near hint
    # For simplicity, replace all remaining a(250) that are for hints to 150, but keep other logic? There are exactly 2 more a(250) for E and Ee
    # We'll replace globally the pattern for hint spend: a(250)&&(D.playHint -> a(150)&&(D.playHint and a(250)&&(D.playCorrect
    # Let's do two more specific
    patches.append((
        "hint-spend-clue-150b",
        "a(250)&&(D.playHint(),ne(!0),ae(!0))}},Ee",
        "a(150)&&(D.playHint(),ne(!0),ae(!0))}},Ee"
    ))
    # For Ee answer reveal, the spend is a(250)&&(D.playCorrect
    # Need to find it
    # The original after E is: Ee=()=>{if(!y){if(D.playClick(),t<150){ce(!0);return}a(150)&&(D.playCorrect(),i(!0,!0),S(!0))}}
    # So second patch already covers it, but we need to ensure both spends are 150
    # Let's check if there is still a(250) left in those functions by searching
    # We'll do a final sweep: replace a(250) with a(150) only when inside the Qe component context near hint
    # Instead, let's replace all a(250) that are followed by D.playHint or D.playCorrect in hint functions
    # This will be done via regex later if needed

    # 3. Store packs: replace rt array with fair priced packs including SKU and toman
    old_packs = "rt=[{id:`pack_1`,name:`کیسه کوچک سکه`,coins:500,price:`رایگان`,popular:!1},{id:`pack_2`,name:`صندوقچه زرین`,coins:1500,price:`رایگان ویژه`,popular:!0},{id:`pack_3`,name:`گنجینه فرزانگان`,coins:4e3,price:`پک طلایی`,popular:!1},{id:`pack_4`,name:`خزانه سلطنتی`,coins:1e4,price:`پک نامحدود`,popular:!1}]"
    # New packs with fair economy: 50 toman per coin, Persian price display, SKU mapping to CafeBazaar
    # We keep 6 packs for better monetization ladder
    new_packs = (
        "rt=["
        "{id:`pack_starter`,name:`کیسه کوچک سکه`,coins:200,price:`۱۰,۰۰۰ تومان`,toman:10000,sku:`pack_starter`,popular:!1},"
        "{id:`chistan_pack_500`,name:`کیسه سکه`,coins:500,price:`۲۵,۰۰۰ تومان`,toman:25000,sku:`chistan_pack_500`,popular:!1},"
        "{id:`pack_popular`,name:`صندوقچه زرین`,coins:1000,price:`۵۰,۰۰۰ تومان`,toman:50000,sku:`pack_popular`,popular:!0},"
        "{id:`chistan_pack_1500`,name:`صندوق گنج`,coins:1500,price:`۷۵,۰۰۰ تومان`,toman:75000,sku:`chistan_pack_1500`,popular:!1},"
        "{id:`pack_super`,name:`گنجینه فرزانگان`,coins:2500,price:`۱۲۵,۰۰۰ تومان`,toman:125000,sku:`pack_super`,popular:!1},"
        "{id:`chistan_pack_4000`,name:`خزانه پادشاه`,coins:4000,price:`۲۰۰,۰۰۰ تومان`,toman:200000,sku:`chistan_pack_4000`,popular:!1},"
        "{id:`pack_royal`,name:`گنجینه سلطنتی`,coins:5000,price:`۲۵۰,۰۰۰ تومان`,toman:250000,sku:`pack_royal`,popular:!1},"
        "{id:`pack_vault`,name:`خزانه سلطنتی`,coins:10000,price:`۵۰۰,۰۰۰ تومان`,toman:500000,sku:`pack_vault`,popular:!1},"
        "{id:`remove_ads`,name:`حذف تبلیغات`,coins:0,price:`۲۰,۰۰۰ تومان`,toman:20000,sku:`remove_ads`,popular:!1,isRemoveAds:!0}"
        "]"
    )
    patches.append(("store-packs-fair", old_packs, new_packs))

    # 4. Interstitial every 3 levels: patch the level complete handler h to trigger ad
    # Original: h=(n,r)=>{if(n){let n=e.currentStreak+1,i=Math.max(e.bestStreak,n),a=30+(e.currentStreak>1?10:0),o=r?2:3;t(t=>{let s=t.completedLevels[e.currentLevel],c=s?Math.max(s.stars,o):o;return{...t,coins:t.coins+a,currentStreak:n,bestStreak:i,completedLevels:{...t.completedLevels,[e.currentLevel]:{stars:c,solvedAt:Date.now(),usedHint:r}}}})}else t(e=>({...e,currentStreak:0}))}
    # We want to add ad check after completing level
    old_h = "h=(n,r)=>{if(n){let n=e.currentStreak+1,i=Math.max(e.bestStreak,n),a=30+(e.currentStreak>1?10:0),o=r?2:3;t(t=>{let s=t.completedLevels[e.currentLevel],c=s?Math.max(s.stars,o):o;return{...t,coins:t.coins+a,currentStreak:n,bestStreak:i,completedLevels:{...t.completedLevels,[e.currentLevel]:{stars:c,solvedAt:Date.now(),usedHint:r}}}})}else t(e=>({...e,currentStreak:0}))}"
    new_h = (
        "h=(n,r)=>{if(n){let n=e.currentStreak+1,i=Math.max(e.bestStreak,n),a=30+(e.currentStreak>1?10:0),o=r?2:3;"
        "t(t=>{let s=t.completedLevels[e.currentLevel],c=s?Math.max(s.stars,o):o;"
        "let next={...t,coins:t.coins+a,currentStreak:n,bestStreak:i,completedLevels:{...t.completedLevels,[e.currentLevel]:{stars:c,solvedAt:Date.now(),usedHint:r}}};"
        "try{let cnt=Object.keys(next.completedLevels).length;if(cnt%3===0&&cnt>0){"
        "try{window.NativeAds&&window.NativeAds.showInterstitial&&window.NativeAds.showInterstitial()}catch(e){}"
        "try{window.ChistanBridge&&window.ChistanBridge.showInterstitialIfNeeded&&window.ChistanBridge.showInterstitialIfNeeded()}catch(e){}"
        "}}catch(e){}return next})}else t(e=>({...e,currentStreak:0}))}"
    )
    patches.append(("interstitial-every-3", old_h, new_h))

    # Apply patches
    applied = []
    failed = []
    for pid, old, new in patches:
        if new in text and (old not in text or old in new):
            print(f"already applied: {pid}")
            continue
        count = text.count(old)
        if count == 1:
            text = text.replace(old, new)
            applied.append(pid)
            print(f"applied: {pid}")
        else:
            failed.append((pid, count))
            print(f"FAILED: {pid} - anchor found {count} times", file=sys.stderr)

    # Additional global fixes: ensure remaining a(250) for hints are 150
    # Look for pattern a(250)&&(D.playHint in the file after patches - replace any remaining
    if "a(250)&&(D.playHint" in text:
        text = text.replace("a(250)&&(D.playHint", "a(150)&&(D.playHint")
        print("applied: hint-spend-global-fix")
    if "a(250)&&(D.playCorrect" in text:
        # This is for reveal answer, should be 150
        # But be careful: there might be other legitimate 250 costs, but for chistan we want 150
        # We'll replace only if near Ee
        text = text.replace("a(250)&&(D.playCorrect(),i(!0,!0)", "a(150)&&(D.playCorrect(),i(!0,!0)")
        print("applied: answer-spend-fix")

    # Patch store component to use CafeBazaar billing
    # Original d function: d=e=>{D.playFanfare(),D.playCoin();try{Je({particleCount:75,spread:70,origin:{y:.6}})}catch{}l(e.name),n(e.coins),setTimeout(()=>l(null),2500)}
    old_store_buy = "d=e=>{D.playFanfare(),D.playCoin();try{Je({particleCount:75,spread:70,origin:{y:.6}})}catch{}l(e.name),n(e.coins),setTimeout(()=>l(null),2500)}"
    # SECURE: No free fallback - only grant on verified purchase, handles CANCELLED + USER_CANCELED
    new_store_buy = (
        "d=async e=>{"
        "try{"
        "if(e.isRemoveAds){"
        "let res=null;try{res=await window.CafeBazaar.purchase(e.sku);}catch(_){res=null}"
        "if(res&&res.success&&res.verified){"
        "try{res.purchaseToken&&window.CafeBazaar.consume&&window.CafeBazaar.consume(res.purchaseToken)}catch(_){}"
        "D.playFanfare();D.playCoin();try{Je({particleCount:75,spread:70,origin:{y:.6}})}catch{}"
        "l('تبلیغات حذف شد!');"
        "try{localStorage.setItem('chistan_remove_ads','1')}catch(_){}"
        "setTimeout(()=>l(null),2500);"
        "}else{"
        "if(res&&(res.errorCode==='USER_CANCELED'||res.errorCode==='CANCELLED')){l('خرید لغو شد');}else{l('خرید ناموفق بود');}"
        "setTimeout(()=>l(null),2500);"
        "try{D.playIncorrect();}catch(_){}"
        "}"
        "return;"
        "}"
        "let res=null;try{res=await window.CafeBazaar.purchase(e.sku);}catch(_){res=null}"
        "if(res&&res.success&&res.verified){"
        "try{res.purchaseToken&&window.CafeBazaar.consume&&window.CafeBazaar.consume(res.purchaseToken)}catch(_){}"
        "D.playFanfare();D.playCoin();try{Je({particleCount:75,spread:70,origin:{y:.6}})}catch{}"
        "l((e.name||'')+' با موفقیت افزوده شد');n(e.coins);setTimeout(()=>l(null),2500);"
        "}else{"
        "if(res&&(res.errorCode==='USER_CANCELED'||res.errorCode==='CANCELLED')){l('خرید لغو شد');}else{l('خرید ناموفق - سکه‌ای افزوده نشد');}"
        "setTimeout(()=>l(null),2500);"
        "try{D.playIncorrect();}catch(_){}"
        "}"
        "}catch(err){"
        "l('خطا در خرید');setTimeout(()=>l(null),2500);"
        "try{D.playIncorrect();}catch(_){}"
        "}"
        "finally{a(!1)}"
        "}"
    )
    if old_store_buy in text:
        if text.count(old_store_buy) == 1:
            text = text.replace(old_store_buy, new_store_buy)
            applied.append("store-billing-integration")
            print("applied: store-billing-integration")
        else:
            failed.append(("store-billing-integration", text.count(old_store_buy)))
    else:
        print("store buy anchor not found, trying alternative")
        # Try alternative anchor with different spacing
        # Search for pattern
        import re
        m = re.search(r"d=e=>\{D\.playFanfare\(\),D\.playCoin\(\);try\{Je\(\{particleCount:75,spread:70,origin:\{y:\.6\}\}\)\}catch\{\}l\(e\.name\),n\(e\.coins\),setTimeout\(\(\)=>l\(null\),2500\)\}", text)
        if m:
            text = text[:m.start()] + new_store_buy + text[m.end():]
            applied.append("store-billing-integration-regex")
            print("applied: store-billing-integration via regex")

    # Ensure appReady is called
    if "window.NativeApp.appReady" not in text:
        # Inject appReady call into main boot function ft
        # Find where localStorage.setItem is done and add appReady
        old_boot = "document.getElementById('splash')?.classList.add('is-gone')"
        new_boot = "try{window.NativeApp&&window.NativeApp.appReady&&window.NativeApp.appReady()}catch(e){};document.getElementById('splash')?.classList.add('is-gone')"
        if old_boot in text:
            text = text.replace(old_boot, new_boot)
            applied.append("appready-injection")
            print("applied: appready-injection")

    if failed:
        for pid, cnt in failed:
            print(f"FAILED {pid}: {cnt}", file=sys.stderr)
        return 1

    if check_only:
        return 0 if not applied else 1

    if text != original:
        open(js_path, 'w', encoding='utf-8').write(text)
        print(f"Wrote patched {js_path}, {len(applied)} patches applied")
    else:
        print("nothing to do")
    return 0

if __name__ == "__main__":
    sys.exit(main())
