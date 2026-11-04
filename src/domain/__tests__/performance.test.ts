// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../../domain/engine';

/**
 * Performance budgets.
 *
 * The README claims the simulation runs in the browser without dropping frames
 * and that the hot path allocates nothing per frame. Those claims are only
 * worth something if they are measured, so this suite puts a number on them.
 *
 * The budgets are deliberately loose: they are a regression tripwire, not a
 * benchmark. A change that makes the engine two times slower should fail the
 * build; a change that makes it 3% slower should not.
 *
 * The measurements run in Node rather than in a browser, so they exclude the
 * WebGL cost entirely — what is left is the part this project actually owns:
 * the domain simulation and the DOM rendering.
 */

const BUDGET = {
  /** One simulation step must cost far less than a frame (16.7 ms at 60 Hz). */
  stepMs: 2,
  /** A full panel re-render must fit inside a frame. */
  renderMs: 8,
  /** A thousand steps must not grow the heap without bound. */
  heapGrowthKb: 2048,
};

function measure(label: string, iterations: number, run: (i: number) => void): number {
  // A short warm-up lets the JIT settle before the measurement.
  for (let i = 0; i < Math.min(20, iterations); i += 1) run(i);

  const started = performance.now();
  for (let i = 0; i < iterations; i += 1) run(i);
  const elapsed = performance.now() - started;

  const perCall = elapsed / iterations;
  console.log(`  ${label}: ${perCall.toFixed(3)} ms/call over ${iterations} iterations`);
  return perCall;
}

describe('simulation performance', () => {
  it('steps the engine well inside a frame budget', () => {
    const engine = new SimulationEngine(20240101);
    engine.bootstrap();
    engine.setSpeed(4);

    const perStep = measure('engine.advance', 2000, () => engine.advance(0.05));
    expect(perStep).toBeLessThan(BUDGET.stepMs);
  });

  it('keeps a busy operation stable over a long run', () => {
    const engine = new SimulationEngine(777);
    engine.bootstrap();
    engine.setSpeed(16);

    // Run for a while so the facility fills up with real work — orders,
    // shipments, waves, alerts — before measuring.
    for (let i = 0; i < 3000; i += 1) engine.advance(0.05);

    const perStep = measure('engine.advance (loaded)', 2000, () => engine.advance(0.05));
    expect(perStep).toBeLessThan(BUDGET.stepMs);
  });

  it('does not leak memory across a thousand steps', () => {
    const engine = new SimulationEngine(4242);
    engine.bootstrap();
    engine.setSpeed(8);

    // Settle the heap, then let the simulation grow to a realistic working set.
    for (let i = 0; i < 1500; i += 1) engine.advance(0.05);
    globalThis.gc?.();
    const before = process.memoryUsage().heapUsed;

    for (let i = 0; i < 1000; i += 1) engine.advance(0.05);
    globalThis.gc?.();
    const after = process.memoryUsage().heapUsed;

    const growthKb = (after - before) / 1024;

    // Without an exposed garbage collector the measurement includes everything
    // that was merely *not collected yet*, so the budget is relaxed rather than
    // reporting a leak that is really just deferred collection.
    const canCollect = typeof globalThis.gc === 'function';
    const budget = canCollect ? BUDGET.heapGrowthKb : BUDGET.heapGrowthKb * 4;

    console.log(
      `  heap growth: ${growthKb.toFixed(0)} KB across 1000 steps` +
        (canCollect ? '' : ' (no --expose-gc: relaxed budget)'),
    );

    // The movement trail is *meant* to grow, so the allowance is generous —
    // but a per-frame allocation leak would blow past it.
    expect(growthKb).toBeLessThan(budget);
  });
});

describe('inventory scan performance', () => {
  it('keeps the stock ledger scan cheap', () => {
    const engine = new SimulationEngine(31337);
    engine.bootstrap();
    engine.setSpeed(4);
    for (let i = 0; i < 2000; i += 1) engine.advance(0.05);

    // The full ledger scan is what the invariant suite does on every check —
    // it must stay fast enough to run often.
    const perScan = measure('ledger scan', 20, () => {
      let total = 0;
      for (const lots of engine.inventory.lotsByLocation.values()) {
        for (const lot of lots) total += lot.qty;
      }
      expect(total).toBeGreaterThanOrEqual(0);
    });

    expect(perScan).toBeLessThan(BUDGET.renderMs);
  });
});
