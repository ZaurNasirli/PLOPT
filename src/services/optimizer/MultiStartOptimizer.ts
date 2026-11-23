import { Order } from '../../types';
import type { RoutingLimits } from '../routingService';
import { RoadMatrixLookup } from './RoadMatrix';
import { SmartVRPConfig, getTimeBudgetMs } from './types';
import { evaluateSolutionScore } from './ObjectiveFunction';
import { runRuinAndRecreate } from './RuinRecreate';
import { setSearchDeadline, clearSearchDeadline } from './searchControl';
import { runFullLocalSearch, optimizeRoute2Opt } from './LocalSearch';
import { optimizeRouteMerge, optimizeRouteSplit, eliminateUnderutilizedRoutes } from './RouteMerger';
import {
  buildGeographicCorridorSeed,
  buildFarthestPointSeed,
  buildNearestNeighborSeed,
  buildCapacityFirstSeed,
  buildRandomizedSeed,
  enforceMustStayTogether
} from './RouteBuilder';

/**
 * Checks if a specific stop has been locked by the dispatcher to stay in its route.
 */
function isNodeLocked(node: number, ordersMap: Order[], limits: RoutingLimits): boolean {
  if (!limits.lockedStops) return false;
  const o = ordersMap[node - 1];
  return Boolean(o && limits.lockedStops[o.id]);
}

/**
 * Checks if a route is locked using stable route IDs from orders.
 */
function isRouteLocked(route: number[], ordersMap: Order[], limits: RoutingLimits): boolean {
  if (!route || route.length === 0) return false;
  if (limits.lockedRoutes && limits.lockedRoutes.length > 0) {
    const hasLockedRoute = route.some(n => {
      const o = ordersMap[n - 1];
      return Boolean(o && o.routeId && limits.lockedRoutes && limits.lockedRoutes.includes(o.routeId));
    });
    if (hasLockedRoute) return true;
  }
  return false;
}

export function applyPerturbation(
  routes: number[][],
  seed: number,
  ordersMap?: Order[],
  limits?: RoutingLimits
): number[][] {
  const perturbed = routes.map(r => [...r]);
  if (perturbed.length < 2) return perturbed;

  let state = seed;
  const nextRand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };

  const numMoves = 2;
  for (let m = 0; m < numMoves; m++) {
    const rA = Math.floor(nextRand() * perturbed.length);
    let rB = Math.floor(nextRand() * perturbed.length);
    if (rA === rB) rB = (rA + 1) % perturbed.length;

    if (limits && ordersMap && (isRouteLocked(perturbed[rA], ordersMap, limits) || isRouteLocked(perturbed[rB], ordersMap, limits))) {
      continue;
    }

    if (perturbed[rA].length > 1) {
      const idxA = Math.floor(nextRand() * perturbed[rA].length);
      const node = perturbed[rA][idxA];
      if (ordersMap && limits && isNodeLocked(node, ordersMap, limits)) {
        continue;
      }
      perturbed[rA].splice(idxA, 1);
      const insertPos = Math.floor(nextRand() * (perturbed[rB].length + 1));
      perturbed[rB].splice(insertPos, 0, node);
    }
  }

  return perturbed.filter(r => r.length > 0);
}

/**
 * Pre-allocates locked stops into their assigned locked routes before generating seeds.
 * Remaining free stops are seeded around them.
 */
function buildInitialSeedWithLocks(
  orderIndices: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig,
  seedFn: (indices: number[]) => number[][]
): number[][] {
  const lockedNodeSet = new Set<number>();
  const lockedRoutesMap = new Map<string, number[]>();

  // 1. Group locked orders by target routeId
  if (limits.lockedStops) {
    for (const node of orderIndices) {
      const o = ordersMap[node - 1];
      if (o && limits.lockedStops[o.id]) {
        const rId = limits.lockedStops[o.id];
        if (!lockedRoutesMap.has(rId)) {
          lockedRoutesMap.set(rId, []);
        }
        lockedRoutesMap.get(rId)!.push(node);
        lockedNodeSet.add(node);
      }
    }
  }

  // Pre-seed locked routes with internal sequence optimization
  const preSeededRoutes: number[][] = [];
  for (const [, nodes] of lockedRoutesMap) {
    const optNodes = optimizeRoute2Opt(nodes, ordersMap, matrix, limits, config);
    preSeededRoutes.push(optNodes);
  }

  // 2. Filter remaining free indices
  const freeIndices = orderIndices.filter(n => !lockedNodeSet.has(n));

  if (freeIndices.length === 0) {
    return preSeededRoutes.length > 0 ? preSeededRoutes : [orderIndices];
  }

  // 3. Generate routes for free orders
  const freeRoutes = seedFn(freeIndices);

  const combined = [...preSeededRoutes, ...freeRoutes].filter(r => r.length > 0);
  return enforceMustStayTogether(combined, ordersMap, matrix, limits, config);
}

