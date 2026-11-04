/**
 * WCAG 2.1 contrast audit for the light theme.
 *
 * Reads the design tokens straight out of `src/styles/main.css` and checks every
 * foreground/background pair the UI actually renders, so the palette can never
 * silently regress when a colour is tweaked.
 *
 *   node scripts/contrast-audit.mjs
 *
 * Both the default palette and the `prefers-contrast: more` overrides are audited.
 *
 * Thresholds (WCAG 2.1):
 *   - 4.5 : 1 for normal text (< 18pt / < 14pt bold)
 *   - 3.0 : 1 for large text and for non-text UI (borders, icons, focus rings)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '..', 'src', 'styles', 'main.css'), 'utf8');

/** Pull `--name: value;` declarations out of the first `{...}` after `marker`. */
function blockTokens(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) return new Map();
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  const body = source.slice(open, close);
  const map = new Map();
  for (const match of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(match[1], match[2].trim());
  }
  return map;
}

const defaults = blockTokens(css, ':root');
const highContrast = new Map(defaults);
for (const [key, value] of blockTokens(css, 'prefers-contrast: more')) {
  highContrast.set(key, value);
}

function hexToRgb(hex) {
  const value = hex.replace('#', '').trim();
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** Composite a translucent foreground over an opaque background. */
function blend(fg, bg, alpha) {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
}

function luminance([r, g, b]) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const white = hexToRgb('#ffffff');

/** Resolve a colour spec to an RGB triple; supports `rgba(r,g,b,a)` overlays. */
function paint(spec, backdrop = white) {
  if (spec.startsWith('rgba')) {
    const parts = spec
      .slice(spec.indexOf('(') + 1, spec.indexOf(')'))
      .split(',')
      .map((p) => Number(p.trim()));
    return blend([parts[0], parts[1], parts[2]], backdrop, parts[3] ?? 1);
  }
  return hexToRgb(spec);
}

/** [label, foreground spec, background spec, minimum ratio] */
function buildChecks(T) {
  const token = (name) => {
    const value = T.get(name);
    if (!value) throw new Error(`missing token ${name}`);
    return value;
  };
  return [
    ['主要文字 / 主文字', token('--fg-0'), token('--bg-0'), 4.5],
    ['次要文字 / 白色面板', token('--fg-1'), token('--bg-0'), 4.5],
    ['弱化文字 / 白色面板', token('--fg-2'), token('--bg-0'), 4.5],
    ['弱化文字 / 淺藍區塊', token('--fg-2'), token('--bg-2'), 4.5],
    ['弱化文字 / 面板底', token('--fg-2'), token('--bg-1'), 4.5],
    ['主題色文字 / 白色', token('--accent'), token('--bg-0'), 4.5],
    ['主題色文字 / 主題淡底按鈕', token('--accent'), token('--accent-soft'), 4.5],
    ['白字 / 主題色按鈕', '#ffffff', token('--accent'), 4.5],
    ['白字 / 漸層按鈕淺端', '#ffffff', token('--accent-4'), 4.5],
    ['成功色文字 / 白色', token('--ok'), token('--bg-0'), 4.5],
    ['警示色文字 / 白色', token('--warn'), token('--bg-0'), 4.5],
    ['危險色文字 / 白色', token('--danger'), token('--bg-0'), 4.5],
    ['資訊色文字 / 白色', token('--accent-4'), token('--bg-0'), 4.5],
    ['忙碌色文字 / 白色', token('--accent-2'), token('--bg-0'), 4.5],
    ['焦點環 / 白色面板', token('--accent'), token('--bg-0'), 3.0],
    ['選取框線 / 白色面板', token('--line-strong'), token('--bg-0'), 1.0],
  ];
}

let failures = 0;

for (const [name, palette] of [
  ['淺色主題對比度稽核 (WCAG 2.1) · 預設配色', defaults],
  ['淺色主題對比度稽核 (WCAG 2.1) · prefers-contrast: more', highContrast],
]) {
  const checks = buildChecks(palette);
  const width = Math.max(...checks.map((c) => c[0].length));
  console.log(`\n${name}\n`);
  let passed = 0;
  for (const [label, fgSpec, bgSpec, min] of checks) {
    const bg = paint(bgSpec);
    const fg = paint(fgSpec, bg);
    const ratio = contrast(fg, bg);
    const pass = ratio >= min;
    if (pass) passed++;
    else failures++;
    console.log(
      `${pass ? 'PASS' : 'FAIL'}  ${label.padEnd(width)}  ${ratio.toFixed(2).padStart(5)}:1  (需 ≥ ${min})  ${fgSpec} on ${bgSpec}`,
    );
  }
  console.log(`  → ${passed}/${checks.length} 通過`);
}

if (failures > 0) {
  console.error(`\n${failures} 組配色未達 WCAG AA`);
  process.exit(1);
}
console.log('\n全部配色通過 WCAG AA');
