import { Order, Route } from '../types';
import { WAREHOUSE_LOCATION } from '../mockData';
import { RoutingLimits, ProgressUpdate, calculateDistance, getRouteGeometry } from './routingService';
import {
  SmartVRPConfig,
  OptimizationMode,
  getVRPConfigForMode,
  DEFAULT_VRP_CONFIG_BALANCED,
  DEFAULT_VRP_CONFIG_FAST,
  DEFAULT_VRP_CONFIG_QUALITY,
  buildRoadMatrixLookup,
  RoadMatrixLookup,
  checkHardLimits,
  findBestTruck,
  getRouteCapacities,
  evaluateRouteSchedule,
  optimizeMultiStartVRP,
  generateRouteExplanation,
  calculateSolutionMetrics
} from './optimizer';
import { runOptimizer, OptimizerEngine } from './optimizer/workerClient';

const ENGINE_LABEL: Record<OptimizerEngine, { title: string; prefix: string }> = {
  smart: { title: 'Hybrid VRP Optimizer', prefix: 'SMART' },
  sisr: { title: 'SISR (разрезание цепочек)', prefix: 'SISR' },
  hgs: { title: 'HGS (гибридный генетический поиск)', prefix: 'HGS' },
};

// Re-export everything from the optimizer module for external consumers
export * from './optimizer';

// Legacy SmartRoutingConfig interface compatibility
export interface SmartRoutingConfig extends SmartVRPConfig {
  geographicWeight: number;
  regionWeight: number;
  utilizationWeight: number;
  stopWeight: number;
  regionMixWeight: number;
}

export const DEFAULT_SMART_ROUTING_CONFIG: SmartRoutingConfig = {
  ...DEFAULT_VRP_CONFIG_BALANCED,
  geographicWeight: DEFAULT_VRP_CONFIG_BALANCED.geographicCompactnessWeight,
  regionWeight: DEFAULT_VRP_CONFIG_BALANCED.regionConsistencyWeight,
  utilizationWeight: DEFAULT_VRP_CONFIG_BALANCED.capacityUtilizationWeight,
  stopWeight: DEFAULT_VRP_CONFIG_BALANCED.stopBalanceWeight,
  regionMixWeight: DEFAULT_VRP_CONFIG_BALANCED.regionConsistencyWeight
};

// Legacy single-route evaluation signature compatibility
export const evaluateRouteCost = (
  orders: Order[],
  limits: RoutingLimits,
  config: Partial<SmartRoutingConfig> = DEFAULT_SMART_ROUTING_CONFIG
): number => {
  if (orders.length === 0) return 0;
  if (!checkHardLimits(orders, limits)) return Infinity;

  const totalW = orders.reduce((s, o) => s + o.weight, 0);
  const totalV = orders.reduce((s, o) => s + o.volume, 0);
  const { maxW, maxV } = getRouteCapacities(orders, limits);

  const wUtil = maxW > 0 ? totalW / maxW : 0.8;
  const vUtil = maxV > 0 ? totalV / maxV : 0.8;
  const underUtil = Math.max(0, 0.75 - Math.max(wUtil, vUtil)) * 20;

  return (orders.length * 10) + underUtil;
};

// Legacy global solution cost signature compatibility
export const evaluateSolutionCost = (
  routes: Order[][],
  limits: RoutingLimits,
  config: Partial<SmartRoutingConfig> = DEFAULT_SMART_ROUTING_CONFIG
): number => {
  const activeRoutes = routes.filter(r => r.length > 0);
  if (activeRoutes.length === 0) return 0;
  let cost = 0;
  for (const r of activeRoutes) {
    const rc = evaluateRouteCost(r, limits, config);
    if (rc === Infinity) return Infinity;
    cost += rc;
  }
  return cost + activeRoutes.length * 50;
};

/**
 * 🧠 Hybrid Vehicle Routing Problem (VRP) Optimizer
 * Main dispatcher entry point for SMART Logistics Optimizer.
 * Combines real road network matrices, capacity-aware corridor clustering,
 * multi-start seeding, multi-operator local search (2-Opt, Or-Opt, 3-Opt, Relocate, Swap, Cross-Exchange, 2-Opt*),
 * route merging/splitting, and Iterated Local Search (ILS).
 */
