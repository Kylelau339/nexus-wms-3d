import type { Rng } from '../core/rng';
import type { Dock, Location, Rack, Station, TempZone, Zone, ZoneKind } from './types';

export interface WarehouseLayout {
  zones: Zone[];
  racks: Rack[];
  locations: Map<string, Location>;
  docks: Dock[];
  stations: Station[];
  /** Building shell extents (metres). */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  wallHeight: number;
}

interface ZoneSpec {
  id: string;
  name: string;
  nameEn: string;
  kind: ZoneKind;
  tempZone: TempZone;
  color: number;
  startX: number;
  rackLength: number;
  bays: number;
  levels: number;
  rows: number;
  firstZ: number;
  rowGap: number;
  maxWeight: number;
  maxVolume: number;
}

const ZONE_SPECS: ZoneSpec[] = [
  {
    id: 'A',
    name: 'A區 · 高架貨架（常溫）',
    nameEn: 'Zone A · High-Bay Racking (Ambient)',
    kind: 'highbay',
    tempZone: 'ambient',
    color: 0x276bb9,
    startX: -58,
    rackLength: 30,
    bays: 15,
    levels: 4,
    rows: 13,
    firstZ: -18,
    rowGap: 2.4,
    maxWeight: 900,
    maxVolume: 2.6,
  },
  {
    id: 'B',
    name: 'B區 · 快流揀選區',
    nameEn: 'Zone B · Fast-Mover Pick Face',
    kind: 'flow',
    tempZone: 'ambient',
    color: 0x14a3a3,
    startX: -22,
    rackLength: 26,
    bays: 13,
    levels: 3,
    rows: 12,
    firstZ: -18,
    rowGap: 2.4,
    maxWeight: 420,
    maxVolume: 1.6,
  },
  {
    id: 'C',
    name: 'C區 · 冷藏 0~4°C',
    nameEn: 'Zone C · Chilled 0~4°C',
    kind: 'chilled',
    tempZone: 'chilled',
    color: 0x2ba04c,
    startX: 12,
    rackLength: 22,
    bays: 11,
    levels: 3,
    rows: 8,
    firstZ: -18,
    rowGap: 2.4,
    maxWeight: 500,
    maxVolume: 1.8,
  },
  {
    id: 'D',
    name: 'D區 · 冷凍 -18°C',
    nameEn: 'Zone D · Frozen -18°C',
    kind: 'frozen',
    tempZone: 'frozen',
    color: 0x7c5cd6,
    startX: 40,
    rackLength: 18,
    bays: 9,
    levels: 3,
    rows: 5,
    firstZ: -18,
    rowGap: 2.4,
    maxWeight: 520,
    maxVolume: 1.9,
  },
];

const BOUNDS = { minX: -62, maxX: 62, minZ: -42, maxZ: 42 };
const WALL_HEIGHT = 11;

function makeLocation(
  id: string,
  zoneId: string,
  kind: ZoneKind,
  row: number,
  bay: number,
  level: number,
  x: number,
  y: number,
  z: number,
  rotation: number,
  maxWeight: number,
  maxVolume: number,
  tempZone: TempZone,
  palletPosition: boolean,
): Location {
  return {
    id,
    zoneId,
    kind,
    row,
    bay,
    level,
    x,
    y,
    z,
    rotation,
    maxWeight,
    maxVolume,
    tempZone,
    palletPosition,
    utilisation: 0,
  };
}

