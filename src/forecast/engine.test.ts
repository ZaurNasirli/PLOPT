import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { blockDays, maskShares, scheduleShares, storeProfile } from '../rota/core/rhythm';
import { analyze, predict } from './engine';
import { DEMO_PATTERN, generateDemoOrders } from './demo';
import { autoDetectOrderMapping, buildOrders, parseNumber, parseOrderDate, readOrdersWorkbook } from './ordersImport';

describe('rhythm', () => {
  it('an order covers the days until the next one (forward) or since the previous one (backward)', () => {
    expect(blockDays(0, [0, 3], 'forward')).toEqual([0, 1, 2]);
    expect(blockDays(3, [0, 3], 'forward')).toEqual([3, 4, 5, 6]);
    expect(blockDays(0, [0, 3], 'backward')).toEqual([0, 6, 5, 4]);
    expect(blockDays(2, [2], 'forward')).toHaveLength(7);
  });

  it('20 m³ on Mon + Thu splits by the consumption of the covered days, not 10 + 10', () => {
    const s = scheduleShares(DEMO_PATTERN, [0, 3], 'forward');
    expect(s[0] + s[3]).toBeCloseTo(1, 9);
    expect(20 * s[0]).toBeCloseTo(20 * (0.13 + 0.12 + 0.12), 6);
    expect(20 * s[3]).toBeGreaterThan(12);
    const flat = maskShares(new Array(7).fill(1 / 7), 0b1001, 'forward');
    expect(flat[0]).toBeCloseTo(3 / 7, 9);
  });

  it('a store profile reproduces the store’s own shares for its own days', () => {
    const shares = [0.7, 0, 0, 0.3, 0, 0, 0];
    const p = storeProfile(DEMO_PATTERN, [0, 3], shares, 'forward');
    const back = scheduleShares(p, [0, 3], 'forward');
    expect(back[0]).toBeCloseTo(0.7, 9);
    expect(back[3]).toBeCloseTo(0.3, 9);
  });
});

describe('forecast', () => {
  it('methods', () => {
    expect(predict([10, 20, 30], 'mean')).toBe(20);
    expect(predict([10, 20, 30], 'last')).toBe(30);
    expect(predict([10, 20, 30], 'wmean')).toBeCloseTo(140 / 6, 9);
    expect(predict([10, 100, 12], 'median')).toBe(12);
    expect(predict([10, 20, 30], 'trend')).toBeGreaterThan(20);
  });

  it('demo orders: openings, closures, forecast and the weekday pattern', () => {
    const { rows, truth } = generateDemoOrders({ weeks: 4, stores: 120, openingsPerWeek: 2, closures: 2 });
    const a = analyze(rows, { closedAfterDays: 15, newAfterWeeks: 1 });
    expect(a.weeks).toHaveLength(4);
    expect(a.weeks.every(w => w.complete)).toBe(true);
    expect(a.targetWeek).toBe('2026-11-23');

    // 6 stores opened in weeks 2–4, 2 closed
    const opened = [...truth.entries()].filter(([, t]) => t.opened).map(([c]) => c).sort();
    expect(a.stores.filter(s => s.openedWeek).map(s => s.code).sort()).toEqual(opened);
    expect(a.openings.total).toBe(6);
    expect(a.openings.expected).toBeCloseTo(2, 5);
    expect(a.openings.low).toBeLessThanOrEqual(2);
    expect(a.openings.high).toBeGreaterThanOrEqual(2);
    const closed = [...truth.entries()].filter(([, t]) => t.closedAfter).map(([c]) => c).sort();
    expect(a.stores.filter(s => s.status === 'closed').map(s => s.code).sort()).toEqual(closed);
    for (const s of a.stores.filter(x => x.status === 'closed')) expect(s.forecast.volume).toBe(0);

    // forecast of established stores within the noise of the truth
    let err = 0, tot = 0;
    for (const s of a.stores.filter(x => x.status === 'active')) {
      err += Math.abs(s.forecast.volume - truth.get(s.code)!.weekly);
      tot += truth.get(s.code)!.weekly;
      expect(s.low.volume).toBeLessThanOrEqual(s.forecast.volume);
      expect(s.high.volume).toBeGreaterThanOrEqual(s.forecast.volume);
    }
    expect(err / tot).toBeLessThan(0.08);
    expect(a.backtest[a.method]).not.toBeNull();

    // the chain pattern is found: forward, busier weekend
    expect(a.rhythm.direction).toBe('forward');
    a.rhythm.chain.forEach((w, d) => expect(Math.abs(w - DEMO_PATTERN[d])).toBeLessThan(0.03));
    // next week by day adds up to the forecast
    const live = a.stores.filter(s => s.status !== 'closed');
    expect(a.nextByDay.reduce((x, y) => x + y, 0)).toBeCloseTo(live.reduce((x, s) => x + s.forecast.volume, 0), 6);
  });

  it('a store with one order so far is an opening with the forecast of a typical store (marked low data)', () => {
    const rows = [
      ...['2026-11-02', '2026-11-09', '2026-11-16'].map(date => ({ date, code: 'A', volume: 10, weight: 0, qty: 0 })),
      { date: '2026-11-19', code: 'B', volume: 4, weight: 0, qty: 0 },
    ];
    const a = analyze(rows, { closedAfterDays: 15, newAfterWeeks: 1 });
    const b = a.stores.find(s => s.code === 'B')!;
    expect(b.status).toBe('new');
    expect(b.historyWeeks).toBe(0);
    expect(b.lowData).toBe(true);
    expect(b.forecast.volume).toBeCloseTo(10, 6);
    expect(b.weekly.volume.every(v => v === null)).toBe(true);
    expect(a.openings.total).toBe(1);
  });

  it('a new store with two orders and no full week: the week is rebuilt from the rhythm', () => {
    const { rows } = generateDemoOrders({ weeks: 3, stores: 60, openingsPerWeek: 0, closures: 0 });
    // a Tue/Fri store opened on Tuesday of the last week: 7.4 + 12.6 ≈ 20 m³ a week
    const sh = [0, 0.12 + 0.12 + 0.13, 0, 0, 0.16 + 0.18 + 0.16 + 0.13, 0, 0];
    rows.push({ date: '2026-11-10', code: 'N', volume: 20 * sh[1], weight: 0, qty: 0 }, { date: '2026-11-13', code: 'N', volume: 20 * sh[4], weight: 0, qty: 0 });
    const a = analyze(rows, { closedAfterDays: 15, newAfterWeeks: 1 });
    const n = a.stores.find(s => s.code === 'N')!;
    expect(n.lowData).toBe(false);
    expect(n.forecast.volume).toBeGreaterThan(18);
    expect(n.forecast.volume).toBeLessThan(22);
  });

  it('15 days without orders = closed; fewer = still open (silent after a week)', () => {
    const base = ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'];
    const rows = [
      ...base.map(date => ({ date, code: 'A', volume: 10, weight: 0, qty: 0 })),
      ...['2026-11-02', '2026-11-08'].map(date => ({ date, code: 'C', volume: 10, weight: 0, qty: 0 })), // 15 days before 23rd
      ...['2026-11-02', '2026-11-09', '2026-11-15'].map(date => ({ date, code: 'S', volume: 10, weight: 0, qty: 0 })), // 8 days
    ];
    const a = analyze(rows, { closedAfterDays: 15, newAfterWeeks: 1 });
    expect(a.stores.find(s => s.code === 'C')!.status).toBe('closed');
    expect(a.stores.find(s => s.code === 'S')!.status).toBe('silent');
    expect(a.closures).toBe(1);
  });
});

