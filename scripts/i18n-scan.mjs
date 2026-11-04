/**
 * Reliable i18n scanner built on the TypeScript compiler API.
 *
 * A regex cannot tell a string literal from a regular expression or find the
 * boundaries of a template literal, so this walks the real AST instead. It
 * reports every Chinese string in the source tree and classifies it:
 *
 *   - `t('…')` / `msg('…')`   → translated, contributes a dictionary key
 *   - `` t`…` ``              → translated, contributes a template key
 *   - anything else           → a violation (untranslated UI copy)
 *
 * Usage:
 *   node scripts/i18n-scan.mjs                 # scan src/ and report
 *   node scripts/i18n-scan.mjs --keys          # print the distinct key list
 *   node scripts/i18n-scan.mjs --json          # machine-readable output
 *
 * Not part of the shipped app.
 */
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const CJK = /[\u4e00-\u9fff]/;

/** Functions whose string argument is a translation key. */
const KEY_FUNCTIONS = new Set(['t', 'msg']);
/**
 * Label tables hold the Chinese source strings and translate them on lookup, so
 * their values are dictionary keys even though they are not wrapped in `t()`.
 */
const LABEL_FUNCTIONS = new Set(['labelTable']);
/** Functions that consume business data (both language variants) — no key needed. */
const DATA_FUNCTIONS = new Set(['localize']);
/** Tagged template functions that translate their template. */
const KEY_TAGS = new Set(['t']);

/**
 * Files whose Chinese literals are *business data* rather than UI copy:
 * catalogue records, employee names, zone and station names. They are carried
 * through `localize()` / `*En` fields instead of the translation dictionary.
 */
const DATA_FILES = new Set([
  'src/domain/catalog.ts',
  'src/domain/resources.ts',
  'src/domain/layout.ts',
]);

/** Files that legitimately contain Chinese by definition. */
const SKIP_FILES = new Set(['src/core/dictionary.ts']);

/* ------------------------------------------------------------------ AST */

/** @param {string} filePath */
function parse(filePath) {
  const source = readFileSync(filePath, 'utf8');
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
}

function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

/** The dictionary key a literal contributes, or null for non-key literals. */
function keyOf(node) {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let key = node.head.text;
    node.templateSpans.forEach((span, index) => {
      key += `{${index}}${span.literal.text}`;
    });
    return key;
  }
  return null;
}

/** How the literal is wrapped, if at all. */
function wrapperOf(node) {
  const parent = node.parent;
  if (parent && ts.isCallExpression(parent) && parent.arguments.includes(node)) {
    return classifyCall(parent);
  }
  if (parent && ts.isTaggedTemplateExpression(parent) && parent.template === node) {
    const tag = parent.tag;
    if (ts.isIdentifier(tag) && KEY_TAGS.has(tag.text)) return { kind: 'key', fn: 't' };
    return null;
  }
  // A literal nested inside an object/array argument, e.g. `labelTable({ a: '…' })`.
  const enclosing = enclosingCall(node);
  if (enclosing) return classifyCall(enclosing);
  return null;
}

/** Walk outwards until the call that owns this literal, stopping at function bodies. */
function enclosingCall(node) {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isCallExpression(parent)) return parent;
    if (
      ts.isPropertyAssignment(parent) ||
      ts.isShorthandPropertyAssignment(parent) ||
      ts.isObjectLiteralExpression(parent) ||
      ts.isArrayLiteralExpression(parent) ||
      ts.isSpreadElement(parent) ||
      ts.isSpreadAssignment(parent)
    ) {
      current = parent;
      continue;
    }
    return null;
  }
  return null;
}

function classifyCall(call) {
  const callee = call.expression;
  if (!ts.isIdentifier(callee)) return null;
  const name = callee.text;
  if (KEY_FUNCTIONS.has(name)) return { kind: 'key', fn: name };
  if (LABEL_FUNCTIONS.has(name)) return { kind: 'key', fn: name };
  if (DATA_FUNCTIONS.has(name)) return { kind: 'data', fn: name };
  return null;
}

