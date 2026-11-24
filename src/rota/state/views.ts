import { ALL_WEEKDAYS, StoreView, Weekday } from '../types';
import type { RotaWorkspace } from '../store/workspace';
import type { RuleSet } from '../rules/types';
import { nameKey, sameDays } from '../core/names';
import { partyWindowsFromStores } from '../data/storeImport';

export function activeRuleSet(ws: RotaWorkspace): RuleSet | null {
  return ws.ruleSets.find(r => r.id === ws.activeRuleSetId) ?? null;
}

/** Party name key -> window: from the rule set first, otherwise as written in the store file */
export function partyWindowLookup(ws: RotaWorkspace, rules: RuleSet | null): Map<string, string> {
  const map = ws.dataset ? partyWindowsFromStores(ws.dataset.stores) : new Map<string, string>();
  for (const p of rules?.parties ?? []) if (p.name && p.window) map.set(nameKey(p.name), p.window);
  return map;
}

export function buildStoreViews(ws: RotaWorkspace, rules: RuleSet | null): StoreView[] {
  if (!ws.dataset) return [];
  const windows = partyWindowLookup(ws, rules);
  return ws.dataset.stores.map(s => {
    const currentDays = ws.current.days[s.storeCode] ?? s.originalDays;
    const originalDays = ws.original.days[s.storeCode] ?? s.originalDays;
    const currentParty = ws.current.party[s.storeCode] ?? s.party;
    const originalParty = ws.original.party[s.storeCode] ?? s.party;
    const n = currentDays.length;
    return {
      ...s,
      originalDays,
      party: originalParty,
      currentDays,
      currentParty,
      currentPartyWindow: windows.get(nameKey(currentParty)) ?? '',
      // weekly order split over the shipment days of the week
      dailyVolume: n > 0 ? s.weeklyVolume / n : 0,
      dailyWeight: n > 0 ? s.weeklyWeight / n : 0,
      dailyQty: n > 0 ? s.weeklyQty / n : 0,
      daysChanged: !sameDays(currentDays, originalDays),
      partyChanged: nameKey(currentParty) !== nameKey(originalParty),
    };
  });
}

export interface DayTotal {
  volume: number;
  weight: number;
  qty: number;
  stores: number;
}

export function emptyDayTotals(): Record<Weekday, DayTotal> {
  return Object.fromEntries(ALL_WEEKDAYS.map(d => [d, { volume: 0, weight: 0, qty: 0, stores: 0 }])) as Record<Weekday, DayTotal>;
}

/** Per-day totals of a plan; `which` = current or original days */
export function dayTotals(views: StoreView[], which: 'current' | 'original' = 'current'): Record<Weekday, DayTotal> {
  const out = emptyDayTotals();
  for (const v of views) {
    const days = which === 'current' ? v.currentDays : v.originalDays;
    const n = days.length;
    if (!n) continue;
    for (const d of days) {
      out[d].volume += v.weeklyVolume / n;
      out[d].weight += v.weeklyWeight / n;
      out[d].qty += v.weeklyQty / n;
      out[d].stores += 1;
    }
  }
  return out;
}

/**
 * Spread of a measure over the working days: (max − min) / (weekly total / number of working days).
 * The mean includes what is still on non-working days (e.g. Sunday before re-planning),
 * which is how the reference report counts it.
 */
export function spreadPct(totals: Record<Weekday, DayTotal>, key: keyof DayTotal, workingDays: Weekday[]): number {
  if (!workingDays.length) return 0;
  const vals = workingDays.map(d => totals[d][key]);
  const all = ALL_WEEKDAYS.reduce((s, d) => s + totals[d][key], 0);
  const mean = all / workingDays.length;
  if (mean <= 0) return 0;
  return ((Math.max(...vals) - Math.min(...vals)) / mean) * 100;
}

export interface RotaFilters {
  regions: string[];
  parties: string[];
  segments: string[];
  formats: string[];
  day: Weekday | 'all';
  onlyChanged: boolean;
  search: string;
}

export const EMPTY_FILTERS: RotaFilters = { regions: [], parties: [], segments: [], formats: [], day: 'all', onlyChanged: false, search: '' };

export function filtersActive(f: RotaFilters): boolean {
  return f.regions.length > 0 || f.parties.length > 0 || f.segments.length > 0 || f.formats.length > 0 || f.day !== 'all' || f.onlyChanged || f.search.trim() !== '';
}

export function applyFilters(views: StoreView[], f: RotaFilters): StoreView[] {
  const q = f.search.trim().toLowerCase();
  return views.filter(v =>
    (!f.regions.length || f.regions.includes(v.region)) &&
    (!f.parties.length || f.parties.includes(v.currentParty)) &&
    (!f.segments.length || f.segments.includes(v.segment)) &&
    (!f.formats.length || f.formats.includes(v.storeFormat)) &&
    (f.day === 'all' || v.currentDays.includes(f.day)) &&
    (!f.onlyChanged || v.daysChanged || v.partyChanged) &&
    (!q || v.storeCode.toLowerCase().includes(q) || v.storeName.toLowerCase().includes(q))
  );
}

export function distinct(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
