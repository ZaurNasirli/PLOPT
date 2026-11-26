import { Order } from '../../types';
import type { RoutingLimits } from '../routingService';
import { RoadMatrixLookup } from './RoadMatrix';
import { SmartVRPConfig } from './types';
import { optimizeMultiStartVRP } from './MultiStartOptimizer';
import { optimizeAdvanced } from './advanced';

/** Which search runs on the prepared matrix: SMART (multi-start + LNS) or one of the advanced routers */
export type OptimizerEngine = 'smart' | 'sisr' | 'hgs' | 'pd';

export interface OptimizerJob {
  orderIndices: number[];
  orders: Order[];
  n: number;
  distances: number[][];
  durations: number[][];
  isRealRoad: boolean;
  hasFallback: boolean;
  limits: RoutingLimits;
  config: SmartVRPConfig;
  engine: OptimizerEngine;
  /** start plan for the 'pd' finishing search */
  start?: number[][];
}

/**
 * Runs optimizeMultiStartVRP in a Web Worker when the environment supports it
 * (browser), otherwise in the current thread (tests, old browsers, worker failure).
 */
export async function runOptimizer(
  orderIndices: number[],
  orders: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig,
  onProgress?: (percent: number, message: string) => void,
  engine: OptimizerEngine = 'smart',
  start?: number[][]
): Promise<number[][]> {
  const inThread = () => engine === 'smart'
    ? optimizeMultiStartVRP(orderIndices, orders, matrix, limits, config, onProgress)
    : optimizeAdvanced(engine, orderIndices, orders, matrix, limits, config, onProgress, undefined, start);
  if (typeof Worker === 'undefined' || typeof window === 'undefined') return inThread();

  let worker: Worker;
  try {
    worker = new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return inThread();
  }

  const { distances, durations } = matrix.toNested();
  const job: OptimizerJob = {
    orderIndices,
    // structured clone: plain data only
    orders: JSON.parse(JSON.stringify(orders)),
    n: matrix.n,
    distances,
    durations,
    isRealRoad: matrix.isRealRoad,
    hasFallback: matrix.hasFallback,
    limits: JSON.parse(JSON.stringify(limits)),
    config: JSON.parse(JSON.stringify(config)),
    engine,
    start
  };

  try {
    return await new Promise<number[][]>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === 'progress') onProgress?.(msg.percent, msg.message);
        else if (msg.type === 'done') resolve(msg.result);
        else if (msg.type === 'error') reject(new Error(msg.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'worker failed'));
      worker.postMessage(job);
    });
  } catch (err) {
    console.warn('[Optimizer] worker failed, running on the main thread:', err);
    return inThread();
  } finally {
    worker.terminate();
  }
}
