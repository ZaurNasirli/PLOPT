/**
 * Proqnoz state: the orders of the last loaded file and the settings, kept in this browser
 * (compact form in localStorage). The analysis is recomputed from them on the page.
 */
import { useSyncExternalStore } from 'react';
import type { AnalyzeOptions, OrderRow } from './engine';
import { DEFAULT_OPTIONS } from './engine';
import type { OrderField } from './ordersImport';

export interface ForecastData {
  fileName: string;
  importedAt: string;
  isDemo: boolean;
  rows: OrderRow[];
  headers: Partial<Record<OrderField, string>>;
  skipped: { noDate: number; noCode: number; noValue: number; negative: number };
}

interface Compact {
  version: 1;
  fileName: string;
  importedAt: string;
  isDemo: boolean;
  headers: Partial<Record<OrderField, string>>;
  skipped: ForecastData['skipped'];
  /** [code, name, region, format, segment] */
  stores: string[][];
  dates: string[];
  /** [dateIdx, storeIdx, volume, weight, qty] */
  rows: number[][];
}

const LS_DATA = 'proqnoz_data_v1';
const LS_OPTS = 'proqnoz_options_v1';

function pack(d: ForecastData): Compact {
  const si = new Map<string, number>(), di = new Map<string, number>();
  const stores: string[][] = [], dates: string[] = [];
  const rows = d.rows.map(r => {
    let s = si.get(r.code);
    if (s === undefined) { si.set(r.code, (s = stores.length)); stores.push([r.code, r.name ?? '', r.region ?? '', r.format ?? '', r.segment ?? '']); }
    let t = di.get(r.date);
    if (t === undefined) { di.set(r.date, (t = dates.length)); dates.push(r.date); }
    return [t, s, r.volume, r.weight, r.qty];
  });
  return { version: 1, fileName: d.fileName, importedAt: d.importedAt, isDemo: d.isDemo, headers: d.headers, skipped: d.skipped, stores, dates, rows };
}

function unpack(c: Compact): ForecastData | null {
  if (!c || c.version !== 1 || !Array.isArray(c.rows) || !Array.isArray(c.stores) || !Array.isArray(c.dates)) return null;
  const rows: OrderRow[] = [];
  for (const [t, s, volume, weight, qty] of c.rows) {
    const st = c.stores[s], date = c.dates[t];
    if (!st || !date) continue;
    rows.push({ date, code: st[0], name: st[1] || undefined, region: st[2] || undefined, format: st[3] || undefined, segment: st[4] || undefined, volume: +volume || 0, weight: +weight || 0, qty: +qty || 0 });
  }
  return { fileName: c.fileName, importedAt: c.importedAt, isDemo: !!c.isDemo, headers: c.headers ?? {}, skipped: c.skipped ?? { noDate: 0, noCode: 0, noValue: 0, negative: 0 }, rows };
}

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

function loadOptions(): AnalyzeOptions {
  const o = read<Partial<AnalyzeOptions>>(LS_OPTS);
  const pos = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.round(v) : d);
  return { closedAfterDays: pos(o?.closedAfterDays, DEFAULT_OPTIONS.closedAfterDays), newAfterWeeks: pos(o?.newAfterWeeks, DEFAULT_OPTIONS.newAfterWeeks) };
}

interface State { data: ForecastData | null; options: AnalyzeOptions; saveError: boolean }
let state: State = typeof window === 'undefined'
  ? { data: null, options: DEFAULT_OPTIONS, saveError: false }
  : { data: (() => { const c = read<Compact>(LS_DATA); return c ? unpack(c) : null; })(), options: loadOptions(), saveError: false };
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export const forecastStore = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  setData(data: ForecastData | null) {
    let saveError = false;
    try {
      if (data) localStorage.setItem(LS_DATA, JSON.stringify(pack(data)));
      else localStorage.removeItem(LS_DATA);
    } catch {
      // too big for this browser's storage: kept for this visit only
      saveError = true;
    }
    state = { ...state, data, saveError };
    emit();
  },
  setOptions(options: AnalyzeOptions) {
    try { localStorage.setItem(LS_OPTS, JSON.stringify(options)); } catch { /* ignore */ }
    state = { ...state, options };
    emit();
  },
};

export function useForecastState(): State {
  return useSyncExternalStore(forecastStore.subscribe, forecastStore.get, forecastStore.get);
}
