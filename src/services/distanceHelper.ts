import { Route, Order, RoutingSource } from '../types';
import { WAREHOUSE_LOCATION } from '../mockData';
import { calculateDistance } from './routingService';
import { RouteNavDetails } from './routingProvider';

/**
 * Calculates accurate straight-line (Haversine) distance for a route including depot round-trip.
 */
export function calculateStraightRouteDistance(
  routeOrders: Order[],
  depot = WAREHOUSE_LOCATION
): number {
  if (!routeOrders || routeOrders.length === 0) return 0;

  let totalDist = 0;
  let prevLat = depot.lat;
  let prevLng = depot.lng;

  for (const order of routeOrders) {
    if (order.lat && order.lng) {
      totalDist += calculateDistance(prevLat, prevLng, order.lat, order.lng);
      prevLat = order.lat;
      prevLng = order.lng;
    }
  }

  // Return trip to depot
  totalDist += calculateDistance(prevLat, prevLng, depot.lat, depot.lng);

  return Math.round(totalDist * 10) / 10;
}

export interface RouteDistanceInfo {
  straightDistanceKm: number;
  roadDistanceKm?: number;
  roadDurationMin?: number;
  routingSource: RoutingSource;
  isRealRoad: boolean;
  isFallback: boolean;
  statusText: string;
  hasRoadData: boolean;
  warning?: string;
}

export interface StoreLegBreakdown {
  storeName: string;
  fromName: string;
  distanceKm: number;
  cumulativeKm: number;
}

export interface RouteLegsBreakdown {
  fromWarehouseKm: number;
  betweenStoresKm: number;
  toWarehouseKm: number;
  totalRoundTripKm: number;
  isRealRoad: boolean;
  storeLegs: StoreLegBreakdown[];
  returnLeg: {
    fromName: string;
    toName: string;
    distanceKm: number;
    cumulativeKm: number;
  };
}

/**
 * Calculates leg-by-leg distance breakdown from the warehouse through all stores in visit order
 * and back to the warehouse (Склад -> Магазины -> Склад).
 */
