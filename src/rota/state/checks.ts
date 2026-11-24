/**
 * Checks of the plan and of manual changes (Kanban, map, store card).
 * Hard rules (time, segment rules, fixed parties, chain direction, day limits, forbidden /
 * non-working days, locks) forbid a change; soft rules ("N or 0", uneven days, worse balance)
 * only warn. Uses the same compiled model as the optimizer, so both agree.
 * Without a complete rule set only the data that exists is checked (party window vs receiving time).
 */
import { ALL_WEEKDAYS, DAY_DIGIT, StoreView, Weekday } from '../types';
import type { RotaWorkspace } from '../store/workspace';
import type { RuleSet, SegmentRule, StoreException } from '../rules/types';
import { compileModel, daysToMask, EngineModel, popcount, swappedPartName } from '../engine/model';
import { nameKey, sortDays } from '../core/names';
import { LENIENT_WINDOW_OPTIONS, parseWindow, windowsOverlap } from '../core/time';
import { partyWindowLookup } from './views';

export type CheckCode =
  | 'lockedParty' | 'lockedDays' | 'fixedParty' | 'noPartyChange' | 'chainDown' | 'tooManySteps' | 'notInChain' | 'onlySwap'
  | 'notAllowedByRules' | 'unknownParty' | 'timeConflict' | 'noDays' | 'nonWorkingDay' | 'forbiddenDay' | 'dayCount' | 'alreadyThatDay'
  | 'groupRule' | 'uneven';

export interface CheckResult {
  code: CheckCode;
  params?: Record<string, string | number>;
}

export interface StoreIssue extends CheckResult {
  severity: 'hard' | 'soft';
}

export interface GroupIssue {
  party: string;
  region: string;
  day: Weekday;
  count: number;
  min: number;
  stores: string[];
}

export interface PlanChecker {
  /** null = allowed */
  checkParty(code: string, party: string): CheckResult | null;
  checkDays(code: string, days: Weekday[]): CheckResult | null;
  /** problems of the current plan */
  storeIssues: Map<string, StoreIssue[]>;
  groupIssues: GroupIssue[];
  locked: Map<string, { days: boolean; party: boolean }>;
  /** rules complete enough for full checks */
  full: boolean;
}

function exceptionMap(rules: RuleSet | null): Map<string, StoreException> {
  return new Map((rules?.stores ?? []).map(e => [e.storeCode, e]));
}

