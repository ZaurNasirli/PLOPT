/**
 * Excel export in the layout of the reference file (reference/build2.py):
 * stores before / after with formulas, an analysis sheet that recalculates in Excel,
 * and the chain (Urban) moves with reasons. Sheet names and texts follow the interface language.
 */
import type ExcelJSType from 'exceljs';
import { ALL_WEEKDAYS, DAY_DIGIT, StoreView, Weekday } from '../types';
import type { RotaWorkspace } from '../store/workspace';
import type { RuleSet } from '../rules/types';
import type { RotaI18n } from '../i18n';
import { fmt } from '../i18n';
import type { PlanReport } from '../state/planReport';
import { changeReasons } from '../state/analytics';
import { daysToDigits, nameKey } from '../core/names';
import { partyWindowLookup } from '../state/views';
import { makeSplitter } from '../state/split';
import { saveBlob, safeFileName } from '../core/download';

type Cell = ExcelJSType.Cell;
type Sheet = ExcelJSType.Worksheet;

const C = (n: number): string => {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
const FILL = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });
const HEAD = FILL('FF1F4E78');
const BEFORE = FILL('FFD9E1F2');
const AFTER = FILL('FFE2EFDA');
const CHANGED_DAYS = FILL('FFFFF2CC');
const CHANGED_PARTY = FILL('FFF8CBAD');
const RED = FILL('FFFFC7CE');
const BORDER = { top: { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }, left: { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }, bottom: { style: 'thin' as const, color: { argb: 'FFBFBFBF' } }, right: { style: 'thin' as const, color: { argb: 'FFBFBFBF' } } };
const F = { name: 'Arial', size: 10 };
const FB = { name: 'Arial', size: 10, bold: true };
const FW = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
const FT = { name: 'Arial', size: 13, bold: true };
const FH = { name: 'Arial', size: 11, bold: true };
const FI = { name: 'Arial', size: 9, italic: true };

function header(ws: Sheet, row: number, values: string[], col = 1) {
  values.forEach((v, j) => {
    const c = ws.getCell(row, col + j);
    c.value = v;
    c.fill = HEAD;
    c.font = FW;
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = BORDER;
  });
}

const FIELD_ORDER = ['storeCode', 'storeName', 'party', 'region', 'storeFormat', 'deliveryDays', 'segment', 'lat', 'lng', 'weeklyVolume', 'weeklyWeight', 'weeklyQty', 'receivingTime', 'batchTime'] as const;

