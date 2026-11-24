/**
 * Page side of the optimizer: a pool of Web Workers runs the phases (seeds of a phase in
 * parallel); progress is reported, "stop" returns the best plan found so far.
 * Without Worker support everything runs in this thread, in small chunks.
 */
import { compileModel, EngineInput, EngineModel, maskToDays } from './model';
import { AnnealOptions, AnnealResult, PlanState } from './anneal';
import { baseWeights, localRunners, PhaseProgress, RunOptions, runPipeline, Runners } from './pipeline';
import { buildReport, RunReport } from './report';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { DAY_DIGIT, PlanSnapshot } from '../types';
import { nameKey } from '../core/names';

export interface RunOutcome {
  plan: PlanSnapshot;
  report: RunReport;
  meta: { codes: string[]; parties: string[]; partyCodes: string[]; regions: string[]; segments: string[]; wd: number[] };
  seed: number;
  stopped: boolean;
  seconds: number;
  debugNotes: string[];
}

export interface RunHandle {
  promise: Promise<RunOutcome>;
  stop: () => void;
}

class WorkerSlot {
  private w: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (m: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (m: Extract<WorkerResponse, { type: 'progress' }>) => void }>();
  onDebug?: (text: string) => void;

  constructor() {
    this.w = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    this.w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'debug') { this.onDebug?.(m.text); return; }
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') { p.onProgress?.(m); return; }
      this.pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.text));
      else p.resolve(m);
    };
    this.w.onerror = e => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'worker error'));
      this.pending.clear();
    };
  }

  request(msg: Record<string, unknown> & { type: string }, transfer: Transferable[] = [], onProgress?: (m: Extract<WorkerResponse, { type: 'progress' }>) => void): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.w.postMessage({ ...msg, id } as WorkerRequest, transfer);
    });
  }

  stop() { this.w.postMessage({ type: 'stop' } as WorkerRequest); }
  terminate() { this.w.terminate(); }
}

const copyState = (s: PlanState) => ({ mask: Uint8Array.from(s.mask), party: Int32Array.from(s.party) });

/** Turns engine states into a plan (keeps the store's own spelling of an unchanged party) */
export function toPlan(m: EngineModel, input: EngineInput, s: PlanState): PlanSnapshot {
  const plan: PlanSnapshot = { days: {}, party: {} };
  input.stores.forEach((st, i) => {
    const code = st.storeCode;
    plan.days[code] = maskToDays(s.mask[i]);
    const name = m.parties[s.party[i]];
    const cur = input.current.party[code] ?? st.party;
    const orig = input.original.party[code] ?? st.party;
    plan.party[code] = nameKey(name) === nameKey(cur) ? cur : nameKey(name) === nameKey(orig) ? orig : name;
  });
  return plan;
}

export function startOptimization(input: EngineInput, opts: RunOptions, onProgress: (p: PhaseProgress) => void): RunHandle {
  let stopped = false;
  const slots: WorkerSlot[] = [];
  const debugNotes: string[] = [];
  const t0 = performance.now();

  const run = async (): Promise<RunOutcome> => {
    const model = compileModel(input);
    const base = baseWeights(input.rules, opts);
    const phases = input.rules.phases;
    const maxSeeds = Math.max(1, ...phases.filter(p => p.type === 'anneal').map(p => Math.floor(p.seeds ?? 1)));
    const origDays = input.stores.map(s => (input.original.days[s.storeCode] ?? s.originalDays).map(d => DAY_DIGIT[d] - 1));
    const lastAnneal = [...phases].reverse().find(p => p.type === 'anneal');
    const lastMul = { chg: lastAnneal?.chgMul ?? 1, grp: lastAnneal?.grpMul ?? 1 };

    let runners: Runners;
    let report: (s: PlanState) => Promise<RunReport>;
    const canUseWorkers = typeof Worker !== 'undefined';
    if (canUseWorkers) {
      const poolSize = Math.max(1, Math.min(maxSeeds, (navigator.hardwareConcurrency || 2)));
      for (let k = 0; k < poolSize; k++) {
        const slot = new WorkerSlot();
        slot.onDebug = text => debugNotes.push(text);
        slots.push(slot);
      }
      await Promise.all(slots.map(s => s.request({ type: 'init', input, opts })));
      runners = {
        anneal: async (_k, s, start, o: AnnealOptions): Promise<AnnealResult> => {
          const st = copyState(start);
          const { onProgress: op, shouldStop: _ss, yieldFn: _yf, onDebug: _od, ...plain } = o;
          const res = await slots[s % slots.length].request(
            { type: 'anneal', mask: st.mask, party: st.party, opts: plain },
            [st.mask.buffer, st.party.buffer],
            m => op?.({ it: m.it, iterations: m.iterations, best: m.best, spreadV: m.spreadV, violations: m.violations })
          );
          if (res.type !== 'annealDone') throw new Error('unexpected reply');
          return { mask: res.mask, party: res.party, best: res.best, iterationsDone: 0, stopped: res.stopped };
        },
        repair: async (start, chgMul, grpMul) => {
          const st = copyState(start);
          const res = await slots[0].request({ type: 'repair', mask: st.mask, party: st.party, chgMul, grpMul }, [st.mask.buffer, st.party.buffer]);
          if (res.type !== 'repairDone') throw new Error('unexpected reply');
          return { mask: res.mask, party: res.party };
        },
      };
      report = async s => {
        const st = copyState(s);
        const res = await slots[0].request({ type: 'report', mask: st.mask, party: st.party, lastMul, origDays }, [st.mask.buffer, st.party.buffer]);
        if (res.type !== 'report') throw new Error('unexpected reply');
        return res.report;
      };
    } else {
      runners = localRunners(model, base, () => new Promise(r => setTimeout(r, 0)));
      report = async s => buildReport(model, base, lastMul, s, origDays);
    }

    try {
      const res = await runPipeline(model, input.rules, opts, runners, { onProgress, shouldStop: () => stopped });
      const rep = await report(res);
      return {
        plan: toPlan(model, input, res),
        report: rep,
        meta: { codes: model.codes, parties: model.parties, partyCodes: model.partyCodes, regions: model.regions, segments: model.segment, wd: model.wd },
        seed: opts.seed,
        stopped: res.stopped,
        seconds: (performance.now() - t0) / 1000,
        debugNotes,
      };
    } finally {
      for (const s of slots) s.terminate();
    }
  };

  return {
    promise: run(),
    stop: () => {
      stopped = true;
      for (const s of slots) s.stop();
    },
  };
}

/** A new run seed (shown in the report so the run can be repeated) */
export function newSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}
