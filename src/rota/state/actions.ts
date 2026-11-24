/** Manual changes of the plan (Kanban, map, store card): checked, applied as one undo step. */
import { PlanSnapshot, Weekday } from '../types';
import { rotaStore, RotaWorkspace } from '../store/workspace';
import { sortDays } from '../core/names';
import type { CheckResult, PlanChecker } from './checks';
import { newId, RuleSet, StoreException } from '../rules/types';

export interface MoveRequest {
  code: string;
  /** move this day … */
  fromDay?: Weekday;
  /** … to this day (or add it) */
  toDay?: Weekday;
  addDay?: boolean;
  /** set the whole week */
  days?: Weekday[];
  party?: string;
}

export interface Rejected {
  code: string;
  reason: CheckResult;
}

export interface MoveResult {
  applied: number;
  rejected: Rejected[];
}

/** Applies what passes the checks, reports the rest. One undo step for the whole batch. */
export function applyMoves(ws: RotaWorkspace, checker: PlanChecker, requests: MoveRequest[]): MoveResult {
  const byStore = new Map<string, MoveRequest[]>();
  for (const r of requests) byStore.set(r.code, [...(byStore.get(r.code) ?? []), r]);
  const next: PlanSnapshot = { days: { ...ws.current.days }, party: { ...ws.current.party } };
  const rejected: Rejected[] = [];
  let applied = 0;
  for (const [code, reqs] of byStore) {
    let days = [...(ws.current.days[code] ?? [])];
    let party = ws.current.party[code];
    let reason: CheckResult | null = null;
    for (const r of reqs) {
      if (r.days) days = [...r.days];
      if (r.toDay && (!r.fromDay || r.fromDay !== r.toDay)) {
        if (days.includes(r.toDay)) { reason = { code: 'alreadyThatDay', params: { day: r.toDay } }; break; }
        days = r.addDay || !r.fromDay ? [...days, r.toDay] : days.map(d => (d === r.fromDay ? r.toDay! : d));
      }
      if (r.party) party = r.party;
    }
    days = sortDays(days);
    if (!reason) reason = checker.checkDays(code, days);
    if (!reason && party !== ws.current.party[code]) reason = checker.checkParty(code, party);
    if (reason) { rejected.push({ code, reason }); continue; }
    const changed = days.join() !== (ws.current.days[code] ?? []).join() || party !== ws.current.party[code];
    if (!changed) continue;
    next.days[code] = days;
    next.party[code] = party;
    applied++;
  }
  if (applied) rotaStore.updatePlan(() => next);
  return { applied, rejected };
}

export type LockKind = 'days' | 'party' | 'all' | 'none';

/** Locks live in the store exceptions of the active rule set (the optimizer reads them there) */
export function setLocks(ws: RotaWorkspace, codes: string[], kind: LockKind): boolean {
  const rs = ws.ruleSets.find(r => r.id === ws.activeRuleSetId);
  if (!rs) return false;
  const set = new Set(codes);
  rotaStore.updateRuleSets(sets => sets.map(s => {
    if (s.id !== rs.id) return s;
    const stores: StoreException[] = [];
    const seen = new Set<string>();
    for (const e of s.stores) {
      if (!set.has(e.storeCode)) { stores.push(e); continue; }
      seen.add(e.storeCode);
      const upd = { ...e, lockDays: kind === 'days' || kind === 'all' ? true : kind === 'none' ? false : e.lockDays, lockParty: kind === 'party' || kind === 'all' ? true : kind === 'none' ? false : e.lockParty };
      if (!isEmptyException(upd)) stores.push(upd);
    }
    if (kind !== 'none') {
      for (const code of codes) {
        if (seen.has(code)) continue;
        stores.push({ id: newId('store'), storeCode: code, lockDays: kind === 'days' || kind === 'all', lockParty: kind === 'party' || kind === 'all', allowedParties: [], forbiddenParties: [], forbiddenDays: [], minDays: null, maxDays: null, comment: '' });
      }
    }
    return { ...s, stores, updatedAt: new Date().toISOString() } as RuleSet;
  }));
  return true;
}

export function updateException(ws: RotaWorkspace, code: string, patch: Partial<StoreException>): boolean {
  const rs = ws.ruleSets.find(r => r.id === ws.activeRuleSetId);
  if (!rs) return false;
  rotaStore.updateRuleSets(sets => sets.map(s => {
    if (s.id !== rs.id) return s;
    const existing = s.stores.find(e => e.storeCode === code);
    const base: StoreException = existing ?? { id: newId('store'), storeCode: code, lockDays: false, lockParty: false, allowedParties: [], forbiddenParties: [], forbiddenDays: [], minDays: null, maxDays: null, comment: '' };
    const upd = { ...base, ...patch };
    const others = s.stores.filter(e => e.storeCode !== code);
    return { ...s, stores: isEmptyException(upd) ? others : [...others, upd], updatedAt: new Date().toISOString() };
  }));
  return true;
}

function isEmptyException(e: StoreException): boolean {
  return !e.lockDays && !e.lockParty && !e.allowedParties.length && !e.forbiddenParties.length && !e.forbiddenDays.length && e.minDays === null && e.maxDays === null && !e.comment;
}
