import { Order } from '../../types';
import type { RoutingLimits } from '../routingService';
import { LOAD_TOLERANCE_RATIO, findBestTruck } from './ConstraintValidator';
import { peakLoad } from '../loadProfile';

/**
 * Assigns a truck type to every route when the dispatcher limited how many trucks of a type exist.
 *
 * Rules (as agreed with the dispatcher):
 *   - a type without a count is unlimited (counts are rarely filled in);
 *   - one truck serves ONE route per day: a type with count N can serve at most N routes;
 *   - routes get the smallest type that fits; when it is used up, the next bigger available type.
 * Routes are handled from the heaviest to the lightest, which is optimal for nested capacities.
 */
export interface FleetAssignmentResult {
  /** truck type id per route (best fitting type even when no truck is left) */
  truckIds: (string | undefined)[];
  /** route got no truck because every fitting type is used up */
  noTruck: boolean[];
  unassigned: number;
  /** type id -> missing trucks */
  shortage: Record<string, number>;
}

export function hasFleetLimits(limits: RoutingLimits): boolean {
  return Boolean(limits.truckTypes?.some(t => typeof t.count === 'number' && t.count > 0));
}

function fits(orders: Order[], truck: NonNullable<RoutingLimits['truckTypes']>[number], limits: RoutingLimits): boolean {
  const { w: weight, v: volume } = peakLoad(orders);
  if (weight > truck.maxWeight * LOAD_TOLERANCE_RATIO || volume > truck.maxVolume * LOAD_TOLERANCE_RATIO) return false;
  return orders.every(o => {
    if (!o.allowedTruckType) return true;
    const norm = o.allowedTruckType.trim().toLowerCase();
    const allowed = limits.truckTypes!.find(t => t.id.toLowerCase() === norm || t.name.trim().toLowerCase() === norm);
    return !allowed || truck.rank <= allowed.rank;
  });
}

export function assignFleet(routesOrders: Order[][], limits: RoutingLimits, preassigned?: (string | undefined)[]): FleetAssignmentResult {
  const n = routesOrders.length;
  const truckIds: (string | undefined)[] = routesOrders.map(orders => findBestTruck(orders, limits));
  const noTruck = new Array(n).fill(false);
  const result: FleetAssignmentResult = { truckIds, noTruck, unassigned: 0, shortage: {} };
  if (!limits.truckTypes || limits.truckTypes.length === 0 || !hasFleetLimits(limits)) return result;

  const types = [...limits.truckTypes].sort((a, b) => a.rank - b.rank || a.maxVolume - b.maxVolume);
  const left = new Map(types.map(t => [t.id, typeof t.count === 'number' && t.count > 0 ? t.count : Infinity]));

  // Routes that keep their truck (e.g. locked routes) consume the fleet first
  const order = routesOrders.map((_, i) => i);
  if (preassigned) {
    for (const i of order) {
      const id = preassigned[i];
      if (id && (left.get(id) ?? 0) > 0) {
        truckIds[i] = id;
        left.set(id, (left.get(id) ?? 0) - 1);
      }
    }
  }

  const biggest = types[types.length - 1];
  const demand = (orders: Order[]) => {
    const p = peakLoad(orders);
    return Math.max(p.v / Math.max(0.1, biggest.maxVolume), p.w / Math.max(1, biggest.maxWeight));
  };
  const pending = order.filter(i => !(preassigned && preassigned[i] && truckIds[i] === preassigned[i]));
  pending.sort((a, b) => demand(routesOrders[b]) - demand(routesOrders[a]));

  for (const i of pending) {
    const candidates = types.filter(t => fits(routesOrders[i], t, limits));
    const pick = candidates.find(t => (left.get(t.id) ?? 0) > 0);
    if (pick) {
      truckIds[i] = pick.id;
      left.set(pick.id, (left.get(pick.id) ?? 0) - 1);
    } else {
      noTruck[i] = true;
      result.unassigned++;
      const wanted = candidates[0]?.id ?? truckIds[i];
      if (wanted) result.shortage[wanted] = (result.shortage[wanted] || 0) + 1;
    }
  }
  return result;
}

/**
 * Applies the fleet limits to a whole plan, separately for each shipping date
 * (one route per truck per day). Routes in `keepIds` keep their current truck when it is still available.
 */
export function assignFleetToRoutes<R extends { id: string; orderIds: string[]; truckTypeId?: string; noTruck?: boolean }>(
  routes: R[],
  orders: Order[],
  limits: RoutingLimits,
  keepIds: Set<string>
): { routes: R[]; shortage: Record<string, number> } {
  if (!hasFleetLimits(limits)) {
    return { routes: routes.map(r => (r.noTruck ? { ...r, noTruck: undefined } : r)), shortage: {} };
  }
  const orderMap = new Map(orders.map(o => [o.id, o]));
  const dateOf = (r: R) => {
    const counts = new Map<string, number>();
    r.orderIds.forEach(id => { const d = orderMap.get(id)?.shippingDate || ''; counts.set(d, (counts.get(d) || 0) + 1); });
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  };
  const byDate = new Map<string, number[]>();
  routes.forEach((r, i) => { const d = dateOf(r); if (!byDate.has(d)) byDate.set(d, []); byDate.get(d)!.push(i); });

  const next = [...routes];
  const shortage: Record<string, number> = {};
  byDate.forEach(indices => {
    const lists = indices.map(i => routes[i].orderIds.map(id => orderMap.get(id)).filter((o): o is Order => Boolean(o)));
    const pre = indices.map(i => (keepIds.has(routes[i].id) ? routes[i].truckTypeId : undefined));
    const res = assignFleet(lists, limits, pre);
    indices.forEach((i, k) => { next[i] = { ...routes[i], truckTypeId: res.truckIds[k], noTruck: res.noTruck[k] || undefined }; });
    Object.entries(res.shortage).forEach(([id, c]) => { shortage[id] = (shortage[id] || 0) + c; });
  });
  return { routes: next, shortage };
}
