/**
 * Domain model for the NEXUS WMS / TMS digital twin.
 *
 * The model covers the complete inbound → storage → fulfilment → outbound → transport
 * lifecycle of a distribution centre:
 *
 *   ASN  →  receiving  →  put-away  →  storage  →  wave  →  picking
 *        →  packing    →  staging    →  loading  →  dispatch → delivery
 */

import type { Message } from '../core/i18n';

/* ------------------------------------------------------------------ enums */

export type TempZone = 'ambient' | 'chilled' | 'frozen';

export type ZoneKind =
  | 'highbay' // pallet racking, ambient
  | 'flow' // flow-through pick face
  | 'chilled'
  | 'frozen'
  | 'staging' // inbound / outbound staging
  | 'dock';

export type TaskKind =
  | 'receive'
  | 'putaway'
  | 'pick'
  | 'pack'
  | 'load'
  | 'dispatch'
  | 'replenish'
  | 'cyclecount';

export type TaskStatus = 'queued' | 'active' | 'done' | 'cancelled';

export type Priority = 'standard' | 'express' | 'critical';

export type AsStatus = 'scheduled' | 'arrived' | 'receiving' | 'putaway' | 'closed';

export type OrderStatus =
  | 'released'
  | 'picking'
  | 'picked'
  | 'packing'
  | 'packed'
  | 'staged'
  | 'loading'
  | 'shipped'
  | 'onhold';

export type ShipmentStatus =
  | 'loading'
  | 'sealed'
  | 'enroute'
  | 'delivering'
  | 'delivered'
  | 'returning';

export type VehicleStatus = 'idle' | 'loading' | 'enroute' | 'unloading' | 'returning' | 'delivering';

export type MovementKind =
  | 'receipt'
  | 'putaway'
  | 'pick'
  | 'replenish'
  | 'adjustment'
  | 'shipment'
  | 'return';

/* ------------------------------------------------------------- primitives */

export interface Sku {
  id: string;
  name: string;
  /** English catalogue name — the same record, in the other language. */
  nameEn: string;
  category: string;
  categoryEn: string;
  barcode: string;
  /** Single unit volume in m³. */
  unitVolume: number;
  /** Single unit weight in kg. */
  unitWeight: number;
  unitPrice: number;
  tempZone: TempZone;
  hazardClass: string | null;
  hazardClassEn: string | null;
  abcClass: 'A' | 'B' | 'C';
}

export interface Location {
  id: string;
  zoneId: string;
  kind: ZoneKind;
  /** Racking row / bay / level coordinates, null for floor locations. */
  row: number;
  bay: number;
  level: number;
  /** World position (metres) — the 3D scene reads these directly. */
  x: number;
  y: number;
  z: number;
  /** Facing direction in radians (0 = +X). */
  rotation: number;
  maxWeight: number;
  maxVolume: number;
  tempZone: TempZone;
  /** true when the location accepts a full pallet. */
  palletPosition: boolean;
  /** Current utilisation, 0..1 (weight based). */
  utilisation: number;
}

export interface Zone {
  id: string;
  name: string;
  nameEn: string;
  kind: ZoneKind;
  tempZone: TempZone;
  color: number;
  /** World-space bounds of the zone footprint. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Rack {
  id: string;
  zoneId: string;
  row: number;
  /** Start/centre/end along the rack's long axis. */
  startX: number;
  endX: number;
  z: number;
  depth: number;
  levels: number;
  bays: number;
  bayWidth: number;
  levelHeight: number;
}

export interface Dock {
  id: string;
  kind: 'inbound' | 'outbound';
  index: number;
  x: number;
  z: number;
  rotation: number;
  doorWidth: number;
  /** Reference to the ASN or shipment currently occupying the dock. */
  occupiedBy?: string;
}

export interface Station {
  id: string;
  kind: 'receiving' | 'packing' | 'qc' | 'charging' | 'crossdock';
  name: string;
  nameEn: string;
  x: number;
  z: number;
  rotation: number;
  capacity: number;
  occupiedBy?: string;
}

export interface Lot {
  id: string;
  skuId: string;
  locationId: string;
  qty: number;
  reservedQty: number;
  lotNo: string;
  expiryDays: number | null;
  receivedAt: number;
}

export interface Movement {
  id: number;
  kind: MovementKind;
  skuId: string;
  qty: number;
  fromLocationId: string | null;
  toLocationId: string | null;
  at: number;
  ref: string;
  /** Lazily rendered note — translated in whatever language is active. */
  note: Message;
}

export interface AsLine {
  skuId: string;
  qty: number;
  receivedQty: number;
}

export interface AsRecord {
  id: string;
  supplier: string;
  supplierEn: string;
  poNo: string;
  status: AsStatus;
  /** Simulation-clock timestamp (minutes since epoch of sim start). */
  eta: number;
  arrivedAt: number | null;
  dockId: string | null;
  lines: AsLine[];
  pallets: number;
  priority: Priority;
  totalWeight: number;
}

