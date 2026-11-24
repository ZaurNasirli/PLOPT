/**
 * Proqnoz engine: real orders of the last weeks → next week's orders per store, store openings
 * and closures, and the real split of a week between the shipment days.
 *
 * Input: one row = one order of a store for a date (the order date, even when the truck leaves
 * after midnight). Weeks run Monday–Sunday. Days are 0 = Monday … 6 = Sunday.
 */
import { fitChainProfile, RhythmDirection, scheduleShares, storeProfile } from '../rota/core/rhythm';

export type Measure = 'volume' | 'weight' | 'qty';
export const MEASURES: Measure[] = ['volume', 'weight', 'qty'];

export interface OrderRow {
  /** YYYY-MM-DD */
  date: string;
  code: string;
  name?: string;
  region?: string;
  format?: string;
  segment?: string;
  volume: number;
  weight: number;
  qty: number;
}

/** On ties the earlier method wins */
export type ForecastMethod = 'wmean' | 'mean' | 'median' | 'last' | 'trend';
export const METHODS: ForecastMethod[] = ['wmean', 'mean', 'median', 'last', 'trend'];

export type StoreStatus = 'active' | 'new' | 'silent' | 'closed';

export interface DayOrder { date: string; volume: number; weight: number; qty: number }

export interface StoreForecast {
  code: string;
  name: string;
  region: string;
  format: string;
  segment: string;
  status: StoreStatus;
  firstDate: string;
  lastDate: string;
  /** days without orders before the end of the data */
  daysSilent: number;
  /** Monday of the opening week, for new stores */
  openedWeek: string | null;
  /** complete weeks the forecast is based on */
  historyWeeks: number;
  /** a single order so far: the forecast is that of a typical store of its format */
  lowData: boolean;
  /** totals per week (same order as Analysis.weeks); null = incomplete week or store not open */
  weekly: Record<Measure, Array<number | null>>;
  forecast: Record<Measure, number>;
  low: Record<Measure, number>;
  high: Record<Measure, number>;
  /** weekdays the store orders on */
  orderDays: number[];
  /** observed share of the week on each weekday */
  observedShare: number[];
  /** learned daily pattern (7 numbers, sum 1) */
  profile: number[];
  /** next week's forecast (main measure) split by its order days */
  nextByDay: number[];
  orders: DayOrder[];
}

export interface WeekInfo {
  /** Monday, YYYY-MM-DD */
  start: string;
  complete: boolean;
  totals: Record<Measure, number>;
  orders: number;
  stores: number;
  openings: number;
  closures: number;
}

export interface AnalyzeOptions {
  /** a store with no orders for this many days before the end of the data is closed */
  closedAfterDays: number;
  /** a store with no orders in the first N weeks of the data and orders later is a new (opened) store */
  newAfterWeeks: number;
}

export interface Analysis {
  options: AnalyzeOptions;
  dataStart: string;
  dataEnd: string;
  rowCount: number;
  weeks: WeekInfo[];
  /** Monday of the forecast week */
  targetWeek: string;
  measures: Record<Measure, boolean>;
  mainMeasure: Measure;
  method: ForecastMethod;
  /** backtest error (WAPE, %) of each method on the main measure; null = too few complete weeks */
  backtest: Record<ForecastMethod, number | null>;
  stores: StoreForecast[];
  totals: { forecast: Record<Measure, number>; low: Record<Measure, number>; high: Record<Measure, number> };
  /** orders expected next week (existing stores' order days + new stores) */
  ordersNext: number;
  /** next week's main measure by weekday (existing stores) */
  nextByDay: number[];
  openings: {
    /** weeks where openings can be seen (after the first N weeks) */
    perWeek: Array<{ start: string; count: number; partial: boolean }>;
    total: number;
    /** expected openings next week (null = the data is too short to see openings) and 80% range */
    expected: number | null;
    low: number;
    high: number;
    /** typical forecast of one new store */
    each: Record<Measure, number>;
    /** typical number of order days of a store */
    daysEach: number;
  };
  closures: number;
  rhythm: { direction: RhythmDirection; chain: number[]; fitError: number };
}

