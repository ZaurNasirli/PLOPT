import { Order } from '../../types';
import type { RoutingLimits } from '../routingService';
import { WAREHOUSE_LOCATION } from '../../mockData';
import { calculateDistance } from '../geo';
import { RoadMatrixLookup } from './RoadMatrix';
import { SmartVRPConfig, normaliseWeights } from './types';
import { assignFleet, hasFleetLimits } from './FleetAssignment';
import { 
  checkHardLimits, 
  getRouteCapacities, 
  evaluateRouteSchedule 
} from './ConstraintValidator';

/**
 * Polar angle relative to warehouse in radians [0, 2PI).
 */
export function getDepotAngle(lat: number, lng: number): number {
  const safeLat = Number.isFinite(lat) ? lat : WAREHOUSE_LOCATION.lat;
  const safeLng = Number.isFinite(lng) ? lng : WAREHOUSE_LOCATION.lng;
  const angle = Math.atan2(safeLat - WAREHOUSE_LOCATION.lat, safeLng - WAREHOUSE_LOCATION.lng);
  return angle < 0 ? angle + 2 * Math.PI : angle;
}

/**
 * Minimal angular difference between two angles in radians [0, PI].
 */
export function getAngleDiff(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  let diff = Math.abs(a - b) % (2 * Math.PI);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff;
}

/**
 * Measures directional progression and angular spread of stops along a route.
 * Returns normalized score [0, 1].
 */
export function evaluateDirectionalCompactness(orders: Order[]): number {
  if (orders.length <= 1) return 0;

  const angles = orders.map(o => getDepotAngle(o.lat, o.lng));

  // Angular spread
  let maxSpread = 0;
  for (let i = 0; i < angles.length; i++) {
    for (let j = i + 1; j < angles.length; j++) {
      const diff = getAngleDiff(angles[i], angles[j]);
      if (diff > maxSpread) maxSpread = diff;
    }
  }

  // Count sharp zigzag reversals across opposing directions
  let reversals = 0;
  for (let i = 0; i < orders.length - 2; i++) {
    const a1 = angles[i];
    const a2 = angles[i + 1];
    const a3 = angles[i + 2];
    const d1 = getAngleDiff(a1, a2);
    const d2 = getAngleDiff(a2, a3);
    const dDirect = getAngleDiff(a1, a3);
    if (d1 > Math.PI / 4 && d2 > Math.PI / 4 && dDirect < Math.PI / 6) {
      reversals++;
    }
  }

  // Angular spread penalty: ideal routes stay within ~60-90 degrees sector (<= PI/2)
  let spreadPenalty = 0;
  if (maxSpread > Math.PI / 2) {
    spreadPenalty = Math.min(1.0, (maxSpread - Math.PI / 2) / (Math.PI / 2));
  }

  const reversalPenalty = Math.min(1.0, reversals * 0.25);
  return Math.min(1.0, spreadPenalty * 0.7 + reversalPenalty * 0.3);
}

/**
 * Evaluates region mixing along a route.
 * Returns normalized score [0, 1].
 */
export function evaluateRegionMixingScore(orders: Order[]): number {
  if (orders.length <= 1) return 0;
  let jumps = 0;
  for (let i = 0; i < orders.length - 1; i++) {
    if (orders[i].region !== orders[i + 1].region) {
      const d = calculateDistance(orders[i].lat, orders[i].lng, orders[i + 1].lat, orders[i + 1].lng);
      if (d > 3.5) {
        jumps += 1;
      } else {
        jumps += 0.2; // Border neighbor
      }
    }
  }
  return Math.min(1.0, jumps / Math.max(1, orders.length - 1));
}

/**
 * Evaluates Detour Ratio for a route of order indices using real road distances.
 * Compares actual road round-trip distance to ideal minimum radial baseline.
 */
