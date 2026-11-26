/**
 * Compiled routing instance shared by the advanced routers (SISR, HGS).
 *
 * A "job" is what must ride in one truck as a unit: an order, or a group of orders that must stay
 * together (driven in a fixed internal order). Every Yol limit is checked here with the same rules as
 * ConstraintValidator.checkHardLimits (3% load tolerance, truck types and allowed ranks, lines,
 * stores and regions per route, pairs that must not ride together), plus the shift length.
 *
 * The objective mirrors the main terms of the SMART objective: the dispatcher's tariffs per truck and
 * per km (balanced by the optimisation mode) plus the route time, with SMART's own normalisation.
 */
import type { Order } from '../../../types';
import type { RoutingLimits } from '../../routingService';
import type { RoadMatrixLookup } from '../RoadMatrix';
import { SmartVRPConfig, normaliseWeights } from '../types';
import { LOAD_TOLERANCE_RATIO } from '../ConstraintValidator';
import { hasFleetLimits } from '../FleetAssignment';

const DEFAULT_COST_PER_ROUTE = 50;
const DEFAULT_COST_PER_KM = 2;

export interface TruckCap { id: string; rank: number; maxW: number; maxV: number; count: number }

export interface Model {
  /** number of jobs */
  J: number;
  /** matrix node indices of each job, in driving order (node 0 = depot) */
  nodes: Int32Array[];
  first: Int32Array;
  last: Int32Array;
  /** distance / time / service inside a job (constant) */
  innerKm: Float64Array;
  innerMin: Float64Array;
  W: Float64Array;
  V: Float64Array;
  S: Float64Array;
  /** smallest allowed truck rank of the job (Infinity = any) */
  rank: Float64Array;
  /** customer (store) ids and region ids of the job */
  cust: Int32Array[];
  firstCust: Int32Array;
  lastCust: Int32Array;
  regions: Int32Array[];
  /** jobs that must not share a route with this job */
  conflicts: Int32Array[];
  /** lock tag (-1 = free): a locked job can only ride in the route with its tag */
  lock: Int32Array;
  lockTags: string[];
  /** job count of nodes */
  matrix: RoadMatrixLookup;
  /** km / min between job ends */
  dist: (a: number, b: number) => number;
  /** travel time between two nodes with the "same store = no drive" rule of evaluateRouteSchedule */
  travelMin: (fromNode: number, toNode: number) => number;
  serviceMin: number;
  /** limits */
  trucks: TruckCap[];
  globalW: number;
  globalV: number;
  maxS: number;
  maxCust: number;
  maxRegions: number;
  maxRouteMin: number;
  maxVehicles: number;
  fleetLimited: boolean;
  /** objective: cost = routeCost per route + kmCost per km + minCost per minute */
  routeCost: number;
  kmCost: number;
  minCost: number;
  /** nearest jobs of each job (for ruin and granular moves) */
  near: Int32Array[];
  /** the order index (1-based, as in the optimizer) behind every node */
  nodeOrder: Int32Array;
  /** full objective of a plan given as node routes (the SMART objective); undefined = internal cost */
  scorer?: (routes: number[][]) => number;
  /**
   * Store-to-store transfers: a pickup job and its drop job are partners (-1 = none). Both ride in one
   * route, the pickup first. The pickup carries no load of its own (W, V = 0) and adds PW/PV on the way;
   * the drop (W, V = the moved goods) is not loaded at the warehouse.
   */
  partner: Int32Array;
  pick: Uint8Array;
  tdrop: Uint8Array;
  PW: Float64Array;
  PV: Float64Array;
  hasPairs: boolean;
}

