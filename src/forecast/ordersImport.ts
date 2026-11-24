/**
 * Orders file for Proqnoz: one row = one order of a store for a date. Columns are found by their
 * headers (Azerbaijani, Russian, English, Turkish); the user can fix the mapping on the page.
 */
import * as XLSX from 'xlsx';
import { headerKey } from '../rota/data/storeImport';
import type { OrderRow } from './engine';

export type OrderField = 'date' | 'code' | 'name' | 'volume' | 'weight' | 'qty' | 'region' | 'format' | 'segment';
export const ORDER_FIELDS: OrderField[] = ['date', 'code', 'name', 'volume', 'weight', 'qty', 'region', 'format', 'segment'];
export type OrderMapping = Record<OrderField, number>;

/** Most specific aliases first: an "order date" column wins over a shipment date */
const ALIASES: Record<OrderField, string[]> = {
  date: [
    'sifariş tarixi', 'sifaris tarixi', 'дата заказа', 'order date', 'sipariş tarihi', 'siparis tarihi',
    'tarix', 'дата', 'date', 'tarih',
  ],
  code: ['müştəri kodu', 'musteri kodu', 'mağaza kodu', 'magaza kodu', 'код магазина', 'код клиента', 'store code', 'customer code', 'müşteri kodu', 'mağaza kodu', 'код', 'code', 'kod'],
  name: ['müştəri adı', 'musteri adi', 'mağaza adı', 'magaza adi', 'название магазина', 'магазин', 'название', 'store name', 'customer name', 'müşteri adı', 'mağaza', 'store', 'ad'],
  volume: ['h/h', 'həcm', 'hecm', 'объем', 'объём', 'объем, м3', 'объём, м³', 'м3', 'м³', 'm3', 'm³', 'volume', 'hacim', 'kub'],
  weight: ['h/c', 'çəki', 'ceki', 'вес', 'вес, кг', 'кг', 'kg', 'weight', 'ağırlık', 'agirlik'],
  qty: ['h/s', 'say', 'количество', 'кол-во', 'шт', 'qty', 'quantity', 'pcs', 'adet', 'miktar'],
  region: ['alt', 'регион', 'region', 'bölgə', 'bolge', 'bölge', 'зона', 'zona'],
  format: ['format', 'формат', 'store format', 'формат магазина'],
  segment: ['сегмент', 'segment', 'seqment', 'format'],
};
const DETECTION_ORDER: OrderField[] = ['date', 'code', 'name', 'volume', 'weight', 'qty', 'region', 'format', 'segment'];
/** headers that mean a shipment date: used only when there is no order date column */
const SHIPMENT_DATE = ['göndərmə tarixi', 'gonderme tarixi', 'дата отгрузки', 'дата отправки', 'дата доставки', 'shipment date', 'delivery date', 'sevk tarihi', 'teslim tarihi'];

export interface OrdersSheet {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: unknown[][];
  headerRow: number;
}

export function readOrdersWorkbook(data: ArrayBuffer, fileName: string): OrdersSheet {
  const wb = XLSX.read(data, { type: 'array', cellDates: true, cellFormula: false, cellHTML: false });
  let best: OrdersSheet | null = null;
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const all = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true, blankrows: false });
    const headerIdx = all.findIndex(r => Array.isArray(r) && r.filter(v => String(v ?? '').trim() !== '').length >= 3);
    if (headerIdx < 0) continue;
    const headers = (all[headerIdx] as unknown[]).map(v => String(v ?? '').trim());
    const rows = all.slice(headerIdx + 1).filter(r => Array.isArray(r) && r.some(v => String(v ?? '').trim() !== '')) as unknown[][];
    const sheet = { fileName, sheetName, headers, rows, headerRow: headerIdx + 1 };
    // the sheet with a date and a code column and the most rows
    const m = autoDetectOrderMapping(headers);
    const score = (m.date >= 0 ? 1e9 : 0) + (m.code >= 0 ? 1e8 : 0) + rows.length;
    const bestScore = best ? (() => { const bm = autoDetectOrderMapping(best.headers); return (bm.date >= 0 ? 1e9 : 0) + (bm.code >= 0 ? 1e8 : 0) + best.rows.length; })() : -1;
    if (score > bestScore) best = sheet;
  }
  if (!best) throw new Error('no sheet');
  return best;
}

export function emptyOrderMapping(): OrderMapping {
  return Object.fromEntries(ORDER_FIELDS.map(f => [f, -1])) as OrderMapping;
}

