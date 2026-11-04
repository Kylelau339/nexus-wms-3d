# Architecture

How NEXUS WMS 3D is put together, and what the simulation actually guarantees.
Read this before changing a domain rule — most of the interesting behaviour is
not visible from the interface.

---

## 1. Layering

```
src/core/      rng.ts · events.ts · i18n.ts · dictionary.ts
src/domain/    types.ts · layout.ts · catalog.ts · inventory.ts
               picking.ts · resources.ts · labels.ts · engine.ts
src/three/     scene.ts · warehouse.ts · actors.ts · overlays.ts
               materials.ts · textures.ts
src/ui/        app.ts · sections.ts · inspector.ts · charts.ts · dom.ts
```

The dependency direction is strictly downwards:

| Layer | May import | May **not** import |
|-------|-----------|--------------------|
| `core` | nothing | anything else in the project |
| `domain` | `core` | `three`, `ui`, anything DOM |
| `three` | `core`, `domain` | `ui` |
| `ui` | `core`, `domain`, `three` | — |

Two consequences follow, and they are the reason for the structure:

- **`domain/` has no DOM dependency.** The whole simulation can be instantiated
  and stepped in Node, which is why the test suite runs without a browser.
- **`core/i18n.ts` has no DOM dependency either.** It touches `localStorage`
  only behind a guard, so the domain can produce translated messages without
  knowing that a browser exists.

`three/` never mutates simulation state; it reads it and draws it. `ui/` never
mutates simulation state either — except through the explicit `engine.select()`
and `engine.setSpeed()` calls.

---

## 2. The simulation loop

`SimulationEngine.advance(realDtSeconds)` is the only entry point. It converts
wall-clock time into simulated minutes (`speed` × real time), then runs one
step of the fixed pipeline:

```
step(dt)
├── processOrderArrivals     new customer orders appear
├── processAsnArrivals       inbound trucks arrive at a dock
├── processVehicles(dt)      yard legs → dock → gate, highway legs
├── processWavePlanning      group released orders into waves
├── processShipping          consolidate packed orders into shipments
├── processOps(dt)           move workers/AGVs, complete tasks
├── processReplenishment     refill fast-mover pick faces
├── processCycleCount        schedule periodic cycle counts
└── recordHistory            push a KPI sample
```

Each stage reads and writes the same domain objects. Nothing is faked with a
scripted animation: **every movement in the 3D scene is the visualised result of
a domain rule being executed**.

### The eleven operational stages

| # | Stage | Domain rule that implements it |
|---|-------|-------------------------------|
| 1 | Advance shipping notice | ASN carries ETA, PO, pallets, weight, priority, lines |
| 2 | Inbound dock | A truck occupies one dock; the yard route is a waypoint list |
| 3 | Receiving | Receipts are booked into inbound staging; overflow spills to `S-OVER` |
| 4 | Put-away | The bin is chosen by temperature zone and ABC class; over-sized receipts are split |
| 5 | Storage | Per-bin weight/volume ledgers, lot-level traceability |
| 6 | Wave | Released orders grouped by priority then due date, assigned to pickers and a carrier |
| 7 | Picking | S-shape (serpentine) path per order, drawn in 3D |
| 8 | Packing | Lines consolidated into parcels; weight/volume recomputed from what was picked |
| 9 | Loading | Orders consolidated into a shipment, loaded parcel by parcel at an outbound dock |
| 10 | Transport | Distance-based highway leg with ETA, fuel/CO₂ accrual, carrier speed factor |
| 11 | Replenish / cycle count | Fast-mover faces refilled from reserve locations; periodic counts scheduled |

---

## 3. Domain rules worth knowing

### Inventory is a lot ledger

`Inventory` stores immutable `Lot` records. Every quantity change appends a
`Movement`, so the interface can show a full traceability chain from goods-in to
delivery.

- The per-location weight and volume tallies are **derived** from the lots they
  hold. An invariant test asserts they always agree.
- `Movement.note` is a lazy message descriptor, not a pre-rendered string, so
  it is translated in whichever language is active when it is displayed.

### Reservations follow the goods

A reservation is a promise against stock, so it has to move with the stock:

- Moving stock out of a bin releases the reservation proportionally.
- A lot can never hold more reserved than it has on hand.
- Replenishment never forward-picks stock that is already promised to an open
  order.
- `commitPick()` consumes each allocation exactly once and releases both the
  picked part and any shortfall. Callers must not release the same allocations
  again.

### Capacity is checked twice

Bin capacity is validated when a job is *planned* and again when it *executes*,
because several jobs may target the same bin before any of them completes. If
the bin filled up in the meantime, the remainder is re-planned rather than
silently overfilling.

### Pick accuracy is a real measurement

`Order.pickCount` counts handled pick lines, `Order.pickErrors` counts the
mis-picked ones, and `accuracy = 1 - pickErrors / pickCount`. A worker with
skill `s` mis-picks roughly `(1 - s)` of the lines they touch — which means
the metric does **not** decay with the number of lines on an order. An earlier
version decayed multiplicatively and the KPI was meaningless.

### The SLA is calibrated against the operation

