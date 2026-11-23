import { Order } from '../../types';
import { RoutingLimits } from '../routingService';
import { RoadMatrixLookup } from './DistanceMatrix';
import { SmartVRPConfig } from './types';
import { checkHardLimits, getRouteCapacities } from './ConstraintValidator';
import { evaluateSolutionScore } from './ObjectiveFunction';
import { optimizeRoute2Opt, optimizeRouteOrOpt } from './LocalSearch';
import { findBestInsertion } from './RouteBuilder';

function isRouteLocked(route: number[], ordersMap: Order[], limits: RoutingLimits): boolean {
  if (!route || route.length === 0) return false;
  // If route contains any locked stops, it cannot be merged or eliminated
  if (limits.lockedStops) {
    const hasLocked = route.some(n => {
      const o = ordersMap[n - 1];
      return Boolean(o && limits.lockedStops && limits.lockedStops[o.id]);
    });
    if (hasLocked) return true;
  }
  // If route belongs to a locked route ID
  if (limits.lockedRoutes && limits.lockedRoutes.length > 0) {
    const hasLockedRoute = route.some(n => {
      const o = ordersMap[n - 1];
      return Boolean(o && o.routeId && limits.lockedRoutes && limits.lockedRoutes.includes(o.routeId));
    });
    if (hasLockedRoute) return true;
  }
  return false;
}

function hasLockedNodes(nodes: number[], ordersMap: Order[], limits: RoutingLimits): boolean {
  return isRouteLocked(nodes, ordersMap, limits);
}

/**
 * Route Merge:
 * Attempts to consolidate two small or adjacent routes into one.
 * Saves an entire vehicle while verifying hard limits and detour constraints.
 */