export function evaluateRoadDetourRatio(orderIndices: number[], matrix: RoadMatrixLookup): number {
  if (orderIndices.length <= 1) return 1.0;

  const actualDist = matrix.calculateRoundTripDistance(orderIndices);

  // Baseline: round trip to closest depot point + nearest neighbor edge for each stop
  let minDepotDist = Infinity;
  for (const idx of orderIndices) {
    const d = matrix.getDistance(0, idx);
    if (d < minDepotDist) minDepotDist = d;
  }

  let nnSum = 0;
  for (let i = 0; i < orderIndices.length; i++) {
    let minNeighbor = Infinity;
    for (let j = 0; j < orderIndices.length; j++) {
      if (i === j) continue;
      const d = matrix.getDistance(orderIndices[i], orderIndices[j]);
      if (d < minNeighbor) minNeighbor = d;
    }
    nnSum += minNeighbor === Infinity ? 0 : minNeighbor;
  }

  const baselineDist = Math.max(2 * minDepotDist + nnSum * 0.9, 3.0);
  return Math.max(1.0, Math.round((actualDist / baselineDist) * 100) / 100);
}

/**
 * Computes dynamic capacity underutilization score [0, 1].
 * Tiers:
 *   < 20%: critical penalty (0.8 - 1.0)
 *   20% - 35%: moderate penalty (0.4 - 0.75)
 *   35% - 50%: mild penalty (0.1 - 0.35)
 *   > 50%: healthy zone (0.0 - 0.05)
 */
export function evaluateCapacityScore(
  peakUtilization: number,
  config: SmartVRPConfig
): number {
  if (peakUtilization >= config.underutilizedTargetThreshold) {
    // Normal healthy zone: slight preference for higher utilization
    return Math.max(0, (1.0 - peakUtilization) * 0.1);
  }
  if (peakUtilization >= config.underutilizedModerateThreshold) {
    // 35% - 50%: mild penalty
    const range = config.underutilizedTargetThreshold - config.underutilizedModerateThreshold;
    const pos = (config.underutilizedTargetThreshold - peakUtilization) / range;
    return 0.1 + pos * 0.25;
  }
  if (peakUtilization >= config.underutilizedCriticalThreshold) {
    // 20% - 35%: high penalty
    const range = config.underutilizedModerateThreshold - config.underutilizedCriticalThreshold;
    const pos = (config.underutilizedModerateThreshold - peakUtilization) / range;
    return 0.35 + pos * 0.4;
  }
  // < 20%: severe critical penalty
  const pos = (config.underutilizedCriticalThreshold - peakUtilization) / config.underutilizedCriticalThreshold;
  return 0.75 + Math.min(0.25, pos * 0.25);
}

// ---------------------------------------------------------------------------
// Evaluation cache
//
// The local search evaluates the same routes over and over (a candidate solution differs
// from the current one in only two routes). Metrics are cached per route sequence, and the
// parts that depend only on the SET of stops (limits check, capacity, angular spread,
// detour baseline) are cached per sorted set, so reordering moves never recompute them.
// Formulas are unchanged.
// ---------------------------------------------------------------------------

interface SetMetrics {
  feasible: boolean;
  totalW: number;
  totalV: number;
  maxW: number;
  maxV: number;
  spreadPenalty: number;
  detourBaseline: number;
}

interface RouteMetrics {
  set: SetMetrics;
  orders: Order[];
  distKm: number;
  schedule: ReturnType<typeof evaluateRouteSchedule>;
  dirScore: number;
  regionScore: number;
  detourScore: number;
}

interface EvalCache {
  sets: Map<string, SetMetrics>;
  routes: Map<string, RouteMetrics>;
  fleetVolume: number;
  /** Instance constants used to normalise the plan cost (same for every candidate plan) */
  minVehicles: number;
  baselineKm: number;
  baselineMin: number;
  fleetLimited: boolean;
}

/** Default tariffs when the dispatcher left them empty (AZN per trip / per km) */
const DEFAULT_COST_PER_ROUTE = 50;
const DEFAULT_COST_PER_KM = 2;