export interface OrderLine {
  skuId: string;
  qty: number;
  pickedQty: number;
  locationId: string;
  unitPrice: number;
}

export interface Order {
  id: string;
  customer: string;
  customerEn: string;
  channel: 'B2B' | 'B2C' | 'XBorder' | 'Replenish';
  priority: Priority;
  status: OrderStatus;
  createdAt: number;
  dueAt: number;
  lines: OrderLine[];
  waveId: string | null;
  shipmentId: string | null;
  parcelCount: number;
  weight: number;
  volume: number;
  /** 0..1 — measured pick accuracy for the order. */
  accuracy: number;
  /** Pick lines completed for this order. */
  pickCount: number;
  /** Pick lines that were mis-picked. */
  pickErrors: number;
  note: string;
}

export interface Wave {
  id: string;
  code: string;
  orderIds: string[];
  status: 'building' | 'released' | 'picking' | 'complete';
  createdAt: number;
  pickerIds: string[];
  carrierCode: string;
  priority: Priority;
}

export interface Task {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  ref: string;
  locationId: string | null;
  skuId: string | null;
  qty: number;
  assignee: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** 0..1 progress of the active task. */
  progress: number;
  priority: Priority;
  /** Lazily rendered task title — translated in whatever language is active. */
  label: Message;
  zoneId: string | null;
  meta: Record<string, string | number>;
}

export interface PickPathPoint {
  x: number;
  y: number;
  z: number;
  locationId: string;
}

export interface Vehicle {
  id: string;
  plate: string;
  kind: 'van' | 'box' | 'reefer' | 'flatbed' | 'container';
  capacityWeight: number;
  capacityVolume: number;
  status: VehicleStatus;
  driver: string;
  shipmentId: string | null;
  dockId: string | null;
  /** World position of the vehicle body. */
  x: number;
  z: number;
  rotation: number;
  /** Route progress in km along the current leg. */
  legProgress: number;
  legLength: number;
  speedKmh: number;
  load: number;
  odometer: number;
  co2Kg: number;
  etaMinutes: number;
  /** Yard animation waypoints (world metres). */
  route: Array<[number, number]>;
  routeIdx: number;
  /** Current yard leg direction. */
  yardPhase: 'none' | 'toDock' | 'toGate';
  /** Highway leg state (0..1 of the route). */
  roadProgress: number;
  roadDistanceKm: number;
  roadSpeedKmh: number;
  roadRemainingKm: number;
  /** True when the unit is a reefer (temperature-controlled). */
  refrigerated: boolean;
  /** Current destination label for the UI. */
  destination: string;
  destinationEn: string;
}

export interface Shipment {
  id: string;
  orderIds: string[];
  vehicleId: string | null;
  dockId: string | null;
  status: ShipmentStatus;
  carrier: string;
  carrierEn: string;
  destination: string;
  destinationEn: string;
  destinationX: number;
  destinationZ: number;
  createdAt: number;
  departAt: number | null;
  deliverAt: number | null;
  parcels: number;
  weight: number;
  volume: number;
  distanceKm: number;
  co2Kg: number;
  temperatureControlled: boolean;
}

export interface CustomerZone {
  id: string;
  name: string;
  nameEn: string;
  x: number;
  z: number;
  /** Distance from the DC in km. */
  distanceKm: number;
  share: number;
}

export interface Worker {
  id: string;
  name: string;
  role: 'picker' | 'receiver' | 'packer' | 'loader' | 'driver' | 'supervisor';
  skill: number;
  locationId: string | null;
  zoneId: string | null;
  x: number;
  z: number;
  /** Facing angle in radians. */
  rotation: number;
  busyTaskId: string | null;
  picksPerHour: number;
  utilisation: number;
}

export interface Agv {
  id: string;
  kind: 'reach' | 'tunnel' | 'counterbalance';
  x: number;
  z: number;
  rotation: number;
  state: 'idle' | 'toPick' | 'toDrop' | 'charging' | 'blocked';
  taskId: string | null;
  busyTaskId: string | null;
  battery: number;
  payloadSku: string | null;
  speed: number;
}

export interface Alert {
  id: string;
  severity: 'info' | 'warn' | 'danger';
  title: Message;
  detail: Message;
  at: number;
  zoneId: string | null;
}

/* ------------------------------------------------------------------ KPIs */

export interface KpiSnapshot {
  timestamp: number;
  /** Orders shipped per hour, rolling. */
  throughputPerHour: number;
  pickAccuracy: number;
  onTimeDelivery: number;
  warehouseUtilisation: number;
  inventoryTurnover: number;
  orderCycleMinutes: number;
  dockUtilisation: number;
  fleetUtilisation: number;
  co2Tonnes: number;
  openOrders: number;
  activeWorkers: number;
  backlogDays: number;
}

export interface Series {
  label: string;
  color: string;
  data: number[];
}