export const runSmartLogistics = async (
  orders: Order[],
  limits: RoutingLimits,
  onProgress: (p: ProgressUpdate) => void,
  userConfig?: Partial<SmartRoutingConfig>,
  engine: OptimizerEngine = 'smart'
): Promise<Route[]> => {
  const label = ENGINE_LABEL[engine];
  const selectedMode: OptimizationMode = 
    (limits as any).optimizationMode || 
    userConfig?.mode || 
    'balanced';

  const config: SmartVRPConfig = getVRPConfigForMode(selectedMode, userConfig);

  onProgress({
    percent: 3,
    message: `🧠 ${label.title} [${selectedMode.toUpperCase()}]: Подготовка данных...`,
    log: `Инициализация ${label.title} (${orders.length} заказов, режим: ${selectedMode})`
  });
  await new Promise(r => setTimeout(r, 10));

  if (orders.length === 0) return [];

  // Sanitize input orders against NaN/undefined coordinates or metrics
  const sanitizedOrders: Order[] = orders.map(o => ({
    ...o,
    lat: Number.isFinite(Number(o.lat)) && Number(o.lat) !== 0 ? Number(o.lat) : WAREHOUSE_LOCATION.lat,
    lng: Number.isFinite(Number(o.lng)) && Number(o.lng) !== 0 ? Number(o.lng) : WAREHOUSE_LOCATION.lng,
    weight: Number.isFinite(Number(o.weight)) && Number(o.weight) >= 0 ? Number(o.weight) : 0,
    volume: Number.isFinite(Number(o.volume)) && Number(o.volume) >= 0 ? Number(o.volume) : 0,
    satir: Number.isFinite(Number(o.satir)) && Number(o.satir) >= 0 ? Number(o.satir) : 0
  }));

  // Build map of mustStayTogether group leaders so grouped orders stay in the same partition
  const groupPartitionOverride = new Map<string, string>();
  if (limits.mustStayTogether && limits.mustStayTogether.length > 0) {
    for (const grp of limits.mustStayTogether) {
      if (!grp || grp.length < 2) continue;
      const firstMember = sanitizedOrders.find(o => grp.includes(o.id));
      if (firstMember) {
        const dKey = limits.allowCombineDates === false ? (firstMember.shippingDate || 'no-date') : 'all-dates';
        const sKey = limits.allowCombineTimeSlots === false ? (firstMember.timeSlot || 'no-slot') : 'all-slots';
        const sharedKey = `${dKey}__${sKey}`;
        for (const id of grp) {
          groupPartitionOverride.set(id, sharedKey);
        }
      }
    }
  }

  // Partition by non-combinable attributes (shipping date & time slots if prohibited)
  const partitions: Record<string, Order[]> = {};
  for (const o of sanitizedOrders) {
    const overrideKey = groupPartitionOverride.get(o.id);
    const dateKey = limits.allowCombineDates === false ? (o.shippingDate || 'no-date') : 'all-dates';
    const slotKey = limits.allowCombineTimeSlots === false ? (o.timeSlot || 'no-slot') : 'all-slots';
    const key = overrideKey || `${dateKey}__${slotKey}`;
    if (!partitions[key]) partitions[key] = [];
    partitions[key].push(o);
  }

  const partitionKeys = Object.keys(partitions);
  const finalRoutes: Route[] = [];
  const runId = Date.now();

  for (let pIdx = 0; pIdx < partitionKeys.length; pIdx++) {
    const partitionOrders = partitions[partitionKeys[pIdx]];
    const baseProgress = 10 + Math.floor((pIdx / partitionKeys.length) * 80);

    onProgress({
      percent: baseProgress,
      message: `🧠 Получение матрицы дорожных расстояний и времени OSRM (${pIdx + 1}/${partitionKeys.length})...`,
      log: `Построение матрицы расстояний и времени для ${partitionOrders.length} точек`
    });
    await new Promise(r => setTimeout(r, 10));

    // Build real road distance and duration matrix lookup
    const matrix = await buildRoadMatrixLookup(partitionOrders, WAREHOUSE_LOCATION);
    const orderIndices = partitionOrders.map((_, idx) => idx + 1);

    if (matrix.barrierInfo) {
      const b = matrix.barrierInfo;
      onProgress({
        percent: baseProgress + 5,
        message: `🚧 Учёт барьеров: ${b.barriersCount}`,
        log: `Барьеры (${b.barriersCount}): объезд учтён для ${b.correctedPairs} пар точек` +
          (b.unreachablePairs ? `, недоступно без проезда через барьер: ${b.unreachablePairs}` : '') +
          (b.partial ? ' — учтены частично (сервер Valhalla недоступен или лимит запросов)' : '') +
          (b.usedEstimate ? ' — проверка по прямой (OSRM недоступен)' : '')
      });
    }

    onProgress({
      percent: baseProgress + 10,
      message: engine === 'smart' ? `🧠 Запуск Multi-Start Hybrid VRP (${config.multiStartIterations} независимых решений)...` : `🧠 Запуск ${label.title}...`,
      log: `Матрица готова (${matrix.isRealRoad ? 'OSRM 100% реальные дороги' : `реальные дороги ${matrix.coveragePercent}%`}; из кэша ${matrix.cachedPairsCount} пар, запрошено ${matrix.fetchedPairsCount}). Оптимизация...`
    });
    await new Promise(r => setTimeout(r, 10));

    // Multi-Start Optimization with ILS and Local Search
    const solutionIndices = await runOptimizer(
      orderIndices,
      partitionOrders,
      matrix,
      limits,
      config,
      (pct, msg) => {
        onProgress({
          percent: baseProgress + Math.floor((pct / 100) * Math.max(10, Math.floor(75 / partitionKeys.length))),
          message: `🧠 ${msg}`,
          log: msg
        });
      },
      engine
    );

    // Compute metrics and build final Route entities
    solutionIndices.forEach((routeIndices) => {
      const routeOrders = routeIndices.map(i => partitionOrders[i - 1]).filter(Boolean);
      if (routeOrders.length === 0) return;

      const routeSeq = finalRoutes.length;
      const assignedTruck = findBestTruck(routeOrders, limits);
      const distKm = matrix.calculateRoundTripDistance(routeIndices);
      const durMin = matrix.calculateRoundTripDuration(routeIndices);
      const explanation = generateRouteExplanation(routeIndices, partitionOrders, matrix, limits, config);
      const schedule = evaluateRouteSchedule(
        routeIndices,
        matrix,
        partitionOrders,
        limits.serviceTimeMinutes ?? config.defaultServiceTimeMinutes ?? 10,
        (config.depotStartHour ?? 8) * 60
      );

      const hue = Math.round((routeSeq * 137.508 + 35) % 360);

      // Compute genuine straight-line (Haversine) round trip distance (Requirement 13)
      let straightDistKm = 0;
      let prevLat = WAREHOUSE_LOCATION.lat;
      let prevLng = WAREHOUSE_LOCATION.lng;
      for (const o of routeOrders) {
        straightDistKm += calculateDistance(prevLat, prevLng, o.lat, o.lng);
        prevLat = o.lat;
        prevLng = o.lng;
      }
      if (routeOrders.length > 0) {
        straightDistKm += calculateDistance(prevLat, prevLng, WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng);
      }
      straightDistKm = Math.round(straightDistKm * 10) / 10;

      // Provide immediate fallback polyline so routes render right away while background OSRM geometry loads
      const initialGeometry: [number, number][] = [
        [WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng],
        ...routeOrders.map(o => [o.lat, o.lng] as [number, number]),
        [WAREHOUSE_LOCATION.lat, WAREHOUSE_LOCATION.lng]
      ];

      finalRoutes.push({
        id: `route-${engine}-${runId}-${routeSeq + 1}`,
        name: `${label.prefix}-${routeSeq + 1}`,
        orderIds: routeOrders.map(o => o.id),
        color: `hsl(${hue}, 75%, 48%)`,
        isVisible: true,
        distance: distKm,
        straightDistanceKm: straightDistKm,
        // Only report road values when the matrix really came from the road network (not a Haversine fallback)
        roadDistanceKm: matrix.isRealRoad ? distKm : undefined,
        roadDurationMin: matrix.isRealRoad ? durMin : undefined,
        durationMinutes: schedule.totalDurationMinutes,
        drivingDurationMin: schedule.totalDrivingMinutes,
        waitingDurationMin: schedule.totalWaitingMinutes,
        serviceDurationMin: schedule.totalServiceMinutes,
        totalDurationMin: schedule.totalDurationMinutes,
        isRealRoad: matrix.isRealRoad,
        routingSource: matrix.isRealRoad ? 'OSRM' : 'HAVERSINE',
        truckTypeId: assignedTruck,
        geometry: initialGeometry,
        whyThisRoute: explanation.highlights?.join(' • ') || explanation.corridorName
      });
    });
  }

  onProgress({
    percent: 100,
    message: `🧠 ${label.title} завершен! Сформировано ${finalRoutes.length} маршрутов.`,
    log: `Оптимизация завершена успешно. Создано ${finalRoutes.length} сбалансированных маршрутов.`
  });

  return finalRoutes;
};
