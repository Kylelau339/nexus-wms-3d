# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Procedural 3D warehouse: ~1,800 bins, 4 storage zones, 11 docks, 28 workers,
  10 AGVs, 10 trucks.
- Six-panel interface with live KPIs, canvas charts, a 3D detail inspector and
  full keyboard support.
- Light theme (white + light blue) with an automated WCAG 2.1 AA contrast audit.
- Cross-entity invariant test suite (17 tests) that found and fixed two real
  defects: a reservation leak and a wrong-SKU pick conversion.
- Release gate (`npm run predeploy`) covering type check, tests, contrast,
  build, `dist/` integrity and bundle budget.

[1.1.0]: https://github.com/Kylelau339/nexus-wms-3d/releases/tag/v1.1.0
[1.0.0]: https://github.com/Kylelau339/nexus-wms-3d/releases/tag/v1.0.0
