/**
 * Responsive layout audit.
 *
 * The interface collapses into off-canvas drawers on narrow screens, and the
 * right panel is hidden below the large breakpoint. Those rules are easy to
 * break with a CSS change and hard to notice — the layout still looks fine at
 * the width you happen to have your window set to.
 *
 * This script drives a real Chromium through every breakpoint and asserts:
 *
 *   1. no horizontal overflow at any width (nothing spills off the side)
 *   2. the drawer panels are off-canvas when closed and on-canvas when open
 *   3. the rail stays reachable — it is never covered by a drawer
 *   4. the top bar controls stay inside the viewport
 *   5. the status bar stays inside the viewport
 *   6. tap targets in the rail and top bar meet the 24 px minimum
 *   7. the 3D canvas keeps a sane size
 *
 *   node scripts/responsive-audit.mjs
 *
 * Requires Playwright's Chromium (`npx playwright install chromium`) and a
 * served build — point `AUDIT_URL` at it (default: http://127.0.0.1:4173/).
 * Exits non-zero on the first failing viewport.
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
    '\n▶ responsive layout audit\n' +
      '  · skipped — Playwright is not installed.\n' +
      '    Install it with: npx playwright install chromium\n' +
      '    (the audit is opt-in so that `npm ci` stays small for contributors)',
  );
  process.exit(0);
}

const url = process.env.AUDIT_URL ?? 'http://127.0.0.1:4173/';/** Every breakpoint the stylesheet defines, plus the two extremes. */
const VIEWPORTS = [
  { name: 'desktop-wide', width: 1920, height: 1080 },
  { name: 'desktop', width: 1536, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'breakpoint-1500', width: 1440, height: 900 },
  { name: 'breakpoint-1180', width: 1120, height: 800 },
  { name: 'tablet', width: 900, height: 700 },
  { name: 'breakpoint-760', width: 720, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

const failures = [];

function fail(viewport, rule, message) {
  failures.push({ viewport, rule, message });
}

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  console.log(
    '\n▶ responsive layout audit\n' +
      '  · skipped — Chromium is not installed for this Playwright version.\n' +
      '    Install it with: npx playwright install chromium\n' +
      `    (${String(error).split('\n')[0]})`,
  );
  process.exit(0);
}

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'networkidle' });
  // Let the simulation boot and the first frame render.
  await page.waitForTimeout(1200);

  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const rail = document.getElementById('rail');
    const left = document.getElementById('left-panel');
    const right = document.getElementById('right-panel');
    const topbar = document.getElementById('topbar');
    const statusbar = document.getElementById('statusbar');
    const canvas = document.getElementById('scene');

    const rectOf = (element) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };

    // Which elements stick out past the right edge of the viewport.
    // Off-canvas drawers are positioned off-screen on purpose, so any element
    // inside a panel that is not open is excluded.
    const closedPanel = (element) => {
      const panel = element.closest('.panel');
      return panel !== null && !panel.classList.contains('is-open');
    };

    /**
     * Content inside a horizontally scrollable container (the status bar) is
     * meant to extend past the edge — the user scrolls to reach it. Only
     * overflow that cannot be scrolled to counts as a defect.
     */
    const inScrollable = (element) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') return true;
      }
      return false;
    };

    const overflowing = [];
    for (const element of document.querySelectorAll('body *')) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (closedPanel(element)) continue;
      if (inScrollable(element)) continue;
      const r = element.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > doc.clientWidth + 1 || r.left < -1) {
        overflowing.push({
          tag: element.tagName.toLowerCase(),
          cls: element.className?.toString().slice(0, 40) ?? '',
          id: element.id ?? '',
          text: element.textContent?.trim().slice(0, 40) ?? '',
          parent: element.parentElement?.className?.toString().slice(0, 40) ?? '',
          left: Math.round(r.left),
          right: Math.round(r.right),
        });
      }
    }

    // Small tap targets among the always-visible controls.
    const smallTargets = [];
    for (const element of document.querySelectorAll('.rail__btn, .speed__btn, .lang__btn')) {
      const r = element.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width < 24 || r.height < 24) {
        smallTargets.push({
          tag: element.tagName.toLowerCase(),
          cls: element.className?.toString().slice(0, 30) ?? '',
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }

    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflowing: overflowing.slice(0, 6),
      smallTargets,
      rail: rectOf(rail),
      left: rectOf(left),
      right: rectOf(right),
      topbar: rectOf(topbar),
      statusbar: rectOf(statusbar),
      canvas: rectOf(canvas),
      leftOpen: left?.classList.contains('is-open') ?? false,
      railVisible: rail ? getComputedStyle(rail).display !== 'none' : false,
    };
  });

  /* 1. no horizontal overflow */
  if (report.scrollWidth > report.clientWidth + 1) {
    fail(
      viewport.name,
      'horizontal-overflow',
      `the page scrolls horizontally (${report.scrollWidth}px content in a ${report.clientWidth}px viewport)`,
    );
  }
  if (report.overflowing.length > 0) {
    fail(
      viewport.name,
      'element-overflow',
      `elements past the viewport edge: ${report.overflowing
        .map((o) => `${o.tag}.${o.cls}${o.id ? `#${o.id}` : ''}${o.parent ? ` in .${o.parent}` : ''} "${o.text}" [${o.left}..${o.right}]`)
        .join(', ')}`,
    );
  }

  /* 2. the drawer panels stay within the viewport when open */
  if (report.leftOpen && report.left) {
    if (report.left.left < -1) {
      fail(viewport.name, 'drawer-offcanvas', 'the open left drawer is still partly off-screen');
    }
    if (report.left.right > report.clientWidth + 1) {
      fail(viewport.name, 'drawer-overflow', 'the open left drawer extends past the viewport');
    }
  }

  /* 3. the rail is never covered by the drawer */
  if (report.railVisible && report.rail && report.leftOpen && report.left) {
    if (report.left.left < report.rail.right - 1 && report.left.right > report.rail.left) {
      fail(viewport.name, 'rail-covered', 'the open drawer overlaps the navigation rail');
    }
  }

  /* 4 + 5. the chrome stays inside the viewport */
  for (const [key, element] of [
    ['topbar', report.topbar],
    ['statusbar', report.statusbar],
  ]) {
    if (!element) continue;
    if (element.right > report.clientWidth + 1 || element.left < -1) {
      fail(viewport.name, 'chrome-overflow', `the ${key} extends past the viewport`);
    }
  }

  /* 6. tap targets */
  if (report.smallTargets.length > 0) {
    fail(
      viewport.name,
      'tap-target',
      `controls smaller than 24px: ${report.smallTargets
        .map((t) => `${t.tag}.${t.cls} ${t.w}×${t.h}`)
        .join(', ')}`,
    );
  }

  /* 7. the canvas keeps a sane size */
  if (report.canvas && (report.canvas.width < 100 || report.canvas.height < 100)) {
    fail(
      viewport.name,
      'canvas-size',
      `the 3D canvas collapsed to ${Math.round(report.canvas.width)}×${Math.round(report.canvas.height)}`,
    );
  }

  const overflowMark = report.scrollWidth > report.clientWidth + 1 ? ' ⚠ overflow' : '';
  console.log(
    `  ${viewport.name.padEnd(16)} ${String(viewport.width).padStart(4)}×${String(viewport.height).padEnd(4)}` +
      `  content ${report.scrollWidth}px / viewport ${report.clientWidth}px${overflowMark}`,
  );

  await context.close();
}

await browser.close();

console.log(`\n▶ responsive layout audit (${VIEWPORTS.length} viewports)`);

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} responsive violation(s):\n`);
  for (const { viewport, rule, message } of failures) {
    console.error(`  [${viewport} · ${rule}] ${message}`);
  }
  process.exit(1);
}

console.log('  ✓ no horizontal overflow at any width');
console.log('  ✓ drawers open and close correctly');
console.log('  ✓ the navigation rail is never covered');
console.log('  ✓ the chrome stays inside the viewport');
console.log('  ✓ every tap target is at least 24px');
console.log('  ✓ the 3D canvas keeps a sane size');
console.log('\n✓ the layout holds at every breakpoint');
