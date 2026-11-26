/**
 * SISR — Slack Induction by String Removals (Christiaens & Vanden Berghe, Transportation Science 2020).
 *
 * One solution, many small "ruin & recreate" steps:
 *   - ruin: around a random stop, cut short strings (runs of neighbouring stops) out of a few nearby
 *     routes, sometimes keeping a piece in the middle ("split string"), sometimes a whole small route;
 *   - recreate: put the stops back one by one at the cheapest feasible place, skipping a few places
 *     at random ("blinks") so the search does not always do the same;
 *   - accept by simulated annealing (worse plans are accepted early, less and less later).
 * Cheap steps → tens of thousands of them in the time budget; every limit is kept at every step.
 */
import { loadPoints, LoadPoints, Model } from './model';
import { bestPairSpot, canHost, fitsAt, insertDelta, routeCost, shiftOk, Solution } from './solution';

export interface SearchOptions {
  deadline: number;
  rng: () => number;
  onProgress?: (fraction: number, best: number) => void;
  /** stop after this many steps (cooling then follows the steps, not the clock) */
  iters?: number;
  /** temperatures as a detour in km (defaults: 4 → 0.05) */
  t0Km?: number;
  tfKm?: number;
  quiet?: boolean;
}

const BLINK = 0.01;
const C_BAR = 10;
const L_MAX = 10;
const SPLIT_RATE = 0.5;
const SPLIT_DEPTH = 0.01;

/** Cheapest feasible insertion of job j; opens a new route when nothing fits */
export function insertJob(sol: Solution, j: number, rng: () => number, blink = BLINK): void {
  const m = sol.m;
  if (sol.where[j] >= 0) return;
  if (m.partner[j] >= 0) { insertTransfer(sol, j, rng, blink, true); return; }
  let bestRi = -1, bestPos = 0, bestDelta = Infinity;
  const tryRoute = (ri: number) => {
    const r = sol.routes[ri];
    if (!r.jobs.length || !canHost(m, r, j, sol.where, ri, !m.hasPairs)) return;
    // with transfers the load depends on the position: exact check per position
    const lp: LoadPoints | null = m.hasPairs ? loadPoints(m, r.jobs) : null;
    for (let pos = 0; pos <= r.jobs.length; pos++) {
      if (blink > 0 && rng() < blink) continue;
      if (lp && !fitsAt(m, r, lp, j, pos)) continue;
      const { dKm, dMin } = insertDelta(m, r, j, pos);
      if (!shiftOk(m, r.jobs.length + 1, r.min + dMin)) continue;
      const d = m.kmCost * dKm + m.minCost * dMin;
      if (d < bestDelta) { bestDelta = d; bestRi = ri; bestPos = pos; }
    }
  };
  if (m.lock[j] >= 0) {
    const ri = sol.routes.findIndex(r => r.tag === m.lock[j] && r.jobs.length);
    if (ri >= 0) {
      tryRoute(ri);
      if (bestRi < 0) {
        // the locked route is full: still keep the stop in it (as SMART does); cheapest position
        const r = sol.routes[ri];
        let bp = 0, bd = Infinity;
        for (let pos = 0; pos <= r.jobs.length; pos++) { const { dKm } = insertDelta(m, r, j, pos); if (dKm < bd) { bd = dKm; bp = pos; } }
        sol.insertJob(j, ri, bp);
        return;
      }
    }
  } else {
    // routes of the nearest stops first; all routes when there are few
    if (sol.routes.length <= 24) {
      for (let ri = 0; ri < sol.routes.length; ri++) tryRoute(ri);
    } else {
      const seen = new Set<number>();
      for (const nb of m.near[j]) {
        const ri = sol.where[nb];
        if (ri >= 0 && !seen.has(ri)) { seen.add(ri); tryRoute(ri); }
      }
      if (bestRi < 0) for (let ri = 0; ri < sol.routes.length; ri++) if (!seen.has(ri)) tryRoute(ri);
    }
  }
  if (bestRi >= 0 && bestDelta < m.routeCost + routeAloneDelta(sol, j)) sol.insertJob(j, bestRi, bestPos);
  else sol.newRoute(j);
}

/**
 * A transfer (j is its pickup or its drop): pickup and drop go into one route together, the pickup first,
 * at the cheapest places where the load fits all along the route. allowNew = false: no new route; false
 * when nothing fits.
 */
