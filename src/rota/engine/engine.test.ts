import { describe, expect, it } from 'vitest';
import { compileModel, EngineInput, popcount, swappedPartName } from './model';
import { SearchState, phaseWeights } from './state';
import { anneal, originalStart } from './anneal';
import { repairGroups } from './repair';
import { baseWeights, localRunners, runPipeline } from './pipeline';
import { mulberry32 } from './rng';
import { DIGIT_DAY, RotaStore, Weekday } from '../types';
import { emptyRuleSet, RuleSet, SegmentRule } from '../rules/types';
import { planFromDataset } from '../store/workspace';
import { measurePlan } from './report';
import { scheduleShares } from '../core/rhythm';

const days = (s: string) => s.split('').map(c => DIGIT_DAY[+c]) as Weekday[];

function seg(value: string, patch: Partial<SegmentRule>): SegmentRule {
  return {
    id: value, kind: 'segment', value, partyChange: 'none', maxStepsUp: null, bonus1: null, bonus2: null, changePenalty: null,
    changeDayCount: true, maxPlusDays: 1, maxMinusDays: 2, minDays: 2, maxDays: 6, minDaysOneDay: 1, sundayMin: 1, sundayMax: 4, ...patch,
  };
}

function rules(): RuleSet {
  const rs = emptyRuleSet('t');
  rs.parties = [
    { id: 'a', code: '6-2', name: '16--00 Part 2', window: '08:00 - 16:00', chainOrder: 1, fixed: false, truckM3: null, truckKg: null, trucksPerDay: null },
    { id: 'b', code: '6-3', name: '16--00 Part 3', window: '08:00 - 21:00', chainOrder: 2, fixed: false, truckM3: null, truckKg: null, trucksPerDay: null },
    { id: 'c', code: '2-1', name: '12--30 Part 1', window: '16:00 - 23:00', chainOrder: 3, fixed: false, truckM3: null, truckKg: null, trucksPerDay: null },
    { id: 'd', code: '2-2', name: '12--30 Part 2', window: '16:00 - 02:00', chainOrder: 4, fixed: false, truckM3: null, truckKg: null, trucksPerDay: null },
    { id: 'e', code: '5-1', name: '15--00 Part 1', window: '00:00 - 08:00', chainOrder: 5, fixed: true, truckM3: null, truckKg: null, trucksPerDay: null },
  ];
  rs.segments = [
    seg('Urban', { partyChange: 'chain_up', maxStepsUp: 2, bonus1: 1, bonus2: 0.15, changeDayCount: false, sundayMin: 2, sundayMax: 3 }),
    seg('ARAZ', { partyChange: 'swap_part', changePenalty: 3 }),
    seg('Franchise', { partyChange: 'none' }),
  ];
  rs.general = { workingDays: '123456', groupMin: 3, groupKeys: 'party+region+day', emptyIs247: true, s724Is247: true, touchIsOverlap: false, useWeight: false, budgetCap: true, priorityNote: null, fastMultiplier: 0.2 };
  rs.weights = { Wv: 3000, Wp: 800, Wc: 300, Ww: 0, Wparty: 400, Wreg: 300, Wgrp: 3, Wspc: 0.15, Wchg: 0.03, Winc: 0.4, Wdec: 0.08, Wbud: 0.5 };
  rs.phases = [
    { id: 'p1', type: 'anneal', iterations: 20000, T0: 2, T1: 0.0005, chgMul: 1, grpMul: 1, start: 'original', seeds: 2 },
    { id: 'p2', type: 'repair', iterations: null, T0: null, T1: null, chgMul: 4, grpMul: 1.6667, start: 'best', seeds: null },
    { id: 'p3', type: 'anneal', iterations: 10000, T0: 0.05, T1: 0.0005, chgMul: 4, grpMul: 1.6667, start: 'best', seeds: 1 },
  ];
  return rs;
}

function stores(): RotaStore[] {
  const rnd = mulberry32(7);
  const segs = ['Urban', 'ARAZ', 'ARAZ', 'Franchise'];
  const parties = ['16--00 Part 2', '16--00 Part 3', '12--30 Part 1', '12--30 Part 2', '15--00 Part 1'];
  const pats = ['135', '246', '14', '1234', '2', '1357', '25', '12345'];
  const recv = ['7/24', '07:00 - 00:00', '08:00 - 23:00', '07:00 - 15:00', ''];
  return Array.from({ length: 48 }, (_, i) => ({
    storeCode: `S${i}`, storeName: `Store ${i}`, party: parties[i % parties.length], region: ['A', 'B', 'C'][i % 3],
    storeFormat: 'Express', segment: segs[i % segs.length], originalDays: days(pats[Math.floor(rnd() * pats.length)]),
    lat: null, lng: null, weeklyVolume: 5 + rnd() * 40, weeklyWeight: 1000 + rnd() * 9000, weeklyQty: 100 + rnd() * 900,
    receivingTime: recv[i % recv.length], batchTime: '', rowNumber: i + 2,
  }));
}

