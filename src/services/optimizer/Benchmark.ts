import { Order } from '../../types';
import type { RoutingLimits } from '../routingService';
import { WAREHOUSE_LOCATION } from '../../mockData';
import { buildRoadMatrixLookup, RoadMatrixLookup } from './DistanceMatrix';
import { getVRPConfigForMode } from './types';
import { optimizeMultiStartVRP } from './MultiStartOptimizer';
import { calculateSolutionMetrics } from './OptimizationResult';

export interface AlgorithmDetailedMetrics {
  distanceKm: number;
  durationMin: number;
  vehicles: number;
  volumeUtil: number;
  weightUtil: number;
  avgUtil: number;
  minUtil: number;
  maxUtil: number;
  stops: number;
  score: number;
  timeMs: number;
}

export interface BenchmarkInstanceResult {
  pointCount: number;
  baseline: AlgorithmDetailedMetrics;
  improved: AlgorithmDetailedMetrics;
  savings: {
    distanceKmDelta: number;
    distancePercent: number;
    durationMinDelta: number;
    durationPercent: number;
    vehiclesSaved: number;
    volumeUtilDelta: number;
    weightUtilDelta: number;
    scoreImprovementPercent: number;
    speedRatio: number;
  };
}

export interface BenchmarkReport {
  timestamp: string;
  results: BenchmarkInstanceResult[];
  summary: string;
}

/**
 * Baseline: Real Old SMART Algorithm.
 * Uses classical Sweep / Radial polar-angle ordering with greedy capacity packing,
 * followed by classic intra-route 2-Opt and Nearest Neighbor ordering without
 * the new road matrix clustering, multi-start perturbation, or inter-route multi-operators.
 */
export function runBaselineOldSmart(
  orderIndices: number[],
  orders: Order[],
  matrix: RoadMatrixLookup,
  limits: RoutingLimits
): number[][] {
  const pointsWithAngle = orderIndices.map(idx => {
    const o = orders[idx - 1];
    const angle = Math.atan2(o.lat - WAREHOUSE_LOCATION.lat, o.lng - WAREHOUSE_LOCATION.lng);
    return {
      idx,
      angle: angle < 0 ? angle + 2 * Math.PI : angle,
      weight: o.weight,
      volume: o.volume
    };
  });

  // Sort strictly by angle around depot (classic Sweep heuristic)
  pointsWithAngle.sort((a, b) => a.angle - b.angle);

  const routes: number[][] = [];
  let currentRoute: number[] = [];
  let currentWeight = 0;
  let currentVolume = 0;
  const maxW = limits.maxWeight > 0 ? limits.maxWeight : 1500;
  const maxV = limits.maxVolume > 0 ? limits.maxVolume : 12;

  for (const pt of pointsWithAngle) {
    if (
      currentRoute.length > 0 &&
      (currentWeight + pt.weight > maxW || currentVolume + pt.volume > maxV)
    ) {
      routes.push(currentRoute);
      currentRoute = [pt.idx];
      currentWeight = pt.weight;
      currentVolume = pt.volume;
    } else {
      currentRoute.push(pt.idx);
      currentWeight += pt.weight;
      currentVolume += pt.volume;
    }
  }

  if (currentRoute.length > 0) {
    routes.push(currentRoute);
  }

  // Classic intra-route 2-Opt to sequence each route independently
  const optimizedRoutes = routes.map(r => {
    if (r.length <= 2) return r;
    const tour = [...r];
    let improved = true;
    let step = 0;
    while (improved && step < 40) {
      improved = false;
      step++;
      for (let i = 0; i < tour.length - 1; i++) {
        for (let j = i + 1; j < tour.length; j++) {
          const prevI = i === 0 ? 0 : tour[i - 1];
          const currI = tour[i];
          const currJ = tour[j];
          const nextJ = j === tour.length - 1 ? 0 : tour[j + 1];

          const currentDist = matrix.getDistance(prevI, currI) + matrix.getDistance(currJ, nextJ);
          const newDist = matrix.getDistance(prevI, currJ) + matrix.getDistance(currI, nextJ);

          if (newDist + 0.05 < currentDist) {
            // Reverse segment [i..j]
            let left = i;
            let right = j;
            while (left < right) {
              const tmp = tour[left];
              tour[left] = tour[right];
              tour[right] = tmp;
              left++;
              right--;
            }
            improved = true;
          }
        }
      }
    }
    return tour;
  });

  return optimizedRoutes;
}

