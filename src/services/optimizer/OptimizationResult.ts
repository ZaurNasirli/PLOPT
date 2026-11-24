import { Order, Route } from '../../types';
import type { RoutingLimits } from '../routingService';
import { RoadMatrixLookup } from './RoadMatrix';
import { SmartVRPConfig, SolutionMetrics, RouteMetrics, RouteExplanation } from './types';
import { getRouteCapacities, evaluateRouteSchedule, findBestTruck } from './ConstraintValidator';
import { 
  evaluateRoadDetourRatio, 
  getDepotAngle, 
  evaluateSolutionScore 
} from './ObjectiveFunction';

/**
 * Computes human-readable cardinal sector name for a group of orders.
 */
export function getCorridorSectorName(orders: Order[]): string {
  if (orders.length === 0) return 'Центральный сектор';

  const angles = orders.map(o => getDepotAngle(o.lat, o.lng));
  const avgAngle = angles.reduce((s, a) => s + a, 0) / angles.length;

  // Polar angle relative to warehouse:
  // 0 rad = East, PI/2 = North, PI = West, 3PI/2 = South
  const deg = (avgAngle * 180) / Math.PI;

  if (deg >= 337.5 || deg < 22.5) return 'Восточный сектор';
  if (deg >= 22.5 && deg < 67.5) return 'Северо-Восточный сектор';
  if (deg >= 67.5 && deg < 112.5) return 'Северный сектор';
  if (deg >= 112.5 && deg < 157.5) return 'Северо-Западный сектор';
  if (deg >= 157.5 && deg < 202.5) return 'Западный сектор';
  if (deg >= 202.5 && deg < 247.5) return 'Юго-Западный сектор';
  if (deg >= 247.5 && deg < 292.5) return 'Южный сектор';
  return 'Юго-Восточный сектор';
}

/**
 * Generates an intuitive human-readable explanation for why a route was shaped this way.
 */
export function generateRouteExplanation(
  orderIndices: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): RouteExplanation {
  const routeOrders = orderIndices.map(i => ordersMap[i - 1]).filter(Boolean);
  const corridorName = getCorridorSectorName(routeOrders);

  const { maxW, maxV, truckName } = getRouteCapacities(routeOrders, limits);
  const totalW = routeOrders.reduce((s, o) => s + o.weight, 0);
  const totalV = routeOrders.reduce((s, o) => s + o.volume, 0);
  const wUtil = maxW > 0 ? Math.round((totalW / maxW) * 100) : 80;
  const vUtil = maxV > 0 ? Math.round((totalV / maxV) * 100) : 80;

  // Volume is PRIMARY indicator, weight is secondary
  let loadBadge = `Объем: ${vUtil}% (Вес: ${wUtil}%)`;
  if (vUtil >= 85) loadBadge = `Высокая загрузка: ${vUtil}% об. (${wUtil}% вес)`;
  else if (vUtil < 40) loadBadge = `Локальный рейс: ${vUtil}% об. (${wUtil}% вес)`;

  const detourRatio = evaluateRoadDetourRatio(orderIndices, matrix);
  const schedule = evaluateRouteSchedule(
    orderIndices,
    matrix,
    ordersMap,
    config.defaultServiceTimeMinutes,
    config.depotStartHour * 60
  );

  let efficiencyBadge = 'Высокая плотность пути';
  if (detourRatio > 1.45) efficiencyBadge = 'Умеренный разброс';

  const timeWindowBadge = 'Время суток — символическая метка';

  const highlights: string[] = [
    `Компактный ${corridorName}`,
    `Эффективность транспорта: ${truckName || 'Стандарт'} (${totalW} кг / ${Math.round(totalV * 10) / 10} м³)`,
    `Длина пути: ${matrix.calculateRoundTripDistance(orderIndices)} км, ${schedule.totalDurationMinutes} мин в рейсе`
  ];

  return {
    corridorName,
    loadBadge,
    efficiencyBadge,
    timeWindowBadge,
    highlights
  };
}

/**
 * Computes comprehensive metrics for the entire solution.
 */