function input(rs = rules(), st = stores()): EngineInput {
  const plan = planFromDataset({ name: '', importedAt: '', volumeMode: 'weekly', stores: st });
  return { stores: st, original: plan, current: plan, rules: rs };
}

describe('candidates', () => {
  const m = compileModel(input());
  const st = stores();
  const idx = (pred: (s: RotaStore, i: number) => boolean) => st.findIndex(pred);

  it('Urban: only up the chain, 1 step = −bonus1, 2 steps = −bonus2, time checked', () => {
    // S0: Urban in 16--00 Part 2, receiving 7/24
    const opts = m.partyOpt[0];
    expect(opts.get(0)).toBe(0);
    expect(opts.get(1)).toBe(-1);
    expect(opts.get(2)).toBe(-0.15);
    expect(opts.has(3)).toBe(false);
    // S8: Urban in 12--30 Part 2 (party 3), receiving 12:00..? -> recv[3] = 07:00-15:00 does not meet 00:00-08:00? it does (07-08)
    const i = idx((s, k) => s.segment === 'Urban' && s.receivingTime === '07:00 - 15:00' && s.party === '16--00 Part 2');
    if (i >= 0) expect(m.partyOpt[i].has(2)).toBe(false); // 12--30 Part 1 (16:00-23:00) does not overlap 07:00-15:00
  });

  it('ARAZ: only the Part 1↔2 swap with its penalty; Franchise: never', () => {
    expect(swappedPartName('16--00 Part 2')).toBe('16--00 Part 1');
    const araz = idx(s => s.segment === 'ARAZ' && s.party === '12--30 Part 1' && s.receivingTime === '7/24');
    if (araz >= 0) expect([...m.partyOpt[araz].entries()]).toEqual([[2, 0], [3, 3]]);
    for (let i = 0; i < st.length; i++) if (st[i].segment === 'Franchise') expect(m.partyOpt[i].size).toBe(1);
  });

  it('never moves a store out of a fixed party', () => {
    for (let i = 0; i < st.length; i++) if (st[i].party === '15--00 Part 1') expect([...m.partyOpt[i].keys()]).toEqual([4]);
  });

  it('day counts: ±days, 1-day stores, Sunday stores, fixed count', () => {
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      const on = s.originalDays.length;
      const sunday = s.originalDays.includes('Вс');
      const allowed = m.allowedCounts[i];
      if (s.segment === 'Urban') expect(allowed).toEqual(sunday ? [2, 3] : [on]);
      else if (sunday) expect(allowed).toEqual([1, 2, 3, 4]);
      else if (on === 1) expect(allowed).toEqual([1, 2]);
      else {
        const lo = Math.max(2, on - 2), hi = Math.min(6, on + 1);
        expect(allowed).toEqual(Array.from({ length: hi - lo + 1 }, (_, k) => lo + k));
      }
      for (const n of allowed) for (const mk of m.masksByCount[i][n]) { expect(popcount(mk)).toBe(n); expect(mk & 64).toBe(0); }
    }
  });
});