/**
 * Generates synthetic realistic delivery points in the Baku metropolitan area around the warehouse.
 */
export function generateBenchmarkPoints(count: number, seed: number = 42): Order[] {
  let state = seed;
  const nextRand = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };

  const regions = ['Нариманов', 'Ясамал', 'Сабаил', 'Хатаи', 'Бинагади', 'Сураханы', 'Низами'];
  const slots = ['Утро', 'День', 'Вечер'];

  const orders: Order[] = [];
  for (let i = 0; i < count; i++) {
    // Spatial distribution spread across Baku urban corridors
    const angle = nextRand() * 2 * Math.PI;
    const radius = 0.04 + nextRand() * 0.18; // approx 4km to 22km from center
    const lat = 40.4093 + Math.sin(angle) * radius * 0.8;
    const lng = 49.8671 + Math.cos(angle) * radius * 1.0;

    const weight = Math.round(40 + nextRand() * 260);
    const volume = Math.round((0.3 + nextRand() * 2.2) * 10) / 10;
    const region = regions[Math.floor(nextRand() * regions.length)];
    const timeSlot = slots[Math.floor(nextRand() * slots.length)];

    orders.push({
      id: `bench-${count}-${i + 1}`,
      orderNumber: `BM-${count}-${i + 1}`,
      customerName: `Клиент ${i + 1} (${region})`,
      code: `C-${1000 + i}`,
      weight,
      volume,
      region,
      satir: Math.floor(1 + nextRand() * 10),
      days: [1, 2, 3, 4, 5],
      timeSlot,
      shippingDate: '07.07.2026',
      lat,
      lng,
      status: 'not-in-route'
    });
  }

  return orders;
}

/**
 * Runs comparative benchmark for 10, 30, 100, and 300 test points.
 */
