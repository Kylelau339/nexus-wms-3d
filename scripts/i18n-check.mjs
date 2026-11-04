/**
 * i18n release gate.
 *
 * Verifies the English dictionary against the source tree:
 *
 *   1. every key used in the code has an English translation
 *   2. every translation is actually used (no dead entries)
 *   3. no translation still contains Chinese characters
 *   4. placeholders (`{0}`, `{1}` …) match the Chinese source
 *
 * Usage:
 *   node scripts/i18n-check.mjs
 *
 * Not part of the shipped app.
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { collectFiles, placeholders, readDictionary, scanFiles } from './i18n-scan.mjs';

const CJK = /[\u4e00-\u9fff]/;

const sourceDir = process.argv[2] ?? 'src';
const files = collectFiles(sourceDir);
const { keys, violations } = scanFiles(files);
const dictionary = readDictionary(join(process.cwd(), 'src/core/dictionary.ts'));

/** Keys declared in the static HTML shell through `data-i18n*` attributes. */
function htmlKeys(htmlPath) {
  const found = new Set();
  let html;
  try {
    html = readFileSync(htmlPath, 'utf8');
  } catch {
    return found;
  }
  for (const match of html.matchAll(/data-i18n(?:-aria|-title)?="([^"]+)"/g)) {
    found.add(match[1]);
  }
  return found;
}

const errors = [];

/* 1. every used key must be translated */
for (const key of keys.keys()) {
  if (!dictionary.has(key)) errors.push(`missing translation: ${JSON.stringify(key)}`);
}
for (const key of htmlKeys(join(process.cwd(), 'index.html'))) {
  if (!dictionary.has(key)) errors.push(`missing translation: ${JSON.stringify(key)}`);
}

/* 2. no dead entries */
for (const key of dictionary.keys()) {
  if (!keys.has(key) && !htmlKeys(join(process.cwd(), 'index.html')).has(key)) {
    errors.push(`unused translation: ${JSON.stringify(key)}`);
  }
}

/* 3 + 4. translation quality */
for (const [key, value] of dictionary) {
  if (value === null) {
    errors.push(`translation must be a literal string: ${JSON.stringify(key)}`);
    continue;
  }
  // A translation identical to its source is an intentional autonym
  // (language names such as 「中文」 are never translated).
  if (value === key) continue;
  if (CJK.test(value)) errors.push(`translation still contains Chinese: ${JSON.stringify(key)}`);
  const source = placeholders(key).sort().join(',');
  const target = placeholders(value).sort().join(',');
  if (source !== target) {
    errors.push(
      `placeholder mismatch: ${JSON.stringify(key)} (source {${source}} vs translation {${target}})`,
    );
  }
}

/* 5. no untranslated literals in the code */
for (const violation of violations) {
  errors.push(`untranslated string: ${violation.file}:${violation.line} ${JSON.stringify(violation.key)}`);
}

console.log(`keys in source : ${keys.size}`);
console.log(`dictionary     : ${dictionary.size}`);
console.log(`violations     : ${violations.length}`);

if (errors.length > 0) {
  console.error(`\n✗ ${errors.length} problem(s):`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log('\n✓ dictionary is complete and consistent');
