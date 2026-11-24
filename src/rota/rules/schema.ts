/**
 * Layout of the rules Excel file (also used by the editor): one sheet per section, the sheet code
 * in A1, a note in A2, headers in row 3, data from row 4. Headers are written in the interface
 * language and read in any of ru / az / en / tr.
 */
import type { RotaDict } from '../i18n/ru';
import type { GeneralRules, WeightCode } from './types';

export type SheetId = 'parties' | 'segments' | 'general' | 'weights' | 'algo' | 'stores' | 'matrix';

export const SHEET_IDS: SheetId[] = ['parties', 'segments', 'general', 'weights', 'algo', 'stores', 'matrix'];

export const SHEET_CODES: Record<SheetId, string> = {
  parties: '#RULES:PARTIES',
  segments: '#RULES:SEGMENTS',
  general: '#RULES:GENERAL',
  weights: '#RULES:WEIGHTS',
  algo: '#RULES:ALGO',
  stores: '#RULES:STORES',
  matrix: '#RULES:MATRIX',
};

export const PARTY_COLS = ['code', 'name', 'window', 'chainOrder', 'fixed', 'truckM3', 'truckKg', 'trucksPerDay'] as const;
export const SEGMENT_COLS = [
  'kind', 'value', 'partyChange', 'maxStepsUp', 'bonus1', 'bonus2', 'changePenalty', 'changeDayCount',
  'maxPlusDays', 'maxMinusDays', 'minDays', 'maxDays', 'minDaysOneDay', 'sundayMin', 'sundayMax',
] as const;
export const ALGO_COLS = ['phase', 'type', 'iterations', 'T0', 'T1', 'chgMul', 'grpMul', 'start', 'seeds'] as const;
export const STORE_COLS = ['storeCode', 'lockDays', 'lockParty', 'allowedParties', 'forbiddenParties', 'forbiddenDays', 'minDays', 'maxDays', 'comment'] as const;
export const GENERAL_KEYS: Array<keyof GeneralRules> = [
  'workingDays', 'groupMin', 'groupKeys', 'emptyIs247', 's724Is247', 'touchIsOverlap', 'useWeight', 'budgetCap', 'priorityNote', 'fastMultiplier',
];
export const WEIGHT_ORDER: WeightCode[] = ['Wv', 'Wp', 'Wc', 'Ww', 'Wparty', 'Wreg', 'Wgrp', 'Wspc', 'Wchg', 'Winc', 'Wdec', 'Wbud'];

/** Header comparison: case, spaces, punctuation and anything in brackets are ignored */
export function normHeader(h: unknown): string {
  return String(h ?? '')
    .toLocaleLowerCase('en-US')
    .normalize('NFD').replace(/\u0307/g, '').normalize('NFC')
    .replace(/\(.*?\)/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/[^\p{L}\p{N}+-]+/gu, '');
}

/** Header texts of a sheet in one language, in column order */
export function sheetHeaders(t: RotaDict, id: SheetId): string[] {
  const c = t.rules.cols;
  switch (id) {
    case 'parties': return PARTY_COLS.map(k => c.parties[k]);
    case 'segments': return SEGMENT_COLS.map(k => c.segments[k]);
    case 'general': return [c.general.param, c.general.value, c.general.note];
    case 'weights': return [c.weights.code, c.weights.param, c.weights.value, c.weights.note];
    case 'algo': return ALGO_COLS.map(k => c.algo[k]);
    case 'stores': return STORE_COLS.map(k => c.stores[k]);
    case 'matrix': return [c.matrix.kind, c.matrix.value];
  }
}
