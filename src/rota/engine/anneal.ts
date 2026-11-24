/**
 * Simulated annealing over store days and parties (main loop of reference/opt2.py).
 * Runs in chunks so a worker can report progress and react to "stop" between them.
 */
import type { EngineModel, Weights } from './model';
import { popcount } from './model';
import { SearchState, phaseWeights } from './state';
import { mulberry32 } from './rng';

export interface PlanState {
  mask: Uint8Array;
  party: Int32Array;
}

export interface AnnealOptions {
  iterations: number;
  T0: number;
  T1: number;
  chgMul: number;
  grpMul: number;
  seed: number;
  /** iterations between progress reports / stop checks */
  chunk?: number;
  onProgress?: (p: { it: number; iterations: number; best: number; spreadV: number; violations: number }) => void;
  shouldStop?: () => boolean;
  /** lets the worker handle messages between chunks */
  yieldFn?: () => Promise<void>;
  /** compare the running cost with a full recalculation every 1M iterations */
  debug?: boolean;
  onDebug?: (msg: string) => void;
}

export interface AnnealResult extends PlanState {
  best: number;
  iterationsDone: number;
  stopped: boolean;
}

/** Start from the file plan: stores whose file days are not allowed get a random allowed mask */
export function originalStart(m: EngineModel, rnd: () => number): PlanState {
  const mask = new Uint8Array(m.S);
  const party = new Int32Array(m.S);
  for (let i = 0; i < m.S; i++) {
    if (m.frozen[i]) { mask[i] = m.cmask[i]; party[i] = m.cparty[i]; continue; }
    let mk = m.omask[i];
    if (!mk || !m.allowedMask[i * 128 + mk]) mk = randomAllowed(m, i, rnd);
    mask[i] = mk;
    party[i] = m.partyOpt[i].has(m.p0[i]) ? m.p0[i] : m.cparty[i];
  }
  return { mask, party };
}

/** Start from the current plan (masks that are no longer allowed are replaced) */
export function currentStart(m: EngineModel, rnd: () => number): PlanState {
  const mask = new Uint8Array(m.S);
  const party = new Int32Array(m.S);
  for (let i = 0; i < m.S; i++) {
    let mk = m.cmask[i];
    if (!mk || !m.allowedMask[i * 128 + mk]) mk = randomAllowed(m, i, rnd);
    mask[i] = mk;
    party[i] = m.partyOpt[i].has(m.cparty[i]) ? m.cparty[i] : m.p0[i];
  }
  return { mask, party };
}

function randomAllowed(m: EngineModel, i: number, rnd: () => number): number {
  const counts = m.allowedCounts[i];
  const n = counts[Math.floor(rnd() * counts.length)];
  const list = m.masksByCount[i][n];
  return list[Math.floor(rnd() * list.length)];
}

export async function anneal(m: EngineModel, base: Weights, start: PlanState, o: AnnealOptions): Promise<AnnealResult> {
  const rnd = mulberry32(o.seed);
  const st = new SearchState(m, start.mask, start.party, phaseWeights(base, o.chgMul, o.grpMul));
  let cur = st.total();
  let best = cur;
  const bestMask = Uint8Array.from(st.mask);
  const bestParty = Int32Array.from(st.party);
  const IT = Math.max(0, Math.floor(o.iterations));
  const chunk = o.chunk ?? 100_000;
  const lnRatio = Math.log(o.T1 / o.T0);
  const active = m.active;
  const movable = m.movable;
  const wdMask = m.wdMask;
  if (active.length === 0 || IT === 0) {
    return { mask: bestMask, party: bestParty, best, iterationsDone: 0, stopped: false };
  }
  const offDays: number[] = [];
  const onDays: number[] = [];
  let it = 0;
  let stopped = false;

  while (it < IT) {
    const end = Math.min(IT, it + chunk);
    for (; it < end; it++) {
      const T = o.T0 * Math.exp((lnRatio * it) / IT);
      const i = rnd() > 0.1 || movable.length === 0
        ? active[Math.floor(rnd() * active.length)]
        : movable[Math.floor(rnd() * movable.length)];
      const m1 = st.mask[i], p1 = st.party[i];
      let m2 = m1, p2 = p1;
      const r = rnd();
      const opts = st.popts[i];
      if (r < 0.12 && opts.length > 1) {
        let q = opts[Math.floor(rnd() * (opts.length - 1))];
        if (q === p1) q = opts[opts.length - 1];
        p2 = q;
      } else if (r < 0.55) {
        onDays.length = 0;
        offDays.length = 0;
        for (const d of m.wd) ((m1 >> d) & 1 ? onDays : offDays).push(d);
        if (!offDays.length || !onDays.length) continue;
        m2 = (m1 ^ (1 << onDays[Math.floor(rnd() * onDays.length)]) ^ (1 << offDays[Math.floor(rnd() * offDays.length)])) & wdMask;
      } else if (r < 0.8) {
        const list = m.masksByCount[i][popcount(m1)];
        if (!list || !list.length) continue;
        m2 = list[Math.floor(rnd() * list.length)];
      } else {
        const counts = m.allowedCounts[i];
        const list = m.masksByCount[i][counts[Math.floor(rnd() * counts.length)]];
        m2 = list[Math.floor(rnd() * list.length)];
      }
      if (m2 === m1 && p2 === p1) continue;
      if (!m.allowedMask[i * 128 + m2]) continue;

      const before = st.localCost(i, m1, p1, p1, p2);
      st.apply(i, m1, p1, -1);
      st.apply(i, m2, p2, 1);
      st.mask[i] = m2;
      st.party[i] = p2;
      const after = st.localCost(i, m2, p2, p1, p2);
      const dl = after - before;
      if (dl <= 0 || rnd() < Math.exp(-dl / T)) {
        cur += dl;
        if (cur < best - 1e-9) {
          best = cur;
          bestMask.set(st.mask);
          bestParty.set(st.party);
        }
      } else {
        st.apply(i, m2, p2, -1);
        st.apply(i, m1, p1, 1);
        st.mask[i] = m1;
        st.party[i] = p1;
      }
      if (o.debug && it > 0 && it % 1_000_000 === 0) {
        const full = st.total();
        if (Math.abs(full - cur) > 1e-6 * Math.max(1, Math.abs(full))) o.onDebug?.(`cost drift at ${it}: running ${cur} vs full ${full}`);
        cur = full;
      }
    }
    o.onProgress?.({ it, iterations: IT, best, spreadV: st.spreadV(), violations: st.violations() });
    if (o.yieldFn) await o.yieldFn();
    if (o.shouldStop?.()) { stopped = true; break; }
  }
  return { mask: bestMask, party: bestParty, best, iterationsDone: it, stopped };
}
