import { Emitter } from '../core/events';
import { localize, msg, t, type Message } from '../core/i18n';
import { Rng } from '../core/rng';
import {
  buildCatalog,
  buildCustomerZones,
  CARRIERS,
  CUSTOMERS,
  SUPPLIERS,
} from './catalog';
import { Inventory, type Allocation } from './inventory';
import { buildLayout, type WarehouseLayout } from './layout';
import { customerZoneName, skuName } from './labels';
import { optimizePickPath, selectWaveOrders, waveCode } from './picking';
import { buildAgvs, buildWorkers, YARD_ROUTES } from './resources';
import type {
  Agv,
  Alert,
  AsRecord,
  KpiSnapshot,
  Location,
  Order,
  OrderLine,
  Priority,
  Shipment,
  Task,
  TaskKind,
  Vehicle,
  Worker,
} from './types';

export type SelectionKind = 'none' | 'location' | 'order' | 'wave' | 'shipment' | 'task' | 'sku';

export interface Selection {
  kind: SelectionKind;
  id: string;
}

export type EngineEvents = {
  tick: { simMinutes: number; dtSim: number };
  changed: number;
  alert: Alert;
  selection: Selection;
  toast: { text: string; level: 'ok' | 'warn' | 'info' | 'danger' };
};

interface Op {
  task: Task;
  kind: TaskKind;
  workerId: string | null;
  agvId: string | null;
  phase: 'travel' | 'work';
  targetX: number;
  targetZ: number;
  durationMin: number;
  elapsed: number;
  /** Travel leg counter for AGV jobs (0 = pickup, 1 = drop-off). */
  leg?: number;
  orderId?: string;
  skuId?: string;
  qty?: number;
  locationId?: string | null;
  allocations?: Allocation[];
  stageLocationId?: string;
  meta?: Record<string, string | number>;
}

const MINUTES_PER_SECOND = 1.5;
const EPOCH = Date.UTC(2024, 0, 1, 6, 0, 0);
const WORKER_SPEED = 48; // metres per simulated minute (aisle walking)
const AGV_SPEED = 62;
const YARD_SPEED = 34; // metres per simulated minute inside the yard

/**
 * Customer promise windows, in simulated minutes.
 *
 * Calibrated against the facility's achievable order cycle (roughly four to five
 * hours end to end): a promise the operation can actually keep is what makes the
 * on-time KPI meaningful. Express and critical orders are still tight enough that a
 * backlog produces genuine late deliveries.
 */
const PRIORITY_DUE_OFFSET: Record<Priority, number> = {
  standard: 1440,
  express: 600,
  critical: 300,
};

export class SimulationEngine {
  readonly events = new Emitter<EngineEvents>();
  readonly rng: Rng;

  layout!: WarehouseLayout;
  skus!: ReturnType<typeof buildCatalog>;
  skuById = new Map<string, (typeof this.skus)[number]>();
  customers = buildCustomerZones(new Rng(7));
  inventory!: Inventory;
  workers: Worker[] = [];
  agvs: Agv[] = [];
  vehicles: Vehicle[] = [];
  orders = new Map<string, Order>();
  waves = new Map<string, import('./types').Wave>();
  tasks = new Map<string, Task>();
  taskSequence = new Map<string, number>();
  shipments = new Map<string, Shipment>();
  asns: AsRecord[] = [];
  alerts: Alert[] = [];

  simTime = 360;
  speed = 4;
  private ops = new Map<string, Op>();
  private orderAllocations = new Map<string, Allocation[]>();
  private pickerQueues = new Map<string, string[]>();
  private packerQueues = new Map<string, string[]>();
  private receiverQueues = new Map<string, string[]>();
  private loaderQueues = new Map<string, string[]>();
  /** Put-away / replenishment jobs waiting for a free AGV. */
  private agvQueue: string[] = [];
  private putawayCandidates = new Map<string, string[]>();
  private sellableSkus: string[] = [];
  private nextOrderAt = 0;
  private nextWaveAt = 0;
  private nextShipmentAt = 0;
  private nextReplenishAt = 0;
  private nextCycleCountAt = 0;
  private waveIndex = 0;
  private taskCounter = 0;
  private changeCounter = 0;
  private lastStatsAt = 0;
  private shippedOrders: Array<{ at: number; onTime: boolean; cycle: number; accuracy: number }> = [];
  private deliveredOrders: Array<{ at: number; onTime: boolean; cycle: number; accuracy: number }> = [];
  private totalCo2Kg = 0;
  private alertSeq = 0;

  selection: Selection = { kind: 'none', id: '' };
  kpi: KpiSnapshot = {
    timestamp: 0,
    throughputPerHour: 0,
    pickAccuracy: 98.4,
    onTimeDelivery: 96.2,
    warehouseUtilisation: 0,
    inventoryTurnover: 0,
    orderCycleMinutes: 0,
    dockUtilisation: 0,
    fleetUtilisation: 0,
    co2Tonnes: 0,
    openOrders: 0,
    activeWorkers: 0,
    backlogDays: 0,
  };
  history: { label: string; time: number; throughput: number; utilisation: number; accuracy: number }[] = [];

  constructor(seed = 20240101) {
    this.rng = new Rng(seed);
  }

  /* =================================================================== */
  /* Bootstrap                                                            */
  /* =================================================================== */

  bootstrap(): void {
    this.layout = buildLayout(this.rng);
    this.skus = buildCatalog(this.rng, 1400);
    this.skuById = new Map(this.skus.map((s) => [s.id, s]));
    this.inventory = new Inventory(this.skus);
    this.workers = buildWorkers(this.rng, 28);
    this.agvs = buildAgvs(this.rng, 10);
    this.buildFleet();
    this.buildPutawayIndex();
    this.seedInventory();
    this.seedAsns();
    this.seedOrders();
    this.refreshSellableSkus();
    this.recomputeUtilisation();
    this.kpi = this.computeKpis();
    this.events.emit('changed', this.changeCounter);
  }

  private buildPutawayIndex(): void {
    const byZone = new Map<string, string[]>();
    for (const loc of this.layout.locations.values()) {
      if (!loc.palletPosition) continue;
      if (!byZone.has(loc.zoneId)) byZone.set(loc.zoneId, []);
      byZone.get(loc.zoneId)!.push(loc.id);
    }
    for (const [zone, ids] of byZone) {
      // Prefer ground level (cheapest handling) then aisle order.
      ids.sort((a, b) => {
        const la = this.layout.locations.get(a)!;
        const lb = this.layout.locations.get(b)!;
        return la.level - lb.level || la.row - lb.row || la.bay - lb.bay;
      });
      this.putawayCandidates.set(zone, ids);
    }
  }

  private seedInventory(): void {
    const targetUtilisation = 0.66;
    const capacity = [...this.layout.locations.values()].reduce((s, l) => s + l.maxWeight, 0);
    const targetWeight = capacity * targetUtilisation;
    let placed = 0;
    const rackLocations = [...this.layout.locations.values()].filter((l) => l.palletPosition);

    for (const loc of rackLocations) {
      if (placed >= targetWeight) break;
      const occupancy = this.rng.next();
      if (occupancy > 0.86) continue;

      const skuCount = occupancy > 0.5 ? this.rng.int(1, 3) : 1;
      for (let i = 0; i < skuCount; i++) {
        const sku = this.skus[this.rng.int(0, this.skus.length - 1)]!;
        if (sku.tempZone !== loc.tempZone) continue;
        // Keep a single SKU batch inside the location's weight capacity.
        const maxUnits = Math.floor((loc.maxWeight * 0.55) / Math.max(0.05, sku.unitWeight));
        const qty = Math.max(4, Math.min(this.rng.int(24, 260), maxUnits));
        const weight = qty * sku.unitWeight;
        if (this.inventory.locationWeight(loc.id) + weight > loc.maxWeight) continue;
        this.inventory.receive(sku.id, loc.id, qty, 'OPENING', 0);
        placed += weight;
      }
    }
    this.recomputeUtilisation();
  }