function computeBaseline(matrix: RoadMatrixLookup, ordersMap: Order[], limits: RoutingLimits, serviceMin: number) {
  const n = Math.min(ordersMap.length, matrix.n - 1);
  const fleetVolume = ordersMap.reduce((s, o) => s + o.volume, 0);
  const maxFleetTruckV = limits.maxVolume > 0
    ? limits.maxVolume
    : (limits.truckTypes && limits.truckTypes.length > 0 ? Math.max(...limits.truckTypes.map(t => t.maxVolume)) : 12);
  const minVehicles = Math.max(1, Math.ceil(fleetVolume / Math.max(0.1, maxFleetTruckV)));

  // A rough lower bound of the plan: every truck goes out and back once, plus each stop's nearest neighbour hop
  let depotKm = 0, depotMin = 0, nnKm = 0, nnMin = 0;
  for (let i = 1; i <= n; i++) {
    depotKm += (matrix.getDistance(0, i) + matrix.getDistance(i, 0)) / 2;
    depotMin += (matrix.getDuration(0, i) + matrix.getDuration(i, 0)) / 2;
    let bestKm = Infinity, bestMin = Infinity;
    for (let j = 1; j <= n; j++) {
      if (i === j) continue;
      const d = matrix.getDistance(i, j);
      if (d < bestKm) { bestKm = d; bestMin = matrix.getDuration(i, j); }
    }
    if (bestKm !== Infinity) { nnKm += bestKm; nnMin += bestMin; }
  }
  const meanDepotKm = n > 0 ? depotKm / n : 0;
  const meanDepotMin = n > 0 ? depotMin / n : 0;
  return {
    fleetVolume,
    minVehicles,
    baselineKm: Math.max(1, 2 * meanDepotKm * minVehicles + nnKm),
    baselineMin: Math.max(1, 2 * meanDepotMin * minVehicles + nnMin + n * serviceMin),
    fleetLimited: hasFleetLimits(limits)
  };
}

const MAX_CACHE_ENTRIES = 250_000;
const evalCaches = new WeakMap<RoadMatrixLookup, WeakMap<Order[], WeakMap<RoutingLimits, Map<string, EvalCache>>>>();

function getEvalCache(matrix: RoadMatrixLookup, ordersMap: Order[], limits: RoutingLimits, scheduleKey: string): EvalCache {
  let byOrders = evalCaches.get(matrix);
  if (!byOrders) { byOrders = new WeakMap(); evalCaches.set(matrix, byOrders); }
  let byLimits = byOrders.get(ordersMap);
  if (!byLimits) { byLimits = new WeakMap(); byOrders.set(ordersMap, byLimits); }
  let bySchedule = byLimits.get(limits);
  if (!bySchedule) { bySchedule = new Map(); byLimits.set(limits, bySchedule); }
  let cache = bySchedule.get(scheduleKey);
  if (!cache) {
    const serviceMin = Number(scheduleKey.split('|')[0]) || 0;
    cache = { sets: new Map(), routes: new Map(), ...computeBaseline(matrix, ordersMap, limits, serviceMin) };
    bySchedule.set(scheduleKey, cache);
  }
  return cache;
}

