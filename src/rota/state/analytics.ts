/** Data behind the analytics tab, the report tab and the Excel export */
import { ALL_WEEKDAYS, DAY_DIGIT, StoreView, Weekday } from '../types';
import type { RuleSet } from '../rules/types';
import { nameKey, sameDays } from '../core/names';
import { onDay } from './views';

export type Metric = 'volume' | 'weight' | 'qty' | 'stores';
export type Which = 'original' | 'current';

const daysOf = (v: StoreView, w: Which) => (w === 'current' ? v.currentDays : v.originalDays);
const partyOf = (v: StoreView, w: Which) => (w === 'current' ? v.currentParty : v.party);


/** key -> 7 day totals */
export function dimTotals(views: StoreView[], which: Which, keyOf: (v: StoreView, w: Which) => string, metric: Metric): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const v of views) {
    const days = daysOf(v, which);
    const k = keyOf(v, which);
    let row = out.get(k);
    if (!row) out.set(k, (row = new Array(7).fill(0)));
    for (const d of days) row[DAY_DIGIT[d] - 1] += metric === 'stores' ? 1 : onDay(v, d, metric, which);
  }
  return out;
}

export const byParty = (v: StoreView, w: Which) => partyOf(v, w);
export const byRegion = (v: StoreView) => v.region;

/** (max − min) / (row total / working days), % */
export function rowSpread(row: number[], wd: Weekday[]): number {
  if (!wd.length) return 0;
  const idx = wd.map(d => DAY_DIGIT[d] - 1);
  const total = row.reduce((a, b) => a + b, 0);
  const mean = total / wd.length;
  if (mean <= 0) return 0;
  const vals = idx.map(i => row[i]);
  return ((Math.max(...vals) - Math.min(...vals)) / mean) * 100;
}

export interface GroupRow {
  party: string;
  region: string;
  before: number[];
  after: number[];
}

/** store count per party × region × day, before and after (for the "N or 0" matrix) */
export function groupMatrix(views: StoreView[], keys: string): GroupRow[] {
  const m = new Map<string, GroupRow>();
  const add = (v: StoreView, w: Which) => {
    const party = keys === 'region+day' ? '' : partyOf(v, w);
    const region = keys === 'party+day' ? '' : v.region;
    const k = `${nameKey(party)}|${region}`;
    let r = m.get(k);
    if (!r) m.set(k, (r = { party, region, before: new Array(7).fill(0), after: new Array(7).fill(0) }));
    for (const d of daysOf(v, w)) (w === 'original' ? r.before : r.after)[DAY_DIGIT[d] - 1] += 1;
  };
  for (const v of views) { add(v, 'original'); add(v, 'current'); }
  return [...m.values()].sort((a, b) => a.party.localeCompare(b.party) || a.region.localeCompare(b.region));
}

export interface TruckCell {
  m3: number;
  kg: number;
  pctM3: number | null;
  pctKg: number | null;
}

export interface TruckRow {
  party: string;
  capM3: number | null;
  capKg: number | null;
  trucks: number | null;
  days: TruckCell[];
}

/** party × day load against the truck capacity of the rules (rows only for parties with a capacity) */
export function truckLoad(views: StoreView[], rules: RuleSet | null): TruckRow[] {
  if (!rules) return [];
  const vol = dimTotals(views, 'current', byParty, 'volume');
  const wt = dimTotals(views, 'current', byParty, 'weight');
  const rows: TruckRow[] = [];
  for (const p of rules.parties) {
    if (p.truckM3 === null && p.truckKg === null) continue;
    const trucks = p.trucksPerDay ?? 1;
    const key = [...vol.keys()].find(k => nameKey(k) === nameKey(p.name));
    const v = key ? vol.get(key)! : new Array(7).fill(0);
    const w = key ? wt.get(key)! : new Array(7).fill(0);
    rows.push({
      party: p.name, capM3: p.truckM3, capKg: p.truckKg, trucks: p.trucksPerDay,
      days: ALL_WEEKDAYS.map((_, i) => ({
        m3: v[i], kg: w[i],
        pctM3: p.truckM3 ? (v[i] / (p.truckM3 * trucks)) * 100 : null,
        pctKg: p.truckKg ? (w[i] / (p.truckKg * trucks)) * 100 : null,
      })),
    });
  }
  return rows;
}

export type ChangeReason =
  | { code: 'rescheduled' }
  | { code: 'daysMoved' }
  | { code: 'dayCount'; from: number; to: number }
  | { code: 'chainUp'; steps: number }
  | { code: 'swapPart' }
  | { code: 'partyOther' };

/** What changed for a store and why, in plain categories (rules give the chain) */
export function changeReasons(v: StoreView, rules: RuleSet | null, workingDays: Weekday[]): ChangeReason[] {
  const out: ChangeReason[] = [];
  if (!sameDays(v.currentDays, v.originalDays)) {
    if (v.originalDays.some(d => !workingDays.includes(d))) out.push({ code: 'rescheduled' });
    else if (v.currentDays.length !== v.originalDays.length) out.push({ code: 'dayCount', from: v.originalDays.length, to: v.currentDays.length });
    else out.push({ code: 'daysMoved' });
  }
  if (v.partyChanged) {
    // position in the chain (orders may have gaps)
    const ordered = (rules?.parties ?? []).filter(p => p.chainOrder !== null).sort((x, y) => (x.chainOrder as number) - (y.chainOrder as number));
    const chain = new Map(ordered.map((p, i) => [nameKey(p.name), i]));
    const a = chain.get(nameKey(v.party)), b = chain.get(nameKey(v.currentParty));
    const m = /^(.*?)([12])\s*$/.exec(v.party.trim());
    const isSwap = Boolean(m && nameKey(`${m[1]}${m[2] === '1' ? '2' : '1'}`) === nameKey(v.currentParty));
    // the store's own rule decides how the change is named (12-1 → 12-2 is both a chain step and a Part swap)
    const modes = (rules?.segments ?? [])
      .filter(r => (r.kind === 'segment' && nameKey(r.value) === nameKey(v.segment)) || (r.kind === 'format' && nameKey(r.value) === nameKey(v.storeFormat)))
      .map(r => r.partyChange);
    if (isSwap && (modes.includes('swap_part') || !modes.includes('chain_up'))) out.push({ code: 'swapPart' });
    else if (a !== undefined && b !== undefined && b > a) out.push({ code: 'chainUp', steps: b - a });
    else if (isSwap) out.push({ code: 'swapPart' });
    else out.push({ code: 'partyOther' });
  }
  return out;
}
