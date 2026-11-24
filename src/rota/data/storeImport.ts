import * as XLSX from 'xlsx';
import { ImportIssue, RotaStore, VolumeMode, Weekday } from '../types';
import { canonicalSpellings, cleanName, nameKey, parseDayDigits } from '../core/names';
import { isRoundTheClockText, parseWindow } from '../core/time';

/** Fields of the store file. A mapping points each field to a column index (-1 = not mapped). */
export type StoreField =
  | 'storeCode' | 'storeName' | 'party' | 'region' | 'storeFormat' | 'deliveryDays' | 'segment'
  | 'lat' | 'lng' | 'coordinates' | 'weeklyVolume' | 'weeklyWeight' | 'weeklyQty' | 'receivingTime' | 'batchTime';

export type StoreMapping = Record<StoreField, number>;

export const STORE_FIELDS: StoreField[] = [
  'storeCode', 'storeName', 'party', 'region', 'storeFormat', 'deliveryDays', 'segment',
  'lat', 'lng', 'coordinates', 'weeklyVolume', 'weeklyWeight', 'weeklyQty', 'receivingTime', 'batchTime',
];

export const REQUIRED_FIELDS: StoreField[] = ['storeCode', 'storeName', 'party', 'region', 'deliveryDays', 'weeklyVolume'];

/**
 * Header names (lower case) per field: Azerbaijani (the real file), Russian, English, Turkish.
 * The store file has two columns called "Format": the first is the shop format, the second the segment,
 * so 'format' is listed for both and the detection order gives them out by position.
 */
const CANONICAL: Record<StoreField, string[]> = {
  storeCode: ['müştəri kodu', 'musteri kodu', 'mağaza kodu', 'magaza kodu', 'код магазина', 'код клиента', 'код', 'store code', 'store_code', 'customer code', 'müşteri kodu'],
  storeName: ['müştəri adı', 'musteri adi', 'mağaza adı', 'magaza adi', 'название магазина', 'магазин', 'название', 'store name', 'store_name', 'customer name', 'müşteri adı'],
  party: ['pap', 'партия', 'партия отправки', 'партия отгрузки', 'party', 'batch', 'partiya', 'parti'],
  region: ['alt', 'регион', 'region', 'bölgə', 'bolge', 'bölge', 'зона'],
  storeFormat: ['format', 'формат', 'store format', 'формат магазина'],
  deliveryDays: ['rg', 'дни', 'дни отправки', 'дни доставки', 'delivery days', 'shipment days', 'günlər', 'gunler', 'günler'],
  segment: ['format', 'сегмент', 'segment', 'seqment'],
  lat: ['enlem', 'en', 'широта', 'lat', 'latitude', 'enlik'],
  lng: ['boylam', 'долгота', 'lng', 'lon', 'longitude', 'uzunluq'],
  coordinates: ['координаты', 'coordinates', 'koordinatlar'],
  weeklyVolume: ['h/h', 'объем', 'объём', 'объем, м3', 'объём, м³', 'volume', 'həcm', 'hecm', 'hacim'],
  weeklyWeight: ['h/c', 'вес', 'вес, кг', 'weight', 'çəki', 'ceki', 'ağırlık'],
  weeklyQty: ['h/s', 'количество', 'кол-во', 'шт', 'quantity', 'qty', 'say', 'adet', 'miktar'],
  receivingTime: ['iş vaxtı', 'is vaxti', 'время приёмки', 'время приемки', 'окно приёмки', 'receiving time', 'çalışma saati', 'teslim alma saati'],
  batchTime: ['patyiyanin çatdırılma vaxtı', 'partiyanın çatdırılma vaxtı', 'partiyanin catdirilma vaxti', 'окно партии', 'время партии', 'время отправки партии', 'batch time', 'party window', 'parti saati'],
};

/** Specific fields first so generic aliases cannot take their columns */
const DETECTION_ORDER: StoreField[] = [
  'storeCode', 'storeName', 'batchTime', 'receivingTime', 'party', 'region', 'storeFormat', 'segment',
  'deliveryDays', 'lat', 'lng', 'coordinates', 'weeklyVolume', 'weeklyWeight', 'weeklyQty',
];

export interface RawSheet {
  fileName: string;
  sheetName: string;
  headers: string[];
  /** data rows (after the header row), cell values as read */
  rows: unknown[][];
  /** Excel row number of the header row (1-based) */
  headerRow: number;
}

export function columnLetter(index: number): string {
  let s = '';
  let n = index + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function readStoreWorkbook(data: ArrayBuffer, fileName: string): RawSheet {
  const wb = XLSX.read(data, { type: 'array', cellFormula: false, cellHTML: false });
  const sheetName = wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!ws) throw new Error('no sheet');
  const all = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true, blankrows: false });
  const headerIdx = all.findIndex(r => Array.isArray(r) && r.filter(v => String(v ?? '').trim() !== '').length >= 2);
  if (headerIdx < 0) return { fileName, sheetName, headers: [], rows: [], headerRow: 1 };
  const headers = (all[headerIdx] as unknown[]).map(v => String(v ?? '').trim());
  const rows = all.slice(headerIdx + 1).filter(r => Array.isArray(r) && r.some(v => String(v ?? '').trim() !== '')) as unknown[][];
  return { fileName, sheetName, headers, rows, headerRow: headerIdx + 1 };
}

