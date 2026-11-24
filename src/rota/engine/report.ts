/**
 * Results of a run: before/after measures, what changed, chain moves ("Urban report") and why
 * remaining "N or 0" violations could not be removed (reference/why.py).
 */
import type { EngineModel, Weights } from './model';
import { popcount } from './model';
import { SearchState, phaseWeights } from './state';
import type { PlanState } from './anneal';
import { windowsOverlap } from '../core/time';

export interface PlanMeasures {
  /** per day (0 = Mon … 6 = Sun) */
  dayV: number[];
  dayP: number[];
  dayW: number[];
  dayC: number[];
  /** (max − min) / (weekly total / number of working days), in % */
  spreadV: number;
  spreadP: number;
  spreadC: number;
  spreadW: number;
  storeDays: number;
  violations: number;
  /** worst party / region: (max − min) / mean of its daily m³, in % */
  partySpreadMax: number;
  regionSpreadMax: number;
}

/** Measures of a plan given as 7-day masks (bit 6 = Sunday) and party indices */
export function measurePlan(m: EngineModel, mask7: ArrayLike<number>, party: ArrayLike<number>): PlanMeasures {
  const dayV = new Array(7).fill(0), dayP = new Array(7).fill(0), dayW = new Array(7).fill(0), dayC = new Array(7).fill(0);
  const PV = new Float64Array(m.P * 7), RV = new Float64Array(m.R * 7);
  const G = new Int32Array(m.GP * m.GR * 7);
  let storeDays = 0;
  for (let i = 0; i < m.S; i++) {
    const mk = mask7[i];
    const n = popcount(mk);
    if (!n) continue;
    storeDays += n;
    const g = (m.groupP[party[i]] * m.GR + m.groupR[m.rid[i]]) * 7;
    for (let d = 0; d < 7; d++) {
      if (!((mk >> d) & 1)) continue;
      dayV[d] += m.vol[i] / n; dayP[d] += m.pcs[i] / n; dayW[d] += m.wt[i] / n; dayC[d] += 1;
      PV[party[i] * 7 + d] += m.vol[i] / n;
      RV[m.rid[i] * 7 + d] += m.vol[i] / n;
      G[g + d] += 1;
    }
  }
  const W = m.wd.length || 1;
  const spread = (arr: ArrayLike<number>, base = 0) => {
    let lo = Infinity, hi = -Infinity, tot = 0;
    for (let d = 0; d < 7; d++) tot += arr[base + d];
    for (const d of m.wd) { lo = Math.min(lo, arr[base + d]); hi = Math.max(hi, arr[base + d]); }
    const mean = tot / W;
    return mean > 0 ? ((hi - lo) / mean) * 100 : 0;
  };
  let partySpreadMax = 0, regionSpreadMax = 0;
  for (let p = 0; p < m.P; p++) partySpreadMax = Math.max(partySpreadMax, spread(PV, p * 7));
  for (let r = 0; r < m.R; r++) regionSpreadMax = Math.max(regionSpreadMax, spread(RV, r * 7));
  let violations = 0;
  for (let k = 0; k < G.length; k++) if (G[k] > 0 && G[k] < m.N) violations++;
  return {
    dayV, dayP, dayW, dayC,
    spreadV: spread(dayV), spreadP: spread(dayP), spreadC: spread(dayC), spreadW: spread(dayW),
    storeDays, violations, partySpreadMax, regionSpreadMax,
  };
}

/** 7-day masks of the file plan (Sunday included) */
export function originalMasks7(m: EngineModel, origDays: number[][]): Uint8Array {
  return Uint8Array.from(origDays.map(ds => ds.reduce((a, d) => a | (1 << d), 0)));
}

export type ChainStatus = 'up1' | 'up2' | 'upMore' | 'notMoved' | 'fixedParty' | 'down';

export interface ChainMove {
  i: number;
  status: ChainStatus;
  steps: number;
  /** why a store was not moved one step (or moved two): codes for the report texts */
  reason?:
    | { code: 'notAllowed'; target: number }
    | { code: 'timeIncompatible'; target: number }
    | { code: 'wouldBreakGroup'; target: number; groups: Array<{ party: number; region: number; day: number; count: number }>; dCost: number }
    | { code: 'wouldWorsenBalance'; target: number; spreadBefore: number; spreadAfter: number; dCost: number }
    | { code: 'costlier'; target: number; dCost: number };
}

