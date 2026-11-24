/**
 * Demo orders for Proqnoz (the "Load demo" button and the tests): stores with their own order
 * days, a weekly consumption pattern with busy weekends, noise, a few openings and closures.
 */
import { scheduleShares } from '../rota/core/rhythm';
import { addDays, OrderRow } from './engine';

export const DEMO_PATTERN = [0.13, 0.12, 0.12, 0.13, 0.16, 0.18, 0.16];

export interface DemoOptions {
  start: string;
  weeks: number;
  stores: number;
  /** new stores opening per week after the first week */
  openingsPerWeek: number;
  closures: number;
  seed: number;
}

export function generateDemoOrders(o: Partial<DemoOptions> = {}): { rows: OrderRow[]; truth: Map<string, { weekly: number; days: number[]; opened: string | null; closedAfter: string | null }> } {
  const opt: DemoOptions = { start: '2026-10-26', weeks: 4, stores: 120, openingsPerWeek: 2, closures: 2, seed: 7, ...o };
  let seed = opt.seed;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const patterns = [[0, 3], [1, 4], [2, 5], [0, 2, 4], [1, 3, 5], [0, 3, 5], [0, 1, 2, 3, 4], [0, 2, 4, 5], [1, 4], [0, 4]];
  const regions = ['NIZAMI-XETAI', 'YASAMAL-ECEMI', 'NERIMANOV-AZADLIQ', 'XIRDALAN-MASAZI', 'SAHIL-ELET'];
  const formats = ['Supermarket', 'Minimarket', 'Express', 'Superstore'];
  const totalDays = opt.weeks * 7;
  const rows: OrderRow[] = [];
  const truth = new Map<string, { weekly: number; days: number[]; opened: string | null; closedAfter: string | null }>();

  const nNew = opt.openingsPerWeek * (opt.weeks - 1);
  const total = opt.stores + nNew;
  for (let i = 0; i < total; i++) {
    const code = `D${String(100 + i)}`;
    const days = patterns[i % patterns.length];
    const weekly = 8 + rnd() * 50;
    const isNew = i >= opt.stores;
    // openings spread over weeks 2..n
    const openDay = isNew ? 7 + Math.floor(((i - opt.stores) / opt.openingsPerWeek)) * 7 + Math.floor(rnd() * 7) : 0;
    const isClosed = !isNew && i < opt.closures;
    const closeDay = isClosed ? totalDays - 16 - Math.floor(rnd() * 4) : totalDays;
    const shares = scheduleShares(DEMO_PATTERN, days, 'forward');
    let lastDate: string | null = null;
    for (let d = openDay; d < closeDay; d++) {
      const wd = d % 7; // the demo starts on a Monday
      if (!shares[wd]) continue;
      const v = Math.max(0.2, weekly * shares[wd] * (1 + 0.12 * gauss()));
      const date = addDays(opt.start, d);
      lastDate = date;
      rows.push({
        date, code, name: `Demo ${i + 1}`, region: regions[i % regions.length], format: formats[i % formats.length],
        volume: Math.round(v * 100) / 100, weight: Math.round(v * 410), qty: Math.round(v * 38),
      });
    }
    truth.set(code, { weekly, days, opened: isNew ? addDays(opt.start, openDay) : null, closedAfter: isClosed ? lastDate : null });
  }
  return { rows, truth };
}
