/**
 * Store-to-store transfers in Yol.
 *
 * A transfer moves goods from store A to store B. It is kept as two orders with one transferId:
 *   - pickup (at A): weight/volume 0, the moved load is in transferWeight/transferVolume;
 *   - drop   (at B): a normal delivery with the weight/volume.
 * Rules, the same for every router and for manual edits:
 *   1. both stops ride in one route, the pickup before the drop;
 *   2. every route starts and ends at the warehouse (also a route with transfers only);
 *   3. the drop decides: no drop in a route → no pickup either.
 * Because the pickup carries no load and the drop carries all of it, the usual "sum of the route"
 * load check stays safe: the truck never holds more than that sum at any point of the route.
 */
import type { Order, Route } from '../types';
import { calculateDistance } from './geo';
import { RoadMatrixLookup } from './optimizer/RoadMatrix';

export interface TransferStore {
  code: string;
  name: string;
  lat: number;
  lng: number;
  region?: string;
  warehouseType?: string;
}

export const isPickup = (o?: Pick<Order, 'stopType'> | null) => o?.stopType === 'pickup';
export const isTransferDrop = (o?: Pick<Order, 'stopType'> | null) => o?.stopType === 'drop';
export const isTransfer = (o?: Pick<Order, 'stopType'> | null) => o?.stopType === 'pickup' || o?.stopType === 'drop';
export const pickupIdOf = (dropId: string) => `${dropId}-pickup`;

/**
 * Turns a delivery into a transfer from `from`: returns [drop, pickup].
 * The drop keeps the id, the store, the load, the date and the slot of the delivery.
 */
export function makeTransfer(delivery: Order, from: TransferStore): [Order, Order] {
  const transferId = delivery.transferId || `tr-${delivery.id}`;
  const drop: Order = {
    ...delivery,
    stopType: 'drop',
    transferId,
    transferStoreCode: from.code,
    transferStoreName: from.name,
    transferWeight: undefined,
    transferVolume: undefined,
  };
  const pickup: Order = {
    ...delivery,
    id: pickupIdOf(delivery.id),
    orderNumber: delivery.orderNumber ? `${delivery.orderNumber}-P` : '',
    customerName: from.name,
    code: from.code,
    lat: from.lat,
    lng: from.lng,
    region: from.region ?? delivery.region,
    warehouseType: from.warehouseType ?? delivery.warehouseType,
    weight: 0,
    volume: 0,
    satir: 0,
    distance: undefined,
    stopType: 'pickup',
    transferId,
    transferStoreCode: delivery.code,
    transferStoreName: delivery.customerName,
    transferWeight: delivery.weight,
    transferVolume: delivery.volume,
    isLocked: delivery.isLocked,
    lockedRouteId: delivery.lockedRouteId,
  };
  return [drop, pickup];
}

/** pickup and drop of every transfer present in the list */
export function transferPairs(orders: Order[]): Map<string, { pickup?: Order; drop?: Order }> {
  const pairs = new Map<string, { pickup?: Order; drop?: Order }>();
  for (const o of orders) {
    if (!o.transferId || !isTransfer(o)) continue;
    const p = pairs.get(o.transferId) ?? {};
    if (o.stopType === 'pickup') p.pickup = o; else p.drop = o;
    pairs.set(o.transferId, p);
  }
  return pairs;
}

/** Adds the missing half of every transfer in `selected` (taken from `all`), so a router always gets whole pairs */
export function withPartners(selected: Order[], all: Order[]): Order[] {
  if (!selected.some(isTransfer)) return selected;
  const have = new Set(selected.map(o => o.id));
  const needed = new Set(selected.filter(isTransfer).map(o => o.transferId!));
  const extra = all.filter(o => o.transferId && needed.has(o.transferId) && isTransfer(o) && !have.has(o.id));
  return extra.length ? [...selected, ...extra] : selected;
}

/** Drops pickups whose drop is not in the list: such a pickup has nowhere to go */
export function withoutOrphanPickups(orders: Order[]): Order[] {
  if (!orders.some(isPickup)) return orders;
  const pairs = transferPairs(orders);
  const kept = orders.filter(o => !isPickup(o) || !!pairs.get(o.transferId!)?.drop);
  // the same array when nothing is dropped, so callers can compare by reference
  return kept.length === orders.length ? orders : kept;
}

export interface Point { lat: number; lng: number }