  private buildFleet(): void {
    const kinds: Vehicle['kind'][] = ['box', 'box', 'box', 'reefer', 'reefer', 'van', 'van', 'flatbed', 'container', 'box'];
    const drivers = this.workers.filter((w) => w.role === 'driver');
    kinds.forEach((kind, i) => {
      const capWeight = kind === 'container' ? 24000 : kind === 'flatbed' ? 12000 : kind === 'box' ? 9000 : kind === 'reefer' ? 7000 : 2600;
      const capVolume = kind === 'container' ? 76 : kind === 'flatbed' ? 40 : kind === 'box' ? 32 : kind === 'reefer' ? 24 : 9;
      this.vehicles.push({
        id: `VEH-${String(i + 1).padStart(2, '0')}`,
        plate: `R${String(this.rng.int(1000, 9999))}-${this.rng.pick(['AB', 'CD', 'EF', 'GH'])}`,
        kind,
        capacityWeight: capWeight,
        capacityVolume: capVolume,
        status: 'idle',
        driver: drivers[i % Math.max(1, drivers.length)]?.name ?? '',
        shipmentId: null,
        dockId: null,
        x: 110,
        z: 6,
        rotation: 0,
        legProgress: 0,
        legLength: 0,
        speedKmh: 0,
        load: 0,
        odometer: 0,
        co2Kg: 0,
        etaMinutes: 0,
        route: [],
        routeIdx: 0,
        yardPhase: 'none',
        roadProgress: 0,
        roadDistanceKm: 0,
        roadSpeedKmh: 0,
        roadRemainingKm: 0,
        refrigerated: kind === 'reefer',
        destination: '',
        destinationEn: '',
      });
    });
  }

  private seedAsns(): void {
    for (let i = 0; i < 6; i++) {
      this.createAsn(this.rng.int(20, 900));
    }
  }

  private seedOrders(): void {
    for (let i = 0; i < 28; i++) {
      this.createOrder(Math.max(0, this.simTime - this.rng.int(10, 400)));
    }
  }

  /* =================================================================== */
  /* Public API                                                           */
  /* =================================================================== */