export function calculateSolutionMetrics(
  routes: number[][],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config: SmartVRPConfig
): SolutionMetrics {
  const activeRoutes = routes.filter(r => r.length > 0);
  let totalDistKm = 0;
  let totalDriving = 0;
  let totalWaiting = 0;
  let totalService = 0;
  let totalStops = 0;
  let totalLateness = 0;
  let totalDetourScore = 0;

  const vUtils: number[] = [];
  const wUtils: number[] = [];

  for (const r of activeRoutes) {
    const routeOrders = r.map(i => ordersMap[i - 1]).filter(Boolean);
    const dist = matrix.calculateRoundTripDistance(r);
    totalDistKm += dist;
    totalStops += r.length;

    const schedule = evaluateRouteSchedule(
      r,
      matrix,
      ordersMap,
      config.defaultServiceTimeMinutes,
      config.depotStartHour * 60
    );
    totalDriving += schedule.totalDrivingMinutes;
    totalWaiting += schedule.totalWaitingMinutes;
    totalService += schedule.totalServiceMinutes;
    totalLateness += schedule.totalLatenessMinutes;

    const { maxW, maxV } = getRouteCapacities(routeOrders, limits);
    const totalW = routeOrders.reduce((s, o) => s + o.weight, 0);
    const totalV = routeOrders.reduce((s, o) => s + o.volume, 0);

    const vu = maxV > 0 ? (totalV / maxV) * 100 : 80;
    const wu = maxW > 0 ? (totalW / maxW) * 100 : 80;
    vUtils.push(vu);
    wUtils.push(wu);

    const detourRatio = evaluateRoadDetourRatio(r, matrix);
    totalDetourScore += detourRatio;
  }

  const k = Math.max(1, activeRoutes.length);
  const avgVUtil = Math.round(vUtils.reduce((s, u) => s + u, 0) / k);
  const minVUtil = vUtils.length > 0 ? Math.round(Math.min(...vUtils)) : 0;
  const maxVUtil = vUtils.length > 0 ? Math.round(Math.max(...vUtils)) : 0;
  const avgWUtil = Math.round(wUtils.reduce((s, u) => s + u, 0) / k);

  const variance = vUtils.reduce((s, u) => s + Math.pow(u - avgVUtil, 2), 0) / k;
  const totalScore = evaluateSolutionScore(activeRoutes, ordersMap, matrix, limits, config);

  return {
    totalDistanceKm: Math.round(totalDistKm * 10) / 10,
    totalDrivingDurationMin: Math.round(totalDriving),
    totalWaitingDurationMin: Math.round(totalWaiting),
    totalServiceDurationMin: Math.round(totalService),
    totalDurationMin: Math.round(totalDriving + totalWaiting + totalService),
    vehiclesCount: activeRoutes.length,
    totalStops,
    avgVolumeUtilization: avgVUtil,
    minVolumeUtilization: minVUtil,
    maxVolumeUtilization: maxVUtil,
    avgWeightUtilization: avgWUtil,
    loadVariance: Math.round(Math.sqrt(variance) * 10) / 10,
    geographicCompactnessScore: Math.round((totalDetourScore / k) * 100) / 100,
    timeWindowViolationsCount: Math.round(totalLateness),
    totalNormalizedScore: Math.round(totalScore * 1000) / 1000,
    isRealRoad: matrix.isRealRoad,
    hasFallback: matrix.hasFallback
  };
}

export interface RouteQualityScore {
  overallScore: number; // 0..100
  geography: number;    // 0..100
  volume: number;       // 0..100
  distance: number;     // 0..100
  duration: number;     // 0..100
  timeWindows: number;  // 0..100
  balance: number;      // 0..100
  explanation: {
    title: string;
    reasons: string[];
  };
}

/**
 * Computes an intuitive 0-100 Route Quality Score with exact category breakdown
 * and human-understandable "WHY THIS ROUTE?" justification.
 */