export function insertTransfer(sol: Solution, j: number, rng: () => number, blink = BLINK, allowNew = true): boolean {
  const m = sol.m;
  const p = m.pick[j] ? j : m.partner[j];
  const d = m.partner[p];
  // a half left in a route (should not happen) goes out first: the pair moves as one
  if (sol.where[p] >= 0) sol.removeJob(p);
  if (sol.where[d] >= 0) sol.removeJob(d);
  const tag = m.lock[p] >= 0 ? m.lock[p] : m.lock[d];
  let bestRi = -1, best: { a: number; b: number } | null = null, bestDelta = Infinity;
  const tryRoute = (ri: number) => {
    const r = sol.routes[ri];
    if (!r.jobs.length) return;
    const spot = bestPairSpot(m, r, ri, p, d, sol.where, rng, blink);
    if (!spot) return;
    const delta = m.kmCost * spot.dKm + m.minCost * spot.dMin;
    if (delta < bestDelta) { bestDelta = delta; bestRi = ri; best = spot; }
  };
  if (tag >= 0) {
    sol.routes.forEach((r, ri) => { if (r.tag === tag) tryRoute(ri); });
  } else if (sol.routes.length <= 24) {
    for (let ri = 0; ri < sol.routes.length; ri++) tryRoute(ri);
  } else {
    const seen = new Set<number>();
    for (const nb of [...m.near[p], ...m.near[d]]) {
      const ri = sol.where[nb];
      if (ri >= 0 && !seen.has(ri)) { seen.add(ri); tryRoute(ri); }
    }
    if (bestRi < 0) for (let ri = 0; ri < sol.routes.length; ri++) if (!seen.has(ri)) tryRoute(ri);
  }
  const md = m.matrix;
  const aloneKm = md.getDistance(0, m.first[p]) + md.getDistance(m.last[p], m.first[d]) + md.getDistance(m.last[d], 0);
  const aloneMin = md.getDuration(0, m.first[p]) + m.travelMin(m.last[p], m.first[d]) + md.getDuration(m.last[d], 0) + 2 * m.serviceMin;
  if (bestRi >= 0 && (!allowNew || bestDelta < m.routeCost + m.kmCost * aloneKm + m.minCost * aloneMin)) {
    const spot = best as unknown as { a: number; b: number };
    sol.insertPair(p, d, bestRi, spot.a, spot.b);
    return true;
  }
  if (!allowNew) return false;
  sol.newPairRoute(p, d);
  return true;
}

/** Cheapest feasible insertion without opening a route; false when nothing fits */
export function insertNoNew(sol: Solution, j: number, rng: () => number, bestFit = false): boolean {
  const m = sol.m;
  if (sol.where[j] >= 0) return true;
  if (m.partner[j] >= 0) return insertTransfer(sol, j, rng, BLINK, false);
  let bestRi = -1, bestPos = 0, bestDelta = Infinity;
  const capV = Math.min(m.globalV, m.trucks.length ? Math.max(...m.trucks.map(t => t.maxV)) : Infinity);
  const capW = Math.min(m.globalW, m.trucks.length ? Math.max(...m.trucks.map(t => t.maxW)) : Infinity);
  for (let ri = 0; ri < sol.routes.length; ri++) {
    const r = sol.routes[ri];
    if (!r.jobs.length || !canHost(m, r, j, sol.where, ri, !m.hasPairs)) continue;
    const lp: LoadPoints | null = m.hasPairs ? loadPoints(m, r.jobs) : null;
    // best fit: prefer the fullest truck the stop still fits in (bin packing), km as tie-break
    const fill = bestFit ? -Math.max(Number.isFinite(capV) ? (r.v + m.V[j]) / capV : 0, Number.isFinite(capW) ? (r.w + m.W[j]) / capW : 0) * 1e3 : 0;
    for (let pos = 0; pos <= r.jobs.length; pos++) {
      if (rng() < BLINK) continue;
      if (lp && !fitsAt(m, r, lp, j, pos)) continue;
      const { dKm, dMin } = insertDelta(m, r, j, pos);
      if (!shiftOk(m, r.jobs.length + 1, r.min + dMin)) continue;
      const d = fill + m.kmCost * dKm + m.minCost * dMin;
      if (d < bestDelta) { bestDelta = d; bestRi = ri; bestPos = pos; }
    }
  }
  if (bestRi < 0) return false;
  sol.insertJob(j, bestRi, bestPos);
  return true;
}

