#!/usr/bin/env python3
"""
Patches for the packaged چیستان‌سرا (ChistanSara) bundle.

The game ships as a *built* Vite/React bundle (`app/src/main/assets/web/assets/
index-*.js`), its source lives outside this repository. Product changes and
bridge-usage fixes are therefore applied here, as exact anchored string edits,
and covered by the jsdom contract tests (`tools/game-tests/chistan_scenarios.json`).

Fair economy / store / billing (as before):
  * level reward 20 → 30 coins (+10 streak bonus),
  * hint costs 100/150/250/250 → 60/100/150/150,
  * the four fake free packs → nine priced SKUs (1 coin = 50 tomans, toman
    display, `sku` mapped to CafeBazaar, `remove_ads` at 20,000 tomans),
  * store purchases go through `CafeBazaar.purchase(sku)` and credit only
    `success && verified` results; a stray `CafeBazaar.consume()` of the
    permanent, non-consumable `remove_ads` unlock is removed (it erased the
    entitlement), while coin packs keep consuming their token so they can be
    bought again.

Bridge usage fixes (this round):
  * the interstitial cadence lives in `native-bridge.js` alone: the facade fires
    on the save mirror, checks that `remove_ads` is not owned and de-dupes the
    completed-level count. The level-complete handler used to ask for an ad
    itself *and* through `ChistanBridge.showInterstitialIfNeeded()`, i.e. two
    requests (plus a third once the save was mirrored) for a single level,
  * the ×3 coin bonus is credited into the game's own state (`chistan:coins`
    listener) instead of a raw `localStorage` write that the game's save effect
    overwrote on the next state change,
  * the rewarded video in the coin store actually credits its promised 150 coins
    (`onAddCoins`) after `rewardGranted === true`.

Every patch is described by the text it must produce plus the variants it may
replace, so the script is idempotent on the shipped bundle and fails loudly when
a new game build changes the code it targets. `--check` is a CI guard: it exits
non-zero when a patch is neither applied nor applicable, or when one of the
invariants below does not hold.

Because `index-*.js` is content-hashed and served with `Cache-Control: immutable`,
a patched chunk is renamed to a fresh hash and `index.html` is rewritten, so a
WebView that cached the previous build loads the change on the next start.

Usage: python3 tools/game-patches/apply_chistan_patches.py [--check]
"""
import base64
import glob
import hashlib
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(ROOT, "app", "src", "main", "assets", "web")
ASSETS = os.path.join(WEB, "assets")
HTML = os.path.join(WEB, "index.html")

