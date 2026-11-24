/** Excel export of a Proqnoz analysis: stores, weeks, openings/closures and the rhythm. */
import * as XLSX from 'xlsx';
import { ALL_WEEKDAYS, Weekday } from '../rota/types';
import { saveWorkbook } from '../rota/core/download';
import { addDays, Analysis, Measure, MEASURES } from './engine';

type T = (key: string, params?: Record<string, string | number>) => string;

export const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

export function exportForecast(a: Analysis, t: T, dayShort: (d: Weekday) => string, fileBase: string) {
  const wb = XLSX.utils.book_new();
  const ms = MEASURES.filter(m => a.measures[m]);
  const unit = (m: Measure) => t(`fcUnit_${m}`);
  const dec = (m: Measure) => (m === 'volume' ? 2 : 0);
  const completeWeeks = a.weeks.map((w, i) => ({ w, i })).filter(x => x.w.complete);

  // stores
  const head = [
    t('fcColCode'), t('fcColName'), t('fcColRegion'), t('fcField_format'), t('fcColStatus'), t('fcColDays'),
    ...completeWeeks.map(({ w }) => `${dmy(w.start).slice(0, 5)}, ${unit(a.mainMeasure)}`),
    ...ms.flatMap(m => [`${t('fcForecast')}, ${unit(m)}`, `${t('fcLow')}, ${unit(m)}`, `${t('fcHigh')}, ${unit(m)}`]),
    ...ALL_WEEKDAYS.map(d => `${t('fcForecast')} ${dayShort(d)}, ${unit(a.mainMeasure)}`),
  ];
  const rows = a.stores.map(s => [
    s.code, s.name, s.region, s.format, t(`fcStatus_${s.status}`), s.orderDays.map(d => d + 1).join(''),
    ...completeWeeks.map(({ i }) => { const v = s.weekly[a.mainMeasure][i]; return v === null ? '' : round(v, dec(a.mainMeasure)); }),
    ...ms.flatMap(m => [round(s.forecast[m], dec(m)), round(s.low[m], dec(m)), round(s.high[m], dec(m))]),
    ...s.nextByDay.map(v => (v ? round(v, dec(a.mainMeasure)) : '')),
  ]);
  const ws1 = XLSX.utils.aoa_to_sheet([head, ...rows]);
  ws1['!cols'] = head.map((h, i) => ({ wch: i === 1 ? 26 : Math.max(8, Math.min(16, h.length + 1)) }));
  ws1['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: head.length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, ws1, t('fcXlsForecast').slice(0, 31));

  // weeks + the forecast week
  const wHead = [t('fcXlsWeek'), t('fcXlsComplete'), ...ms.map(m => unit(m)), t('fcXlsOrders'), t('fcXlsStores'), t('fcOpenings'), t('fcClosures')];
  const wRows: unknown[][] = a.weeks.map(w => [
    `${dmy(w.start)} – ${dmy(addDays(w.start, 6))}`, w.complete ? t('fcXlsYes') : t('fcXlsNo'),
    ...ms.map(m => round(w.totals[m], dec(m))), w.orders, w.stores, w.openings, w.closures,
  ]);
  wRows.push([
    `${t('fcForecast')}: ${dmy(a.targetWeek)} – ${dmy(addDays(a.targetWeek, 6))}`, '',
    ...ms.map(m => round(a.totals.forecast[m], dec(m))), Math.round(a.ordersNext),
    a.stores.filter(s => s.status !== 'closed').length, a.openings.expected === null ? '' : round(a.openings.expected, 1), '',
  ]);
  const ws2 = XLSX.utils.aoa_to_sheet([wHead, ...wRows]);
  ws2['!cols'] = wHead.map((_, i) => ({ wch: i === 0 ? 34 : 12 }));
  XLSX.utils.book_append_sheet(wb, ws2, t('fcXlsWeeks').slice(0, 31));

  // openings / closures
  const oHead = [t('fcXlsType'), t('fcColCode'), t('fcColName'), t('fcColRegion'), t('fcDate')];
  const oRows = [
    ...a.stores.filter(s => s.openedWeek).sort((x, y) => x.firstDate.localeCompare(y.firstDate)).map(s => [t('fcOpenings'), s.code, s.name, s.region, dmy(s.firstDate)]),
    ...a.stores.filter(s => s.status === 'closed').sort((x, y) => x.lastDate.localeCompare(y.lastDate)).map(s => [t('fcClosures'), s.code, s.name, s.region, dmy(s.lastDate)]),
  ];
  const ws3 = XLSX.utils.aoa_to_sheet([oHead, ...oRows]);
  ws3['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 26 }, { wch: 18 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws3, t('fcXlsOpen').slice(0, 31));

  // rhythm
  const ws4 = XLSX.utils.aoa_to_sheet([
    [t('fcDay'), t('fcXlsConsumption')],
    ...ALL_WEEKDAYS.map((d, i) => [dayShort(d), round(a.rhythm.chain[i], 4)]),
    [],
    [t(a.rhythm.direction === 'forward' ? 'fcDirForward' : 'fcDirBackward')],
  ]);
  ws4['!cols'] = [{ wch: 14 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws4, t('fcXlsRhythm').slice(0, 31));

  saveWorkbook(wb, `${fileBase}_${a.targetWeek}.xlsx`);
}