export function compileModel(
  orderIndices: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  userConfig: SmartVRPConfig
): Model {
  const config = normaliseWeights(userConfig);
  const serviceMin = limits.serviceTimeMinutes ?? config.defaultServiceTimeMinutes ?? 10;
  const orderOf = (node: number) => ordersMap[node - 1];

  // ---- jobs: groups that must stay together, the rest one by one
  const inGroup = new Map<number, number>();
  const groups: number[][] = [];
  const nodeById = new Map(orderIndices.map(n => [orderOf(n)?.id, n]));
  // stops of a transfer move on their own (pickup and drop are kept together by the pair rules)
  const isTransferNode = (n: number) => { const o = orderOf(n); return !!o?.transferId && (o.stopType === 'pickup' || o.stopType === 'drop'); };
  for (const g of limits.mustStayTogether ?? []) {
    const members = (g ?? []).map(id => nodeById.get(id)).filter((n): n is number => n !== undefined && !inGroup.has(n) && !isTransferNode(n));
    if (members.length < 2) continue;
    // nearest-neighbour order inside the group
    const rest = [...members];
    const seq: number[] = [];
    let cur = 0;
    while (rest.length) {
      let bi = 0;
      for (let k = 1; k < rest.length; k++) if (matrix.getDistance(cur, rest[k]) < matrix.getDistance(cur, rest[bi])) bi = k;
      cur = rest.splice(bi, 1)[0];
      seq.push(cur);
    }
    for (const n of seq) inGroup.set(n, groups.length);
    groups.push(seq);
  }
  const jobNodes: number[][] = [...groups];
  for (const n of orderIndices) if (!inGroup.has(n)) jobNodes.push([n]);
  const J = jobNodes.length;

  // ---- ids for stores and regions
  const custId = new Map<string, number>();
  const regionId = new Map<string, number>();
  const idOf = (m: Map<string, number>, k: string) => { let v = m.get(k); if (v === undefined) m.set(k, (v = m.size)); return v; };

  const truckList = (limits.truckTypes ?? []).map(t => ({ id: t.id, rank: t.rank, maxW: t.maxWeight, maxV: t.maxVolume, count: typeof t.count === 'number' && t.count > 0 ? t.count : Infinity }));
  const rankOfAllowed = (allowed?: string) => {
    if (!allowed || !truckList.length) return Infinity;
    const norm = allowed.trim().toLowerCase();
    const t = (limits.truckTypes ?? []).find(x => x.id.toLowerCase() === norm || x.name.trim().toLowerCase() === norm);
    return t ? t.rank : Infinity;
  };

  const nodes: Int32Array[] = [], cust: Int32Array[] = [], regions: Int32Array[] = [];
  const first = new Int32Array(J), last = new Int32Array(J), firstCust = new Int32Array(J), lastCust = new Int32Array(J);
  const innerKm = new Float64Array(J), innerMin = new Float64Array(J);
  const W = new Float64Array(J), V = new Float64Array(J), S = new Float64Array(J), rank = new Float64Array(J);
  const lock = new Int32Array(J).fill(-1);
  const lockTags: string[] = [];
  const nodeCust = new Map<number, number>();
  for (const n of orderIndices) nodeCust.set(n, idOf(custId, orderOf(n)?.customerName ?? `#${n}`));
  const travelMin = (a: number, b: number) => (a > 0 && b > 0 && nodeCust.get(a) === nodeCust.get(b) ? 0 : matrix.getDuration(a, b));

  jobNodes.forEach((ns, j) => {
    nodes.push(Int32Array.from(ns));
    first[j] = ns[0];
    last[j] = ns[ns.length - 1];
    const cs = new Set<number>(), rs = new Set<number>();
    let w = 0, v = 0, s = 0, rk = Infinity;
    for (let k = 0; k < ns.length; k++) {
      const o = orderOf(ns[k]);
      w += o?.weight || 0; v += o?.volume || 0; s += o?.satir || 0;
      rk = Math.min(rk, rankOfAllowed(o?.allowedTruckType));
      cs.add(nodeCust.get(ns[k])!);
      rs.add(idOf(regionId, o?.region ?? ''));
      if (k > 0) {
        innerKm[j] += matrix.getDistance(ns[k - 1], ns[k]);
        innerMin[j] += travelMin(ns[k - 1], ns[k]) + (nodeCust.get(ns[k - 1]) === nodeCust.get(ns[k]) ? 0 : serviceMin);
      }
      const tag = o ? limits.lockedStops?.[o.id] : undefined;
      if (tag !== undefined && lock[j] < 0) {
        let ti = lockTags.indexOf(tag);
        if (ti < 0) { ti = lockTags.length; lockTags.push(tag); }
        lock[j] = ti;
      }
    }
    W[j] = w; V[j] = v; S[j] = s; rank[j] = rk;
    cust.push(Int32Array.from(cs));
    regions.push(Int32Array.from(rs));
    firstCust[j] = nodeCust.get(ns[0])!;
    lastCust[j] = nodeCust.get(ns[ns.length - 1])!;
  });

  // ---- store-to-store transfers: pickup ↔ drop partners
  const partner = new Int32Array(J).fill(-1), pick = new Uint8Array(J), tdrop = new Uint8Array(J);
  const PW = new Float64Array(J), PV = new Float64Array(J);
  {
    const pickOf = new Map<string, number>(), dropOf = new Map<string, number>();
    jobNodes.forEach((ns, j) => {
      if (ns.length !== 1) return;
      const o = orderOf(ns[0]);
      if (!o?.transferId) return;
      if (o.stopType === 'pickup') pickOf.set(o.transferId, j); else if (o.stopType === 'drop') dropOf.set(o.transferId, j);
    });
    for (const [tid, pj] of pickOf) {
      const dj = dropOf.get(tid);
      if (dj === undefined) continue;
      partner[pj] = dj; partner[dj] = pj; pick[pj] = 1; tdrop[dj] = 1;
      const po = orderOf(jobNodes[pj][0]);
      PW[pj] = po?.transferWeight ?? W[dj];
      PV[pj] = po?.transferVolume ?? V[dj];
      // a pickup does not count against the stores / regions per route limits
      cust[pj] = new Int32Array(0);
      regions[pj] = new Int32Array(0);
    }
  }
  const hasPairs = pick.some(x => x === 1);

  // ---- pairs that must not ride together
  const jobOfNode = new Map<number, number>();
  jobNodes.forEach((ns, j) => ns.forEach(n => jobOfNode.set(n, j)));
  const conf: Set<number>[] = Array.from({ length: J }, () => new Set());
  for (const [a, b] of limits.mustNotStayTogether ?? []) {
    const ja = jobOfNode.get(nodeById.get(a) ?? -1), jb = jobOfNode.get(nodeById.get(b) ?? -1);
    if (ja === undefined || jb === undefined || ja === jb) continue;
    conf[ja].add(jb);
    conf[jb].add(ja);
  }

  // ---- objective weights, the same mix as evaluateSolutionScore
  const costPerRoute = limits.costPerRoute > 0 ? limits.costPerRoute : DEFAULT_COST_PER_ROUTE;
  const costPerKm = limits.costPerKm > 0 ? limits.costPerKm : DEFAULT_COST_PER_KM;
  const mix = Math.max(0.0001, config.vehicleCountWeight + config.distanceWeight);
  const truckFactor = (2 * config.vehicleCountWeight) / mix;
  const kmFactor = (2 * config.distanceWeight) / mix;
  // SMART divides plan cost and time by instance baselines; the ratio of the two weights is what matters
  const n = orderIndices.length;
  let depotKm = 0, depotMin = 0, nnKm = 0, nnMin = 0, totalV = 0;
  for (const i of orderIndices) {
    depotKm += (matrix.getDistance(0, i) + matrix.getDistance(i, 0)) / 2;
    depotMin += (matrix.getDuration(0, i) + matrix.getDuration(i, 0)) / 2;
    let bk = Infinity, bm = 0;
    for (const j of orderIndices) if (i !== j && matrix.getDistance(i, j) < bk) { bk = matrix.getDistance(i, j); bm = matrix.getDuration(i, j); }
    if (bk < Infinity) { nnKm += bk; nnMin += bm; }
    totalV += orderOf(i)?.volume || 0;
  }
  const maxTruckV = limits.maxVolume > 0 ? limits.maxVolume : truckList.length ? Math.max(...truckList.map(t => t.maxV)) : 12;
  const minVehicles = Math.max(1, Math.ceil(totalV / Math.max(0.1, maxTruckV)));
  const baselineKm = Math.max(1, (2 * depotKm / Math.max(1, n)) * minVehicles + nnKm);
  const baselineMin = Math.max(1, (2 * depotMin / Math.max(1, n)) * minVehicles + nnMin + n * serviceMin);
  const baselineCost = Math.max(1, costPerRoute * minVehicles * truckFactor + costPerKm * baselineKm * kmFactor);
  const costScale = (config.distanceWeight + config.vehicleCountWeight) / baselineCost;
  const minScale = config.durationWeight / baselineMin;

  // ---- nearest jobs (by distance between job ends, both directions)
  const near: Int32Array[] = [];
  const K = Math.min(J - 1, 40);
  const dist = (a: number, b: number) => matrix.getDistance(last[a], first[b]);
  for (let a = 0; a < J; a++) {
    const cand: Array<[number, number]> = [];
    for (let b = 0; b < J; b++) if (b !== a) cand.push([b, Math.min(dist(a, b), dist(b, a))]);
    cand.sort((x, y) => x[1] - y[1]);
    near.push(Int32Array.from(cand.slice(0, K).map(c => c[0])));
  }

  const nodeOrder = new Int32Array(matrix.n);
  for (let i = 0; i < matrix.n; i++) nodeOrder[i] = i;

  return {
    J, nodes, first, last, innerKm, innerMin, W, V, S, rank, cust, firstCust, lastCust, regions,
    conflicts: conf.map(s => Int32Array.from(s)), lock, lockTags, matrix, dist, travelMin, serviceMin,
    trucks: truckList,
    globalW: limits.maxWeight > 0 ? limits.maxWeight : Infinity,
    globalV: limits.maxVolume > 0 ? limits.maxVolume : Infinity,
    maxS: limits.maxSatir > 0 ? limits.maxSatir : Infinity,
    maxCust: limits.maxCustomers > 0 ? limits.maxCustomers : Infinity,
    maxRegions: limits.maxRegions > 0 ? limits.maxRegions : Infinity,
    maxRouteMin: (config.maxRouteDurationHours ?? 10) * 60,
    maxVehicles: limits.maxVehicles && limits.maxVehicles > 0 ? limits.maxVehicles : Infinity,
    fleetLimited: hasFleetLimits(limits),
    routeCost: costPerRoute * truckFactor * costScale,
    kmCost: costPerKm * kmFactor * costScale,
    minCost: minScale,
    near, nodeOrder,
    partner, pick, tdrop, PW, PV, hasPairs,
  };
}

