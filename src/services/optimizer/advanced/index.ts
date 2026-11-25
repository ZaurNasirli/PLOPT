/**
 * Entry point of the advanced routers. Same input and output as optimizeMultiStartVRP
 * (order indices 1..N of one date/slot group → routes as lists of order indices), so they reuse
 * the road matrix, barriers, partitions and route building of the SMART pipeline.
 */
import type { Order } from '../../../types';
import type { RoutingLimits } from '../../routingService';
import type { RoadMatrixLookup } from '../RoadMatrix';
import { SmartVRPConfig, getTimeBudgetMs } from '../types';
import { createRng } from '../searchControl';
import { compileModel } from './model';
import { evaluateSolutionScore } from '../ObjectiveFunction';
import { construct, solveSISR } from './sisr';
import { runHGS } from './hgs';
import { polish } from './localSearch';

export type AdvancedEngine = 'sisr' | 'hgs';

export async function optimizeAdvanced(
  engine: AdvancedEngine,
  orderIndices: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig,
  onProgress?: (percent: number, message: string) => void,
  seed = 20261125
): Promise<number[][]> {
  if (orderIndices.length === 0) return [];
  if (orderIndices.length === 1) return [orderIndices];
  const start = Date.now();
  const budget = getTimeBudgetMs(config, orderIndices.length);
  // the final polish runs inside the budget, like SMART's last phase
  const polishMs = Math.min(1500, budget * 0.08);
  const deadline = start + budget - polishMs;
  const rng = createRng(seed ^ orderIndices.length);
  const m = compileModel(orderIndices, ordersMap, matrix, limits, config);
  // the same objective as SMART: tariffs, time, loads, compactness, balance, penalties of the mode
  m.scorer = routes => evaluateSolutionScore(routes, ordersMap, matrix, limits, config);
  const report = (f: number, text: string) => onProgress?.(15 + Math.floor(Math.min(1, f) * 80), text);

  let sol = construct(m, rng);
  if (engine === 'hgs') {
    sol = runHGS(m, { deadline, rng, onProgress: (f, best) => report(f, `HGS: поколения, лучшая стоимость ${best.toFixed(3)}`) });
  } else {
    sol = solveSISR(sol, { deadline, rng, onProgress: (f, best) => report(f, `SISR: разрезание цепочек, лучшая стоимость ${best.toFixed(3)}`) });
  }
  const polished = polish(sol, polishMs);
  if (coversAll(polished.toNodeRoutes(), orderIndices) && polished.cost() <= sol.cost()) sol = polished;
  const plan = sol.toNodeRoutes();
  // safety net: every order exactly once, else one route per order (never lose an order)
  return coversAll(plan, orderIndices) ? plan : orderIndices.map(i => [i]);
}

/** Every order index exactly once */
export function coversAll(plan: number[][], orderIndices: number[]): boolean {
  const seen = new Set<number>();
  let n = 0;
  for (const r of plan) for (const i of r) { if (seen.has(i)) return false; seen.add(i); n++; }
  return n === orderIndices.length && orderIndices.every(i => seen.has(i));
}