export interface GroupViolation {
  party: number;
  region: number;
  day: number;
  count: number;
  members: number[];
  reason:
    | { code: 'smallGroupFixed'; total: number; why: 'fixed' | 'noChange' | 'locked' }
    | { code: 'minDays'; store: number; min: number }
    | { code: 'fixedCount'; store: number; count: number }
    | { code: 'tradeoff' };
}

export interface RunReport {
  before: PlanMeasures;
  after: PlanMeasures;
  changedStores: number;
  daysChanged: number;
  partyChanges: number;
  /** party changes per segment */
  partyChangesBySegment: Record<string, number>;
  /** stores of a segment whose rules forbid changing the day count but whose count changed (non-rescheduled) */
  fixedCountChanged: number;
  chain: ChainMove[];
  violations: GroupViolation[];
  movedOutOfFixed: number;
  timeConflicts: number;
  dayLimitBreaks: number;
}

function hasChainOptions(m: EngineModel, i: number): boolean {
  if (m.chainPos[m.p0[i]] < 0) return false;
  for (const q of m.partyOpt[i].keys()) if (q !== m.p0[i] && m.chainPos[q] > m.chainPos[m.p0[i]]) return true;
  return false;
}

export function buildReport(
  m: EngineModel,
  base: Weights,
  lastMul: { chg: number; grp: number },
  final: PlanState,
  origDays: number[][]
): RunReport {
  const chainStores = m.chainMode;
  const fixedCountStores = m.fixedCount;
  const before = measurePlan(m, originalMasks7(m, origDays), m.p0);
  const after = measurePlan(m, final.mask, final.party);

  let changedStores = 0, daysChanged = 0, partyChanges = 0, fixedCountChanged = 0, movedOutOfFixed = 0, timeConflicts = 0, dayLimitBreaks = 0;
  const partyChangesBySegment: Record<string, number> = {};
  for (let i = 0; i < m.S; i++) {
    const origMask7 = origDays[i].reduce((a, d) => a | (1 << d), 0);
    const dChanged = final.mask[i] !== origMask7;
    const pChanged = final.party[i] !== m.p0[i];
    if (dChanged) daysChanged++;
    if (pChanged) {
      partyChanges++;
      partyChangesBySegment[m.segment[i]] = (partyChangesBySegment[m.segment[i]] ?? 0) + 1;
      if (m.fixedParty[m.p0[i]]) movedOutOfFixed++;
      if (!m.partyOpt[i].has(final.party[i])) timeConflicts++;
    }
    if (dChanged || pChanged) changedStores++;
    if (fixedCountStores[i] && !m.rescheduled[i] && popcount(final.mask[i]) !== m.on[i]) fixedCountChanged++;
    if (!m.allowedMask[i * 128 + final.mask[i]]) dayLimitBreaks++;
  }

  // ---- chain moves ("Urban report")
  const st = new SearchState(m, final.mask, final.party, phaseWeights(base, lastMul.chg, lastMul.grp));
  const baseTotal = st.total();
  const baseViol = groupBad(st);
  const baseSpread = st.spreadV();
  const chain: ChainMove[] = [];
  const chainOrder: number[] = [];
  for (let q = 0; q < m.P; q++) if (m.chainPos[q] >= 0) chainOrder[m.chainPos[q]] = q;
  for (let i = 0; i < m.S; i++) {
    if (!chainStores[i]) continue;
    const p0 = m.p0[i];
    if (m.fixedParty[p0] || m.chainPos[p0] < 0) { chain.push({ i, status: 'fixedParty', steps: 0 }); continue; }
    const steps = m.chainPos[final.party[i]] - m.chainPos[p0];
    const status: ChainStatus = steps === 1 ? 'up1' : steps === 2 ? 'up2' : steps > 2 ? 'upMore' : steps < 0 ? 'down' : 'notMoved';
    const move: ChainMove = { i, status, steps };
    if (status === 'notMoved' || status === 'up2') {
      const target = chainOrder[m.chainPos[p0] + 1];
      if (target === undefined || !m.partyOpt[i].has(target)) {
        const timeOk = target !== undefined && overlapsAfterAll(m, i, target);
        move.reason = timeOk ? { code: 'notAllowed', target: target ?? -1 } : { code: 'timeIncompatible', target: target ?? -1 };
      } else {
        // best 1-step variant with the other stores fixed (same number of days, as in why.py)
        const m1 = st.mask[i], p1 = st.party[i];
        let best: { cost: number; mask: number } | null = null;
        for (const mk of m.masksByCount[i][popcount(m1)] ?? []) {
          st.apply(i, m1, p1, -1); st.apply(i, mk, target, 1); st.mask[i] = mk; st.party[i] = target;
          const c = st.total();
          if (!best || c < best.cost) best = { cost: c, mask: mk };
          st.apply(i, mk, target, -1); st.apply(i, m1, p1, 1); st.mask[i] = m1; st.party[i] = p1;
        }
        if (best) {
          st.apply(i, m1, p1, -1); st.apply(i, best.mask, target, 1); st.mask[i] = best.mask; st.party[i] = target;
          const viol = groupBad(st);
          const spreadAfter = st.spreadV();
          st.apply(i, best.mask, target, -1); st.apply(i, m1, p1, 1); st.mask[i] = m1; st.party[i] = p1;
          const newBad = [...viol.keys()].filter(k => !baseViol.has(k) || (viol.get(k) ?? 0) !== (baseViol.get(k) ?? 0));
          const dCost = best.cost - baseTotal;
          if (viol.size > baseViol.size || newBad.length) {
            move.reason = {
              code: 'wouldBreakGroup', target, dCost,
              groups: newBad.filter(k => viol.has(k)).slice(0, 3).map(k => decodeGroup(m, k, viol.get(k) as number)),
            };
          } else if (spreadAfter > baseSpread + 1e-6) {
            move.reason = { code: 'wouldWorsenBalance', target, spreadBefore: baseSpread * 100, spreadAfter: spreadAfter * 100, dCost };
          } else {
            move.reason = { code: 'costlier', target, dCost };
          }
        }
      }
    }
    chain.push(move);
  }

  // ---- remaining "N or 0" violations and why
  const violations: GroupViolation[] = [];
  for (let gp = 0; gp < m.GP; gp++) {
    for (let gr = 0; gr < m.GR; gr++) {
      const g = gp * m.GR + gr;
      for (const d of m.wd) {
        const c = st.G[g * 7 + d];
        if (!(c > 0 && c < m.N)) continue;
        const members: number[] = [];
        const inGroup: number[] = [];
        for (let i = 0; i < m.S; i++) {
          if (st.groupOf(st.party[i], m.rid[i]) !== g) continue;
          inGroup.push(i);
          if ((st.mask[i] >> d) & 1) members.push(i);
        }
        const pIdx = m.GP === m.P ? gp : st.party[members[0]];
        const rIdx = m.GR === m.R ? gr : m.rid[members[0]];
        let reason: GroupViolation['reason'] = { code: 'tradeoff' };
        const cannotMove = inGroup.every(i => m.partyOpt[i].size <= 1);
        if (inGroup.length < m.N && cannotMove) {
          const anyFixed = inGroup.some(i => m.fixedParty[m.p0[i]]);
          const anyLocked = inGroup.some(i => m.frozen[i]);
          reason = { code: 'smallGroupFixed', total: inGroup.length, why: anyFixed ? 'fixed' : anyLocked ? 'locked' : 'noChange' };
        } else {
          const fixedCount = members.find(i => m.allowedCounts[i].length === 1 && !m.rescheduled[i]);
          const minDays = members.find(i => Math.min(...m.allowedCounts[i]) > 1 && m.allowedCounts[i].length > 1 && popcount(st.mask[i]) === Math.min(...m.allowedCounts[i]));
          if (fixedCount !== undefined) reason = { code: 'fixedCount', store: fixedCount, count: m.allowedCounts[fixedCount][0] };
          else if (minDays !== undefined) reason = { code: 'minDays', store: minDays, min: Math.min(...m.allowedCounts[minDays]) };
        }
        violations.push({ party: pIdx, region: rIdx, day: d, count: c, members, reason });
      }
    }
  }

  return {
    before, after, changedStores, daysChanged, partyChanges, partyChangesBySegment, fixedCountChanged, chain, violations,
    movedOutOfFixed, timeConflicts, dayLimitBreaks,
  };
}

function groupBad(st: SearchState): Map<number, number> {
  const out = new Map<number, number>();
  for (let k = 0; k < st.G.length; k++) if (st.G[k] > 0 && st.G[k] < st.m.N) out.set(k, st.G[k]);
  return out;
}

function decodeGroup(m: EngineModel, k: number, count: number) {
  const d = k % 7;
  const g = (k - d) / 7;
  const gr = g % m.GR;
  const gp = (g - gr) / m.GR;
  return { party: gp, region: gr, day: d, count };
}

/** time check alone (ignoring the other rules) */
function overlapsAfterAll(m: EngineModel, i: number, q: number): boolean {
  return windowsOverlap(m.storeWindows[i], m.partyWindows[q], m.touch);
}
