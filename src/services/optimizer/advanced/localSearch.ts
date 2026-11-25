/**
 * Local search of the advanced routers (only improving, every limit kept):
 *   - inside a route: 2-opt (reverse a piece), or-opt (move a run of 1–3 stops);
 *   - between routes (granular: only towards the nearest stops): relocate a stop, swap two stops,
 *     2-opt* (exchange route tails).
 * Used by HGS to "educate" every child and by both routers as the final polish.
 */
import { LOAD_TOLERANCE_RATIO } from '../ConstraintValidator';
import { loadFits, Model } from './model';
import { refresh, seqCost, shiftOk, Solution } from './solution';

const EPS = 1e-9;

const seqPrice = (m: Model, jobs: number[]) => {
  if (!jobs.length) return { price: 0, min: 0 };
  const c = seqCost(m, jobs);
  return { price: m.routeCost + m.kmCost * c.km + m.minCost * c.min, min: c.min };
};

/** All limits of a whole route (loads, truck ranks, stores, regions, conflicts, locks, shift) */
export function routeFeasible(m: Model, jobs: number[], tag: number): { ok: boolean; price: number } {
  if (!jobs.length) return { ok: true, price: 0 };
  let w = 0, v = 0, s = 0, rank = Infinity;
  for (const j of jobs) {
    w += m.W[j]; v += m.V[j]; s += m.S[j]; if (m.rank[j] < rank) rank = m.rank[j];
    if (m.lock[j] >= 0 && m.lock[j] !== tag) return { ok: false, price: 0 };
  }
  const { price, min } = seqPrice(m, jobs);
  if (jobs.length > 1) {
    if (!loadFits(m, w, v, s, rank)) return { ok: false, price };
    if (!shiftOk(m, jobs.length, min)) return { ok: false, price };
    if (m.maxCust < Infinity || m.maxRegions < Infinity) {
      const cs = new Set<number>(), rs = new Set<number>();
      for (const x of jobs) { for (const c of m.cust[x]) cs.add(c); for (const g of m.regions[x]) rs.add(g); }
      if (cs.size > m.maxCust * LOAD_TOLERANCE_RATIO || rs.size > m.maxRegions) return { ok: false, price };
    }
    const inRoute = new Set(jobs);
    for (const j of jobs) for (const c of m.conflicts[j]) if (inRoute.has(c)) return { ok: false, price };
  }
  return { ok: true, price };
}

function improveIntra(m: Model, jobs: number[]): number[] {
  let best = jobs.slice();
  let bestPrice = seqPrice(m, best).price;
  const n = best.length;
  if (n < 3) {
    if (n === 2) {
      const rev = [best[1], best[0]];
      const p = seqPrice(m, rev).price;
      if (p < bestPrice - EPS && shiftOk(m, 2, seqCost(m, rev).min)) return rev;
    }
    return best;
  }
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    // 2-opt
    for (let i = 0; i < n - 1 && !improved; i++) {
      for (let k = i + 1; k < n && !improved; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const p = seqPrice(m, cand);
        if (p.price < bestPrice - EPS && shiftOk(m, n, p.min)) { best = cand; bestPrice = p.price; improved = true; }
      }
    }
    // or-opt: move a run of 1..3 stops elsewhere in the route
    for (let len = 1; len <= 3 && !improved; len++) {
      for (let i = 0; i + len <= n && !improved; i++) {
        const run = best.slice(i, i + len);
        const rest = [...best.slice(0, i), ...best.slice(i + len)];
        for (let p = 0; p <= rest.length && !improved; p++) {
          if (p === i) continue;
          const cand = [...rest.slice(0, p), ...run, ...rest.slice(p)];
          const pr = seqPrice(m, cand);
          if (pr.price < bestPrice - EPS && shiftOk(m, n, pr.min)) { best = cand; bestPrice = pr.price; improved = true; }
        }
      }
    }
  }
  return best;
}

/** Inter-route moves towards the nearest stops; returns true if something improved */
function improveInter(sol: Solution, deadline: number): boolean {
  const m = sol.m;
  const price = sol.routes.map(r => seqPrice(m, r.jobs).price);
  let any = false;
  const order = Array.from({ length: m.J }, (_, j) => j);
  for (const a of order) {
    if (Date.now() > deadline) break;
    // after a move `a` may sit in another route: read its place anew for every neighbour
    for (const b of m.near[a].subarray(0, 15)) {
      const ra = sol.where[a];
      const rb = sol.where[b];
      if (ra < 0 || rb < 0 || rb === ra) continue;
      const A = sol.routes[ra], B = sol.routes[rb];
      const ia = A.jobs.indexOf(a), ib = B.jobs.indexOf(b);
      if (ia < 0 || ib < 0) continue;
      const base = price[ra] + price[rb];
      const tryPair = (na: number[], nb: number[]) => {
        const fa = routeFeasible(m, na, A.tag), fb = routeFeasible(m, nb, B.tag);
        if (!fa.ok || !fb.ok) return false;
        if (fa.price + fb.price >= base - EPS) return false;
        if (m.fleetLimited || m.maxVehicles < Infinity) {
          // penalties depend on the whole plan
          const before = sol.cost();
          const keepA = A.jobs, keepB = B.jobs;
          A.jobs = na; B.jobs = nb; refresh(m, A); refresh(m, B);
          const after = sol.cost();
          if (after >= before - EPS) { A.jobs = keepA; B.jobs = keepB; refresh(m, A); refresh(m, B); return false; }
        } else {
          A.jobs = na; B.jobs = nb; refresh(m, A); refresh(m, B);
        }
        for (const j of na) sol.where[j] = ra;
        for (const j of nb) sol.where[j] = rb;
        price[ra] = fa.price; price[rb] = fb.price;
        return true;
      };
      const restA = A.jobs.filter(x => x !== a);
      // relocate a next to b (before or after)
      let done = false;
      for (const at of [ib, ib + 1]) {
        if (done) break;
        const nb = [...B.jobs.slice(0, at), a, ...B.jobs.slice(at)];
        done = tryPair(restA, nb);
      }
      if (done) { any = true; continue; }
      // swap a and b
      {
        const na = A.jobs.slice(); na[ia] = b;
        const nb = B.jobs.slice(); nb[ib] = a;
        if (tryPair(na, nb)) { any = true; continue; }
      }
      // 2-opt*: A head up to a + B tail after b, and B head up to b + A tail after a
      {
        const na = [...A.jobs.slice(0, ia + 1), ...B.jobs.slice(ib + 1)];
        const nb = [...B.jobs.slice(0, ib + 1), ...A.jobs.slice(ia + 1)];
        if (tryPair(na, nb)) { any = true; continue; }
      }
    }
  }
  return any;
}

export function localSearch(sol: Solution, deadline = Infinity): Solution {
  const m = sol.m;
  let rounds = 0;
  do {
    for (const r of sol.routes) {
      if (r.jobs.length < 2) continue;
      const next = improveIntra(m, r.jobs);
      if (next !== r.jobs) { r.jobs = next; refresh(m, r); }
    }
    rounds++;
  } while (improveInter(sol, deadline) && rounds < 30 && Date.now() < deadline);
  sol.compact();
  return sol;
}

/** Final polish of a finished plan (bounded time) */
export function polish(sol: Solution, ms = 1500): Solution {
  return localSearch(sol.clone(), Date.now() + ms);
}