export function optimizeRouteMerge(
  routes: number[][],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[][] {
  let solution = routes.filter(r => r.length > 0).map(r => [...r]);
  if (solution.length <= 1) return solution;

  let currentScore = evaluateSolutionScore(solution, ordersMap, matrix, limits, config);
  let merged = true;

  while (merged && solution.length > 1) {
    merged = false;

    for (let i = 0; i < solution.length - 1; i++) {
      if (isRouteLocked(solution[i], ordersMap, limits)) continue;
      for (let j = i + 1; j < solution.length; j++) {
        if (isRouteLocked(solution[j], ordersMap, limits)) continue;
        const combined = [...solution[i], ...solution[j]];
        const combinedOrders = combined.map(idx => ordersMap[idx - 1]).filter(Boolean);

        if (!checkHardLimits(combinedOrders, limits)) continue;

        let optCombined = optimizeRoute2Opt(combined, ordersMap, matrix, limits, config);
        optCombined = optimizeRouteOrOpt(optCombined, ordersMap, matrix, limits, config);

        const candidateSolution = solution.filter((_, idx) => idx !== i && idx !== j);
        candidateSolution.push(optCombined);

        const newScore = evaluateSolutionScore(candidateSolution, ordersMap, matrix, limits, config);
        if (newScore < currentScore - 0.001) {
          solution = candidateSolution;
          currentScore = newScore;
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }

  return solution;
}

/**
 * Route Split:
 * If a route has high detour or stop count > 15, tests splitting it into two compact clusters.
 */
export function optimizeRouteSplit(
  routes: number[][],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[][] {
  let solution = routes.filter(r => r.length > 0).map(r => [...r]);
  let currentScore = evaluateSolutionScore(solution, ordersMap, matrix, limits, config);

  for (let rIdx = 0; rIdx < solution.length; rIdx++) {
    if (isRouteLocked(solution[rIdx], ordersMap, limits)) continue;
    const route = solution[rIdx];
    if (route.length < 10) continue; // Only split sufficiently large routes

    // Try splitting route around median radial distance or sequence cut
    const mid = Math.floor(route.length / 2);
    const splitOptions = [
      { a: route.slice(0, mid), b: route.slice(mid) },
      // Geographic radial cut: near stops vs far stops
      (() => {
        const sorted = [...route].sort((a, b) => matrix.getDistance(0, a) - matrix.getDistance(0, b));
        const radMid = Math.floor(sorted.length / 2);
        return { a: sorted.slice(0, radMid), b: sorted.slice(radMid) };
      })()
    ];

    for (const opt of splitOptions) {
      const ordersA = opt.a.map(idx => ordersMap[idx - 1]).filter(Boolean);
      const ordersB = opt.b.map(idx => ordersMap[idx - 1]).filter(Boolean);

      if (!checkHardLimits(ordersA, limits) || !checkHardLimits(ordersB, limits)) continue;

      const optA = optimizeRoute2Opt(opt.a, ordersMap, matrix, limits, config);
      const optB = optimizeRoute2Opt(opt.b, ordersMap, matrix, limits, config);

      const candidate = solution.filter((_, idx) => idx !== rIdx);
      candidate.push(optA, optB);

      const newScore = evaluateSolutionScore(candidate, ordersMap, matrix, limits, config);
      // Only accept split if score noticeably improves (justifying extra vehicle)
      if (newScore < currentScore - 0.02) {
        solution = candidate;
        currentScore = newScore;
        break;
      }
    }
  }

  return solution;
}

/**
 * Underutilized Route Elimination:
 * Identifies severely underutilized routes (e.g. <25% load) and attempts to disperse their stops
 * into neighboring routes.
 */
export function eliminateUnderutilizedRoutes(
  routes: number[][],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[][] {
  let solution = routes.filter(r => r.length > 0).map(r => [...r]);
  if (solution.length <= 1) return solution;

  let changed = true;
  while (changed && solution.length > 1) {
    changed = false;
    let currentScore = evaluateSolutionScore(solution, ordersMap, matrix, limits, config);

    // Compute peak utilization for each route
    const routeStats = solution.map((r, idx) => {
      const routeOrders = r.map(i => ordersMap[i - 1]).filter(Boolean);
      const { maxW, maxV } = getRouteCapacities(routeOrders, limits);
      const totalW = routeOrders.reduce((s, o) => s + o.weight, 0);
      const totalV = routeOrders.reduce((s, o) => s + o.volume, 0);
      const util = Math.max(maxW > 0 ? totalW / maxW : 0.8, maxV > 0 ? totalV / maxV : 0.8);
      return { idx, route: r, util };
    });

    routeStats.sort((a, b) => a.util - b.util);

    for (const target of routeStats) {
      if (isRouteLocked(target.route, ordersMap, limits)) continue;
      // Only attempt to eliminate routes with utilization below target threshold
      if (target.util > config.underutilizedModerateThreshold && target.route.length > 3) continue;

      const otherRoutes = solution.filter((_, i) => i !== target.idx).map(r => [...r]);
      const stopsToDistribute = [...target.route];
      let allPlaced = true;

      for (const node of stopsToDistribute) {
        let bestR = -1;
        let minCost = Infinity;
        let bestNewRoute: number[] | null = null;

        for (let r = 0; r < otherRoutes.length; r++) {
          const ins = findBestInsertion(otherRoutes[r], node, ordersMap, matrix, limits, config);
          if (ins && ins.insertionCost < minCost) {
            minCost = ins.insertionCost;
            bestR = r;
            bestNewRoute = ins.newRoute;
          }
        }

        if (bestNewRoute && bestR !== -1) {
          otherRoutes[bestR] = bestNewRoute;
        } else {
          allPlaced = false;
          break;
        }
      }

      if (allPlaced) {
        const candidate = otherRoutes.map(r => optimizeRoute2Opt(r, ordersMap, matrix, limits, config));
        const newScore = evaluateSolutionScore(candidate, ordersMap, matrix, limits, config);

        // Accept if score improves or is within slight margin due to eliminating a full truck
        if (newScore < currentScore + 0.005) {
          solution = candidate;
          currentScore = newScore;
          changed = true;
          break;
        }
      }
    }
  }

  return solution;
}
