/**
 * HGS — Hybrid Genetic Search (after Vidal et al.): a population of good, different plans.
 *
 *   - crossover "route injection": the child takes a few neighbouring routes of one parent whole and
 *     everything else from the other parent (those stops are taken out of its routes);
 *   - education: a short string-removal search (SISR) and the local search repair and improve the child;
 *   - biased fitness = rank by cost + rank by diversity (broken-pairs distance to the closest plans),
 *     so the population keeps different shapes of plans instead of copies of the best one;
 *   - when the best plan stops improving, the population is refreshed around it.
 * Slower per plan than SISR but explores more: meant for "quality" runs and hard instances.
 */
import type { Model } from './model';
import { construct, insertJob, reduceFleet, runSISR, SearchOptions, debugLog } from './sisr';
import { Solution } from './solution';
import { localSearch } from './localSearch';

interface Indiv {
  sol: Solution;
  cost: number;
  /** successor of every job (-1 = back to the depot) */
  succ: Int32Array;
  fit: number;
}

const POP_MIN = 10;
const POP_GEN = 10;
const N_CLOSE = 3;
const N_ELITE = 4;

function successors(sol: Solution): Int32Array {
  const s = new Int32Array(sol.m.J).fill(-1);
  for (const r of sol.routes) for (let k = 0; k + 1 < r.jobs.length; k++) s[r.jobs[k]] = r.jobs[k + 1];
  return s;
}

/** Broken-pairs distance: share of stops whose next stop differs (in either direction) */
function distance(a: Indiv, b: Indiv): number {
  const J = a.succ.length;
  let diff = 0;
  for (let j = 0; j < J; j++) {
    const x = a.succ[j];
    if (x !== b.succ[j] && (x < 0 || b.succ[x] !== j)) diff++;
  }
  return diff / Math.max(1, J);
}

function updateFitness(pop: Indiv[]): void {
  const n = pop.length;
  if (n < 2) { if (n) pop[0].fit = 0; return; }
  const byCost = [...pop].sort((a, b) => a.cost - b.cost);
  const div = pop.map(p => {
    const ds = pop.filter(q => q !== p).map(q => distance(p, q)).sort((x, y) => x - y);
    const k = Math.min(N_CLOSE, ds.length);
    return ds.slice(0, k).reduce((a, b) => a + b, 0) / Math.max(1, k);
  });
  const byDiv = pop.map((p, i) => ({ p, d: div[i] })).sort((a, b) => b.d - a.d).map(x => x.p);
  const elite = Math.min(N_ELITE, n);
  for (const p of pop) {
    const rc = byCost.indexOf(p) / (n - 1);
    const rd = byDiv.indexOf(p) / (n - 1);
    p.fit = rc + (1 - elite / n) * rd;
  }
}

function tournament(pop: Indiv[], rng: () => number): Indiv {
  const a = pop[Math.floor(rng() * pop.length)], b = pop[Math.floor(rng() * pop.length)];
  return a.fit <= b.fit ? a : b;
}

/** Child: neighbouring routes of `a` (around a random stop) injected into `b` */
function crossover(a: Solution, b: Solution, rng: () => number): Solution {
  const m = a.m;
  const child = b.clone();
  const live = a.routes.filter(r => r.jobs.length);
  if (live.length < 2) return child;
  const seed = Math.floor(rng() * m.J);
  const take = 1 + Math.floor(rng() * Math.max(1, Math.min(live.length - 1, Math.ceil(live.length / 2))));
  const picked = new Set<number>();
  for (const c of [seed, ...m.near[seed]]) {
    if (picked.size >= take) break;
    const ri = a.where[c];
    if (ri >= 0) picked.add(ri);
  }
  const moved = new Set<number>();
  for (const ri of picked) for (const j of a.routes[ri].jobs) moved.add(j);
  for (const j of moved) child.removeJob(j);
  // inject the routes of a (each is feasible on its own); a lock tag moves with its route, so the
  // route of b that had the same tag (now without its locked stops) becomes a normal route
  for (const ri of picked) {
    const src = a.routes[ri];
    if (src.tag >= 0) for (const r of child.routes) if (r.tag === src.tag) r.tag = -1;
    const r = { ...src, jobs: src.jobs.slice() };
    let slot = child.routes.findIndex(x => !x.jobs.length && x.tag < 0);
    if (slot < 0) { slot = child.routes.length; child.routes.push(r); } else child.routes[slot] = r;
    for (const j of r.jobs) child.where[j] = slot;
  }
  // stops cut off in tiny leftover routes of b go back by cheapest insertion
  const small = child.routes.filter(r => r.jobs.length === 1 && r.tag < 0).flatMap(r => r.jobs);
  for (const j of small) { child.removeJob(j); insertJob(child, j, rng); }
  child.compact();
  return child;
}

