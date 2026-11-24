/**
 * A rule set: everything the optimizer and the checks need. Nothing has a default value —
 * every field is entered by the user (by hand or from the rules Excel file); null = not filled.
 */

export type PartyChangeMode = 'none' | 'chain_up' | 'swap_part' | 'any';
export type GroupKeys = 'party+region+day' | 'party+day' | 'region+day';
export type PhaseType = 'anneal' | 'repair';
export type PhaseStart = 'original' | 'best';
export type MatrixCell = 'allow' | 'deny' | null;
export type RuleKind = 'segment' | 'format';
export type MatrixKind = 'segment' | 'format' | 'region';

export interface PartyRule {
  id: string;
  code: string;
  /** as in the store file (compared case-insensitively, extra spaces ignored) */
  name: string;
  /** "HH:MM - HH:MM" */
  window: string;
  /** position in the "one party up" chain, null = not in the chain */
  chainOrder: number | null;
  /** stores are never moved out of this party (moving in is allowed) */
  fixed: boolean;
  truckM3: number | null;
  truckKg: number | null;
  trucksPerDay: number | null;
}

export interface SegmentRule {
  id: string;
  kind: RuleKind;
  value: string;
  partyChange: PartyChangeMode | null;
  maxStepsUp: number | null;
  bonus1: number | null;
  bonus2: number | null;
  changePenalty: number | null;
  changeDayCount: boolean | null;
  maxPlusDays: number | null;
  maxMinusDays: number | null;
  minDays: number | null;
  maxDays: number | null;
  minDaysOneDay: number | null;
  sundayMin: number | null;
  sundayMax: number | null;
}

export interface GeneralRules {
  /** digits 1..7, e.g. "123456" */
  workingDays: string | null;
  groupMin: number | null;
  groupKeys: GroupKeys | null;
  emptyIs247: boolean | null;
  s724Is247: boolean | null;
  touchIsOverlap: boolean | null;
  useWeight: boolean | null;
  budgetCap: boolean | null;
  /** free text, only shown (priorities are set through the weights) */
  priorityNote: string | null;
  fastMultiplier: number | null;
}

export type WeightCode = 'Wv' | 'Wp' | 'Wc' | 'Ww' | 'Wparty' | 'Wreg' | 'Wgrp' | 'Wspc' | 'Wchg' | 'Winc' | 'Wdec' | 'Wbud';
export const WEIGHT_CODES: WeightCode[] = ['Wv', 'Wp', 'Wc', 'Ww', 'Wparty', 'Wreg', 'Wgrp', 'Wspc', 'Wchg', 'Winc', 'Wdec', 'Wbud'];
export type Weights = Record<WeightCode, number | null>;

export interface AlgoPhase {
  id: string;
  type: PhaseType | null;
  iterations: number | null;
  T0: number | null;
  T1: number | null;
  chgMul: number | null;
  grpMul: number | null;
  start: PhaseStart | null;
  seeds: number | null;
}

export interface StoreException {
  id: string;
  storeCode: string;
  lockDays: boolean;
  lockParty: boolean;
  /** party codes */
  allowedParties: string[];
  forbiddenParties: string[];
  /** day digits 1..7 */
  forbiddenDays: number[];
  minDays: number | null;
  maxDays: number | null;
  comment: string;
}

export interface MatrixRow {
  id: string;
  kind: MatrixKind;
  value: string;
  /** party code -> cell */
  cells: Record<string, MatrixCell>;
}

export interface RuleSet {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  parties: PartyRule[];
  segments: SegmentRule[];
  general: GeneralRules;
  weights: Weights;
  phases: AlgoPhase[];
  stores: StoreException[];
  matrix: MatrixRow[];
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyGeneral(): GeneralRules {
  return {
    workingDays: null, groupMin: null, groupKeys: null, emptyIs247: null, s724Is247: null,
    touchIsOverlap: null, useWeight: null, budgetCap: null, priorityNote: null, fastMultiplier: null,
  };
}

export function emptyWeights(): Weights {
  return Object.fromEntries(WEIGHT_CODES.map(c => [c, null])) as Weights;
}

export function emptyRuleSet(name: string): RuleSet {
  const now = new Date().toISOString();
  return {
    id: newId('rules'), name, createdAt: now, updatedAt: now,
    parties: [], segments: [], general: emptyGeneral(), weights: emptyWeights(), phases: [], stores: [], matrix: [],
  };
}
