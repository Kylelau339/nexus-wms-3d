import { localize } from '../core/i18n';
import type { CustomerZone, Sku, Station, Zone } from './types';

/**
 * Business records carry both languages, so every place that shows one has to
 * pick the right variant. These helpers keep that decision in one place.
 */

export const skuName = (sku: Sku): string => localize(sku.name, sku.nameEn);
export const skuCategory = (sku: Sku): string => localize(sku.category, sku.categoryEn);

export function skuHazard(sku: Sku): string | null {
  if (!sku.hazardClass) return null;
  return localize(sku.hazardClass, sku.hazardClassEn ?? sku.hazardClass);
}

export const zoneName = (zone: Zone): string => localize(zone.name, zone.nameEn);
export const stationName = (station: Station): string => localize(station.name, station.nameEn);
export const customerZoneName = (zone: CustomerZone): string => localize(zone.name, zone.nameEn);
