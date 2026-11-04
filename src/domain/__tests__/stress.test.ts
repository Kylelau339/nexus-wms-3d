import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../engine';

/**
 * Multi-seed stress test.
 *
 * `invariants.test.ts` pins each property to a single seed. A single seed only
 * exercises one path through the random number generator: the moment a different
 * draw order sends the simulation down another branch — an oversized pallet that
 * has to be split, a wave that overflows the pick capacity, a truck that arrives
 * while every dock is busy — the defect is invisible to those tests.
 *
 * This file re-checks the load-bearing properties across a spread of seeds so
 * the suite fails on the *class* of bug rather than the one instance that
 * happened to be captured.
 */

/** Seeds chosen to spread across the generator's output space. */
const SEEDS = [7, 19, 23, 41, 56, 73, 88, 97, 121, 149, 173, 211];

const STEPS = 1200;

/**
 * Every seed is simulated exactly once and the resulting engine is reused by
 * every assertion below. Re-running the simulation per assertion would multiply
 * the runtime by the number of assertions for no extra coverage.
 */
const runs = new Map<number, SimulationEngine>();

/** Simulate a seed from scratch, without touching the cache. */
function simulate(seed: number): SimulationEngine {
  const engine = new SimulationEngine(seed);
  engine.bootstrap();
  engine.setSpeed(4);
  for (let i = 0; i < STEPS; i++) engine.advance(0.05);
  return engine;
}

function run(seed: number): SimulationEngine {
  const cached = runs.get(seed);
  if (cached) return cached;

  const engine = simulate(seed);
  runs.set(seed, engine);
  return engine;
}

const closeTo = (actual: number, expected: number, rel = 1e-6): boolean =>
  Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * rel);

