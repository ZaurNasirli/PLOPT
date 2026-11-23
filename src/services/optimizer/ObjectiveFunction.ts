import { Order } from '../../types';
import { RoutingLimits } from '../routingService';
import { WAREHOUSE_LOCATION } from '../../mockData';
import { calculateDistance } from '../routingService';
import { RoadMatrixLookup } from './DistanceMatrix';
import { SmartVRPConfig, normaliseWeights } from './types';
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

  const routeOrders = orderIndices.map(idx => ordersMap[idx - 1]).filter(Boolean);
  if (!checkHardLimits(routeOrders, limits)) return Infinity;

  const { maxW, maxV } = getRouteCapacities(routeOrders, limits);
  const totalW = routeOrders.reduce((s, o) => s + o.weight, 0);
  const totalV = routeOrders.reduce((s, o) => s + o.volume, 0);
  const wUtil = maxW > 0 ? totalW / maxW : 0.8;
  const vUtil = maxV > 0 ? totalV / maxV : 0.8;
  // Volume is the primary load driver in this domain (Requirement 5)
  const primaryVolumeUtil = vUtil;

  const detourRatio = evaluateRoadDetourRatio(orderIndices, matrix);
  const detourScore = Math.min(1.0, Math.max(0, (detourRatio - 1.0) / 0.8));

  const capacityScore = evaluateCapacityScore(primaryVolumeUtil, config);
  const dirScore = evaluateDirectionalCompactness(routeOrders);
  const regionScore = evaluateRegionMixingScore(routeOrders);

  // Time window evaluation
  const schedule = evaluateRouteSchedule(
    orderIndices,
    matrix,
    ordersMap,
    limits.serviceTimeMinutes ?? config.defaultServiceTimeMinutes ?? 10,
    (config.depotStartHour ?? 8) * 60
  );

  // HARD TIME WINDOW: Heavy finite penalty so local search actively eliminates violations without breaking seed scoring
  let hardTwPenalty = 0;
  if (limits.timeWindowMode === 'hard' && schedule.violationsCount > 0) {
    hardTwPenalty = 10.0 * schedule.violationsCount + schedule.totalLatenessMinutes * 0.5;
  }

  // SOFT TIME WINDOW: High normalized lateness penalty
  const timeWindowScore = Math.min(1.0, schedule.totalLatenessMinutes / 45.0);

  // Road distance contribution normalized by route size
  const distanceKm = matrix.calculateRoundTripDistance(orderIndices);
  const distanceScore = Math.min(1.0, distanceKm / (orderIndices.length * 15 + 30));

  // Driving & waiting & service duration contribution normalized
  const durationScore = Math.min(1.0, schedule.totalDurationMinutes / 480.0);

  // Soft constraint penalty (e.g. shift length > max allowed)
  let constraintPenalty = 0;
  if (schedule.totalDurationMinutes > config.maxRouteDurationHours * 60) {
    constraintPenalty += Math.min(1.0, (schedule.totalDurationMinutes - config.maxRouteDurationHours * 60) / 120);
  }

  // Route stability penalty (penalize deviating from yesterday's plan if provided)
  let stabilityPenalty = 0;
  if (limits.previousPlan && config.routeStabilityWeight > 0) {
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
    config.geographicCompactnessWeight * (detourScore * 0.6 + dirScore * 0.4) +
    config.regionConsistencyWeight * regionScore +
    config.timeWindowWeight * timeWindowScore +
    constraintPenalty +
    stabilityPenalty +
    hardTwPenalty
  );
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
  const config = normaliseWeights(userConfig);
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

  for (const r of activeRoutes) {
    const routeOrders = r.map(idx => ordersMap[idx - 1]).filter(Boolean);
    if (!checkHardLimits(routeOrders, limits)) return Infinity;

    const dist = matrix.calculateRoundTripDistance(r);
    totalDistKm += dist;

    const schedule = evaluateRouteSchedule(
      r,
      matrix,
      ordersMap,
      limits.serviceTimeMinutes ?? config.defaultServiceTimeMinutes ?? 10,
      (config.depotStartHour ?? 8) * 60
    );

    if (limits.timeWindowMode === 'hard' && schedule.violationsCount > 0) {
      totalHardTwPenalty += 10.0 * schedule.violationsCount + schedule.totalLatenessMinutes * 0.5;
    }

    totalDurationMin += schedule.totalDurationMinutes;
    totalLatenessMin += schedule.totalLatenessMinutes;

    if (schedule.totalDurationMinutes > config.maxRouteDurationHours * 60) {
      totalShiftOvertimeMin += (schedule.totalDurationMinutes - config.maxRouteDurationHours * 60);
    }

    const { maxV } = getRouteCapacities(routeOrders, limits);
    const totalV = routeOrders.reduce((s, o) => s + o.volume, 0);
    // Volume is the primary utilization driver (Requirement 5)
    const volumeUtil = maxV > 0 ? totalV / maxV : 0.8;

    utilizations.push(volumeUtil);
    stopCounts.push(r.length);

    const detourRatio = evaluateRoadDetourRatio(r, matrix);
    totalDetourScore += Math.min(1.0, Math.max(0, (detourRatio - 1.0) / 0.8));
    totalDirScore += evaluateDirectionalCompactness(routeOrders);
    totalRegionScore += evaluateRegionMixingScore(routeOrders);
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

  // 1. Distance Score: normalized against total direct radial distance baseline
  const avgDistPerVehicle = totalDistKm / k;
  const distanceScore = Math.min(1.0, avgDistPerVehicle / 90.0);

  // 2. Duration Score: normalized against standard working shift (8 hours = 480 min)
  const avgDurationPerVehicle = totalDurationMin / k;
  const durationScore = Math.min(1.0, avgDurationPerVehicle / 480.0);

  // 3. Vehicle Count Score: theoretical minimum trucks based on total volume
  const totalFleetVolume = ordersMap.reduce((s, o) => s + o.volume, 0);
  const maxFleetTruckV = limits.maxVolume > 0
    ? limits.maxVolume
    : (limits.truckTypes && limits.truckTypes.length > 0
        ? Math.max(...limits.truckTypes.map(t => t.maxVolume))
        : 12);
  const minPossibleVehicles = Math.max(
    1,
    Math.ceil(totalFleetVolume / Math.max(0.1, maxFleetTruckV))
  );
  const vehicleCountScore = Math.max(0, (k - minPossibleVehicles) / Math.max(1, k));

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
  const constraintPenalty = Math.min(0.2, (totalShiftOvertimeMin / (k * 60)) * 0.1);

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
    config.distanceWeight * distanceScore +
    config.durationWeight * durationScore +
    config.vehicleCountWeight * vehicleCountScore +
    config.capacityUtilizationWeight * capacityScore +
    config.geographicCompactnessWeight * geographicScore +
    config.stopBalanceWeight * stopBalanceScore +
    config.regionConsistencyWeight * regionScore +
    config.timeWindowWeight * timeWindowScore +
    constraintPenalty +
    excessVehiclePenalty +
    totalHardTwPenalty +
    splitGroupPenalty;

  if (limits.costModel?.enabled && config.mode === 'cost_saver') {
    totalScore = totalScore * 0.7 + costModelScore * 0.3;
  }

  return Number.isFinite(totalScore) ? totalScore : 9999;
}