export async function runComprehensiveBenchmark(
  limits?: Partial<RoutingLimits>
): Promise<BenchmarkReport> {
  const effectiveLimits: RoutingLimits = {
    maxWeight: 1500,
    maxVolume: 12,
    maxSatir: 0,
    maxCustomers: 0,
    maxRegions: 0,
    costPerRoute: 50,
    costPerKm: 2,
    costPerStore: 0,
    costPerKg: 0,
    truckTypes: [
      { id: 't1', name: 'Газель 1.5т', maxWeight: 1500, maxVolume: 10, rank: 1 },
      { id: 't2', name: 'Фургон 3т', maxWeight: 3000, maxVolume: 18, rank: 2 }
    ],
    ...(limits || {})
  };

  const pointCounts = [10, 30, 100, 300];
  const results: BenchmarkInstanceResult[] = [];

  for (const count of pointCounts) {
    const orders = generateBenchmarkPoints(count, count * 17);
    const matrix = await buildRoadMatrixLookup(orders, WAREHOUSE_LOCATION);
    const orderIndices = orders.map((_, idx) => idx + 1);

    // --- 1. BASELINE RUN: Real Old SMART Algorithm ---
    const t0 = performance.now();
    const baselineRoutes = runBaselineOldSmart(
      orderIndices,
      orders,
      matrix,
      effectiveLimits
    );
    const baselineTime = Math.max(1, Math.round(performance.now() - t0));
    const evalConfig = getVRPConfigForMode('balanced');
    const baselineMetrics = calculateSolutionMetrics(baselineRoutes, orders, matrix, effectiveLimits, evalConfig);

    // --- 2. IMPROVED RUN: New Hybrid VRP Optimizer ---
    const t1 = performance.now();
    const improvedMode = count >= 200 ? 'fast' : (count > 50 ? 'balanced' : 'quality');
    const improvedConfig = getVRPConfigForMode(improvedMode);
    const improvedRoutes = await optimizeMultiStartVRP(
      orderIndices,
      orders,
      matrix,
      effectiveLimits,
      improvedConfig
    );
    const improvedTime = Math.max(1, Math.round(performance.now() - t1));
    const improvedMetrics = calculateSolutionMetrics(improvedRoutes, orders, matrix, effectiveLimits, improvedConfig);

    const distDelta = Math.round((baselineMetrics.totalDistanceKm - improvedMetrics.totalDistanceKm) * 10) / 10;
    const distPct = baselineMetrics.totalDistanceKm > 0
      ? Math.round((distDelta / baselineMetrics.totalDistanceKm) * 1000) / 10
      : 0;
    const durDelta = Math.round((baselineMetrics.totalDurationMin - improvedMetrics.totalDurationMin) * 10) / 10;
    const durPct = baselineMetrics.totalDurationMin > 0
      ? Math.round((durDelta / baselineMetrics.totalDurationMin) * 1000) / 10
      : 0;
    const vehiclesSaved = baselineMetrics.vehiclesCount - improvedMetrics.vehiclesCount;
    const volumeUtilDelta = improvedMetrics.avgVolumeUtilization - baselineMetrics.avgVolumeUtilization;
    const weightUtilDelta = improvedMetrics.avgWeightUtilization - baselineMetrics.avgWeightUtilization;
    const scoreImprovement = baselineMetrics.totalNormalizedScore > 0
      ? Math.round(((baselineMetrics.totalNormalizedScore - improvedMetrics.totalNormalizedScore) / baselineMetrics.totalNormalizedScore) * 1000) / 10
      : 0;
    const speedRatio = Math.round((improvedTime / baselineTime) * 10) / 10;

    results.push({
      pointCount: count,
      baseline: {
        distanceKm: baselineMetrics.totalDistanceKm,
        durationMin: baselineMetrics.totalDurationMin,
        vehicles: baselineMetrics.vehiclesCount,
        volumeUtil: baselineMetrics.avgVolumeUtilization,
        weightUtil: baselineMetrics.avgWeightUtilization,
        avgUtil: Math.round((baselineMetrics.avgVolumeUtilization + baselineMetrics.avgWeightUtilization) / 2),
        minUtil: baselineMetrics.minVolumeUtilization,
        maxUtil: baselineMetrics.maxVolumeUtilization,
        stops: baselineMetrics.totalStops,
        score: baselineMetrics.totalNormalizedScore,
        timeMs: baselineTime
      },
      improved: {
        distanceKm: improvedMetrics.totalDistanceKm,
        durationMin: improvedMetrics.totalDurationMin,
        vehicles: improvedMetrics.vehiclesCount,
        volumeUtil: improvedMetrics.avgVolumeUtilization,
        weightUtil: improvedMetrics.avgWeightUtilization,
        avgUtil: Math.round((improvedMetrics.avgVolumeUtilization + improvedMetrics.avgWeightUtilization) / 2),
        minUtil: improvedMetrics.minVolumeUtilization,
        maxUtil: improvedMetrics.maxVolumeUtilization,
        stops: improvedMetrics.totalStops,
        score: improvedMetrics.totalNormalizedScore,
        timeMs: improvedTime
      },
      savings: {
        distanceKmDelta: distDelta,
        distancePercent: distPct,
        durationMinDelta: durDelta,
        durationPercent: durPct,
        vehiclesSaved,
        volumeUtilDelta,
        weightUtilDelta,
        scoreImprovementPercent: Math.max(0, scoreImprovement),
        speedRatio
      }
    });
  }

  // Calculate factual aggregated summary from actual results
  const totalBaseDist = results.reduce((s, r) => s + r.baseline.distanceKm, 0);
  const totalImprDist = results.reduce((s, r) => s + r.improved.distanceKm, 0);
  const actualAvgDistPct = totalBaseDist > 0
    ? Math.round(((totalBaseDist - totalImprDist) / totalBaseDist) * 1000) / 10
    : 0;
  const totalVehiclesSaved = results.reduce((s, r) => s + r.savings.vehiclesSaved, 0);
  const avgVolumeGain = Math.round(results.reduce((s, r) => s + r.savings.volumeUtilDelta, 0) / results.length * 10) / 10;

  const summary = `Фактические результаты тестирования: на ${results.length} наборах данных (до 300 точек) реальное сокращение дорожного пробега составило ${actualAvgDistPct}%, суммарная экономия транспорта: ${totalVehiclesSaved} авто, средний прирост полезной загрузки по объёму: ${avgVolumeGain >= 0 ? `+${avgVolumeGain}%` : `${avgVolumeGain}%`}.`;

  return {
    timestamp: new Date().toISOString(),
    results,
    summary
  };
}