export function buildChecker(ws: RotaWorkspace, rules: RuleSet | null, views: StoreView[], rulesComplete: boolean): PlanChecker {
  const stores = ws.dataset?.stores ?? [];
  const index = new Map(stores.map((s, i) => [s.storeCode, i]));
  const exceptions = exceptionMap(rules);
  const locked = new Map<string, { days: boolean; party: boolean }>();
  for (const e of exceptions.values()) if (e.lockDays || e.lockParty) locked.set(e.storeCode, { days: e.lockDays, party: e.lockParty });

  const storeIssues = new Map<string, StoreIssue[]>();
  const addIssue = (code: string, issue: StoreIssue) => {
    const list = storeIssues.get(code) ?? [];
    list.push(issue);
    storeIssues.set(code, list);
  };

  let model: EngineModel | null = null;
  if (rules && rulesComplete && stores.length) {
    // locks are checked separately with a clear message, so the model is compiled without them
    const noLocks: RuleSet = { ...rules, stores: rules.stores.map(e => ({ ...e, lockDays: false, lockParty: false })) };
    model = compileModel({ stores, original: ws.original, current: ws.current, rules: noLocks });
  }
  const partyIdx = model ? new Map(model.parties.map((p, i) => [nameKey(p), i])) : new Map<string, number>();
  const windows = partyWindowLookup(ws, rules);
  const touch = rules?.general.touchIsOverlap === true;
  const winOpts = rules && rulesComplete
    ? { emptyIs247: rules.general.emptyIs247 === true, s724Is247: rules.general.s724Is247 === true }
    : LENIENT_WINDOW_OPTIONS;
  const segRows = (i: number): SegmentRule[] => {
    if (!rules) return [];
    const s = stores[i];
    return rules.segments.filter(r => (r.kind === 'segment' && nameKey(r.value) === nameKey(s.segment)) || (r.kind === 'format' && nameKey(r.value) === nameKey(s.storeFormat)));
  };
  const timeCheck = (i: number, party: string): CheckResult | null => {
    const pw = windows.get(nameKey(party));
    if (!pw) return null; // window unknown: nothing to check
    const sw = parseWindow(stores[i].receivingTime, winOpts);
    const w = parseWindow(pw, { emptyIs247: false, s724Is247: false });
    if (windowsOverlap(sw, w, touch)) return null;
    return { code: 'timeConflict', params: { party, partyWindow: pw, storeWindow: stores[i].receivingTime || '—' } };
  };

  const checkParty = (code: string, party: string, ignoreLock = false): CheckResult | null => {
    const i = index.get(code);
    if (i === undefined) return null;
    const original = ws.original.party[code] ?? stores[i].party;
    const current = ws.current.party[code] ?? original;
    if (nameKey(party) === nameKey(current)) return null;
    if (!ignoreLock && exceptions.get(code)?.lockParty) return { code: 'lockedParty' };
    if (nameKey(party) === nameKey(original)) return null; // back to the file party is always allowed
    if (!model) return timeCheck(i, party);
    const q = partyIdx.get(nameKey(party));
    const p0 = model.p0[i];
    if (q === undefined || !rules?.parties.some(p => nameKey(p.name) === nameKey(party))) return { code: 'unknownParty', params: { party } };
    if (model.fixedParty[p0]) return { code: 'fixedParty', params: { party: original } };
    if (model.partyOpt[i].has(q)) return null;
    const time = timeCheck(i, party);
    const rows = segRows(i);
    if (!rows.length || rows.some(r => r.partyChange === 'none' || r.partyChange === null)) {
      return { code: 'noPartyChange', params: { segment: stores[i].segment || stores[i].storeFormat } };
    }
    for (const r of rows) {
      if (r.partyChange === 'chain_up') {
        const a = model.chainPos[p0], b = model.chainPos[q];
        if (a < 0 || b < 0) return { code: 'notInChain', params: { party } };
        if (b < a) return { code: 'chainDown', params: { party } };
        if (b - a > (r.maxStepsUp ?? 0)) return { code: 'tooManySteps', params: { max: r.maxStepsUp ?? 0 } };
      }
      if (r.partyChange === 'swap_part') {
        const other = swappedPartName(original);
        if (!other || nameKey(other) !== nameKey(party)) return { code: 'onlySwap', params: { party: other ?? '—' } };
      }
    }
    if (time) return time;
    return { code: 'notAllowedByRules', params: { party } };
  };

  const checkDays = (code: string, days: Weekday[], ignoreLock = false): CheckResult | null => {
    const i = index.get(code);
    if (i === undefined) return null;
    if (!days.length) return { code: 'noDays' };
    const current = ws.current.days[code] ?? stores[i].originalDays;
    const same = days.length === current.length && days.every(d => current.includes(d));
    if (same) return null;
    if (!ignoreLock && exceptions.get(code)?.lockDays) return { code: 'lockedDays' };
    if (!model) return null;
    const off = days.find(d => !((model!.wdMask >> (DAY_DIGIT[d] - 1)) & 1));
    if (off) return { code: 'nonWorkingDay', params: { day: off } };
    const ex = exceptions.get(code);
    const forbidden = days.find(d => ex?.forbiddenDays.includes(DAY_DIGIT[d]));
    if (forbidden) return { code: 'forbiddenDay', params: { day: forbidden } };
    const mask = daysToMask(days, model.wdMask);
    if (!model.allowedCounts[i].includes(popcount(mask))) {
      const c = model.allowedCounts[i];
      return { code: 'dayCount', params: { n: days.length, allowed: c.length > 1 && c[c.length - 1] - c[0] === c.length - 1 ? `${c[0]}–${c[c.length - 1]}` : c.join(', '), original: model.on[i] } };
    }
    return null;
  };

  // ---- problems of the current plan
  for (const v of views) {
    const i = index.get(v.storeCode)!;
    const pr = checkParty(v.storeCode, v.currentParty, true);
    if (pr) addIssue(v.storeCode, { ...pr, severity: 'hard' });
    if (model) {
      // days against the rules, as if the store were changed now (locks do not excuse an invalid plan)
      const original = ws.original.days[v.storeCode] ?? stores[i].originalDays;
      const off = v.currentDays.find(d => !((model.wdMask >> (DAY_DIGIT[d] - 1)) & 1));
      if (off) addIssue(v.storeCode, { severity: 'hard', code: 'nonWorkingDay', params: { day: off } });
      else if (v.currentDays.length !== original.length || v.currentDays.some(d => !original.includes(d))) {
        const dr = checkDays(v.storeCode, v.currentDays, true);
        if (dr && dr.code !== 'noDays') addIssue(v.storeCode, { ...dr, severity: 'hard' });
      }
    }
  }

  // uneven days: 2-3 shipments a week on adjacent working days
  const wd = model?.wd ?? [0, 1, 2, 3, 4, 5];
  for (const v of views) {
    const n = v.currentDays.length;
    if (n < 2 || n > 3) continue;
    const idx = v.currentDays.map(d => wd.indexOf(DAY_DIGIT[d] - 1)).filter(x => x >= 0).sort((a, b) => a - b);
    if (idx.some((x, k) => k > 0 && x - idx[k - 1] === 1)) addIssue(v.storeCode, { severity: 'soft', code: 'uneven' });
  }

  // "N or 0" groups
  const groupIssues: GroupIssue[] = [];
  const N = rules?.general.groupMin ?? 0;
  if (rules && N > 1) {
    const keys = rules.general.groupKeys ?? 'party+region+day';
    const groups = new Map<string, { party: string; region: string; day: Weekday; stores: string[] }>();
    for (const v of views) {
      for (const d of v.currentDays) {
        const p = keys === 'region+day' ? '' : v.currentParty;
        const r = keys === 'party+day' ? '' : v.region;
        const k = `${nameKey(p)}|${r}|${d}`;
        let g = groups.get(k);
        if (!g) groups.set(k, (g = { party: p, region: r, day: d, stores: [] }));
        g.stores.push(v.storeCode);
      }
    }
    for (const g of groups.values()) {
      if (g.stores.length > 0 && g.stores.length < N) {
        groupIssues.push({ ...g, count: g.stores.length, min: N });
        for (const code of g.stores) addIssue(code, { severity: 'soft', code: 'groupRule', params: { day: g.day, count: g.stores.length, min: N } });
      }
    }
    groupIssues.sort((a, b) => a.party.localeCompare(b.party) || a.region.localeCompare(b.region) || ALL_WEEKDAYS.indexOf(a.day) - ALL_WEEKDAYS.indexOf(b.day));
  }

  return {
    checkParty: (c, p) => checkParty(c, p),
    checkDays: (c, d) => checkDays(c, sortDays(d)),
    storeIssues,
    groupIssues,
    locked,
    full: model !== null,
  };
}