# ---------------------------------------------------------------------------
# Anchors
# ---------------------------------------------------------------------------
STORE_PACKS_OLD = (
    "rt=[{id:`pack_1`,name:`کیسه کوچک سکه`,coins:500,price:`رایگان`,popular:!1},"
    "{id:`pack_2`,name:`صندوقچه زرین`,coins:1500,price:`رایگان ویژه`,popular:!0},"
    "{id:`pack_3`,name:`گنجینه فرزانگان`,coins:4e3,price:`پک طلایی`,popular:!1},"
    "{id:`pack_4`,name:`خزانه سلطنتی`,coins:1e4,price:`پک نامحدود`,popular:!1}]"
)
STORE_PACKS_NEW = (
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

# The store buy handler. The shipped bundle already bills through
# `CafeBazaar.purchase(sku)` and credits only `success && verified` results, but
# its `remove_ads` branch consumes the purchase token: `remove_ads` is a
# permanent (non-consumable) unlock in CafeBazaar, so consuming it erases the
# entitlement and lets the same user be charged for it again. Coin packs keep
# consuming their token – they must be consumable to be bought repeatedly.
STORE_BUY_CONSUMES_REMOVE_ADS = (
    "if(res&&res.success&&res.verified){"
    "try{res.purchaseToken&&window.CafeBazaar.consume&&window.CafeBazaar.consume(res.purchaseToken)}catch(_){}"
    "D.playFanfare();D.playCoin();try{Je({particleCount:75,spread:70,origin:{y:.6}})}catch{}"
    "l('تبلیغات حذف شد!');"
)
STORE_BUY_REMOVE_ADS_UNCONSUMED = (
    "if(res&&res.success&&res.verified){"
    "D.playFanfare();D.playCoin();try{Je({particleCount:75,spread:70,origin:{y:.6}})}catch{}"
    "l('تبلیغات حذف شد!');"
)

# Duplicate interstitial trigger: both the game and the facade helper asked for
# an ad on the same level count.
INTERSTITIAL_DOUBLE = (
    "try{let cnt=Object.keys(next.completedLevels).length;if(isNew&&cnt%3===0&&cnt>0){"
    "try{window.NativeAds&&window.NativeAds.showInterstitial&&window.NativeAds.showInterstitial()}catch(e){}"
    "try{window.ChistanBridge&&window.ChistanBridge.showInterstitialIfNeeded&&window.ChistanBridge.showInterstitialIfNeeded()}catch(e){}"
    "}}catch(e){}"
)
# The level-complete handler asked for an interstitial itself (every 3rd level)
# *and* through `ChistanBridge.showInterstitialIfNeeded()`; the facade already
# owns that cadence from the save mirror, so the in-game trigger is dropped
# entirely instead of leaving two or three requests for one level.
INTERSTITIAL_SINGLE = (
    "try{let cnt=Object.keys(next.completedLevels).length;if(isNew&&cnt%3===0&&cnt>0){"
    "try{window.NativeAds&&window.NativeAds.showInterstitial&&window.NativeAds.showInterstitial()}catch(e){}"
    "}}catch(e){}"
)

# ×3 bonus: the coins were written straight into `localStorage`, which the
# game's own save effect overwrote on the next state change – the bonus was lost
# and the HUD never showed it. The surrounding text is part of the anchor so the
# target cannot be mistaken for a prefix of it.
TRIPLE_TAIL = "window.dispatchEvent(ev);}catch(e){}"
TRIPLE_WRITE = (
    TRIPLE_TAIL +
    "setTripleClaimed(!0);"
    "try{let cur=JSON.parse(localStorage.getItem('chistansara_game_save_v2')||'{}');"
    "cur.coins=(cur.coins||0)+tripleCoins;"
    "localStorage.setItem('chistansara_game_save_v2',JSON.stringify(cur));}catch(e){}"
    "}}catch(e){}"
)
TRIPLE_STATE = TRIPLE_TAIL + "setTripleClaimed(!0);}}catch(e){}"

# The game dispatches `chistan:coins` but nothing listened for it; the listener
# credits the coins through the game's own coin updater (`p`), so the save effect
# persists them and the HUD updates.
APP_EFFECTS = (
    "(0,_.useEffect)(()=>{D.enabled=e.soundEnabled,D.musicEnabled=e.musicEnabled;"
    "try{window.NativeApp&&window.NativeApp.appReady&&window.NativeApp.appReady()}catch(e){}},"
    "[e.soundEnabled,e.musicEnabled])"
)
COIN_LISTENER = APP_EFFECTS + (
    ",(0,_.useEffect)(()=>{"
    "let h=e=>{try{let c=e&&e.detail&&e.detail.coins;c>0&&p(c)}catch(err){}};"
    "try{window.addEventListener('chistan:coins',h)}catch(err){}"
    "return()=>{try{window.removeEventListener('chistan:coins',h)}catch(err){}}"
    "},[])"
)

# Rewarded video in the coin store promised "+۱۵۰ سکه رایگان" but never credited
# them, even after the container reported `rewarded_completed`.
FREE_COINS_DONE = (
    "clearInterval(e),a(!1),D.playFanfare(),D.playCoin();"
    "try{Je({particleCount:60,spread:60,origin:{y:.6}})}catch{}return 100"
)
FREE_COINS_DONE_PAID = (
    "clearInterval(e),a(!1),D.playFanfare(),D.playCoin();"
    "try{Je({particleCount:60,spread:60,origin:{y:.6}})}catch{}"
    "try{n(150)}catch(e){}return 100"
)

# ---------------------------------------------------------------------------
# Patches: (id, target, [source variants the target may replace])
# ---------------------------------------------------------------------------
PATCHES = [
    ("level-reward-fair",
     "a=30+(e.currentStreak>1?10:0)",
     ["a=20+(e.currentStreak>1?5:0)"]),

    ("hint-cost-letter-60",
     "we=()=>{if(y)return;if(D.playClick(),t<60){ce(!0);return}",
     ["we=()=>{if(y)return;if(D.playClick(),t<100){ce(!0);return}"]),

    ("hint-cost-eliminate-100",
     "Te=()=>{if(y)return;if(D.playClick(),t<100){ce(!0);return}",
     ["Te=()=>{if(y)return;if(D.playClick(),t<150){ce(!0);return}"]),

    ("hint-cost-clue-150",
     "E=()=>{if(!C){if(D.playClick(),t<150){ce(!0);return}a(150)",
     ["E=()=>{if(!C){if(D.playClick(),t<250){ce(!0);return}a(250)"]),

    ("hint-spend-clue-150",
     "a(150)&&(D.playHint(),ne(!0),ae(!0))}},Ee",
     ["a(250)&&(D.playHint(),ne(!0),ae(!0))}},Ee"]),

    ("hint-cost-answer-150",
     "Ee=()=>{if(!y){if(D.playClick(),t<150){ce(!0);return}if(!a(150))return;",
     ["Ee=()=>{if(!y){if(D.playClick(),t<250){ce(!0);return}a(250)&&(D.playCorrect(),i(!0,!0),S(!0))}}",
      "Ee=()=>{if(!y){if(D.playClick(),t<150){ce(!0);return}a(150)&&(D.playCorrect(),i(!0,!0),S(!0))}}",
      "Ee=()=>{if(!y){if(D.playClick(),t<250){ce(!0);return}if(!a(250))return;"]),

    ("store-packs-fair", STORE_PACKS_NEW, [STORE_PACKS_OLD]),

    ("store-remove-ads-not-consumed", STORE_BUY_REMOVE_ADS_UNCONSUMED, [STORE_BUY_CONSUMES_REMOVE_ADS]),

    # Bridge usage: no interstitial request from the WebApp at all – the facade
    # decides (500 ms after the save write, `remove_ads` aware, de-duped by
    # completed-level count). A `None` target means "delete the anchor".
    ("interstitial-cadence-in-facade", None, [INTERSTITIAL_DOUBLE, INTERSTITIAL_SINGLE]),

    # … the ×3 bonus credited into the game's own state …
    ("triple-coins-state", TRIPLE_STATE, [TRIPLE_WRITE]),
    ("coin-event-listener", COIN_LISTENER, [APP_EFFECTS]),

    # … and the promised 150 coins for the rewarded video.
    ("free-coins-credit", FREE_COINS_DONE_PAID, [FREE_COINS_DONE]),
]

# ---------------------------------------------------------------------------
# Invariants: (description, needle, must_be_present)
# ---------------------------------------------------------------------------
INVARIANTS = [
    ("level reward is 30 coins (+10 streak)", "a=30+(e.currentStreak>1?10:0)", True),
    ("letter hint costs 60", "t<60){ce(!0);return}", True),
    ("eliminate hint costs 100", "Te=()=>{if(y)return;if(D.playClick(),t<100)", True),
    ("clue hint costs 150", "a(150)&&(D.playHint(),ne(!0),ae(!0))", True),
    ("answer hint costs 150", "if(!a(150))return;", True),
    ("store sells pack_starter", "sku:`pack_starter`", True),
    ("store sells remove_ads at 20,000", "sku:`remove_ads`,popular:!1,isRemoveAds:!0}", True),
    ("no free coin pack anywhere", "دریافت رایگان", False),
    ("purchases go through CafeBazaar", "await window.CafeBazaar.purchase(e.sku)", True),
    ("purchases are only credited when verified", "res&&res.success&&res.verified", True),
    ("remove_ads purchase is never consumed",
     "try{res.purchaseToken&&window.CafeBazaar.consume&&window.CafeBazaar.consume(res.purchaseToken)}"
     "catch(_){}D.playFanfare();D.playCoin();try{Je({particleCount:75,spread:70,origin:{y:.6}})}catch{}"
     "l('تبلیغات حذف شد!')", False),
    ("the WebApp does not request interstitials itself",
     "window.NativeAds.showInterstitial()", False),
    ("the WebApp does not drive the facade cadence by hand",
     "window.ChistanBridge.showInterstitialIfNeeded()", False),
    ("×3 bonus is not written straight into localStorage",
     "cur.coins=(cur.coins||0)+tripleCoins", False),
    ("×3 bonus reaches the game state via chistan:coins",
     "window.addEventListener('chistan:coins',h)", True),
    ("×3 bonus calls the bridge helper", "window.ChistanBridge.addCoins(tripleCoins)", True),
    ("rewarded free coins credit 150", "try{n(150)}catch(e){}", True),
    ("readiness handshake present", "window.NativeApp.appReady()", True),
]

# ---------------------------------------------------------------------------
# Rewriting with fresh content hashes (immutable caching)
# ---------------------------------------------------------------------------
def vite_hash(data: bytes) -> str:
    digest = hashlib.sha256(data).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")[:8]


def rename_chunk(path: str, text: str) -> str:
    """Writes `text` under a fresh content hash and rewrites index.html."""
    old = os.path.basename(path)
    new = "index-" + vite_hash(text.encode("utf-8")) + ".js"
    if new == old:
        return old

    with open(os.path.join(ASSETS, new), "w", encoding="utf-8") as fh:
        fh.write(text)
    os.remove(path)

    html = open(HTML, encoding="utf-8").read()
    if old not in html:
        raise SystemExit(f"index.html does not reference {old}")
    with open(HTML, "w", encoding="utf-8") as fh:
        fh.write(html.replace(old, new))

    for candidate in glob.glob(os.path.join(WEB, "**", "*"), recursive=True):
        if os.path.isfile(candidate) and candidate.endswith((".js", ".html", ".css", ".webmanifest", ".json")):
            if os.path.basename(candidate) == new:
                continue
            if old in open(candidate, encoding="utf-8", errors="ignore").read():
                raise SystemExit(f"{candidate} still references {old}")
    return new


def single(pattern: str) -> str:
    matches = glob.glob(pattern)
    if len(matches) != 1:
        raise SystemExit(f"expected exactly one {pattern}, found {matches}")
    return matches[0]


def apply_patches(text: str, check_only: bool):
    applied, skipped, failed = [], [], []
    for pid, target, sources in PATCHES:
        if target is None:
            # Removal patch: applied once none of the anchors is present any more.
            if not any(src in text for src in sources):
                skipped.append(pid)
                continue
        elif target in text:
            skipped.append(pid)
            continue

        matches = [src for src in sources if text.count(src) == 1]
        if len(matches) == 1:
            if not check_only:
                text = text.replace(matches[0], target or "")
            applied.append((pid, matches[0] != sources[0]))
        elif not matches:
            failed.append((pid, {src[:40] + '…': text.count(src) for src in sources}))
        else:
            failed.append((pid, "ambiguous: several source variants present"))
    return text, applied, skipped, failed


def verify(text: str):
    problems = []
    for description, needle, must_be_present in INVARIANTS:
        present = needle in text
        if present != must_be_present:
            problems.append(
                f"{'missing' if must_be_present else 'still present'}: {description} "
                f"({needle[:60]}{'…' if len(needle) > 60 else ''})"
            )
    return problems


def main() -> int:
    check_only = "--check" in sys.argv
    js_path = single(os.path.join(ASSETS, "index-*.js"))
    original = open(js_path, encoding="utf-8").read()

    # Always simulate every patch: `--check` asserts that the bundle *would be*
    # consistent, it just does not write anything.
    text, applied, skipped, failed = apply_patches(original, check_only=False)
    for pid, migrated in applied:
        print(f"{'would apply' if check_only else 'applied'}: {pid}" + (" (upgraded an older variant)" if migrated else ""))
    for pid in skipped:
        print(f"already applied: {pid}")
    for pid, detail in failed:
        print(f"FAILED: {pid} – {detail}", file=sys.stderr)

    problems = sorted(verify(text))
    for problem in problems:
        print(f"INVARIANT {problem}", file=sys.stderr)

    if failed or problems:
        return 1
    if check_only:
        if applied:
            print(f"{len(applied)} patch(es) pending – run the script without --check", file=sys.stderr)
            return 1
        print(f"bundle is up to date ({len(PATCHES)} patches, {len(INVARIANTS)} invariants)")
        return 0
    if text == original:
        print("nothing to do")
        return 0

    new_name = rename_chunk(js_path, text)
    print(f"wrote {os.path.join('app/src/main/assets/web/assets', new_name)} "
          f"(was {os.path.basename(js_path)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
