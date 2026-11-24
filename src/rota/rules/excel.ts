/**
 * Rules Excel file: import (any of ru / az / en / tr), export and the empty template.
 * A sheet is found by its code in A1, not by its name.
 */
import * as XLSX from 'xlsx';
import { ru, RotaDict } from '../i18n/ru';
import { az } from '../i18n/az';
import { en } from '../i18n/en';
import { tr } from '../i18n/tr';
import { fmt } from '../i18n';
import {
  ALGO_COLS, GENERAL_KEYS, normHeader, PARTY_COLS, SEGMENT_COLS, SHEET_CODES, SHEET_IDS, sheetHeaders, SheetId, STORE_COLS, WEIGHT_ORDER,
} from './schema';
import {
  AlgoPhase, emptyGeneral, emptyRuleSet, emptyWeights, GeneralRules, GroupKeys, MatrixCell, MatrixKind, MatrixRow, newId,
  PartyChangeMode, PartyRule, PhaseStart, PhaseType, RuleKind, RuleSet, SegmentRule, StoreException, WEIGHT_CODES, WeightCode,
} from './types';

const ALL_DICTS: RotaDict[] = [ru, az, en, tr];

// ---------------------------------------------------------------------------------------------
// Value parsing (every language accepted)

function enumLookup<T extends string>(pick: (t: RotaDict) => Record<T, string>, extra: Record<string, T> = {}): Map<string, T> {
  const m = new Map<string, T>();
  for (const d of ALL_DICTS) for (const [k, label] of Object.entries(pick(d)) as Array<[T, string]>) m.set(normHeader(label), k);
  for (const [alias, k] of Object.entries(extra)) m.set(normHeader(alias), k);
  for (const k of Object.keys(pick(ru)) as T[]) m.set(normHeader(k), k);
  return m;
}

const BOOL = (() => {
  const m = new Map<string, boolean>();
  for (const d of ALL_DICTS) {
    m.set(normHeader(d.rules.enums.bool.yes), true);
    m.set(normHeader(d.rules.enums.bool.no), false);
  }
  for (const s of ['true', 'yes', 'y', '1', '+', 'истина']) m.set(normHeader(s), true);
  for (const s of ['false', 'no', 'n', '0', '-', 'ложь']) m.set(normHeader(s), false);
  return m;
})();

const PARTY_CHANGE = enumLookup<PartyChangeMode>(t => t.rules.enums.partyChange);
const RULE_KIND = enumLookup<MatrixKind>(t => t.rules.enums.kind);
const PHASE_TYPE = enumLookup<PhaseType>(t => t.rules.enums.phaseType, { annealing: 'anneal', 'simulated annealing': 'anneal' });
const PHASE_START = enumLookup<PhaseStart>(t => t.rules.enums.start);
const GROUP_KEYS = enumLookup<GroupKeys>(t => t.rules.enums.groupKeys);
const MATRIX_CELL = enumLookup<Exclude<MatrixCell, null>>(t => t.rules.enums.matrixCell, { allow: 'allow', deny: 'deny', '+': 'allow', '-': 'deny' });
const GENERAL_LABELS = (() => {
  const m = new Map<string, keyof GeneralRules>();
  for (const d of ALL_DICTS) for (const k of GENERAL_KEYS) m.set(normHeader(d.rules.general.labels[k]), k);
  for (const k of GENERAL_KEYS) m.set(normHeader(k), k);
  return m;
})();

const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';
const text = (v: unknown) => (isBlank(v) ? '' : String(v).trim());

function num(v: unknown): number | null | 'bad' {
  if (isBlank(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 'bad';
  const n = Number(String(v).trim().replace(/\s/g, '').replace(',', '.').replace('−', '-'));
  return Number.isFinite(n) ? n : 'bad';
}

/** Excel stores "08:00" as a day fraction; turn it back into text */
function timeText(v: unknown): string {
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const m = Math.round(v * 1440);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
  return text(v);
}

function list(v: unknown): string[] {
  return text(v).split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
}

function dayDigits(v: unknown): number[] {
  const s = typeof v === 'number' ? String(Math.round(v)) : text(v);
  return [...new Set(s.replace(/[^1-7]/g, '').split('').map(Number))].sort();
}

// ---------------------------------------------------------------------------------------------
// Import

export interface RulesParseResult {
  ruleSet: RuleSet;
  found: SheetId[];
  problems: string[];
}

interface SheetRows {
  id: SheetId;
  name: string;
  rows: unknown[][];
}

function readSheets(wb: XLSX.WorkBook): SheetRows[] {
  const out: SheetRows[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const a1 = text(ws?.A1?.v).toUpperCase();
    const id = SHEET_IDS.find(s => SHEET_CODES[s] === a1);
    if (!id || out.some(o => o.id === id)) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true, blankrows: true });
    out.push({ id, name, rows });
  }
  return out;
}

