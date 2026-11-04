import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../engine';

/**
 * Cross-entity invariants.
 *
 * `engine.test.ts` covers each unit in isolation; this file exercises a long
 * simulation run and asserts the properties that only break when two parts of
 * the system disagree with each other — ledger drift, leaked reservations,
 * shipments that disagree with the orders inside them, docks serving two trucks
 * at once, and so on.
 */

function boot(seed = 42): SimulationEngine {
  const engine = new SimulationEngine(seed);
  engine.bootstrap();
  return engine;
}

/** Boot, run the simulation forward, and hand back the engine. */
function run(seed: number, steps: number): SimulationEngine {
  const engine = boot(seed);
  engine.setSpeed(4);
  for (let i = 0; i < steps; i++) engine.advance(0.05);
  return engine;
}

/** Floating point tolerance for ledger comparisons. */
const closeTo = (actual: number, expected: number, rel = 1e-6): boolean =>
  Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * rel);

describe('ledger integrity', () => {
  it('keeps the per-location weight and volume ledgers in sync with their lots', () => {
    const engine = run(101, 3000);
    expect(engine.inventory.lotsByLocation.size).toBeGreaterThan(0);

    for (const [locationId, lots] of engine.inventory.lotsByLocation) {
      let weight = 0;
      let volume = 0;
      for (const lot of lots) {
        const sku = engine.skuById.get(lot.skuId)!;
        weight += lot.qty * sku.unitWeight;
        volume += lot.qty * sku.unitVolume;
      }
      expect(closeTo(engine.inventory.locationWeight(locationId), weight)).toBe(true);
      expect(closeTo(engine.inventory.locationVolume(locationId), volume)).toBe(true);
    }
  });

  it('never drives a quantity or a ledger balance negative', () => {
    const engine = run(102, 3000);

    for (const lots of engine.inventory.lotsBySku.values()) {
      for (const lot of lots) {
        expect(lot.qty).toBeGreaterThanOrEqual(0);
        expect(lot.reservedQty).toBeGreaterThanOrEqual(0);
      }
    }
    for (const weight of engine.inventory.weightByLocation.values()) {
      expect(weight).toBeGreaterThanOrEqual(0);
    }
    for (const volume of engine.inventory.volumeByLocation.values()) {
      expect(volume).toBeGreaterThanOrEqual(0);
    }
  });

  it('never reserves more stock than it physically holds', () => {
    const engine = run(103, 3000);

    for (const lots of engine.inventory.lotsBySku.values()) {
      for (const lot of lots) {
        expect(lot.reservedQty).toBeLessThanOrEqual(lot.qty);
      }
    }
    for (const skuId of engine.inventory.lotsBySku.keys()) {
      expect(engine.inventory.reservedQty(skuId)).toBeLessThanOrEqual(
        engine.inventory.onHand(skuId),
      );
    }
  });
});