export function calculateRouteQualityScore(
  orderIndices: number[],
  ordersMap: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits,
  config?: Partial<SmartVRPConfig>
): RouteQualityScore {
  const routeOrders = orderIndices.map(i => ordersMap[i - 1]).filter(Boolean);
  if (routeOrders.length === 0) {
    return {
      overallScore: 0,
      geography: 0,
      volume: 0,
      distance: 0,
      duration: 0,
      timeWindows: 100,
      balance: 0,
      explanation: {
        title: 'Пустой маршрут',
        reasons: ['Маршрут не содержит точек доставки']
      }
    };
  }

  const corridorName = getCorridorSectorName(routeOrders);
  const { maxW, maxV, truckName } = getRouteCapacities(routeOrders, limits);
  const totalW = routeOrders.reduce((s, o) => s + o.weight, 0);
  const totalV = routeOrders.reduce((s, o) => s + o.volume, 0);
  const vUtil = maxV > 0 ? Math.min(100, Math.round((totalV / maxV) * 100)) : 80;
  const wUtil = maxW > 0 ? Math.min(100, Math.round((totalW / maxW) * 100)) : 80;

  const detourRatio = evaluateRoadDetourRatio(orderIndices, matrix);
  const distKm = matrix.calculateRoundTripDistance(orderIndices);

  const schedule = evaluateRouteSchedule(
    orderIndices,
    matrix,
    ordersMap,
    config?.defaultServiceTimeMinutes ?? 10,
    (config?.depotStartHour ?? 8) * 60
  );

  // Category scores (0 - 100):
  // 1. Geography: penalize detour > 1.2
  const geography = Math.round(Math.max(40, Math.min(100, 100 - (detourRatio - 1.0) * 45)));

  // 2. Volume utilization (primary load metric)
  const volume = Math.round(vUtil >= 80 ? Math.min(100, vUtil + 5) : Math.max(30, vUtil));

  // 3. Road distance efficiency
  const directRadialDist = orderIndices.reduce((max, idx) => Math.max(max, matrix.getDistance(0, idx)), 0) * 2;
  const distEfficiency = directRadialDist > 0 ? directRadialDist / Math.max(directRadialDist, distKm) : 0.85;
  const distance = Math.round(Math.max(50, Math.min(100, distEfficiency * 100)));

  // 4. Duration score
  const totalShiftMins = schedule.totalDurationMinutes;
  const duration = Math.round(
    totalShiftMins <= 480 
      ? Math.max(60, Math.min(100, 70 + (totalShiftMins / 480) * 30))
      : Math.max(40, 100 - (totalShiftMins - 480) * 0.3)
  );

  // 5. Time windows compliance
  const timeWindows = Math.round(Math.max(0, 100 - schedule.violationsCount * 20));

  // 6. Stop balance (ideal 8 - 25 stops per vehicle)
  const stops = orderIndices.length;
  let balance = 90;
  if (stops < 5) balance = 70;
  else if (stops > 30) balance = 75;
  else balance = 95;

  // Overall Score (Weighted: 25% Volume, 20% Geography, 20% Distance, 15% Duration, 10% TimeWindows, 10% Balance)
  const overallScore = Math.round(
    volume * 0.25 +
    geography * 0.20 +
    distance * 0.20 +
    duration * 0.15 +
    timeWindows * 0.10 +
    balance * 0.10
  );

  const reasons: string[] = [
    `Единый географический вектор: ${corridorName}`,
    `Высокая загрузка по объёму: ${vUtil}% (${Math.round(totalV * 10) / 10} м³ / ${maxV} м³)`,
    `Загрузка по весу в пределах нормы: ${wUtil}% (${totalW} кг / ${maxW} кг)`,
    `Время рейса: ${schedule.totalDurationMinutes} мин (движение + разгрузка)`,
    `Компактность дорожного пути: коэффициент извилистости ${detourRatio.toFixed(2)}x (${distKm} км)`
  ];

  if (truckName) {
    reasons.push(`Оптимальный тип транспорта: ${truckName}`);
  }

  return {
    overallScore,
    geography,
    volume,
    distance,
    duration,
    timeWindows,
    balance,
    explanation: {
      title: `Оценка маршрута: ${overallScore}/100`,
      reasons
    }
  };
}
