/**
 * Runs the phases of the "Algorithm" sheet in order (reference README pipeline):
 * anneal phases (several seeds in parallel → the best one) and repair phases.
 * The runner functions decide where a phase runs (this thread or Web Workers).
 */
import type { EngineModel, Weights } from './model';
import type { AlgoPhase, RuleSet } from '../rules/types';
import { anneal, AnnealOptions, AnnealResult, currentStart, originalStart, PlanState } from './anneal';
import { repairGroups } from './repair';
import { deriveSeed, mulberry32 } from './rng';

export type RunMode = 'fast' | 'exact';

export interface RunOptions {
  mode: RunMode;
  /** "balance ↔ fewest changes" slider: multiplies Wchg (1 = as in the rules) */
  chgFactor: number;
  /** "N or 0" strictness: multiplies Wgrp (1 = as in the rules) */
  grpFactor: number;
  seed: number;
  debug?: boolean;
}

export interface PhaseProgress {
  phase: number;
  phases: number;
  type: 'anneal' | 'repair';
  /** 0..1 of the whole run */
  fraction: number;
  best?: number;
  spreadV?: number;
  violations?: number;
}

export interface Runners {
  anneal: (phaseIndex: number, seedIndex: number, start: PlanState, opts: AnnealOptions) => Promise<AnnealResult>;
  repair: (start: PlanState, chgMul: number, grpMul: number) => Promise<PlanState>;
}

export interface PipelineResult extends PlanState {
  stopped: boolean;
  phasesDone: number;
  seed: number;
}

export function baseWeights(rules: RuleSet, o: RunOptions): Weights {
  const w = rules.weights;
  const n = (x: number | null) => x ?? 0;
  return {
    Wv: n(w.Wv), Wp: n(w.Wp), Wc: n(w.Wc), Ww: n(w.Ww), Wparty: n(w.Wparty), Wreg: n(w.Wreg),
    Wgrp: n(w.Wgrp) * o.grpFactor, Wspc: n(w.Wspc), Wchg: n(w.Wchg) * o.chgFactor,
    Winc: n(w.Winc), Wdec: n(w.Wdec), Wbud: n(w.Wbud),
  };
}

export function phaseIterations(p: AlgoPhase, rules: RuleSet, mode: RunMode): number {
  const it = p.iterations ?? 0;
  return Math.max(0, Math.round(mode === 'fast' ? it * (rules.general.fastMultiplier ?? 1) : it));
}

/** Relative amount of work per phase, for the progress bar (a repair counts as a small anneal) */
export function phaseWork(phases: AlgoPhase[], rules: RuleSet, mode: RunMode): number[] {
  const it = phases.map(p => (p.type === 'anneal' ? phaseIterations(p, rules, mode) : 0));
  const avg = Math.max(1, it.reduce((a, b) => a + b, 0) / Math.max(1, it.filter(Boolean).length));
  return phases.map((p, k) => (p.type === 'anneal' ? it[k] : avg * 0.05));
}

export async function runPipeline(
  m: EngineModel,
  rules: RuleSet,
  o: RunOptions,
  runners: Runners,
  hooks: { onProgress?: (p: PhaseProgress) => void; shouldStop?: () => boolean } = {}
): Promise<PipelineResult> {
  const phases = rules.phases.filter(p => p.type === 'anneal' || p.type === 'repair');
  const work = phaseWork(phases, rules, o.mode);
  const totalWork = Math.max(1e-9, work.reduce((a, b) => a + b, 0));
  let doneWork = 0;
  const startRnd = mulberry32(o.seed);
  let state: PlanState | null = null;
  let stopped = false;
  let phasesDone = 0;

  for (let k = 0; k < phases.length; k++) {
    if (hooks.shouldStop?.()) { stopped = true; break; }
    const p = phases[k];
    const chgMul = p.chgMul ?? 1;
    const grpMul = p.grpMul ?? 1;
    const start: PlanState = p.start === 'original' || (!state && p.type === 'anneal' && p.start !== 'best')
      ? originalStart(m, startRnd)
      : state ?? currentStart(m, startRnd);

    if (p.type === 'repair') {
      hooks.onProgress?.({ phase: k + 1, phases: phases.length, type: 'repair', fraction: doneWork / totalWork });
      state = await runners.repair(start, chgMul, grpMul);
    } else {
      const seeds = Math.max(1, Math.floor(p.seeds ?? 1));
      const iterations = phaseIterations(p, rules, o.mode);
      const progress = new Array(seeds).fill(0);
      const results = await Promise.all(
        Array.from({ length: seeds }, (_, s) => runners.anneal(k, s, start, {
          iterations,
          T0: p.T0 ?? 1,
          T1: p.T1 ?? 0.001,
          chgMul,
          grpMul,
          seed: deriveSeed(o.seed, k, s),
          debug: o.debug,
          shouldStop: hooks.shouldStop,
          onProgress: pr => {
            progress[s] = pr.it;
            const avg = progress.reduce((a, b) => a + b, 0) / seeds;
            hooks.onProgress?.({
              phase: k + 1, phases: phases.length, type: 'anneal',
              fraction: (doneWork + (iterations ? (avg / iterations) * work[k] : 0)) / totalWork,
              best: pr.best, spreadV: pr.spreadV, violations: pr.violations,
            });
          },
        }))
      );
      let bestIdx = 0;
      results.forEach((r, s) => { if (r.best < results[bestIdx].best - 1e-12) bestIdx = s; });
      state = { mask: results[bestIdx].mask, party: results[bestIdx].party };
      if (results.some(r => r.stopped)) stopped = true;
    }
    doneWork += work[k];
    phasesDone++;
    if (stopped) break;
  }

  if (!state) state = currentStart(m, startRnd);
  hooks.onProgress?.({ phase: phasesDone, phases: phases.length, type: 'anneal', fraction: stopped ? doneWork / totalWork : 1 });
  return { ...state, stopped, phasesDone, seed: o.seed };
}

/** Runners that do everything in the current thread (Node tests, fallback without Workers) */
export function localRunners(m: EngineModel, base: Weights, yieldFn?: () => Promise<void>): Runners {
  return {
    anneal: (_k, _s, start, opts) => anneal(m, base, start, { ...opts, yieldFn: opts.yieldFn ?? yieldFn }),
    repair: async (start, chgMul, grpMul) => repairGroups(m, base, start, chgMul, grpMul),
  };
}