/** Highest weight/volume along a job sequence (see loadProfile.ts); the plain sum without transfers */
export function routePeak(m: Model, jobs: ArrayLike<number>): { w: number; v: number } {
  let w = 0, v = 0;
  for (let k = 0; k < jobs.length; k++) { const j = jobs[k]; if (!m.tdrop[j]) { w += m.W[j]; v += m.V[j]; } }
  if (!m.hasPairs) return { w, v };
  let pw = w, pv = v;
  for (let k = 0; k < jobs.length; k++) {
    const j = jobs[k];
    if (m.pick[j]) { w += m.PW[j]; v += m.PV[j]; } else { w -= m.W[j]; v -= m.V[j]; }
    if (w > pw) pw = w;
    if (v > pv) pv = v;
  }
  return { w: pw, v: pv };
}

/** Every pickup of the sequence has its drop later in it, every drop its pickup earlier */
export function pairsOk(m: Model, jobs: ArrayLike<number>): boolean {
  if (!m.hasPairs) return true;
  const pos = new Map<number, number>();
  for (let k = 0; k < jobs.length; k++) pos.set(jobs[k], k);
  for (let k = 0; k < jobs.length; k++) {
    const j = jobs[k], q = m.partner[j];
    if (q < 0) continue;
    const kq = pos.get(q);
    if (kq === undefined) return false;
    if (m.pick[j] ? kq < k : kq > k) return false;
  }
  return true;
}

