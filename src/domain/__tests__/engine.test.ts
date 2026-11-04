import { describe, expect, it } from 'vitest';
import { SimulationEngine } from '../engine';
import { Inventory } from '../inventory';
import { optimizePickPath, pathLength, selectWaveOrders, waveCode } from '../picking';
import { buildLayout } from '../layout';
import { buildCatalog } from '../catalog';
import { Rng } from '../../core/rng';

function boot(seed = 42): SimulationEngine {
  const engine = new SimulationEngine(seed);
  engine.bootstrap();
  return engine;
}

describe('random generator', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const left = Array.from({ length: 20 }, () => a.next());
    const right = Array.from({ length: 20 }, () => b.next());
    expect(left).toEqual(right);
  });

  it('produces values inside [0, 1)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 500; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('respects weight ranges', () => {
    const rng = new Rng(99);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 200; i++) {
      expect(items).toContain(rng.weighted(items, [1, 2, 3]));
    }
  });
});

describe('warehouse layout', () => {
  it('produces unique, well formed locations', () => {
    const layout = buildLayout(new Rng(5));
    const ids = [...layout.locations.keys()];
    expect(new Set(ids).size).toBe(ids.length);
    expect(layout.locations.size).toBeGreaterThan(1500);

    for (const loc of layout.locations.values()) {
      expect(loc.maxWeight).toBeGreaterThan(0);
      expect(loc.maxVolume).toBeGreaterThan(0);
      expect(loc.utilisation).toBeGreaterThanOrEqual(0);
      expect(loc.utilisation).toBeLessThanOrEqual(1);
      expect(Number.isFinite(loc.x)).toBe(true);
      expect(Number.isFinite(loc.z)).toBe(true);
    }
  });

  it('keeps racks inside the building envelope', () => {
    const layout = buildLayout(new Rng(5));
    for (const rack of layout.racks) {
      expect(rack.startX).toBeGreaterThanOrEqual(layout.bounds.minX);
      expect(rack.endX).toBeLessThanOrEqual(layout.bounds.maxX);
      expect(rack.z).toBeGreaterThanOrEqual(layout.bounds.minZ);
      expect(rack.z).toBeLessThanOrEqual(layout.bounds.maxZ);
    }
  });

  it('exposes both inbound and outbound docks', () => {
    const layout = buildLayout(new Rng(5));
    expect(layout.docks.filter((d) => d.kind === 'inbound').length).toBeGreaterThan(0);
    expect(layout.docks.filter((d) => d.kind === 'outbound').length).toBeGreaterThan(0);
  });
});

describe('inventory ledger', () => {
  const skus = buildCatalog(new Rng(3), 40);

  it('keeps lot quantities consistent with the per-location tally', () => {
    const inventory = new Inventory(skus);
    const sku = skus[0]!;
    inventory.receive(sku.id, 'L-1', 100, 'PO-1', 0);
    inventory.receive(sku.id, 'L-1', 50, 'PO-1', 0);
    inventory.receive(sku.id, 'L-2', 20, 'PO-1', 0);

    expect(inventory.onHand(sku.id)).toBe(170);
    expect(inventory.locationWeight('L-1')).toBeCloseTo(150 * sku.unitWeight, 4);
    expect(inventory.locationWeight('L-2')).toBeCloseTo(20 * sku.unitWeight, 4);
  });

  it('never removes more than it holds', () => {
    const inventory = new Inventory(skus);
    const sku = skus[1]!;
    inventory.receive(sku.id, 'L-1', 10, 'PO-1', 0);
    const removed = inventory.remove('L-1', sku, 999, 'PICK', 0);
    expect(removed).toBe(10);
    expect(inventory.onHand(sku.id)).toBe(0);
    expect(inventory.locationWeight('L-1')).toBe(0);
  });

  it('conserves quantity across a transfer', () => {
    const inventory = new Inventory(skus);
    const sku = skus[2]!;
    inventory.receive(sku.id, 'L-1', 80, 'PO-1', 0);
    const moved = inventory.transfer(sku.id, 'L-1', 'L-2', 30, 'PUT', 0);
    expect(moved).toBe(30);
    expect(inventory.onHand(sku.id)).toBe(80);
    expect(inventory.locationWeight('L-2')).toBeCloseTo(30 * sku.unitWeight, 4);
  });

  it('tracks reservations without inflating on-hand', () => {
    const inventory = new Inventory(skus);
    const sku = skus[3]!;
    inventory.receive(sku.id, 'L-1', 40, 'PO-1', 0);
    const allocations = inventory.allocate(sku.id, 25, new Set(['L-1']));
    expect(allocations.reduce((s, a) => s + a.qty, 0)).toBe(25);
    expect(inventory.onHand(sku.id)).toBe(40);
    expect(inventory.available(sku.id)).toBe(15);
    inventory.releaseReservations(allocations);
    expect(inventory.available(sku.id)).toBe(40);
  });

  it('records a movement trail for every change', () => {
    const inventory = new Inventory(skus);
    const sku = skus[4]!;
    inventory.receive(sku.id, 'L-1', 5, 'PO-1', 0);
    inventory.remove('L-1', sku, 5, 'PICK', 1);
    expect(inventory.movements.length).toBeGreaterThanOrEqual(2);
    expect(inventory.movements.at(-1)?.kind).toBe('pick');
  });
});

