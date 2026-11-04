/**
 * Manifest / lockfile sync check.
 *
 * `npm ci` refuses to install when `package.json` and `package-lock.json`
 * disagree, so a version bump that forgets the lockfile breaks CI and every
 * fresh clone — and it breaks *before* any of the checks can run, which makes
 * the cause surprisingly hard to see.
 *
 * This script has no dependencies on purpose, so it can run before
 * `npm install` has ever touched the project.
 *
 *   node scripts/check-manifest.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lockfile = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const declared = lockfile.packages?.['']?.version;

if (declared !== manifest.version) {
  console.error(
    `✗ package.json is ${manifest.version} but package-lock.json is ${declared}\n` +
      '  npm ci will refuse to install until they agree.\n' +
      '  run: npm install --package-lock-only',
  );
  process.exit(1);
}

console.log(`✓ package.json and package-lock.json agree on ${manifest.version}`);
