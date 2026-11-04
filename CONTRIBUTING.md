# Contributing

Thanks for taking the time to improve **NEXUS WMS 3D**.

This project is a *reference implementation of a warehouse and transport digital
twin*. The value of a pull request is mostly in the parts that make the
simulation more truthful, the interface more usable, or the guarantees
stronger — not in adding more surface area.

## Getting set up

```bash
npm install
npm run dev        # http://127.0.0.1:5173
```

Node 20+ is required (the project targets ES2022).

## Before you open a pull request

```bash
npm run predeploy
```

That single command runs the whole quality gate:

1. `tsc --noEmit` — type check
2. `vitest run` — unit and invariant tests
3. `node scripts/i18n-check.mjs` — every UI string must have an English
   translation, and no Chinese string may leak into the interface unwrapped
4. `node scripts/contrast-audit.mjs` — WCAG 2.1 AA contrast audit of the theme
5. `vite build` — production build
6. `dist/` integrity and bundle budget

It exits non-zero on the first failure, so a green run means the build is
publishable.

## Working on the interface language

The interface ships in Traditional Chinese (`zh-TW`) and English (`en`).

- **Keys are the Chinese source strings.** `t('揀貨準確率')` looks up
  `'揀貨準確率'` in `src/core/dictionary.ts`.
- **Never hard-code user-visible text.** Wrap it in `t('…')`, `t\`… ${x}\`` or
  put it in a `labelTable({ … })`. The i18n gate fails the build otherwise.
- **Adding a string?** Add it to the code *and* to the dictionary. Run
  `npm run i18n:check` — it reports missing translations, unused ones,
  translations that still contain Chinese, and placeholder mismatches.
- **Business data is bilingual by design.** Catalogue records (SKUs, customers,
  suppliers, zones) carry a `*En` variant next to the Chinese one; use
  `localize(zh, en)` or the helpers in `src/domain/labels.ts` to render them.

## Style

- TypeScript strict mode, no `any` in application code.
- Prefer pure functions in `src/domain/` — that layer has **no DOM
  dependency**, which is what makes the simulation testable in Node.
- Keep the render layer dumb: `src/ui/` and `src/three/` read the domain and
  draw; they never mutate simulation state.
- Comments explain *why*, not *what*.

## Reporting bugs

Open an issue with the seed, the panel you were on, what you expected and
what happened. A screenshot of the 3D view helps a lot.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](LICENSE).
