# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-11-04

### Added

- **Structural accessibility audit** (`src/ui/__tests__/a11y.test.ts`, 12 tests) —
  the interface is mounted in a DOM and checked for the rules a colour contrast
  audit can never catch: every interactive control has an accessible name, images
  and inline graphics are labelled, form controls have labels, the document has
  exactly one `h1` with no skipped heading levels, every `aria-labelledby` /
  `aria-describedby` / `aria-controls` reference resolves, a polite live region
  exists, the landmarks are named and the keyboard order is intact.
- **Open Graph share card** — `public/og.png` (1200×630), generated procedurally by
  `scripts/generate-og.mjs` from the same design tokens as the application, so a
  shared link shows a real preview instead of a blank rectangle. The generator
  draws the isometric warehouse (racking, conveyor, AGV, truck) in vector form
  and needs no external fonts or images.
- `og:image`, `og:image:alt`, `twitter:card`, `twitter:title`, `twitter:description`
  and `twitter:image` meta tags. The title and description switch with the
  interface language, and `og:locale` alternates between `zh_TW` and `en_US`.
- **Self-containment audit** (`scripts/selfcontained-check.mjs`) — the project's central
  promise is that the built site has no external dependencies, no CDN, no web font and
  makes no network request at all. That promise was previously only maintained by hand.
  The audit scans the built output for external URLs, network APIs (`fetch`,
  `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `importScripts`) and web
  font references, and fails the release if any appear. It also verifies that every
  local asset referenced by the HTML exists.
- **GitHub Pages deployment workflow** (`.github/workflows/pages.yml`) — publishes
  `dist/` on every push to `main`, so the repository carries a live demo of
  itself. Works from a project sub-path because the build emits relative asset
  paths.
- **Multi-seed stress suite** (`src/domain/__tests__/stress.test.ts`, 10 tests) —
  re-checks the load-bearing invariants across twelve different seeds. A single
  seed only exercises one path through the random number generator, so a defect
  requiring a particular draw would otherwise pass unnoticed. The suite also
  asserts that the twelve seeds produce twelve distinct outcome profiles, so it
  cannot silently degrade into testing one branch repeatedly.

### Fixed

- **The document had no `h1` and no panel-level headings.** The interface was built
  entirely from `h2` elements, so a screen-reader user entered the page at heading
  level 2 with no page title at all. The brand mark is now the `h1`, each panel
  owns an `h2` ("Operations overview" / "Details") and the blocks inside are `h3`.
- **The panel title overwrote the first section's heading.** The left panel's name
  was written over the text of whatever section happened to come first, so the
  "Core KPI" heading silently became "Operations overview" and the section lost
  its own name. The panel heading is now rendered separately.

### Changed

- Vite's modulepreload polyfill is now disabled. The project has no dynamic imports,
  so the polyfill was dead weight — and it was the only thing in the bundle that
  issued a network request at runtime. The shipped site now makes no request at all.
- `scripts/predeploy.mjs` now recognises files copied from `public/` — they are
  referenced from a `content="…"` attribute, which the asset scan did not see.
  The stray-file check still rejects anything that is genuinely not part of the
  build.
- The release gate understands `public/` assets and counts them in the bundle
  budget: the total is now 830 KB of a 1.5 MB allowance.
- `sharp` is intentionally **not** a project dependency. It is only needed to
  regenerate the share card (`npm i -D sharp && npm run og`), so `npm ci` stays
  at 62 packages for contributors.

## [1.1.0] — 2026-11-04

### Added

- **Internationalisation** — the whole interface now ships in Traditional
  Chinese (`zh-TW`, default) and English (`en`), switchable from the top bar.
  The choice is persisted in `localStorage`.
- `src/core/i18n.ts` — a DOM-free runtime with `t()`, tagged-template
  translation, lazy domain messages (`msg()` / `renderMessage()`), label tables
  (`labelTable()`), locale-aware number formatting and change notifications.
- `src/core/dictionary.ts` — the English dictionary (317 keys).
- Bilingual business records: SKU names and categories, zones, stations,
  customers, suppliers, carriers, hazard classes and order channels each carry
  an English variant next to the Chinese source.
- `scripts/i18n-scan.mjs` — an AST-based scanner (TypeScript compiler API) that
  finds every Chinese string in the source tree and classifies it as translated,
  business data, or a violation.
- `scripts/i18n-check.mjs` — a release gate that verifies the dictionary is
  complete, free of stale entries, free of untranslated Chinese, and that
  placeholders match the source.
- `src/core/__tests__/i18n.test.ts` — 17 tests covering the runtime behaviour
  and dictionary integrity.
- The 3D sign boards are redrawn in the active language on switch.

### Changed

- Domain messages (task labels, alerts, stock-movement notes) are now lazy
  descriptors instead of pre-rendered strings, so a label created hours ago
  still renders in the language the operator is currently using.
- `npm run predeploy` now includes the i18n dictionary audit between the test
  suite and the contrast audit.
- Order channels use stable codes (`B2B`, `B2C`, `XBorder`, `Replenish`) and are
  translated in the interface.

## [1.0.0] — 2026-11-03

### Added

- Event-driven WMS/TMS simulation engine covering the full inbound → storage →
  fulfilment → outbound → transport lifecycle.
- Procedural 3D warehouse: 1,704 bins, 4 storage zones, 11 docks, 28 workers,
  10 AGVs, 10 trucks.
- Six-panel interface with live KPIs, canvas charts, a 3D detail inspector and
  full keyboard support.
- Light theme (white + light blue) with an automated WCAG 2.1 AA contrast audit.
- Cross-entity invariant test suite (17 tests) that found and fixed two real
  defects: a reservation leak and a wrong-SKU pick conversion.
- Release gate (`npm run predeploy`) covering type check, tests, contrast,
  build, `dist/` integrity and bundle budget.

[1.2.0]: https://github.com/Kylelau339/nexus-wms-3d/releases/tag/v1.2.0
[1.1.0]: https://github.com/Kylelau339/nexus-wms-3d/releases/tag/v1.1.0
[1.0.0]: https://github.com/Kylelau339/nexus-wms-3d/releases/tag/v1.0.0
