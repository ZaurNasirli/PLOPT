/** Messages between the page and the optimizer workers */
import type { EngineInput } from './model';
import type { RunOptions } from './pipeline';
import type { RunReport } from './report';

export interface AnnealRequestOptions {
  iterations: number;
  T0: number;
  T1: number;
  chgMul: number;
  grpMul: number;
  seed: number;
  chunk?: number;
  debug?: boolean;
}

export type WorkerRequest =
  | { type: 'init'; id: number; input: EngineInput; opts: RunOptions }
  | { type: 'stop' }
  | { type: 'anneal'; id: number; mask: Uint8Array; party: Int32Array; opts: AnnealRequestOptions }
  | { type: 'repair'; id: number; mask: Uint8Array; party: Int32Array; chgMul: number; grpMul: number }
  | { type: 'report'; id: number; mask: Uint8Array; party: Int32Array; lastMul: { chg: number; grp: number }; origDays: number[][] };

export type WorkerResponse =
  | { type: 'ready'; id: number }
  | { type: 'progress'; id: number; it: number; iterations: number; best: number; spreadV: number; violations: number }
  | { type: 'debug'; id: number; text: string }
  | { type: 'annealDone'; id: number; mask: Uint8Array; party: Int32Array; best: number; stopped: boolean }
  | { type: 'repairDone'; id: number; mask: Uint8Array; party: Int32Array }
  | { type: 'report'; id: number; report: RunReport }
  | { type: 'error'; id: number; text: string };
