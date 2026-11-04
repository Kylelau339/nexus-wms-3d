import { msg, type Message } from '../core/i18n';
import { skuName } from './labels';
import type { AsLine, Lot, Movement, MovementKind, Sku } from './types';

export interface Allocation {
  locationId: string;
  lotId: string;
  skuId: string;
  qty: number;
  /** How much of this allocation has already been committed (picked). */
  picked?: number;
}

/**
 * Lot-level inventory ledger.
 *
 * Every quantity change produces an immutable movement record so that the UI can
 * show a full traceability chain from goods-in through to customer delivery.
 */
export class Inventory {
  readonly lotsByLocation = new Map<string, Lot[]>();
  readonly lotsBySku = new Map<string, Lot[]>();
  readonly movements: Movement[] = [];
  /** Per-location weight tally (kg) used for utilisation. */
  readonly weightByLocation = new Map<string, number>();
  readonly volumeByLocation = new Map<string, number>();

  private moveSeq = 1;
  private skuIndex = new Map<string, Sku>();
  private reserved = new Map<string, number>();

  constructor(skus: Sku[]) {
    for (const sku of skus) {
      this.skuIndex.set(sku.id, sku);
      this.lotsBySku.set(sku.id, []);
    }
  }

  sku(id: string): Sku | undefined {
    return this.skuIndex.get(id);
  }

  /** On-hand quantity for a SKU across every location. */
  onHand(skuId: string): number {
    let total = 0;
    for (const lot of this.lotsBySku.get(skuId) ?? []) total += lot.qty;
    return total;
  }

  reservedQty(skuId: string): number {
    return this.reserved.get(skuId) ?? 0;
  }

  available(skuId: string): number {
    return this.onHand(skuId) - this.reservedQty(skuId);
  }

  locationWeight(locationId: string): number {
    return this.weightByLocation.get(locationId) ?? 0;
  }

  locationVolume(locationId: string): number {
    return this.volumeByLocation.get(locationId) ?? 0;
  }

  lotsAt(locationId: string): Lot[] {
    return this.lotsByLocation.get(locationId) ?? [];
  }

  /** Receive stock into a location (creates a lot when the SKU is new there). */
  receive(
    skuId: string,
    locationId: string,
    qty: number,
    ref: string,
    at: number,
    lotNo?: string,
  ): Lot | null {
    const sku = this.skuIndex.get(skuId);
    if (!sku || qty <= 0) return null;

    const existing = (this.lotsByLocation.get(locationId) ?? []).find((l) => l.skuId === skuId);
    let lot: Lot;
    if (existing) {
      existing.qty += qty;
      lot = existing;
    } else {
      lot = {
        id: `${locationId}/${skuId}/${this.moveSeq}`,
        skuId,
        locationId,
        qty,
        reservedQty: 0,
        lotNo: lotNo ?? `L${String(this.moveSeq).padStart(7, '0')}`,
        expiryDays: sku.tempZone === 'frozen' ? 540 : sku.tempZone === 'chilled' ? 21 : null,
        receivedAt: at,
      };
      if (!this.lotsByLocation.has(locationId)) this.lotsByLocation.set(locationId, []);
      this.lotsByLocation.get(locationId)!.push(lot);
      if (!this.lotsBySku.has(skuId)) this.lotsBySku.set(skuId, []);
      this.lotsBySku.get(skuId)!.push(lot);
    }

    this.adjust(locationId, qty * sku.unitWeight, qty * sku.unitVolume);
    this.record('receipt', skuId, qty, null, locationId, ref, msg('收貨入庫 {0}', () => skuName(sku)), at);
    return lot;
  }

  /** Move stock between two locations (put-away, replenishment, staging). */
  transfer(
    skuId: string,
    from: string,
    to: string,
    qty: number,
    ref: string,
    at: number,
    kind: MovementKind = 'putaway',
    note?: Message,
  ): number {
    const sku = this.skuIndex.get(skuId);
    if (!sku) return 0;
    const moved = this.remove(from, sku, qty, ref, at, kind, note);
    if (moved <= 0) return 0;
    this.receive(skuId, to, moved, ref, at);
    return moved;
  }

  /** Remove stock (picking, shipping). */
  remove(
    locationId: string,
    sku: Sku,
    qty: number,
    ref: string,
    at: number,
    kind: MovementKind = 'pick',
    note?: Message,
  ): number {
    const lots = this.lotsByLocation.get(locationId);
    if (!lots || lots.length === 0) return 0;
    let remaining = qty;
    let removed = 0;
    for (const lot of lots) {
      if (remaining <= 0) break;
      if (lot.skuId !== sku.id) continue;
      const take = Math.min(lot.qty, remaining);
      lot.qty -= take;
      remaining -= take;
      removed += take;
      // Reservations follow the goods: a lot can never hold more reserved than it has on hand.
      this.releaseLotReservation(lot, take);
      this.adjust(locationId, -take * sku.unitWeight, -take * sku.unitVolume);
    }
    this.prune(lots);
    this.prune(this.lotsBySku.get(sku.id) ?? []);
    if (removed > 0) {
      this.record(
        kind,
        sku.id,
        removed,
        locationId,
        null,
        ref,
        note ?? msg('揀取 {0}', () => skuName(sku)),
        at,
      );
    }
    return removed;
  }

