import { Order } from '../../types';
import { RoutingLimits } from '../routingService';
import { RoadMatrixLookup } from './DistanceMatrix';
import { SmartVRPConfig } from './types';
import { checkHardLimits } from './ConstraintValidator';
import { 
  evaluateSingleRouteScore, 
  evaluateSolutionScore 
} from './ObjectiveFunction';
import { findBestInsertion } from './RouteBuilder';

/**
 * Intra-Route 2-Opt:
 * Reverses a sub-sequence of stops [i..j] if it strictly reduces route cost.
 */
export function optimizeRoute2Opt(
  route: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[] {
  if (route.length < 3) return route;

  let best = [...route];
  let bestScore = evaluateSingleRouteScore(best, ordersMap, matrix, limits, config);
  let passes = 0;
  let improved = true;

  while (improved && passes < config.twoOptMaxPasses) {
    improved = false;
    passes++;

    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        // Quick distance check before full evaluation
        const prevI = i === 0 ? 0 : best[i - 1];
        const nextJ = j === best.length - 1 ? 0 : best[j + 1];

        const oldDist = matrix.getDistance(prevI, best[i]) + matrix.getDistance(best[j], nextJ);
        const newDist = matrix.getDistance(prevI, best[j]) + matrix.getDistance(best[i], nextJ);

        if (newDist >= oldDist + 0.05) continue; // Skip non-improving edge pairs

        const candidate = [...best];
        const sub = candidate.slice(i, j + 1).reverse();
        candidate.splice(i, j - i + 1, ...sub);

        const routeOrders = candidate.map(idx => ordersMap[idx - 1]).filter(Boolean);
        if (!checkHardLimits(routeOrders, limits)) continue;

        const candidateScore = evaluateSingleRouteScore(candidate, ordersMap, matrix, limits, config);
        if (candidateScore < bestScore - 0.001) {
          best = candidate;
          bestScore = candidateScore;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  return best;
}

/**
 * Intra-Route Or-Opt:
 * Extracts a consecutive block of 2 or 3 stops and relocates it to another position in the route.
 */
export function optimizeRouteOrOpt(
  route: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[] {
  if (route.length < 4) return route;

  let best = [...route];
  let bestScore = evaluateSingleRouteScore(best, ordersMap, matrix, limits, config);
  let passes = 0;
  let improved = true;

  const blockSizes = [3, 2]; // Test block of 3, then block of 2

  while (improved && passes < config.orOptMaxPasses) {
    improved = false;
    passes++;

    for (const blockSize of blockSizes) {
      if (best.length <= blockSize + 1) continue;

      for (let i = 0; i <= best.length - blockSize; i++) {
        const block = best.slice(i, i + blockSize);
        const remaining = [...best.slice(0, i), ...best.slice(i + blockSize)];

        for (let p = 0; p <= remaining.length; p++) {
          if (p === i) continue; // Same position

          const candidate = [...remaining.slice(0, p), ...block, ...remaining.slice(p)];
          const routeOrders = candidate.map(idx => ordersMap[idx - 1]).filter(Boolean);
          if (!checkHardLimits(routeOrders, limits)) continue;

          const candidateScore = evaluateSingleRouteScore(candidate, ordersMap, matrix, limits, config);
          if (candidateScore < bestScore - 0.002) {
            best = candidate;
            bestScore = candidateScore;
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
      if (improved) break;
    }
  }

  return best;
}

/**
 * Intra-Route 3-Opt (Quality Mode only):
 * Tests 3-edge reconnection for routes <= 25 stops to eliminate subtle crossing knots.
 */
export function optimizeRoute3Opt(
  route: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[] {
  if (route.length < 6 || route.length > 25 || !config.enableThreeOpt) return route;

  let best = [...route];
  let bestScore = evaluateSingleRouteScore(best, ordersMap, matrix, limits, config);
  const n = best.length;

  for (let i = 0; i < n - 4; i++) {
    for (let j = i + 2; j < n - 2; j++) {
      for (let k = j + 2; k < n; k++) {
        const segA = best.slice(0, i + 1);
        const segB = best.slice(i + 1, j + 1);
        const segC = best.slice(j + 1, k + 1);
        const segD = best.slice(k + 1);

        // 3-opt reconnections
        const candidates = [
          [...segA, ...segC, ...segB, ...segD],
          [...segA, ...segB.slice().reverse(), ...segC, ...segD],
          [...segA, ...segB, ...segC.slice().reverse(), ...segD],
          [...segA, ...segC.slice().reverse(), ...segB, ...segD]
        ];

        for (const cand of candidates) {
          const candOrders = cand.map(idx => ordersMap[idx - 1]).filter(Boolean);
          if (!checkHardLimits(candOrders, limits)) continue;

          const candScore = evaluateSingleRouteScore(cand, ordersMap, matrix, limits, config);
          if (candScore < bestScore - 0.005) {
            best = cand;
            bestScore = candScore;
            return best; // Fast first improvement
          }
        }
      }
    }
  }

  return best;
}

function isNodeLocked(node: number, ordersMap: Order[], limits: RoutingLimits): boolean {
  if (!limits.lockedStops) return false;
  const o = ordersMap[node - 1];
  return Boolean(o && limits.lockedStops[o.id]);
}

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

/**
 * Inter-Route Relocate:
 * Moves 1 order from Route A to Route B if global solution score improves.
 */
export function optimizeInterRouteRelocate(
  routes: number[][],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[][] {
  let solution = routes.map(r => [...r]);
  let currentScore = evaluateSolutionScore(solution, ordersMap, matrix, limits, config);
  let improved = true;
  let iterations = 0;

  while (improved && iterations < config.interRouteMaxIterations) {
    improved = false;
    iterations++;

    for (let rA = 0; rA < solution.length; rA++) {
      if (solution[rA].length <= 1 || isRouteLocked(solution[rA], ordersMap, limits)) continue;

      for (let oIdx = 0; oIdx < solution[rA].length; oIdx++) {
        const nodeToMove = solution[rA][oIdx];
        if (isNodeLocked(nodeToMove, ordersMap, limits)) continue;

        const newRouteA = solution[rA].filter((_, idx) => idx !== oIdx);

        for (let rB = 0; rB < solution.length; rB++) {
          if (rA === rB || isRouteLocked(solution[rB], ordersMap, limits)) continue;

          const ins = findBestInsertion(solution[rB], nodeToMove, ordersMap, matrix, limits, config);
          if (!ins) continue;

          const candidateSolution = solution.map((r, idx) => {
            if (idx === rA) return newRouteA;
            if (idx === rB) return ins.newRoute;
            return r;
          });

          const newScore = evaluateSolutionScore(candidateSolution, ordersMap, matrix, limits, config);
          if (newScore < currentScore - 0.001) {
            solution = candidateSolution.filter(r => r.length > 0);
            currentScore = newScore;
            improved = true;
            break;
          }
        }
        if (improved) break;
      }
      if (improved) break;
    }
  }

  return solution;
}

/**
 * Inter-Route Swap:
 * Exchanges 1 order between Route A and Route B if global solution score improves.
 */
export function optimizeInterRouteSwap(
  routes: number[][],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[][] {
  let solution = routes.map(r => [...r]);
  let currentScore = evaluateSolutionScore(solution, ordersMap, matrix, limits, config);
  let improved = true;
  let iterations = 0;

  while (improved && iterations < config.interRouteMaxIterations) {
    improved = false;
    iterations++;

    for (let rA = 0; rA < solution.length - 1; rA++) {
      if (isRouteLocked(solution[rA], ordersMap, limits)) continue;
      for (let rB = rA + 1; rB < solution.length; rB++) {
        if (isRouteLocked(solution[rB], ordersMap, limits)) continue;
        if (solution[rA].length === 0 || solution[rB].length === 0) continue;

        for (let i = 0; i < solution[rA].length; i++) {
          const nodeA = solution[rA][i];
          if (isNodeLocked(nodeA, ordersMap, limits)) continue;

          for (let j = 0; j < solution[rB].length; j++) {
            const nodeB = solution[rB][j];
            if (isNodeLocked(nodeB, ordersMap, limits)) continue;

            const newRouteA = [...solution[rA]];
            newRouteA[i] = nodeB;
            const newRouteB = [...solution[rB]];
            newRouteB[j] = nodeA;

            const ordersA = newRouteA.map(idx => ordersMap[idx - 1]).filter(Boolean);
            const ordersB = newRouteB.map(idx => ordersMap[idx - 1]).filter(Boolean);
            if (!checkHardLimits(ordersA, limits) || !checkHardLimits(ordersB, limits)) continue;

            const optA = optimizeRoute2Opt(newRouteA, ordersMap, matrix, limits, config);
            const optB = optimizeRoute2Opt(newRouteB, ordersMap, matrix, limits, config);

            const candidateSolution = solution.map((r, idx) => {
              if (idx === rA) return optA;
              if (idx === rB) return optB;
              return r;
            });

            const newScore = evaluateSolutionScore(candidateSolution, ordersMap, matrix, limits, config);
            if (newScore < currentScore - 0.001) {
              solution = candidateSolution;
              currentScore = newScore;
              improved = true;
              break;
            }
          }
          if (improved) break;
        }
        if (improved) break;
      }
      if (improved) break;
    }
  }

  return solution;
}

/**
 * Inter-Route 2-Opt* (Two-Opt Star):
 * Swaps tails of two routes:
 * Route A becomes: A[0..i] + B[j+1..end]
 * Route B becomes: B[0..j] + A[i+1..end]
 * Decisively untangles intersecting routes across adjacent geographic corridors!
 */
export function optimizeInterRouteTwoOptStar(
  routes: number[][],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[][] {
  let solution = routes.map(r => [...r]);
  let currentScore = evaluateSolutionScore(solution, ordersMap, matrix, limits, config);

  for (let rA = 0; rA < solution.length - 1; rA++) {
    if (isRouteLocked(solution[rA], ordersMap, limits)) continue;
    for (let rB = rA + 1; rB < solution.length; rB++) {
      if (isRouteLocked(solution[rB], ordersMap, limits)) continue;
      if (solution[rA].length < 2 || solution[rB].length < 2) continue;

      let pairImproved = false;
      for (let i = 0; i < solution[rA].length - 1; i++) {
        for (let j = 0; j < solution[rB].length - 1; j++) {
          const tailA = solution[rA].slice(i + 1);
          const tailB = solution[rB].slice(j + 1);
          if (tailA.some(n => isNodeLocked(n, ordersMap, limits)) || tailB.some(n => isNodeLocked(n, ordersMap, limits))) {
            continue;
          }

          // Test 1: Standard tail swap
          // New Route A: A[0..i] + B[j+1..end]
          // New Route B: B[0..j] + A[i+1..end]
          const candPairs = [
            {
              a: [...solution[rA].slice(0, i + 1), ...solution[rB].slice(j + 1)],
              b: [...solution[rB].slice(0, j + 1), ...solution[rA].slice(i + 1)]
            },
            {
              a: [...solution[rA].slice(0, i + 1), ...solution[rB].slice(j + 1).reverse()],
              b: [...solution[rB].slice(0, j + 1), ...solution[rA].slice(i + 1).reverse()]
            }
          ];

          for (const pair of candPairs) {
            const newA = pair.a;
            const newB = pair.b;
            if (newA.length === 0 || newB.length === 0) continue;

            const ordersA = newA.map(idx => ordersMap[idx - 1]).filter(Boolean);
            const ordersB = newB.map(idx => ordersMap[idx - 1]).filter(Boolean);
            if (!checkHardLimits(ordersA, limits) || !checkHardLimits(ordersB, limits)) continue;

            const optA = optimizeRoute2Opt(newA, ordersMap, matrix, limits, config);
            const optB = optimizeRoute2Opt(newB, ordersMap, matrix, limits, config);

            const candidate = solution.map((r, idx) => {
              if (idx === rA) return optA;
              if (idx === rB) return optB;
              return r;
            });

            const candScore = evaluateSolutionScore(candidate, ordersMap, matrix, limits, config);
            if (candScore < currentScore - 0.002) {
              solution = candidate;
              currentScore = candScore;
              pairImproved = true;
              break;
            }
          }
        }
        if (pairImproved) break;
      }
    }
  }

  return solution;
}

/**
 * Inter-Route Cross-Exchange:
 * Swaps consecutive blocks of 2 stops between adjacent routes.
 */
export function optimizeInterRouteCrossExchange(
  routes: number[][],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[][] {
  let solution = routes.map(r => [...r]);
  let currentScore = evaluateSolutionScore(solution, ordersMap, matrix, limits, config);

  for (let rA = 0; rA < solution.length - 1; rA++) {
    if (isRouteLocked(solution[rA], ordersMap, limits)) continue;
    for (let rB = rA + 1; rB < solution.length; rB++) {
      if (isRouteLocked(solution[rB], ordersMap, limits)) continue;
      if (solution[rA].length < 3 || solution[rB].length < 3) continue;

      let exchangeFound = false;
      for (let i = 0; i <= solution[rA].length - 2; i++) {
        for (let j = 0; j <= solution[rB].length - 2; j++) {
          const blockA = solution[rA].slice(i, i + 2);
          const blockB = solution[rB].slice(j, j + 2);
          if (blockA.some(n => isNodeLocked(n, ordersMap, limits)) || blockB.some(n => isNodeLocked(n, ordersMap, limits))) {
            continue;
          }

          const newA = [...solution[rA].slice(0, i), ...blockB, ...solution[rA].slice(i + 2)];
          const newB = [...solution[rB].slice(0, j), ...blockA, ...solution[rB].slice(j + 2)];

          const ordersA = newA.map(idx => ordersMap[idx - 1]).filter(Boolean);
          const ordersB = newB.map(idx => ordersMap[idx - 1]).filter(Boolean);
          if (!checkHardLimits(ordersA, limits) || !checkHardLimits(ordersB, limits)) continue;

          const optA = optimizeRoute2Opt(newA, ordersMap, matrix, limits, config);
          const optB = optimizeRoute2Opt(newB, ordersMap, matrix, limits, config);

          const candidate = solution.map((r, idx) => {
            if (idx === rA) return optA;
            if (idx === rB) return optB;
            return r;
          });

          const newScore = evaluateSolutionScore(candidate, ordersMap, matrix, limits, config);
          if (newScore < currentScore - 0.003) {
            solution = candidate;
            currentScore = newScore;
            exchangeFound = true;
            break;
          }
        }
        if (exchangeFound) break;
      }
    }
  }

  return solution;
}

/**
 * Runs complete local search pipeline on a solution:
 * Intra 2-opt + Or-opt + Relocate + Swap + 2-opt* + Cross-Exchange + 3-opt
 */
export function runFullLocalSearch(
  routes: number[][],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[][] {
  // Step 1: Polish each route internally with 2-Opt & Or-Opt
  let current = routes.map(r => {
    let opt = optimizeRoute2Opt(r, ordersMap, matrix, limits, config);
    opt = optimizeRouteOrOpt(opt, ordersMap, matrix, limits, config);
    if (config.enableThreeOpt) {
      opt = optimizeRoute3Opt(opt, ordersMap, matrix, limits, config);
    }
    return opt;
  });

  // Step 2: Inter-route Relocate
  current = optimizeInterRouteRelocate(current, ordersMap, matrix, limits, config);

  // Step 3: Inter-route Swap
  current = optimizeInterRouteSwap(current, ordersMap, matrix, limits, config);

  // Step 4: 2-Opt* (Tail swap between routes)
  current = optimizeInterRouteTwoOptStar(current, ordersMap, matrix, limits, config);

  // Step 5: Cross-Exchange
  current = optimizeInterRouteCrossExchange(current, ordersMap, matrix, limits, config);

  // Step 6: Final intra-route 2-opt & Or-opt polish
  current = current.map(r => {
    let opt = optimizeRoute2Opt(r, ordersMap, matrix, limits, config);
    return optimizeRouteOrOpt(opt, ordersMap, matrix, limits, config);
  });

  return current.filter(r => r.length > 0);
}
