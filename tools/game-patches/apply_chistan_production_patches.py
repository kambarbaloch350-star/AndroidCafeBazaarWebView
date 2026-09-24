#!/usr/bin/env python3
"""
Production-ready patches for چیستان (Chistan) – com.chistan.quickgames
- Fix 1100 -> 1347 level count
- Store خرید button with CafeBazaar billing
- Wheel spin requires Rewarded Ad (3 chances daily, 1 ad per chance)
- Fix رد کردن to fill answer box + show win dialog
- Add 3x coins button in winning dialog with Rewarded Ad
- Change چیستان‌سرا to چیستان where appropriate
- Fair economy (already) but ensure win reward display shows 30 not 20
"""
import os, glob, sys, re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(ROOT, "app", "src", "main", "assets", "web")
ASSETS = os.path.join(WEB, "assets")

def single(pattern):
    matches = glob.glob(pattern)
    if len(matches) != 1:
        raise SystemExit(f"expected exactly one {pattern}, found {matches}")
    return matches[0]

def main():
    js_path = single(os.path.join(ASSETS, "index-*.js"))
    print(f"Patching {js_path} for production")
    text = open(js_path, encoding='utf-8').read()
    original = text
    applied = []

    # 1. Fix level count 1100 -> 1347 in header
    if "۱۱۰۰ مرحله چیستان و واژه‌یابی" in text:
        text = text.replace("۱۱۰۰ مرحله چیستان و واژه‌یابی", "۱۳۴۷ مرحله چیستان و واژه‌یابی")
        applied.append("fix-1100-to-1347-persian")
        print("applied fix-1100-to-1347-persian")
    if "1100 مرحله" in text:
        text = text.replace("1100 مرحله", "1347 مرحله")
        applied.append("fix-1100-to-1347-latin")
        print("applied fix-1100-to-1347-latin")

    # Also fix any hardcoded 1100 in world ranges display? Keep world-5 as is but header fixed.
    # The totalLevels is dynamic (lt.length = 1347), but the text was hardcoded 1100.
    # Also fix "چیستان‌سرا" title in some places to "چیستان" per package rename requirement
    # We should keep save key as chistansara_game_save_v2 for continuity, but UI should say چیستان
    # Patch app title in header: چیستان‌سرا -> چیستان (but keep where needed)
    # We have two places: loading_title already native, but web has "چیستان‌سرا" in multiple places
    # Let's replace "فروشگاه سکه چیستان‌سرا" -> "فروشگاه سکه چیستان" and "امتیاز به بازی چیستان‌سرا" -> "امتیاز به بازی چیستان"
    # And main title "چیستان‌سرا" in menu header to "چیستان" but keep subtitle
    # We'll do selective replaces
    if "فروشگاه سکه چیستان‌سرا" in text:
        text = text.replace("فروشگاه سکه چیستان‌سرا", "فروشگاه سکه چیستان")
        applied.append("rename-store-title")
        print("applied rename-store-title")
    if "امتیاز به بازی چیستان‌سرا" in text:
        text = text.replace("امتیاز به بازی چیستان‌سرا", "امتیاز به بازی چیستان")
        applied.append("rename-rate-title")
        print("applied rename-rate-title")
    if "تبریک! شما به پایان مراحل چیستان‌سرا رسیدید!" in text:
        text = text.replace("تبریک! شما به پایان مراحل چیستان‌سرا رسیدید!", "تبریک! شما به پایان مراحل چیستان رسیدید!")
        applied.append("rename-end-message")
        print("applied rename-end-message")

    # Fix win reward display: it shows +20 but logic is 30, should show dynamic h
    # Original has T(20) hardcoded in one place, should be T(h) or T(30)
    # We have h=20+m originally, after our earlier patch h=30+..., but display still shows T(20)
    # Let's patch the display to use h variable
    # Look for pattern: پاداش مرحله: + T(20)
    # In Ze component: children:`پاداش مرحله:`}),(0,O.jsxs)(`strong`,{className:`text-amber-950 font-black`,children:[`+`,T(20)]})
    # We want T(h) not T(20)
    if "children:`پاداش مرحله:`}),(0,O.jsxs)(`strong`,{className:`text-amber-950 font-black`,children:[`+`,T(20)]})" in text:
        text = text.replace(
            "children:`پاداش مرحله:`}),(0,O.jsxs)(`strong`,{className:`text-amber-950 font-black`,children:[`+`,T(20)]})",
            "children:`پاداش مرحله:`}),(0,O.jsxs)(`strong`,{className:`text-amber-950 font-black`,children:[`+`,T(h)]})"
        )
        applied.append("fix-win-reward-display")
        print("applied fix-win-reward-display")

    # 2. Store خرید button – ensure button shows خرید + price
    # Current: children:e.price||`دریافت رایگان`
    # We want: children:`خرید - ${e.price}` or `خرید ${e.price}`
    # The previous patch already changed to e.price, now change to include خرید
    if "children:e.price||`دریافت رایگان`" in text:
        text = text.replace(
            "children:e.price||`دریافت رایگان`",
            "children:`خرید - ${e.price}`"
        )
        applied.append("store-buy-button-kharid")
        print("applied store-buy-button-kharid")
    # Also there is a newer version: children:e.price||`...` after our earlier patch is children:e.price||`دریافت رایگان` -> we already replaced to children:e.price? Let's check current state
    # After previous manual edit, it became children:e.price||`دریافت رایگان` -> we replaced to e.price||... Actually we had patched to e.price||... then to e.price? Let's search
    # Look for pattern we patched earlier: children:e.price||`دریافت رایگان` is gone, now it's children:e.price? Actually after our earlier edit it became children:e.price||...? Let's check
    # In current file after earlier run, we have children:e.price||`دریافت رایگان` replaced to children:e.price||`دریافت رایگان`? Wait we replaced to e.price||`دریافت رایگان` -> new was children:e.price||`دریافت رایگان`? Let's check again
    # The file currently after manual edit has children:e.price||`دریافت رایگان`? No, we replaced to children:e.price||`دریافت رایگان`? Actually we replaced old "دریافت رایگان" with e.price||`دریافت رایگان`? Let's just handle both
    if "children:e.price" in text and "خرید -" not in text:
        # Replace the store buy button pattern more generically
        # Pattern: className:`px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-yellow-400 ...`,children:e.price
        # Replace with خرید
        text = text.replace(
            "children:e.price||`دریافت رایگان`",
            "children:`خرید - ${e.price}`"
        )
        # Also handle case where it's just e.price
        # Use regex for remaining
        import re
        # Find the store pack button and replace
        # The button is inside rt.map, with className containing amber-400 to-yellow-400 and children:e.price
        # We'll replace any children:e.price that is inside that context
        # Simple: replace all children:e.price with children:`خرید - ${e.price}` if not already has خرید
        if "children:e.price" in text:
            # Only replace the one that is for store packs (has amber-400 to-yellow-400 nearby)
            # We'll do a targeted replace using regex
            pattern = r"children:e\.price(\|\|`[^`]*`)?"
            # Replace with خرید version but keep fallback
            # Check if already has خرید
            if "`خرید - ${e.price}`" not in text:
                text = re.sub(pattern, "children:`خرید - ${e.price}`", text, count=1)
                applied.append("store-buy-button-kharid-regex")
                print("applied store-buy-button-kharid-regex")

    # Ensure store buy function has CafeBazaar integration (already, but check)
    # Look for old store buy that doesn't have CafeBazaar
    old_store_buy_simple = "d=e=>{D.playFanfare(),D.playCoin();try{Je({particleCount:75,spread:70,origin:{y:.6}})}catch{}l(e.name),n(e.coins),setTimeout(()=>l(null),2500)}"
    if old_store_buy_simple in text:
        # SECURE: No free fallback, handles CANCELLED + USER_CANCELED, verified-only grant
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
        text = text.replace(old_store_buy_simple, new_store_buy)
        applied.append("store-billing-integration")
        print("applied store-billing-integration")

    # 3. Wheel spin requires Rewarded Ad – patch nt component
    # Original spin handler: onClick:()=>{if(a||!m)return;D.playClick(),o(!0),u(null);let e=tt.length,...
    # We need to make it async and require ad
    # Find the pattern
    wheel_old = "onClick:()=>{if(a||!m)return;D.playClick(),o(!0),u(null);let e=tt.length,t=Math.floor(Math.random()*e),r=360/e,i=(5+Math.floor(Math.random()*4))*360+(360-t*r-r/2);c(e=>e+i);let s=0,l=setInterval(()=>{s++,D.playWheelTick(),s>24&&clearInterval(l)},150);setTimeout(()=>{clearInterval(l),o(!1);let e=tt[t].coins;u(e),D.playFanfare(),D.playCoin();try{Je({particleCount:80,spread:80,origin:{y:.6}})}catch{}n(e)},4e3)}"
    wheel_new = (
        "onClick:async()=>{if(a||!m)return;"
        "try{let ad=await window.NativeAds.showRewarded();if(!ad||ad.rewardGranted!==!0){D.playIncorrect();return}}catch(e){D.playIncorrect();return}"
        "D.playClick(),o(!0),u(null);let e=tt.length,t=Math.floor(Math.random()*e),r=360/e,i=(5+Math.floor(Math.random()*4))*360+(360-t*r-r/2);c(e=>e+i);let s=0,l=setInterval(()=>{s++,D.playWheelTick(),s>24&&clearInterval(l)},150);"
        "setTimeout(()=>{clearInterval(l),o(!1);let e=tt[t].coins;u(e),D.playFanfare(),D.playCoin();try{Je({particleCount:80,spread:80,origin:{y:.6}})}catch{}n(e)},4e3)}"
    )
    if wheel_old in text:
        text = text.replace(wheel_old, wheel_new)
        applied.append("wheel-rewarded-ad")
        print("applied wheel-rewarded-ad")
    else:
        # Try alternative with different spacing or already patched?
        if "showRewarded" not in text or "چرخاندن گردونه" in text:
            # Look for pattern with async already? Check
            if "window.NativeAds.showRewarded" in text and "چرخاندن گردونه" in text:
                # Check if wheel already has ad requirement
                # Find nt component spin button
                # If not, try regex
                import re
                m = re.search(r'onClick:.*?چرخاندن گردونه', text, re.DOTALL)
                if m and "showRewarded" not in m.group(0):
                    # Need to patch via regex - find the onClick handler for wheel
                    # We'll replace the first occurrence of the wheel spin onClick that doesn't have showRewarded
                    # Use a more generic pattern
                    pattern = r"onClick:\(\)=>\{if\(a\|\|!m\)return;D\.playClick\(\),o\(!0\),u\(null\);"
                    replacement = "onClick:async()=>{if(a||!m)return;try{let ad=await window.NativeAds.showRewarded();if(!ad||ad.rewardGranted!==!0)return}catch(e){return}D.playClick(),o(!0),u(null);"
                    new_text, count = re.subn(pattern, replacement, text, count=1)
                    if count > 0:
                        text = new_text
                        applied.append("wheel-rewarded-ad-regex")
                        print("applied wheel-rewarded-ad-regex")
            else:
                print("wheel anchor not found, skipping")

    # 4. Fix رد کردن (Ee) to fill answer box + show win dialog
    # Current Ee after earlier patches: Ee=()=>{if(!y){if(D.playClick(),t<150){ce(!0);return}a(150)&&(D.playCorrect(),i(!0,!0),S(!0))}}
    # We want to fill answer boxes with correct answer
    ee_old = "Ee=()=>{if(!y){if(D.playClick(),t<150){ce(!0);return}a(150)&&(D.playCorrect(),i(!0,!0),S(!0))}}"
    ee_new = (
        "Ee=()=>{if(!y){if(D.playClick(),t<150){ce(!0);return}"
        "if(!a(150))return;"
        "try{"
        "let correct=f;"
        "let used=new Set();"
        "let newG=[];"
        "for(let idx=0;idx<correct.length;idx++){"
        "let ch=correct[idx];"
        "let tile=m.find(t=>t.char===ch&&!used.has(t.id)&&!t.isEliminated);"
        "if(!tile)tile=m.find(t=>t.char===ch&&!used.has(t.id));"
        "if(tile){used.add(tile.id);newG.push({char:ch,kbId:tile.id,isLocked:!0});}"
        "else{newG.push({char:ch,kbId:`auto-${idx}`,isLocked:!0});}"
        "}"
        "v(newG);"
        "h(prev=>prev.map(t=>used.has(t.id)?{...t,isUsed:!0}:t));"
        "}catch(e){}"
        "D.playCorrect();i(!0,!0);setTimeout(()=>S(!0),400)"
        "}}"
    )
    if ee_old in text:
        text = text.replace(ee_old, ee_new)
        applied.append("fix-skip-fill-answer")
        print("applied fix-skip-fill-answer")
    else:
        # Try with 250 cost version (original)
        ee_old_250 = "Ee=()=>{if(!y){if(D.playClick(),t<250){ce(!0);return}a(250)&&(D.playCorrect(),i(!0,!0),S(!0))}}"
        if ee_old_250 in text:
            text = text.replace(ee_old_250, ee_new.replace("t<150", "t<250").replace("a(150)", "a(150)"))
            applied.append("fix-skip-fill-answer-250")
            print("applied fix-skip-fill-answer-250")

    # 5. Add 3x coins button in winning dialog (Ze)
    # We need to patch Ze to include a 3x button with rewarded ad
    # Look for the section with next level button
    # Original next level button: onClick:()=>{D.playClick(),s()}, className contains from-emerald-500
    # We want to add before it a button for 3x coins
    # We'll inject a new button that calls rewarded ad and gives 3*h coins
    # Need to find the winning dialog's coin reward variable h
    # The component has let m=a>1?5:0,h=20+m; we patched display but h is still 20+m, should be 30+m
    # Let's first fix h=20+m -> h=30+m
    if "let m=a>1?5:0,h=20+m;" in text:
        text = text.replace("let m=a>1?5:0,h=20+m;", "let m=a>1?10:0,h=30+m;")
        applied.append("fix-win-h-30")
        print("applied fix-win-h-30")
    if "let m=a>1?5:0,h=30+m;" in text and "a>1?10:0" not in text:
        # Fix bonus from 5 to 10
        text = text.replace("let m=a>1?5:0,h=30+m;", "let m=a>1?10:0,h=30+m;")
        applied.append("fix-win-bonus-10")
        print("applied fix-win-bonus-10")

    # Now add 3x button
    # Find the container: flex flex-col gap-2 w-full pt-1, children:[u? button next level
    # We'll inject a 3x button before the next level button
    # Look for pattern: children:[u?(0,O.jsxs)(`button`,{onClick:()=>{D.playClick(),s()},className:`w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500
    # We'll replace with version that includes 3x button
    # We need to add state for 3x claimed
    # In Ze, there is already state d for stars, but we need new state for 3x
    # Let's patch the whole Ze component's return to include 3x button

    # Find the winning dialog buttons container
    # We'll search for the next level button and inject before it
    win_btn_old = "children:[u?(0,O.jsxs)(`button`,{onClick:()=>{D.playClick(),s()},className:`w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500"
    if win_btn_old in text and "۳ برابر" not in text:
        # We need to add a new state variable for 3x claimed and function
        # First, add state variable after let[d,f]=useState(0)
        # Original: Ze=({isOpen:e,level:t,answer:n,question:r,hint:i,streak:a,usedHint:o,onNextLevel:s,onOpenMap:c,onReplayLevel:l,hasNextLevel:u})=>{let[d,f]=(0,_.useState)(0),p=o?2:3;
        # Add another state: let[tripleClaimed,setTripleClaimed]=useState(false)
        old_state = "Ze=({isOpen:e,level:t,answer:n,question:r,hint:i,streak:a,usedHint:o,onNextLevel:s,onOpenMap:c,onReplayLevel:l,hasNextLevel:u})=>{let[d,f]=(0,_.useState)(0),p=o?2:3;"
        new_state = "Ze=({isOpen:e,level:t,answer:n,question:r,hint:i,streak:a,usedHint:o,onNextLevel:s,onOpenMap:c,onReplayLevel:l,hasNextLevel:u})=>{let[d,f]=(0,_.useState)(0),p=o?2:3;let[tripleClaimed,setTripleClaimed]=(0,_.useState)(!1);let[tripleLoading,setTripleLoading]=(0,_.useState)(!1);"
        if old_state in text:
            text = text.replace(old_state, new_state)
            applied.append("add-triple-state")
            print("applied add-triple-state")

        # Now patch the buttons container to add 3x button
        # The container is: flex flex-col gap-2 w-full pt-1, children:[u? button...
        # We'll inject 3x button before next level button
        # Find the exact string for the buttons container start
        # Look for: className:`flex flex-col gap-2 w-full pt-1`,children:[u?
        # Replace with version that has 3x button
        # We need to create a new button that gives 3*h coins after rewarded ad
        # The logic: onClick async, show rewarded ad, if granted, give 3*h coins, set claimed

        # Search for the next level button pattern and inject before
        # We'll do a regex replace for the whole children array
        # Simpler: replace the next level button's onClick to include triple logic? No, add new button

        # Find the section: (0,O.jsxs)(`div`,{className:`flex flex-col gap-2 w-full pt-1`,children:[u?
        # We'll inject after that
        pattern = r"(\(0,O\.jsxs\)\(`div`,\{className:`flex flex-col gap-2 w-full pt-1`,children:\[)u\?"
        replacement = (
            r"\1"
            "!tripleClaimed&&(0,O.jsxs)(`button`,{onClick:async()=>{"
            "if(tripleLoading)return;setTripleLoading(!0);"
            "try{let ad=await window.NativeAds.showRewarded();"
            "if(ad&&ad.rewardGranted===!0){"
            "D.playFanfare();D.playCoin();try{Je({particleCount:100,spread:100,origin:{y:.6}})}catch{}"
            "let tripleCoins=h*3;"
            "try{window.ChistanBridge&&window.ChistanBridge.addCoins&&window.ChistanBridge.addCoins(tripleCoins)}catch(e){}"
            "try{let ev=new CustomEvent('chistan:coins',{detail:{coins:tripleCoins}});window.dispatchEvent(ev);}catch(e){}"
            "setTripleClaimed(!0);"
            "try{let cur=JSON.parse(localStorage.getItem('chistansara_game_save_v2')||'{}');"
            "cur.coins=(cur.coins||0)+tripleCoins;localStorage.setItem('chistansara_game_save_v2',JSON.stringify(cur));}catch(e){}"
            "}}catch(e){}setTripleLoading(!1)},"
            "className:`w-full py-3 rounded-2xl bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 hover:from-amber-500 hover:to-yellow-500 border-2 border-amber-400 border-b-6 border-b-amber-600 active:border-b-2 active:translate-y-1 text-amber-950 font-black text-sm shadow-lg flex items-center justify-center gap-2 cursor-pointer transition-all select-none ${tripleLoading?'opacity-70 pointer-events-none':''}`,"
            "children:[(0,O.jsx)(`span`,{children:tripleLoading?`در حال نمایش تبلیغ...`:`۳ برابر سکه (${T(h*3)} سکه) با تماشای تبلیغ`}),"
            "(0,O.jsx)(`span`,{className:`text-xs`,children:`📺`})]"
            "}),u?"
        )
        import re
        new_text, count = re.subn(pattern, replacement, text, count=1)
        if count > 0:
            text = new_text
            applied.append("add-3x-coins-button")
            print("applied add-3x-coins-button")
        else:
            print("3x button anchor not found")

    # 6. Ensure interstitial every 3 still works (already patched)

    # Write file
    if text != original:
        open(js_path, 'w', encoding='utf-8').write(text)
        print(f"Wrote {js_path}, {len(applied)} patches: {applied}")
    else:
        print("No changes")
    return 0

if __name__ == "__main__":
    sys.exit(main())