describe('order and shipment consistency', () => {
  it('never picks more than the order asked for', () => {
    const engine = run(104, 3000);

    for (const order of engine.orders.values()) {
      for (const line of order.lines) {
        expect(line.pickedQty).toBeGreaterThanOrEqual(0);
        expect(line.pickedQty).toBeLessThanOrEqual(line.qty);
      }
      expect(order.accuracy).toBeGreaterThanOrEqual(0);
      expect(order.accuracy).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the order weight equal to what was actually picked', () => {
    const engine = run(105, 3000);
    const settled = ['packed', 'staged', 'shipped'];

    for (const order of engine.orders.values()) {
      if (!settled.includes(order.status)) continue;
      const expected = order.lines.reduce(
        (sum, line) => sum + line.pickedQty * engine.skuById.get(line.skuId)!.unitWeight,
        0,
      );
      expect(closeTo(order.weight, expected)).toBe(true);
    }
  });

  it('keeps every shipment equal to the orders it carries', () => {
    const engine = run(106, 3000);
    expect(engine.shipments.size).toBeGreaterThan(0);

    for (const shipment of engine.shipments.values()) {
      const orders = shipment.orderIds.map((id) => engine.orders.get(id));
      expect(orders.every((order) => order !== undefined)).toBe(true);

      const weight = orders.reduce((sum, order) => sum + (order?.weight ?? 0), 0);
      const volume = orders.reduce((sum, order) => sum + (order?.volume ?? 0), 0);
      const parcels = orders.reduce((sum, order) => sum + Math.max(1, order?.lines.length ?? 1), 0);

      expect(closeTo(shipment.weight, weight)).toBe(true);
      expect(closeTo(shipment.volume, volume)).toBe(true);
      expect(shipment.parcels).toBe(parcels);
    }
  });

  it('links every shipped order to a delivered shipment', () => {
    const engine = run(107, 3000);
    const shipped = [...engine.orders.values()].filter((order) => order.status === 'shipped');
    expect(shipped.length).toBeGreaterThan(0);

    for (const order of shipped) {
      expect(order.shipmentId).toBeTruthy();
      const shipment = engine.shipments.get(order.shipmentId!);
      expect(shipment).toBeDefined();
      expect(shipment!.status).toBe('delivered');
      expect(shipment!.orderIds).toContain(order.id);
    }
  });
});

describe('fleet and dock exclusivity', () => {
  it('never parks two vehicles at the same dock', () => {
    const engine = run(108, 3000);
    const byDock = new Map<string, number>();

    for (const vehicle of engine.vehicles) {
      if (!vehicle.dockId) continue;
      byDock.set(vehicle.dockId, (byDock.get(vehicle.dockId) ?? 0) + 1);
    }
    for (const count of byDock.values()) {
      expect(count).toBe(1);
    }
  });

  it('never occupies more docks than the facility has', () => {
    const engine = run(109, 3000);
    const occupied = engine.layout.docks.filter((dock) => dock.occupiedBy).length;
    expect(occupied).toBeLessThanOrEqual(engine.layout.docks.length);
  });
});

describe('workforce consistency', () => {
  it('keeps every active task attached to a busy assignee', () => {
    const engine = run(110, 3000);
    const busy = new Set<string>([
      ...engine.workers.filter((w) => w.busyTaskId).map((w) => w.busyTaskId!),
      ...engine.agvs.filter((a) => a.busyTaskId).map((a) => a.busyTaskId!),
    ]);

    for (const task of engine.tasks.values()) {
      if (task.status !== 'active' || !task.assignee) continue;
      expect(busy.has(task.id)).toBe(true);
    }
  });

  it('never leaves a worker or AGV holding a task that is no longer active', () => {
    const engine = run(111, 3000);
    const activeIds = new Set(
      [...engine.tasks.values()].filter((task) => task.status === 'active').map((task) => task.id),
    );

    for (const worker of engine.workers) {
      if (!worker.busyTaskId) continue;
      expect(activeIds.has(worker.busyTaskId)).toBe(true);
    }
    for (const agv of engine.agvs) {
      if (!agv.busyTaskId) continue;
      expect(activeIds.has(agv.busyTaskId)).toBe(true);
    }
  });
});

describe('wave integrity', () => {
  it('never references an order that does not exist', () => {
    const engine = run(112, 3000);

    for (const wave of engine.waves.values()) {
      for (const orderId of wave.orderIds) {
        expect(engine.orders.has(orderId)).toBe(true);
      }
    }
  });

  it('assigns every order to at most one wave', () => {
    const engine = run(113, 3000);
    const seen = new Set<string>();

    for (const wave of engine.waves.values()) {
      for (const orderId of wave.orderIds) {
        expect(seen.has(orderId)).toBe(false);
        seen.add(orderId);
      }
    }
  });
});

describe('simulation hygiene', () => {
  it('advances the clock monotonically', () => {
    const engine = boot(114);
    engine.setSpeed(4);
    let last = engine.simTime;

    for (let i = 0; i < 2000; i++) {
      engine.advance(0.05);
      expect(engine.simTime).toBeGreaterThanOrEqual(last);
      last = engine.simTime;
    }
  });

  it('keeps every KPI inside its valid range', () => {
    const engine = run(115, 3000);
    const kpi = engine.kpi;

    expect(kpi.warehouseUtilisation).toBeGreaterThanOrEqual(0);
    expect(kpi.warehouseUtilisation).toBeLessThanOrEqual(100);
    expect(kpi.pickAccuracy).toBeGreaterThanOrEqual(0);
    expect(kpi.pickAccuracy).toBeLessThanOrEqual(100);
    expect(kpi.onTimeDelivery).toBeGreaterThanOrEqual(0);
    expect(kpi.onTimeDelivery).toBeLessThanOrEqual(100);
    expect(kpi.openOrders).toBeGreaterThanOrEqual(0);
    expect(kpi.activeWorkers).toBeGreaterThanOrEqual(0);
    expect(kpi.activeWorkers).toBeLessThanOrEqual(engine.workers.length);
  });

  it('keeps pick accuracy in a realistic band instead of drifting down', () => {
    const engine = run(116, 4000);

    // Pick accuracy is the share of correctly handled pick lines, so it must stay in a
    // believable band no matter how many lines an order carries.
    expect(engine.kpi.pickAccuracy).toBeGreaterThan(90);
    expect(engine.kpi.pickAccuracy).toBeLessThanOrEqual(100);

    for (const order of engine.orders.values()) {
      expect(order.accuracy).toBeGreaterThanOrEqual(0);
      expect(order.accuracy).toBeLessThanOrEqual(1);
      expect(order.pickErrors).toBeLessThanOrEqual(order.pickCount);
    }
  });

  it('keeps the customer promise within what the operation can actually achieve', () => {
    const engine = run(117, 4000);

    // The express promise (600 min) has to be reachable, otherwise on-time delivery
    // stops being a performance signal and becomes a structural impossibility.
    expect(engine.kpi.orderCycleMinutes).toBeLessThan(600);
    expect(engine.kpi.onTimeDelivery).toBeGreaterThan(80);
    expect(engine.kpi.onTimeDelivery).toBeLessThanOrEqual(100);
  });
});
