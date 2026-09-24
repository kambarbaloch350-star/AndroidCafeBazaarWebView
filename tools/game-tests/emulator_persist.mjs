#!/usr/bin/env node
/**
 * Re-enacts the reported bug "I reached level 4, force-stopped the app and it
 * started again from level 1" on the emulator, against the installed APK:
 *
 *   1. read the game's saved progress from the running WebView (the
 *      play-through left it at completions=3; when the app is fresh, one
 *      level is played first),
 *   2. `am force-stop` – the hard kill the user performs from Settings – then
 *      a cold relaunch,
 *   3. the game must come back on the SAME origin (stable loopback port) with
 *      the SAME progress,
 *   4. the native state mirror alone must be able to restore the progress:
 *      the web copy is deleted and the page reloaded – the save game must
 *      reappear (this is what carries the progress over when the origin or
 *      the WebView store is lost).
 *
 * Usage: node tools/game-tests/emulator_persist.mjs [--pkg <id>] [--out <dir>] [--port <n>]
 * Exit code 1 when a check fails; every check is printed as PASS/FAIL.
 */
import {
  adbQuiet, argValue, clickUntil, connectPage, createReporter, js, PROGRESS_KEY, screenshot as shot,
  sleep, waitFor as waitForSel
} from './emulator_lib.mjs';

const PKG = argValue('--pkg', 'com.labzband.balochafzar');
const OUT = argValue('--out', 'ci-artifacts');
const PORT = Number(argValue('--port', '9224'));

const reporter = createReporter('persist');
const { note, pass, fail, check } = reporter;
const screenshot = name => shot(OUT, name);
const waitFor = (cdp, selector, timeoutMs, label) => waitForSel(cdp, selector, timeoutMs, label, reporter);

const READ_PROGRESS = js`(function () {
  var out = { port: location.port, origin: location.origin, completions: -1, unlocked: [], current: -1, savedAt: null, mirror: null, info: null };
  try {
    var raw = localStorage.getItem(${JSON.stringify(PROGRESS_KEY)});
    if (raw) { var p = JSON.parse(raw); out.completions = p.completions; out.unlocked = p.unlockedLevels; out.current = p.currentLevelNumber; }
    out.savedAt = localStorage.getItem(${JSON.stringify(PROGRESS_KEY + ':savedAt')});
  } catch (e) { out.error = String(e); }
  try {
    var m = window.NativeApp && window.NativeApp.loadState ? window.NativeApp.loadState(${JSON.stringify(PROGRESS_KEY)}) : null;
    if (m && m.value) { var q = JSON.parse(m.value); out.mirror = { completions: q.completions, savedAt: m.savedAt }; }
  } catch (e) { out.mirrorError = String(e); }
  try { var i = window.NativeApp.getInfo(); out.info = { serverPort: i.serverPort, stableOrigin: i.stableOrigin, stateMirror: i.stateMirror }; } catch (e) {}
  return out;
})()`;

async function readProgress(cdp) {
  return cdp.evaluate(READ_PROGRESS);
}

async function relaunch() {
  adbQuiet('shell', 'am', 'force-stop', PKG);
  await sleep(2500);
  const alive = adbQuiet('shell', 'pidof', '-s', PKG).trim();
  check(alive === '', 'force-stop killed the process', `pid ${alive}`);
  adbQuiet('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
  const cdp = await connectPage(PKG, PORT, note);
  const booted = await waitFor(cdp, '#btn-game-play-giant', 60000, 'the main menu after the relaunch');
  return { cdp, booted };
}

async function main() {
  let cdp = await connectPage(PKG, PORT, note);
  await waitFor(cdp, '#btn-game-play-giant, #btn-wheel-hint, #level-complete-overlay', 60000, 'the game');

  // 1. a save game with real progress
  let before = await readProgress(cdp);
  note(`before: ${JSON.stringify(before)}`);
  if (before.completions < 1) {
    note('no progress yet – playing one level first');
    if (await cdp.evaluate('!!document.querySelector("#btn-game-play-giant")')) {
      await cdp.evaluate('document.querySelector("#btn-game-play-giant").click(); true');
    }
    if (await waitFor(cdp, '#btn-wheel-hint', 15000, 'the level board')) {
      const r = await clickUntil(cdp, '#btn-wheel-hint', '#level-complete-overlay');
      check(r.reached, `level completed with hints (${r.clicks} taps)`, JSON.stringify(r));
    }
    await sleep(800);
    before = await readProgress(cdp);
    note(`before (after playing): ${JSON.stringify(before)}`);
  }
  check(before.completions >= 1, `progress exists before the force stop (completions=${before.completions})`);
  check(before.info && before.info.stableOrigin === true, `the WebApp runs on a stable origin (port ${before.port})`, JSON.stringify(before.info));
  check(before.savedAt !== null, 'the save game carries a savedAt stamp (mirrored natively)');
  check(before.mirror && before.mirror.completions === before.completions,
    `the native mirror holds the same progress (${JSON.stringify(before.mirror)})`);
  screenshot('30-persist-before-force-stop');
  cdp.close();

  // 2./3. force stop -> cold start -> same origin, same progress
  const first = await relaunch();
  cdp = first.cdp;
  const after = await readProgress(cdp);
  note(`after force stop: ${JSON.stringify(after)}`);
  screenshot('31-persist-after-force-stop');
  check(first.booted, 'the game boots after the force stop');
  check(after.port === before.port, `the origin port is unchanged (${before.port} -> ${after.port})`);
  check(after.completions === before.completions,
    `progress survived the force stop (completions ${before.completions} -> ${after.completions})`, JSON.stringify(after));
  check(Array.isArray(after.unlocked) && after.unlocked.includes(before.completions + 1),
    `the next level is still unlocked (${JSON.stringify(after.unlocked)})`);

  // 4. the mirror alone restores the progress (simulates a lost/changed origin)
  await cdp.evaluate(js`(function () {
    localStorage.removeItem(${JSON.stringify(PROGRESS_KEY)});
    localStorage.removeItem(${JSON.stringify(PROGRESS_KEY + ':savedAt')});
    setTimeout(function () { location.reload(); }, 50);
    return true;
  })()`);
  await sleep(1500);
  const restoredMenu = await waitFor(cdp, '#btn-game-play-giant', 60000, 'the main menu after wiping the web copy');
  const restored = await readProgress(cdp);
  note(`after wiping localStorage + reload: ${JSON.stringify(restored)}`);
  screenshot('32-persist-restored-from-mirror');
  check(restoredMenu, 'the game boots after its web copy was wiped');
  check(restored.completions === before.completions,
    `the native mirror restored the progress (completions=${restored.completions})`, JSON.stringify(restored));
  check(restored.savedAt !== null, 'the restored save game was written back to localStorage with its stamp');

  check(cdp.exceptions.length === 0, 'no uncaught JavaScript exception', cdp.exceptions.join(' | '));
  cdp.close();
}

let exitCode = 0;
try {
  await main();
} catch (e) {
  fail('scenario aborted', e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : String(e));
  screenshot('39-persist-aborted');
} finally {
  adbQuiet('forward', '--remove', `tcp:${PORT}`);
  exitCode = reporter.summary() ? 1 : 0;
}
process.exit(exitCode);