export function emptyMapping(): StoreMapping {
  return Object.fromEntries(STORE_FIELDS.map(f => [f, -1])) as StoreMapping;
}

/** Lower case without the dot Turkish/Azerbaijani "İ" leaves after lowercasing ("İş" -> "iş") */
export function headerKey(h: string): string {
  return h.toLocaleLowerCase('en-US').normalize('NFD').replace(/\u0307/g, '').normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function autoDetectMapping(headers: string[]): StoreMapping {
  const mapping = emptyMapping();
  const lower = headers.map(headerKey);
  const used = new Set<number>();
  const pass = (match: (h: string, alias: string) => boolean) => {
    for (const field of DETECTION_ORDER) {
      if (mapping[field] >= 0) continue;
      for (const alias of CANONICAL[field].map(headerKey)) {
        const idx = lower.findIndex((h, i) => !used.has(i) && h && match(h, alias));
        if (idx >= 0) {
          mapping[field] = idx;
          used.add(idx);
          break;
        }
      }
    }
  };
  pass((h, a) => h === a);
  // substring pass only for longer aliases (short ones like "en" or "alt" would match anything)
  pass((h, a) => a.length >= 4 && h.includes(a));
  // lat/lng given: the single coordinates column is not needed
  if (mapping.lat >= 0 && mapping.lng >= 0) mapping.coordinates = -1;
  return mapping;
}

export function missingRequired(mapping: StoreMapping): StoreField[] {
  const missing = REQUIRED_FIELDS.filter(f => mapping[f] < 0);
  if (mapping.lat < 0 && mapping.lng < 0 && mapping.coordinates < 0) return missing; // coordinates are optional
  return missing;
}

export interface StoreImportResult {
  stores: RotaStore[];
  issues: ImportIssue[];
  totalRows: number;
  volumeMode: VolumeMode;
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function cellText(raw: unknown): string {
  if (raw instanceof Date) return raw.toISOString();
  return String(raw ?? '').trim();
}

/** Excel may store "135" as a number; times like 0.333 (08:00) are not expected here, text is kept */
function daysText(raw: unknown): string {
  return typeof raw === 'number' ? String(Math.round(raw)) : cellText(raw);
}

/**
 * Turns the sheet into stores and collects every remark for the check dialog.
 * Rows with errors are left out; warnings and notes do not block the import.
 */
export function buildStores(sheet: RawSheet, mapping: StoreMapping, volumeMode: VolumeMode): StoreImportResult {
  const issues: ImportIssue[] = [];
  const col = (row: unknown[], f: StoreField) => (mapping[f] >= 0 ? row[mapping[f]] : '');
  const header = (f: StoreField) => (mapping[f] >= 0 ? sheet.headers[mapping[f]] || columnLetter(mapping[f]) : f);

  // One spelling per party / segment (PART vs Part, ARAZ vs Araz)
  const partySpell = canonicalSpellings(sheet.rows.map(r => cellText(col(r, 'party'))));
  const segmentSpell = canonicalSpellings(sheet.rows.map(r => cellText(col(r, 'segment'))));
  for (const m of partySpell.merged) issues.push({ severity: 'info', code: 'partySpelling', params: { canonical: m.canonical, variants: m.variants.join(', ') } });
  for (const m of segmentSpell.merged) issues.push({ severity: 'info', code: 'segmentSpelling', params: { canonical: m.canonical, variants: m.variants.join(', ') } });

  const seen = new Set<string>();
  const stores: RotaStore[] = [];
  const partyWindows = new Map<string, Map<string, number>>();

  sheet.rows.forEach((row, i) => {
    const rowNumber = sheet.headerRow + 1 + i;
    const storeCode = cellText(col(row, 'storeCode'));
    const storeName = cleanName(col(row, 'storeName'));
    const base = { rowNumber, storeCode, storeName };
    let rowOk = true;
    const err = (code: string, extra: Partial<ImportIssue> = {}) => { issues.push({ severity: 'error', code, ...base, ...extra }); rowOk = false; };
    const warn = (code: string, extra: Partial<ImportIssue> = {}) => issues.push({ severity: 'warning', code, ...base, ...extra });
    const info = (code: string, extra: Partial<ImportIssue> = {}) => issues.push({ severity: 'info', code, ...base, ...extra });

    if (!storeCode) { err('noCode'); return; }
    if (seen.has(storeCode.toLowerCase())) { err('duplicateCode'); return; }
    seen.add(storeCode.toLowerCase());
    if (!storeName) warn('noName');

    const partyRaw = cleanName(col(row, 'party'));
    const party = partySpell.spelling.get(nameKey(partyRaw)) ?? partyRaw;
    if (!party) err('noParty');
    const region = cleanName(col(row, 'region'));
    if (!region) err('noRegion');
    const segRaw = cleanName(col(row, 'segment'));
    const segment = segmentSpell.spelling.get(nameKey(segRaw)) ?? segRaw;
    if (mapping.segment >= 0 && !segment) warn('noSegment');

    const daysRaw = daysText(col(row, 'deliveryDays'));
    const { days, bad } = parseDayDigits(daysRaw);
    if (!daysRaw) err('noDays');
    else if (bad.length) {
      if (days.length === 0) err('unknownDayDigits', { value: daysRaw, params: { digits: bad.join('') } });
      else warn('unknownDayDigits', { value: daysRaw, params: { digits: bad.join('') } });
    }
    if (days.includes('Вс' as Weekday)) info('sundayStore', { value: daysRaw });

    const num = (f: StoreField, required: boolean): number => {
      if (mapping[f] < 0) return 0;
      const raw = col(row, f);
      const n = toNumber(raw);
      if (n === null) {
        if (required) warn('emptyVolume');
        return 0;
      }
      if (Number.isNaN(n)) { err('invalidNumber', { column: header(f), value: cellText(raw), params: { column: header(f), value: cellText(raw) } }); return 0; }
      if (n < 0) { err('negativeNumber', { column: header(f), params: { column: header(f) } }); return 0; }
      return n;
    };
    const factor = volumeMode === 'per_delivery' ? Math.max(1, days.length) : 1;
    const weeklyVolume = num('weeklyVolume', true) * factor;
    const weeklyWeight = num('weeklyWeight', false) * factor;
    const weeklyQty = num('weeklyQty', false) * factor;

    // Coordinates
    let lat: number | null = null;
    let lng: number | null = null;
    if (mapping.lat >= 0 || mapping.lng >= 0) {
      const a = toNumber(col(row, 'lat'));
      const b = toNumber(col(row, 'lng'));
      if (a !== null && b !== null && !Number.isNaN(a) && !Number.isNaN(b)) { lat = a; lng = b; }
    } else if (mapping.coordinates >= 0) {
      const parts = cellText(col(row, 'coordinates')).split(/[,;\s]+/).map(s => Number(s.replace(',', '.'))).filter(Number.isFinite);
      if (parts.length >= 2) { lat = parts[0]; lng = parts[1]; }
    }
    if (lat !== null && lng !== null && (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0))) {
      warn('invalidCoordinates');
      lat = null;
      lng = null;
    } else if (lat === null || lng === null) {
      warn('noCoordinates');
    }

    // Time windows (24/7 decisions belong to the rules: here only the format is checked)
    const receivingTime = cellText(col(row, 'receivingTime'));
    if (mapping.receivingTime >= 0) {
      if (!receivingTime) warn('emptyReceiving');
      else if (!isRoundTheClockText(receivingTime) && parseWindow(receivingTime, { emptyIs247: true, s724Is247: true }).kind !== 'window') {
        warn('invalidReceiving', { value: receivingTime, params: { value: receivingTime } });
      }
    }
    const batchTime = cellText(col(row, 'batchTime'));
    if (batchTime && parseWindow(batchTime, { emptyIs247: false, s724Is247: true }).kind === 'invalid') {
      warn('invalidBatchTime', { value: batchTime, params: { value: batchTime } });
    }
    if (party && batchTime) {
      const k = nameKey(party);
      let m = partyWindows.get(k);
      if (!m) partyWindows.set(k, (m = new Map()));
      const w = batchTime.replace(/\s+/g, ' ');
      m.set(w, (m.get(w) ?? 0) + 1);
    }

    if (!rowOk) return;
    stores.push({
      storeCode, storeName: storeName || storeCode, party, region,
      storeFormat: cleanName(col(row, 'storeFormat')), segment,
      originalDays: days, lat, lng, weeklyVolume, weeklyWeight, weeklyQty,
      receivingTime, batchTime, rowNumber,
    });
  });

  for (const [k, m] of partyWindows) {
    if (m.size > 1) {
      const party = partySpell.spelling.get(k) ?? k;
      const windows = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} (×${n})`).join(', ');
      issues.push({ severity: 'warning', code: 'partyWindowMismatch', params: { party, windows } });
    }
  }

  return { stores, issues, totalRows: sheet.rows.length, volumeMode };
}

/** Party windows as found in the store file (most frequent value per party) */
export function partyWindowsFromStores(stores: RotaStore[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const s of stores) {
    if (!s.batchTime) continue;
    const k = nameKey(s.party);
    let m = counts.get(k);
    if (!m) counts.set(k, (m = new Map()));
    m.set(s.batchTime, (m.get(s.batchTime) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const [k, m] of counts) out.set(k, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  return out;
}
