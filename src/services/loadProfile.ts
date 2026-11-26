/**
 * Load of a truck along its route, with store-to-store transfers.
 *
 * The truck leaves the warehouse with every delivery of the route that comes from the warehouse.
 * At each stop the load goes down by what is delivered; at a pickup it goes up by the transferred goods,
 * which go down again at their drop. A drop counts as a transfer only when its pickup comes earlier in
 * the same sequence; otherwise it is loaded at the warehouse (the safe reading, used e.g. when a router
 * sees a pickup and its drop as one stop).
 * Without transfers the peak is simply the sum of the route, as before.
 */
import type { Order } from '../types';

export interface Load { w: number; v: number }

type L = Pick<Order, 'weight' | 'volume' | 'stopType' | 'transferId' | 'transferWeight' | 'transferVolume'>;

const sum = (seq: readonly L[]): Load => {
  let w = 0, v = 0;
  for (const o of seq) { w += o.weight || 0; v += o.volume || 0; }
  return { w, v };
};

/** Highest load on the way, for a route in driving order */
export function peakLoad(seq: readonly L[]): Load {
  if (!seq.some(o => o.stopType === 'pickup')) return sum(seq);
  const pickedAt = new Map<string, number>();
  seq.forEach((o, i) => { if (o.stopType === 'pickup' && o.transferId && !pickedAt.has(o.transferId)) pickedAt.set(o.transferId, i); });
  const transferDrop = (o: L, i: number) => o.stopType === 'drop' && !!o.transferId && (pickedAt.get(o.transferId) ?? Infinity) < i;
  let w = 0, v = 0;
  seq.forEach((o, i) => { if (o.stopType !== 'pickup' && !transferDrop(o, i)) { w += o.weight || 0; v += o.volume || 0; } });
  let pw = w, pv = v;
  seq.forEach(o => {
    if (o.stopType === 'pickup') { w += o.transferWeight || 0; v += o.transferVolume || 0; }
    else { w -= o.weight || 0; v -= o.volume || 0; }
    if (w > pw) pw = w;
    if (v > pv) pv = v;
  });
  return { w: pw, v: pv };
}

/**
 * Lower bound of the peak for a set of stops whose order is unknown: what leaves the warehouse,
 * and the largest single transfer. No order of the stops can do better, so it never calls a feasible
 * route overloaded (the exact check is peakLoad on the real sequence).
 */
export function peakLoadUnordered(set: readonly L[]): Load {
  if (!set.some(o => o.stopType === 'pickup')) return sum(set);
  const picked = new Set(set.filter(o => o.stopType === 'pickup' && o.transferId).map(o => o.transferId!));
  let w = 0, v = 0, tw = 0, tv = 0;
  for (const o of set) {
    if (o.stopType === 'pickup') { tw = Math.max(tw, o.transferWeight || 0); tv = Math.max(tv, o.transferVolume || 0); continue; }
    if (o.stopType === 'drop' && o.transferId && picked.has(o.transferId)) continue;
    w += o.weight || 0; v += o.volume || 0;
  }
  return { w: Math.max(w, tw), v: Math.max(v, tv) };
}

/** Pickups whose drop is missing or comes first: such a route breaks the transfer rules */
export function precedenceOk(seq: readonly Pick<Order, 'stopType' | 'transferId'>[]): boolean {
  const seen = new Set<string>();
  const drops = new Set<string>();
  for (const o of seq) {
    if (!o.transferId) continue;
    if (o.stopType === 'pickup') { if (drops.has(o.transferId)) return false; seen.add(o.transferId); }
    else if (o.stopType === 'drop') drops.add(o.transferId);
  }
  for (const id of seen) if (!drops.has(id)) return false;
  return true;
}