Promise windows are `standard: 1440 min`, `express: 600 min`,
`critical: 300 min`, scaled by a random factor around 1.0. These are set so
that the facility's achievable cycle time can actually meet them: on-time
delivery is a performance signal, not a structural impossibility.

### Allocation matching is SKU-aware

An `Allocation` carries the `skuId` it belongs to. Allocations are matched on
SKU **and** bin, and every weight/volume conversion uses the lot's own SKU —
because a bin holds several SKUs and a caller may hand us allocations for more
than one of them.

### Determinism

Every generated artefact derives from a single seeded PRNG (`core/rng.ts`,
mulberry32). The same seed always produces the same world, which is what makes
the test suite meaningful.

**The order in which random numbers are drawn is part of the contract.** The
catalogue draws, for example, happen in exactly this sequence:

```
weighted(category) → pick(brand) → pick(noun) → [chance(tempZone)]
→ next(abcClass) → pick(variant) → int(barcode)
→ float(weight) → float(volume) → float(price) → pick(hazard)
```

Reordering those calls changes every SKU id → name mapping for a given seed.
When you add a random draw, put it at the **end** of the sequence, or bump the
seed and regenerate the baselines.

---

## 4. What the KPIs mean

| KPI | Definition |
|-----|-----------|
| Outbound throughput | Orders shipped in the last 60 simulated minutes |
| Pick accuracy | Mean per-order accuracy over the last 120 shipped orders; each order's accuracy is `1 - mis-picked lines / handled lines` |
| On-time delivery | Share of the last 120 shipped orders that met their promise date |
| Warehouse utilisation | Total stock weight ÷ total bin weight capacity |
| Dock utilisation | Occupied docks ÷ total docks |
| Fleet utilisation | Vehicles that are not idle ÷ total vehicles |
| Inventory turnover | `(daily shipments × 2.4) ÷ units on hand` |
| Average order cycle | Mean wall time from order creation to shipment, in minutes |
| Open orders | Orders that are neither shipped nor packed |

These are the numbers the invariant suite bounds. If you change one, the
`invariants.test.ts` band for it has to change with it — that is deliberate.

---

## 5. Rendering

`three/` builds the facility procedurally:

- `warehouse.ts` — racking, floors, docks, stations, walls, the control tower.
  Rack, pallet and carton geometry is `InstancedMesh`, so the whole facility is
  a handful of draw calls.
- `actors.ts` — trucks follow yard waypoint routes, workers and AGVs are
  animated meshes driven by engine state.
- `overlays.ts` — the pick-path ribbon and the highlight markers.
- `textures.ts` — every texture is drawn on a canvas at runtime: floor tiles,
  glows, sign boards, bin tags. There are no image files in the repository.

Two interaction paths resolve a bin:

- Clicking a **carton** maps an instance index back to a location id.
- Clicking a **rack** resolves the bin analytically from the pointer ray.

Sign boards are redrawn when the interface language changes
(`WarehouseScene.refreshLabels()`).

### Performance rules

- No allocations in the per-frame hot path.
- Emissive materials instead of point lights (a forward renderer pays per
  light per fragment).
- DOM panels are throttled (700–900 ms) and re-render only when their HTML
  actually changed.
- Pixel ratio and shadows degrade automatically when the frame rate drops.

---

## 6. Internationalisation

`core/i18n.ts` implements four primitives:

| Primitive | Purpose |
|-----------|---------|
| `t('…')` / `` t`… ${x}` `` | Translate a literal or a template |
| `msg('…', …)` / `renderMessage()` | A domain message rendered lazily, in the active language |
| `labelTable({ … })` | A table of labels translated on lookup |
| `localize(zh, en)` | Pick the right variant of a bilingual business record |

Keys are the Traditional Chinese source strings, so a call site reads naturally
in the primary locale and the dictionary can be validated mechanically. The
`scripts/i18n-check.mjs` gate enforces the three rules:

1. every key used in the code has an English translation;
2. every translation is actually used;
3. no Chinese string appears in the interface unwrapped.

---

## 7. Extension points

| To change | Edit |
|-----------|------|
| The facility layout | `domain/layout.ts` — `ZONE_SPECS`, staging lanes, docks, stations |
| The product catalogue | `domain/catalog.ts` — brands, categories, nouns, suppliers, carriers, customers |
| A new task kind | `domain/types.ts` (`TaskKind`), `domain/engine.ts` (`completeOp`), `ui/dom.ts` (`TASK_LABEL`) |
| A new KPI | `domain/types.ts` (`KpiSnapshot`), `domain/engine.ts` (`computeKpis`), `ui/sections.ts` |
| The pick strategy | `domain/picking.ts` — `optimizePickPath`, `selectWaveOrders` |
| A new panel | `ui/sections.ts` — add a `SectionId`, a `render*` function and a rail entry in `ui/app.ts` |
| The theme | `styles/main.css` tokens, then run `npm run audit:contrast` |
| A new language | `core/i18n.ts` (`LANGS`, `LOCALES`, `HTML_LANG`) and a dictionary module |

When you add a user-visible string, remember to add it to the English
dictionary in the same commit — `npm run i18n:check` will tell you if you
forget.
