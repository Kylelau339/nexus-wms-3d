/**
 * Screenshot generator.
 *
 * The images in `docs/screenshots/` are part of the documentation, so they have
 * to be regenerable — a screenshot that was captured by hand silently goes
 * stale, and a README that shows an interface the project no longer has is
 * worse than no screenshot at all.
 *
 *   npm run screenshots
 *
 * Drives a real Chromium through the production build and captures:
 *
 *   en-overview.png    the operations board in English
 *   zh-transport.png   the transport board in Traditional Chinese
 *
 * The simulation runs for a fixed amount of time first, so the numbers in the
 * pictures are representative rather than a blank facility at second zero.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(root, 'docs', 'screenshots');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    '✗ Playwright is not installed.\n' +
      '    Install it with: npx playwright install chromium',
  );
  process.exit(1);
}

const url = process.env.SCREENSHOT_URL ?? 'http://127.0.0.1:4173/';
const VIEWPORT = { width: 1531, height: 1259 };

// Fail with an actionable message instead of an opaque Playwright stack trace.
try {
  const probe = await fetch(url);
  if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  await probe.arrayBuffer();
} catch (err) {
  console.error(
    `✗ Cannot reach ${url} (${err.message}).\n` +
      '    Build and serve the production bundle first:\n' +
      '      npm run build\n' +
      '      npm run preview',
  );
  process.exit(1);
}

let browser;
try {
  browser = await chromium.launch();
} catch (err) {
  console.error(
    `✗ Could not launch Chromium (${err.message}).\n` +
      '    Install the browser binary with: npx playwright install chromium',
  );
  process.exit(1);
}
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const page = await context.newPage();

mkdirSync(outDir, { recursive: true });

/** Set the interface language through the top-bar switcher. */
async function setLanguage(label) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(400);
}

/** Open a board through the navigation rail. */
async function openSection(index) {
  const buttons = page.locator('.rail__btn');
  await buttons.nth(index).click();
  await page.waitForTimeout(600);
}

await page.goto(url, { waitUntil: 'networkidle' });

// Let the simulation build up some traffic so the charts and counters show
// something meaningful rather than an empty facility.
await page.waitForTimeout(6000);

/* --- English · operations overview ------------------------------------- */
await setLanguage('EN');
await openSection(0);
await page.waitForTimeout(1200);
await page.screenshot({ path: resolve(outDir, 'en-overview.png') });
console.log('  ✓ docs/screenshots/en-overview.png');

/* --- Traditional Chinese · transport ------------------------------------ */
await setLanguage('中文');
await openSection(5);
await page.waitForTimeout(1200);
await page.screenshot({ path: resolve(outDir, 'zh-transport.png') });
console.log('  ✓ docs/screenshots/zh-transport.png');

await browser.close();

console.log(`\n✓ captured ${VIEWPORT.width}×${VIEWPORT.height} screenshots into docs/screenshots/`);
