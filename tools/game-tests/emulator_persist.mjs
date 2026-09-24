#!/usr/bin/env node
/**
 * Re-enacts the reported bug "I reached level 4, force-stopped the app and it
 * started again from level 1" on the emulator, against the installed APK
 * (چیستان‌سرا):
 *
 *   1. read the game's saved progress from the running WebView (when the app is
 *      fresh, one level is played first so there is something to lose),
 *   2. `am force-stop` – the hard kill the user performs from Settings – then a
 *      cold relaunch,
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
  adbQuiet, argValue, bodyText, clickText, connectPage, createReporter, js, MENU_LABELS, readSave,
  reloadPage, SAVE_KEY, screenshot as shot, sleep, waitForMenu, waitForText
} from './emulator_lib.mjs';

const PKG = argValue('--pkg', 'com.chistan.quickgames');
const OUT = argValue('--out', 'ci-artifacts');
const PORT = Number(argValue('--port', '9224'));

const reporter = createReporter('persist');
const { note, pass, fail, check } = reporter;
const screenshot = name => shot(OUT, name);

async function tapText(cdp, text, timeoutMs = 20000) {
  if (!await waitForText(cdp, text, timeoutMs)) return false;
  return !!(await cdp.evaluate(clickText(text)));
}

/** Plays one level (شروع بازی / مرحله بعدی → رد کردن → win dialog). */
async function playLevel(cdp) {
  for (const label of ['مرحله بعدی', ...MENU_LABELS]) {
    if (await waitForText(cdp, label, 8000)) { await tapText(cdp, label); break; }
  }
  if (!await waitForText(cdp, 'رد کردن', 20000)) return false;
  await tapText(cdp, 'رد کردن');
  return waitForText(cdp, 'چیستان گشوده شد', 20000);
}

async function mainMenu(cdp, timeoutMs = 60000) {
  return !!(await waitForMenu(cdp, timeoutMs));
}

async function relaunch() {
  adbQuiet('shell', 'am', 'force-stop', PKG);
  await sleep(2500);
  const alive = adbQuiet('shell', 'pidof', '-s', PKG).trim();
  check(alive === '', 'force-stop killed the process', `pid ${alive}`);
  adbQuiet('shell', 'am', 'start', '-n', `${PKG}/.MainActivity`);
  const cdp = await connectPage(PKG, PORT, note);
  const booted = await mainMenu(cdp, 60000);
  return { cdp, booted };
}

async function main() {
  let cdp = await connectPage(PKG, PORT, note);
  if (!await mainMenu(cdp, 60000)) {
    fail('the game did not appear', await bodyText(cdp));
    return;
  }

  // 1. a save game with real progress
  let before = await readSave(cdp);
  note(`before: ${JSON.stringify(before)}`);
  if (before.completions < 1) {
    note('no progress yet – playing one level first');
    check(await playLevel(cdp), 'a level was completed so there is progress to lose', await bodyText(cdp));
    await sleep(800);
    before = await readSave(cdp);
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
  const after = await readSave(cdp);
  note(`after force stop: ${JSON.stringify(after)}`);
  screenshot('31-persist-after-force-stop');
  check(first.booted, 'the game boots after the force stop', await bodyText(cdp));
  check(after.port === before.port, `the origin port is unchanged (${before.port} -> ${after.port})`);
  check(after.completions === before.completions,
    `progress survived the force stop (completions ${before.completions} -> ${after.completions})`, JSON.stringify(after));
  if (before.current >= 0) {
    check(after.current === before.current,
      `the player is still on the same level (${before.current} -> ${after.current})`);
  }

  // 4. the mirror alone restores the progress (simulates a lost/changed origin)
  await cdp.evaluate(js`(function () {
    localStorage.removeItem(${JSON.stringify(SAVE_KEY)});
    localStorage.removeItem(${JSON.stringify(SAVE_KEY + ':savedAt')});
    setTimeout(function () { location.reload(); }, 50);
    return true;
  })()`);
  await sleep(2000);
  const restoredMenu = await mainMenu(cdp, 60000);
  const restored = await readSave(cdp);
  note(`after wiping localStorage + reload: ${JSON.stringify(restored)}`);
  screenshot('32-persist-restored-from-mirror');
  check(restoredMenu, 'the game boots after its web copy was wiped', await bodyText(cdp));
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
