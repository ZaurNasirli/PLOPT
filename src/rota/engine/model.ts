/**
 * Engine model: everything the search needs, compiled from the stores, the plan and a rule set
 * (port of the setup part of reference/opt2.py).
 *
 * Days are bits of a mask: bit d = day d (0 = Monday … 6 = Sunday). Only working days (from the
 * rules) ever appear in a mask produced by the engine; stores whose file schedule uses a
 * non-working day (Sunday) are "rescheduled" stores and get a new schedule.
 */
import { ALL_WEEKDAYS, DAY_DIGIT, PlanSnapshot, RotaStore, Weekday } from '../types';
import { nameKey } from '../core/names';
import { parseWindow, TimeWindow, windowsOverlap } from '../core/time';
import type { PartyRule, RuleSet, SegmentRule, WeightCode } from '../rules/types';

export interface EngineScope {
  regions?: string[];
  parties?: string[];
  storeCodes?: string[];
}

export interface EngineInput {
  stores: RotaStore[];
  original: PlanSnapshot;
  current: PlanSnapshot;
  rules: RuleSet;
  /** only these stores are optimized; the others keep their current plan but count in the totals */
  scope?: EngineScope | null;
}

export interface Weights {
  Wv: number; Wp: number; Wc: number; Ww: number; Wparty: number; Wreg: number;
  Wgrp: number; Wspc: number; Wchg: number; Winc: number; Wdec: number; Wbud: number;
}

export interface EngineModel {
  S: number;
  P: number;
  R: number;
  codes: string[];
  parties: string[];
  partyCodes: string[];
  regions: string[];
  /** working day indices (0 = Mon) in week order */
  wd: number[];
  /** all working days as a mask */
  wdMask: number;
  vol: Float64Array;
  pcs: Float64Array;
  wt: Float64Array;
  rid: Int32Array;
  /** original party index of each store */
  p0: Int32Array;
  /** original mask (working days of the file schedule) */
  omask: Uint8Array;
  /** original number of days in the file (including non-working days) */
  on: Int32Array;
  /** store had a non-working day (Sunday) in the file: free day count, no ±days penalty */
  rescheduled: Uint8Array;
  /** current plan (masks / parties), used for locked and frozen stores and as "best" start */
  cmask: Uint8Array;
  cparty: Int32Array;
  /** allowed[i*128 + m] = 1 if mask m is allowed for store i */
  allowedMask: Uint8Array;
  /** allowed masks of a store, grouped by number of days: masks[i][k] */
  masksByCount: number[][][];
  /** allowed day counts of a store */
  allowedCounts: number[][];
  /** party options of a store: party index -> cost (0 = original party) */
  partyOpt: Array<Map<number, number>>;
  /** stores the search may touch (more than one mask or more than one party) */
  active: Int32Array;
  /** stores with more than one party option */
  movable: Int32Array;
  /** spacing penalty units of a mask (adjacent working days above the minimum for its size) */
  spc: Float64Array;
  /** group of the "N or 0" rule for (party, region) */
  groupP: Int32Array;
  groupR: Int32Array;
  GP: number;
  GR: number;
  N: number;
  budget: number;
  budgetCap: boolean;
  useWeight: boolean;
  TV: number;
  TP: number;
  TW: number;
  TC: number;
  TOT: number;
  rvol: Float64Array;
  weights: Weights;
  /** party / region / segment of a store, for reports */
  segment: string[];
  storeFormat: string[];
  chainPos: Int32Array;
  fixedParty: Uint8Array;
  partyWindows: TimeWindow[];
  storeWindows: TimeWindow[];
  frozen: Uint8Array;
  /** touching windows count as overlapping */
  touch: boolean;
  /** a rule row of the store says "up the chain" (the stores of the Urban report) */
  chainMode: Uint8Array;
  /** a rule row of the store forbids changing the number of days */
  fixedCount: Uint8Array;
}

export const popcount = (m: number) => {
  let c = 0;
  while (m) { m &= m - 1; c++; }
  return c;
};

export function daysToMask(days: Weekday[], wdMask: number): number {
  let m = 0;
  for (const d of days) m |= 1 << (DAY_DIGIT[d] - 1);
  return m & wdMask;
}