function computeSetMetrics(sorted: number[], ordersMap: Order[], matrix: RoadMatrixLookup, limits: RoutingLimits): SetMetrics {
  const orders = sorted.map(idx => ordersMap[idx - 1]).filter(Boolean);
  const feasible = checkHardLimits(orders, limits);
  const { maxW, maxV } = getRouteCapacities(orders, limits);
  const totalW = orders.reduce((s, o) => s + o.weight, 0);
  const totalV = orders.reduce((s, o) => s + o.volume, 0);

  // Angular spread (same as evaluateDirectionalCompactness)
  let spreadPenalty = 0;
  if (orders.length > 1) {
    const angles = orders.map(o => getDepotAngle(o.lat, o.lng));
    let maxSpread = 0;
    for (let i = 0; i < angles.length; i++) {
      for (let j = i + 1; j < angles.length; j++) {
        const diff = getAngleDiff(angles[i], angles[j]);
        if (diff > maxSpread) maxSpread = diff;
      }
    }
    if (maxSpread > Math.PI / 2) spreadPenalty = Math.min(1.0, (maxSpread - Math.PI / 2) / (Math.PI / 2));
  }

  // Detour baseline (same as evaluateRoadDetourRatio)
  let detourBaseline = 3.0;
  if (sorted.length > 1) {
    let minDepotDist = Infinity;
    for (const idx of sorted) minDepotDist = Math.min(minDepotDist, matrix.getDistance(0, idx));
    let nnSum = 0;
    for (let i = 0; i < sorted.length; i++) {
      let minNeighbor = Infinity;
      for (let j = 0; j < sorted.length; j++) {
        if (i === j) continue;
        const d = matrix.getDistance(sorted[i], sorted[j]);
        if (d < minNeighbor) minNeighbor = d;
      }
      nnSum += minNeighbor === Infinity ? 0 : minNeighbor;
    }
    detourBaseline = Math.max(2 * minDepotDist + nnSum * 0.9, 3.0);
  }

  return { feasible, totalW, totalV, maxW, maxV, spreadPenalty, detourBaseline };
}

export function getRouteMetrics(
  route: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): RouteMetrics {
  const serviceMin = limits.serviceTimeMinutes ?? config.defaultServiceTimeMinutes ?? 10;
  const startMin = (config.depotStartHour ?? 8) * 60;
  const cache = getEvalCache(matrix, ordersMap, limits, `${serviceMin}|${startMin}`);
  const key = route.join(',');
  const hit = cache.routes.get(key);
  if (hit) return hit;

  const setKey = route.length > 1 ? [...route].sort((a, b) => a - b).join(',') : key;
  let set = cache.sets.get(setKey);
  if (!set) {
    set = computeSetMetrics(setKey === key ? [...route] : [...route].sort((a, b) => a - b), ordersMap, matrix, limits);
    if (cache.sets.size > MAX_CACHE_ENTRIES) cache.sets.clear();
    cache.sets.set(setKey, set);
  }

  const orders = route.map(idx => ordersMap[idx - 1]).filter(Boolean);
  const distKm = matrix.calculateRoundTripDistance(route);

  let detourScore = 0;
  if (route.length > 1) {
    const detourRatio = Math.max(1.0, Math.round((distKm / set.detourBaseline) * 100) / 100);
    detourScore = Math.min(1.0, Math.max(0, (detourRatio - 1.0) / 0.8));
  }

  let dirScore = 0;
  if (orders.length > 1) {
    let reversals = 0;
    for (let i = 0; i < orders.length - 2; i++) {
      const a1 = getDepotAngle(orders[i].lat, orders[i].lng);
      const a2 = getDepotAngle(orders[i + 1].lat, orders[i + 1].lng);
      const a3 = getDepotAngle(orders[i + 2].lat, orders[i + 2].lng);
      if (getAngleDiff(a1, a2) > Math.PI / 4 && getAngleDiff(a2, a3) > Math.PI / 4 && getAngleDiff(a1, a3) < Math.PI / 6) {
        reversals++;
      }
    }
    dirScore = Math.min(1.0, set.spreadPenalty * 0.7 + Math.min(1.0, reversals * 0.25) * 0.3);
  }

  const metrics: RouteMetrics = {
    set,
    orders,
    distKm,
    schedule: evaluateRouteSchedule(route, matrix, ordersMap, serviceMin, startMin),
    dirScore,
    regionScore: evaluateRegionMixingScore(orders),
    detourScore
  };
  if (cache.routes.size > MAX_CACHE_ENTRIES) cache.routes.clear();
  cache.routes.set(key, metrics);
  return metrics;
}

