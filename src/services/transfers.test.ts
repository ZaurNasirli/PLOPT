import { describe, expect, it } from 'vitest';
import type { Order, Route } from '../types';
import type { RoutingLimits } from './routingService';
import { WAREHOUSE_LOCATION } from '../mockData';
import { calculateDistance } from './geo';
import { RoadMatrixLookup } from './optimizer/RoadMatrix';
import { getVRPConfigForMode } from './optimizer/types';
import { checkHardLimits } from './optimizer/ConstraintValidator';
import { generateBenchmarkPoints } from './optimizer/Benchmark';
import { optimizeMultiStartVRP } from './optimizer/MultiStartOptimizer';
import { optimizeAdvanced } from './optimizer/advanced';
import {
  brokenTransfers, contractTransfers, isPickup, makeTransfer, normalizeTransferRoutes, withPartners, withoutOrphanPickups,
} from './transfers';
import {
  runSavings, runSweep, runCluster, runNearestNeighbor, runNearestInsertion, runFarthestInsertion, runSequentialSavings,
  runSimulatedAnnealing, runGRASP, runGenetic, runTabu, runLocalSearch, runRandomizedGreedy,
  runVNS, runILS, runACO, runPSO, runBCO, runLNS, runTabuSearch, runGeneticAlgorithm, runClarkeWrightSavings,
} from './routingService';

const TRUCKS = [
  { id: 't1', name: 'Газель', maxWeight: 1500, maxVolume: 10, rank: 1 },
  { id: 't2', name: 'Фургон', maxWeight: 3000, maxVolume: 18, rank: 2 },
];
const limits = (patch: Partial<RoutingLimits> = {}): RoutingLimits => ({
  maxWeight: 0, maxVolume: 0, maxSatir: 0, maxCustomers: 0, maxRegions: 0, truckTypes: TRUCKS,
  costPerRoute: 50, costPerKm: 2, costPerStore: 0, costPerKg: 0, allowCombineTimeSlots: true, allowCombineDates: true,
  serviceTimeMinutes: 10, ...patch,
});
const config = getVRPConfigForMode('fast', { timeBudgetMs: 600 });

function matrixOf(orders: Order[]): RoadMatrixLookup {
  const pts = [WAREHOUSE_LOCATION, ...orders];
  const n = pts.length;
  const d = Array.from({ length: n }, (_, i) => pts.map((p, j) => (i === j ? 0 : calculateDistance(pts[i].lat, pts[i].lng, p.lat, p.lng) * 1.35)));
  const t = d.map(row => row.map(km => (km / 38) * 60));
  return new RoadMatrixLookup(n, d, t, false, true);
}

/** benchmark orders where every 5th delivery becomes a transfer from another store of the set */
function withTransfers(count: number, seed: number): Order[] {
  const base = generateBenchmarkPoints(count, seed).map(o => ({ ...o, timeSlot: 'День' }));
  const out: Order[] = [];
  base.forEach((o, i) => {
    if (i % 5 === 2) {
      const src = base[(i * 7 + 3) % base.length];
      out.push(...makeTransfer(o, { code: src.code, name: src.customerName, lat: src.lat, lng: src.lng, region: src.region }));
    } else out.push(o);
  });
  return out;
}

const route = (id: string, orderIds: string[]): Route => ({ id, name: id, color: '#000', orderIds, isVisible: true, distance: 0 });

describe('makeTransfer', () => {
  it('keeps the load on the drop and moves only the label to the pickup', () => {
    const [o] = generateBenchmarkPoints(1, 3);
    const [drop, pickup] = makeTransfer(o, { code: 'S1', name: 'Store One', lat: 40.4, lng: 49.9 });
    expect(drop).toMatchObject({ id: o.id, stopType: 'drop', volume: o.volume, weight: o.weight, transferStoreCode: 'S1' });
    expect(pickup).toMatchObject({ stopType: 'pickup', volume: 0, weight: 0, transferVolume: o.volume, customerName: 'Store One', transferStoreName: o.customerName });
    expect(pickup.transferId).toBe(drop.transferId);
  });
});

