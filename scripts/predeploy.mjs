/**
 * Release gate.
 *
 * Runs everything that has to hold before the site is published, in one command:
 *
 *   1. manifest / lockfile sync — `npm ci` refuses to install when they differ
 *   2. type check        — tsc --noEmit
 *   3. unit + invariant tests
 *   4. i18n dictionary audit — every key translated, no stray Chinese strings
 *   5. WCAG 2.1 contrast audit of the light theme
 *   6. production build
 *   7. dist/ integrity   — index.html at the root, every referenced asset present,
 *                          no stray files, and the bundle stays inside its budget
 *
 *   npm run predeploy
 *
 * Exits non-zero on the first failure so it can be wired into CI or a pre-publish hook.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = join(root, 'dist');

/** Size budgets — gzip-friendly limits for a single-page app. */
const BUDGET = {
  totalBytes: 1_500_000,
  largestAssetBytes: 700_000,
};

/**
 * Run one static command. The command strings below are constants defined in this
 * file, so there is no user input involved — the whole line is handed to the shell
 * because that is the only way `npx` resolves consistently on Windows.
 */
function run(label, command) {
  process.stdout.write(`\n▶ ${label}\n`);
  const result = spawnSync(command, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    console.error(`\n✗ ${label} failed`);
    process.exit(result.status ?? 1);
  }
}

/* -------------------------------------------------------------- 1. checks */

/** `--dist-only` re-checks an existing build without re-running the toolchain. */
const distOnly = process.argv.includes('--dist-only');

if (!distOnly) {
  run('type check', 'npx tsc --noEmit');
  run('unit + invariant + stress tests', 'npx vitest run');
  run('i18n dictionary audit', 'node scripts/i18n-check.mjs');
  run('WCAG contrast audit', 'node scripts/contrast-audit.mjs');
  run('production build', 'npx vite build');
}

/**
 * The manifest and the lockfile have to agree.
 *
 * `npm ci` refuses to install when they disagree, so a version bump that
 * forgets the lockfile breaks CI and every fresh clone. Catching it here turns
 * a confusing install failure into one line.
 */
run('manifest / lockfile sync', 'node scripts/check-manifest.mjs');

/**
 * The self-containment audit always runs — it inspects the built output, which
 * is the thing being published, so it is relevant even for `--dist-only`.
 */
run('self-containment audit', 'node scripts/selfcontained-check.mjs');

/* ------------------------------------------------------- 2. dist integrity */

process.stdout.write('\n▶ dist integrity\n');

if (!existsSync(dist)) {
  console.error('✗ dist/ is missing');
  process.exit(1);
}

const indexHtml = join(dist, 'index.html');
if (!existsSync(indexHtml)) {
  console.error('✗ dist/index.html is missing — the site root must contain index.html');
  process.exit(1);
}

const html = readFileSync(indexHtml, 'utf8');

/** Every local reference in the built HTML must resolve to a real file. */
const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((href) => href && !/^(https?:|data:|#|mailto:)/.test(href))
  .map((href) => href.split('?')[0].split('#')[0]);

const missing = references.filter((href) => !existsSync(join(dist, href.replace(/^\.?\//, ''))));
if (missing.length > 0) {
  console.error(`✗ dist/index.html references missing files: ${missing.join(', ')}`);
  process.exit(1);
}

/**
 * Files copied verbatim from `public/` are legitimate build output even when no
 * `<script>`/`<link>` points at them — the Open Graph card is referenced from
 * a `content="..."` attribute, which the reference scan above does not see.
 * They are collected from the meta tags instead, so the stray-file check below
 * still rejects anything that is genuinely not part of the build.
 */
const publicAssets = [...html.matchAll(/<meta[^>]+content="([^"]+\.(?:png|jpe?g|svg|webp|ico))"/g)]
  .map((match) => match[1])
  .map((src) => src.replace(/^\.?\//, '').split('/').join('/'));

/** Flatten dist/ and look for anything the build did not produce. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(dist);
const expected = new Set(
  references.map((href) => href.replace(/^\.?\//, '').split('/').join('/')),
);
for (const asset of publicAssets) expected.add(asset);

const stray = files.filter((file) => {
  const rel = relative(dist, file).split(/[\\/]/).join('/');
  if (rel === 'index.html') return false;
  return !expected.has(rel);
});
if (stray.length > 0) {
  console.error(
    `✗ dist/ contains files that are not part of the build output:\n  ${stray
      .map((file) => relative(dist, file))
      .join('\n  ')}`,
  );
  process.exit(1);
}

/* ------------------------------------------------------- 3. bundle budgets */

const total = files.reduce((sum, file) => sum + statSync(file).size, 0);
const largest = files.reduce(
  (best, file) => (statSync(file).size > statSync(best).size ? file : best),
  files[0],
);
const largestSize = statSync(largest).size;

const report = (label, value, limit) => {
  const ok = value <= limit;
  console.log(
    `  ${ok ? '✓' : '✗'} ${label.padEnd(22)} ${(value / 1024).toFixed(0).padStart(5)} KB / ${(
      limit / 1024
    ).toFixed(0)} KB`,
  );
  return ok;
};

const withinTotal = report('total dist size', total, BUDGET.totalBytes);
const withinLargest = report(
  'largest asset',
  largestSize,
  BUDGET.largestAssetBytes,
);
console.log(`  · largest asset: ${relative(dist, largest)}`);

if (!withinTotal || !withinLargest) {
  console.error('\n✗ bundle budget exceeded');
  process.exit(1);
}

console.log(
  `\n✓ release gate passed — ${files.length} files, ${(total / 1024).toFixed(0)} KB total, ` +
    `${references.length} asset references resolved`,
);