export function autoDetectOrderMapping(headers: string[]): OrderMapping {
  const mapping = emptyOrderMapping();
  const lower = headers.map(headerKey);
  const used = new Set<number>();
  const pass = (match: (h: string, a: string) => boolean) => {
    for (const field of DETECTION_ORDER) {
      if (mapping[field] >= 0) continue;
      for (const alias of ALIASES[field].map(headerKey)) {
        const idx = lower.findIndex((h, i) => !used.has(i) && h && match(h, alias));
        if (idx >= 0) { mapping[field] = idx; used.add(idx); break; }
      }
    }
  };
  pass((h, a) => h === a);
  // substring pass only for longer aliases; never a shipment date for the order date
  pass((h, a) => a.length >= 4 && h.includes(a) && !SHIPMENT_DATE.some(s => h.includes(headerKey(s))));
  if (mapping.date < 0) {
    const idx = lower.findIndex((h, i) => !used.has(i) && SHIPMENT_DATE.some(s => h.includes(headerKey(s))));
    if (idx >= 0) mapping.date = idx;
  }
  return mapping;
}

export const missingOrderFields = (m: OrderMapping): OrderField[] => {
  const out: OrderField[] = [];
  if (m.date < 0) out.push('date');
  if (m.code < 0) out.push('code');
  if (m.volume < 0 && m.weight < 0 && m.qty < 0) out.push('volume');
  return out;
};

// ------------------------------------------------------------------------------------------------
// Values

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
};

/** Day-first unless the column shows month-first (a second part above 12) */
export function detectMonthFirst(values: unknown[]): boolean {
  let monthFirst = 0, dayFirst = 0;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const m = v.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
    if (!m) continue;
    if (+m[2] > 12) monthFirst++;
    if (+m[1] > 12) dayFirst++;
  }
  return monthFirst > 0 && dayFirst === 0;
}

/** Excel serial, Date or text → YYYY-MM-DD (time of day is dropped: the order date counts) */
export function parseOrderDate(v: unknown, monthFirst = false): string | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    // SheetJS gives dates at local midnight; a few seconds of rounding must not move the day
    const t = new Date(v.getTime() + 30_000);
    return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v < 20000 || v > 80000) return null;
    const p = XLSX.SSF.parse_date_code(v);
    return p ? ymd(p.y, p.m, p.d) : null;
  }
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (m) return monthFirst ? ymd(+m[3], +m[1], +m[2]) : ymd(+m[3], +m[2], +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(s)) return parseOrderDate(Number(s));
  return null;
}

export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim().replace(/[\s  ']/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) {
    // the last separator is the decimal one
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export interface OrdersImportResult {
  rows: OrderRow[];
  /** rows skipped: no date / no store code / no measure / negative values */
  skipped: { noDate: number; noCode: number; noValue: number; negative: number };
  /** example of a value that could not be read as a date */
  badDateExample: string | null;
  headers: Partial<Record<OrderField, string>>;
}

const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);
const text = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ');

export function buildOrders(sheet: OrdersSheet, mapping: OrderMapping): OrdersImportResult {
  const monthFirst = detectMonthFirst(sheet.rows.map(r => cell(r, mapping.date)));
  const skipped = { noDate: 0, noCode: 0, noValue: 0, negative: 0 };
  let badDateExample: string | null = null;
  const rows: OrderRow[] = [];
  for (const r of sheet.rows) {
    const code = text(cell(r, mapping.code));
    if (!code) { skipped.noCode++; continue; }
    const date = parseOrderDate(cell(r, mapping.date), monthFirst);
    if (!date) {
      skipped.noDate++;
      badDateExample ??= text(cell(r, mapping.date)) || '—';
      continue;
    }
    const num = (f: OrderField) => (mapping[f] >= 0 ? parseNumber(cell(r, mapping[f])) : null);
    const volume = num('volume'), weight = num('weight'), qty = num('qty');
    if (volume === null && weight === null && qty === null) { skipped.noValue++; continue; }
    if ((volume ?? 0) < 0 || (weight ?? 0) < 0 || (qty ?? 0) < 0) { skipped.negative++; continue; }
    rows.push({
      date, code,
      name: text(cell(r, mapping.name)) || undefined,
      region: text(cell(r, mapping.region)) || undefined,
      format: text(cell(r, mapping.format)) || undefined,
      segment: text(cell(r, mapping.segment)) || undefined,
      volume: volume ?? 0, weight: weight ?? 0, qty: qty ?? 0,
    });
  }
  const headers: Partial<Record<OrderField, string>> = {};
  for (const f of ORDER_FIELDS) if (mapping[f] >= 0) headers[f] = sheet.headers[mapping[f]];
  return { rows, skipped, badDateExample, headers };
}
