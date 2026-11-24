import { describe, expect, it } from 'vitest';
import { buildChecker } from './checks';
import { buildStoreViews } from './views';
import { emptyWorkspace, planFromDataset, RotaWorkspace } from '../store/workspace';
import { emptyRuleSet, RuleSet } from '../rules/types';
import { DIGIT_DAY, RotaStore, Weekday } from '../types';

const days = (s: string) => s.split('').map(c => DIGIT_DAY[+c]) as Weekday[];
const store = (code: string, segment: string, party: string, d: string, recv = '7/24'): RotaStore => ({
  storeCode: code, storeName: code, party, region: 'R', storeFormat: 'Express', segment, originalDays: days(d),
  lat: null, lng: null, weeklyVolume: 10, weeklyWeight: 100, weeklyQty: 10, receivingTime: recv, batchTime: '', rowNumber: 2,
});

function rules(): RuleSet {
  const rs = emptyRuleSet('t');
  const party = (id: string, code: string, name: string, window: string, chainOrder: number | null, fixed = false) =>
    ({ id, code, name, window, chainOrder, fixed, truckM3: null, truckKg: null, trucksPerDay: null });
  rs.parties = [
    party('a', '6-2', '16--00 Part 2', '08:00 - 16:00', 1),
    party('b', '6-3', '16--00 Part 3', '08:00 - 21:00', 2),
    party('c', '2-1', '12--30 Part 1', '16:00 - 23:00', 3),
    party('d', '2-2', '12--30 Part 2', '16:00 - 02:00', 4),
    party('e', '5-1', '15--00 Part 1', '00:00 - 08:00', 5, true),
  ];
  const seg = (value: string, patch: object) => ({
    id: value, kind: 'segment' as const, value, partyChange: 'none' as const, maxStepsUp: null, bonus1: null, bonus2: null, changePenalty: null,
    changeDayCount: true, maxPlusDays: 1, maxMinusDays: 2, minDays: 2, maxDays: 6, minDaysOneDay: 1, sundayMin: 1, sundayMax: 4, ...patch,
  });
  rs.segments = [
    seg('Urban', { partyChange: 'chain_up', maxStepsUp: 2, bonus1: 1, bonus2: 0.15, changeDayCount: false, sundayMin: 2, sundayMax: 3 }),
    seg('ARAZ', { partyChange: 'swap_part', changePenalty: 3 }),
    seg('Franchise', {}),
  ];
  rs.general = { workingDays: '123456', groupMin: 3, groupKeys: 'party+region+day', emptyIs247: true, s724Is247: true, touchIsOverlap: false, useWeight: false, budgetCap: true, priorityNote: null, fastMultiplier: 0.2 };
  rs.weights = { Wv: 1, Wp: 1, Wc: 1, Ww: 0, Wparty: 1, Wreg: 1, Wgrp: 1, Wspc: 1, Wchg: 1, Winc: 1, Wdec: 1, Wbud: 1 };
  rs.phases = [{ id: 'p', type: 'anneal', iterations: 10, T0: 1, T1: 0.1, chgMul: 1, grpMul: 1, start: 'original', seeds: 1 }];
  rs.stores = [{ id: 'x', storeCode: 'L1', lockDays: true, lockParty: false, allowedParties: [], forbiddenParties: [], forbiddenDays: [], minDays: null, maxDays: null, comment: '' }];
  return rs;
}

function setup() {
  const stores = [
    store('U1', 'Urban', '16--00 Part 3', '135'),
    store('U2', 'Urban', '16--00 Part 2', '24', '07:00 - 15:00'),
    store('A1', 'ARAZ', '12--30 Part 1', '135'),
    store('F1', 'Franchise', '16--00 Part 2', '246'),
    store('X1', 'ARAZ', '15--00 Part 1', '1357'),
    store('L1', 'ARAZ', '16--00 Part 2', '14'),
  ];
  const rs = rules();
  const plan = planFromDataset({ name: '', importedAt: '', volumeMode: 'weekly', stores });
  const ws: RotaWorkspace = { ...emptyWorkspace(), dataset: { name: '', importedAt: '', volumeMode: 'weekly', stores }, original: plan, current: plan, ruleSets: [rs], activeRuleSetId: rs.id };
  return buildChecker(ws, rs, buildStoreViews(ws, rs), true);
}

describe('manual change checks', () => {
  const c = setup();
  it('party rules', () => {
    expect(c.checkParty('U1', '12--30 Part 1')).toBeNull(); // one step up
    expect(c.checkParty('U1', '16--00 Part 2')?.code).toBe('chainDown');
    expect(c.checkParty('U2', '16--00 Part 3')).toBeNull();
    expect(c.checkParty('U2', '12--30 Part 1')?.code).toBe('timeConflict'); // 16:00–23:00 vs 07:00–15:00
    expect(c.checkParty('A1', '12--30 Part 2')).toBeNull(); // Part 1 ↔ 2
    expect(c.checkParty('A1', '16--00 Part 3')?.code).toBe('onlySwap');
    expect(c.checkParty('F1', '16--00 Part 3')?.code).toBe('noPartyChange');
    expect(c.checkParty('X1', '12--30 Part 2')?.code).toBe('fixedParty');
  });
  it('day rules', () => {
    expect(c.checkDays('A1', days('136'))).toBeNull();
    expect(c.checkDays('A1', days('1357'))?.code).toBe('nonWorkingDay');
    expect(c.checkDays('U1', days('1356'))?.code).toBe('dayCount'); // Urban keeps its count
    expect(c.checkDays('A1', days('1'))?.code).toBe('dayCount'); // minimum 2
    expect(c.checkDays('L1', days('25'))?.code).toBe('lockedDays');
  });
  it('plan problems: Sunday store is flagged, uneven days warned', () => {
    expect(c.storeIssues.get('X1')?.some(i => i.code === 'nonWorkingDay')).toBe(true);
    expect(c.storeIssues.get('L1')?.some(i => i.code === 'uneven')).toBe(false); // Mon + Thu
  });
});
