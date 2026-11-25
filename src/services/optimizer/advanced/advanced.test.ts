import { describe, expect, it } from 'vitest';
import type { Order } from '../../../types';
import type { RoutingLimits } from '../../routingService';
import { WAREHOUSE_LOCATION } from '../../../mockData';
import { calculateDistance } from '../../geo';
import { RoadMatrixLookup } from '../RoadMatrix';
import { getVRPConfigForMode } from '../types';
import { checkHardLimits, evaluateRouteSchedule } from '../ConstraintValidator';
import { assignFleet } from '../FleetAssignment';
import { evaluateSolutionScore } from '../ObjectiveFunction';
import { generateBenchmarkPoints } from '../Benchmark';
import { optimizeAdvanced, coversAll } from './index';
import { compileModel } from './model';
import { construct } from './sisr';
import { createRng } from '../searchControl';

const TRUCKS = [
  { id: 't1', name: 'Газель', maxWeight: 1500, maxVolume: 10, rank: 1 },
  { id: 't2', name: 'Фургон', maxWeight: 3000, maxVolume: 18, rank: 2 },
];

function matrixOf(orders: Order[]): RoadMatrixLookup {
  const pts = [WAREHOUSE_LOCATION, ...orders];
  const n = pts.length;
  const d = Array.from({ length: n }, (_, i) => pts.map((p, j) => (i === j ? 0 : calculateDistance(pts[i].lat, pts[i].lng, p.lat, p.lng) * 1.35)));
  const t = d.map(row => row.map(km => (km / 38) * 60));
  return new RoadMatrixLookup(n, d, t, false, true);
}

const limits = (patch: Partial<RoutingLimits> = {}): RoutingLimits => ({
  maxWeight: 0, maxVolume: 0, maxSatir: 0, maxCustomers: 0, maxRegions: 0, truckTypes: TRUCKS,
  costPerRoute: 50, costPerKm: 2, costPerStore: 0, costPerKg: 0, allowCombineTimeSlots: true, allowCombineDates: true,
  serviceTimeMinutes: 10, ...patch,
});

const config = getVRPConfigForMode('fast', { timeBudgetMs: 700 });

function check(plan: number[][], orders: Order[], lim: RoutingLimits) {
  expect(coversAll(plan, orders.map((_, i) => i + 1))).toBe(true);
  for (const r of plan) {
    expect(checkHardLimits(r.map(i => orders[i - 1]), lim)).toBe(true);
    if (r.length > 1) expect(evaluateRouteSchedule(r, matrixOf(orders), orders, 10, 480).totalDurationMinutes).toBeLessThanOrEqual(600);
  }
}

describe.each(['sisr', 'hgs'] as const)('%s router', engine => {
  it('serves every order once, keeps every limit and beats the greedy start', async () => {
    const orders = generateBenchmarkPoints(60, 11).map(o => ({ ...o, timeSlot: 'День' }));
    const lim = limits({ maxCustomers: 9, maxRegions: 3 });
    const mx = matrixOf(orders);
    const plan = await optimizeAdvanced(engine, orders.map((_, i) => i + 1), orders, mx, lim, config);
    check(plan, orders, lim);
    for (const r of plan) {
      expect(new Set(r.map(i => orders[i - 1].customerName)).size).toBeLessThanOrEqual(9);
      expect(new Set(r.map(i => orders[i - 1].region)).size).toBeLessThanOrEqual(3);
    }
    const m = compileModel(orders.map((_, i) => i + 1), orders, mx, lim, config);
    const greedy = construct(m, createRng(1)).toNodeRoutes();
    const score = (p: number[][]) => evaluateSolutionScore(p, orders, mx, lim, config);
    expect(score(plan)).toBeLessThan(score(greedy));
  });

  it('groups, pairs, locks, allowed truck types and the truck count', async () => {
    const orders = generateBenchmarkPoints(40, 23).map(o => ({ ...o, timeSlot: 'День' }));
    orders[3] = { ...orders[3], allowedTruckType: 't1' }; // only the small truck reaches this store
    const lim = limits({
      mustStayTogether: [[orders[0].id, orders[20].id, orders[35].id]],
      mustNotStayTogether: [[orders[1].id, orders[2].id], [orders[5].id, orders[6].id]],
      lockedStops: { [orders[10].id]: 'R-A', [orders[11].id]: 'R-A' },
      truckTypes: TRUCKS.map(t => ({ ...t, count: t.id === 't2' ? 2 : undefined })),
    });
    const mx = matrixOf(orders);
    const plan = await optimizeAdvanced(engine, orders.map((_, i) => i + 1), orders, mx, lim, config);
    check(plan, orders, lim);
    const routeOf = (k: number) => plan.findIndex(r => r.includes(k + 1));
    expect(new Set([0, 20, 35].map(routeOf)).size).toBe(1);
    expect(routeOf(1)).not.toBe(routeOf(2));
    expect(routeOf(5)).not.toBe(routeOf(6));
    expect(routeOf(10)).toBe(routeOf(11));
    const r3 = plan[routeOf(3)].map(i => orders[i - 1]);
    expect(r3.reduce((s, o) => s + o.volume, 0)).toBeLessThanOrEqual(10 * 1.03);
    expect(assignFleet(plan.map(r => r.map(i => orders[i - 1])), lim).unassigned).toBe(0);
  });
});