/** Cheapest place for the pickup before the drop at `dropIdx` (straight-line km, warehouse at both ends) */
function bestPickupSlot(seq: Order[], dropIdx: number, pickup: Order, depot: Point): number {
  const at = (k: number): Point => (k < 0 || k >= seq.length ? depot : seq[k]);
  const d = (a: Point, b: Point) => calculateDistance(a.lat, a.lng, b.lat, b.lng);
  let best = dropIdx, bestCost = Infinity;
  for (let k = 0; k <= dropIdx; k++) {
    const prev = at(k - 1), next = at(k);
    const c = d(prev, pickup) + d(pickup, next) - d(prev, next);
    if (c < bestCost - 1e-9) { bestCost = c; best = k; }
  }
  return best;
}

export interface NormalizeResult {
  routes: Route[];
  orders: Order[];
  /** true when something had to be fixed */
  changed: boolean;
  /** how many transfers were fixed */
  fixed: number;
}

/**
 * Makes every route follow the transfer rules (see the header). Works for the output of any router and
 * after manual edits; returns the same arrays when nothing is wrong, so it is safe to run repeatedly.
 * The drop stays where it is; its pickup is moved into the same route, before it, at the cheapest place.
 */
/**
 * Precedence-safe polish of one route (straight-line km): moves single stops to their cheapest place
 * while every pickup stays before its drop. Stops of the same store stay next to each other for free.
 */
export function polishRouteSequence(ids: string[], byId: Map<string, Order>, depot: Point): string[] {
  const seq = ids.slice();
  const n = seq.length;
  if (n < 3) return seq;
  const pt = (k: number): Point => (k < 0 || k >= seq.length ? depot : byId.get(seq[k]) ?? depot);
  const d = (a: Point, b: Point) => calculateDistance(a.lat, a.lng, b.lat, b.lng);
  const total = () => { let km = 0; for (let k = 0; k <= seq.length; k++) km += d(pt(k - 1), pt(k)); return km; };
  const valid = () => {
    const seen = new Set<string>();
    for (const id of seq) {
      const o = byId.get(id);
      if (o?.stopType === 'drop') {
        const pid = pickupIdOfDrop(o, byId);
        if (pid && !seen.has(pid) && seq.includes(pid)) return false;
      }
      seen.add(id);
    }
    return true;
  };
  let best = total();
  for (let pass = 0; pass < 20; pass++) {
    let improved = false;
    for (let i = 0; i < seq.length; i++) {
      const id = seq[i];
      seq.splice(i, 1);
      let bestPos = i, bestKm = Infinity;
      for (let k = 0; k <= seq.length; k++) {
        seq.splice(k, 0, id);
        if (valid()) { const km = total(); if (km < bestKm - 1e-9) { bestKm = km; bestPos = k; } }
        seq.splice(k, 1);
      }
      seq.splice(bestPos, 0, id);
      if (bestKm < best - 1e-6) { best = bestKm; improved = true; }
    }
    if (!improved) break;
  }
  return seq;
}

function pickupIdOfDrop(drop: Order, byId: Map<string, Order>): string | undefined {
  const guess = pickupIdOf(drop.id);
  if (byId.get(guess)?.transferId === drop.transferId) return guess;
  for (const o of byId.values()) if (o.stopType === 'pickup' && o.transferId === drop.transferId) return o.id;
  return undefined;
}

