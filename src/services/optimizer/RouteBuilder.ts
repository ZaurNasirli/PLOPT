import { Order } from '../../types';
import { RoutingLimits } from '../routingService';
import { calculateDistance } from '../routingService';
import { RoadMatrixLookup } from './DistanceMatrix';
import { SmartVRPConfig } from './types';
import { checkHardLimits, getRouteCapacities, parseTimeSlot, evaluateRouteSchedule } from './ConstraintValidator';
import { buildCapacityAwareClusters } from './Clustering';
import { 
  getDepotAngle, 
  getAngleDiff, 
  evaluateDirectionalCompactness, 
  evaluateRegionMixingScore 
} from './ObjectiveFunction';

export interface BestInsertionResult {
  bestIndex: number;
  insertionCost: number;
  newRoute: number[];
}

/**
 * Post-processes routes to ensure orders in `limits.mustStayTogether` groups are placed in the same route
 * whenever capacity limits allow.
 */
export function enforceMustStayTogether(
  routes: number[][],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[][] {
  if (!limits.mustStayTogether || limits.mustStayTogether.length === 0) {
    return routes;
  }

  let updatedRoutes = routes.map(r => [...r]).filter(r => r.length > 0);

  for (const group of limits.mustStayTogether) {
    if (!group || group.length < 2) continue;

    // Find 1-based indices for orders in this group
    const groupNodes: number[] = [];
    for (let i = 0; i < ordersMap.length; i++) {
      if (group.includes(ordersMap[i].id)) {
        groupNodes.push(i + 1);
      }
    }
    if (groupNodes.length < 2) continue;

    // Locate which route currently holds the most members of this group
    let anchorRouteIdx = -1;
    let maxMembers = 0;
    for (let rIdx = 0; rIdx < updatedRoutes.length; rIdx++) {
      const count = updatedRoutes[rIdx].filter(n => groupNodes.includes(n)).length;
      if (count > maxMembers) {
        maxMembers = count;
        anchorRouteIdx = rIdx;
      }
    }

    if (anchorRouteIdx === -1) continue;

    // Try moving all other group members into anchorRouteIdx
    for (const node of groupNodes) {
      if (updatedRoutes[anchorRouteIdx].includes(node)) continue;

      const sourceRouteIdx = updatedRoutes.findIndex(r => r.includes(node));
      if (sourceRouteIdx === -1 || sourceRouteIdx === anchorRouteIdx) continue;

      const ins = findBestInsertion(
        updatedRoutes[anchorRouteIdx],
        node,
        ordersMap,
        matrix,
        limits,
        config
      );

      if (ins) {
        updatedRoutes[anchorRouteIdx] = ins.newRoute;
        updatedRoutes[sourceRouteIdx] = updatedRoutes[sourceRouteIdx].filter(n => n !== node);
      }
    }
  }

  return updatedRoutes.filter(r => r.length > 0);
}

/**
 * Computes multi-attribute insertion cost of adding candidate node into route at position p.
 * InsertionCost =
 *   distIncrease
 *   + durationIncrease * 0.5
 *   + capacityPenalty
 *   + geographicPenalty
 *   + directionPenalty
 *   + regionPenalty
 *   + timeWindowPenalty
 */
export function evaluateInsertionCost(
  route: number[],
  pos: number,
  candidateNode: number,
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number {
  // 1. Distance & Duration delta
  const prevNode = pos === 0 ? 0 : route[pos - 1];
  const nextNode = pos === route.length ? 0 : route[pos];

  const currentEdgeDist = matrix.getDistance(prevNode, nextNode);
  const newEdgeDist1 = matrix.getDistance(prevNode, candidateNode);
  const newEdgeDist2 = matrix.getDistance(candidateNode, nextNode);
  const deltaDist = (newEdgeDist1 + newEdgeDist2) - currentEdgeDist;

  const currentEdgeDur = matrix.getDuration(prevNode, nextNode);
  const newEdgeDur1 = matrix.getDuration(prevNode, candidateNode);
  const newEdgeDur2 = matrix.getDuration(candidateNode, nextNode);
  const deltaDur = (newEdgeDur1 + newEdgeDur2) - currentEdgeDur;

  // 2. Capacity & utilization penalty
  const candidateOrder = ordersMap[candidateNode - 1];
  if (!candidateOrder) return Infinity;
  const routeOrders = route.map(idx => ordersMap[idx - 1]).filter(Boolean);
  const newOrders = [...routeOrders.slice(0, pos), candidateOrder, ...routeOrders.slice(pos)];

  if (!checkHardLimits(newOrders, limits)) {
    return Infinity;
  }

  const candidateRoute = [...route.slice(0, pos), candidateNode, ...route.slice(pos)];
  if (limits.timeWindowMode === 'hard' && candidateRoute.length > 1) {
    const sched = evaluateRouteSchedule(
      candidateRoute,
      matrix,
      ordersMap,
      limits.serviceTimeMinutes ?? config.defaultServiceTimeMinutes ?? 10,
      (config.depotStartHour ?? 8) * 60
    );
    if (sched.violationsCount > 0) {
      return Infinity;
    }
  }

  const { maxW, maxV } = getRouteCapacities(newOrders, limits);
  const totalW = newOrders.reduce((s, o) => s + o.weight, 0);
  const totalV = newOrders.reduce((s, o) => s + o.volume, 0);
  const peakUtil = Math.max(maxW > 0 ? totalW / maxW : 0.8, maxV > 0 ? totalV / maxV : 0.8);

  // Preference for filling trucks towards 80-95%
  const underloadPenalty = peakUtil < 0.70 ? (0.70 - peakUtil) * 8.0 : 0;

  // 3. Directional penalty: angle difference to route mean angle
  let dirPenalty = 0;
  if (route.length > 0) {
    const candidateAngle = getDepotAngle(candidateOrder.lat, candidateOrder.lng);
    const routeAngles = routeOrders.map(o => getDepotAngle(o.lat, o.lng));
    const meanAngle = routeAngles.reduce((s, a) => s + a, 0) / routeAngles.length;
    const angleDiff = getAngleDiff(candidateAngle, meanAngle);
    if (angleDiff > Math.PI / 4) {
      dirPenalty = Math.pow(angleDiff - Math.PI / 4, 2) * 20.0;
    }
  }

  // 4. Region consistency penalty
  let regionPenalty = 0;
  if (prevNode > 0) {
    const prevOrder = ordersMap[prevNode - 1];
    if (prevOrder && prevOrder.region !== candidateOrder.region) {
      const d = calculateDistance(prevOrder.lat, prevOrder.lng, candidateOrder.lat, candidateOrder.lng);
      regionPenalty += d > 3.5 ? 4.0 : 0.5;
    }
  }
  if (nextNode > 0) {
    const nextOrder = ordersMap[nextNode - 1];
    if (nextOrder && nextOrder.region !== candidateOrder.region) {
      const d = calculateDistance(candidateOrder.lat, candidateOrder.lng, nextOrder.lat, nextOrder.lng);
      regionPenalty += d > 3.5 ? 4.0 : 0.5;
    }
  }

  // 5. Time window penalty (soft)
  let twPenalty = 0;
  if (candidateOrder.timeSlot && prevNode > 0) {
    const prevOrder = ordersMap[prevNode - 1];
    if (prevOrder && prevOrder.timeSlot) {
      const twPrev = parseTimeSlot(prevOrder.timeSlot);
      const twCand = parseTimeSlot(candidateOrder.timeSlot);
      if (twPrev.endMinutes < twCand.startMinutes - 180) {
        twPenalty += 2.0; // Big gap between delivery windows
      } else if (twCand.endMinutes < twPrev.startMinutes) {
        twPenalty += 5.0; // Inverted delivery windows
      }
    }
  }

  // Bonus if candidate shares a mustStayTogether group with an order already in this route
  let groupBonus = 0;
  if (limits.mustStayTogether && limits.mustStayTogether.length > 0) {
    for (const grp of limits.mustStayTogether) {
      if (grp.includes(candidateOrder.id) && routeOrders.some(o => grp.includes(o.id))) {
        groupBonus = -15.0;
        break;
      }
    }
  }

  const cost =
    config.distanceWeight * deltaDist +
    config.durationWeight * (deltaDur * 0.4) +
    config.capacityUtilizationWeight * underloadPenalty +
    config.geographicCompactnessWeight * dirPenalty +
    config.regionConsistencyWeight * regionPenalty +
    config.timeWindowWeight * twPenalty +
    groupBonus;

  return cost;
}

/**
 * Finds best insertion position for a candidate node in an existing route.
 */
export function findBestInsertion(
  route: number[],
  candidateNode: number,
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): BestInsertionResult | null {
  let bestIndex = -1;
  let minCost = Infinity;

  for (let p = 0; p <= route.length; p++) {
    const cost = evaluateInsertionCost(route, p, candidateNode, ordersMap, matrix, limits, config);
    if (cost < minCost) {
      minCost = cost;
      bestIndex = p;
    }
  }

  if (bestIndex === -1 || minCost === Infinity) return null;

  const newRoute = [...route.slice(0, bestIndex), candidateNode, ...route.slice(bestIndex)];
  return {
    bestIndex,
    insertionCost: minCost,
    newRoute
  };
}

// ==========================================
// SEED GENERATORS FOR MULTI-START VRP
// ==========================================

/**
 * Seed 1: Geographic Corridor Seed (Capacity-aware sector partitioning)
 */
export function buildGeographicCorridorSeed(
  orderIndices: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[][] {
  const clusters = buildCapacityAwareClusters(orderIndices, ordersMap, matrix, limits);
  const routes: number[][] = [];

  for (const cluster of clusters) {
    const unassigned = [...cluster];

    while (unassigned.length > 0) {
      // Anchor with farthest point in cluster from depot
      let farthestIdx = 0;
      let maxDist = -1;
      for (let i = 0; i < unassigned.length; i++) {
        const d = matrix.getDistance(0, unassigned[i]);
        if (d > maxDist) {
          maxDist = d;
          farthestIdx = i;
        }
      }

      const seedNode = unassigned.splice(farthestIdx, 1)[0];
      let currentRoute: number[] = [seedNode];

      let added = true;
      while (added && unassigned.length > 0) {
        added = false;
        let bestCandidateIdx = -1;
        let bestIns: BestInsertionResult | null = null;
        let lowestCost = Infinity;

        for (let i = 0; i < unassigned.length; i++) {
          const candidate = unassigned[i];
          const ins = findBestInsertion(currentRoute, candidate, ordersMap, matrix, limits, config);
          if (ins && ins.insertionCost < lowestCost) {
            lowestCost = ins.insertionCost;
            bestCandidateIdx = i;
            bestIns = ins;
          }
        }

        if (bestIns && bestCandidateIdx !== -1) {
          currentRoute = bestIns.newRoute;
          unassigned.splice(bestCandidateIdx, 1);
          added = true;
        }
      }

      routes.push(currentRoute);
    }
  }

  return routes;
}

/**
 * Seed 2: Farthest-Point Seed (Classic VRP heuristic)
 */
export function buildFarthestPointSeed(
  orderIndices: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[][] {
  const unassigned = [...orderIndices];
  const routes: number[][] = [];

  while (unassigned.length > 0) {
    // Pick unassigned stop that is farthest from depot
    let maxDist = -1;
    let farthestIdx = 0;
    for (let i = 0; i < unassigned.length; i++) {
      const d = matrix.getDistance(0, unassigned[i]);
      if (d > maxDist) {
        maxDist = d;
        farthestIdx = i;
      }
    }

    const seed = unassigned.splice(farthestIdx, 1)[0];
    let currentRoute: number[] = [seed];

    let added = true;
    while (added && unassigned.length > 0) {
      added = false;
      let bestCandidateIdx = -1;
      let bestIns: BestInsertionResult | null = null;
      let lowestCost = Infinity;

      for (let i = 0; i < unassigned.length; i++) {
        const candidate = unassigned[i];
        const ins = findBestInsertion(currentRoute, candidate, ordersMap, matrix, limits, config);
        if (ins && ins.insertionCost < lowestCost) {
          lowestCost = ins.insertionCost;
          bestCandidateIdx = i;
          bestIns = ins;
        }
      }

      if (bestIns && bestCandidateIdx !== -1) {
        currentRoute = bestIns.newRoute;
        unassigned.splice(bestCandidateIdx, 1);
        added = true;
      }
    }

    routes.push(currentRoute);
  }

  return routes;
}

/**
 * Seed 3: Nearest Neighbor Seed (Sequential road-distance greedy)
 */
export function buildNearestNeighborSeed(
  orderIndices: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[][] {
  const unassigned = new Set(orderIndices);
  const routes: number[][] = [];

  while (unassigned.size > 0) {
    // Start from depot, pick closest unvisited stop
    let closestNode = -1;
    let minDepotDist = Infinity;
    unassigned.forEach(node => {
      const d = matrix.getDistance(0, node);
      if (d < minDepotDist) {
        minDepotDist = d;
        closestNode = node;
      }
    });

    if (closestNode === -1) break;
    unassigned.delete(closestNode);
    let currentRoute: number[] = [closestNode];

    let currentNode = closestNode;
    let expanded = true;

    while (expanded && unassigned.size > 0) {
      expanded = false;
      let nextNode = -1;
      let minDistance = Infinity;

      // Check nearest neighbors
      const neighbors = matrix.getNeighbors(currentNode);
      for (let i = 0; i < neighbors.length; i++) {
        const candidate = neighbors[i];
        if (!unassigned.has(candidate)) continue;

        const candidateOrder = ordersMap[candidate - 1];
        const currentOrders = currentRoute.map(idx => ordersMap[idx - 1]).filter(Boolean);
        if (checkHardLimits([...currentOrders, candidateOrder], limits)) {
          const d = matrix.getDistance(currentNode, candidate);
          if (d < minDistance) {
            minDistance = d;
            nextNode = candidate;
          }
        }
      }

      // If no pre-computed neighbor candidate fits, search all unassigned
      if (nextNode === -1) {
        unassigned.forEach(candidate => {
          const candidateOrder = ordersMap[candidate - 1];
          const currentOrders = currentRoute.map(idx => ordersMap[idx - 1]).filter(Boolean);
          if (checkHardLimits([...currentOrders, candidateOrder], limits)) {
            const d = matrix.getDistance(currentNode, candidate);
            if (d < minDistance) {
              minDistance = d;
              nextNode = candidate;
            }
          }
        });
      }

      if (nextNode !== -1) {
        currentRoute.push(nextNode);
        unassigned.delete(nextNode);
        currentNode = nextNode;
        expanded = true;
      }
    }

    routes.push(currentRoute);
  }

  return routes;
}

/**
 * Seed 4: Capacity-First Seed (Anchors routes with highest volume/weight customers)
 */
export function buildCapacityFirstSeed(
  orderIndices: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number[][] {
  // Sort orders descending by total demand (volume + weight/100)
  const unassigned = [...orderIndices].sort((a, b) => {
    const oA = ordersMap[a - 1];
    const oB = ordersMap[b - 1];
    const demA = (oA?.volume || 0) + (oA?.weight || 0) / 100;
    const demB = (oB?.volume || 0) + (oB?.weight || 0) / 100;
    return demB - demA;
  });

  const routes: number[][] = [];

  while (unassigned.length > 0) {
    const seed = unassigned.shift()!;
    let currentRoute: number[] = [seed];

    let added = true;
    while (added && unassigned.length > 0) {
      added = false;
      let bestCandidateIdx = -1;
      let bestIns: BestInsertionResult | null = null;
      let lowestCost = Infinity;

      for (let i = 0; i < unassigned.length; i++) {
        const candidate = unassigned[i];
        const ins = findBestInsertion(currentRoute, candidate, ordersMap, matrix, limits, config);
        if (ins && ins.insertionCost < lowestCost) {
          lowestCost = ins.insertionCost;
          bestCandidateIdx = i;
          bestIns = ins;
        }
      }

      if (bestIns && bestCandidateIdx !== -1) {
        currentRoute = bestIns.newRoute;
        unassigned.splice(bestCandidateIdx, 1);
        added = true;
      }
    }

    routes.push(currentRoute);
  }

  return routes;
}

/**
 * Seed 5: Randomized Greedy Seed (Semi-random top-3 insertion for stochastic escape)
 */
export function buildRandomizedSeed(
  orderIndices: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig,
  randomSeed: number = 42
): number[][] {
  // Deterministic pseudo-random generator
  let state = randomSeed;
  const nextRand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };

  const unassigned = [...orderIndices];
  // Shuffle slightly
  for (let i = unassigned.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand() * (i + 1));
    [unassigned[i], unassigned[j]] = [unassigned[j], unassigned[i]];
  }

  const routes: number[][] = [];

  while (unassigned.length > 0) {
    const seed = unassigned.shift()!;
    let currentRoute: number[] = [seed];

    let added = true;
    while (added && unassigned.length > 0) {
      added = false;
      const candidates: { idx: number; ins: BestInsertionResult }[] = [];

      for (let i = 0; i < unassigned.length; i++) {
        const node = unassigned[i];
        const ins = findBestInsertion(currentRoute, node, ordersMap, matrix, limits, config);
        if (ins) {
          candidates.push({ idx: i, ins });
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => a.ins.insertionCost - b.ins.insertionCost);
        // Pick among top 3
        const pickPoolSize = Math.min(3, candidates.length);
        const pickIdx = Math.floor(nextRand() * pickPoolSize);
        const chosen = candidates[pickIdx];

        currentRoute = chosen.ins.newRoute;
        unassigned.splice(chosen.idx, 1);
        added = true;
      }
    }

    routes.push(currentRoute);
  }

  return routes;
}
