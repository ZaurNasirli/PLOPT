import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildRulesWorkbook, parseRulesWorkbook } from './excel';
import { getRotaDict } from '../i18n';
import { emptyRuleSet, RuleSet } from './types';
import { validateRules } from './validate';

function sample(): RuleSet {
  const rs = emptyRuleSet('test');
  rs.parties = [
    { id: 'a', code: '6-2', name: '16--00 Part 2', window: '08:00 - 16:00', chainOrder: 1, fixed: false, truckM3: 40, truckKg: null, trucksPerDay: 3 },
    { id: 'b', code: '2-2', name: '12--30 Part 2', window: '16:00 - 02:00', chainOrder: 2, fixed: true, truckM3: null, truckKg: null, trucksPerDay: null },
  ];
  rs.segments = [{
    id: 's', kind: 'segment', value: 'Urban', partyChange: 'chain_up', maxStepsUp: 2, bonus1: 1, bonus2: 0.15, changePenalty: null,
    changeDayCount: false, maxPlusDays: null, maxMinusDays: null, minDays: null, maxDays: null, minDaysOneDay: null, sundayMin: 2, sundayMax: 3,
  }];
  rs.general = { workingDays: '123456', groupMin: 3, groupKeys: 'party+region+day', emptyIs247: true, s724Is247: true, touchIsOverlap: false, useWeight: false, budgetCap: true, priorityNote: 'note', fastMultiplier: 0.2 };
  rs.weights = { Wv: 3000, Wp: 800, Wc: 300, Ww: 0, Wparty: 400, Wreg: 300, Wgrp: 3, Wspc: 0.15, Wchg: 0.03, Winc: 0.4, Wdec: 0.08, Wbud: 0.5 };
  rs.phases = [
    { id: 'p1', type: 'anneal', iterations: 1000, T0: 2, T1: 0.0005, chgMul: 1, grpMul: 1, start: 'original', seeds: 2 },
    { id: 'p2', type: 'repair', iterations: null, T0: null, T1: null, chgMul: 4, grpMul: 1.6667, start: 'best', seeds: null },
  ];
  rs.stores = [{ id: 'x', storeCode: 'AB40', lockDays: true, lockParty: false, allowedParties: ['6-2'], forbiddenParties: [], forbiddenDays: [7], minDays: 2, maxDays: null, comment: 'c' }];
  rs.matrix = [{ id: 'm', kind: 'region', value: 'SAHIL-ELET', cells: { '6-2': 'deny', '2-2': null } }];
  return rs;
}

const comparable = (rs: RuleSet) => JSON.parse(JSON.stringify({ ...rs, id: 0, name: 0, createdAt: 0, updatedAt: 0 }, (k, v) => (k === 'id' ? undefined : v)));

describe('rules Excel file', () => {
  for (const lang of ['ru', 'az', 'en', 'tr']) {
    it(`round-trips through a ${lang} file (read with any language)`, () => {
      const wb = buildRulesWorkbook(sample(), getRotaDict(lang));
      const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
      const back = parseRulesWorkbook(data, 'x.xlsx', getRotaDict('en'));
      expect(back.found).toHaveLength(7);
      expect(back.problems).toEqual([]);
      expect(comparable(back.ruleSet)).toEqual(comparable(sample()));
    });
  }

  it('empty template has sheets and headers but no values', () => {
    const data = XLSX.write(buildRulesWorkbook(null, getRotaDict('ru')), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const back = parseRulesWorkbook(data, 't.xlsx', getRotaDict('ru'));
    expect(back.found).toHaveLength(7);
    expect(back.ruleSet.parties).toEqual([]);
    expect(Object.values(back.ruleSet.weights).every(v => v === null)).toBe(true);
    expect(Object.values(back.ruleSet.general).every(v => v === null)).toBe(true);
  });

  it('a filled sample passes the rules check; an empty set does not', () => {
    expect(validateRules(sample(), null, getRotaDict('ru')).filter(i => i.severity === 'error')).toEqual([]);
    expect(validateRules(emptyRuleSet('e'), null, getRotaDict('ru')).filter(i => i.severity === 'error').length).toBeGreaterThan(10);
  });
});