/* --------------------------------------------------------------- scanning */

/**
 * @param {string[]} files absolute paths
 * @returns {{keys: Map<string, Set<string>>, violations: Array<object>, data: Array<object>}}
 */
export function scanFiles(files) {
  const keys = new Map();
  const violations = [];
  const data = [];

  for (const filePath of files) {
    const rel = relative(process.cwd(), filePath).replace(/\\/g, '/');
    if (SKIP_FILES.has(rel)) continue;
    const isDataFile = DATA_FILES.has(rel);

    const sourceFile = parse(filePath);
    const { line } = sourceFile.getLineAndCharacterOfPosition.bind(sourceFile);

    walk(sourceFile, (node) => {
      const isLiteral =
        ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node);
      if (!isLiteral) return;

      const key = keyOf(node);
      if (key === null || !CJK.test(key)) return;

      const wrapper = wrapperOf(node);
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));

      if (wrapper?.kind === 'key') {
        if (!keys.has(key)) keys.set(key, new Set());
        keys.get(key).add(rel);
        return;
      }

      if (wrapper?.kind === 'data') {
        data.push({ file: rel, line: position.line + 1, key });
        return;
      }

      // Business-data files may contain raw Chinese without being violations.
      if (isDataFile) {
        data.push({ file: rel, line: position.line + 1, key });
        return;
      }

      violations.push({ file: rel, line: position.line + 1, key });
    });
    void line;
  }

  return { keys, violations, data };
}

/** Collect every .ts file under a directory (or a single file). */
export function collectFiles(target) {
  const abs = target.startsWith('/') || /^[A-Za-z]:/.test(target) ? target : join(process.cwd(), target);
  try {
    if (statSync(abs).isFile()) return [abs];
  } catch {
    return [];
  }
  const out = [];
  const walkDir = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Test files intentionally contain raw Chinese literals as fixtures.
      if (entry.name === '__tests__') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
    }
  };
  walkDir(abs);
  return out;
}

/**
 * Read the English dictionary straight from the TypeScript source.
 * Returns key → translation (or null when the translation is a function).
 */
export function readDictionary(filePath) {
  const sourceFile = parse(filePath);
  const entries = new Map();

  walk(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node)) return;
    if (node.name.getText(sourceFile) !== 'EN') return;
    const init = node.initializer;
    if (!init || !ts.isObjectLiteralExpression(init)) return;
    for (const prop of init.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = prop.name.getText(sourceFile).replace(/^['"]|['"]$/g, '');
      const value = prop.initializer;
      entries.set(key, ts.isStringLiteral(value) ? value.text : null);
    }
  });

  return entries;
}

/** Placeholders (`{0}`, `{1}` …) used by a string, in order of appearance. */
export function placeholders(text) {
  return [...text.matchAll(/\{(\d+)\}/g)].map((m) => m[1]);
}

/* -------------------------------------------------------------------- CLI */

function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith('--')) ?? 'src';
  const files = collectFiles(target);
  const { keys, violations, data } = scanFiles(files);

  if (args.includes('--json')) {
    console.log(
      JSON.stringify(
        {
          keys: [...keys.entries()].map(([key, where]) => ({ key, files: [...where] })),
          violations,
          data,
        },
        null,
        2,
      ),
    );
    return violations.length > 0 ? 1 : 0;
  }

  if (args.includes('--keys')) {
    const sorted = [...keys.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    console.log(`// ${sorted.length} distinct keys`);
    for (const key of sorted) {
      console.log(`${JSON.stringify(key)}\t${[...keys.get(key)].join(',')}`);
    }
    return violations.length > 0 ? 1 : 0;
  }

  console.log(`scanned ${files.length} files`);
  console.log(`keys: ${keys.size}`);
  console.log(`data literals: ${data.length}`);
  console.log(`violations: ${violations.length}`);
  for (const violation of violations) {
    console.log(`  ${violation.file}:${violation.line}  ${JSON.stringify(violation.key)}`);
  }
  return violations.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