/** Can the whole load fit in k trucks at all (largest truck type, global limits)? */
export function fleetLowerBound(m: Model): number {
  let k = 1;
  while (!fleetLowerBoundOk(m, k) && k < m.J) k++;
  return k;
}

function fleetLowerBoundOk(m: Model, k: number): boolean {
  // what leaves the warehouse (goods of transfers come from stores)
  let w = 0, v = 0;
  for (let j = 0; j < m.J; j++) if (!m.tdrop[j]) { w += m.W[j]; v += m.V[j]; }
  const maxW = Math.min(m.globalW, m.trucks.length ? Math.max(...m.trucks.map(t => t.maxW)) : Infinity) * 1.03;
  const maxV = Math.min(m.globalV, m.trucks.length ? Math.max(...m.trucks.map(t => t.maxV)) : Infinity) * 1.03;
  return w <= k * maxW + 1e-9 && v <= k * maxV + 1e-9;
}

/**
 * Fleet minimisation of SISR: empty the smallest route and push its stops into the others with
 * ruin & recreate (no new routes). Stops that do not fit wait in an "absent" list; a plan is
 * accepted when fewer stops wait, or the same number with a lower sum of past absences.
 * Returns the plan with the fewest routes found (every limit kept).
 */
export function reduceFleet(start: Solution, opt: SearchOptions): Solution {
  const m = start.m;
  let best = start.clone();
  best.compact();
  const absences = new Float64Array(m.J);
  const t0 = Date.now();
  while (Date.now() < opt.deadline) {
    const live = best.routes.filter(r => r.jobs.length);
    if (live.length <= 1 || !fleetLowerBoundOk(m, live.length - 1)) break;
    // the route that is easiest to spread: least volume (free routes only)
    let target = -1, tv = Infinity;
    best.routes.forEach((r, ri) => {
      if (!r.jobs.length || r.tag >= 0) return;
      const size = r.v + r.w / 300 + r.jobs.reduce((a, j) => a + absences[j], 0) * 0.01;
      if (size < tv) { tv = size; target = ri; }
    });
    if (target < 0) break;
    let cur = best.clone();
    let curAbs = [...cur.routes[target].jobs];
    for (const j of curAbs) cur.removeJob(j);
    cur.compact();
    const sumAbs = (list: number[]) => list.reduce((a, j) => a + absences[j], 0);
    // a share of the remaining time for this attempt
    const attemptEnd = Math.min(opt.deadline, Date.now() + Math.max(300, (opt.deadline - t0) * 0.5));
    let ok = false;
    for (let it = 0; Date.now() < attemptEnd; it++) {
      const cand = cur.clone();
      // stops that were left out most often go back first (then the freshly removed ones)
      const removed = sortRemoved(m, ruin(cand, opt.rng), opt.rng);
      const pool = [...[...curAbs].sort((a, b) => absences[b] - absences[a]), ...removed];
      const left: number[] = [];
      const bestFit = opt.rng() < 0.5;
      for (const j of pool) if (!insertNoNew(cand, j, opt.rng, bestFit)) left.push(j);
      cand.compact();
      for (const j of left) absences[j]++;
      if (left.length < curAbs.length || (left.length === curAbs.length && sumAbs(left) < sumAbs(curAbs))) {
        cur = cand;
        curAbs = left;
      }
      if (!curAbs.length) { ok = true; break; }
    }
    debugLog(`reduceFleet: ${live.length} → ${live.length - 1} ${ok ? 'ok' : `failed, ${curAbs.length} stops left`}`);
    if (!ok) break;
    best = cur;
    opt.onProgress?.((Date.now() - t0) / Math.max(1, opt.deadline - t0), best.cost());
  }
  return best;
}

/** km/min part of the cost of a route with only job j */
function routeAloneDelta(sol: Solution, j: number): number {
  const m = sol.m;
  const md = m.matrix;
  const km = md.getDistance(0, m.first[j]) + m.innerKm[j] + md.getDistance(m.last[j], 0);
  const min = md.getDuration(0, m.first[j]) + m.serviceMin + m.innerMin[j] + md.getDuration(m.last[j], 0);
  return m.kmCost * km + m.minCost * min;
}

