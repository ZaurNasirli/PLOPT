/**
 * Solution of the advanced routers: routes as lists of jobs with their load, km and minutes.
 * Feasibility of an insertion is checked incrementally against every Yol limit (see model.ts).
 */
import { LOAD_TOLERANCE_RATIO } from '../ConstraintValidator';
import { loadFits, Model } from './model';

export interface Route {
  jobs: number[];
  w: number;
  v: number;
  s: number;
  rank: number;
  km: number;
  min: number;
  /** lock tag of the route (-1 = none) */
  tag: number;
}

export const emptyRoute = (tag = -1): Route => ({ jobs: [], w: 0, v: 0, s: 0, rank: Infinity, km: 0, min: 0, tag });

/** km and minutes of a job sequence (depot → jobs → depot) */
export function seqCost(m: Model, jobs: ArrayLike<number>): { km: number; min: number } {
  const n = jobs.length;
  if (!n) return { km: 0, min: 0 };
  let km = 0, min = 0, prev = 0, prevCust = -1;
  for (let k = 0; k < n; k++) {
    const j = jobs[k];
    const f = m.first[j];
    km += m.matrix.getDistance(prev, f) + m.innerKm[j];
    min += m.travelMin(prev, f) + (prevCust === m.firstCust[j] ? 0 : m.serviceMin) + m.innerMin[j];
    prev = m.last[j];
    prevCust = m.lastCust[j];
  }
  km += m.matrix.getDistance(prev, 0);
  min += m.matrix.getDuration(prev, 0);
  return { km, min };
}

export function refresh(m: Model, r: Route): void {
  let w = 0, v = 0, s = 0, rank = Infinity;
  for (const j of r.jobs) { w += m.W[j]; v += m.V[j]; s += m.S[j]; if (m.rank[j] < rank) rank = m.rank[j]; }
  r.w = w; r.v = v; r.s = s; r.rank = rank;
  const c = seqCost(m, r.jobs);
  r.km = c.km;
  r.min = c.min;
}

export const routeCost = (m: Model, r: Route) => (r.jobs.length ? m.routeCost + m.kmCost * r.km + m.minCost * r.min : 0);

/** Can job j ride in route r (ignoring the position-dependent shift length)? */
export function canHost(m: Model, r: Route, j: number, where: Int32Array, ri: number): boolean {
  if (m.lock[j] >= 0 && r.tag !== m.lock[j]) return false;
  if (!r.jobs.length) return true;
  if (!loadFits(m, r.w + m.W[j], r.v + m.V[j], r.s + m.S[j], Math.min(r.rank, m.rank[j]))) return false;
  for (const c of m.conflicts[j]) if (where[c] === ri) return false;
  if (m.maxCust < Infinity || m.maxRegions < Infinity) {
    const cs = new Set<number>(m.cust[j]), rs = new Set<number>(m.regions[j]);
    for (const x of r.jobs) { for (const c of m.cust[x]) cs.add(c); for (const g of m.regions[x]) rs.add(g); }
    if (cs.size > m.maxCust * LOAD_TOLERANCE_RATIO) return false;
    if (rs.size > m.maxRegions) return false;
  }
  return true;
}

/** Change of km and minutes when job j is inserted before position pos of route r */
export function insertDelta(m: Model, r: Route, j: number, pos: number): { dKm: number; dMin: number } {
  const jobs = r.jobs;
  const prevJ = pos > 0 ? jobs[pos - 1] : -1;
  const nextJ = pos < jobs.length ? jobs[pos] : -1;
  const prev = prevJ >= 0 ? m.last[prevJ] : 0;
  const next = nextJ >= 0 ? m.first[nextJ] : 0;
  const prevCust = prevJ >= 0 ? m.lastCust[prevJ] : -1;
  const nextCust = nextJ >= 0 ? m.firstCust[nextJ] : -2;
  const md = m.matrix;
  const dKm = md.getDistance(prev, m.first[j]) + m.innerKm[j] + md.getDistance(m.last[j], next) - md.getDistance(prev, next);
  // travelMin is the plain matrix time whenever one end is the depot
  let dMin = m.travelMin(prev, m.first[j]) + m.innerMin[j] + m.travelMin(m.last[j], next) - m.travelMin(prev, next);
  const sv = m.serviceMin;
  dMin += (prevCust === m.firstCust[j] ? 0 : sv);
  if (nextJ >= 0) dMin += (m.lastCust[j] === nextCust ? 0 : sv) - (prevCust === nextCust ? 0 : sv);
  return { dKm, dMin };
}

