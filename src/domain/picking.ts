import type { Location, Order, Priority } from './types';

/**
 * Pick-path optimisation.
 *
 * The planner groups bins by zone and rack row, then walks each row in an
 * S-shape (serpentine) so the picker never backtracks along an aisle.
 * Within a bay the lowest level is picked first to avoid reaching over stock.
 */
export function optimizePickPath(locations: Location[]): Location[] {
  if (locations.length <= 1) return [...locations];

  const zoneRank: Record<string, number> = { B: 0, A: 1, C: 2, D: 3, S: 4, O: 5 };
  const grouped = new Map<string, Location[]>();
  for (const loc of locations) {
    const key = `${loc.zoneId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(loc);
  }

  const orderedZones = [...grouped.keys()].sort(
    (a, b) => (zoneRank[a] ?? 9) - (zoneRank[b] ?? 9),
  );

  const result: Location[] = [];
  let serpentine = false;

  for (const zone of orderedZones) {
    const bins = grouped.get(zone)!;
    const byRow = new Map<number, Location[]>();
    for (const loc of bins) {
      if (!byRow.has(loc.row)) byRow.set(loc.row, []);
      byRow.get(loc.row)!.push(loc);
    }
    const rows = [...byRow.keys()].sort((a, b) => a - b);
    for (const row of rows) {
      const rowBins = byRow.get(row)!;
      rowBins.sort((a, b) => {
        const byBay = serpentine ? b.bay - a.bay : a.bay - b.bay;
        if (byBay !== 0) return byBay;
        return a.level - b.level;
      });
      result.push(...rowBins);
      serpentine = !serpentine;
    }
  }
  return result;
}

/** Estimated walking distance (metres) of a pick path. */
export function pathLength(path: Location[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    total += Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
  }
  return total;
}

/** Assign orders to waves: priority first, then due date. */
export function selectWaveOrders(orders: Order[], maxOrders: number): Order[] {
  const rank: Record<Priority, number> = { critical: 0, express: 1, standard: 2 };
  return [...orders]
    .sort((a, b) => rank[a.priority] - rank[b.priority] || a.dueAt - b.dueAt)
    .slice(0, maxOrders);
}

/** Group orders by carrier / destination region for transport consolidation. */
export function groupByRoute(
  orders: Order[],
  destinationOf: (order: Order) => string,
): Array<{ destination: string; orders: Order[] }> {
  const map = new Map<string, Order[]>();
  for (const order of orders) {
    const key = destinationOf(order);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(order);
  }
  return [...map.entries()].map(([destination, list]) => ({ destination, orders: list }));
}

/**
 * Wave code in the format used by real WMS systems: `WV-YYMMDD-NN`.
 */
export function waveCode(simMinutes: number, index: number): string {
  const day = Math.floor(simMinutes / 1440);
  const stamp = new Date(Date.UTC(2024, 0, 1 + day));
  const y = String(stamp.getUTCFullYear()).slice(2);
  const m = String(stamp.getUTCMonth() + 1).padStart(2, '0');
  const d = String(stamp.getUTCDate()).padStart(2, '0');
  return `WV-${y}${m}${d}-${String(index).padStart(2, '0')}`;
}