function makeIndiv(sol: Solution): Indiv {
  return { sol, cost: sol.cost(), succ: successors(sol), fit: 0 };
}

function educate(sol: Solution, opt: SearchOptions, iters: number): Solution {
  const s = runSISR(sol, { ...opt, iters, t0Km: 1, tfKm: 0.02, quiet: true, onProgress: undefined });
  return localSearch(s, Math.min(opt.deadline, Date.now() + 400));
}

/** Random start: stops in random order, each at its cheapest place */
function randomStart(m: Model, rng: () => number): Solution {
  const sol = new Solution(m);
  const order = Array.from({ length: m.J }, (_, j) => j);
  for (let i = order.length - 1; i > 0; i--) { const k = Math.floor(rng() * (i + 1)); [order[i], order[k]] = [order[k], order[i]]; }
  order.sort((x, y) => (m.lock[y] >= 0 ? 1 : 0) - (m.lock[x] >= 0 ? 1 : 0));
  for (const j of order) insertJob(sol, j, rng, 0.05);
  sol.compact();
  return sol;
}

export function runHGS(m: Model, opt: SearchOptions): Solution {
  const t0 = Date.now();
  const span = Math.max(1, opt.deadline - t0);
  const rng = opt.rng;
  // education length: about 1/150 of the budget per child at the measured speed
  let itersPerChild = 400;
  const pop: Indiv[] = [];
  let best: Indiv | null = null;
  const consider = (ind: Indiv) => { if (!best || ind.cost < best.cost - 1e-12) best = ind; };

  // ---- initial population: the greedy start and random starts, each educated
  const tCal = Date.now();
  const first = educate(construct(m, rng), opt, itersPerChild);
  const calMs = Math.max(1, Date.now() - tCal);
  itersPerChild = Math.max(100, Math.min(3000, Math.round(itersPerChild * (span / 150) / calMs)));
  pop.push(makeIndiv(first));
  consider(pop[0]);
  while (pop.length < POP_MIN && Date.now() < t0 + span * 0.3) {
    const ind = makeIndiv(educate(randomStart(m, rng), opt, itersPerChild));
    pop.push(ind);
    consider(ind);
  }
  updateFitness(pop);

  // ---- generations
  let gen = 0, sinceBest = 0;
  while (Date.now() < opt.deadline - span * 0.12) {
    gen++;
    const pa = tournament(pop, rng);
    let pb = tournament(pop, rng);
    if (pb === pa && pop.length > 1) pb = pop[(pop.indexOf(pa) + 1) % pop.length];
    const child = makeIndiv(educate(crossover(pa.sol, pb.sol, rng), opt, itersPerChild));
    const before = best!.cost;
    // no clones
    if (!pop.some(p => Math.abs(p.cost - child.cost) < 1e-9 && distance(p, child) < 0.01)) {
      pop.push(child);
      consider(child);
    }
    sinceBest = best!.cost < before - 1e-12 ? 0 : sinceBest + 1;
    if (pop.length >= POP_MIN + POP_GEN) {
      // survivors: drop the worst biased fitness until POP_MIN remain
      while (pop.length > POP_MIN) {
        updateFitness(pop);
        let worst = 0;
        for (let i = 1; i < pop.length; i++) if (pop[i].fit > pop[worst].fit && pop[i] !== best) worst = i;
        if (pop[worst] === best) break;
        pop.splice(worst, 1);
      }
    }
    updateFitness(pop);
    // stagnation: keep the best few, refill with fresh plans
    if (sinceBest > 40) {
      pop.sort((a, b) => a.cost - b.cost);
      pop.length = Math.min(pop.length, 3);
      while (pop.length < POP_MIN && Date.now() < opt.deadline - span * 0.15) pop.push(makeIndiv(educate(randomStart(m, rng), opt, itersPerChild)));
      updateFitness(pop);
      sinceBest = 0;
    }
    opt.onProgress?.((Date.now() - t0) / span, best!.cost);
  }
  debugLog(`HGS generations ${gen}, population ${pop.length}, iters/child ${itersPerChild}, best ${best!.cost.toFixed(4)}`);

  // ---- last part of the budget: fleet minimisation and a final SISR run on the best plan
  let out = best!.sol;
  const fewer = reduceFleet(out, { ...opt, deadline: Date.now() + (opt.deadline - Date.now()) * 0.4 });
  if (fewer.routes.filter(r => r.jobs.length).length < out.routes.filter(r => r.jobs.length).length) {
    const tuned = runSISR(fewer, { ...opt, t0Km: 1, tfKm: 0.02, deadline: opt.deadline - span * 0.02 });
    if (tuned.cost() <= out.cost()) out = tuned;
  } else {
    const tuned = runSISR(out, { ...opt, t0Km: 0.5, tfKm: 0.02, deadline: opt.deadline - span * 0.02 });
    if (tuned.cost() <= out.cost()) out = tuned;
  }
  return out;
}