export function normalizeTransferRoutes(routes: Route[], orders: Order[], depot: Point, opts: { polish?: boolean } = {}): NormalizeResult {
  const pairs = transferPairs(orders);
  if (!pairs.size) return { routes, orders, changed: false, fixed: 0 };
  const byId = new Map(orders.map(o => [o.id, o]));
  const routeOf = new Map<string, number>();
  routes.forEach((r, ri) => r.orderIds.forEach(id => routeOf.set(id, ri)));

  const seqs = routes.map(r => r.orderIds.slice());
  let fixed = 0;
  const touched = new Set<number>();
  const remove = (ri: number, id: string) => {
    const k = seqs[ri].indexOf(id);
    if (k >= 0) { seqs[ri].splice(k, 1); touched.add(ri); }
  };

  for (const { pickup, drop } of pairs.values()) {
    if (!pickup) continue;
    const pr = routeOf.get(pickup.id);
    const dr = drop ? routeOf.get(drop.id) : undefined;
    if (dr === undefined) {
      // no drop in any route: the pickup leaves its route too
      if (pr !== undefined) { remove(pr, pickup.id); fixed++; }
      continue;
    }
    const seq = seqs[dr];
    const pIdx = pr === dr ? seq.indexOf(pickup.id) : -1;
    const dIdx = seq.indexOf(drop!.id);
    if (pIdx >= 0 && pIdx < dIdx) continue;
    if (pr !== undefined) remove(pr, pickup.id);
    const seqOrders = seqs[dr].map(id => byId.get(id)).filter((o): o is Order => !!o);
    const dropAt = seqOrders.findIndex(o => o.id === drop!.id);
    const slot = bestPickupSlot(seqOrders, dropAt, pickup, depot);
    // map the slot (index among known orders) back to the id list
    const before = slot < seqOrders.length ? seqOrders[slot].id : null;
    const insertAt = before ? seqs[dr].indexOf(before) : seqs[dr].length;
    seqs[dr].splice(insertAt, 0, pickup.id);
    touched.add(dr);
    fixed++;
  }
  // after a router: tidy the order of the routes that got a pickup (manual orders are left as the user set them)
  if (opts.polish) for (const ri of touched) seqs[ri] = polishRouteSequence(seqs[ri], byId, depot);

  if (!fixed) return { routes, orders, changed: false, fixed: 0 };

  // a changed route gets fresh straight-line km (road km come back with the next road calculation)
  const straightKm = (ids: string[]) => {
    let km = 0, prev: Point = depot;
    for (const id of ids) { const o = byId.get(id); if (!o) continue; km += calculateDistance(prev.lat, prev.lng, o.lat, o.lng); prev = o; }
    return Math.round((km + calculateDistance(prev.lat, prev.lng, depot.lat, depot.lng)) * 10) / 10;
  };
  const newRoutes = routes
    .map((r, ri) => {
      if (!touched.has(ri)) return r;
      const km = straightKm(seqs[ri]);
      return { ...r, orderIds: seqs[ri], straightDistanceKm: km, roadDistanceKm: undefined, roadDurationMin: undefined, distance: km, geometry: undefined, isRealRoad: false };
    })
    .filter(r => r.orderIds.length > 0 && !(r.orderIds.every(id => isPickup(byId.get(id)))));
  const finalRouteOf = new Map<string, string>();
  newRoutes.forEach(r => r.orderIds.forEach(id => finalRouteOf.set(id, r.id)));
  let ordersChanged = false;
  const newOrders = orders.map(o => {
    if (!isPickup(o)) return o;
    const rid = finalRouteOf.get(o.id);
    const status = rid ? 'in-route' as const : 'not-in-route' as const;
    if (o.routeId === rid && o.status === status) return o;
    ordersChanged = true;
    return { ...o, routeId: rid, status };
  });
  return { routes: newRoutes, orders: ordersChanged ? newOrders : orders, changed: true, fixed };
}

/** Just the rule check (for tests and validation): list of broken transfer ids */
export function brokenTransfers(routes: Route[], orders: Order[]): string[] {
  const routeOf = new Map<string, { ri: number; k: number }>();
  routes.forEach((r, ri) => r.orderIds.forEach((id, k) => routeOf.set(id, { ri, k })));
  const bad: string[] = [];
  for (const [tid, { pickup, drop }] of transferPairs(orders)) {
    const p = pickup ? routeOf.get(pickup.id) : undefined;
    const d = drop ? routeOf.get(drop.id) : undefined;
    if (!d && !p) continue;
    if (!d || !p || p.ri !== d.ri || p.k > d.k) bad.push(tid);
  }
  return bad;
}

// ---------------------------------------------------------------- routers: one node per transfer

export interface Contracted {
  /** orders for the router: every pickup is folded into its drop */
  orders: Order[];
  matrix: RoadMatrixLookup;
  /** router output (indices of the contracted list) → indices of the original list */
  expand: (routes: number[][]) => number[][];
  pairs: number;
}

/**
 * Folds every pickup → drop pair into one stop for the matrix-based routers (SMART, SISR, HGS).
 * The folded stop is entered at the pickup and left at the drop: the drive and the service between them
 * are added to every edge that enters it. So any route over the folded stops has the exact km and minutes
 * of the expanded route, and the pickup always comes right before its drop.
 */
