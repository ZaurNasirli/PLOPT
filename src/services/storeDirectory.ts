import { Order, StoreRecord } from '../types';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function storeKeyOf(code: string | undefined, name: string | undefined): string {
  const c = norm(code || '');
  return c ? `c:${c}` : `n:${norm(name || '')}`;
}

export function buildStoreLookup(directory: StoreRecord[]) {
  const byKey = new Map(directory.map(r => [r.key, r]));
  const byName = new Map<string, StoreRecord>();
  for (const r of directory) {
    const n = norm(r.name);
    if (n && !byName.has(n)) byName.set(n, r);
  }
  return (code: string | undefined, name: string | undefined): StoreRecord | undefined =>
    byKey.get(storeKeyOf(code, name)) || (name ? byName.get(norm(name)) : undefined);
}

/**
 * Adds/updates the stores of an import in the directory.
 * Only orders whose coordinates came from the file itself (`trustedOrderIds`) update coordinates.
 */
export function upsertStores(
  directory: StoreRecord[],
  orders: Order[],
  trustedOrderIds: Set<string>
): { next: StoreRecord[]; added: number; updated: number } {
  const now = new Date().toISOString();
  const byKey = new Map(directory.map(r => [r.key, { ...r }]));
  const seenThisImport = new Set<string>();
  let added = 0;
  let updated = 0;

  for (const o of orders) {
    const key = storeKeyOf(o.code, o.customerName);
    if (!key || key === 'n:' || key === 'n:неизвестно') continue;
    const trusted = trustedOrderIds.has(o.id);
    const existing = byKey.get(key);

    if (!existing) {
      if (!trusted) continue; // never store a store without real coordinates
      byKey.set(key, {
        key, code: o.code || '', name: o.customerName, lat: o.lat, lng: o.lng,
        region: o.region, warehouseType: o.warehouseType, firstSeen: now, lastSeen: now, imports: 1
      });
      seenThisImport.add(key);
      added++;
      continue;
    }

    if (!seenThisImport.has(key)) {
      existing.lastSeen = now;
      existing.imports += 1;
      seenThisImport.add(key);
    }
    let changed = false;
    if (trusted && (Math.abs(existing.lat - o.lat) > 1e-5 || Math.abs(existing.lng - o.lng) > 1e-5)) {
      existing.lat = o.lat;
      existing.lng = o.lng;
      changed = true;
    }
    if (o.customerName && existing.name !== o.customerName) { existing.name = o.customerName; changed = true; }
    if (o.region && existing.region !== o.region) { existing.region = o.region; changed = true; }
    if (o.warehouseType && existing.warehouseType !== o.warehouseType) { existing.warehouseType = o.warehouseType; changed = true; }
    if (changed) updated++;
  }

  return { next: Array.from(byKey.values()), added, updated };
}
