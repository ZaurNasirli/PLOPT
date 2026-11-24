/// <reference lib="webworker" />
/**
 * Optimizer worker: compiles the model once, then runs anneal / repair phases and the report
 * on request. Several workers run the seeds of a phase in parallel.
 */
import { compileModel, EngineModel, Weights } from './model';
import { anneal } from './anneal';
import { repairGroups } from './repair';
import { baseWeights } from './pipeline';
import { buildReport } from './report';
import type { WorkerRequest, WorkerResponse } from './protocol';

let model: EngineModel | null = null;
let base: Weights | null = null;
let stopFlag = false;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

/** Lets "stop" messages in between chunks of work (no 4 ms clamp like setTimeout) */
const yieldFn = () => new Promise<void>(resolve => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => resolve();
  ch.port2.postMessage(0);
});

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init':
        model = compileModel(msg.input);
        base = baseWeights(msg.input.rules, msg.opts);
        stopFlag = false;
        post({ type: 'ready', id: msg.id });
        break;
      case 'stop':
        stopFlag = true;
        break;
      case 'anneal': {
        if (!model || !base) throw new Error('not initialised');
        const res = await anneal(model, base, { mask: msg.mask, party: msg.party }, {
          ...msg.opts,
          yieldFn,
          shouldStop: () => stopFlag,
          onProgress: p => post({ type: 'progress', id: msg.id, ...p }),
          onDebug: text => post({ type: 'debug', id: msg.id, text }),
        });
        post({ type: 'annealDone', id: msg.id, mask: res.mask, party: res.party, best: res.best, stopped: res.stopped }, [res.mask.buffer, res.party.buffer]);
        break;
      }
      case 'repair': {
        if (!model || !base) throw new Error('not initialised');
        const res = repairGroups(model, base, { mask: msg.mask, party: msg.party }, msg.chgMul, msg.grpMul);
        post({ type: 'repairDone', id: msg.id, mask: res.mask, party: res.party }, [res.mask.buffer, res.party.buffer]);
        break;
      }
      case 'report': {
        if (!model || !base) throw new Error('not initialised');
        const report = buildReport(model, base, msg.lastMul, { mask: msg.mask, party: msg.party }, msg.origDays);
        post({ type: 'report', id: msg.id, report });
        break;
      }
    }
  } catch (err) {
    post({ type: 'error', id: 'id' in msg ? msg.id : 0, text: String((err as Error)?.message ?? err) });
  }
};