/** Order in which removed stops go back (random / big first / far first / close first, as in SISR) */
export function sortRemoved(m: Model, list: number[], rng: () => number): number[] {
  const x = rng() * 11;
  const far = (j: number) => m.matrix.getDistance(0, m.first[j]);
  if (x < 4) {
    for (let i = list.length - 1; i > 0; i--) { const k = Math.floor(rng() * (i + 1)); [list[i], list[k]] = [list[k], list[i]]; }
  } else if (x < 8) list.sort((a, b) => Math.max(m.V[b], m.W[b] / 300) - Math.max(m.V[a], m.W[a] / 300));
  else if (x < 10) list.sort((a, b) => far(b) - far(a));
  else list.sort((a, b) => far(a) - far(b));
  return list;
}

/** String removal around a random stop; returns the removed jobs */
export function ruin(sol: Solution, rng: () => number): number[] {
  const m = sol.m;
  const live = sol.routes.filter(r => r.jobs.length);
  if (!live.length) return [];
  const removed: number[] = [];
  // now and then: empty a whole small route (helps to need fewer trucks)
  if (live.length > 1 && rng() < 0.08) {
    let ri = -1, best = Infinity;
    sol.routes.forEach((r, i) => {
      if (!r.jobs.length || r.tag >= 0) return;
      const load = r.jobs.length + rng() * 2;
      if (load < best) { best = load; ri = i; }
    });
    if (ri >= 0) {
      for (const j of [...sol.routes[ri].jobs]) { sol.removeJob(j); removed.push(j); }
      return withPartners(sol, removed);
    }
  }
  const avgCard = m.J / live.length;
  const lsMax = Math.min(L_MAX, avgCard);
  const ksMax = (4 * C_BAR) / (1 + lsMax) - 1;
  const ks = Math.floor(rng() * ksMax) + 1;
  const seed = Math.floor(rng() * m.J);
  const ruined = new Set<number>();
  const candidates = [seed, ...m.near[seed]];
  for (const c of candidates) {
    if (ruined.size >= ks) break;
    const ri = sol.where[c];
    if (ri < 0 || ruined.has(ri)) continue;
    const r = sol.routes[ri];
    const card = r.jobs.length;
    const lMax = Math.min(card, lsMax);
    const l = Math.floor(rng() * lMax) + 1;
    const pos = r.jobs.indexOf(c);
    let cut: number[];
    if (l >= card || rng() < SPLIT_RATE) {
      // plain string of length l containing c
      const start = Math.max(0, Math.min(card - l, pos - Math.floor(rng() * l)));
      cut = r.jobs.slice(start, start + l);
    } else {
      // split string: l + keep stops, the `keep` in the middle stay
      let keep = 1;
      while (l + keep < card && rng() > SPLIT_DEPTH) keep++;
      const span = l + keep;
      const start = Math.max(0, Math.min(card - span, pos - Math.floor(rng() * span)));
      const seg = r.jobs.slice(start, start + span);
      const keepAt = Math.floor(rng() * (l + 1));
      cut = seg.filter((_, k) => k < keepAt || k >= keepAt + keep);
    }
    for (const j of cut) { sol.removeJob(j); removed.push(j); }
    ruined.add(ri);
  }
  return withPartners(sol, removed);
}

/** A transfer leaves its route as a whole: add the partners of the removed stops */
function withPartners(sol: Solution, removed: number[]): number[] {
  const m = sol.m;
  if (!m.hasPairs) return removed;
  for (let k = 0; k < removed.length; k++) {
    const q = m.partner[removed[k]];
    if (q >= 0 && sol.where[q] >= 0) { sol.removeJob(q); removed.push(q); }
  }
  return removed;
}

export function recreate(sol: Solution, removed: number[], rng: () => number): void {
  for (const j of sortRemoved(sol.m, removed, rng)) insertJob(sol, j, rng);
}

/** Greedy start: farthest stops first, each at its cheapest place */
export function construct(m: Model, rng: () => number): Solution {
  const sol = new Solution(m);
  const order = Array.from({ length: m.J }, (_, j) => j);
  // locked stops first so their routes exist
  order.sort((a, b) => (m.lock[b] >= 0 ? 1 : 0) - (m.lock[a] >= 0 ? 1 : 0) || m.matrix.getDistance(0, m.first[b]) - m.matrix.getDistance(0, m.first[a]));
  for (const j of order) insertJob(sol, j, rng, 0);
  sol.compact();
  return sol;
}