  advance(realDtSeconds: number): void {
    if (this.speed === 0) return;
    const dtSim = Math.min(6, realDtSeconds) * MINUTES_PER_SECOND * this.speed;
    this.step(dtSim);
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  select(kind: SelectionKind, id: string): void {
    this.selection = { kind, id };
    this.events.emit('selection', this.selection);
    this.events.emit('changed', this.changeCounter);
  }

  /* =================================================================== */
  /* Simulation step                                                      */
  /* =================================================================== */

  private step(dt: number): void {
    if (dt <= 0) return;
    this.simTime += dt;

    this.processOrderArrivals();
    this.processAsnArrivals();
    this.processVehicles(dt);
    this.processOps(dt);
    this.processWavePlanning();
    this.processShipping();
    this.processReplenishment();
    this.processCycleCount();
    this.updateWorkerUtilisation();
    this.recomputeUtilisation();

    if (this.simTime - this.lastStatsAt >= 30) {
      this.lastStatsAt = this.simTime;
      this.recordHistory();
    }

    this.kpi = this.computeKpis();
    this.events.emit('tick', { simMinutes: this.simTime, dtSim: dt });
    this.events.emit('changed', ++this.changeCounter);
  }

  /* ------------------------------------------------------------- orders */

  private processOrderArrivals(): void {
    while (this.simTime >= this.nextOrderAt) {
      this.createOrder(this.simTime);
      this.nextOrderAt = this.simTime + this.rng.float(2.5, 7);
    }
  }

  private createOrder(createdAt: number): Order | null {
    if (this.sellableSkus.length === 0) {
      this.refreshSellableSkus();
      if (this.sellableSkus.length === 0) return null;
    }

    const priority: Priority = this.rng.weighted(
      ['standard', 'express', 'critical'],
      [72, 22, 6],
    );
    const lineCount = this.rng.int(1, 5);
    const lines: OrderLine[] = [];
    const allocations: Allocation[] = [];
    const used = new Set<string>();

    for (let i = 0; i < lineCount; i++) {
      const skuId = this.rng.pick(this.sellableSkus);
      if (used.has(skuId)) continue;
      const sku = this.skuById.get(skuId)!;
      const qty = this.rng.int(1, priority === 'standard' ? 24 : 10);
      const alloc = this.inventory.allocate(skuId, qty, this.pickableLocationIds);
      if (alloc.length === 0) continue;
      const first = alloc[0]!;
      used.add(skuId);
      lines.push({
        skuId,
        qty: first.qty,
        pickedQty: 0,
        locationId: first.locationId,
        unitPrice: sku.unitPrice,
      });
      allocations.push(...alloc);
    }

    if (lines.length === 0) return null;

    const id = `SO-${String(this.orderSeq++).padStart(6, '0')}`;
    const customer = this.rng.pick(CUSTOMERS);
    const order: Order = {
      id,
      customer: customer.name,
      customerEn: customer.nameEn,
      channel: this.rng.weighted(['B2B', 'B2C', 'XBorder', 'Replenish'], [34, 46, 12, 8]),
      priority,
      status: 'released',
      createdAt,
      dueAt: createdAt + PRIORITY_DUE_OFFSET[priority] * this.rng.float(0.85, 1.25),
      lines,
      waveId: null,
      shipmentId: null,
      parcelCount: 0,
      weight: lines.reduce((s, l) => s + l.qty * this.skuById.get(l.skuId)!.unitWeight, 0),
      volume: lines.reduce((s, l) => s + l.qty * this.skuById.get(l.skuId)!.unitVolume, 0),
      accuracy: 1,
      pickCount: 0,
      pickErrors: 0,
      note: '',
    };

    this.orders.set(id, order);
    this.orderAllocations.set(id, allocations);
    this.refreshSellableSkus();
    return order;
  }

  private orderSeq = 1;

  private pickableLocationIds = new Set<string>();

  private refreshSellableSkus(): void {
    this.pickableLocationIds = new Set(this.layout.locations.keys());
    const list: string[] = [];
    for (const sku of this.skus) {
      if (this.inventory.available(sku.id) > 40) list.push(sku.id);
    }
    // Fast movers dominate the demand mix.
    this.sellableSkus = list.length ? list : this.skus.map((s) => s.id);
  }

  /* --------------------------------------------------------------- ASNs */

  private createAsn(eta: number): AsRecord {
    const supplier = this.rng.pick(SUPPLIERS);
    const lineCount = this.rng.int(2, 6);
    const lines = [];
    let weight = 0;
    for (let i = 0; i < lineCount; i++) {
      const sku = this.skus[this.rng.int(0, this.skus.length - 1)]!;
      const qty = this.rng.int(120, 1400);
      weight += qty * sku.unitWeight;
      lines.push({ skuId: sku.id, qty, receivedQty: 0 });
    }
    const id = `ASN-${String(this.asnSeq++).padStart(5, '0')}`;
    const asn: AsRecord = {
      id,
      supplier: supplier.name,
      supplierEn: supplier.nameEn,
      poNo: `PO${this.rng.int(100000, 999999)}`,
      status: 'scheduled',
      eta,
      arrivedAt: null,
      dockId: null,
      lines,
      pallets: this.rng.int(4, 16),
      priority: this.rng.weighted(['standard', 'express', 'critical'], [70, 24, 6]),
      totalWeight: weight,
    };
    this.asns.push(asn);
    this.asns.sort((a, b) => a.eta - b.eta);
    return asn;
  }

  private asnSeq = 1;

  private processAsnArrivals(): void {
    for (const asn of this.asns) {
      if (asn.status !== 'scheduled' || this.simTime < asn.eta) continue;
      const dock = this.findFreeDock('inbound');
      if (!dock) {
        if (!this.alertedRecently(`dock-${asn.id}`)) {
          this.pushAlert('warn', msg('進貨月台滿載'), msg('{0} 等待卸貨月台，ETA 已延後', asn.id), 'S');
        }
        continue;
      }
      const vehicle = this.vehicles.find((v) => v.status === 'idle' && v.yardPhase === 'none');
      if (!vehicle) continue;

      asn.status = 'arrived';
      asn.dockId = dock.id;
      asn.arrivedAt = this.simTime;
      dock.occupiedBy = asn.id;
      vehicle.status = 'idle';
      vehicle.dockId = dock.id;
      vehicle.route = YARD_ROUTES.inbound(dock.x);
      vehicle.routeIdx = 0;
      vehicle.yardPhase = 'toDock';
      vehicle.x = vehicle.route[0]![0];
      vehicle.z = vehicle.route[0]![1];
      vehicle.rotation = -Math.PI / 2;
      vehicle.destination = `${asn.supplier} · ${asn.id}`;
      vehicle.destinationEn = `${asn.supplierEn} · ${asn.id}`;
    }
  }

  /* -------------------------------------------------------------- fleet */

  private processVehicles(dt: number): void {
    for (const vehicle of this.vehicles) {
      switch (vehicle.yardPhase) {
        case 'toDock':
        case 'toGate': {
          const target = vehicle.route[vehicle.routeIdx];
          if (!target) {
            this.completeYardLeg(vehicle);
            break;
          }
          const dx = target[0] - vehicle.x;
          const dz = target[1] - vehicle.z;
          const dist = Math.hypot(dx, dz);
          if (dist < 1.2) {
            vehicle.routeIdx++;
            if (vehicle.routeIdx >= vehicle.route.length) this.completeYardLeg(vehicle);
            break;
          }
          const step = Math.min(dist, YARD_SPEED * dt);
          vehicle.x += (dx / dist) * step;
          vehicle.z += (dz / dist) * step;
          vehicle.rotation = Math.atan2(-dz, dx);
          break;
        }
        default:
          break;
      }

      // Highway leg is simulated numerically (the yard animation ends at the gate).
      if (vehicle.status === 'enroute' || vehicle.status === 'delivering') {
        const speed = vehicle.roadSpeedKmh || 62;
        const kmPerMin = speed / 60;
        vehicle.roadProgress += (kmPerMin * dt) / Math.max(1, vehicle.roadDistanceKm);
        vehicle.roadRemainingKm = Math.max(0, vehicle.roadDistanceKm * (1 - vehicle.roadProgress));
        vehicle.etaMinutes = (vehicle.roadRemainingKm / speed) * 60;
        vehicle.co2Kg += (kmPerMin * dt) * (vehicle.refrigerated ? 1.35 : 0.92);
        this.totalCo2Kg += (kmPerMin * dt) * (vehicle.refrigerated ? 1.35 : 0.92);
        vehicle.odometer += kmPerMin * dt;

        if (vehicle.status === 'enroute' && vehicle.roadProgress >= 0.55) {
          vehicle.status = 'delivering';
        }
        if (vehicle.roadProgress >= 1) {
          this.onVehicleArrived(vehicle);
        }
      } else if (vehicle.status === 'returning') {
        if (vehicle.roadDistanceKm <= 0) {
          // Yardside repositioning (no highway leg) — park the unit.
          this.onVehicleHome(vehicle);
          continue;
        }
        const speed = vehicle.roadSpeedKmh || 62;
        const kmPerMin = speed / 60;
        vehicle.roadProgress += (kmPerMin * dt) / Math.max(1, vehicle.roadDistanceKm);
        vehicle.roadRemainingKm = Math.max(0, vehicle.roadDistanceKm * (1 - vehicle.roadProgress));
        vehicle.etaMinutes = (vehicle.roadRemainingKm / speed) * 60;
        vehicle.co2Kg += (kmPerMin * dt) * (vehicle.refrigerated ? 1.35 : 0.92);
        this.totalCo2Kg += (kmPerMin * dt) * (vehicle.refrigerated ? 1.35 : 0.92);
        vehicle.odometer += kmPerMin * dt;
        if (vehicle.roadProgress >= 1) {
          this.onVehicleHome(vehicle);
        }
      }

      if (vehicle.status === 'loading') {
        vehicle.load = Math.min(1, vehicle.load + dt / Math.max(1, this.loadingMinutesFor(vehicle)));
      }
    }
  }

  private loadingMinutesFor(vehicle: Vehicle): number {
    const shipment = vehicle.shipmentId ? this.shipments.get(vehicle.shipmentId) : null;
    if (!shipment) return 20;
    return Math.max(12, shipment.parcels * 0.9);
  }

  private completeYardLeg(vehicle: Vehicle): void {
    if (vehicle.yardPhase === 'toDock') {
      vehicle.yardPhase = 'none';
      vehicle.status = 'unloading';
      const asn = this.asns.find((a) => a.dockId === vehicle.dockId);
      if (asn) {
        asn.status = 'receiving';
        this.scheduleReceiving(asn);
      }
      vehicle.rotation = Math.PI / 2;
      return;
    }
    // toGate finished
    vehicle.yardPhase = 'none';
    const shipment = vehicle.shipmentId ? this.shipments.get(vehicle.shipmentId) : null;
    if (shipment && shipment.status === 'sealed') {
      shipment.status = 'enroute';
      shipment.departAt = this.simTime;
      vehicle.status = 'enroute';
      vehicle.speedKmh = vehicle.roadSpeedKmh;
      const dock = this.layout.docks.find((d) => d.id === shipment.dockId);
      if (dock) dock.occupiedBy = undefined;
      vehicle.dockId = null;
    } else {
      vehicle.status = 'idle';
      vehicle.dockId = null;
      vehicle.shipmentId = null;
      vehicle.destination = '';
      vehicle.destinationEn = '';
      vehicle.x = 108;
      vehicle.z = 6;
    }
  }

  private onVehicleArrived(vehicle: Vehicle): void {
    const shipment = vehicle.shipmentId ? this.shipments.get(vehicle.shipmentId) : null;
    if (shipment) {
      shipment.status = 'delivered';
      shipment.deliverAt = this.simTime;
      for (const orderId of shipment.orderIds) {
        const order = this.orders.get(orderId);
        if (!order) continue;
        order.status = 'shipped';
        const onTime = this.simTime <= order.dueAt;
        this.shippedOrders.push({ at: this.simTime, onTime, cycle: this.simTime - order.createdAt, accuracy: order.accuracy });
        this.deliveredOrders.push({ at: this.simTime, onTime, cycle: this.simTime - order.createdAt, accuracy: order.accuracy });
      }
    }
    vehicle.status = 'returning';
    vehicle.roadProgress = 0;
    vehicle.roadRemainingKm = vehicle.roadDistanceKm;
    vehicle.destination = '';
    vehicle.destinationEn = '';
  }

  /** Vehicle completed the return leg and is available for the next job. */
  private onVehicleHome(vehicle: Vehicle): void {
    vehicle.status = 'idle';
    vehicle.roadProgress = 0;
    vehicle.roadRemainingKm = 0;
    vehicle.etaMinutes = 0;
    vehicle.load = 0;
    vehicle.shipmentId = null;
    vehicle.dockId = null;
    vehicle.destination = '';
    vehicle.destinationEn = '';
    vehicle.x = 108;
    vehicle.z = 6;
    vehicle.rotation = 0;
    vehicle.yardPhase = 'none';
  }

  /* ---------------------------------------------------------- receiving */

  /**
   * Break a receipt into packages that fit the inbound staging positions.
   * A single ASN line can exceed one staging slot, so quantities are split
   * across as many positions as required and each becomes its own task.
   */
  private scheduleReceiving(asn: AsRecord): void {
    const receivers = this.workers.filter((w) => w.role === 'receiver');
    const stagingIds = [...this.layout.locations.values()]
      .filter((l) => l.zoneId === 'S')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((l) => l.id);
    if (stagingIds.length === 0) return;

    const weightRoom = new Map<string, number>();
    const volumeRoom = new Map<string, number>();
    for (const id of stagingIds) {
      const loc = this.layout.locations.get(id)!;
      weightRoom.set(id, loc.maxWeight - this.inventory.locationWeight(id));
      volumeRoom.set(id, loc.maxVolume - this.inventory.locationVolume(id));
    }

    const packages: Array<{ skuId: string; qty: number; stagingId: string }> = [];
    for (const line of asn.lines) {
      const sku = this.skuById.get(line.skuId);
      if (!sku) continue;
      let remaining = line.qty;
      let cursor = 0;
      while (remaining > 0 && cursor < stagingIds.length * 3) {
        const id = stagingIds[cursor % stagingIds.length]!;
        const wRoom = weightRoom.get(id)!;
        const vRoom = volumeRoom.get(id)!;
        const byWeight = Math.floor(wRoom / Math.max(0.01, sku.unitWeight));
        const byVolume = Math.floor(vRoom / Math.max(0.0001, sku.unitVolume));
        const take = Math.min(remaining, byWeight, byVolume);
        if (take <= 0) {
          cursor++;
          continue;
        }
        packages.push({ skuId: line.skuId, qty: take, stagingId: id });
        weightRoom.set(id, wRoom - take * sku.unitWeight);
        volumeRoom.set(id, vRoom - take * sku.unitVolume);
        remaining -= take;
        cursor++;
      }
      if (remaining > 0) {
        this.pushAlert(
          'warn',
          msg('進貨暫存區容量不足'),
          msg(
            '{0} 有 {1} 件 {2} 暫時無法卸貨，已轉入溢區待處理',
            asn.id,
            remaining,
            () => skuName(sku),
          ),
          'S',
        );
      }
    }

    // One receiving task per staging position.
    const byStaging = new Map<string, Array<{ skuId: string; qty: number }>>();
    for (const pack of packages) {
      if (!byStaging.has(pack.stagingId)) byStaging.set(pack.stagingId, []);
      byStaging.get(pack.stagingId)!.push({ skuId: pack.skuId, qty: pack.qty });
    }

    const groups: Array<{ stagingId: string; lines: Array<{ skuId: string; qty: number }> }> = [];
    for (const [stagingId, lines] of byStaging) {
      groups.push({ stagingId, lines });
    }

    for (const group of groups) {
      const receiver = receivers[this.rng.int(0, Math.max(0, receivers.length - 1))];
      const totalQty = group.lines.reduce((s, l) => s + l.qty, 0);
      const task = this.createTask(
        'receive',
        asn.id,
        group.stagingId,
        group.lines[0]!.skuId,
        totalQty,
        receiver?.id ?? null,
        'standard',
      );
      task.label = msg('{0} 卸貨 · {1}', asn.id, () => localize(asn.supplier, asn.supplierEn));
      task.meta = { asn: asn.id, lines: group.lines.length, staging: group.stagingId };
      if (receiver) this.pushToQueue(this.receiverQueues, receiver.id, task.id);
    }

    this.pendingReceipts.set(asn.id, groups);
    asn.status = 'receiving';
  }

  private pendingReceipts = new Map<
    string,
    Array<{ stagingId: string; lines: Array<{ skuId: string; qty: number }> }>
  >();

  /* ------------------------------------------------------------- waves */

  private processWavePlanning(): void {
    if (this.simTime < this.nextWaveAt) return;
    this.nextWaveAt = this.simTime + 6;

    const releasable = [...this.orders.values()].filter((o) => o.status === 'released');
    if (releasable.length === 0) return;

    const batch = selectWaveOrders(releasable, 5);
    if (batch.length === 0) return;

    this.waveIndex++;
    const waveId = waveCode(this.simTime, this.waveIndex);
    const carrier = this.rng.pick(CARRIERS);
    const wave = {
      id: waveId,
      code: waveId,
      orderIds: batch.map((o) => o.id),
      status: 'released' as const,
      createdAt: this.simTime,
      pickerIds: [] as string[],
      carrierCode: carrier.code,
      priority: batch.some((o) => o.priority === 'critical')
        ? ('critical' as const)
        : batch.some((o) => o.priority === 'express')
          ? ('express' as const)
          : ('standard' as const),
    };
    this.waves.set(waveId, wave);

    const pickers = this.workers.filter((w) => w.role === 'picker');
    for (const order of batch) {
      order.waveId = waveId;
      order.status = 'picking';
      const bins = order.lines.map((l) => this.layout.locations.get(l.locationId)!).filter(Boolean);
      const path = optimizePickPath(bins);
      for (let i = 0; i < order.lines.length; i++) {
        const line = order.lines[i]!;
        const loc = path[i] ?? this.layout.locations.get(line.locationId)!;
        const picker = pickers[i % Math.max(1, pickers.length)];
        if (!picker) break;
        const task = this.createTask('pick', order.id, loc.id, line.skuId, line.qty, picker.id, order.priority);
        task.label = msg('揀 {0} × {1}', line.qty, () => {
          const sku = this.skuById.get(line.skuId);
          return sku ? skuName(sku) : line.skuId;
        });
        task.zoneId = loc.zoneId;
        task.meta = { order: order.id, bin: loc.id, level: loc.level, sku: line.skuId };
        this.pushToQueue(this.pickerQueues, picker.id, task.id);
        if (!wave.pickerIds.includes(picker.id)) wave.pickerIds.push(picker.id);
      }
    }
  }

  /* ---------------------------------------------------------- shipping */

  private processShipping(): void {
    if (this.simTime < this.nextShipmentAt) return;
    this.nextShipmentAt = this.simTime + 12;

    const packed = [...this.orders.values()].filter((o) => o.status === 'packed');
    if (packed.length === 0) return;

    const carrier = this.rng.pick(CARRIERS);
    const group = packed.slice(0, this.rng.int(2, 5));
    if (group.length === 0) return;

    const dock = this.findFreeDock('outbound');
    const vehicle = this.vehicles.find((v) => v.status === 'idle' && v.yardPhase === 'none');
    if (!dock || !vehicle) return;

    const destination = this.rng.weighted(
      this.customers,
      this.customers.map((c) => c.share),
    );
    const id = `SHP-${String(this.shipmentSeq++).padStart(6, '0')}`;
    const parcels = group.reduce((s, o) => s + Math.max(1, o.lines.length), 0);
    const weight = group.reduce((s, o) => s + o.weight, 0);
    const shipment: Shipment = {
      id,
      orderIds: group.map((o) => o.id),
      vehicleId: vehicle.id,
      dockId: dock.id,
      status: 'loading',
      carrier: carrier.name,
      carrierEn: carrier.nameEn,
      destination: destination.name,
      destinationEn: destination.nameEn,
      destinationX: destination.x,
      destinationZ: destination.z,
      createdAt: this.simTime,
      departAt: null,
      deliverAt: null,
      parcels,
      weight,
      volume: group.reduce((s, o) => s + o.volume, 0),
      distanceKm: destination.distanceKm,
      co2Kg: 0,
      temperatureControlled: group.some((o) => o.lines.some((l) => this.skuById.get(l.skuId)?.tempZone !== 'ambient')),
    };

    this.shipments.set(id, shipment);
    dock.occupiedBy = id;
    vehicle.shipmentId = id;
    vehicle.dockId = dock.id;
    vehicle.status = 'loading';
    vehicle.load = 0;
    vehicle.destination = destination.name;
    vehicle.destinationEn = destination.nameEn;
    vehicle.roadDistanceKm = destination.distanceKm;
    vehicle.roadSpeedKmh = 62 * carrier.speedFactor;
    vehicle.roadProgress = 0;
    vehicle.route = YARD_ROUTES.outboundEast(dock.x);
    vehicle.routeIdx = 0;
    vehicle.yardPhase = 'none';
    vehicle.x = dock.x;
    vehicle.z = 46.2;
    vehicle.rotation = -Math.PI / 2;

    for (const order of group) {
      order.shipmentId = id;
      order.status = 'staged';
      const loaders = this.workers.filter((w) => w.role === 'loader');
      const loader = loaders[this.rng.int(0, Math.max(0, loaders.length - 1))];
      if (!loader) break;
      const task = this.createTask('load', id, `S-OUT-01`, null, order.lines.length, loader.id, order.priority);
      task.label = msg('裝車 {0} → {1}', order.id, () => customerZoneName(destination));
      task.meta = { shipment: id, order: order.id, parcels: order.lines.length };
      this.pushToQueue(this.loaderQueues, loader.id, task.id);
    }
  }

  private shipmentSeq = 1;

  /* ----------------------------------------------------------- ops loop */

  private processOps(dt: number): void {
    this.drainQueues(this.pickerQueues, 'picker');
    this.drainQueues(this.packerQueues, 'packer');
    this.drainQueues(this.receiverQueues, 'receiver');
    this.drainQueues(this.loaderQueues, 'loader');
    this.drainAgvQueue();

    for (const op of [...this.ops.values()]) {
      // AGV-driven multi-leg jobs run on their own state machine below.
      if (op.kind === 'putaway' || op.kind === 'replenish') continue;
      const worker = op.workerId ? this.workers.find((w) => w.id === op.workerId) : undefined;
      const agv = op.agvId ? this.agvs.find((a) => a.id === op.agvId) : undefined;
      const entity = worker ?? agv;

      if (op.phase === 'travel' && entity) {
        const speed = worker ? WORKER_SPEED : AGV_SPEED;
        const moved = this.moveEntity(entity, op.targetX, op.targetZ, speed * dt);
        if (moved) {
          op.task.progress = Math.min(0.95, op.task.progress + (speed * dt) / 900);
        }
        const dx = Math.abs(entity.x - op.targetX);
        const dz = Math.abs(entity.z - op.targetZ);
        if (dx < 1.1 && dz < 1.1) {
          entity.busyTaskId = op.task.id;
          op.phase = 'work';
        }
        continue;
      }

      if (op.phase === 'work') {
        op.elapsed += dt;
        op.task.progress = Math.min(1, op.elapsed / Math.max(0.01, op.durationMin));
        if (op.elapsed >= op.durationMin) {
          this.completeOp(op);
        }
        continue;
      }
    }

    // AGV jobs travel in two legs: staging → destination bin → drop.
    for (const op of [...this.ops.values()]) {
      if (op.kind !== 'putaway' && op.kind !== 'replenish') continue;
      if (!op.agvId) continue;
      const agv = this.agvs.find((a) => a.id === op.agvId);
      if (!agv) continue;
      if (op.phase === 'travel') {
        const moved = this.moveEntity(agv, op.targetX, op.targetZ, AGV_SPEED * dt);
        op.task.progress = Math.min(0.9, op.task.progress + (moved ? 0.012 : 0));
        if (Math.abs(agv.x - op.targetX) < 1.2 && Math.abs(agv.z - op.targetZ) < 1.2) {
          if ((op.leg ?? 0) === 0) {
            const dest = this.layout.locations.get(String(op.task.meta.to ?? ''));
            if (dest) {
              op.leg = 1;
              op.targetX = dest.x;
              op.targetZ = dest.z + 1.15;
              agv.state = 'toDrop';
              agv.payloadSku = op.task.skuId;
            } else {
              op.phase = 'work';
            }
          } else {
            op.phase = 'work';
          }
        }
      } else {
        op.elapsed += dt;
        op.task.progress = Math.min(1, op.elapsed / Math.max(0.01, op.durationMin));
        if (op.elapsed >= op.durationMin) this.completeOp(op);
      }
    }
  }

  /** Axis-aligned movement so entities travel along aisles instead of through racking. */
  private moveEntity(
    entity: Worker | Agv,
    tx: number,
    tz: number,
    distance: number,
  ): boolean {
    const dx = tx - entity.x;
    const dz = tz - entity.z;
    if (Math.abs(dx) < 0.05 && Math.abs(dz) < 0.05) return false;
    if (Math.abs(dx) >= Math.abs(dz)) {
      const step = Math.min(Math.abs(dx), distance);
      entity.x += Math.sign(dx) * step;
      entity.rotation = Math.atan2(0, dx) || 0;
    } else {
      const step = Math.min(Math.abs(dz), distance);
      entity.z += Math.sign(dz) * step;
      entity.rotation = Math.atan2(0, dz) || 0;
    }
    if ('battery' in entity) {
      entity.battery = Math.max(0.05, entity.battery - distance / 9000);
    }
    return true;
  }

  private drainQueues(queues: Map<string, string[]>, role: Worker['role']): void {
    for (const worker of this.workers) {
      if (worker.role !== role) continue;
      if (worker.busyTaskId) continue;
      const queue = queues.get(worker.id);
      if (!queue || queue.length === 0) continue;
      const taskId = queue.shift()!;
      const task = this.tasks.get(taskId);
      if (!task || task.status === 'cancelled') continue;
      this.startTask(task, worker.id, null);
    }
  }

  /** Assign queued AGV jobs to idle vehicles. */
  private drainAgvQueue(): void {
    if (this.agvQueue.length === 0) return;
    for (const agv of this.agvs) {
      if (agv.busyTaskId) continue;
      const taskId = this.agvQueue.shift();
      if (!taskId) break;
      const task = this.tasks.get(taskId);
      if (!task || task.status === 'cancelled') continue;
      const staging = this.layout.locations.get(String(task.meta.from ?? ''));
      const op: Op = {
        task,
        kind: task.kind,
        workerId: null,
        agvId: agv.id,
        phase: 'travel',
        targetX: staging?.x ?? 0,
        targetZ: staging?.z ?? 0,
        durationMin: 3.5,
        elapsed: 0,
        leg: 0,
        skuId: task.skuId ?? undefined,
        qty: task.qty,
        locationId: task.locationId ?? null,
      };
      task.status = 'active';
      task.startedAt = this.simTime;
      task.assignee = agv.id;
      agv.busyTaskId = task.id;
      agv.state = 'toPick';
      this.ops.set(task.id, op);
    }
  }

  private startTask(task: Task, workerId: string | null, agvId: string | null): void {
    const loc = task.locationId ? this.layout.locations.get(task.locationId) : undefined;
    const worker = workerId ? this.workers.find((w) => w.id === workerId) : undefined;
    const agv = agvId ? this.agvs.find((a) => a.id === agvId) : undefined;

    let duration = 8;
    let targetX = 0;
    let targetZ = 0;

    if (loc) {
      targetX = loc.x;
      targetZ = loc.z + 1.15;
    }

    switch (task.kind) {
      case 'pick': {
        duration = 1.1 + task.qty * 0.22 + ((loc?.level ?? 1) - 1) * 0.55;
        break;
      }
      case 'pack': {
        const station = this.findFreeStation('packing');
        if (station) {
          targetX = station.x;
          targetZ = station.z + 1.6;
        }
        duration = 6 + task.qty * 0.8;
        break;
      }
      case 'receive': {
        duration = 8 + task.qty * 0.02;
        break;
      }
      case 'load': {
        const dock = this.layout.docks.find((d) => d.id === task.meta.dock);
        const shipment = this.shipments.get(task.ref);
        const targetDock = dock ?? this.layout.docks.find((d) => d.id === shipment?.dockId);
        if (targetDock) {
          targetX = targetDock.x;
          targetZ = targetDock.z + (targetDock.kind === 'inbound' ? -3.4 : 3.4);
        }
        duration = 6 + task.qty * 1.4;
        break;
      }
      case 'putaway': {
        duration = 4;
        break;
      }
      default:
        duration = 6;
    }

    const op: Op = {
      task,
      kind: task.kind,
      workerId,
      agvId,
      phase: 'travel',
      targetX,
      targetZ,
      durationMin: duration,
      elapsed: 0,
      skuId: task.skuId ?? undefined,
      qty: task.qty,
      locationId: task.locationId,
    };

    task.status = 'active';
    task.startedAt = this.simTime;
    task.assignee = workerId ?? agvId ?? null;
    if (worker) worker.busyTaskId = task.id;
    if (agv) {
      agv.busyTaskId = task.id;
      agv.state = 'toPick';
    }
    this.ops.set(task.id, op);
  }

  private completeOp(op: Op): void {
    const task = op.task;
    task.status = 'done';
    task.finishedAt = this.simTime;
    task.progress = 1;

    const worker = op.workerId ? this.workers.find((w) => w.id === op.workerId) : undefined;
    const agv = op.agvId ? this.agvs.find((a) => a.id === op.agvId) : undefined;
    if (worker) {
      worker.busyTaskId = null;
      if (op.kind === 'pick') worker.picksPerHour += 0.4;
    }
    if (agv) {
      agv.busyTaskId = null;
      agv.state = 'idle';
      agv.payloadSku = null;
      agv.battery = Math.min(1, agv.battery + 0.18);
    }

    switch (op.kind) {
      case 'pick':
        this.onPickComplete(op);
        break;
      case 'pack':
        this.onPackComplete(op);
        break;
      case 'receive':
        this.onReceiveComplete(op);
        break;
      case 'load':
        this.onLoadComplete(op);
        break;
      case 'putaway':
        this.onPutawayComplete(op);
        break;
      case 'replenish': {
        const from = op.task.meta.from as string;
        const to = op.task.meta.to as string;
        const skuId = op.task.meta.sku as string;
        const qty = Number(op.task.meta.qty ?? 0);
        const sku = this.skuById.get(skuId);
        if (!sku) break;
        const movable = this.fitQuantity(to, sku, qty);
        if (movable > 0) {
          this.inventory.transfer(
            skuId,
            from,
            to,
            movable,
            op.task.ref,
            this.simTime,
            'replenish',
            msg('補貨至 {0}', to),
          );
        }
        break;
      }
      default:
        break;
    }

    this.ops.delete(task.id);
  }

  private onPickComplete(op: Op): void {
    const orderId = op.task.meta.order as string;
    const order = this.orders.get(orderId);
    if (!order) return;
    const line = order.lines.find((l) => l.skuId === op.task.skuId && l.pickedQty < l.qty);
    if (!line) return;

    const allocations = (this.orderAllocations.get(orderId) ?? []).filter(
      (a) => a.locationId === line.locationId && a.skuId === line.skuId,
    );
    const picked = this.inventory.commitPick(allocations, orderId, this.simTime);
    line.pickedQty += picked > 0 ? picked : line.qty;
    // `commitPick` already releases the reservation for this allocation — releasing it
    // again would free stock that is still promised to another order.

    const worker = op.workerId ? this.workers.find((w) => w.id === op.workerId) : undefined;
    // Pick accuracy is the share of pick lines handled correctly: a worker with skill
    // `s` mis-picks roughly (1 - s) of the lines they touch. It must not decay with the
    // number of lines, otherwise the KPI drifts down on every multi-line order.
    const skill = worker?.skill ?? 0.95;
    order.pickCount += 1;
    if (!this.rng.chance(Math.min(0.999, skill))) order.pickErrors += 1;
    order.accuracy = order.pickCount > 0 ? 1 - order.pickErrors / order.pickCount : 1;

    if (order.lines.every((l) => l.pickedQty >= l.qty)) {
      order.status = 'packing';
      const packers = this.workers.filter((w) => w.role === 'packer');
      const packer = packers.find((p) => !p.busyTaskId);
      const task = this.createTask('pack', order.id, null, null, order.lines.length, packer?.id ?? null, order.priority);
      task.label = msg('打包 {0} · {1}', order.id, () => localize(order.customer, order.customerEn));
      task.meta = { order: order.id, parcels: order.lines.length };
      if (packer) this.pushToQueue(this.packerQueues, packer.id, task.id);
    }
  }

  private onPackComplete(op: Op): void {
    const orderId = op.task.meta.order as string;
    const order = this.orders.get(orderId);
    if (!order) return;
    order.status = 'packed';
    order.parcelCount = order.lines.length + (order.weight > 40 ? 1 : 0);
    order.weight = order.lines.reduce((s, l) => s + l.pickedQty * this.skuById.get(l.skuId)!.unitWeight, 0);
    order.volume = order.lines.reduce((s, l) => s + l.pickedQty * this.skuById.get(l.skuId)!.unitVolume, 0);
  }

  private onReceiveComplete(op: Op): void {
    const asnId = op.task.ref;
    const asn = this.asns.find((a) => a.id === asnId);
    if (!asn) return;
    const stagingId = op.task.locationId ?? 'S-IN-01';
    const group = (this.pendingReceipts.get(asnId) ?? []).find((g) => g.stagingId === stagingId);
    for (const line of group?.lines ?? []) {
      const sku = this.skuById.get(line.skuId);
      if (!sku) continue;
      const movable = this.fitQuantity(stagingId, sku, line.qty);
      const overflow = line.qty - movable;
      if (movable > 0) {
        this.inventory.receive(line.skuId, stagingId, movable, asnId, this.simTime);
      }
      if (overflow > 0) {
        // Staging position is full — the remainder waits in the overflow buffer.
        this.inventory.receive(line.skuId, 'S-OVER', overflow, asnId, this.simTime);
      }
      const asnLine = asn.lines.find((l) => l.skuId === line.skuId);
      if (asnLine) asnLine.receivedQty = Math.min(asnLine.qty, asnLine.receivedQty + line.qty);
      this.schedulePutaway(line.skuId, line.qty, movable > 0 ? stagingId : 'S-OVER', asnId);
    }
    const allReceived = asn.lines.every((l) => l.receivedQty >= l.qty);
    if (allReceived) {
      asn.status = 'putaway';
      const dock = this.layout.docks.find((d) => d.id === asn.dockId);
      if (dock) dock.occupiedBy = undefined;
      const dockX = dock?.x ?? -46;
      const vehicle = this.vehicles.find((v) => v.dockId === asn.dockId);
      if (vehicle) {
        vehicle.status = 'idle';
        vehicle.dockId = null;
        vehicle.shipmentId = null;
        vehicle.destination = '';
        vehicle.destinationEn = '';
        vehicle.yardPhase = 'toGate';
        vehicle.route = YARD_ROUTES.inbound(dockX).slice().reverse();
        vehicle.routeIdx = 0;
        vehicle.x = vehicle.route[0]![0];
        vehicle.z = vehicle.route[0]![1];
        vehicle.rotation = Math.PI / 2;
      }
    }
  }

  /**
   * Schedule a put-away for received stock.
   *
   * A received pallet rarely fits into a single bin, so the quantity is split
   * across as many locations as required — exactly how a real WMS handles an
   * over-sized receipt, and it keeps every location inside its capacity.
   */
  private schedulePutaway(skuId: string, qty: number, stagingId: string, ref: string): void {
    const sku = this.skuById.get(skuId);
    if (!sku || qty <= 0) return;
    const zone = this.pickPutawayZone(sku);

    const whole = this.findPutawayLocation(zone, sku, qty);
    if (whole) {
      this.queuePutaway(skuId, qty, stagingId, whole, zone, ref);
      return;
    }

    let remaining = qty;
    const used = new Set<string>();
    for (let guard = 0; guard < 24 && remaining > 0; guard++) {
      const loc = this.findPutawayLocation(zone, sku, remaining, used, true);
      if (!loc) break;
      used.add(loc.id);
      const roomWeight = loc.maxWeight - this.inventory.locationWeight(loc.id);
      const roomVolume = loc.maxVolume - this.inventory.locationVolume(loc.id);
      const byWeight = Math.floor(roomWeight / Math.max(0.01, sku.unitWeight));
      const byVolume = Math.floor(roomVolume / Math.max(0.0001, sku.unitVolume));
      const move = Math.min(remaining, byWeight, byVolume);
      if (move <= 0) continue;
      this.queuePutaway(skuId, move, stagingId, loc, zone, ref);
      remaining -= move;
    }
  }

  /** Create a put-away task and queue it for the next free AGV. */
  private queuePutaway(
    skuId: string,
    qty: number,
    stagingId: string,
    target: Location,
    zone: string,
    ref: string,
  ): void {
    const sku = this.skuById.get(skuId);
    if (!sku) return;
    const task = this.createTask('putaway', ref, target.id, skuId, qty, null, 'standard');
    task.label = msg('上架 {0} → {1}', () => skuName(sku), target.id);
    task.zoneId = zone;
    task.meta = { from: stagingId, to: target.id, sku: skuId, qty };
    this.agvQueue.push(task.id);
  }

  /**
   * How many units of a SKU still fit into a location right now.
   * Capacity is re-checked at execution time, because several jobs may target
   * the same bin before any of them completes.
   */
  private fitQuantity(locationId: string, sku: { unitWeight: number; unitVolume: number }, qty: number): number {
    const loc = this.layout.locations.get(locationId);
    if (!loc) return 0;
    const weightRoom = loc.maxWeight - this.inventory.locationWeight(locationId);
    const volumeRoom = loc.maxVolume - this.inventory.locationVolume(locationId);
    const byWeight = Math.floor(weightRoom / Math.max(0.01, sku.unitWeight));
    const byVolume = Math.floor(volumeRoom / Math.max(0.0001, sku.unitVolume));
    return Math.max(0, Math.min(qty, byWeight, byVolume));
  }

  private onPutawayComplete(op: Op): void {
    const from = op.task.meta.from as string;
    const to = op.task.meta.to as string;
    const skuId = op.task.meta.sku as string;
    const qty = Number(op.task.meta.qty ?? 0);
    const sku = this.skuById.get(skuId);
    if (!sku) return;

    const movable = this.fitQuantity(to, sku, qty);
    if (movable > 0) {
      this.inventory.transfer(
        skuId,
        from,
        to,
        movable,
        op.task.ref,
        this.simTime,
        'putaway',
        msg('上架至 {0}', to),
      );
    }
    const remainder = qty - movable;
    if (remainder > 0) {
      // The target bin filled up while the AGV was travelling — find another home.
      this.schedulePutaway(skuId, remainder, from, op.task.ref);
    }
  }

  private onLoadComplete(op: Op): void {
    const orderId = op.task.meta.order as string;
    const order = this.orders.get(orderId);
    if (!order) return;
    order.status = 'loading';
    const shipmentId = order.shipmentId;
    const shipment = shipmentId ? this.shipments.get(shipmentId) : undefined;
    if (!shipment) return;

    // Only seal the shipment once every one of its own load tasks is finished.
    // Queued tasks count too — a task still waiting for a loader blocks sealing.
    const pending = [...this.tasks.values()].filter(
      (t) =>
        t.kind === 'load' &&
        t.ref === shipmentId &&
        (t.status === 'queued' || t.status === 'active'),
    );
    if (pending.length === 0 && shipment.status === 'loading') {
      shipment.status = 'sealed';
      const vehicle = this.vehicles.find((v) => v.id === shipment.vehicleId);
      if (vehicle) {
        vehicle.load = 1;
        vehicle.yardPhase = 'toGate';
        vehicle.route = YARD_ROUTES.outboundEast(
          this.layout.docks.find((d) => d.id === shipment.dockId)?.x ?? 30,
        );
        vehicle.routeIdx = 0;
        vehicle.x = vehicle.route[0]![0];
        vehicle.z = vehicle.route[0]![1];
      }
    }
  }

  /* ------------------------------------------------------- replenishment */

  private processReplenishment(): void {
    if (this.simTime < this.nextReplenishAt) return;
    this.nextReplenishAt = this.simTime + 14;
    const flowIds = this.putawayCandidates.get('B') ?? [];
    if (flowIds.length === 0) return;
    const source = flowIds[this.rng.int(0, flowIds.length - 1)]!;
    const loc = this.layout.locations.get(source);
    if (!loc) return;
    const lots = this.inventory.lotsAt(loc.id);
    if (lots.length === 0) return;
    const lot = lots.find((l) => l.qty > 0 && l.reservedQty === 0) ?? lots[0]!;
    const sku = this.skuById.get(lot.skuId);
    if (!sku) return;
    // Never forward-pick stock that is already promised to an open order.
    const reserve = [...this.layout.locations.values()].find(
      (l) =>
        l.zoneId === 'A' &&
        l.id !== loc.id &&
        this.inventory.lotsAt(l.id).some(
          (x) => x.skuId === lot.skuId && x.qty > 0 && x.reservedQty === 0,
        ) &&
        this.inventory.locationWeight(l.id) < l.maxWeight * 0.85,
    );
    if (!reserve) return;

    // Only replenish what actually fits into the pick face.
    const weightRoom = loc.maxWeight - this.inventory.locationWeight(loc.id);
    const volumeRoom = loc.maxVolume - this.inventory.locationVolume(loc.id);
    const byWeight = Math.floor(weightRoom / Math.max(0.01, sku.unitWeight));
    const byVolume = Math.floor(volumeRoom / Math.max(0.0001, sku.unitVolume));
    const movable = this.inventory.lotsAt(reserve.id).find(
      (x) => x.skuId === lot.skuId && x.qty > 0 && x.reservedQty === 0,
    );
    const available = movable ? movable.qty : 0;
    const qty = Math.min(
      40,
      byWeight,
      byVolume,
      available,
      Math.floor((reserve.maxWeight * 0.2) / Math.max(0.05, sku.unitWeight)),
    );
    if (qty <= 0) return;

    const task = this.createTask('replenish', 'REPL', reserve.id, lot.skuId, qty, null, 'standard');
    task.label = msg('補貨 {0} → {1}', () => skuName(sku), loc.id);
    task.zoneId = 'A';
    task.meta = { from: reserve.id, to: loc.id, sku: lot.skuId, qty };
    this.agvQueue.push(task.id);
  }

  private processCycleCount(): void {
    if (this.simTime < this.nextCycleCountAt) return;
    this.nextCycleCountAt = this.simTime + 40;
    const ids = [...this.layout.locations.keys()];
    const id = ids[this.rng.int(0, ids.length - 1)]!;
    const task = this.createTask('cyclecount', 'CYCLE', id, null, 0, null, 'standard');
    task.label = msg('循環盤點 {0}', id);
    task.zoneId = this.layout.locations.get(id)?.zoneId ?? null;
    task.meta = { location: id };
    const workers = this.workers.filter((w) => w.role === 'picker' && !w.busyTaskId);
    const worker = workers[0];
    if (!worker) return;
    const op: Op = {
      task,
      kind: 'cyclecount',
      workerId: worker.id,
      agvId: null,
      phase: 'travel',
      targetX: this.layout.locations.get(id)!.x,
      targetZ: this.layout.locations.get(id)!.z + 1.15,
      durationMin: 4,
      elapsed: 0,
      locationId: id,
    };
    task.status = 'active';
    task.startedAt = this.simTime;
    task.assignee = worker.id;
    worker.busyTaskId = task.id;
    this.ops.set(task.id, op);
  }

  /* ------------------------------------------------------------ helpers */

  private createTask(
    kind: TaskKind,
    ref: string,
    locationId: string | null,
    skuId: string | null,
    qty: number,
    assignee: string | null,
    priority: Priority,
  ): Task {
    const id = `T${String(this.taskCounter++).padStart(6, '0')}`;
    const task: Task = {
      id,
      kind,
      status: 'queued',
      ref,
      locationId,
      skuId,
      qty,
      assignee,
      createdAt: this.simTime,
      startedAt: null,
      finishedAt: null,
      progress: 0,
      priority,
      label: msg(kind),
      zoneId: locationId ? this.layout.locations.get(locationId)?.zoneId ?? null : null,
      meta: {},
    };
    this.tasks.set(id, task);
    return task;
  }

  private pushToQueue(queues: Map<string, string[]>, workerId: string, taskId: string): void {
    if (!queues.has(workerId)) queues.set(workerId, []);
    queues.get(workerId)!.push(taskId);
  }

  private findFreeDock(kind: DockKind): DockLike | undefined {
    const docks = this.layout.docks.filter((d) => d.kind === kind);
    for (const dock of docks) {
      if (!dock.occupiedBy) return dock;
    }
    return undefined;
  }

  private findFreeStation(kind: StationKind): StationLike | undefined {
    const stations = this.layout.stations.filter((s) => s.kind === kind);
    return stations.find((s) => !this.opsHasStation(s.id)) ?? stations[0];
  }

  private opsHasStation(id: string): boolean {
    for (const op of this.ops.values()) {
      if (op.kind === 'pack' && op.targetX === this.layout.stations.find((s) => s.id === id)?.x) return true;
    }
    return false;
  }

  private pickPutawayZone(sku: { tempZone: string; abcClass: string }): string {
    if (sku.tempZone === 'frozen') return 'D';
    if (sku.tempZone === 'chilled') return 'C';
    if (sku.abcClass === 'A') return this.rng.chance(0.65) ? 'B' : 'A';
    return 'A';
  }

  private findPutawayLocation(
    zone: string,
    sku: { unitWeight: number; unitVolume: number },
    qty: number,
    exclude: Set<string> = new Set(),
    anyFit = false,
  ): Location | undefined {
    const candidates = this.putawayCandidates.get(zone);
    if (!candidates) return undefined;
    const wantWeight = qty * sku.unitWeight;
    const wantVolume = qty * sku.unitVolume;
    const temp =
      zone === 'C' ? 'chilled' : zone === 'D' ? 'frozen' : 'ambient';

    for (const id of candidates) {
      if (exclude.has(id)) continue;
      const loc = this.layout.locations.get(id);
      if (!loc) continue;
      if (loc.tempZone !== temp) continue;
      const weightRoom = loc.maxWeight - this.inventory.locationWeight(id);
      const volumeRoom = loc.maxVolume - this.inventory.locationVolume(id);
      if (weightRoom <= 0 || volumeRoom <= 0) continue;
      if (!anyFit && (weightRoom < wantWeight || volumeRoom < wantVolume)) continue;
      return loc;
    }
    return undefined;
  }

  private updateWorkerUtilisation(): void {
    for (const worker of this.workers) {
      worker.utilisation = worker.busyTaskId ? 1 : 0.15 + this.rng.next() * 0.1;
    }
  }

  private recomputeUtilisation(): void {
    for (const loc of this.layout.locations.values()) {
      loc.utilisation = Math.min(1, this.inventory.locationWeight(loc.id) / loc.maxWeight);
    }
  }

  private alertedRecently(key: string): boolean {
    return this.alerts.some((a) => a.id === key);
  }

  private pushAlert(
    severity: Alert['severity'],
    title: Message,
    detail: Message,
    zoneId: string | null,
  ): void {
    const id = `AL-${++this.alertSeq}-${keyify(title.key)}`;
    if (this.alerts.some((a) => a.id === id)) return;
    const alert: Alert = { id, severity, title, detail, at: this.simTime, zoneId };
    this.alerts.unshift(alert);
    if (this.alerts.length > 40) this.alerts.pop();
    this.events.emit('alert', alert);
  }

  /* --------------------------------------------------------- statistics */

  private recordHistory(): void {
    const kpi = this.computeKpis();
    this.history.push({
      label: formatClock(this.simTime),
      time: this.simTime,
      throughput: kpi.throughputPerHour,
      utilisation: kpi.warehouseUtilisation,
      accuracy: kpi.pickAccuracy,
    });
    if (this.history.length > 96) this.history.shift();
  }

  private computeKpis(): KpiSnapshot {
    const now = this.simTime;
    const recent = this.shippedOrders.filter((s) => now - s.at <= 60);
    const throughputPerHour = recent.length;
    const scored = this.shippedOrders.slice(-120);
    const pickAccuracy =
      scored.length > 0
        ? (scored.reduce((s, o) => s + o.accuracy, 0) / scored.length) * 100
        : 98.6;
    const onTime =
      scored.length > 0
        ? (scored.filter((o) => o.onTime).length / scored.length) * 100
        : 96.5;
    const cycle =
      scored.length > 0 ? scored.reduce((s, o) => s + o.cycle, 0) / scored.length : 0;

    let capacityWeight = 0;
    let usedWeight = 0;
    for (const loc of this.layout.locations.values()) {
      capacityWeight += loc.maxWeight;
      usedWeight += this.inventory.locationWeight(loc.id);
    }
    const utilisation = capacityWeight > 0 ? usedWeight / capacityWeight : 0;

    const occupiedDocks = this.layout.docks.filter((d) => d.occupiedBy).length;
    const busyVehicles = this.vehicles.filter((v) => v.status !== 'idle').length;
    const activeWorkers = this.workers.filter((w) => w.busyTaskId).length;

    const openOrders = [...this.orders.values()].filter(
      (o) => o.status !== 'shipped' && o.status !== 'packed',
    ).length;

    const unitsOnHand = this.inventory.totalUnits();
    const dailyThroughput = this.shippedOrders.filter((s) => now - s.at <= 1440).length;
    const turnover = unitsOnHand > 0 ? (dailyThroughput * 2.4) / unitsOnHand : 0;

    return {
      timestamp: now,
      throughputPerHour,
      pickAccuracy: Number(pickAccuracy.toFixed(2)),
      onTimeDelivery: Number(onTime.toFixed(2)),
      warehouseUtilisation: Number((utilisation * 100).toFixed(1)),
      inventoryTurnover: Number(turnover.toFixed(2)),
      orderCycleMinutes: Math.round(cycle),
      dockUtilisation: Number(((occupiedDocks / this.layout.docks.length) * 100).toFixed(1)),
      fleetUtilisation: Number(((busyVehicles / this.vehicles.length) * 100).toFixed(1)),
      co2Tonnes: Number((this.totalCo2Kg / 1000).toFixed(2)),
      openOrders,
      activeWorkers,
      backlogDays: Number((openOrders / Math.max(1, dailyThroughput || 1)).toFixed(2)),
    };
  }

  /* ---------------------------------------------------------- selection */

  /** Locations that should be visually highlighted given the current selection. */
  highlightedLocations(): Set<string> {
    const out = new Set<string>();
    const sel = this.selection;
    if (sel.kind === 'none') return out;

    if (sel.kind === 'location') {
      out.add(sel.id);
      return out;
    }
    if (sel.kind === 'order') {
      const order = this.orders.get(sel.id);
      if (order) for (const l of order.lines) out.add(l.locationId);
      return out;
    }
    if (sel.kind === 'wave') {
      const wave = this.waves.get(sel.id);
      if (wave) {
        for (const orderId of wave.orderIds) {
          const order = this.orders.get(orderId);
          if (order) for (const l of order.lines) out.add(l.locationId);
        }
      }
      return out;
    }
    if (sel.kind === 'task') {
      const task = this.tasks.get(sel.id);
      if (task?.locationId) out.add(task.locationId);
      if (task?.meta.to) out.add(String(task.meta.to));
      return out;
    }
    if (sel.kind === 'shipment') {
      const shipment = this.shipments.get(sel.id);
      if (shipment) {
        for (const orderId of shipment.orderIds) {
          const order = this.orders.get(orderId);
          if (order) for (const l of order.lines) out.add(l.locationId);
        }
      }
      return out;
    }
    if (sel.kind === 'sku') {
      for (const loc of this.layout.locations.values()) {
        if (this.inventory.lotsAt(loc.id).some((l) => l.skuId === sel.id)) out.add(loc.id);
      }
    }
    return out;
  }

  /** Ordered pick path for an order (used for the 3D route overlay). */
  pickPathFor(orderId: string): Location[] {
    const order = this.orders.get(orderId);
    if (!order) return [];
    const bins = order.lines.map((l) => this.layout.locations.get(l.locationId)!).filter(Boolean);
    return optimizePickPath(bins);
  }

  /* ------------------------------------------------------------ queries */

  taskList(limit = 60): Task[] {
    const active = [...this.ops.values()].map((o) => o.task);
    const queued = [...this.tasks.values()].filter((t) => t.status === 'queued');
    return [...active, ...queued]
      .sort((a, b) => (a.createdAt === b.createdAt ? 0 : b.createdAt - a.createdAt))
      .slice(0, limit);
  }

  activeTaskCount(): number {
    return this.ops.size;
  }

  orderList(): Order[] {
    return [...this.orders.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
}

/* --------------------------------------------------------------- utils */

type DockKind = 'inbound' | 'outbound';
type DockLike = { id: string; x: number; z: number; occupiedBy?: string };
type StationKind = 'packing' | 'receiving' | 'qc' | 'charging' | 'crossdock';
type StationLike = { id: string; x: number; z: number };

function keyify(text: string): string {
  return text.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
}

export function formatClock(simMinutes: number): string {
  const total = Math.floor(simMinutes);
  const hour = Math.floor((total % 1440) / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function formatDay(simMinutes: number): string {
  const day = Math.floor(simMinutes / 1440) + 1;
  const date = new Date(EPOCH + Math.floor(simMinutes / 1440) * 86400000);
  return `D${day} · ${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return t('{0} 分', Math.round(minutes));
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? t('{0} 小時', h) : t('{0} 小時 {1} 分', h, m);
}