export function calculateRouteLegs(
  route: Route,
  routeOrders: Order[],
  depot = WAREHOUSE_LOCATION
): RouteLegsBreakdown {
  // Build unique stores list in the exact visit sequence of routeOrders
  const uniqueStores: { name: string; lat: number; lng: number }[] = [];
  const seenStores = new Set<string>();

  for (const o of routeOrders || []) {
    if (!o) continue;
    const key = o.customerName || o.id;
    if (!seenStores.has(key)) {
      seenStores.add(key);
      uniqueStores.push({
        name: o.customerName || 'Магазин',
        lat: Number.isFinite(o.lat) && o.lat !== 0 ? o.lat : depot.lat,
        lng: Number.isFinite(o.lng) && o.lng !== 0 ? o.lng : depot.lng
      });
    }
  }

  if (uniqueStores.length === 0) {
    return {
      fromWarehouseKm: 0,
      betweenStoresKm: 0,
      toWarehouseKm: 0,
      totalRoundTripKm: 0,
      isRealRoad: Boolean(route.isRealRoad),
      storeLegs: [],
      returnLeg: {
        fromName: 'Склад (Баку)',
        toName: 'Склад (Баку)',
        distanceKm: 0,
        cumulativeKm: 0
      }
    };
  }

  // Raw Haversine segments: Depot -> Store 1 -> ... -> Store N -> Depot
  const rawStoreDists: number[] = [];
  let prevLat = depot.lat;
  let prevLng = depot.lng;

  for (const store of uniqueStores) {
    const d = calculateDistance(prevLat, prevLng, store.lat, store.lng);
    rawStoreDists.push(d);
    prevLat = store.lat;
    prevLng = store.lng;
  }

  const rawReturnDist = calculateDistance(prevLat, prevLng, depot.lat, depot.lng);
  const rawTotal = rawStoreDists.reduce((acc, v) => acc + v, 0) + rawReturnDist;

  const effectiveRoadKm =
    route.roadDistanceKm !== undefined && route.roadDistanceKm > 0
      ? route.roadDistanceKm
      : route.distance !== undefined && route.distance > 0
        ? route.distance
        : undefined;

  const targetTotalKm =
    effectiveRoadKm !== undefined && effectiveRoadKm > 0
      ? Math.round(effectiveRoadKm * 10) / 10
      : Math.round(rawTotal * 10) / 10;

  // Scale segments proportionally so their sum matches the route's total round-trip distance
  const scale = rawTotal > 0.001 ? targetTotalKm / rawTotal : 1;

  const storeLegs: StoreLegBreakdown[] = [];
  let cumulative = 0;

  for (let i = 0; i < uniqueStores.length; i++) {
    const legKm = Math.round(rawStoreDists[i] * scale * 10) / 10;
    cumulative = Math.round((cumulative + legKm) * 10) / 10;
    storeLegs.push({
      storeName: uniqueStores[i].name,
      fromName: i === 0 ? 'Склад (Баку)' : uniqueStores[i - 1].name,
      distanceKm: legKm,
      cumulativeKm: cumulative
    });
  }

  // Ensure exact total sum on the return leg to warehouse
  const toWarehouseKm = Math.max(
    0,
    Math.round((targetTotalKm - cumulative) * 10) / 10 || Math.round(rawReturnDist * scale * 10) / 10
  );
  const finalTotalKm = Math.round((cumulative + toWarehouseKm) * 10) / 10;
  const fromWarehouseKm = storeLegs.length > 0 ? storeLegs[0].distanceKm : 0;
  const betweenStoresKm = Math.max(
    0,
    Math.round(storeLegs.slice(1).reduce((s, l) => s + l.distanceKm, 0) * 10) / 10
  );

  return {
    fromWarehouseKm,
    betweenStoresKm,
    toWarehouseKm,
    totalRoundTripKm: finalTotalKm,
    isRealRoad: Boolean(route.isRealRoad && effectiveRoadKm !== undefined && effectiveRoadKm > 0),
    storeLegs,
    returnLeg: {
      fromName: uniqueStores[uniqueStores.length - 1].name,
      toName: 'Склад (Баку)',
      distanceKm: toWarehouseKm,
      cumulativeKm: finalTotalKm
    }
  };
}

/**
 * Extracts and clarifies the distance state of a route.
 * Guarantees that total distance always represents the round trip (Warehouse -> Stores -> Warehouse).
 */
export function getRouteDistanceInfo(route: Route, routeOrders?: Order[]): RouteDistanceInfo {
  const computedStraightKm =
    routeOrders && routeOrders.length > 0 ? calculateStraightRouteDistance(routeOrders) : undefined;

  let straightKm =
    computedStraightKm !== undefined && computedStraightKm > 0
      ? computedStraightKm
      : route.straightDistanceKm;

  if (straightKm === undefined || straightKm <= 0) {
    straightKm = route.distance && route.distance > 0 ? route.distance : 0;
  }

  const effectiveRoadKm =
    route.roadDistanceKm !== undefined && route.roadDistanceKm > 0
      ? route.roadDistanceKm
      : route.isRealRoad && route.distance !== undefined && route.distance > 0
        ? route.distance
        : undefined;

  const isRealRoad = Boolean(route.isRealRoad && effectiveRoadKm !== undefined && effectiveRoadKm > 0);
  const routingSource: RoutingSource = route.routingSource || (isRealRoad ? 'OSRM' : 'HAVERSINE');
  const roadDistanceKm = isRealRoad ? effectiveRoadKm : undefined;
  const roadDurationMin = isRealRoad ? (route.roadDurationMin ?? route.durationMinutes) : undefined;
  const isFallback = !isRealRoad;

  let statusText = 'Дороги OSRM (Склад → Магазины → Склад)';
  let warning: string | undefined = undefined;

  if (isFallback) {
    statusText = 'Расчет по прямой (Склад → Магазины → Склад)';
    warning = 'Ожидание дорожной геометрии OSRM. Показано круговое расстояние по прямой.';
  } else if (routingSource === 'AI_GEMINI') {
    statusText = '🤖 ИИ Gemini + OSRM (Склад → Магазины → Склад)';
  } else if (routingSource === 'BACKUP') {
    statusText = 'Дороги OSRM (Резервный)';
  }

  return {
    straightDistanceKm: straightKm,
    roadDistanceKm,
    roadDurationMin,
    routingSource,
    isRealRoad,
    isFallback,
    statusText,
    hasRoadData: isRealRoad,
    warning
  };
}