/**
 * Evaluates an individual route and returns a normalized score [0, 1+].
 * Returns Infinity if hard capacity limits are violated.
 */
export function evaluateSingleRouteScore(
  orderIndices: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): number {
  if (orderIndices.length === 0) return 0;

  const m = getRouteMetrics(orderIndices, ordersMap, matrix, limits, config);
  if (!m.set.feasible) return Infinity;

  // Volume is the primary load driver in this domain (Requirement 5)
  const vUtil = m.set.maxV > 0 ? m.set.totalV / m.set.maxV : 0.8;
  const capacityScore = evaluateCapacityScore(vUtil, config);
  const schedule = m.schedule;

  // HARD TIME WINDOW: Heavy finite penalty so local search actively eliminates violations without breaking seed scoring
  let hardTwPenalty = 0;
  if (limits.timeWindowMode === 'hard' && schedule.violationsCount > 0) {
    hardTwPenalty = 10.0 * schedule.violationsCount + schedule.totalLatenessMinutes * 0.5;
  }

  // SOFT TIME WINDOW: High normalized lateness penalty
  const timeWindowScore = Math.min(1.0, schedule.totalLatenessMinutes / 45.0);

  // Road distance contribution normalized by route size
  // (no cap at 1.0: a capped score stops telling a 100 km route from a 200 km one)
  const distanceScore = m.distKm / (orderIndices.length * 15 + 30);

  // Driving & waiting & service duration contribution normalized
  const durationScore = schedule.totalDurationMinutes / 480.0;

  // Soft constraint penalty (e.g. shift length > max allowed)
  let constraintPenalty = 0;
  if (schedule.totalDurationMinutes > config.maxRouteDurationHours * 60) {
    // shift limit is a real limit: every hour over it costs about as much as a whole extra truck
    constraintPenalty += (schedule.totalDurationMinutes - config.maxRouteDurationHours * 60) / 60;
  }

  // Route stability penalty (penalize deviating from yesterday's plan if provided)
  let stabilityPenalty = 0;
  if (limits.previousPlan && config.routeStabilityWeight > 0) {
    const routeOrders = m.orders;
    let changedCount = 0;
    const firstPrevRoute = limits.previousPlan[routeOrders[0]?.id];
    for (const ord of routeOrders) {
      if (limits.previousPlan[ord.id] && limits.previousPlan[ord.id] !== firstPrevRoute) {
        changedCount++;
      }
    }
    stabilityPenalty = (changedCount / routeOrders.length) * config.routeStabilityWeight;
  }

  return (
    config.distanceWeight * distanceScore +
    config.durationWeight * durationScore +
    config.capacityUtilizationWeight * capacityScore +
    config.geographicCompactnessWeight * (m.detourScore * 0.6 + m.dirScore * 0.4) +
    config.regionConsistencyWeight * m.regionScore +
    config.timeWindowWeight * timeWindowScore +
    constraintPenalty +
    stabilityPenalty +
    hardTwPenalty
  );
}

const normalisedConfigs = new WeakMap<SmartVRPConfig, SmartVRPConfig>();
function normalisedConfig(config: SmartVRPConfig): SmartVRPConfig {
  let n = normalisedConfigs.get(config);
  if (!n) { n = normaliseWeights(config); normalisedConfigs.set(config, n); }
  return n;
}

/**
 * Global Normalized Solution Objective Function:
 * TotalScore =
 *   DistanceScore * W_distance
 *   + DurationScore * W_duration
 *   + VehicleCountScore * W_vehicleCount
 *   + CapacityScore * W_capacity
 *   + GeographicCompactnessScore * W_geography
 *   + StopBalanceScore * W_stops
 *   + RegionMixScore * W_region
 *   + ConstraintPenalty
 *
 * All primary components are normalized to [0, 1].
 */
