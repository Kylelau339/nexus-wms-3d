/**
 * Runtime resilience audit.
 *
 * A digital twin runs on whatever machine the operator happens to have, and
 * the most common way a WebGL application breaks there is the GPU context
 * disappearing under it: a driver reset, a laptop switching between two GPUs, a
 * virtualised host reclaiming the device. The canvas goes blank and, without
 * deliberate handling, the application keeps pretending everything is fine.
 *
 * This script drives a real Chromium and *actually* loses the GPU context
 * using the `WEBGL_lose_context` extension, then asserts:
 *
 *   1. the loss is reported to the operator, in the active language
 *   2. a notice follows the language switch, not just the initial render
 *   3. the simulation keeps running while the 3D view is down
 *   4. the restoration is reported as well
 *   5. the operator can dismiss a notice
 *   6. the console stays clean — no error spam from the failed frames
 *   7. a reduced-motion preference is honoured by the 3D camera
 *
 * The last check is the same kind of question: the environment says something
 * and the runtime has to respond correctly — immediately instead of easing the
 * warehouse across the screen.
 *
 *   node scripts/resilience-audit.mjs
 *
 * Requires Playwright's Chromium (`npx playwright install chromium`) and a
 * served build — point `AUDIT_URL` at it (default: http://127.0.0.1:4173/).
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
void here;
void resolve;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log(
    '\n▶ runtime resilience audit\n' +
      '  · skipped — Playwright is not installed.\n' +
      '    Install it with: npx playwright install chromium\n' +
      '    (the audit is opt-in so that `npm ci` stays small for contributors)',
  );
  process.exit(0);
}

const url = process.env.AUDIT_URL ?? 'http://127.0.0.1:4173/';

const failures = [];
function fail(rule, message) {
  failures.push({ rule, message });
}

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  console.log(
    '\n▶ runtime resilience audit\n' +
      '  · skipped — Chromium is not installed for this Playwright version.\n' +
      '    Install it with: npx playwright install chromium\n' +
      `    (${String(error).split('\n')[0]})`,
  );
  process.exit(0);
}

const context = await browser.newContext({
  viewport: { width: 1536, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(String(error)));

/** The incident notices currently on screen. */
const readNotices = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.incident')].map((node) => ({
      role: node.getAttribute('role'),
      title: node.querySelector('.incident__title')?.textContent?.trim() ?? '',
    })),
  );

/** The simulated clock, used to prove the simulation is still running. */
const readClock = () =>
  page.evaluate(() => document.getElementById('sim-clock')?.textContent?.trim() ?? '');

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

/* -- 1. lose the GPU context for real ----------------------------------- */

const clockBefore = await readClock();

let lossSupported = true;
try {
  await page.evaluate(() => {
    const canvas = document.getElementById('scene');
    if (!canvas) throw new Error('the scene canvas is missing');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) throw new Error('the scene has no WebGL context');
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) throw new Error('WEBGL_lose_context is not available');
    // Kept on the window so the context can be handed back later.
    window.__nexusLoseExt = ext;
    ext.loseContext();
  });
} catch (error) {
  lossSupported = false;
  fail('context-loss', `could not lose the GPU context: ${String(error).split('\n')[0]}`);
}

await page.waitForTimeout(900);

/* -- 2. the loss reaches the operator ------------------------------------ */

let notices = await readNotices();
const paused = notices.find((notice) => notice.title.includes('GPU'));
if (lossSupported && !paused) {
  fail(
    'loss-notice',
    `losing the GPU context produced no notice (on screen: ${JSON.stringify(notices)})`,
  );
}

/* -- 3. the simulation keeps running while the 3D view is down ------------ */

const clockAfter = await readClock();
if (lossSupported && clockBefore === clockAfter) {
  fail('simulation-stalled', `the simulation clock stopped at ${clockAfter} while the context was lost`);
}

/* -- 4. the notice follows the language switch --------------------------- */

await page.getByRole('button', { name: 'EN', exact: true }).click();
await page.waitForTimeout(400);