/**
 * Load points of a route for O(1) insertion checks: L[0] = load leaving the warehouse, L[k+1] = after stop k.
 * pre[k] = max(L[0..k]), suf[k] = max(L[k..n]) (suf[n+1] = -Infinity).
 */
export interface LoadPoints { Lw: Float64Array; Lv: Float64Array; preW: Float64Array; preV: Float64Array; sufW: Float64Array; sufV: Float64Array }
export function loadPoints(m: Model, jobs: ArrayLike<number>): LoadPoints {
  const n = jobs.length;
  const Lw = new Float64Array(n + 1), Lv = new Float64Array(n + 1);
  let w = 0, v = 0;
  for (let k = 0; k < n; k++) { const j = jobs[k]; if (!m.tdrop[j]) { w += m.W[j]; v += m.V[j]; } }
  Lw[0] = w; Lv[0] = v;
  for (let k = 0; k < n; k++) {
    const j = jobs[k];
    if (m.pick[j]) { w += m.PW[j]; v += m.PV[j]; } else { w -= m.W[j]; v -= m.V[j]; }
    Lw[k + 1] = w; Lv[k + 1] = v;
  }
  const preW = new Float64Array(n + 1), preV = new Float64Array(n + 1), sufW = new Float64Array(n + 2), sufV = new Float64Array(n + 2);
  for (let k = 0; k <= n; k++) { preW[k] = Math.max(k ? preW[k - 1] : -Infinity, Lw[k]); preV[k] = Math.max(k ? preV[k - 1] : -Infinity, Lv[k]); }
  sufW[n + 1] = -Infinity; sufV[n + 1] = -Infinity;
  for (let k = n; k >= 0; k--) { sufW[k] = Math.max(sufW[k + 1], Lw[k]); sufV[k] = Math.max(sufV[k + 1], Lv[k]); }
  return { Lw, Lv, preW, preV, sufW, sufV };
}

/** Load check of checkHardLimits: global limits, then at least one truck type allowed for the route */
export function loadFits(m: Model, w: number, v: number, s: number, rank: number): boolean {
  const tol = LOAD_TOLERANCE_RATIO;
  if (w > m.globalW * tol || v > m.globalV * tol || s > m.maxS * tol) return false;
  if (!m.trucks.length) return true;
  for (const t of m.trucks) if (t.rank <= rank && w <= t.maxW * tol && v <= t.maxV * tol) return true;
  return false;
}
