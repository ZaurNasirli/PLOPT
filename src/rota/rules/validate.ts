/**
 * Rules check before optimization. Errors block the optimizer; warnings are shown only.
 * Every issue points to a sheet and a row so the editor can jump to it.
 */
import type { RotaDict } from '../i18n/ru';
import { fmt } from '../i18n';
import type { RotaStore } from '../types';
import { nameKey } from '../core/names';
import { isStrictWindowText } from '../core/time';
import type { SheetId } from './schema';
import { GeneralRules, RuleSet, SegmentRule, WEIGHT_CODES } from './types';

export interface RuleIssue {
  severity: 'error' | 'warning';
  sheet: SheetId;
  rowId?: string;
  field?: string;
  text: string;
}

const REQUIRED_GENERAL: Array<keyof GeneralRules> = [
  'workingDays', 'groupMin', 'groupKeys', 'emptyIs247', 's724Is247', 'touchIsOverlap', 'useWeight', 'budgetCap',
];

export function validateRules(rs: RuleSet | null, stores: RotaStore[] | null, t: RotaDict): RuleIssue[] {
  const M = t.rules.validation.msg;
  const issues: RuleIssue[] = [];
  const add = (severity: RuleIssue['severity'], sheet: SheetId, template: string, params?: Record<string, string | number>, rowId?: string, field?: string) =>
    issues.push({ severity, sheet, rowId, field, text: fmt(template, params) });

  if (!rs) {
    add('error', 'parties', M.noRuleSet);
    return issues;
  }

  // Parties
  if (!rs.parties.length) add('error', 'parties', M.noParties);
  const codes = new Map<string, number>();
  const names = new Map<string, number>();
  const chain = new Map<number, number>();
  for (const p of rs.parties) {
    if (p.code) codes.set(p.code, (codes.get(p.code) ?? 0) + 1);
    if (p.name) names.set(nameKey(p.name), (names.get(nameKey(p.name)) ?? 0) + 1);
    if (p.chainOrder !== null) chain.set(p.chainOrder, (chain.get(p.chainOrder) ?? 0) + 1);
  }
  for (const p of rs.parties) {
    const label = p.name || p.code || '—';
    if (!p.code) add('error', 'parties', M.partyNoCode, { name: label }, p.id, 'code');
    else if ((codes.get(p.code) ?? 0) > 1) add('error', 'parties', M.partyDupCode, { code: p.code }, p.id, 'code');
    if (!p.name) add('error', 'parties', M.partyNoName, { code: p.code || '—' }, p.id, 'name');
    else if ((names.get(nameKey(p.name)) ?? 0) > 1) add('error', 'parties', M.partyDupName, { name: p.name }, p.id, 'name');
    if (!isStrictWindowText(p.window)) add('error', 'parties', M.partyBadWindow, { name: label, value: p.window || '' }, p.id, 'window');
    if (p.chainOrder !== null && (!Number.isInteger(p.chainOrder) || p.chainOrder < 1)) add('error', 'parties', M.chainBad, { name: label }, p.id, 'chainOrder');
    else if (p.chainOrder !== null && (chain.get(p.chainOrder) ?? 0) > 1) add('error', 'parties', M.chainDup, { n: p.chainOrder }, p.id, 'chainOrder');
  }
  if (stores) {
    const described = new Set(rs.parties.map(p => nameKey(p.name)));
    const seen = new Set<string>();
    for (const s of stores) {
      const k = nameKey(s.party);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      if (!described.has(k)) add('error', 'parties', M.partyNotDescribed, { party: s.party });
    }
  }

  // Segments
  if (!rs.segments.length) add('error', 'segments', M.noSegments);
  const segKeys = new Map<string, number>();
  for (const s of rs.segments) segKeys.set(`${s.kind}:${nameKey(s.value)}`, (segKeys.get(`${s.kind}:${nameKey(s.value)}`) ?? 0) + 1);
  const S = t.rules.cols.segments;
  for (const s of rs.segments) {
    const v = s.value || '—';
    const miss = (field: keyof SegmentRule) => add('error', 'segments', M.segFieldMissing, { value: v, field: S[field as keyof typeof S] }, s.id, field);
    if (!s.value) miss('value');
    if ((segKeys.get(`${s.kind}:${nameKey(s.value)}`) ?? 0) > 1) add('error', 'segments', M.segmentDup, { value: v }, s.id, 'value');
    if (!s.partyChange) miss('partyChange');
    if (s.partyChange === 'chain_up') {
      if (s.maxStepsUp === null) miss('maxStepsUp');
      if (s.bonus1 === null) miss('bonus1');
      if ((s.maxStepsUp ?? 0) >= 2 && s.bonus2 === null) miss('bonus2');
    }
    if ((s.partyChange === 'swap_part' || s.partyChange === 'any') && s.changePenalty === null) miss('changePenalty');
    if (s.changeDayCount === null) miss('changeDayCount');
    if (s.minDays !== null && s.maxDays !== null && s.minDays > s.maxDays) add('error', 'segments', M.segRangeBad, { value: v }, s.id, 'minDays');
    if (s.sundayMin !== null && s.sundayMax !== null && s.sundayMin > s.sundayMax) add('error', 'segments', M.segRangeBad, { value: v }, s.id, 'sundayMin');
  }
  if (stores) {
    const segRules = new Set(rs.segments.filter(s => s.kind === 'segment').map(s => nameKey(s.value)));
    const fmtRules = new Set(rs.segments.filter(s => s.kind === 'format').map(s => nameKey(s.value)));
    const seen = new Set<string>();
    for (const st of stores) {
      const k = nameKey(st.segment);
      if (seen.has(k)) continue;
      seen.add(k);
      // stores of this segment covered by a segment row, or every one of them by a format row
      if (segRules.has(k)) continue;
      const all = stores.filter(x => nameKey(x.segment) === k);
      if (all.every(x => fmtRules.has(nameKey(x.storeFormat)))) continue;
      add('warning', 'segments', M.segmentNoRules, { value: st.segment || '—' });
    }
  }

  // General
  const G = t.rules.general.labels;
  for (const k of REQUIRED_GENERAL) if (rs.general[k] === null) add('error', 'general', M.generalMissing, { field: G[k] }, k, k);
  if (rs.general.workingDays !== null) {
    const d = rs.general.workingDays;
    if (!/^[1-7]+$/.test(d) || new Set(d).size !== d.length) add('error', 'general', M.workingDaysBad, undefined, 'workingDays', 'workingDays');
  }
  if (rs.general.groupMin !== null && (!Number.isInteger(rs.general.groupMin) || rs.general.groupMin < 1)) add('error', 'general', M.groupMinBad, undefined, 'groupMin', 'groupMin');
  if (rs.general.fastMultiplier === null || rs.general.fastMultiplier <= 0) add('warning', 'general', M.fastMissing, undefined, 'fastMultiplier', 'fastMultiplier');

  // Weights
  for (const code of WEIGHT_CODES) {
    const w = rs.weights[code];
    if (w === null) add('error', 'weights', M.weightMissing, { code, name: t.rules.weights.labels[code] }, code, code);
    else if (w < 0) add('error', 'weights', M.weightNegative, { code }, code, code);
  }

  // Algorithm
  const A = t.rules.cols.algo;
  if (!rs.phases.some(p => p.type === 'anneal')) add('error', 'algo', M.noAnneal);
  rs.phases.forEach((p, i) => {
    const n = i + 1;
    const miss = (field: keyof typeof A) => add('error', 'algo', M.phaseFieldMissing, { n, field: A[field] }, p.id, field);
    if (!p.type) { miss('type'); return; }
    if (p.chgMul === null) miss('chgMul');
    if (p.grpMul === null) miss('grpMul');
    if (p.type === 'anneal') {
      if (p.iterations === null) miss('iterations');
      else if (p.iterations <= 0) add('error', 'algo', M.phaseBadNumber, { n, field: A.iterations }, p.id, 'iterations');
      if (p.T0 === null) miss('T0');
      if (p.T1 === null) miss('T1');
      if (p.T0 !== null && p.T1 !== null && (p.T1 <= 0 || p.T1 >= p.T0)) add('error', 'algo', M.phaseTemps, { n }, p.id, 'T1');
      if (!p.start) miss('start');
      if (p.seeds === null) miss('seeds');
      else if (p.seeds < 1) add('error', 'algo', M.phaseBadNumber, { n, field: A.seeds }, p.id, 'seeds');
    }
  });

  // Store exceptions
  const partyCodes = new Set(rs.parties.map(p => p.code).filter(Boolean));
  const storeCodes = stores ? new Set(stores.map(s => s.storeCode)) : null;
  const exSeen = new Map<string, number>();
  for (const e of rs.stores) exSeen.set(e.storeCode, (exSeen.get(e.storeCode) ?? 0) + 1);
  for (const e of rs.stores) {
    if ((exSeen.get(e.storeCode) ?? 0) > 1) add('error', 'stores', M.storeDup, { code: e.storeCode }, e.id, 'storeCode');
    if (storeCodes && !storeCodes.has(e.storeCode)) add('warning', 'stores', M.storeUnknown, { code: e.storeCode }, e.id, 'storeCode');
    for (const pc of [...e.allowedParties, ...e.forbiddenParties]) {
      if (!partyCodes.has(pc)) add('error', 'stores', M.storeUnknownParty, { code: e.storeCode, party: pc }, e.id, e.allowedParties.includes(pc) ? 'allowedParties' : 'forbiddenParties');
    }
    if (e.minDays !== null && e.maxDays !== null && e.minDays > e.maxDays) add('error', 'stores', M.storeMinMax, { code: e.storeCode }, e.id, 'minDays');
  }

  // Matrix
  const unknownCols = new Set<string>();
  for (const m of rs.matrix) {
    if (!m.value) add('warning', 'matrix', M.matrixNoValue, undefined, m.id, 'value');
    for (const [code, cell] of Object.entries(m.cells)) if (cell && !partyCodes.has(code)) unknownCols.add(code);
  }
  for (const code of unknownCols) add('warning', 'matrix', M.matrixUnknownParty, { party: code });

  return issues;
}

export function countIssues(issues: RuleIssue[]) {
  return {
    errors: issues.filter(i => i.severity === 'error').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
  };
}
