import { Order } from '../../types';
import type { RoutingLimits } from '../routingService';
import { RoadMatrixLookup } from './RoadMatrix';
import { SmartVRPConfig } from './types';
import { checkHardLimits } from './ConstraintValidator';
import {
  evaluateSingleRouteScore,
  evaluateSolutionScore
} from './ObjectiveFunction';
import { findBestInsertion } from './RouteBuilder';
import { timeUp } from './searchControl';

// Moves are first screened by their distance change (O(1) from the matrix); only promising
// ones get the full (cached) objective evaluation. Inter-route moves only pair stops that are
// close to each other (matrix nearest-neighbour lists), which is where improvements come from.

/** Distance screen: moves that lengthen the route by more than this are not evaluated. */
const SCREEN_KM = 0.05;

/**
 * Intra-Route 2-Opt:
 * Reverses a sub-sequence of stops [i..j] if it strictly reduces route cost.
 * The set of stops does not change, so capacity limits are not re-checked.
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
  if (!Number.isFinite(bestScore)) return best;
  let passes = 0;
  let improved = true;

  while (improved && passes < config.twoOptMaxPasses && !timeUp()) {
    improved = false;
    passes++;

    for (let i = 0; i < best.length - 1; i++) {
      const prevI = i === 0 ? 0 : best[i - 1];
      for (let j = i + 1; j < best.length; j++) {
        const nextJ = j === best.length - 1 ? 0 : best[j + 1];
        const delta =
          matrix.getDistance(prevI, best[j]) + matrix.getDistance(best[i], nextJ) -
          matrix.getDistance(prevI, best[i]) - matrix.getDistance(best[j], nextJ);
        if (delta >= SCREEN_KM) continue;

        const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        const candidateScore = evaluateSingleRouteScore(candidate, ordersMap, matrix, limits, config);
        if (candidateScore < bestScore - 0.001) {
          best = candidate;
          bestScore = candidateScore;
          improved = true;
        }
      }
    }
  }

  return best;
}

/**
 * Intra-Route Or-Opt:
 * Extracts a consecutive block of 1-3 stops and relocates it to another position in the route.
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
  if (!Number.isFinite(bestScore)) return best;
  let passes = 0;
  let improved = true;
  const d = (a: number, b: number) => matrix.getDistance(a, b);

  while (improved && passes < config.orOptMaxPasses && !timeUp()) {
    improved = false;
    passes++;

    for (const blockSize of [3, 2, 1]) {
      if (best.length <= blockSize + 1) continue;

      for (let i = 0; i <= best.length - blockSize && !improved; i++) {
        const first = best[i];
        const last = best[i + blockSize - 1];
        const prev = i === 0 ? 0 : best[i - 1];
        const next = i + blockSize >= best.length ? 0 : best[i + blockSize];
        const removalGain = d(prev, first) + d(last, next) - d(prev, next);
        const block = best.slice(i, i + blockSize);
        const remaining = [...best.slice(0, i), ...best.slice(i + blockSize)];

        for (let p = 0; p <= remaining.length; p++) {
          if (p === i) continue; // Same position
          const a = p === 0 ? 0 : remaining[p - 1];
          const c = p === remaining.length ? 0 : remaining[p];
          const insertCost = d(a, first) + d(last, c) - d(a, c);
          if (insertCost - removalGain >= SCREEN_KM) continue;

          const candidate = [...remaining.slice(0, p), ...block, ...remaining.slice(p)];
          const candidateScore = evaluateSingleRouteScore(candidate, ordersMap, matrix, limits, config);
          if (candidateScore < bestScore - 0.002) {
            best = candidate;
            bestScore = candidateScore;
            improved = true;
            break;
          }
        }
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

  const best = [...route];
  const bestScore = evaluateSingleRouteScore(best, ordersMap, matrix, limits, config);
  const n = best.length;

  for (let i = 0; i < n - 4; i++) {
    if (timeUp()) break;
    for (let j = i + 2; j < n - 2; j++) {
      for (let k = j + 2; k < n; k++) {
        const segA = best.slice(0, i + 1);
        const segB = best.slice(i + 1, j + 1);
        const segC = best.slice(j + 1, k + 1);
        const segD = best.slice(k + 1);

        const candidates = [
          [...segA, ...segC, ...segB, ...segD],
          [...segA, ...segB.slice().reverse(), ...segC, ...segD],
          [...segA, ...segB, ...segC.slice().reverse(), ...segD],
          [...segA, ...segC.slice().reverse(), ...segB, ...segD]
        ];

        for (const cand of candidates) {
          const candScore = evaluateSingleRouteScore(cand, ordersMap, matrix, limits, config);
          if (candScore < bestScore - 0.005) {
            return cand; // Fast first improvement
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

function routeIndexOf(solution: number[][]): Map<number, number> {
  const map = new Map<number, number>();
  solution.forEach((r, ri) => r.forEach(n => map.set(n, ri)));
  return map;
}

/** Routes that contain at least one of `node`'s nearest neighbours (all routes when there are few). */
function nearbyRoutes(node: number, solution: number[][], routeOf: Map<number, number>, matrix: RoadMatrixLookup): number[] {
  if (solution.length <= 4) return solution.map((_, i) => i);
  const set = new Set<number>();
  const neighbours = matrix.getNeighbors(node);
  for (let k = 0; k < neighbours.length; k++) {
    const r = routeOf.get(neighbours[k]);
    if (r !== undefined) set.add(r);
  }
  return Array.from(set);
}