  /** Reserve available stock for an order, preferring ABC-A fast movers in flow zones. */
  allocate(skuId: string, qty: number, locationIds: Set<string>): Allocation[] {
    const allocations: Allocation[] = [];
    let remaining = qty;
    const candidates = (this.lotsBySku.get(skuId) ?? [])
      .filter((l) => l.qty - l.reservedQty > 0 && locationIds.has(l.locationId))
      .sort((a, b) => b.reservedQty - a.reservedQty || a.locationId.localeCompare(b.locationId));

    for (const lot of candidates) {
      if (remaining <= 0) break;
      const free = lot.qty - lot.reservedQty;
      const take = Math.min(free, remaining);
      lot.reservedQty += take;
      remaining -= take;
      allocations.push({ locationId: lot.locationId, lotId: lot.id, skuId: skuId, qty: take });
      this.reserved.set(skuId, this.reservedQty(skuId) + take);
    }
    return allocations;
  }

  /**
   * Confirm a reservation as physically picked.
   *
   * Each allocation is consumed exactly once: the part that was physically picked is
   * removed from the lot and released from the reservation, and any shortfall is
   * released as well so the promise does not stay outstanding against goods that are
   * no longer there. Callers must **not** release the same allocations again.
   */
  commitPick(allocations: Allocation[], ref: string, at: number): number {
    const pickedBySku = new Map<string, number>();

    for (const alloc of allocations) {
      const alreadyPicked = alloc.picked ?? 0;
      const outstanding = alloc.qty - alreadyPicked;
      if (outstanding <= 0) continue;

      const lot = this.findLot(alloc.lotId);
      if (!lot) {
        // The goods are gone — give the reservation back so other orders can use it.
        this.reserved.set(
          alloc.skuId,
          Math.max(0, this.reservedQty(alloc.skuId) - outstanding),
        );
        alloc.picked = alloc.qty;
        continue;
      }

      // Always convert with the lot's own SKU: a bin can hold several SKUs and a
      // caller may hand us allocations for more than one of them.
      const lotSku = this.skuIndex.get(lot.skuId);
      if (!lotSku) continue;

      const take = Math.min(lot.qty, outstanding);
      lot.qty -= take;
      alloc.picked = alreadyPicked + take;
      this.adjust(lot.locationId, -take * lotSku.unitWeight, -take * lotSku.unitVolume);
      pickedBySku.set(lot.skuId, (pickedBySku.get(lot.skuId) ?? 0) + take);

      // Release what was picked, plus the shortfall we can no longer honour.
      this.releaseLotReservation(lot, take);
      if (take < outstanding) {
        this.releaseLotReservation(lot, outstanding - take);
      }
    }

    for (const [skuId, qty] of pickedBySku) {
      const sku = this.skuIndex.get(skuId);
      this.record(
        'pick',
        skuId,
        qty,
        null,
        null,
        ref,
        msg('揀貨出庫 {0}', () => (sku ? skuName(sku) : skuId)),
        at,
      );
    }
    let total = 0;
    for (const qty of pickedBySku.values()) total += qty;
    return total;
  }

  /**
   * Release up to `qty` of a lot's reservation and keep the per-SKU tally in sync.
   * Returns the amount actually released.
   */
  private releaseLotReservation(lot: Lot, qty: number): number {
    const release = Math.min(lot.reservedQty, Math.max(0, qty));
    if (release <= 0) return 0;
    lot.reservedQty -= release;
    this.reserved.set(lot.skuId, Math.max(0, this.reservedQty(lot.skuId) - release));
    return release;
  }

  private findLot(lotId: string): Lot | undefined {
    for (const lots of this.lotsBySku.values()) {
      for (const lot of lots) {
        if (lot.id === lotId) return lot;
      }
    }
    return undefined;
  }

  /** Release reservations without moving stock (order cancelled / short-ship). */
  releaseReservations(allocations: Allocation[]): void {
    for (const alloc of allocations) {
      const lot = this.findLot(alloc.lotId);
      if (!lot) continue;
      this.releaseLotReservation(lot, alloc.qty - (alloc.picked ?? 0));
    }
  }

  private adjust(locationId: string, weightDelta: number, volumeDelta: number): void {
    const w = (this.weightByLocation.get(locationId) ?? 0) + weightDelta;
    const v = (this.volumeByLocation.get(locationId) ?? 0) + volumeDelta;
    this.weightByLocation.set(locationId, Math.max(0, w));
    this.volumeByLocation.set(locationId, Math.max(0, v));
  }

  private prune(lots: Lot[]): void {
    for (let i = lots.length - 1; i >= 0; i--) {
      if (lots[i]!.qty <= 0 && lots[i]!.reservedQty <= 0) lots.splice(i, 1);
    }
  }

  private record(
    kind: MovementKind,
    skuId: string,
    qty: number,
    from: string | null,
    to: string | null,
    ref: string,
    note: Message,
    at: number,
  ): void {
    this.movements.push({
      id: this.moveSeq++,
      kind,
      skuId,
      qty,
      fromLocationId: from,
      toLocationId: to,
      at,
      ref,
      note,
    });
    if (this.movements.length > 6000) this.movements.splice(0, 1000);
  }

  /** Total value of on-hand stock. */
  inventoryValue(): number {
    let total = 0;
    for (const [skuId, lots] of this.lotsBySku) {
      const sku = this.skuIndex.get(skuId);
      if (!sku) continue;
      let qty = 0;
      for (const lot of lots) qty += lot.qty;
      total += qty * sku.unitPrice;
    }
    return total;
  }

  /** Total units currently held in the warehouse. */
  totalUnits(): number {
    let total = 0;
    for (const lots of this.lotsBySku.values()) {
      for (const lot of lots) total += lot.qty;
    }
    return total;
  }

  static asLinesToSkuQty(lines: AsLine[]): number {
    return lines.reduce((sum, l) => sum + l.qty, 0);
  }
}