export function buildLayout(_rng: Rng): WarehouseLayout {
  const zones: Zone[] = [];
  const racks: Rack[] = [];
  const locations = new Map<string, Location>();

  for (const spec of ZONE_SPECS) {
    const bayWidth = spec.rackLength / spec.bays;
    const levelHeight = spec.kind === 'highbay' ? 1.75 : 1.55;
    const depth = spec.kind === 'highbay' ? 1.15 : 1.05;

    const lastZ = spec.firstZ + (spec.rows - 1) * spec.rowGap;
    zones.push({
      id: spec.id,
      name: spec.name,
      nameEn: spec.nameEn,
      kind: spec.kind,
      tempZone: spec.tempZone,
      color: spec.color,
      minX: spec.startX - 1.2,
      maxX: spec.startX + spec.rackLength + 1.2,
      minZ: spec.firstZ - 1.6,
      maxZ: lastZ + 1.6,
    });

    for (let r = 0; r < spec.rows; r++) {
      const z = spec.firstZ + r * spec.rowGap;
      const rackId = `${spec.id}-R${String(r + 1).padStart(2, '0')}`;
      racks.push({
        id: rackId,
        zoneId: spec.id,
        row: r + 1,
        startX: spec.startX,
        endX: spec.startX + spec.rackLength,
        z,
        depth,
        levels: spec.levels,
        bays: spec.bays,
        bayWidth,
        levelHeight,
      });

      for (let b = 0; b < spec.bays; b++) {
        for (let l = 0; l < spec.levels; l++) {
          const id = `${spec.id}-${String(r + 1).padStart(2, '0')}-${String(b + 1).padStart(3, '0')}-${l + 1}`;
          const x = spec.startX + (b + 0.5) * bayWidth;
          const y = 0.22 + l * levelHeight;
          locations.set(
            id,
            makeLocation(
              id,
              spec.id,
              spec.kind,
              r + 1,
              b + 1,
              l + 1,
              x,
              y,
              z,
              0,
              spec.maxWeight,
              spec.maxVolume,
              spec.tempZone,
              true,
            ),
          );
        }
      }
    }
  }

  /* ---------------------------------------------------------- staging lanes */
  // Inbound receiving staging: north of the racking area, in front of the inbound docks.
  for (let i = 0; i < 24; i++) {
    const col = i % 6;
    const row = Math.floor(i / 6);
    const x = -52 + col * 6;
    const z = -31 + row * 2.6;
    const id = `S-IN-${String(i + 1).padStart(2, '0')}`;
    locations.set(
      id,
      makeLocation(id, 'S', 'staging', row + 1, col + 1, 1, x, 0.02, z, 0, 2600, 7.5, 'ambient', true),
    );
  }

  // Outbound staging lanes: south of the racking area, feeding the outbound docks.
  for (let i = 0; i < 24; i++) {
    const col = i % 6;
    const row = Math.floor(i / 6);
    const x = -2 + col * 6;
    const z = 26 + row * 2.6;
    const id = `S-OUT-${String(i + 1).padStart(2, '0')}`;
    locations.set(
      id,
      makeLocation(id, 'O', 'staging', row + 1, col + 1, 1, x, 0.02, z, 0, 2600, 7.5, 'ambient', true),
    );
  }

  // Cold-chain outbound buffer.
  for (let i = 0; i < 8; i++) {
    const id = `S-COLD-${String(i + 1).padStart(2, '0')}`;
    locations.set(
      id,
      makeLocation(id, 'O', 'staging', 1, i + 1, 1, 40 + (i % 4) * 5, 0.02, 26 + Math.floor(i / 4) * 3.4, 0, 700, 2.4, 'chilled', true),
    );
  }

  // Overflow buffer — holds receipts that exceed the inbound staging positions.
  locations.set(
    'S-OVER',
    makeLocation('S-OVER', 'S', 'staging', 1, 1, 1, -58, 0.02, -24, 0, 40000, 90, 'ambient', true),
  );

  /* ------------------------------------------------------------------ docks */
  const docks: Dock[] = [];
  const inboundXs = [-48, -40, -32, -24, -16];
  inboundXs.forEach((x, i) => {
    docks.push({
      id: `IN-${String(i + 1).padStart(2, '0')}`,
      kind: 'inbound',
      index: i + 1,
      x,
      z: BOUNDS.minZ,
      rotation: 0,
      doorWidth: 4.2,
    });
  });
  const outboundXs = [4, 14, 24, 34, 44, 54];
  outboundXs.forEach((x, i) => {
    docks.push({
      id: `OUT-${String(i + 1).padStart(2, '0')}`,
      kind: 'outbound',
      index: i + 1,
      x,
      z: BOUNDS.maxZ,
      rotation: Math.PI,
      doorWidth: 4.2,
    });
  });

  /* --------------------------------------------------------------- stations */
  const stations: Station[] = [];
  for (let i = 0; i < 5; i++) {
    stations.push({
      id: `RCV-${String(i + 1).padStart(2, '0')}`,
      kind: 'receiving',
      name: `收貨站台 ${i + 1}`,
      nameEn: `Receiving Station ${i + 1}`,
      x: -48 + i * 8,
      z: -38.5,
      rotation: 0,
      capacity: 2,
    });
  }
  for (let i = 0; i < 6; i++) {
    stations.push({
      id: `PK-${String(i + 1).padStart(2, '0')}`,
      kind: 'packing',
      name: `打包台 ${i + 1}`,
      nameEn: `Packing Station ${i + 1}`,
      x: -26 + i * 7,
      z: 36,
      rotation: Math.PI,
      capacity: 2,
    });
  }
  for (let i = 0; i < 3; i++) {
    stations.push({
      id: `QC-${String(i + 1).padStart(2, '0')}`,
      kind: 'qc',
      name: `品檢 ${i + 1}`,
      nameEn: `QC Station ${i + 1}`,
      x: -6 + i * 6,
      z: -36,
      rotation: 0,
      capacity: 1,
    });
  }
  for (let i = 0; i < 4; i++) {
    stations.push({
      id: `CHG-${String(i + 1).padStart(2, '0')}`,
      kind: 'charging',
      name: `充電樁 ${i + 1}`,
      nameEn: `Charging Bay ${i + 1}`,
      x: 58,
      z: -30 + i * 4,
      rotation: Math.PI / 2,
      capacity: 1,
    });
  }
  stations.push({
    id: 'XD-01',
    kind: 'crossdock',
    name: '越庫作業區',
    nameEn: 'Cross-dock Area',
    x: 30,
    z: 36,
    rotation: Math.PI,
    capacity: 4,
  });

  return {
    zones,
    racks,
    locations,
    docks,
    stations,
    bounds: BOUNDS,
    wallHeight: WALL_HEIGHT,
  };
}

/** Aggregate capacity figures used for utilisation KPIs. */
export function layoutCapacity(layout: WarehouseLayout): { weight: number; volume: number; count: number } {
  let weight = 0;
  let volume = 0;
  for (const loc of layout.locations.values()) {
    weight += loc.maxWeight;
    volume += loc.maxVolume;
  }
  return { weight, volume, count: layout.locations.size };
}