/** Temperature scale from the instance: a detour worth T0 km early, Tf km at the end */
function temperatures(m: Model): { t0: number; tf: number } {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const t0 = Number(env?.SISR_T0) || 4, tf = Number(env?.SISR_TF) || 0.05;
  return { t0: m.kmCost * t0, tf: m.kmCost * tf };
}

/**
 * The full SISR router: a short cost search, fleet minimisation, then the cost search again from
 * the smaller fleet; the cheaper of the two plans wins (a truck less is kept only if it pays).
 */
export function solveSISR(start: Solution, opt: SearchOptions): Solution {
  // small groups: a single long run tends to settle in one valley; independent restarts are safer
  const restarts = start.m.J <= 60 ? 3 : 1;
  if (restarts > 1) {
    const t0 = Date.now();
    const span = Math.max(1, opt.deadline - t0);
    let best: Solution | null = null;
    for (let k = 0; k < restarts; k++) {
      const from = k / restarts, to = (k + 1) / restarts;
      const s = solveOnce(k === 0 ? start : construct(start.m, opt.rng), {
        ...opt, deadline: t0 + span * to,
        onProgress: opt.onProgress && ((f: number, b: number) => opt.onProgress!(from + f * (to - from), Math.min(b, best?.cost() ?? Infinity))),
      });
      if (!best || s.cost() < best.cost()) best = s;
    }
    return best!;
  }
  return solveOnce(start, opt);
}

function solveOnce(start: Solution, opt: SearchOptions): Solution {
  const t0 = Date.now();
  const span = Math.max(1, opt.deadline - t0);
  const phase = (to: number, from: number) => ({ ...opt, deadline: t0 + span * to, onProgress: opt.onProgress && ((f: number, b: number) => opt.onProgress!(from + f * (to - from), b)) });
  const s1 = runSISR(start, phase(0.2, 0));
  // fleet minimisation only when fewer trucks can carry the load at all
  if (s1.routes.filter(r => r.jobs.length).length <= fleetLowerBound(s1.m)) return runSISR(s1, phase(1, 0.2));
  const s2 = reduceFleet(s1, phase(0.55, 0.2));
  if (s2.routes.filter(r => r.jobs.length).length >= s1.routes.filter(r => r.jobs.length).length) {
    // no truck saved: all the remaining time for the cost search
    return runSISR(s1, phase(1, 0.55));
  }
  const s3 = runSISR(s2, phase(1, 0.55));
  debugLog(`fleet ${s1.routes.length} → ${s3.routes.length}; cost ${s1.cost().toFixed(4)} vs ${s3.cost().toFixed(4)}`);
  return s3.cost() <= s1.cost() ? s3 : s1;
}

export function runSISR(start: Solution, opt: SearchOptions): Solution {
  const m = start.m;
  let cur = start.clone();
  let curCost = cur.cost();
  let best = cur.clone();
  let bestCost = curCost;
  const temp = temperatures(m);
  const t0 = opt.t0Km !== undefined ? m.kmCost * opt.t0Km : temp.t0;
  const tf = opt.tfKm !== undefined ? m.kmCost * opt.tfKm : temp.tf;
  const t0ms = Date.now();
  const span = Math.max(1, opt.deadline - t0ms);
  const maxIt = opt.iters ?? Infinity;
  let it = 0;
  while (it < maxIt) {
    if ((it & 31) === 0) {
      const now = Date.now();
      if (now >= opt.deadline) break;
      if ((it & 1023) === 0) opt.onProgress?.((now - t0ms) / span, bestCost);
    }
    it++;
    // cooling by time, or by iterations for a fixed number of them
    const frac = maxIt < Infinity ? it / maxIt : Math.min(1, (Date.now() - t0ms) / span);
    const T = t0 * Math.pow(tf / t0, frac);
    const cand = cur.clone();
    const removed = ruin(cand, opt.rng);
    recreate(cand, removed, opt.rng);
    const c = cand.cost();
    if (c < curCost - T * Math.log(opt.rng())) {
      cur = cand;
      curCost = c;
      if (c < bestCost - 1e-12) { best = cand.clone(); bestCost = c; }
    }
  }
  best.compact();
  if (!opt.quiet) debugLog(`SISR iterations ${it}, best ${bestCost.toFixed(4)}`);
  return best;
}

/** Debug output for the benchmark script (ADV_DEBUG=1), silent in the browser */
export function debugLog(msg: string): void {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (env?.ADV_DEBUG) console.log(`  [debug] ${msg}`);
}

export { routeCost };