describe('normalizeTransferRoutes', () => {
  const orders = withTransfers(10, 5);
  const drop = orders.find(o => o.stopType === 'drop')!;
  const pickup = orders.find(o => isPickup(o) && o.transferId === drop.transferId)!;
  const others = orders.filter(o => !o.transferId).map(o => o.id);

  it('moves a pickup from another route in front of its drop', () => {
    const rs = [route('A', [others[0], drop.id, others[1]]), route('B', [pickup.id, others[2]])];
    const res = normalizeTransferRoutes(rs, orders, WAREHOUSE_LOCATION);
    expect(res.changed).toBe(true);
    expect(brokenTransfers(res.routes, res.orders)).toEqual([]);
    expect(res.routes.find(r => r.id === 'B')!.orderIds).toEqual([others[2]]);
    expect(res.orders.find(o => o.id === pickup.id)).toMatchObject({ routeId: 'A', status: 'in-route' });
  });

  it('puts a pickup that stands after its drop before it', () => {
    const rs = [route('A', [drop.id, others[0], pickup.id])];
    const res = normalizeTransferRoutes(rs, orders, WAREHOUSE_LOCATION);
    const seq = res.routes[0].orderIds;
    expect(seq.indexOf(pickup.id)).toBeLessThan(seq.indexOf(drop.id));
  });

  it('takes out a pickup whose drop is in no route, and drops pickup-only routes', () => {
    const rs = [route('A', [others[0]]), route('B', [pickup.id])];
    const res = normalizeTransferRoutes(rs, orders, WAREHOUSE_LOCATION);
    expect(res.routes.map(r => r.id)).toEqual(['A']);
    expect(res.orders.find(o => o.id === pickup.id)!.status).toBe('not-in-route');
  });

  it('returns the same arrays when every rule holds (safe to run on every change)', () => {
    const rs = [route('A', [pickup.id, others[0], drop.id])];
    const res = normalizeTransferRoutes(rs, orders, WAREHOUSE_LOCATION);
    expect(res.changed).toBe(false);
    expect(res.routes).toBe(rs);
    expect(res.orders).toBe(orders);
  });

  it('withPartners adds the missing half, withoutOrphanPickups drops lonely pickups', () => {
    expect(withPartners([drop], orders).map(o => o.id).sort()).toEqual([drop.id, pickup.id].sort());
    expect(withoutOrphanPickups([pickup])).toEqual([]);
  });
});

describe('contractTransfers', () => {
  it('gives every folded route the exact km and minutes of the expanded route', () => {
    const orders = withTransfers(30, 9);
    const mx = matrixOf(orders);
    const c = contractTransfers(orders, mx, 10);
    expect(c.pairs).toBe(orders.filter(isPickup).length);
    expect(c.orders.some(isPickup)).toBe(false);
    const nodes = c.orders.map((_, i) => i + 1);
    const plan = [nodes.slice(0, 9), nodes.slice(9).reverse()];
    const exp = c.expand(plan);
    for (let k = 0; k < plan.length; k++) {
      expect(c.matrix.calculateRoundTripDistance(plan[k])).toBeCloseTo(mx.calculateRoundTripDistance(exp[k]), 1);
    }
    expect(exp.flat().sort((a, b) => a - b)).toEqual(orders.map((_, i) => i + 1));
  });
});

const ok = (plan: number[][], orders: Order[], lim: RoutingLimits) => {
  const routes = plan.map((r, k) => route(`R${k}`, r.map(i => orders[i - 1].id)));
  expect(brokenTransfers(routes, orders)).toEqual([]);
  expect(plan.flat().sort((a, b) => a - b)).toEqual(orders.map((_, i) => i + 1));
  for (const r of plan) expect(checkHardLimits(r.map(i => orders[i - 1]), lim)).toBe(true);
};

describe('matrix routers keep the transfer rules', () => {
  const orders = withTransfers(45, 17);
  const lim = limits({ maxCustomers: 12 });
  const run = async (engine: 'smart' | 'sisr' | 'hgs') => {
    const mx = matrixOf(orders);
    const c = contractTransfers(orders, mx, 10);
    const idx = c.orders.map((_, i) => i + 1);
    const raw = engine === 'smart'
      ? await optimizeMultiStartVRP(idx, c.orders, c.matrix, lim, config)
      : await optimizeAdvanced(engine, idx, c.orders, c.matrix, lim, config);
    return c.expand(raw);
  };
  it.each(['smart', 'sisr', 'hgs'] as const)('%s', async engine => {
    ok(await run(engine), orders, lim);
  }, 20000);
});

describe('every other router keeps the transfer rules after the repair', () => {
  const orders = withTransfers(40, 29);
  const lim = limits({ maxVolume: 18, maxWeight: 3000 });
  const algos = {
    runSavings, runSweep, runCluster, runNearestNeighbor, runNearestInsertion, runFarthestInsertion, runSequentialSavings,
    runSimulatedAnnealing, runGRASP, runGenetic, runTabu, runLocalSearch, runRandomizedGreedy,
    runVNS, runILS, runACO, runPSO, runBCO, runLNS, runTabuSearch, runGeneticAlgorithm, runClarkeWrightSavings,
  };
  it.each(Object.entries(algos))('%s', async (_name, algo) => {
    // routers that do not use the matrix get the drops only; the repair puts every pickup in front of its drop
    const routed = await algo(orders.filter(o => !isPickup(o)), lim, () => {});
    const res = normalizeTransferRoutes(routed, orders, WAREHOUSE_LOCATION, { polish: true });
    const byId = new Map(orders.map(o => [o.id, o]));
    expect(brokenTransfers(res.routes, orders)).toEqual([]);
    expect(res.routes.flatMap(r => r.orderIds).sort()).toEqual(orders.map(o => o.id).sort());
    for (const r of res.routes) expect(checkHardLimits(r.orderIds.map(id => byId.get(id)!), lim)).toBe(true);
  }, 20000);
});