describe('orders file', () => {
  it('dates: Excel serial, text day-first, month-first column, ISO with time; numbers with commas', () => {
    expect(parseOrderDate(46350)).toBe('2026-11-24');
    expect(parseOrderDate('24.11.2026 01:30')).toBe('2026-11-24');
    expect(parseOrderDate('03/11/2026')).toBe('2026-11-03');
    expect(parseOrderDate('11/03/2026', true)).toBe('2026-11-03');
    expect(parseOrderDate('2026-11-24T23:50:00')).toBe('2026-11-24');
    expect(parseOrderDate('31.02.2026')).toBeNull();
    expect(parseNumber('1 234,5')).toBe(1234.5);
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('12,75')).toBe(12.75);
  });

  it('reads an Azerbaijani orders sheet and prefers the order date over the shipment date', () => {
    const aoa = [
      ['Göndərmə tarixi', 'Sifariş tarixi', 'Müştəri Kodu', 'Müştəri Adı', 'Alt', 'H/H', 'H/C', 'H/S'],
      ['25.11.2026', '24.11.2026', 'AB40', 'Qobustan', 'SAHIL-ELET', '12,5', 5000, 400],
      ['26.11.2026', new Date(2026, 10, 25), 'AA85', 'Sahil', 'SAHIL-ELET', 3, '', ''],
      ['', '', '', '', '', '', '', ''],
      ['27.11.2026', 'xx', 'AA86', 'Bad', '', 1, 1, 1],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sifarişlər');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const sheet = readOrdersWorkbook(buf, 'orders.xlsx');
    const m = autoDetectOrderMapping(sheet.headers);
    expect(m.date).toBe(1);
    expect(m.code).toBe(2);
    expect(m.volume).toBe(5);
    const res = buildOrders(sheet, m);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({ date: '2026-11-24', code: 'AB40', volume: 12.5, weight: 5000, qty: 400, region: 'SAHIL-ELET' });
    expect(res.rows[1].date).toBe('2026-11-25');
    expect(res.skipped.noDate).toBe(1);
    expect(res.badDateExample).toBe('xx');
  });
});