export class Solution {
  routes: Route[];
  where: Int32Array;
  constructor(readonly m: Model, routes: Route[] = [], where?: Int32Array) {
    this.routes = routes;
    this.where = where ?? new Int32Array(m.J).fill(-1);
  }

  clone(): Solution {
    return new Solution(this.m, this.routes.map(r => ({ ...r, jobs: r.jobs.slice() })), this.where.slice());
  }

  static fromJobLists(m: Model, lists: number[][]): Solution {
    const s = new Solution(m);
    for (const jobs of lists) {
      if (!jobs.length) continue;
      const tag = jobs.map(j => m.lock[j]).find(t => t >= 0) ?? -1;
      const r: Route = { ...emptyRoute(tag), jobs: jobs.slice() };
      refresh(m, r);
      const ri = s.routes.length;
      s.routes.push(r);
      for (const j of jobs) s.where[j] = ri;
    }
    return s;
  }

  /** Objective of the plan: the SMART objective when the model has it, else tariffs + time + penalties */
  cost(): number {
    if (this.m.scorer) return this.m.scorer(this.toNodeRoutes());
    return this.internalCost();
  }

  /** Route costs + penalties for too many trucks / no truck of a limited type */
  internalCost(): number {
    let c = 0, k = 0;
    for (const r of this.routes) if (r.jobs.length) { c += routeCost(this.m, r); k++; }
    if (k > this.m.maxVehicles) c += (k - this.m.maxVehicles) * 25;
    if (this.m.fleetLimited) c += fleetShortage(this.m, this.routes) * 25;
    return c;
  }

  removeJob(j: number): void {
    const ri = this.where[j];
    if (ri < 0) return;
    const r = this.routes[ri];
    const k = r.jobs.indexOf(j);
    if (k >= 0) r.jobs.splice(k, 1);
    this.where[j] = -1;
    refresh(this.m, r);
  }

  insertJob(j: number, ri: number, pos: number): void {
    const r = this.routes[ri];
    r.jobs.splice(pos, 0, j);
    this.where[j] = ri;
    refresh(this.m, r);
    if (this.m.lock[j] >= 0) r.tag = this.m.lock[j];
  }

  newRoute(j: number): void {
    const r: Route = { ...emptyRoute(this.m.lock[j]), jobs: [j] };
    refresh(this.m, r);
    // reuse an empty slot
    let ri = this.routes.findIndex(x => !x.jobs.length && x.tag < 0);
    if (ri < 0) { ri = this.routes.length; this.routes.push(r); } else this.routes[ri] = r;
    this.where[j] = ri;
  }

  /** Drops empty routes and renumbers `where` */
  compact(): void {
    const keep = this.routes.filter(r => r.jobs.length);
    this.routes = keep;
    keep.forEach((r, ri) => r.jobs.forEach(j => { this.where[j] = ri; }));
  }

  /** Routes as lists of matrix nodes (orders), in driving order */
  toNodeRoutes(): number[][] {
    return this.routes.filter(r => r.jobs.length).map(r => r.jobs.flatMap(j => Array.from(this.m.nodes[j])));
  }
}

/** Trucks missing when every route takes the smallest fitting type that is still available (FleetAssignment rules) */
export function fleetShortage(m: Model, routes: Route[]): number {
  const types = [...m.trucks].sort((a, b) => a.rank - b.rank || a.maxV - b.maxV);
  if (!types.length) return 0;
  const biggest = types[types.length - 1];
  const left = types.map(t => t.count);
  const tol = LOAD_TOLERANCE_RATIO;
  const list = routes.filter(r => r.jobs.length)
    .map(r => ({ r, d: Math.max(r.v / Math.max(0.1, biggest.maxV), r.w / Math.max(1, biggest.maxW)) }))
    .sort((a, b) => b.d - a.d);
  let missing = 0;
  for (const { r } of list) {
    let ok = false;
    for (let k = 0; k < types.length; k++) {
      const t = types[k];
      if (t.rank > r.rank || r.w > t.maxW * tol || r.v > t.maxV * tol) continue;
      if (left[k] > 0) { left[k]--; ok = true; break; }
    }
    if (!ok) missing++;
  }
  return missing;
}

/** Shift length check for a route after a change (single-job routes are always allowed) */
export const shiftOk = (m: Model, jobsAfter: number, minAfter: number) => jobsAfter <= 1 || minAfter <= m.maxRouteMin;