/** Header row: row 3 normally; otherwise the first row in rows 2-6 that has known headers */
function locateHeader(rows: unknown[][], known: Set<string>): number {
  const score = (r: unknown[] | undefined) => (r ?? []).filter(c => known.has(normHeader(c))).length;
  if (score(rows[2]) >= 2) return 2;
  for (let i = 1; i < Math.min(rows.length, 6); i++) if (score(rows[i]) >= 2) return i;
  return 2;
}

/** column key -> index, by header text in any language, falling back to the template position */
function mapColumns<K extends string>(header: unknown[], keys: readonly K[], headerOf: (t: RotaDict, k: K) => string): Record<K, number> {
  const byName = new Map<string, K>();
  for (const d of ALL_DICTS) for (const k of keys) byName.set(normHeader(headerOf(d, k)), k);
  const out = {} as Record<K, number>;
  header.forEach((h, i) => {
    const k = byName.get(normHeader(h));
    if (k !== undefined && out[k] === undefined) out[k] = i;
  });
  keys.forEach((k, i) => { if (out[k] === undefined && !Object.values(out).includes(i)) out[k] = i; });
  return out;
}

export function parseRulesWorkbook(data: ArrayBuffer, fileName: string, t: RotaDict): RulesParseResult {
  const wb = XLSX.read(data, { type: 'array' });
  const sheets = readSheets(wb);
  const problems: string[] = [];
  const name = fmt(t.rules.import.newName, { file: fileName.replace(/\.[^.]+$/, '') });
  const rs = emptyRuleSet(name);

  for (const sh of sheets) {
    const sheetLabel = sh.name;
    const unknown = (row: number, column: string, value: unknown) =>
      problems.push(fmt(t.rules.import.unknownValue, { sheet: sheetLabel, row, column, value: text(value) }));
    const headerSet = new Set<string>();
    for (const d of ALL_DICTS) for (const h of sheetHeaders(d, sh.id)) headerSet.add(normHeader(h));
    const hIdx = locateHeader(sh.rows, headerSet);
    const header = sh.rows[hIdx] ?? [];
    const dataRows = sh.rows.slice(hIdx + 1).map((r, k) => ({ r, row: hIdx + 2 + k })).filter(x => x.r.some(c => !isBlank(c)));

    const numCell = (v: unknown, row: number, column: string): number | null => {
      const n = num(v);
      if (n === 'bad') { unknown(row, column, v); return null; }
      return n;
    };
    const boolCell = (v: unknown, row: number, column: string): boolean | null => {
      if (isBlank(v)) return null;
      const b = BOOL.get(normHeader(v));
      if (b === undefined) { unknown(row, column, v); return null; }
      return b;
    };
    const enumCell = <T,>(m: Map<string, T>, v: unknown, row: number, column: string): T | null => {
      if (isBlank(v)) return null;
      const e = m.get(normHeader(v));
      if (e === undefined) { unknown(row, column, v); return null; }
      return e;
    };

    if (sh.id === 'parties') {
      const c = mapColumns(header, PARTY_COLS, (d, k) => d.rules.cols.parties[k]);
      const H = t.rules.cols.parties;
      for (const { r, row } of dataRows) {
        const code = text(r[c.code]);
        const pname = text(r[c.name]);
        if (!code && !pname) continue;
        const p: PartyRule = {
          id: newId('party'), code, name: pname, window: timeText(r[c.window]),
          chainOrder: numCell(r[c.chainOrder], row, H.chainOrder),
          fixed: boolCell(r[c.fixed], row, H.fixed) ?? false,
          truckM3: numCell(r[c.truckM3], row, H.truckM3),
          truckKg: numCell(r[c.truckKg], row, H.truckKg),
          trucksPerDay: numCell(r[c.trucksPerDay], row, H.trucksPerDay),
        };
        rs.parties.push(p);
      }
    } else if (sh.id === 'segments') {
      const c = mapColumns(header, SEGMENT_COLS, (d, k) => d.rules.cols.segments[k]);
      const H = t.rules.cols.segments;
      for (const { r, row } of dataRows) {
        const value = text(r[c.value]);
        if (!value) { problems.push(fmt(t.rules.import.skippedRow, { sheet: sheetLabel, row, reason: t.rules.import.noKey })); continue; }
        const kind = enumCell(RULE_KIND, r[c.kind], row, H.kind);
        const s: SegmentRule = {
          id: newId('seg'),
          kind: (kind === 'format' ? 'format' : 'segment') as RuleKind,
          value,
          partyChange: enumCell(PARTY_CHANGE, r[c.partyChange], row, H.partyChange),
          maxStepsUp: numCell(r[c.maxStepsUp], row, H.maxStepsUp),
          bonus1: numCell(r[c.bonus1], row, H.bonus1),
          bonus2: numCell(r[c.bonus2], row, H.bonus2),
          changePenalty: numCell(r[c.changePenalty], row, H.changePenalty),
          changeDayCount: boolCell(r[c.changeDayCount], row, H.changeDayCount),
          maxPlusDays: numCell(r[c.maxPlusDays], row, H.maxPlusDays),
          maxMinusDays: numCell(r[c.maxMinusDays], row, H.maxMinusDays),
          minDays: numCell(r[c.minDays], row, H.minDays),
          maxDays: numCell(r[c.maxDays], row, H.maxDays),
          minDaysOneDay: numCell(r[c.minDaysOneDay], row, H.minDaysOneDay),
          sundayMin: numCell(r[c.sundayMin], row, H.sundayMin),
          sundayMax: numCell(r[c.sundayMax], row, H.sundayMax),
        };
        rs.segments.push(s);
      }
    } else if (sh.id === 'general') {
      const g: GeneralRules = emptyGeneral();
      for (const { r, row } of dataRows) {
        const key = GENERAL_LABELS.get(normHeader(r[0]));
        if (!key) { problems.push(fmt(t.rules.import.unknownParam, { sheet: sheetLabel, row, value: text(r[0]) })); continue; }
        const v = r[1];
        const label = t.rules.general.labels[key];
        switch (key) {
          case 'workingDays': g.workingDays = isBlank(v) ? null : dayDigits(v).join(''); break;
          case 'groupMin': g.groupMin = numCell(v, row, label); break;
          case 'fastMultiplier': g.fastMultiplier = numCell(v, row, label); break;
          case 'groupKeys': g.groupKeys = enumCell(GROUP_KEYS, v, row, label); break;
          case 'priorityNote': g.priorityNote = text(v) || null; break;
          default: g[key] = boolCell(v, row, label);
        }
      }
      rs.general = g;
    } else if (sh.id === 'weights') {
      const w = emptyWeights();
      const c = mapColumns(header, ['code', 'param', 'value', 'note'] as const, (d, k) => d.rules.cols.weights[k]);
      for (const { r, row } of dataRows) {
        const code = WEIGHT_CODES.find(x => x.toLowerCase() === text(r[c.code]).toLowerCase());
        if (!code) { problems.push(fmt(t.rules.import.unknownParam, { sheet: sheetLabel, row, value: text(r[c.code]) })); continue; }
        w[code] = numCell(r[c.value], row, code);
      }
      rs.weights = w;
    } else if (sh.id === 'algo') {
      const c = mapColumns(header, ALGO_COLS, (d, k) => d.rules.cols.algo[k]);
      const H = t.rules.cols.algo;
      const phases: Array<{ order: number; p: AlgoPhase }> = [];
      for (const { r, row } of dataRows) {
        const order = num(r[c.phase]);
        const p: AlgoPhase = {
          id: newId('phase'),
          type: enumCell(PHASE_TYPE, r[c.type], row, H.type),
          iterations: numCell(r[c.iterations], row, H.iterations),
          T0: numCell(r[c.T0], row, H.T0),
          T1: numCell(r[c.T1], row, H.T1),
          chgMul: numCell(r[c.chgMul], row, H.chgMul),
          grpMul: numCell(r[c.grpMul], row, H.grpMul),
          start: enumCell(PHASE_START, r[c.start], row, H.start),
          seeds: numCell(r[c.seeds], row, H.seeds),
        };
        phases.push({ order: typeof order === 'number' ? order : phases.length + 1000, p });
      }
      rs.phases = phases.sort((a, b) => a.order - b.order).map(x => x.p);
    } else if (sh.id === 'stores') {
      const c = mapColumns(header, STORE_COLS, (d, k) => d.rules.cols.stores[k]);
      const H = t.rules.cols.stores;
      for (const { r, row } of dataRows) {
        const code = text(r[c.storeCode]);
        if (!code) continue;
        if (/^\(.*\)/.test(code)) { problems.push(fmt(t.rules.import.skippedRow, { sheet: sheetLabel, row, reason: t.rules.import.exampleRow })); continue; }
        const e: StoreException = {
          id: newId('store'), storeCode: code,
          lockDays: boolCell(r[c.lockDays], row, H.lockDays) ?? false,
          lockParty: boolCell(r[c.lockParty], row, H.lockParty) ?? false,
          allowedParties: list(r[c.allowedParties]),
          forbiddenParties: list(r[c.forbiddenParties]),
          forbiddenDays: dayDigits(r[c.forbiddenDays]),
          minDays: numCell(r[c.minDays], row, H.minDays),
          maxDays: numCell(r[c.maxDays], row, H.maxDays),
          comment: text(r[c.comment]),
        };
        rs.stores.push(e);
      }
    } else if (sh.id === 'matrix') {
      const partyCols = header.map((h, i) => ({ code: text(h), i })).filter(x => x.i >= 2 && x.code);
      for (const { r, row } of dataRows) {
        const value = text(r[1]);
        const kind = enumCell(RULE_KIND, r[0], row, t.rules.cols.matrix.kind);
        if (!value && !kind) continue;
        const cells: Record<string, MatrixCell> = {};
        for (const pc of partyCols) {
          const v = r[pc.i];
          cells[pc.code] = isBlank(v) ? null : enumCell(MATRIX_CELL, v, row, pc.code);
        }
        const m: MatrixRow = { id: newId('mx'), kind: kind ?? 'segment', value, cells };
        rs.matrix.push(m);
      }
    }
  }

  return { ruleSet: rs, found: sheets.map(s => s.id), problems };
}