describe('multi-seed stress', () => {
  it('never corrupts the stock ledger on any seed', () => {
    for (const seed of SEEDS) {
      const engine = run(seed);

      for (const [locationId, lots] of engine.inventory.lotsByLocation) {
        let weight = 0;
        let volume = 0;
        for (const lot of lots) {
          expect(lot.qty, `seed ${seed}`).toBeGreaterThanOrEqual(0);
          expect(lot.reservedQty, `seed ${seed}`).toBeLessThanOrEqual(lot.qty);
          const sku = engine.skuById.get(lot.skuId)!;
          weight += lot.qty * sku.unitWeight;
          volume += lot.qty * sku.unitVolume;
        }
        expect(closeTo(engine.inventory.locationWeight(locationId), weight), `seed ${seed}`).toBe(
          true,
        );
        expect(closeTo(engine.inventory.locationVolume(locationId), volume), `seed ${seed}`).toBe(
          true,
        );
      }
    }
  });

  it('never over-reserves a SKU on any seed', () => {
    for (const seed of SEEDS) {
      const engine = run(seed);
      for (const skuId of engine.inventory.lotsBySku.keys()) {
        expect(engine.inventory.reservedQty(skuId), `seed ${seed}`).toBeLessThanOrEqual(
          engine.inventory.onHand(skuId),
        );
      }
    }
  });

  it('never exceeds a location capacity on any seed', () => {
    for (const seed of SEEDS) {
      const engine = run(seed);
      for (const [locationId, weight] of engine.inventory.weightByLocation) {
        const location = engine.layout.locations.get(locationId);
        if (!location) continue;
        expect(weight, `seed ${seed} @ ${locationId}`).toBeLessThanOrEqual(
          location.maxWeight + 1e-6,
        );
      }
    }
  });

  it('keeps every shipment consistent with the orders inside it on any seed', () => {
    for (const seed of SEEDS) {
      const engine = run(seed);
      for (const shipment of engine.shipments.values()) {
        const orders = shipment.orderIds.map((id) => engine.orders.get(id));
        expect(orders.every((order) => order !== undefined), `seed ${seed}`).toBe(true);

        const weight = orders.reduce((sum, order) => sum + (order?.weight ?? 0), 0);
        const volume = orders.reduce((sum, order) => sum + (order?.volume ?? 0), 0);
        const parcels = orders.reduce((sum, order) => sum + Math.max(1, order?.lines.length ?? 1), 0);

        expect(closeTo(shipment.weight, weight), `seed ${seed}`).toBe(true);
        expect(closeTo(shipment.volume, volume), `seed ${seed}`).toBe(true);
        expect(shipment.parcels, `seed ${seed}`).toBe(parcels);
      }
    }
  });

  it('keeps the fleet exclusive on any seed', () => {
    for (const seed of SEEDS) {
      const engine = run(seed);

      const dockUse = new Map<string, number>();
      for (const vehicle of engine.vehicles) {
        if (!vehicle.dockId) continue;
        dockUse.set(vehicle.dockId, (dockUse.get(vehicle.dockId) ?? 0) + 1);
      }
      for (const [dockId, count] of dockUse) {
        expect(count, `seed ${seed} @ ${dockId}`).toBe(1);
      }

      // A vehicle may carry only one active shipment.
      const activeShipments = new Map<string, string>();
      for (const shipment of engine.shipments.values()) {
        // A shipment still at the dock or on the road occupies its vehicle; a
        // delivered one has released it.
        if (shipment.status === 'delivered') continue;
        if (!shipment.vehicleId) continue;

        const previous = activeShipments.get(shipment.vehicleId);
        expect(previous, `seed ${seed} @ ${shipment.vehicleId}`).toBeUndefined();
        activeShipments.set(shipment.vehicleId, shipment.id);
      }
    }
  });

  it('keeps the workforce bookkeeping consistent on any seed', () => {
    for (const seed of SEEDS) {
      const engine = run(seed);
      const activeIds = new Set(
        [...engine.tasks.values()].filter((task) => task.status === 'active').map((task) => task.id),
      );

      for (const worker of engine.workers) {
        if (!worker.busyTaskId) continue;
        expect(activeIds.has(worker.busyTaskId), `seed ${seed}`).toBe(true);
      }
      for (const agv of engine.agvs) {
        if (!agv.busyTaskId) continue;
        expect(activeIds.has(agv.busyTaskId), `seed ${seed}`).toBe(true);
      }
    }
  });

  it('keeps every KPI inside its valid range on any seed', () => {
    for (const seed of SEEDS) {
      const engine = run(seed);
      const kpi = engine.kpi;

      expect(kpi.warehouseUtilisation, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(kpi.warehouseUtilisation, `seed ${seed}`).toBeLessThanOrEqual(100);
      expect(kpi.pickAccuracy, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(kpi.pickAccuracy, `seed ${seed}`).toBeLessThanOrEqual(100);
      expect(kpi.onTimeDelivery, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(kpi.onTimeDelivery, `seed ${seed}`).toBeLessThanOrEqual(100);
      expect(kpi.openOrders, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      expect(kpi.activeWorkers, `seed ${seed}`).toBeLessThanOrEqual(engine.workers.length);
      expect(kpi.activeWorkers, `seed ${seed}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('never leaves an order in a state it cannot legally reach', () => {
    for (const seed of SEEDS) {
      const engine = run(seed);

      for (const order of engine.orders.values()) {
        // A picked line can never exceed what was ordered.
        for (const line of order.lines) {
          expect(line.pickedQty, `seed ${seed}`).toBeLessThanOrEqual(line.qty);
          expect(line.pickedQty, `seed ${seed}`).toBeGreaterThanOrEqual(0);
        }

        // An order that reached the shipment stage must be linked to a real one.
        if (order.status === 'shipped') {
          expect(order.shipmentId, `seed ${seed}`).toBeTruthy();
          expect(engine.shipments.has(order.shipmentId!), `seed ${seed}`).toBe(true);
        }
      }
    }
  });

  it('stays reproducible — the same seed replays identically', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      const first = run(seed);
      // A fresh, uncached simulation — it must reproduce the cached one exactly.
      const second = simulate(seed);

      expect(second.simTime, `seed ${seed}`).toBe(first.simTime);
      expect(second.orders.size, `seed ${seed}`).toBe(first.orders.size);
      expect(second.shipments.size, `seed ${seed}`).toBe(first.shipments.size);

      for (const [id, order] of first.orders) {
        const twin = second.orders.get(id);
        expect(twin, `seed ${seed} @ ${id}`).toBeDefined();
        expect(twin!.status, `seed ${seed} @ ${id}`).toBe(order.status);
        expect(twin!.weight, `seed ${seed} @ ${id}`).toBeCloseTo(order.weight, 9);
      }
    }
  });

  it('actually explores different branches — the seeds are not redundant', () => {
    // A multi-seed suite is only worth its runtime if the seeds diverge. If they
    // all produced the same world, the suite would re-test one branch and give
    // false confidence about the coverage it claims.
    const profiles = new Set<string>();

    for (const seed of SEEDS) {
      const engine = run(seed);
      profiles.add(
        [
          engine.orders.size,
          engine.shipments.size,
          engine.waves.size,
          engine.tasks.size,
          Math.round(engine.kpi.pickAccuracy * 100),
        ].join(':'),
      );
    }

    // Every seed must contribute a distinct profile — no duplicates.
    expect(profiles.size, `distinct profiles: ${profiles.size} of ${SEEDS.length}`).toBe(
      SEEDS.length,
    );
  });
});