notices = await readNotices();
const pausedEn = notices.find((notice) => notice.title.includes('GPU'));
if (lossSupported) {
  if (!pausedEn) {
    fail('i18n-notice', `the notice disappeared after the language switch: ${JSON.stringify(notices)}`);
  } else if (!/paused/i.test(pausedEn.title)) {
    fail('i18n-notice', `the notice did not follow the language switch: "${pausedEn.title}"`);
  }
}

/* -- 5. the restoration is reported -------------------------------------- */

try {
  await page.evaluate(() => {
    window.__nexusLoseExt.restoreContext();
  });
  await page.waitForTimeout(900);

  notices = await readNotices();
  const resumed = notices.find((notice) => /resum|恢復/i.test(notice.title));
  if (!resumed) {
    fail('restore-notice', `restoring the context produced no notice (on screen: ${JSON.stringify(notices)})`);
  }
} catch (error) {
  fail('context-restore', `could not restore the GPU context: ${String(error).split('\n')[0]}`);
}

/* -- 6. the operator can dismiss a notice -------------------------------- */

try {
  const close = page.locator('.incident__close').first();
  if (await close.count()) {
    const before = (await readNotices()).length;
    await close.click();
    await page.waitForTimeout(200);
    const after = (await readNotices()).length;
    if (after >= before) {
      fail('dismiss', 'dismissing a notice did not remove it');
    }
  }
} catch (error) {
  fail('dismiss', `could not dismiss a notice: ${String(error).split('\n')[0]}`);
}

/* -- 7. a reduced-motion preference is honoured ------------------------- */

/** The "storage" camera preset (key 3) — the camera starts on the overview preset. */
const STORAGE = { x: -30, y: 46, z: 58 };

/**
 * Press the storage preset key and read where the camera ended up one frame
 * later. With reduced motion it has to be there already; without it, it has to
 * still be on its way.
 */
async function cameraAfterPresetKey(target) {
  return target.evaluate(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const scene = window.nexus?.scene;
    if (!scene) return null;
    const { x, y, z } = scene.camera.position;
    return { x, y, z };
  });
}

const distanceFromPreset = (point) =>
  Math.hypot(point.x - STORAGE.x, point.y - STORAGE.y, point.z - STORAGE.z);

const reducedPage = await context.newPage();
await reducedPage.emulateMedia({ reducedMotion: 'reduce' });
await reducedPage.goto(url, { waitUntil: 'networkidle' });
await reducedPage.waitForTimeout(2500);
const reduced = await cameraAfterPresetKey(reducedPage);
await reducedPage.close();

if (!reduced) {
  fail('reduced-motion', 'the camera could not be read from the page');
} else if (distanceFromPreset(reduced) > 0.5) {
  fail(
    'reduced-motion',
    `the camera eased to the preset despite the reduced-motion preference (${distanceFromPreset(reduced).toFixed(1)} units away)`,
  );
}

const normalPage = await context.newPage();
await normalPage.goto(url, { waitUntil: 'networkidle' });
await normalPage.waitForTimeout(2500);
const normal = await cameraAfterPresetKey(normalPage);
await normalPage.close();

if (normal && distanceFromPreset(normal) < 1) {
  fail(
    'reduced-motion',
    'the camera jumped to the preset even though no reduced-motion preference was set',
  );
}

/* -- 8. the console stays clean ------------------------------------------ */

if (consoleErrors.length > 0) {
  fail('console', `the browser reported ${consoleErrors.length} error(s): ${consoleErrors[0]}`);
}

const clockFinal = await readClock();
await browser.close();

console.log('\n▶ runtime resilience audit');
console.log(`  · lost the GPU context at ${clockBefore}, resumed at ${clockFinal}`);

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} resilience violation(s):\n`);
  for (const { rule, message } of failures) console.error(`  [${rule}] ${message}`);
  process.exit(1);
}

console.log('  ✓ a lost GPU context is reported to the operator');
console.log('  ✓ the notice follows the language switch');
console.log('  ✓ the simulation keeps running while the 3D view is down');
console.log('  ✓ the restoration is reported');
console.log('  ✓ a notice can be dismissed');
console.log('  ✓ a reduced-motion preference is honoured by the camera');
console.log('  ✓ the console stays clean');
console.log('\n✓ the runtime survives a GPU context loss');