// ---------------------------------------------------------------------------------------------
// Export / template

const SHEET_NAME_BAD = /[[\]:*?/\\]/g;

function cellBool(t: RotaDict, b: boolean | null): string {
  return b === null ? '' : b ? t.rules.enums.bool.yes : t.rules.enums.bool.no;
}

export function buildRulesWorkbook(rs: RuleSet | null, t: RotaDict): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const E = t.rules.enums;
  const v = (x: number | null | undefined) => (x === null || x === undefined ? '' : x);
  for (const id of SHEET_IDS) {
    const headers = sheetHeaders(t, id);
    const rows: unknown[][] = [];
    if (id === 'parties') {
      for (const p of rs?.parties ?? []) rows.push([p.code, p.name, p.window, v(p.chainOrder), cellBool(t, p.fixed), v(p.truckM3), v(p.truckKg), v(p.trucksPerDay)]);
    } else if (id === 'segments') {
      for (const s of rs?.segments ?? []) rows.push([
        E.kind[s.kind], s.value, s.partyChange ? E.partyChange[s.partyChange] : '', v(s.maxStepsUp), v(s.bonus1), v(s.bonus2), v(s.changePenalty),
        cellBool(t, s.changeDayCount), v(s.maxPlusDays), v(s.maxMinusDays), v(s.minDays), v(s.maxDays), v(s.minDaysOneDay), v(s.sundayMin), v(s.sundayMax),
      ]);
    } else if (id === 'general') {
      const g = rs?.general ?? emptyGeneral();
      for (const k of GENERAL_KEYS) {
        let value: unknown = '';
        if (rs) {
          const x = g[k];
          if (k === 'groupKeys') value = x ? E.groupKeys[x as GroupKeys] : '';
          else if (typeof x === 'boolean') value = cellBool(t, x);
          else value = x ?? '';
        }
        rows.push([t.rules.general.labels[k], value, t.rules.general.tips[k]]);
      }
    } else if (id === 'weights') {
      const w = rs?.weights ?? emptyWeights();
      for (const code of WEIGHT_ORDER) rows.push([code, t.rules.weights.labels[code], rs ? v(w[code as WeightCode]) : '', t.rules.weights.tips[code]]);
    } else if (id === 'algo') {
      (rs?.phases ?? []).forEach((p, i) => rows.push([
        i + 1, p.type ? E.phaseType[p.type] : '', v(p.iterations), v(p.T0), v(p.T1), v(p.chgMul), v(p.grpMul), p.start ? E.start[p.start] : '', v(p.seeds),
      ]));
    } else if (id === 'stores') {
      for (const s of rs?.stores ?? []) rows.push([
        s.storeCode, cellBool(t, s.lockDays), cellBool(t, s.lockParty), s.allowedParties.join(', '), s.forbiddenParties.join(', '),
        s.forbiddenDays.join(''), v(s.minDays), v(s.maxDays), s.comment,
      ]);
    } else if (id === 'matrix') {
      const codes = (rs?.parties ?? []).map(p => p.code).filter(Boolean);
      for (const m of rs?.matrix ?? []) for (const k of Object.keys(m.cells)) if (!codes.includes(k)) codes.push(k);
      headers.push(...codes);
      for (const m of rs?.matrix ?? []) rows.push([E.kind[m.kind], m.value, ...codes.map(c => (m.cells[c] ? E.matrixCell[m.cells[c] as 'allow' | 'deny'] : ''))]);
    }
    const aoa: unknown[][] = [[SHEET_CODES[id], t.rules.sheetNotes[id]], [], headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = headers.map((h, i) => ({ wch: Math.min(44, Math.max(10, String(h).length + 2, i === 0 ? 18 : 0)) }));
    XLSX.utils.book_append_sheet(wb, ws, t.rules.tabs[id].replace(SHEET_NAME_BAD, ' ').slice(0, 31));
  }
  return wb;
}

export { saveWorkbook as downloadWorkbook } from '../core/download';
