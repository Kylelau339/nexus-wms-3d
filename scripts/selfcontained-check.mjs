/**
 * Self-containment audit.
 *
 * The project's central promise is that the built site has **no external
 * dependencies**: no CDN, no web font, no analytics beacon, no API call. Every
 * texture, mesh and data set is generated procedurally at runtime, so the whole
 * `dist/` folder can be copied onto a machine with no network access and still
 * work.
 *
 * That promise is only worth something if it is enforced. A single
 * `import 'https://cdn…'` or a `<link href="fonts.googleapis.com…">` would
 * break it silently — the site would still work on the developer's machine and
 * fail behind a firewall. This script turns the promise into a release gate.
 *
 *   node scripts/selfcontained-check.mjs [dist-dir]
 *
 * Checks, over every file in `dist/`:
 *   1. no `http://` / `https://` URL that is fetched or linked (XML namespace
 *      URIs are identifiers, not requests, and are allowed)
 *   2. no `//host/...` protocol-relative URL
 *   3. no network API in the bundled code (fetch, XMLHttpRequest, WebSocket,
 *      EventSource, sendBeacon, importScripts)
 *   4. no web font reference (@font-face, .woff/.woff2/.ttf/.otf/.eot)
 *   5. no `<script src>` / `<link href>` / `<img src>` pointing off-site
 *   6. every local asset referenced by the HTML actually exists
 *
 * Exits non-zero on the first violation.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = resolve(process.argv[2] ?? join(root, 'dist'));

/* --------------------------------------------------------------- utilities */

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/**
 * URIs that are *namespaces*, not endpoints. `http://www.w3.org/2000/svg` is
 * an XML namespace identifier — the browser never requests it — so it must not
 * be reported as an external dependency.
 */
const NAMESPACE_URIS = new Set([
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace',
  'http://www.w3.org/2000/xmlns/',
  'http://www.purl.org/dc/elements/1.1/',
  'http://schema.org',
  'https://schema.org',
]);

/** Network APIs that would make the page depend on a server. */
const NETWORK_APIS = [
  { name: 'fetch()', re: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/ },
  { name: 'WebSocket', re: /\bnew\s+WebSocket\b/ },
  { name: 'EventSource', re: /\bnew\s+EventSource\b/ },
  { name: 'sendBeacon', re: /\bnavigator\s*\.\s*sendBeacon\b/ },
  { name: 'importScripts', re: /\bimportScripts\s*\(/ },
];

const FONT_RE = /@font-face|\.(?:woff2?|ttf|otf|eot)\b/i;

const problems = [];

/* -------------------------------------------------------------- 1. collect */

if (!existsSync(dist)) {
  console.error(`✗ ${relative(root, dist)} is missing`);
  process.exit(1);
}

const files = walk(dist);
if (files.length === 0) {
  console.error(`✗ ${relative(root, dist)} is empty`);
  process.exit(1);
}

const isText = (file) => /\.(?:html|css|js|mjs|json|svg|webmanifest)$/i.test(file);

const report = (file, line, message) => {
  problems.push(`${relative(dist, file).split(/[\\/]/).join('/')}:${line} — ${message}`);
};

/* -------------------------------------------------------------- 2. the scan */

for (const file of files) {
  if (!isText(file)) continue;
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');

  lines.forEach((text, index) => {
    const line = index + 1;

    /* 1 + 2. absolute and protocol-relative URLs */
    for (const match of text.matchAll(/\bhttps?:\/\/[^\s"'`)<>]+/g)) {
      const url = match[0];
      if (NAMESPACE_URIS.has(url)) continue;
      if (NAMESPACE_URIS.has(url.replace(/\/$/, ''))) continue;
      report(file, line, `external URL "${url}"`);
    }
    for (const match of text.matchAll(/(?:src|href)\s*=\s*["']\/\/[^"']+["']/g)) {
      report(file, line, `protocol-relative URL "${match[0]}"`);
    }

    /* 3. network APIs */
    for (const api of NETWORK_APIS) {
      if (api.re.test(text)) {
        report(file, line, `network API ${api.name}`);
      }
    }

    /* 4. web fonts */
    if (FONT_RE.test(text)) {
      report(file, line, 'web font reference (@font-face or a font file extension)');
    }
  });
}

/* --------------------------------------- 5 + 6. the HTML's own references */

const indexHtml = join(dist, 'index.html');
if (!existsSync(indexHtml)) {
  console.error('✗ dist/index.html is missing');
  process.exit(1);
}

const html = readFileSync(indexHtml, 'utf8');
const htmlLines = html.split('\n');

htmlLines.forEach((text, index) => {
  const line = index + 1;
  const tags = [...text.matchAll(/<(?:script|img|link|source|iframe|video|audio)\b[^>]*>/g)];
  for (const [tag] of tags) {
    const ref = /\b(?:src|href)\s*=\s*["']([^"']+)["']/.exec(tag);
    if (!ref) continue;
    const value = ref[1];
    if (/^(https?:)?\/\//i.test(value) || /^data:/i.test(value)) continue;
    const clean = value.split('?')[0].split('#')[0].replace(/^\.?\//, '');
    if (!existsSync(join(dist, clean))) {
      report(indexHtml, line, `references a missing local file "${value}"`);
    }
  }
});

/* --------------------------------------------------------------- 3. verdict */

console.log(`  scanning ${files.length} file(s) in ${relative(root, dist)}`);

if (problems.length > 0) {
  console.error('\n✗ the build is not self-contained:\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    '\n  The site must not depend on any external host. Bundle the dependency, ' +
      'generate the asset procedurally, or drop the feature.',
  );
  process.exit(1);
}

console.log('  ✓ no external URLs, network APIs or web fonts');
console.log('  ✓ every local reference resolves inside dist/');
console.log('\n✓ the build is fully self-contained');