export function evaluateSolutionScore(
  solutionRoutes: number[][],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  userConfig: SmartVRPConfig
): number {
  const config = normalisedConfig(userConfig);
  const activeRoutes = solutionRoutes.filter(r => r.length > 0);
  if (activeRoutes.length === 0) return 0;

  // Max vehicles constraint (for What-If fleet capping) - heavy finite penalty so RouteMerger compresses fleet
  let excessVehiclePenalty = 0;
  if (limits.maxVehicles && limits.maxVehicles > 0 && activeRoutes.length > limits.maxVehicles) {
    excessVehiclePenalty = (activeRoutes.length - limits.maxVehicles) * 25.0;
  }

  let totalDistKm = 0;
  let totalDurationMin = 0;
  let totalLatenessMin = 0;
  let totalHardTwPenalty = 0;
  let totalDirScore = 0;
  let totalRegionScore = 0;
  let totalDetourScore = 0;
  let totalShiftOvertimeMin = 0;

  const utilizations: number[] = [];
  const stopCounts: number[] = [];
  const cache = getEvalCache(matrix, ordersMap, limits,
    `${limits.serviceTimeMinutes ?? config.defaultServiceTimeMinutes ?? 10}|${(config.depotStartHour ?? 8) * 60}`);
  const routeOrderLists: Order[][] = [];

  for (const r of activeRoutes) {
    const m = getRouteMetrics(r, ordersMap, matrix, limits, config);
    if (!m.set.feasible) return Infinity;
    routeOrderLists.push(m.orders);

    totalDistKm += m.distKm;
    const schedule = m.schedule;

    if (limits.timeWindowMode === 'hard' && schedule.violationsCount > 0) {
      totalHardTwPenalty += 10.0 * schedule.violationsCount + schedule.totalLatenessMinutes * 0.5;
    }

    totalDurationMin += schedule.totalDurationMinutes;
    totalLatenessMin += schedule.totalLatenessMinutes;

    if (schedule.totalDurationMinutes > config.maxRouteDurationHours * 60) {
      totalShiftOvertimeMin += (schedule.totalDurationMinutes - config.maxRouteDurationHours * 60);
    }

    // Volume is the primary utilization driver (Requirement 5)
    const volumeUtil = m.set.maxV > 0 ? m.set.totalV / m.set.maxV : 0.8;

    utilizations.push(volumeUtil);
    stopCounts.push(r.length);

    totalDetourScore += m.detourScore;
    totalDirScore += m.dirScore;
    totalRegionScore += m.regionScore;
  }

  // Must-stay-together global check across routes
  let splitGroupPenalty = 0;
  if (limits.mustStayTogether && limits.mustStayTogether.length > 0) {
    const orderRouteIndex = new Map<string, number>();
    activeRoutes.forEach((r, rIdx) => {
      for (const idx of r) {
        const ord = ordersMap[idx - 1];
        if (ord) orderRouteIndex.set(ord.id, rIdx);
      }
    });
    for (const group of limits.mustStayTogether) {
      const assignedRoutes = new Set<number>();
      for (const orderId of group) {
        const rIdx = orderRouteIndex.get(orderId);
        if (rIdx !== undefined) assignedRoutes.add(rIdx);
      }
      if (assignedRoutes.size > 1) {
        splitGroupPenalty += (assignedRoutes.size - 1) * 15.0;
      }
    }
  }

  const k = activeRoutes.length;

  // 1-3. Plan cost with the dispatcher's tariffs: per trip (truck) + per km.
  //      Totals, not averages per truck (an average makes splitting into more trucks look cheaper),
  //      and no cap at 1.0 (a capped score cannot tell a long plan from a very long one).
  //      The mode still sets the balance between saving trucks and saving kilometres.
  const costPerRoute = limits.costPerRoute > 0 ? limits.costPerRoute : DEFAULT_COST_PER_ROUTE;
  const costPerKm = limits.costPerKm > 0 ? limits.costPerKm : DEFAULT_COST_PER_KM;
  const mix = Math.max(0.0001, config.vehicleCountWeight + config.distanceWeight);
  const truckFactor = (2 * config.vehicleCountWeight) / mix;
  const kmFactor = (2 * config.distanceWeight) / mix;
  const planCost = costPerRoute * k * truckFactor + costPerKm * totalDistKm * kmFactor;
  const baselineCost = costPerRoute * cache.minVehicles * truckFactor + costPerKm * cache.baselineKm * kmFactor;
  const costScore = planCost / Math.max(1, baselineCost);
  const durationScore = totalDurationMin / cache.baselineMin;

  // Trucks actually available: one route per truck, types without a count are unlimited
  let fleetPenalty = 0;
  if (cache.fleetLimited) {
    fleetPenalty = assignFleet(routeOrderLists, limits).unassigned * 25.0;
  }

  // 4. Capacity & Utilization Score (Volume is primary driver)
  const avgUtil = utilizations.reduce((s, u) => s + u, 0) / k;
  const utilVariance = utilizations.reduce((s, u) => s + Math.pow(u - avgUtil, 2), 0) / k;
  const utilStdDev = Math.sqrt(utilVariance);

  const avgCapacityPenalty = utilizations.reduce((s, u) => s + evaluateCapacityScore(u, config), 0) / k;
  const capacityScore = Math.min(1.0, avgCapacityPenalty * 0.7 + utilStdDev * 0.3);

  // 5. Geographic Compactness Score (detour and corridor shape)
  const geographicScore = (totalDetourScore / k) * 0.6 + (totalDirScore / k) * 0.4;

  // 6. Stop Balance Score: variance in stop counts
  const avgStops = stopCounts.reduce((s, c) => s + c, 0) / k;
  const stopVariance = stopCounts.reduce((s, c) => s + Math.pow(c - avgStops, 2), 0) / k;
  const stopBalanceScore = Math.min(1.0, Math.sqrt(stopVariance) / Math.max(1, avgStops * 2));

  // 7. Region Consistency Score
  const regionScore = totalRegionScore / k;

  // 8. Time Window Lateness Score (normalized separate mechanism)
  const timeWindowScore = Math.min(1.0, totalLatenessMin / (k * 45.0));

  // 9. Constraint Penalty (soft overtime or minor violations)
  // Shift limit (default 10 h): every hour over it costs about as much as a whole extra truck,
  // so the optimizer adds a truck instead of planning a 20-hour route
  const constraintPenalty = (totalShiftOvertimeMin / 60) * 0.5;

  // 10. Cost Model Score (if enabled)
  let costModelScore = 0;
  if (limits.costModel?.enabled) {
    const fuel = totalDistKm * limits.costModel.fuelCostPerKm;
    const driver = (totalDurationMin / 60) * limits.costModel.driverCostPerHour;
    const fleetFixed = k * limits.costModel.vehicleFixedCost;
    const toll = k * limits.costModel.tollCostPerRoute;
    const totalCost = fuel + driver + fleetFixed + toll;
    costModelScore = Math.min(1.0, totalCost / (k * 180.0));
  }

  // Combine into normalized total objective score
  let totalScore =
    (config.distanceWeight + config.vehicleCountWeight) * costScore +
    config.durationWeight * durationScore +
    config.capacityUtilizationWeight * capacityScore +
    config.geographicCompactnessWeight * geographicScore +
    config.stopBalanceWeight * stopBalanceScore +
    config.regionConsistencyWeight * regionScore +
    config.timeWindowWeight * timeWindowScore +
    constraintPenalty +
    excessVehiclePenalty +
    fleetPenalty +
    totalHardTwPenalty +
    splitGroupPenalty;

  if (limits.costModel?.enabled && config.mode === 'cost_saver') {
    totalScore = totalScore * 0.7 + costModelScore * 0.3;
  }

  return Number.isFinite(totalScore) ? totalScore : 9999;
}