const DAY = 86_400_000;
export const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
export const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => fmtDate(new Date(toDate(s).getTime() + n * DAY));
export const weekday = (s: string) => (toDate(s).getUTCDay() + 6) % 7;
export const mondayOf = (s: string) => addDays(s, -weekday(s));
export const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const zero = (): Record<Measure, number> => ({ volume: 0, weight: 0, qty: 0 });
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const k = s.length;
  return k % 2 ? s[(k - 1) / 2] : (s[k / 2 - 1] + s[k / 2]) / 2;
};

/** Forecast of the next value from weekly totals (oldest first) */
export function predict(series: number[], method: ForecastMethod): number {
  const k = series.length;
  if (!k) return 0;
  switch (method) {
    case 'last': return series[k - 1];
    case 'mean': return sum(series) / k;
    case 'median': return median(series);
    case 'wmean': {
      let w = 0, t = 0;
      series.forEach((y, i) => { w += i + 1; t += (i + 1) * y; });
      return t / w;
    }
    case 'trend': {
      if (k < 3) return sum(series) / k;
      const xm = (k - 1) / 2, ym = sum(series) / k;
      let num = 0, den = 0;
      series.forEach((y, i) => { num += (i - xm) * (y - ym); den += (i - xm) ** 2; });
      // half of the trend, kept within the range the store has shown
      const v = ym + (den ? num / den : 0) * (k - xm) * 0.5;
      return Math.max(0, Math.min(Math.max(v, Math.min(...series) * 0.5), Math.max(...series) * 1.5));
    }
  }
}

/** Smallest k with P(Poisson(λ) ≤ k) ≥ q */
function poissonQuantile(lambda: number, q: number): number {
  if (lambda <= 0) return 0;
  let k = 0, p = Math.exp(-lambda), c = p;
  while (c < q && k < 10_000) { k++; p *= lambda / k; c += p; }
  return k;
}

export const DEFAULT_OPTIONS: AnalyzeOptions = { closedAfterDays: 15, newAfterWeeks: 1 };