/**
 * Multi-Start Hybrid VRP Optimizer Engine (time-budgeted):
 *   1. Seeds (~35% of the budget): several construction heuristics, each improved by
 *      multi-operator local search and route merging.
 *   2. Ruin & recreate (LNS) on the best seed until ~90% of the budget.
 *   3. Final merge / under-utilised route elimination / local search polish.
 * The budget depends on the mode and the number of stops (see getTimeBudgetMs).
 */
export async function optimizeMultiStartVRP(
  orderIndices: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig,
  onStepProgress?: (percent: number, message: string) => void
): Promise<number[][]> {
  if (orderIndices.length === 0) {
    return [];
  }
  if (orderIndices.length === 1) {
    return [orderIndices];
  }

  const start = Date.now();
  const budget = getTimeBudgetMs(config, orderIndices.length);
  const deadline = start + budget;
  const seedDeadline = start + budget * 0.35;
  const lnsDeadline = start + budget * 0.9;
  const report = (msg: string) => {
    if (onStepProgress) onStepProgress(15 + Math.floor(Math.min(1, (Date.now() - start) / budget) * 80), msg);
  };

  let globalBestRoutes: number[][] = [];
  let globalBestScore = Infinity;
  const consider = (routes: number[][]) => {
    if (routes.length === 0) return;
    const score = evaluateSolutionScore(routes, ordersMap, matrix, limits, config);
    if (globalBestRoutes.length === 0 || score < globalBestScore) {
      globalBestScore = score;
      globalBestRoutes = routes;
    }
  };

  const seedBuilders: { name: string; build: (indices: number[]) => number[][] }[] = [
    { name: 'Географический коридорный seed', build: idx => buildGeographicCorridorSeed(idx, ordersMap, matrix, limits, config) },
    { name: 'Seed по крайним точкам (Farthest)', build: idx => buildFarthestPointSeed(idx, ordersMap, matrix, limits, config) },
    { name: 'Жадный seed (Nearest Neighbor)', build: idx => buildNearestNeighborSeed(idx, ordersMap, matrix, limits, config) },
    { name: 'Seed по плотности загрузки (Capacity-First)', build: idx => buildCapacityFirstSeed(idx, ordersMap, matrix, limits, config) }
  ];
  const multiStarts = Math.max(1, config.multiStartIterations || 3);

  try {
    // ---- Phase 1: seeds + local search ----
    setSearchDeadline(seedDeadline);
    for (let sIdx = 0; sIdx < multiStarts; sIdx++) {
      if (sIdx >= 1 && Date.now() > seedDeadline) break;
      const builder = seedBuilders[sIdx] || {
        name: `Стохастический seed #${sIdx - 3}`,
        build: (idx: number[]) => buildRandomizedSeed(idx, ordersMap, matrix, limits, config, (sIdx + 1) * 317 + 101)
      };
      report(`Multi-Start [${sIdx + 1}/${multiStarts}]: ${builder.name}...`);
      await new Promise(r => setTimeout(r, 0));

      let solution = buildInitialSeedWithLocks(orderIndices, ordersMap, matrix, limits, config, builder.build);
      solution = runFullLocalSearch(solution, ordersMap, matrix, limits, config);
      solution = optimizeRouteMerge(solution, ordersMap, matrix, limits, config);
      solution = eliminateUnderutilizedRoutes(solution, ordersMap, matrix, limits, config);
      solution = enforceMustStayTogether(solution, ordersMap, matrix, limits, config);
      consider(solution);
    }

    // ---- Phase 2: ruin & recreate ----
    if (globalBestRoutes.length > 0 && Date.now() < lnsDeadline) {
      report('LNS: разрушение и восстановление решения...');
      await new Promise(r => setTimeout(r, 0));
      setSearchDeadline(lnsDeadline);
      const lns = runRuinAndRecreate(globalBestRoutes, ordersMap, matrix, limits, config, {
        deadline: lnsDeadline,
        seed: orderIndices.length * 7919 + 17,
        onProgress: (_, msg) => report(msg)
      });
      consider(lns.solution);
    }

    // ---- Phase 3: final polish ----
    setSearchDeadline(deadline);
    if (globalBestRoutes.length > 0) {
      let polished = optimizeRouteMerge(globalBestRoutes, ordersMap, matrix, limits, config);
      polished = eliminateUnderutilizedRoutes(polished, ordersMap, matrix, limits, config);
      if (config.mode === 'quality') polished = optimizeRouteSplit(polished, ordersMap, matrix, limits, config);
      polished = enforceMustStayTogether(polished, ordersMap, matrix, limits, config);
      polished = runFullLocalSearch(polished, ordersMap, matrix, limits, config);
      consider(polished);
    }
  } finally {
    clearSearchDeadline();
  }

  // Final safety fallback if all seeds somehow returned empty
  if (globalBestRoutes.length === 0 && orderIndices.length > 0) {
    globalBestRoutes = orderIndices.map(idx => [idx]);
  }

  return globalBestRoutes;
}