/**
 * Inter-Route Relocate:
 * Moves 1 order from Route A to a nearby Route B if the global solution score improves.
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

  while (improved && iterations < config.interRouteMaxIterations && !timeUp()) {
    improved = false;
    iterations++;
    const routeOf = routeIndexOf(solution);

    for (let rA = 0; rA < solution.length && !improved; rA++) {
      if (solution[rA].length <= 1 || isRouteLocked(solution[rA], ordersMap, limits)) continue;

      for (let oIdx = 0; oIdx < solution[rA].length && !improved; oIdx++) {
        const nodeToMove = solution[rA][oIdx];
        if (isNodeLocked(nodeToMove, ordersMap, limits)) continue;
        const newRouteA = solution[rA].filter((_, idx) => idx !== oIdx);

        for (const rB of nearbyRoutes(nodeToMove, solution, routeOf, matrix)) {
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
      }
    }
  }

  return solution;
}

/**
 * Inter-Route Swap:
 * Exchanges two nearby orders between routes (each re-inserted at its best position).
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

  while (improved && iterations < config.interRouteMaxIterations && !timeUp()) {
    improved = false;
    iterations++;
    const routeOf = routeIndexOf(solution);

    for (let rA = 0; rA < solution.length && !improved; rA++) {
      if (isRouteLocked(solution[rA], ordersMap, limits)) continue;

      for (let i = 0; i < solution[rA].length && !improved; i++) {
        const nodeA = solution[rA][i];
        if (isNodeLocked(nodeA, ordersMap, limits)) continue;
        const neighbours = matrix.getNeighbors(nodeA);

        for (let k = 0; k < neighbours.length; k++) {
          const nodeB = neighbours[k];
          const rB = routeOf.get(nodeB);
          if (rB === undefined || rB === rA || isRouteLocked(solution[rB], ordersMap, limits)) continue;
          if (isNodeLocked(nodeB, ordersMap, limits)) continue;

          const restA = solution[rA].filter(n => n !== nodeA);
          const restB = solution[rB].filter(n => n !== nodeB);
          const insB = findBestInsertion(restA, nodeB, ordersMap, matrix, limits, config);
          if (!insB) continue;
          const insA = findBestInsertion(restB, nodeA, ordersMap, matrix, limits, config);
          if (!insA) continue;

          const candidateSolution = solution.map((r, idx) => {
            if (idx === rA) return insB.newRoute;
            if (idx === rB) return insA.newRoute;
            return r;
          });

          const newScore = evaluateSolutionScore(candidateSolution, ordersMap, matrix, limits, config);
          if (newScore < currentScore - 0.001) {
            // Polish the two changed routes
            candidateSolution[rA] = optimizeRoute2Opt(candidateSolution[rA], ordersMap, matrix, limits, config);
            candidateSolution[rB] = optimizeRoute2Opt(candidateSolution[rB], ordersMap, matrix, limits, config);
            solution = candidateSolution;
            currentScore = evaluateSolutionScore(solution, ordersMap, matrix, limits, config);
            improved = true;
            break;
          }
        }
      }
    }
  }

  return solution;
}

/**
 * Inter-Route 2-Opt* (Two-Opt Star):
 * Swaps tails of two routes so that stop a = A[i] is followed by its neighbour b = B[j+1]:
 * Route A becomes: A[0..i] + B[j+1..end]
 * Route B becomes: B[0..j] + A[i+1..end]
 * Untangles intersecting routes across adjacent geographic corridors.
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
  let improved = true;
  let guard = 0;

  while (improved && guard++ < config.interRouteMaxIterations && !timeUp()) {
    improved = false;
    const routeOf = routeIndexOf(solution);

    for (let rA = 0; rA < solution.length && !improved; rA++) {
      if (solution[rA].length < 2 || isRouteLocked(solution[rA], ordersMap, limits)) continue;

      for (let i = 0; i < solution[rA].length - 1 && !improved; i++) {
        const a = solution[rA][i];
        const neighbours = matrix.getNeighbors(a);

        for (let k = 0; k < neighbours.length && !improved; k++) {
          const b = neighbours[k];
          const rB = routeOf.get(b);
          if (rB === undefined || rB === rA) continue;
          if (solution[rB].length < 2 || isRouteLocked(solution[rB], ordersMap, limits)) continue;
          const j = solution[rB].indexOf(b) - 1;
          if (j < 0) continue;

          const tailA = solution[rA].slice(i + 1);
          const tailB = solution[rB].slice(j + 1);
          if (tailA.some(n => isNodeLocked(n, ordersMap, limits)) || tailB.some(n => isNodeLocked(n, ordersMap, limits))) {
            continue;
          }

          const candPairs = [
            { a: [...solution[rA].slice(0, i + 1), ...tailB], b: [...solution[rB].slice(0, j + 1), ...tailA] },
            { a: [...solution[rA].slice(0, i + 1), ...tailB.slice().reverse()], b: [...solution[rB].slice(0, j + 1), ...tailA.slice().reverse()] }
          ];

          for (const pair of candPairs) {
            if (pair.a.length === 0 || pair.b.length === 0) continue;
            const ordersA = pair.a.map(idx => ordersMap[idx - 1]).filter(Boolean);
            const ordersB = pair.b.map(idx => ordersMap[idx - 1]).filter(Boolean);
            if (!checkHardLimits(ordersA, limits) || !checkHardLimits(ordersB, limits)) continue;

            const candidate = solution.map((r, idx) => (idx === rA ? pair.a : idx === rB ? pair.b : r));
            const candScore = evaluateSolutionScore(candidate, ordersMap, matrix, limits, config);
            if (candScore < currentScore - 0.002) {
              candidate[rA] = optimizeRoute2Opt(candidate[rA], ordersMap, matrix, limits, config);
              candidate[rB] = optimizeRoute2Opt(candidate[rB], ordersMap, matrix, limits, config);
              solution = candidate;
              currentScore = evaluateSolutionScore(solution, ordersMap, matrix, limits, config);
              improved = true;
              break;
            }
          }
        }
      }
    }
  }

  return solution;
}

/**
 * Inter-Route Cross-Exchange:
 * Swaps consecutive blocks of 2 stops between routes, starting from neighbouring stops.
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
  let improved = true;
  let guard = 0;

  while (improved && guard++ < config.interRouteMaxIterations && !timeUp()) {
    improved = false;
    const routeOf = routeIndexOf(solution);

    for (let rA = 0; rA < solution.length && !improved; rA++) {
      if (solution[rA].length < 3 || isRouteLocked(solution[rA], ordersMap, limits)) continue;

      for (let i = 0; i <= solution[rA].length - 2 && !improved; i++) {
        const neighbours = matrix.getNeighbors(solution[rA][i]);

        for (let k = 0; k < neighbours.length && !improved; k++) {
          const rB = routeOf.get(neighbours[k]);
          if (rB === undefined || rB === rA) continue;
          if (solution[rB].length < 3 || isRouteLocked(solution[rB], ordersMap, limits)) continue;
          const j = solution[rB].indexOf(neighbours[k]);
          if (j > solution[rB].length - 2) continue;

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

          const candidate = solution.map((r, idx) => (idx === rA ? newA : idx === rB ? newB : r));
          const newScore = evaluateSolutionScore(candidate, ordersMap, matrix, limits, config);
          if (newScore < currentScore - 0.003) {
            candidate[rA] = optimizeRoute2Opt(candidate[rA], ordersMap, matrix, limits, config);
            candidate[rB] = optimizeRoute2Opt(candidate[rB], ordersMap, matrix, limits, config);
            solution = candidate;
            currentScore = evaluateSolutionScore(solution, ordersMap, matrix, limits, config);
            improved = true;
          }
        }
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
  const polish = (r: number[]) => {
    let opt = optimizeRoute2Opt(r, ordersMap, matrix, limits, config);
    opt = optimizeRouteOrOpt(opt, ordersMap, matrix, limits, config);
    if (config.enableThreeOpt) opt = optimizeRoute3Opt(opt, ordersMap, matrix, limits, config);
    return opt;
  };

  // Step 1: Polish each route internally
  let current = routes.map(polish);

  // Steps 2-5: inter-route neighbourhoods
  current = optimizeInterRouteRelocate(current, ordersMap, matrix, limits, config);
  current = optimizeInterRouteSwap(current, ordersMap, matrix, limits, config);
  current = optimizeInterRouteTwoOptStar(current, ordersMap, matrix, limits, config);
  current = optimizeInterRouteCrossExchange(current, ordersMap, matrix, limits, config);

  // Step 6: Final intra-route polish
  current = current.map(r => optimizeRouteOrOpt(optimizeRoute2Opt(r, ordersMap, matrix, limits, config), ordersMap, matrix, limits, config));

  return current.filter(r => r.length > 0);
}
