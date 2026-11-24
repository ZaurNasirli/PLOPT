/** Summary measures of any plan (scenario comparison, reports) */
import { ALL_WEEKDAYS, PlanSnapshot, Weekday } from '../types';
import type { RotaWorkspace } from '../store/workspace';
import type { RuleSet } from '../rules/types';
import { buildStoreViews, dayTotals, spreadPct } from './views';
import { digitsToDays, nameKey } from '../core/names';

export interface PlanMetrics {
  spreadV: number;
  spreadP: number;
  spreadC: number;
  storeDays: number;
  /** null when the rules have no "N or 0" settings */
  violations: number | null;
  changed: number;
  partyChanges: number;
}

export function workingDaysOf(ws: RotaWorkspace, rules: RuleSet | null): Weekday[] {
  const fromRules = rules?.general.workingDays ? digitsToDays(rules.general.workingDays) : [];
  if (fromRules.length) return fromRules;
  const totals = dayTotals(buildStoreViews(ws, rules));
  return ALL_WEEKDAYS.filter(d => totals[d].stores > 0);
}

export function planMetrics(ws: RotaWorkspace, plan: PlanSnapshot, rules: RuleSet | null): PlanMetrics {
  const views = buildStoreViews({ ...ws, current: plan }, rules);
  const totals = dayTotals(views);
  const wd = workingDaysOf(ws, rules);
  let violations: number | null = null;
  const N = rules?.general.groupMin ?? 0;
  if (rules && N > 1) {
    const keys = rules.general.groupKeys ?? 'party+region+day';
    const g = new Map<string, number>();
    for (const v of views) for (const d of v.currentDays) {
      const k = `${keys === 'region+day' ? '' : nameKey(v.currentParty)}|${keys === 'party+day' ? '' : v.region}|${d}`;
      g.set(k, (g.get(k) ?? 0) + 1);
    }
    violations = [...g.values()].filter(n => n > 0 && n < N).length;
  }
  return {
    spreadV: spreadPct(totals, 'volume', wd),
    spreadP: spreadPct(totals, 'qty', wd),
    spreadC: spreadPct(totals, 'stores', wd),
    storeDays: views.reduce((s, v) => s + v.currentDays.length, 0),
    violations,
    changed: views.filter(v => v.daysChanged || v.partyChanged).length,
    partyChanges: views.filter(v => v.partyChanged).length,
  };
}

export interface PlanDiff {
  code: string;
  name: string;
  region: string;
  daysA: Weekday[];
  daysB: Weekday[];
  partyA: string;
  partyB: string;
}

export function planDiff(ws: RotaWorkspace, a: PlanSnapshot, b: PlanSnapshot): PlanDiff[] {
  const out: PlanDiff[] = [];
  for (const s of ws.dataset?.stores ?? []) {
    const da = a.days[s.storeCode] ?? s.originalDays, db = b.days[s.storeCode] ?? s.originalDays;
    const pa = a.party[s.storeCode] ?? s.party, pb = b.party[s.storeCode] ?? s.party;
    const sameDays = da.length === db.length && da.every(d => db.includes(d));
    if (sameDays && nameKey(pa) === nameKey(pb)) continue;
    out.push({ code: s.storeCode, name: s.storeName, region: s.region, daysA: da, daysB: db, partyA: pa, partyB: pb });
  }
  return out;
}