export interface NavDetailsInput {
  geometry: [number, number][];
  distanceKm: number;
  durationMinutes?: number;
  isRealRoad: boolean;
  providerUsed?: 'osrm' | 'backup' | 'haversine';
}

/**
 * Safely updates a route with new navigation details while enforcing strict separation.
 */
export function applyNavDetailsToRoute(
  route: Route,
  nav: NavDetailsInput,
  straightDistanceKm?: number | Order[]
): Route;
export function applyNavDetailsToRoute(
  route: Route,
  routeOrders: Order[],
  nav: NavDetailsInput
): Route;
export function applyNavDetailsToRoute(
  route: Route,
  arg2: NavDetailsInput | Order[],
  arg3?: number | Order[] | NavDetailsInput
): Route {
  let nav: NavDetailsInput;
  let straightDistanceKm: number | undefined;

  if (Array.isArray(arg2)) {
    straightDistanceKm = calculateStraightRouteDistance(arg2);
    nav = arg3 as NavDetailsInput;
  } else {
    nav = arg2;
    if (Array.isArray(arg3)) {
      straightDistanceKm = calculateStraightRouteDistance(arg3);
    } else if (typeof arg3 === 'number') {
      straightDistanceKm = arg3;
    }
  }

  const straightKm =
    straightDistanceKm !== undefined && straightDistanceKm > 0
      ? straightDistanceKm
      : route.straightDistanceKm ?? route.distance ?? 0;

  if (nav.isRealRoad && nav.distanceKm > 0) {
    return {
      ...route,
      geometry: nav.geometry,
      straightDistanceKm: straightKm,
      roadDistanceKm: nav.distanceKm,
      roadDurationMin: nav.durationMinutes ?? route.roadDurationMin ?? route.durationMinutes,
      routingSource:
        route.routingSource === 'AI_GEMINI'
          ? 'AI_GEMINI'
          : nav.providerUsed === 'backup'
            ? 'BACKUP'
            : 'OSRM',
      isRealRoad: true,
      distance: nav.distanceKm,
      durationMinutes: nav.durationMinutes ?? route.durationMinutes
    };
  }

  return {
    ...route,
    geometry: nav.geometry && nav.geometry.length > 0 ? nav.geometry : route.geometry,
    straightDistanceKm: straightKm,
    roadDistanceKm: undefined,
    roadDurationMin: undefined,
    routingSource: route.routingSource === 'AI_GEMINI' ? 'AI_GEMINI' : 'HAVERSINE',
    isRealRoad: false,
    distance: straightKm,
    durationMinutes: route.durationMinutes
  };
}

/**
 * Formats duration in minutes into a readable Russian string (e.g. "1 ч 25 мин" or "45 мин").
 */
export function formatDurationMinutes(minutes?: number): string {
  if (!minutes || minutes <= 0) return '—';
  const total = Math.round(minutes); // round first so 59.6 min doesn't become "0 ч 60 мин"
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours > 0) {
    return `${hours} ч ${mins > 0 ? `${mins} мин` : ''}`.trim();
  }
  return `${mins} мин`;
}