describe('pick path optimisation', () => {
  const layout = buildLayout(new Rng(11));

  it('visits every bin exactly once', () => {
    const ids = ['A-01-001-1', 'A-01-002-2', 'B-02-003-1', 'C-01-001-3', 'A-03-004-2'];
    const bins = ids.map((id) => layout.locations.get(id)!).filter(Boolean);
    const path = optimizePickPath(bins);
    expect(path.length).toBe(bins.length);
    expect(new Set(path.map((l) => l.id)).size).toBe(bins.length);
  });

  it('groups the fast-mover zone first', () => {
    const bins = [
      layout.locations.get('A-01-001-1')!,
      layout.locations.get('B-01-001-1')!,
    ];
    const path = optimizePickPath(bins);
    expect(path[0]!.zoneId).toBe('B');
  });

  it('measures a finite walking distance', () => {
    const bins = [
      layout.locations.get('A-01-001-1')!,
      layout.locations.get('A-01-009-3')!,
    ];
    const path = optimizePickPath(bins);
    expect(pathLength(path)).toBeGreaterThan(0);
    expect(Number.isFinite(pathLength(path))).toBe(true);
  });
});

describe('wave planning', () => {
  it('honours the order cap', () => {
    const engine = boot(21);
    const orders = engine.orderList().slice(0, 12);
    const wave = selectWaveOrders(orders, 5);
    expect(wave.length).toBeLessThanOrEqual(5);
  });

  it('formats wave codes from the simulation clock', () => {
    expect(waveCode(0, 3)).toMatch(/^WV-\d{6}-\d{2}$/);
    expect(waveCode(1440, 1)).toMatch(/^WV-\d{6}-\d{2}$/);
  });
});

describe('simulation engine', () => {
  it('bootstraps a consistent world', () => {
    const engine = boot(7);
    expect(engine.layout.locations.size).toBeGreaterThan(1500);
    expect(engine.skus.length).toBe(1400);
    expect(engine.workers.length).toBe(28);
    expect(engine.vehicles.length).toBeGreaterThan(0);
    expect(engine.inventory.totalUnits()).toBeGreaterThan(0);
    expect(engine.kpi.warehouseUtilisation).toBeGreaterThan(0);
    expect(engine.kpi.warehouseUtilisation).toBeLessThanOrEqual(100);
  });

  it('is deterministic for the same seed', () => {
    const a = boot(555);
    const b = boot(555);
    expect(a.inventory.totalUnits()).toBe(b.inventory.totalUnits());
    expect(a.orders.size).toBe(b.orders.size);
    expect(a.layout.locations.size).toBe(b.layout.locations.size);
    expect(a.skus[10]!.id).toBe(b.skus[10]!.id);
  });

  it('advances the clock and produces work', () => {
    const engine = boot(3);
    engine.setSpeed(1);
    const start = engine.simTime;
    for (let i = 0; i < 240; i++) engine.advance(0.05);
    expect(engine.simTime).toBeGreaterThan(start);
    expect(engine.orders.size).toBeGreaterThan(0);
    expect(engine.waves.size).toBeGreaterThan(0);
  });

  it('runs the full order lifecycle end to end', () => {
    const engine = boot(9);
    engine.setSpeed(4);
    for (let i = 0; i < 4000; i++) engine.advance(0.05);

    const statuses = new Set([...engine.orders.values()].map((o) => o.status));
    expect(statuses.has('picking')).toBe(true);
    expect(statuses.has('shipped')).toBe(true);
    expect(engine.shipments.size).toBeGreaterThan(0);
    expect([...engine.shipments.values()].some((s) => s.status === 'delivered')).toBe(true);
  });

  it('never lets a shipment exceed its vehicle capacity', () => {
    const engine = boot(13);
    engine.setSpeed(4);
    for (let i = 0; i < 2500; i++) engine.advance(0.05);
    for (const shipment of engine.shipments.values()) {
      const vehicle = engine.vehicles.find((v) => v.id === shipment.vehicleId);
      if (!vehicle) continue;
      expect(shipment.weight).toBeLessThanOrEqual(vehicle.capacityWeight * 1.0001);
    }
  });

  it('keeps every tracked location inside its own capacity', () => {
    const engine = boot(17);
    engine.setSpeed(4);
    for (let i = 0; i < 1500; i++) engine.advance(0.05);
    for (const loc of engine.layout.locations.values()) {
      const weight = engine.inventory.locationWeight(loc.id);
      expect(weight).toBeLessThanOrEqual(loc.maxWeight * 1.05);
      expect(weight).toBeGreaterThanOrEqual(0);
    }
  });

  it('never assigns the same truck to two shipments at once', () => {
    const engine = boot(23);
    engine.setSpeed(4);
    for (let i = 0; i < 2500; i++) engine.advance(0.05);
    const active = new Map<string, string>();
    for (const shipment of engine.shipments.values()) {
      if (!shipment.vehicleId) continue;
      if (shipment.status === 'delivered') continue;
      const existing = active.get(shipment.vehicleId);
      expect(existing ?? shipment.id).toBe(shipment.id);
      active.set(shipment.vehicleId, shipment.id);
    }
  });

  it('releases the docks it occupies', () => {
    const engine = boot(29);
    engine.setSpeed(4);
    for (let i = 0; i < 2500; i++) engine.advance(0.05);
    for (const dock of engine.layout.docks) {
      if (dock.occupiedBy) {
        const known =
          engine.asns.some((a) => a.id === dock.occupiedBy) ||
          engine.shipments.has(dock.occupiedBy);
        expect(known).toBe(true);
      }
    }
  });

  it('exposes the eight process stages through the inspector contract', async () => {
    const engine = boot(31);
    const { buildStages } = await import('../../ui/inspector');
    const stages = buildStages(engine);
    expect(stages.length).toBe(8);
    expect(stages.map((s) => s.key)).toEqual([
      'receive',
      'putaway',
      'storage',
      'wave',
      'pick',
      'pack',
      'load',
      'transport',
    ]);
  });
});
