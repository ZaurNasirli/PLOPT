/// <reference lib="webworker" />
// Runs the CPU-heavy VRP search off the main thread so the UI stays responsive.
import { RoadMatrixLookup } from './RoadMatrix';
import { optimizeMultiStartVRP } from './MultiStartOptimizer';
import { optimizeAdvanced } from './advanced';
import type { OptimizerJob } from './workerClient';

self.onmessage = async (event: MessageEvent<OptimizerJob>) => {
  const job = event.data;
  try {
    const matrix = new RoadMatrixLookup(job.n, job.distances, job.durations, job.isRealRoad, job.hasFallback);
    const progress = (percent: number, message: string) => (self as unknown as Worker).postMessage({ type: 'progress', percent, message });
    const result = job.engine && job.engine !== 'smart'
      ? await optimizeAdvanced(job.engine, job.orderIndices, job.orders, matrix, job.limits, job.config, progress)
      : await optimizeMultiStartVRP(job.orderIndices, job.orders, matrix, job.limits, job.config, progress);
    (self as unknown as Worker).postMessage({ type: 'done', result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