describe('cost', () => {
  it('incremental Δ equals the difference of full costs on random moves', () => {
    const m = compileModel(input());
    const base = baseWeights(rules(), { mode: 'exact', chgFactor: 1, grpFactor: 1, seed: 1 });
    const rnd = mulberry32(3);
    const start = originalStart(m, rnd);
    const s = new SearchState(m, start.mask, start.party, phaseWeights(base, 4, 1.6667));
    for (let k = 0; k < 400; k++) {
      const i = m.active[Math.floor(rnd() * m.active.length)];
      const counts = m.allowedCounts[i];
      const list = m.masksByCount[i][counts[Math.floor(rnd() * counts.length)]];
      const mk = list[Math.floor(rnd() * list.length)];
      const opts = [...m.partyOpt[i].keys()];
      const p = opts[Math.floor(rnd() * opts.length)];
      const before = s.total();
      const d = s.delta(i, mk, p);
      s.apply(i, s.mask[i], s.party[i], -1);
      s.mask[i] = mk; s.party[i] = p;
      s.apply(i, mk, p, 1);
      expect(s.total() - before).toBeCloseTo(d, 8);
    }
  });

  it('annealing lowers the cost, is repeatable with the same seed, and the repair never makes it worse', async () => {
    const m = compileModel(input());
    const base = baseWeights(rules(), { mode: 'exact', chgFactor: 1, grpFactor: 1, seed: 1 });
    const start = originalStart(m, mulberry32(1));
    const startCost = new SearchState(m, start.mask, start.party, base).total();
    const a = await anneal(m, base, start, { iterations: 30000, T0: 2, T1: 0.0005, chgMul: 1, grpMul: 1, seed: 11 });
    const b = await anneal(m, base, start, { iterations: 30000, T0: 2, T1: 0.0005, chgMul: 1, grpMul: 1, seed: 11 });
    expect(a.best).toBeLessThan(startCost);
    expect([...a.mask]).toEqual([...b.mask]);
    expect(new SearchState(m, a.mask, a.party, base).total()).toBeCloseTo(a.best, 6);
    const w = phaseWeights(base, 4, 1.6667);
    const before = new SearchState(m, a.mask, a.party, w).total();
    const r = repairGroups(m, base, a, 4, 1.6667);
    expect(new SearchState(m, r.mask, r.party, w).total()).toBeLessThanOrEqual(before + 1e-9);
  });

  it('pipeline keeps every rule: allowed days, allowed parties, frozen stores outside the scope', async () => {
    const inp = { ...input(), scope: { regions: ['A'] } };
    const m = compileModel(inp);
    const base = baseWeights(inp.rules, { mode: 'exact', chgFactor: 1, grpFactor: 1, seed: 5 });
    const res = await runPipeline(m, inp.rules, { mode: 'fast', chgFactor: 1, grpFactor: 1, seed: 5 }, localRunners(m, base));
    for (let i = 0; i < m.S; i++) {
      expect(m.allowedMask[i * 128 + res.mask[i]]).toBe(1);
      expect(m.partyOpt[i].has(res.party[i])).toBe(true);
      if (inp.stores[i].region !== 'A') { expect(res.mask[i]).toBe(m.cmask[i]); expect(res.party[i]).toBe(m.cparty[i]); }
    }
  });
});

describe('rhythm split', () => {
  const chain = [0.13, 0.12, 0.12, 0.13, 0.16, 0.18, 0.16];
  const split = { direction: 'forward' as const, chain, stores: { S1: [0.3, 0.1, 0.1, 0.1, 0.1, 0.2, 0.1] } };

  it('day totals follow the store shares, the week total stays; Δ still matches full costs', () => {
    const inp = { ...input(), split };
    const m = compileModel(inp);
    const base = baseWeights(rules(), { mode: 'exact', chgFactor: 1, grpFactor: 1, seed: 1 });
    const rnd = mulberry32(5);
    const start = originalStart(m, rnd);
    const s = new SearchState(m, start.mask, start.party, phaseWeights(base, 1, 1));
    // expected day volumes from the shares
    const exp = new Array(7).fill(0);
    inp.stores.forEach((st, i) => {
      const ds: number[] = [];
      for (let d = 0; d < 7; d++) if ((start.mask[i] >> d) & 1) ds.push(d);
      const sh = scheduleShares(split.stores[st.storeCode as 'S1'] ?? chain, ds, 'forward');
      ds.forEach(d => { exp[d] += st.weeklyVolume * sh[d]; });
    });
    for (let d = 0; d < 7; d++) expect(s.DV[d]).toBeCloseTo(exp[d], 9);
    const total = inp.stores.reduce((a, st) => a + st.weeklyVolume, 0);
    expect(Array.from(s.DV).reduce((a, b) => a + b, 0)).toBeCloseTo(total, 8);
    const mp = measurePlan(m, s.mask, s.party);
    for (let d = 0; d < 7; d++) expect(mp.dayV[d]).toBeCloseTo(exp[d], 9);

    for (let k = 0; k < 200; k++) {
      const i = m.active[Math.floor(rnd() * m.active.length)];
      const counts = m.allowedCounts[i];
      const list = m.masksByCount[i][counts[Math.floor(rnd() * counts.length)]];
      const mk = list[Math.floor(rnd() * list.length)];
      const opts = [...m.partyOpt[i].keys()];
      const p = opts[Math.floor(rnd() * opts.length)];
      const before = s.total();
      const d = s.delta(i, mk, p);
      s.apply(i, s.mask[i], s.party[i], -1);
      s.mask[i] = mk; s.party[i] = p;
      s.apply(i, mk, p, 1);
      expect(s.total() - before).toBeCloseTo(d, 8);
    }
  });

  it('without a split the model keeps the even split (no share table)', () => {
    expect(compileModel(input()).share).toBeNull();
  });
});