export function maskToDays(m: number): Weekday[] {
  return ALL_WEEKDAYS.filter((_, d) => (m >> d) & 1);
}

/** "16--00 Part 1" -> "16--00 Part 2" and back; null if the name does not end in 1 or 2 */
export function swappedPartName(name: string): string | null {
  const m = /^(.*?)([12])\s*$/.exec(name.trim());
  if (!m) return null;
  return `${m[1]}${m[2] === '1' ? '2' : '1'}`;
}

/** Day-count limits of a store from one rule row (null = no row) */
interface CountRule {
  fixedCount: boolean;
  lo: number;
  hi: number;
}

function countsFromRule(r: SegmentRule, on: number, rescheduled: boolean, W: number): CountRule {
  if (rescheduled) {
    return { fixedCount: false, lo: r.sundayMin ?? 1, hi: r.sundayMax ?? W };
  }
  if (r.changeDayCount === false) return { fixedCount: true, lo: on, hi: on };
  const lo = on === 1 && r.minDaysOneDay !== null
    ? r.minDaysOneDay
    : Math.max(r.minDays ?? 1, on - (r.maxMinusDays ?? on));
  const hi = Math.min(r.maxDays ?? W, on + (r.maxPlusDays ?? W));
  return { fixedCount: false, lo, hi };
}

