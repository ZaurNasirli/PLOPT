import { Order, Route } from '../types';
import { WAREHOUSE_LOCATION } from '../mockData';
import { RoutingLimits, ProgressUpdate, calculateDistance, getRouteGeometry } from './routingService';
import {
  buildRoadMatrixLookup,
  findBestTruck,
  evaluateRouteSchedule
} from './optimizer';

export interface AIRouteResult {
  routeName: string;
  orderIds: string[];
  assignedTruckTypeId?: string;
  aiExplanation: string;
  dominantDistrict?: string;
}

export interface AIOptimizeResponse {
  success: boolean;
  routes: AIRouteResult[];
  overallAnalysis: string;
  totalOrdersAssigned: number;
  routesCount: number;
  error?: string;
  details?: string;
}

/**
 * Runs intelligent neural route planning using server-side Gemini AI.
 * 1. Clusters and orders stops based on geographical corridor reasoning, time windows, and truck capacities.
 * 2. Computes precise road metrics via OSRM distance matrix and real road geometries.
 * 3. Builds unified driving, waiting, and service time breakdown.
 */
export async function runAIRouting(
  orders: Order[],
  limits: RoutingLimits,
  onProgress: (update: ProgressUpdate) => void,
  strategyPrompt?: string
): Promise<Route[]> {
  if (orders.length === 0) return [];

  onProgress({
    percent: 10,
    message: '🤖 Инициализация нейросетевого планировщика Gemini AI...',
    log: `AI Optimizer: отправка ${orders.length} заказов на серверный анализ`
  });

  const payload = {
    orders: orders.map(o => ({
      id: o.id,
      customerName: o.customerName,
      code: o.code,
      lat: o.lat,
      lng: o.lng,
      weight: o.weight,
      volume: o.volume,
      timeSlot: o.timeSlot,
      region: o.region
    })),
    depot: {
      lat: WAREHOUSE_LOCATION.lat,
      lng: WAREHOUSE_LOCATION.lng,
      name: 'Центральный склад (Баку)'
    },
    truckTypes: (limits.truckTypes || []).map(t => ({
      id: t.id,
      name: t.name,
      maxWeight: t.maxWeight,
      maxVolume: t.maxVolume
    })),
    limits: {
      maxWeight: limits.maxWeight || 1500,
      maxVolume: limits.maxVolume || 12,
      maxOrders: limits.maxOrders,
      serviceTimeMinutes: limits.serviceTimeMinutes ?? 10
    },
    strategyPrompt: strategyPrompt || limits.aiStrategyPrompt || ''
  };

  onProgress({
    percent: 25,
    message: '🧠 Модель Gemini 3.8 Flash анализирует географию Баку и ограничения транспорта...',
    log: 'Генерация комбинаторного плана распределения автопарка через @google/genai'
  });

  let data: AIOptimizeResponse;
  try {
    const res = await fetch('/api/routes/ai-optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || errJson.details || `HTTP error ${res.status}`);
    }

    data = await res.json();
  } catch (err: any) {
    onProgress({
      percent: 40,
      message: '⚠️ Серверный ИИ вернул ошибку, выполняется переход на резервный алгоритм...',
      log: `Ошибка AI: ${err?.message || err}. Активация Smart Logistics Optimizer.`
    });
    // Fallback to Smart Logistics Optimizer so user is never blocked
    const { runSmartLogistics } = await import('./smartLogisticsOptimizer');
    return runSmartLogistics(orders, limits, onProgress);
  }

  if (!data.routes || data.routes.length === 0) {
    onProgress({
      percent: 50,
      message: '⚠️ ИИ не выделил маршруты, запускается гибридный оптимизатор...',
      log: 'Fallback: запуск Smart Logistics Optimizer'
    });
    const { runSmartLogistics } = await import('./smartLogisticsOptimizer');
    return runSmartLogistics(orders, limits, onProgress);
  }

  onProgress({
    percent: 65,
    message: `✨ ИИ сформировал ${data.routes.length} маршрутов. Расчет дорожной матрицы OSRM...`,
    log: `Анализ ИИ: ${data.overallAnalysis}`
  });

  // Build road distance matrix for accurate road mileage & durations
  const matrix = await buildRoadMatrixLookup(orders, WAREHOUSE_LOCATION);

  const ordersMap = new Map<string, Order>();
  orders.forEach(o => ordersMap.set(o.id, o));

  const finalRoutes: Route[] = [];

  data.routes.forEach((aiRoute, rIdx) => {
    const routeOrders = aiRoute.orderIds
      .map(id => ordersMap.get(id))
      .filter((o): o is Order => Boolean(o));

    if (routeOrders.length === 0) return;

    // Map order IDs back to 1-based indices in the matrix lookup
    const routeIndices = routeOrders
      .map(o => orders.findIndex(ord => ord.id === o.id) + 1)
      .filter(idx => idx > 0);

    const distKm = matrix.calculateRoundTripDistance(routeIndices);
    const durMin = matrix.calculateRoundTripDuration(routeIndices);

    const schedule = evaluateRouteSchedule(
      routeIndices,
      matrix,
      orders,
      limits.serviceTimeMinutes ?? 10,
      8 * 60 // 08:00
    );

    // Compute straight distance
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

    const assignedTruck = aiRoute.assignedTruckTypeId || findBestTruck(routeOrders, limits);
    const hue = Math.round(((rIdx) * 137.508 + 210) % 360);

    const routeName = aiRoute.routeName?.startsWith('Рейс') || aiRoute.routeName?.startsWith('Маршрут')
      ? `🤖 ${aiRoute.routeName}`
      : `🤖 ИИ-${rIdx + 1} (${aiRoute.dominantDistrict || 'Баку'})`;

    finalRoutes.push({
      id: `route-ai-${Date.now()}-${rIdx}`,
      name: routeName,
      orderIds: routeOrders.map(o => o.id),
      color: `hsl(${hue}, 80%, 45%)`,
      isVisible: true,
      distance: distKm,
      straightDistanceKm: straightDistKm,
      roadDistanceKm: distKm,
      roadDurationMin: durMin,
      durationMinutes: schedule.totalDurationMinutes,
      drivingDurationMin: schedule.totalDrivingMinutes,
      waitingDurationMin: schedule.totalWaitingMinutes,
      serviceDurationMin: schedule.totalServiceMinutes,
      totalDurationMin: schedule.totalDurationMinutes,
      isRealRoad: matrix.isRealRoad,
      routingSource: 'AI_GEMINI',
      truckTypeId: assignedTruck,
      description: aiRoute.aiExplanation || 'Оптимизировано нейросетевой моделью Gemini AI',
      whyThisRoute: aiRoute.aiExplanation || 'Оптимизировано нейросетевой моделью Gemini AI'
    });
  });

  onProgress({
    percent: 90,
    message: '🛣️ Загрузка дорожной геометрии маршрутов OSRM...',
    log: 'Построение треков движения по дорожной сети Баку'
  });

  await Promise.all(
    finalRoutes.map(async (route) => {
      const rOrders = route.orderIds
        .map(id => ordersMap.get(id))
        .filter((o): o is Order => Boolean(o));
      if (rOrders.length > 0) {
        try {
          const geo = await getRouteGeometry([WAREHOUSE_LOCATION, ...rOrders, WAREHOUSE_LOCATION]);
          if (geo && geo.length > 0) {
            route.geometry = geo;
          }
        } catch {
          // Keep fallback if geometry fetch fails
        }
      }
    })
  );

  onProgress({
    percent: 100,
    message: `🎉 Готово! Искусственный интеллект построил ${finalRoutes.length} маршрутов.`,
    log: `ИИ распределил ${orders.length} заказов по ${finalRoutes.length} рейсам.`
  });

  return finalRoutes;
}
