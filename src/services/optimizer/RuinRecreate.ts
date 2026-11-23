import { Order } from '../../types';
import type { RoutingLimits } from '../routingService';
import { RoadMatrixLookup } from './RoadMatrix';
import { SmartVRPConfig } from './types';
import { evaluateSolutionScore } from './ObjectiveFunction';
import { findBestInsertion } from './RouteBuilder';
import { optimizeRoute2Opt } from './LocalSearch';
import { timeUp, createRng } from './searchControl';

/**
 * Large Neighbourhood Search ("ruin & recreate").
 *
 * Each iteration removes a part of the solution and re-inserts the removed stops greedily:
 *   - related ruin: a random stop and its nearest neighbours (the most effective operator for VRP)
 *   - random ruin: random stops anywhere
 *   - route ruin: a whole (preferably under-loaded) route, which lets the fleet shrink
 *   - worst ruin: the stops whose removal saves the most distance
 * The new solution is accepted with a simulated-annealing rule (temperature falls to zero by
 * the deadline), and the best solution ever seen is returned.
 */
export interface RuinRecreateOptions {
  deadline: number;
  seed?: number;
  onProgress?: (fraction: number, message: string) => void;
}

export interface RuinRecreateStats {
  iterations: number;
  improvements: number;
  startScore: number;
  bestScore: number;
}

export function runRuinAndRecreate(
  initial: number[][],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig,
  options: RuinRecreateOptions
): { solution: number[][]; stats: RuinRecreateStats } {
  const rng = createRng(options.seed ?? 12345);
  const startTime = Date.now();
  const totalTime = Math.max(1, options.deadline - startTime);

  const lockedNode = (node: number) => {
    const o = ordersMap[node - 1];
    if (!o) return true;
    if (limits.lockedStops && limits.lockedStops[o.id]) return true;
    return Boolean(o.routeId && limits.lockedRoutes && limits.lockedRoutes.includes(o.routeId));
  };

  let current = initial.filter(r => r.length > 0).map(r => [...r]);
  let currentScore = evaluateSolutionScore(current, ordersMap, matrix, limits, config);
  let best = current;
  let bestScore = currentScore;
  const stats: RuinRecreateStats = { iterations: 0, improvements: 0, startScore: currentScore, bestScore };

  const allNodes = current.flat().filter(n => !lockedNode(n));
  if (allNodes.length < 3 || !Number.isFinite(currentScore)) {
    return { solution: best, stats };
  }

  // Temperature: a worse solution by ~1% of the score is accepted with ~37% chance at the start
  const t0 = Math.max(0.0005, currentScore * 0.01);

  while (!timeUp() && Date.now() < options.deadline) {
    stats.iterations++;
    const progress = (Date.now() - startTime) / totalTime;
    const temperature = t0 * Math.max(0, 1 - progress);

    // ---- Ruin ----
    const routes = current.map(r => [...r]);
    const removeCount = Math.max(2, Math.min(40, allNodes.length - 1, Math.round(allNodes.length * (0.05 + rng() * 0.15))));
    const removed = new Set<number>();
    const op = rng();

    if (op < 0.5) {
      // related: seed + nearest neighbours (and their neighbours)
      const seed = allNodes[Math.floor(rng() * allNodes.length)];
      const queue = [seed];
      while (queue.length > 0 && removed.size < removeCount) {
        const node = queue.shift()!;
        if (removed.has(node) || lockedNode(node)) continue;
        removed.add(node);
        const nb = matrix.getNeighbors(node);
        for (let k = 0; k < nb.length && k < 6; k++) if (!removed.has(nb[k])) queue.push(nb[k]);
      }
    } else if (op < 0.7) {
      // random
      while (removed.size < removeCount) removed.add(allNodes[Math.floor(rng() * allNodes.length)]);
    } else if (op < 0.85 && routes.length > 1) {
      // route: pick among the 3 smallest routes
      const candidates = routes
        .map((r, i) => ({ i, size: r.length }))
        .filter(x => routes[x.i].every(n => !lockedNode(n)))
        .sort((a, b) => a.size - b.size)
        .slice(0, 3);
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(rng() * candidates.length)];
        routes[pick.i].forEach(n => removed.add(n));
      }
    } else {
      // worst: largest distance saving when removed (with noise)
      const savings: { node: number; gain: number }[] = [];
      for (const r of routes) {
        for (let p = 0; p < r.length; p++) {
          if (lockedNode(r[p])) continue;
          const prev = p === 0 ? 0 : r[p - 1];
          const next = p === r.length - 1 ? 0 : r[p + 1];
          const gain = matrix.getDistance(prev, r[p]) + matrix.getDistance(r[p], next) - matrix.getDistance(prev, next);
          savings.push({ node: r[p], gain: gain * (0.8 + rng() * 0.4) });
        }
      }
      savings.sort((a, b) => b.gain - a.gain).slice(0, removeCount).forEach(s => removed.add(s.node));
    }
    if (removed.size === 0) continue;

    let partial = routes.map(r => r.filter(n => !removed.has(n))).filter(r => r.length > 0);

    // ---- Recreate ----
    const toInsert = Array.from(removed);
    const order = rng();
    if (order < 0.4) {
      toInsert.sort(() => rng() - 0.5);
    } else if (order < 0.7) {
      toInsert.sort((a, b) => matrix.getDistance(0, b) - matrix.getDistance(0, a)); // far first
    } else {
      toInsert.sort((a, b) => (ordersMap[b - 1]?.volume || 0) - (ordersMap[a - 1]?.volume || 0)); // big first
    }

    const touched = new Set<number>();
    for (const node of toInsert) {
      let bestRoute = -1;
      let bestCost = Infinity;
      let bestNewRoute: number[] | null = null;
      for (let r = 0; r < partial.length; r++) {
        const ins = findBestInsertion(partial[r], node, ordersMap, matrix, limits, config);
        if (ins && ins.insertionCost < bestCost) {
          bestCost = ins.insertionCost;
          bestRoute = r;
          bestNewRoute = ins.newRoute;
        }
      }
      if (bestNewRoute) {
        partial[bestRoute] = bestNewRoute;
        touched.add(bestRoute);
      } else {
        partial.push([node]);
        touched.add(partial.length - 1);
      }
    }

    // Quick intra-route polish of changed routes
    partial = partial.map((r, i) => (touched.has(i) && r.length >= 3 ? optimizeRoute2Opt(r, ordersMap, matrix, limits, config) : r));

    // ---- Accept ----
    const score = evaluateSolutionScore(partial, ordersMap, matrix, limits, config);
    if (!Number.isFinite(score)) continue;
    const delta = score - currentScore;
    if (delta < 0 || (temperature > 0 && rng() < Math.exp(-delta / temperature))) {
      current = partial;
      currentScore = score;
      if (score < bestScore - 1e-9) {
        best = partial;
        bestScore = score;
        stats.improvements++;
      }
    }

    if (options.onProgress && stats.iterations % 50 === 0) {
      options.onProgress(Math.min(1, progress), `LNS: итерация ${stats.iterations}, улучшений ${stats.improvements}`);
    }
  }

  stats.bestScore = bestScore;
  return { solution: best, stats };
}
