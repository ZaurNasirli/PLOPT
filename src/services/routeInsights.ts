import { Order, Route } from '../types';
import type { RoutingLimits } from './routingService';
import { getRouteDistanceInfo, calculateRouteLegs } from './distanceHelper';
import { peakLoad } from './loadProfile';

export type RouteStatus = 'notruck' | 'blocked' | 'over' | 'low' | 'long' | 'ok';

export interface RouteStop {
  name: string;
  orders: number;
  volume: number;
  weight: number;
  legKm: number;
  cumulativeKm: number;
}

export interface RouteInsight {
  route: Route;
  orders: Order[];
  stops: RouteStop[];
  stopsCount: number;
  km: number;
  isRealRoad: boolean;
  drivingMin: number;
  serviceMin: number;
  totalMin: number;
  volume: number;
  weight: number;
  volPct: number | null;
  wtPct: number | null;
  /** max of volume/weight load, used for the load bar */
  loadPct: number | null;
  truckName: string | null;
  returnKm: number;
  status: RouteStatus;
}

/** Load below this share of the truck is reported as under-loaded */
export const LOW_LOAD_PCT = 45;
/** Same 3% tolerance the optimizer and the plan validator allow */
export const OVERLOAD_PCT = 103;

export function buildRouteInsights(routes: Route[], allOrders: Order[], limits: RoutingLimits): RouteInsight[] {
  const orderMap = new Map(allOrders.map(o => [o.id, o]));
  const base = routes.map(route => {
    const orders = route.orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o));
    const info = getRouteDistanceInfo(route, orders);
    const legs = calculateRouteLegs(route, orders);
    const km = info.roadDistanceKm ?? info.straightDistanceKm ?? route.distance ?? 0;

    // stops in visit order, one per store
    const stops: RouteStop[] = [];
    const byName = new Map<string, RouteStop>();
    for (const o of orders) {
      const key = o.customerName || o.id;
      let stop = byName.get(key);
      if (!stop) {
        const leg = legs.storeLegs[stops.length];
        stop = { name: o.customerName || '—', orders: 0, volume: 0, weight: 0, legKm: leg?.distanceKm ?? 0, cumulativeKm: leg?.cumulativeKm ?? 0 };
        byName.set(key, stop);
        stops.push(stop);
      }
      stop.orders += 1;
      stop.volume += o.volume || 0;
      stop.weight += o.weight || 0;
    }

    // highest load along the route (transfers are picked up on the way)
    const { v: volume, w: weight } = peakLoad(orders);
    const truck = route.truckTypeId ? limits.truckTypes?.find(t => t.id === route.truckTypeId) : undefined;
    const maxV = truck?.maxVolume || limits.maxVolume || 0;
    const maxW = truck?.maxWeight || limits.maxWeight || 0;
    const volPct = maxV > 0 ? Math.round((volume / maxV) * 100) : null;
    const wtPct = maxW > 0 ? Math.round((weight / maxW) * 100) : null;
    const loadPct = volPct === null && wtPct === null ? null : Math.max(volPct ?? 0, wtPct ?? 0);

    const drivingMin = Math.round(info.roadDurationMin ?? route.drivingDurationMin ?? (km / 38) * 60);
    const serviceMin = stops.length * (limits.serviceTimeMinutes ?? 10);

    return {
      route, orders, stops, stopsCount: stops.length, km: Math.round(km * 10) / 10, isRealRoad: info.isRealRoad,
      drivingMin, serviceMin, totalMin: drivingMin + serviceMin,
      volume, weight, volPct, wtPct, loadPct, truckName: truck?.name ?? null,
      returnKm: legs.toWarehouseKm,
      status: 'ok' as RouteStatus
    };
  });

  // "Long": clearly longer than the typical route of this plan
  const kms = base.map(b => b.km).sort((a, b) => a - b);
  const median = kms.length ? kms[Math.floor(kms.length / 2)] : 0;
  const longKm = Math.max(median * 1.5, median + 25);

  for (const b of base) {
    b.status =
      b.route.noTruck ? 'notruck'
      : b.route.barrierStatus === 'blocked' ? 'blocked'
      : b.loadPct !== null && b.loadPct > OVERLOAD_PCT ? 'over'
      : b.loadPct !== null && b.loadPct < LOW_LOAD_PCT ? 'low'
      : base.length >= 3 && b.km > longKm ? 'long'
      : 'ok';
  }
  return base;
}

export const statusTone: Record<RouteStatus, 'bad' | 'warn' | 'info' | 'ok'> = {
  notruck: 'bad', blocked: 'bad', over: 'bad', low: 'warn', long: 'info', ok: 'ok'
};
export const statusIcon: Record<RouteStatus, string> = {
  notruck: '✕', blocked: '⛔', over: '▲', low: '▼', long: '↔', ok: '✓'
};

export function formatHoursMinutes(min: number, hUnit = "ч", mUnit = "мин"): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h} ${hUnit} ${String(r).padStart(2, "0")} ${mUnit}` : `${r} ${mUnit}`;
}