export function contractTransfers(orders: Order[], matrix: RoadMatrixLookup, serviceMin: number): Contracted {
  const idx = new Map(orders.map((o, i) => [o.id, i + 1]));
  const pairs = transferPairs(orders);
  const pickupOfDrop = new Map<number, number>();
  for (const { pickup, drop } of pairs.values()) {
    if (pickup && drop && idx.has(pickup.id) && idx.has(drop.id)) pickupOfDrop.set(idx.get(drop.id)!, idx.get(pickup.id)!);
  }
  if (!pickupOfDrop.size) {
    return { orders, matrix, expand: r => r, pairs: 0 };
  }
  const folded = new Set(pickupOfDrop.values());
  // node k of the new matrix (k ≥ 1) → original nodes it stands for
  const entry: number[] = [0], exit: number[] = [0], newOrders: Order[] = [];
  orders.forEach((o, i) => {
    const node = i + 1;
    if (folded.has(node)) return;
    const p = pickupOfDrop.get(node);
    entry.push(p ?? node);
    exit.push(node);
    newOrders.push(o);
  });
  const n = newOrders.length + 1;
  const innerKm = entry.map((e, k) => (k > 0 && e !== exit[k] ? matrix.getDistance(e, exit[k]) : 0));
  const innerMin = entry.map((e, k) => (k > 0 && e !== exit[k] ? matrix.getDuration(e, exit[k]) + serviceMin : 0));
  const dist: number[][] = [], dur: number[][] = [];
  for (let a = 0; a < n; a++) {
    const dr: number[] = new Array(n), tr: number[] = new Array(n);
    for (let b = 0; b < n; b++) {
      if (a === b) { dr[b] = 0; tr[b] = 0; continue; }
      dr[b] = matrix.getDistance(exit[a], entry[b]) + innerKm[b];
      tr[b] = matrix.getDuration(exit[a], entry[b]) + innerMin[b];
    }
    dist.push(dr);
    dur.push(tr);
  }
  const m = new RoadMatrixLookup(n, dist, dur, matrix.isRealRoad, matrix.hasFallback, {
    totalPairs: matrix.totalPairs, roadPairs: matrix.roadPairs, fallbackPairs: matrix.fallbackPairs,
    coveragePercent: matrix.coveragePercent, cachedPairsCount: matrix.cachedPairsCount, fetchedPairsCount: matrix.fetchedPairsCount,
  });
  m.barrierInfo = matrix.barrierInfo;
  const expand = (routes: number[][]) => routes.map(r => r.flatMap(k => (entry[k] !== exit[k] ? [entry[k], exit[k]] : [exit[k]])));
  return { orders: newOrders, matrix: m, expand, pairs: pickupOfDrop.size };
}

// ---------------------------------------------------------------- Excel import

interface StoreLike { code: string; name: string; lat: number; lng: number; region?: string; warehouseType?: string }

/**
 * Rows with a filled «Откуда» become transfers. The sender is looked up first among the stores of the
 * same file (code, then name), then in the store directory. A sender that is not found leaves the row a
 * normal delivery from the warehouse; its value is returned in `unknown` so the user can fix the file.
 */
export function expandImportedTransfers(
  orders: (Order & { __from?: string })[],
  lookupDirectory: (code: string | undefined, name: string | undefined) => StoreLike | undefined
): { orders: Order[]; transfers: number; unknown: string[] } {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const inFileByCode = new Map<string, Order>(), inFileByName = new Map<string, Order>();
  for (const o of orders) {
    if (o.code && !inFileByCode.has(norm(o.code))) inFileByCode.set(norm(o.code), o);
    if (o.customerName && !inFileByName.has(norm(o.customerName))) inFileByName.set(norm(o.customerName), o);
  }
  const out: Order[] = [];
  const unknown = new Set<string>();
  let transfers = 0;
  for (const raw of orders) {
    const from = (raw.__from ?? '').trim();
    const { __from: _drop, ...o } = raw;
    void _drop;
    const empty = !from || from === '-' || /^(нет|no|yox|yok|склад|warehouse|anbar|depo)$/i.test(from);
    if (empty) { out.push(o); continue; }
    const key = norm(from);
    const fileHit = inFileByCode.get(key) ?? inFileByName.get(key);
    let src: TransferStore | undefined = fileHit
      ? { code: fileHit.code, name: fileHit.customerName, lat: fileHit.lat, lng: fileHit.lng, region: fileHit.region, warehouseType: fileHit.warehouseType }
      : undefined;
    if (!src) {
      const rec = lookupDirectory(from, undefined) ?? lookupDirectory(undefined, from);
      if (rec && Number.isFinite(rec.lat) && Number.isFinite(rec.lng)) src = { code: rec.code, name: rec.name, lat: rec.lat, lng: rec.lng, region: rec.region, warehouseType: rec.warehouseType };
    }
    const sameStore = src && ((src.code && o.code && norm(src.code) === norm(o.code)) || norm(src.name) === norm(o.customerName));
    if (!src || sameStore) { unknown.add(from); out.push(o); continue; }
    const [drop, pickup] = makeTransfer(o, src);
    out.push(pickup, drop);
    transfers++;
  }
  return { orders: out, transfers, unknown: [...unknown] };
}