export function analyze(rows: OrderRow[], options: AnalyzeOptions = DEFAULT_OPTIONS): Analysis {
  if (!rows.length) throw new Error('no rows');
  const opts = { closedAfterDays: Math.max(1, options.closedAfterDays), newAfterWeeks: Math.max(1, options.newAfterWeeks) };
  let dataStart = rows[0].date, dataEnd = rows[0].date;
  for (const r of rows) { if (r.date < dataStart) dataStart = r.date; if (r.date > dataEnd) dataEnd = r.date; }
  const measures: Record<Measure, boolean> = {
    volume: rows.some(r => r.volume > 0), weight: rows.some(r => r.weight > 0), qty: rows.some(r => r.qty > 0),
  };
  const mainMeasure: Measure = measures.volume ? 'volume' : measures.qty ? 'qty' : 'weight';
  const anySunday = rows.some(r => weekday(r.date) === 6);

  // ---- weeks (Monday–Sunday). Complete = the whole week is inside the data; a missing Sunday is
  // fine when nobody orders on Sundays.
  const firstMonday = mondayOf(dataStart);
  const nWeeks = Math.floor(daysBetween(firstMonday, dataEnd) / 7) + 1;
  const weekStarts = Array.from({ length: nWeeks }, (_, i) => addDays(firstMonday, i * 7));
  const complete = weekStarts.map(ws => ws >= dataStart && addDays(ws, anySunday ? 6 : 5) <= dataEnd);
  const completeIdx = weekStarts.map((_, i) => i).filter(i => complete[i]);
  const weekIdx = (d: string) => Math.floor(daysBetween(firstMonday, d) / 7);

  // ---- per store
  interface Acc { code: string; name: string; region: string; format: string; segment: string; first: string; last: string; byWeek: Array<Record<Measure, number>>; byDay: Map<string, Record<Measure, number>> }
  const acc = new Map<string, Acc>();
  for (const r of rows) {
    const code = r.code.trim();
    if (!code) continue;
    let a = acc.get(code);
    if (!a) acc.set(code, (a = { code, name: '', region: '', format: '', segment: '', first: r.date, last: r.date, byWeek: weekStarts.map(zero), byDay: new Map() }));
    if (r.date < a.first) a.first = r.date;
    if (r.date > a.last) a.last = r.date;
    if (r.name) a.name = r.name;
    if (r.region) a.region = r.region;
    if (r.format) a.format = r.format;
    if (r.segment) a.segment = r.segment;
    const w = a.byWeek[weekIdx(r.date)];
    const dd = a.byDay.get(r.date) ?? zero();
    for (const m of MEASURES) { w[m] += r[m]; dd[m] += r[m]; }
    a.byDay.set(r.date, dd);
  }

  const newFrom = addDays(dataStart, opts.newAfterWeeks * 7);
  interface Prep { a: Acc; status: StoreStatus; openedWeek: string | null; full: number[]; series: Record<Measure, number[]>; daysSilent: number }
  const prep: Prep[] = [];
  const shareInput: Array<{ code: string; days: number[]; shares: number[]; weight: number }> = [];
  for (const a of acc.values()) {
    const daysSilent = daysBetween(a.last, dataEnd);
    const isNew = a.first >= newFrom;
    const closed = daysSilent >= opts.closedAfterDays;
    const status: StoreStatus = closed ? 'closed' : isNew ? 'new' : daysSilent >= 7 ? 'silent' : 'active';
    // complete weeks with the store open the whole week
    const full = completeIdx.filter(i => (!isNew || weekStarts[i] >= a.first) && (!closed || addDays(weekStarts[i], 6) <= a.last));
    const series: Record<Measure, number[]> = { volume: [], weight: [], qty: [] };
    for (const i of full) for (const m of MEASURES) series[m].push(a.byWeek[i][m]);
    prep.push({ a, status, openedWeek: isNew ? mondayOf(a.first) : null, full, series, daysSilent });

    // weekday shares of the main measure
    const dayTotals = new Array(7).fill(0);
    for (const i of full) for (let d = 0; d < 7; d++) dayTotals[d] += a.byDay.get(addDays(weekStarts[i], d))?.[mainMeasure] ?? 0;
    const tot = sum(dayTotals);
    if (tot > 0) {
      const shares = dayTotals.map(x => x / tot);
      shareInput.push({ code: a.code, days: shares.map((x, d) => (x > 0.02 ? d : -1)).filter(d => d >= 0), shares, weight: tot });
    }
  }

  // ---- rhythm: which direction explains the order-day shares better
  const fwd = fitChainProfile(shareInput, 'forward');
  const bwd = fitChainProfile(shareInput, 'backward');
  const direction: RhythmDirection = bwd.sse < fwd.sse * 0.98 ? 'backward' : 'forward';
  const chain = direction === 'forward' ? fwd.profile : bwd.profile;
  const fitError = Math.sqrt(direction === 'forward' ? fwd.sse : bwd.sse);
  const shareBy = new Map(shareInput.map(s => [s.code, s]));

  // ---- method by backtest: forecast every complete week of every store from its earlier weeks
  const backtest = Object.fromEntries(METHODS.map(m => [m, null])) as Record<ForecastMethod, number | null>;
  for (const method of METHODS) {
    let err = 0, actual = 0, n = 0;
    for (const p of prep) {
      if (p.status === 'closed') continue;
      const y = p.series[mainMeasure];
      for (let t = 1; t < y.length; t++) { err += Math.abs(predict(y.slice(0, t), method) - y[t]); actual += y[t]; n++; }
    }
    backtest[method] = n && actual > 0 ? (err / actual) * 100 : null;
  }
  const ranked = METHODS.filter(m => backtest[m] !== null).sort((a, b) => (backtest[a] as number) - (backtest[b] as number));
  const method: ForecastMethod = ranked[0] ?? 'wmean';

  // week-to-week variability typical for the chain (for stores with a short history)
  const cvs: number[] = [];
  for (const p of prep) {
    const y = p.series[mainMeasure];
    if (y.length < 2) continue;
    const mu = sum(y) / y.length;
    if (mu > 0) cvs.push(Math.sqrt(sum(y.map(v => (v - mu) ** 2)) / (y.length - 1)) / mu);
  }
  const chainCv = cvs.length ? median(cvs) : 0.2;
  const Z80 = 1.2816;

  // typical week of a store with history, per format (for stores with a single order so far)
  const typical = new Map<string, Record<Measure, number>>();
  {
    const groups = new Map<string, Prep[]>();
    for (const p of prep) {
      if (p.status === 'closed' || !p.series[mainMeasure].length) continue;
      for (const k of [`f:${p.a.format}`, '*']) groups.set(k, [...(groups.get(k) ?? []), p]);
    }
    for (const [k, list] of groups) {
      if (k !== '*' && list.length < 5) continue;
      const r = zero();
      for (const m of MEASURES) r[m] = median(list.map(p => predict(p.series[m], method)));
      typical.set(k, r);
    }
  }

  const stores: StoreForecast[] = prep.map(p => {
    const { a, status } = p;
    const f = zero(), lo = zero(), hi = zero();
    const orderList = [...a.byDay.entries()];
    const lowData = status !== 'closed' && !p.series[mainMeasure].length && orderList.length < 2;
    for (const m of MEASURES) {
      if (status === 'closed' || !measures[m]) continue;
      let y = p.series[m];
      if (!y.length) {
        const seen = sum(orderList.map(([, v]) => v[m]));
        if (orderList.length >= 2) {
          // no complete week yet: the orders seen cover a part of the week by the chain rhythm
          const days = [...new Set(orderList.map(([d]) => weekday(d)))];
          const sh = scheduleShares(chain, days, direction);
          const covered = sum(orderList.map(([d]) => sh[weekday(d)]));
          y = [covered > 0 ? seen / covered : seen];
        } else {
          // one order says little about a week: a typical store of the same format
          y = [(typical.get(`f:${a.format}`) ?? typical.get('*'))?.[m] ?? seen];
        }
      }
      const v = Math.max(0, predict(y, y.length < 2 ? 'last' : method));
      let cv = chainCv;
      if (y.length >= 3) {
        const mu = sum(y) / y.length;
        if (mu > 0) cv = Math.max(chainCv * 0.5, Math.sqrt(sum(y.map(x => (x - mu) ** 2)) / (y.length - 1)) / mu);
      } else if (y.length < 2) {
        cv = chainCv * (lowData ? 3 : 1.5);
      }
      f[m] = v;
      lo[m] = Math.max(0, v * (1 - Z80 * cv));
      hi[m] = v * (1 + Z80 * cv);
    }
    const sh = shareBy.get(a.code);
    const orderDays = sh?.days.length ? sh.days : [...new Set([...a.byDay.keys()].map(weekday))].sort((x, y) => x - y);
    const observedShare = sh?.shares ?? new Array(7).fill(0);
    const profile = sh && sh.days.length >= 2 ? storeProfile(chain, sh.days, sh.shares, direction) : [...chain];
    const split = scheduleShares(profile, orderDays, direction);
    return {
      code: a.code, name: a.name || a.code, region: a.region, format: a.format, segment: a.segment,
      status, firstDate: a.first, lastDate: a.last, daysSilent: p.daysSilent, openedWeek: p.openedWeek,
      historyWeeks: p.full.length, lowData,
      // only weeks the store was open for the whole week
      weekly: Object.fromEntries(MEASURES.map(m => [m, weekStarts.map((_, i) => (p.full.includes(i) ? a.byWeek[i][m] : null))])) as Record<Measure, Array<number | null>>,
      forecast: f, low: lo, high: hi, orderDays, observedShare, profile,
      nextByDay: split.map(x => x * f[mainMeasure]),
      orders: [...a.byDay.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([date, v]) => ({ date, ...v })),
    };
  }).sort((x, y) => x.code.localeCompare(y.code));

  // ---- weeks
  const closed = stores.filter(s => s.status === 'closed');
  const weeks: WeekInfo[] = weekStarts.map((ws, i) => {
    const totals = zero();
    let n = 0, orders = 0;
    for (const a of acc.values()) {
      const w = a.byWeek[i];
      if (w.volume + w.weight + w.qty > 0) n++;
      for (const m of MEASURES) totals[m] += w[m];
      for (const d of a.byDay.keys()) if (weekIdx(d) === i) orders++;
    }
    const openings = stores.filter(s => s.openedWeek === ws).length;
    // a closed store is counted in the week after its last order
    const closures = closed.filter(s => mondayOf(addDays(s.lastDate, 1)) === ws).length;
    return { start: ws, complete: complete[i], totals, orders, stores: n, openings, closures };
  });

  // ---- openings: visible only after the first N weeks; rate = openings per week of that window
  // days of the window that orders can fall on (no Sundays when nobody orders on Sundays)
  let windowDays = 0;
  for (let d = newFrom; d <= dataEnd; d = addDays(d, 1)) if (anySunday || weekday(d) !== 6) windowDays++;
  const weekLen = anySunday ? 7 : 6;
  const opened = stores.filter(s => s.openedWeek !== null);
  const perWeek = weeks
    .filter(w => addDays(w.start, 6) >= newFrom)
    .map(w => ({ start: w.start, count: w.openings, partial: w.start < newFrom || !w.complete }));
  const expected = windowDays >= weekLen ? (opened.length / windowDays) * weekLen : null;
  const newWithHistory = stores.filter(s => s.status === 'new' && s.historyWeeks > 0);
  const pool = newWithHistory.length >= 3 ? newWithHistory : stores.filter(s => s.status === 'active' || s.status === 'silent');
  const each = zero();
  for (const m of MEASURES) each[m] = median(pool.map(s => s.forecast[m]));
  const daysEach = Math.round(median(pool.map(s => s.orderDays.length))) || 1;
  const openings = {
    perWeek, total: opened.length, expected,
    low: expected ? poissonQuantile(expected, 0.1) : 0,
    high: expected ? poissonQuantile(expected, 0.9) : 0,
    each, daysEach,
  };

  // ---- totals: existing stores + expected new ones
  const totals = { forecast: zero(), low: zero(), high: zero() };
  for (const s of stores) for (const m of MEASURES) { totals.forecast[m] += s.forecast[m]; totals.low[m] += s.low[m]; totals.high[m] += s.high[m]; }
  if (expected) {
    for (const m of MEASURES) {
      totals.forecast[m] += expected * each[m];
      totals.low[m] += openings.low * each[m];
      totals.high[m] += openings.high * each[m];
    }
  }
  const live = stores.filter(s => s.status !== 'closed');
  const ordersNext = sum(live.map(s => s.orderDays.length)) + (expected ?? 0) * daysEach;
  const nextByDay = new Array(7).fill(0);
  for (const s of live) s.nextByDay.forEach((v, d) => { nextByDay[d] += v; });

  const targetWeek = addDays(mondayOf(dataEnd), 7);
  return {
    options: opts, dataStart, dataEnd, rowCount: rows.length, weeks, targetWeek, measures, mainMeasure, method, backtest,
    stores, totals, ordersNext, nextByDay, openings, closures: closed.length,
    rhythm: { direction, chain, fitError },
  };
}