export function compileModel(input: EngineInput): EngineModel {
  const { stores, original, current, rules } = input;
  const g = rules.general;
  const wd = (g.workingDays ?? '').split('').map(Number).filter(n => n >= 1 && n <= 7).map(n => n - 1).sort((a, b) => a - b);
  const wdMask = wd.reduce((m, d) => m | (1 << d), 0);
  const W = wd.length;
  const touch = g.touchIsOverlap === true;
  const winOpts = { emptyIs247: g.emptyIs247 === true, s724Is247: g.s724Is247 === true };

  // Parties: the rule table first, then any party of the data the table misses (kept, never a target)
  const partyRules: Array<PartyRule | null> = [...rules.parties];
  const partyIndex = new Map<string, number>();
  const extraNames: string[] = [];
  partyRules.forEach((p, i) => p && partyIndex.set(nameKey(p.name), i));
  const partyOf = (name: string) => {
    const k = nameKey(name);
    let i = partyIndex.get(k);
    if (i === undefined) {
      i = partyRules.length;
      partyRules.push(null);
      partyIndex.set(k, i);
      extraNames.push(name);
    }
    return i;
  };
  for (const s of stores) {
    partyOf(original.party[s.storeCode] ?? s.party);
    partyOf(current.party[s.storeCode] ?? s.party);
  }
  const P = partyRules.length;
  let extraIdx = 0;
  const parties = partyRules.map(p => (p ? p.name : extraNames[extraIdx++]));
  const partyCodes = partyRules.map(p => (p ? p.code : ''));
  const partyWindows = partyRules.map(p => (p ? parseWindow(p.window, { emptyIs247: false, s724Is247: false }) : ({ kind: 'unknown' } as TimeWindow)));
  const fixedParty = new Uint8Array(P);
  const chainPos = new Int32Array(P).fill(-1);
  partyRules.forEach((p, i) => { if (p?.fixed) fixedParty[i] = 1; });
  const chain = partyRules
    .map((p, i) => ({ i, o: p?.chainOrder ?? null }))
    .filter(x => x.o !== null)
    .sort((a, b) => (a.o as number) - (b.o as number))
    .map(x => x.i);
  chain.forEach((pi, k) => { chainPos[pi] = k; });
  const byCode = new Map(partyCodes.map((c, i) => [c, i]).filter(([c]) => c) as Array<[string, number]>);

  // Regions
  const regions = [...new Set(stores.map(s => s.region))].sort();
  const regionIndex = new Map(regions.map((r, i) => [r, i]));
  const R = regions.length;

  // Masks over working days, spacing penalty
  const allMasks: number[] = [];
  for (let m = 1; m < 128; m++) if ((m & ~wdMask) === 0) allMasks.push(m);
  const adj = (m: number) => {
    let c = 0;
    for (let k = 0; k + 1 < W; k++) if ((m >> wd[k]) & 1 && (m >> wd[k + 1]) & 1) c++;
    return c;
  };
  const minAdj = new Map<number, number>();
  for (const m of allMasks) {
    const n = popcount(m);
    minAdj.set(n, Math.min(minAdj.get(n) ?? Infinity, adj(m)));
  }
  const spc = new Float64Array(128);
  for (const m of allMasks) spc[m] = adj(m) - (minAdj.get(popcount(m)) ?? 0);

  const segRules = rules.segments.filter(s => s.kind === 'segment');
  const fmtRules = rules.segments.filter(s => s.kind === 'format');
  const exceptions = new Map(rules.stores.map(e => [e.storeCode, e]));

  // Scope of a partial run
  const scope = input.scope;
  const scopeRegions = scope?.regions?.length ? new Set(scope.regions) : null;
  const scopeParties = scope?.parties?.length ? new Set(scope.parties.map(nameKey)) : null;
  const scopeStores = scope?.storeCodes?.length ? new Set(scope.storeCodes) : null;

  const S = stores.length;
  const vol = new Float64Array(S), pcs = new Float64Array(S), wt = new Float64Array(S);
  const rid = new Int32Array(S), p0 = new Int32Array(S), on = new Int32Array(S);
  const omask = new Uint8Array(S), cmask = new Uint8Array(S), rescheduled = new Uint8Array(S), frozen = new Uint8Array(S);
  const chainMode = new Uint8Array(S), fixedCount = new Uint8Array(S);
  const cparty = new Int32Array(S);
  const allowedMask = new Uint8Array(S * 128);
  const masksByCount: number[][][] = [];
  const allowedCounts: number[][] = [];
  const partyOpt: Array<Map<number, number>> = [];
  const storeWindows: TimeWindow[] = [];
  const active: number[] = [];
  const movable: number[] = [];

  stores.forEach((s, i) => {
    const origDays = original.days[s.storeCode] ?? s.originalDays;
    const curDays = current.days[s.storeCode] ?? origDays;
    vol[i] = s.weeklyVolume;
    pcs[i] = s.weeklyQty;
    wt[i] = s.weeklyWeight;
    rid[i] = regionIndex.get(s.region) ?? 0;
    p0[i] = partyOf(original.party[s.storeCode] ?? s.party);
    cparty[i] = partyOf(current.party[s.storeCode] ?? s.party);
    on[i] = origDays.length;
    omask[i] = daysToMask(origDays, wdMask);
    rescheduled[i] = origDays.some(d => !((wdMask >> (DAY_DIGIT[d] - 1)) & 1)) ? 1 : 0;
    cmask[i] = daysToMask(curDays, wdMask);
    const sw = parseWindow(s.receivingTime, winOpts);
    storeWindows.push(sw);

    const inScope = (!scopeRegions || scopeRegions.has(s.region))
      && (!scopeParties || scopeParties.has(nameKey(original.party[s.storeCode] ?? s.party)) || scopeParties.has(nameKey(current.party[s.storeCode] ?? s.party)))
      && (!scopeStores || scopeStores.has(s.storeCode));
    frozen[i] = inScope ? 0 : 1;

    const segRule = segRules.find(r => nameKey(r.value) === nameKey(s.segment)) ?? null;
    const fmtRule = fmtRules.find(r => nameKey(r.value) === nameKey(s.storeFormat)) ?? null;
    const ruleRows = [segRule, fmtRule].filter((r): r is SegmentRule => r !== null);
    const ex = exceptions.get(s.storeCode);
    if (ruleRows.some(r => r.partyChange === 'chain_up')) chainMode[i] = 1;
    if (ruleRows.some(r => r.changeDayCount === false)) fixedCount[i] = 1;

    // ---- day counts (stricter of the segment and the format rows, then the store's own limits)
    let lo = 1, hi = W;
    if (ruleRows.length === 0) {
      // no rules: the number of days stays (re-planned stores keep their count within the working days)
      lo = hi = Math.max(1, Math.min(W, rescheduled[i] ? on[i] : popcount(omask[i]) || on[i]));
    } else {
      for (const r of ruleRows) {
        const c = countsFromRule(r, on[i], rescheduled[i] === 1, W);
        lo = Math.max(lo, c.lo);
        hi = Math.min(hi, c.hi);
      }
    }
    if (ex?.minDays !== null && ex?.minDays !== undefined) lo = Math.max(lo, ex.minDays);
    if (ex?.maxDays !== null && ex?.maxDays !== undefined) hi = Math.min(hi, ex.maxDays);
    lo = Math.max(1, Math.min(lo, W));
    hi = Math.max(1, Math.min(hi, W));
    if (lo > hi) lo = hi;
    const forbidden = (ex?.forbiddenDays ?? []).reduce((m, d) => m | (1 << (d - 1)), 0);

    const byCount: number[][] = Array.from({ length: 8 }, () => []);
    const counts: number[] = [];
    const lockDays = frozen[i] === 1 || ex?.lockDays === true;
    if (lockDays) {
      const m = cmask[i];
      byCount[popcount(m)].push(m);
      allowedMask[i * 128 + m] = 1;
      counts.push(popcount(m));
    } else {
      for (let n = lo; n <= hi; n++) {
        for (const m of allMasks) if (popcount(m) === n && (m & forbidden) === 0) byCount[n].push(m);
        if (byCount[n].length) counts.push(n);
      }
      if (!counts.length) {
        // nothing satisfies the limits (e.g. forbidden days): keep the current days
        const m = cmask[i];
        byCount[popcount(m)].push(m);
        counts.push(popcount(m));
      }
      for (const n of counts) for (const m of byCount[n]) allowedMask[i * 128 + m] = 1;
    }
    masksByCount.push(byCount);
    allowedCounts.push(counts);

    // ---- party options, relative to the original party
    const opts = new Map<number, number>([[p0[i], 0]]);
    const timeOk = (q: number) => windowsOverlap(sw, partyWindows[q], touch);
    const canLeave = !fixedParty[p0[i]];
    if (canLeave && ruleRows.length) {
      const perRow = ruleRows.map(r => {
        const m = new Map<number, number>();
        if (r.partyChange === 'chain_up' && chainPos[p0[i]] >= 0) {
          const k = chainPos[p0[i]];
          for (let step = 1; step <= (r.maxStepsUp ?? 0); step++) {
            const q = chain[k + step];
            if (q === undefined) break;
            m.set(q, -(step === 1 ? r.bonus1 ?? 0 : r.bonus2 ?? 0));
          }
        } else if (r.partyChange === 'swap_part') {
          const other = swappedPartName(parties[p0[i]]);
          const q = other ? partyIndex.get(nameKey(other)) : undefined;
          if (q !== undefined && partyRules[q]) m.set(q, r.changePenalty ?? 0);
        } else if (r.partyChange === 'any') {
          partyRules.forEach((p, q) => { if (p && q !== p0[i]) m.set(q, r.changePenalty ?? 0); });
        }
        return m;
      });
      // stricter of the rows: a party must be allowed by every row; the higher cost wins
      for (const [q, c] of perRow[0]) {
        if (perRow.every(m => m.has(q))) opts.set(q, Math.max(c, ...perRow.map(m => m.get(q) as number)));
      }
    }
    // matrix
    const penalty = Math.max(...ruleRows.map(r => r.changePenalty ?? 0), 0);
    if (canLeave) {
      for (const row of rules.matrix) {
        const v = nameKey(row.value);
        const hit = (row.kind === 'segment' && v === nameKey(s.segment)) || (row.kind === 'format' && v === nameKey(s.storeFormat)) || (row.kind === 'region' && v === nameKey(s.region));
        if (!hit) continue;
        for (const [code, cell] of Object.entries(row.cells)) {
          const q = byCode.get(code);
          if (q === undefined || q === p0[i]) continue;
          if (cell === 'deny') opts.delete(q);
        }
      }
      for (const row of rules.matrix) {
        const v = nameKey(row.value);
        const hit = (row.kind === 'segment' && v === nameKey(s.segment)) || (row.kind === 'format' && v === nameKey(s.storeFormat)) || (row.kind === 'region' && v === nameKey(s.region));
        if (!hit) continue;
        for (const [code, cell] of Object.entries(row.cells)) {
          const q = byCode.get(code);
          if (q === undefined || q === p0[i] || cell !== 'allow') continue;
          const denied = rules.matrix.some(r2 => r2.cells[code] === 'deny' && (
            (r2.kind === 'segment' && nameKey(r2.value) === nameKey(s.segment)) || (r2.kind === 'format' && nameKey(r2.value) === nameKey(s.storeFormat)) || (r2.kind === 'region' && nameKey(r2.value) === nameKey(s.region))));
          if (!denied && !opts.has(q)) opts.set(q, penalty);
        }
      }
    }
    // store exceptions (strongest)
    if (ex) {
      for (const code of ex.forbiddenParties) { const q = byCode.get(code); if (q !== undefined && q !== p0[i]) opts.delete(q); }
      if (ex.allowedParties.length) {
        const allowed = new Set(ex.allowedParties.map(c => byCode.get(c)).filter((q): q is number => q !== undefined));
        for (const q of [...opts.keys()]) if (q !== p0[i] && !allowed.has(q)) opts.delete(q);
        if (canLeave) for (const q of allowed) if (q !== p0[i] && !opts.has(q)) opts.set(q, penalty);
      }
    }
    // time: the party window must overlap the receiving window
    for (const q of [...opts.keys()]) if (q !== p0[i] && !timeOk(q)) opts.delete(q);

    // locks / frozen: keep the current party
    if (frozen[i] || ex?.lockParty) {
      const c = opts.get(cparty[i]) ?? 0;
      opts.clear();
      opts.set(cparty[i], c);
    }
    partyOpt.push(opts);

    const nMasks = counts.reduce((a, n) => a + byCount[n].length, 0);
    if (nMasks > 1 || opts.size > 1) active.push(i);
    if (opts.size > 1) movable.push(i);
  });

  // Groups of the "N or 0" rule
  const keys = g.groupKeys ?? 'party+region+day';
  const usesParty = keys !== 'region+day';
  const usesRegion = keys !== 'party+day';
  const GP = usesParty ? P : 1;
  const GR = usesRegion ? R : 1;
  const groupP = new Int32Array(P).map((_, i) => (usesParty ? i : 0));
  const groupR = new Int32Array(R).map((_, i) => (usesRegion ? i : 0));

  const num = (c: WeightCode) => rules.weights[c] ?? 0;
  const TOT = vol.reduce((a, b) => a + b, 0);
  const budget = on.reduce((a, b) => a + b, 0);
  const rvol = new Float64Array(R);
  for (let i = 0; i < S; i++) rvol[rid[i]] += vol[i];

  return {
    S, P, R, codes: stores.map(s => s.storeCode), parties, partyCodes, regions, wd, wdMask,
    vol, pcs, wt, rid, p0, omask, on, rescheduled, cmask, cparty, allowedMask, masksByCount, allowedCounts, partyOpt,
    active: Int32Array.from(active), movable: Int32Array.from(movable), spc,
    groupP, groupR, GP, GR, N: g.groupMin ?? 0,
    budget, budgetCap: g.budgetCap === true, useWeight: g.useWeight === true,
    TV: TOT / W, TP: pcs.reduce((a, b) => a + b, 0) / W, TW: wt.reduce((a, b) => a + b, 0) / W, TC: budget / W, TOT, rvol,
    weights: {
      Wv: num('Wv'), Wp: num('Wp'), Wc: num('Wc'), Ww: num('Ww'), Wparty: num('Wparty'), Wreg: num('Wreg'),
      Wgrp: num('Wgrp'), Wspc: num('Wspc'), Wchg: num('Wchg'), Winc: num('Winc'), Wdec: num('Wdec'), Wbud: num('Wbud'),
    },
    segment: stores.map(s => s.segment), storeFormat: stores.map(s => s.storeFormat),
    chainPos, fixedParty, partyWindows, storeWindows, frozen, touch, chainMode, fixedCount,
  };
}