export async function exportReferenceWorkbook(ws: RotaWorkspace, rules: RuleSet | null, views: StoreView[], report: PlanReport | null, workingDays: Weekday[], i18n: RotaI18n) {
  const { t } = i18n;
  const X = t.xls;
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;
  const windows = partyWindowLookup(ws, rules);
  const W = Math.max(1, workingDays.length);
  const N = views.length;
  const L = N + 1;
  const dayShort = (d: Weekday) => t.days.short[d];
  const heads = FIELD_ORDER.map(f => ws.dataset?.headers?.[f] || t.importer.fields[f]);
  const chainWords = { up: X.change.partyUp.split('{n}')[0] };
  // real-rhythm split: per-day shares are written next to the day flags and the analysis uses them
  const split = makeSplitter(ws);
  const shareCol = (d: Weekday) => `${X.cols.share} ${dayShort(d)}`;

  // ---------------------------------------------------------------- store sheets
  const storeSheet = (name: string, after: boolean) => {
    const sh = wb.addWorksheet(name);
    const cols = [...heads, X.cols.dayCount];
    if (after) cols.push(X.cols.prevDays, X.cols.prevDayCount, X.cols.prevParty, X.cols.change);
    cols.push(X.cols.dailyV, X.cols.dailyW, X.cols.dailyQ, ...ALL_WEEKDAYS.map(dayShort));
    if (split) cols.push(...ALL_WEEKDAYS.map(shareCol));
    header(sh, 1, cols);
    const ci = new Map(cols.map((c, i) => [c, i + 1]));
    const nCol = C(ci.get(X.cols.dayCount)!);
    views.forEach((v, i) => {
      const r = i + 2;
      const days = after ? v.currentDays : v.originalDays;
      const party = after ? v.currentParty : v.party;
      const digits = daysToDigits(days);
      const values: unknown[] = [
        v.storeCode, v.storeName, party, v.region, v.storeFormat, digits ? Number(digits) : '', v.segment,
        v.lat ?? '', v.lng ?? '', v.weeklyVolume, v.weeklyWeight, v.weeklyQty, v.receivingTime || null, windows.get(nameKey(party)) ?? '',
      ];
      values.forEach((val, j) => { sh.getCell(r, j + 1).value = val as ExcelJSType.CellValue; });
      sh.getCell(r, ci.get(X.cols.dayCount)!).value = { formula: `LEN(F${r})` };
      if (after) {
        const prev = daysToDigits(v.originalDays);
        sh.getCell(r, ci.get(X.cols.prevDays)!).value = prev ? Number(prev) : '';
        sh.getCell(r, ci.get(X.cols.prevDayCount)!).value = { formula: `LEN(${C(ci.get(X.cols.prevDays)!)}${r})` };
        sh.getCell(r, ci.get(X.cols.prevParty)!).value = v.party;
        const words: string[] = [];
        const reasons = changeReasons(v, rules, workingDays);
        if (v.daysChanged) words.push(X.change.days);
        if (v.currentDays.length !== v.originalDays.length) words.push(X.change.count);
        for (const rs of reasons) {
          if (rs.code === 'chainUp') words.push(fmt(X.change.partyUp, { n: rs.steps }));
          else if (rs.code === 'swapPart') words.push(X.change.partySwap);
          else if (rs.code === 'partyOther') words.push(X.change.party);
        }
        sh.getCell(r, ci.get(X.cols.change)!).value = words.length ? words.join(', ') : '—';
        if (v.daysChanged) sh.getCell(r, 6).fill = CHANGED_DAYS;
        if (v.partyChanged) { sh.getCell(r, 3).fill = CHANGED_PARTY; sh.getCell(r, 14).fill = CHANGED_PARTY; }
      }
      sh.getCell(r, ci.get(X.cols.dailyV)!).value = { formula: `J${r}/${nCol}${r}` };
      sh.getCell(r, ci.get(X.cols.dailyW)!).value = { formula: `K${r}/${nCol}${r}` };
      sh.getCell(r, ci.get(X.cols.dailyQ)!).value = { formula: `L${r}/${nCol}${r}` };
      ALL_WEEKDAYS.forEach((d, k) => { sh.getCell(r, ci.get(dayShort(d))!).value = { formula: `IF(ISNUMBER(FIND("${k + 1}",$F${r})),1,0)` }; });
      if (split) {
        const shares = split(v.storeCode, days);
        ALL_WEEKDAYS.forEach((d, k) => { const c = sh.getCell(r, ci.get(shareCol(d))!); c.value = shares[k]; c.numFmt = '0.0%'; });
      }
    });
    for (let r = 2; r <= L; r++) {
      for (let c = 1; c <= cols.length; c++) { const cell = sh.getCell(r, c); cell.font = F; cell.border = BORDER; }
      sh.getCell(r, 10).numFmt = '0.00'; sh.getCell(r, 11).numFmt = '#,##0'; sh.getCell(r, 12).numFmt = '#,##0';
      sh.getCell(r, 8).numFmt = '0.00000'; sh.getCell(r, 9).numFmt = '0.00000';
      sh.getCell(r, ci.get(X.cols.dailyV)!).numFmt = '0.00';
      sh.getCell(r, ci.get(X.cols.dailyW)!).numFmt = '#,##0';
      sh.getCell(r, ci.get(X.cols.dailyQ)!).numFmt = '#,##0';
    }
    const widths: Record<number, number> = { 1: 9, 2: 24, 3: 15, 4: 20, 5: 12, 6: 9, 7: 10, 8: 10, 9: 10, 10: 9, 11: 10, 12: 9, 13: 14, 14: 14 };
    cols.forEach((_, k) => { sh.getColumn(k + 1).width = widths[k + 1] ?? 11; });
    for (const d of ALL_WEEKDAYS) sh.getColumn(ci.get(dayShort(d))!).width = 6;
    if (split) for (const d of ALL_WEEKDAYS) sh.getColumn(ci.get(shareCol(d))!).width = 8;
    if (after) { sh.getColumn(ci.get(X.cols.prevParty)!).width = 15; sh.getColumn(ci.get(X.cols.change)!).width = 32; }
    sh.getRow(1).height = 42;
    sh.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];
    sh.autoFilter = `A1:${C(cols.length)}${L}`;
    return ci;
  };
  const before = X.sheets.before, afterName = X.sheets.after;
  const ci0 = storeSheet(before, false);
  const ci1 = storeSheet(afterName, true);

  // ---------------------------------------------------------------- analysis
  const S = wb.addWorksheet(X.sheets.analysis);
  const SH = [`'${before}'`, `'${afterName}'`];
  const CI = [ci0, ci1];
  const rng = (s: 0 | 1, col: string) => `${SH[s]}!$${C(CI[s].get(col)!)}$2:$${C(CI[s].get(col)!)}$${L}`;
  const rngL = (s: 0 | 1, letter: string) => `${SH[s]}!$${letter}$2:$${letter}$${L}`;
  const set = (r: number, c: number, v: ExcelJSType.CellValue, font: Partial<ExcelJSType.Font> = F, numFmt?: string) => {
    const cell: Cell = S.getCell(r, c);
    cell.value = v;
    cell.font = font;
    if (numFmt) cell.numFmt = numFmt;
    return cell;
  };
  const MET: Array<{ name: string; col: string | null; weekly: string | null; fmt: string }> = [
    { name: X.metrics.m3, col: X.cols.dailyV, weekly: 'J', fmt: '0.0' },
    { name: X.metrics.kg, col: X.cols.dailyW, weekly: 'K', fmt: '#,##0' },
    { name: X.metrics.pcs, col: X.cols.dailyQ, weekly: 'L', fmt: '#,##0' },
    { name: X.metrics.stores, col: null, weekly: null, fmt: '0' },
  ];
  /** a store's amount on day d: daily × flag (even split) or weekly × share (rhythm) */
  const dayAmount = (s: 0 | 1, m: (typeof MET)[number], d: Weekday): [string, string] =>
    split && m.weekly ? [rngL(s, m.weekly), rng(s, shareCol(d))] : [rng(s, m.col!), rng(s, dayShort(d))];
  set(1, 1, X.title, FT);
  set(2, 1, fmt(split ? X.noteRhythm : X.note, { before, after: afterName }), FI);
  let row = 4;
  set(row, 1, X.s1, FH);
  row++;
  header(S, row, [X.day, ...MET.map(m => `${X.before}: ${m.name}`), ...MET.map(m => `${X.after}: ${m.name}`), X.devBefore, X.devAfter, X.devQtyAfter, X.devStoresAfter]);
  S.getRow(row).height = 42;
  row++;
  const r0 = row;
  ALL_WEEKDAYS.forEach((d, k) => {
    set(row, 1, t.days.full[d]);
    for (const s of [0, 1] as const) {
      MET.forEach((m, j) => {
        const flag = rng(s, dayShort(d));
        set(row, 2 + s * 4 + j, { formula: m.col ? `SUMPRODUCT(${dayAmount(s, m, d).join(',')})` : `SUM(${flag})` }, F, m.fmt);
      });
    }
    void k;
    row++;
  });
  const tot = row;
  set(tot, 1, X.total, FB);
  for (let j = 0; j < 8; j++) set(tot, 2 + j, { formula: `SUM(${C(2 + j)}${r0}:${C(2 + j)}${tot - 1})` }, FB, MET[j % 4].fmt);
  const workRows = ALL_WEEKDAYS.map((d, k) => ({ d, r: r0 + k })).filter(x => workingDays.includes(x.d));
  ALL_WEEKDAYS.forEach((d, k) => {
    const rr = r0 + k;
    if (!workingDays.includes(d)) { set(rr, 10, X.noShip, FI); return; }
    ([[10, 'B'], [11, 'F'], [12, 'H'], [13, 'I']] as Array<[number, string]>).forEach(([cc, sc]) => set(rr, cc, { formula: `${sc}${rr}/(${sc}$${tot}/${W})-1` }, F, '+0.0%;-0.0%;0.0%'));
  });
  const sp = tot + 1;
  set(sp, 1, X.spreadRow, FB);
  for (let j = 0; j < 8; j++) {
    const col = C(2 + j);
    const cells = workRows.map(x => `${col}${x.r}`).join(',');
    set(sp, 2 + j, { formula: `(MAX(${cells})-MIN(${cells}))/(${col}${tot}/${W})` }, FB, '0.0%');
  }
  for (let rr = r0; rr <= sp; rr++) {
    for (let cc = 1; cc <= 13; cc++) S.getCell(rr, cc).border = BORDER;
    for (let cc = 2; cc <= 5; cc++) S.getCell(rr, cc).fill = BEFORE;
    for (let cc = 6; cc <= 9; cc++) S.getCell(rr, cc).fill = AFTER;
  }
  row = sp + 2;

  // summary lines
  const dc = C(ci1.get(X.cols.change)!);
  const keysLabel = rules?.general.groupKeys ? t.rules.enums.groupKeys[rules.general.groupKeys] : '';
  const Nmin = rules?.general.groupMin ?? 0;
  const stats: Array<[string, ExcelJSType.CellValue | null, ExcelJSType.CellValue | null]> = [
    [X.stats.storeDays, { formula: `SUM(${rng(0, X.cols.dayCount)})` }, { formula: `SUM(${rng(1, X.cols.dayCount)})` }],
    [X.stats.daysChanged, null, { formula: `COUNTIF(${rngL(1, dc)},"*${X.change.days}*")` }],
    [X.stats.partyChanged, null, { formula: `COUNTIF(${rngL(1, dc)},"*${X.change.party}*")` }],
    [X.stats.chainUp, null, { formula: `COUNTIF(${rngL(1, dc)},"*${chainWords.up}*")` }],
    [X.stats.swap, null, { formula: `COUNTIF(${rngL(1, dc)},"*Part 1↔2*")` }],
  ];
  header(S, row, [X.measure, '', X.before, '', X.after]);
  row++;
  for (const [name, a, b] of stats) {
    set(row, 1, name);
    if (a) set(row, 3, a, FB);
    if (b) set(row, 5, b, FB);
    for (let cc = 1; cc <= 5; cc++) S.getCell(row, cc).border = BORDER;
    row++;
  }
  const violRow = Nmin > 1 ? row : -1;
  if (Nmin > 1) {
    set(row, 1, fmt(X.stats.groupViol, { keys: keysLabel, max: Nmin - 1 }));
    for (let cc = 1; cc <= 5; cc++) S.getCell(row, cc).border = BORDER;
    row++;
  }
  row += 2;

  // by party / region
  const partyNames = [...new Set(views.flatMap(v => [v.party, v.currentParty]))];
  const ruleOrder = (rules?.parties ?? []).map(p => nameKey(p.name));
  partyNames.sort((a, b) => ((ruleOrder.indexOf(nameKey(a)) + 1 || 999) - (ruleOrder.indexOf(nameKey(b)) + 1 || 999)) || a.localeCompare(b));
  const regions = [...new Set(views.map(v => v.region))].sort();
  const partyCol = heads[2], regionCol = heads[3];
  const dimTable = (title: string, keys: string[], keyCol: string, label: string) => {
    set(row, 1, title, FH);
    row++;
    for (const m of MET) {
      set(row, 1, m.name, FB);
      row++;
      const afterDays = workingDays;
      header(S, row, [label, ...ALL_WEEKDAYS.map(d => `${X.before} ${dayShort(d)}`), `${X.before}: ${X.total}`, ...afterDays.map(d => `${X.after} ${dayShort(d)}`), `${X.after}: ${X.total}`, X.spreadBefore, X.spreadAfter]);
      S.getRow(row).height = 30;
      row++;
      const a = row;
      for (const k of keys) {
        set(row, 1, k);
        for (const s of [0, 1] as const) {
          const dl = s === 0 ? ALL_WEEKDAYS : afterDays;
          const base = s === 0 ? 2 : 2 + 8;
          dl.forEach((d, j) => {
            const cond = `(${rng(s, keyCol)}=$A${row})`;
            const val = m.col ? `SUMPRODUCT(${cond}*${dayAmount(s, m, d).join('*')})` : `SUMPRODUCT(${cond}*${rng(s, dayShort(d))})`;
            set(row, base + j, { formula: val }, F, m.fmt);
          });
          set(row, base + dl.length, { formula: `SUM(${C(base)}${row}:${C(base + dl.length - 1)}${row})` }, FB, m.fmt);
        }
        // spread over working days
        const bCells = workingDays.map(d => `${C(2 + ALL_WEEKDAYS.indexOf(d))}${row}`).join(',');
        const aCells = afterDays.map((_, j) => `${C(10 + j)}${row}`).join(',');
        const bTot = `${C(9)}${row}`, aTot = `${C(10 + afterDays.length)}${row}`;
        set(row, 11 + afterDays.length, { formula: `IF(${bTot}=0,0,(MAX(${bCells})-MIN(${bCells}))/(${bTot}/${W}))` }, F, '0%');
        set(row, 12 + afterDays.length, { formula: `IF(${aTot}=0,0,(MAX(${aCells})-MIN(${aCells}))/(${aTot}/${W}))` }, F, '0%');
        row++;
      }
      set(row, 1, X.total, FB);
      for (let cc = 2; cc <= 10 + afterDays.length; cc++) set(row, cc, { formula: `SUM(${C(cc)}${a}:${C(cc)}${row - 1})` }, FB, m.fmt);
      for (let rr = a; rr <= row; rr++) {
        for (let cc = 1; cc <= 12 + afterDays.length; cc++) S.getCell(rr, cc).border = BORDER;
        for (let cc = 2; cc <= 9; cc++) S.getCell(rr, cc).fill = BEFORE;
        for (let cc = 10; cc <= 10 + afterDays.length; cc++) S.getCell(rr, cc).fill = AFTER;
      }
      row += 2;
    }
  };
  dimTable(X.s2, partyNames, partyCol, X.party);
  dimTable(X.s3, regions, regionCol, X.region);

  // "N or 0" matrix
  if (Nmin > 1 && rules) {
    const keys = rules.general.groupKeys ?? 'party+region+day';
    set(row, 1, fmt(X.s4, { n: Nmin, keys: keysLabel }), FH);
    row++;
    set(row, 1, fmt(X.s4note, { max: Nmin - 1 }), FI);
    row++;
    header(S, row, [X.party, X.region, ...ALL_WEEKDAYS.map(d => `${X.before} ${dayShort(d)}`), ...workingDays.map(d => `${X.after} ${dayShort(d)}`)]);
    S.getRow(row).height = 30;
    row++;
    const g0 = row;
    const pairs = new Map<string, [string, string]>();
    for (const v of views) for (const p of [v.party, v.currentParty]) {
      const pp = keys === 'region+day' ? '' : p;
      const rr = keys === 'party+day' ? '' : v.region;
      pairs.set(`${nameKey(pp)}|${rr}`, [pp, rr]);
    }
    const list = [...pairs.values()].sort((x, y) => ((ruleOrder.indexOf(nameKey(x[0])) + 1 || 999) - (ruleOrder.indexOf(nameKey(y[0])) + 1 || 999)) || x[0].localeCompare(y[0]) || x[1].localeCompare(y[1]));
    for (const [p, rg] of list) {
      set(row, 1, p || '—');
      set(row, 2, rg || '—');
      for (const s of [0, 1] as const) {
        const dl = s === 0 ? ALL_WEEKDAYS : workingDays;
        const base = s === 0 ? 3 : 3 + 7;
        dl.forEach((d, j) => {
          const conds = [p ? `${rng(s, partyCol)},$A${row}` : '', rg ? `${rng(s, regionCol)},$B${row}` : '', `${rng(s, dayShort(d))},1`].filter(Boolean).join(',');
          set(row, base + j, { formula: `COUNTIFS(${conds})` });
        });
      }
      row++;
    }
    const g1 = row - 1;
    const lastCol = 2 + 7 + workingDays.length;
    for (let rr = g0; rr <= g1; rr++) {
      for (let cc = 1; cc <= lastCol; cc++) {
        const cell = S.getCell(rr, cc);
        cell.border = BORDER;
        if (cc >= 3 && cc <= 9) cell.fill = BEFORE;
        if (cc >= 10) cell.fill = AFTER;
      }
    }
    if (g1 >= g0) {
      S.addConditionalFormatting({
        ref: `C${g0}:${C(lastCol)}${g1}`,
        rules: [{ type: 'cellIs', operator: 'between', formulae: [1, Nmin - 1], priority: 1, style: { fill: { type: 'pattern', pattern: 'solid', bgColor: RED.fgColor } } }],
      });
      if (violRow > 0) {
        set(violRow, 3, { formula: `COUNTIFS(C${g0}:I${g1},">=1",C${g0}:I${g1},"<=${Nmin - 1}")` }, FB);
        set(violRow, 5, { formula: `COUNTIFS(J${g0}:${C(lastCol)}${g1},">=1",J${g0}:${C(lastCol)}${g1},"<=${Nmin - 1}")` }, FB);
      }
    }
  }
  S.getColumn(1).width = 36;
  S.getColumn(2).width = 16;
  for (let k = 3; k <= 20; k++) S.getColumn(k).width = 11;
  S.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }];

  // ---------------------------------------------------------------- chain (Urban) moves
  const U = wb.addWorksheet(X.sheets.chain);
  U.getCell('A1').value = X.chainTitle;
  U.getCell('A1').font = FT;
  const chainParties = (rules?.parties ?? []).filter(p => p.chainOrder !== null).sort((a, b) => (a.chainOrder as number) - (b.chainOrder as number));
  U.getCell('A2').value = fmt(X.chainNote, {
    chain: chainParties.map(p => p.code || p.name).join(' → ') || '—',
    fixed: (rules?.parties ?? []).filter(p => p.fixed).map(p => p.code || p.name).join(', ') || '—',
  });
  U.getCell('A2').font = FI;
  const H = X.chainCols;
  header(U, 4, [H.code, H.name, H.region, H.format, H.receiving, H.prevParty, H.prevWindow, H.newParty, H.newWindow, H.step, H.status, H.reason]);
  U.getRow(4).height = 30;
  if (report) {
    const { model, report: rep } = report;
    const byCode = new Map(views.map(v => [v.storeCode, v]));
    const rows = rep.chain.map(c => {
      const v = byCode.get(model.codes[c.i]);
      if (!v) return null;
      const status = c.status === 'fixedParty' ? X.status.fixed : c.steps > 0 ? X.status.moved : X.status.notMoved;
      const order = c.status === 'fixedParty' ? 2 : c.steps > 0 ? 0 : 1;
      return { order, v, c, status, reason: chainReasonText(c, model.parties, model.regions, i18n, v) };
    }).filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.order - b.order || a.v.party.localeCompare(b.v.party) || a.v.region.localeCompare(b.v.region));
    let rr = 5;
    for (const x of rows) {
      const vals = [x.v.storeCode, x.v.storeName, x.v.region, x.v.storeFormat, x.v.receivingTime || X.empty247, x.v.party, windows.get(nameKey(x.v.party)) ?? '',
        x.v.currentParty, windows.get(nameKey(x.v.currentParty)) ?? '', x.c.steps, x.status, x.reason];
      vals.forEach((val, j) => { const cell = U.getCell(rr, j + 1); cell.value = val; cell.font = F; cell.border = BORDER; });
      U.getCell(rr, 11).fill = x.order === 0 ? AFTER : x.order === 1 ? RED : BEFORE;
      if (x.c.steps >= 2) U.getCell(rr, 10).fill = CHANGED_DAYS;
      rr++;
    }
    U.autoFilter = `A4:L${Math.max(4, rr - 1)}`;
  }
  [9, 24, 20, 12, 14, 15, 14, 15, 14, 7, 14, 70].forEach((w, k) => { U.getColumn(k + 1).width = w; });
  U.views = [{ state: 'frozen', xSplit: 2, ySplit: 4 }];

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeFileName(X.fileName)}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/** Text of the chain-move reason in the interface language */
export function chainReasonText(c: PlanReport['report']['chain'][number], parties: string[], regions: string[], i18n: RotaI18n, v?: StoreView): string {
  const { t, f, num, dayShort } = i18n;
  if (c.status === 'fixedParty') return f(t.rep.chainStatus.fixedParty, {}) + (v ? ` (${v.party})` : '');
  if (!c.reason) return c.steps > 0 ? f(c.steps === 1 ? t.rep.chainStatus.up1 : c.steps === 2 ? t.rep.chainStatus.up2 : t.rep.chainStatus.upMore, { n: c.steps }) : '';
  const r = c.reason;
  const target = parties[r.target] ?? '—';
  switch (r.code) {
    case 'notAllowed': return f(t.rep.chainReason.notAllowed, { target });
    case 'timeIncompatible': return f(t.rep.chainReason.timeIncompatible, { target });
    case 'wouldWorsenBalance': return f(t.rep.chainReason.wouldWorsenBalance, { target, before: `${num(r.spreadBefore, 2)}%`, after: `${num(r.spreadAfter, 2)}%` });
    case 'costlier': return f(t.rep.chainReason.costlier, { target, d: num(r.dCost, 2) });
    case 'wouldBreakGroup': return f(t.rep.chainReason.wouldBreakGroup, {
      target,
      groups: r.groups.map(g => f(t.rep.groupShort, { count: g.count, party: parties[g.party] ?? '—', region: regions[g.region] ?? '—', day: dayShort(ALL_WEEKDAYS[g.day]) })).join('; '),
    });
  }
}

/** Simple change report (for stores and transport): one sheet */
export async function exportChangesWorkbook(rows: string[][], headerRow: string[], fileName: string) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const sh = wb.addWorksheet(fileName.slice(0, 31));
  header(sh, 1, headerRow);
  rows.forEach((r, i) => r.forEach((v, j) => { const c = sh.getCell(i + 2, j + 1); c.value = v; c.font = F; c.border = BORDER; }));
  headerRow.forEach((h, j) => { sh.getColumn(j + 1).width = Math.min(48, Math.max(10, h.length + 2, ...rows.map(r => String(r[j] ?? '').length + 2))); });
  sh.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  sh.autoFilter = `A1:${C(headerRow.length)}${rows.length + 1}`;
  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeFileName(fileName)}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function dayDigitsOf(days: Weekday[]): string {
  return days.map(d => DAY_DIGIT[d]).sort().join('');
}
