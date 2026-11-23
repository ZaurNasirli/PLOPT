import { Order } from '../../types';
import { RoutingLimits } from '../routingService';
import { RoadMatrixLookup } from './DistanceMatrix';
import { SmartVRPConfig } from './types';
import { evaluateSolutionScore } from './ObjectiveFunction';
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
 * Multi-Start Hybrid VRP Optimizer Engine:
 * Generates distinct seed solutions, optimizes each through multi-operator local search,
 * applies Iterated Local Search (ILS) with Simulated Annealing acceptance,
 * and returns the best solution across all starts.
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

  const multiStarts = config.multiStartIterations || 3;
  let globalBestRoutes: number[][] = [];
  let globalBestScore = Infinity;

  const totalRuns = Math.max(1, multiStarts);

  for (let sIdx = 0; sIdx < totalRuns; sIdx++) {
    let seedName: string;
    let initialSolution: number[][];

    if (sIdx === 0) {
      seedName = 'Географический коридорный seed';
      initialSolution = buildInitialSeedWithLocks(
        orderIndices, ordersMap, matrix, limits, config,
        (indices) => buildGeographicCorridorSeed(indices, ordersMap, matrix, limits, config)
      );
    } else if (sIdx === 1) {
      seedName = 'Seed по крайним точкам (Farthest)';
      initialSolution = buildInitialSeedWithLocks(
        orderIndices, ordersMap, matrix, limits, config,
        (indices) => buildFarthestPointSeed(indices, ordersMap, matrix, limits, config)
      );
    } else if (sIdx === 2) {
      seedName = 'Жадный seed (Nearest Neighbor)';
      initialSolution = buildInitialSeedWithLocks(
        orderIndices, ordersMap, matrix, limits, config,
        (indices) => buildNearestNeighborSeed(indices, ordersMap, matrix, limits, config)
      );
    } else if (sIdx === 3) {
      seedName = 'Seed по плотности загрузки (Capacity-First)';
      initialSolution = buildInitialSeedWithLocks(
        orderIndices, ordersMap, matrix, limits, config,
        (indices) => buildCapacityFirstSeed(indices, ordersMap, matrix, limits, config)
      );
    } else {
      seedName = `Стохастический seed #${sIdx - 3}`;
      initialSolution = buildInitialSeedWithLocks(
        orderIndices, ordersMap, matrix, limits, config,
        (indices) => buildRandomizedSeed(indices, ordersMap, matrix, limits, config, (sIdx + 1) * 317 + 101)
      );
    }

    if (onStepProgress) {
      const p = 15 + Math.floor((sIdx / totalRuns) * 70);
      onStepProgress(p, `Multi-Start [${sIdx + 1}/${totalRuns}]: ${seedName}...`);
    }
    await new Promise(r => setTimeout(r, 0));

    // Step 1: Initial seed solution
    let currentSolution = initialSolution;

    // Step 2: Full multi-operator local search
    currentSolution = runFullLocalSearch(currentSolution, ordersMap, matrix, limits, config);

    // Step 3: Route Merge / Split / Underutilization Elimination
    currentSolution = optimizeRouteMerge(currentSolution, ordersMap, matrix, limits, config);
    currentSolution = eliminateUnderutilizedRoutes(currentSolution, ordersMap, matrix, limits, config);
    if (config.mode === 'quality') {
      currentSolution = optimizeRouteSplit(currentSolution, ordersMap, matrix, limits, config);
    }

    // Polish after mergers
    currentSolution = enforceMustStayTogether(currentSolution, ordersMap, matrix, limits, config);
    currentSolution = runFullLocalSearch(currentSolution, ordersMap, matrix, limits, config);
    let currentScore = evaluateSolutionScore(currentSolution, ordersMap, matrix, limits, config);

    // Step 4: Iterated Local Search (ILS) & Simulated Annealing escapes
    if (config.ilsMaxPerturbations > 0) {
      let ilsSolution = currentSolution;
      let ilsScore = currentScore;
      let temperature = 0.05; // Initial temperature for SA acceptance

      for (let pIdx = 0; pIdx < config.ilsMaxPerturbations; pIdx++) {
        // Apply perturbation with locked stops & routes protection
        const perturbed = applyPerturbation(ilsSolution, (sIdx + 1) * 1000 + pIdx, ordersMap, limits);
        // Local search from perturbed state
        const restored = runFullLocalSearch(perturbed, ordersMap, matrix, limits, config);
        const restoredScore = evaluateSolutionScore(restored, ordersMap, matrix, limits, config);

        // Simulated Annealing / threshold acceptance criterion
        const delta = restoredScore - ilsScore;
        const accept = delta < 0 || (Number.isFinite(delta) && Math.exp(-delta / Math.max(0.001, temperature)) > 0.45);

        if (accept && restored.length > 0) {
          ilsSolution = restored;
          ilsScore = restoredScore;
        }

        temperature *= 0.75; // Cool down

        // Update if improved
        if (ilsScore < currentScore) {
          currentSolution = ilsSolution;
          currentScore = ilsScore;
        }
      }
    }

    // Check against global best (always capture the first non-empty solution as fallback)
    if (currentSolution.length > 0 && (globalBestRoutes.length === 0 || currentScore < globalBestScore)) {
      globalBestScore = currentScore;
      globalBestRoutes = currentSolution;
    }
  }

  // Final safety fallback if all seeds somehow returned empty
  if (globalBestRoutes.length === 0 && orderIndices.length > 0) {
    globalBestRoutes = orderIndices.map(idx => [idx]);
  }

  return globalBestRoutes;
}
