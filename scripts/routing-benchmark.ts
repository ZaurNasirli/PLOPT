/**
 * Yol routers on the same data, scored the same way:
 *   npx tsx scripts/routing-benchmark.ts [--only smart,sisr] [--mode balanced] [--instances bakuSmall,bench100]
 *
 * Instances (deterministic, no network): Baku stores of _rota_import/try_2.xlsx (when present) and the
 * app's own synthetic benchmark points. Distances: the app's offline estimate (straight line × 1.35,
 * 38 km/h) so every router is measured on the same matrix. Classic routers plan on straight lines,
 * SMART and the new routers on the matrix; all results are measured on the matrix.
 */
import { existsSync, readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import type { Order, Route } from '../src/types';
import { WAREHOUSE_LOCATION } from '../src/mockData';
import { calculateDistance } from '../src/services/geo';
import * as RS from '../src/services/routingService';
import type { RoutingLimits } from '../src/services/routingService';
import { RoadMatrixLookup } from '../src/services/optimizer/RoadMatrix';
import { getVRPConfigForMode, OptimizationMode } from '../src/services/optimizer/types';
import { optimizeMultiStartVRP } from '../src/services/optimizer/MultiStartOptimizer';
import { evaluateSolutionScore } from '../src/services/optimizer/ObjectiveFunction';
import { checkHardLimits, evaluateRouteSchedule } from '../src/services/optimizer/ConstraintValidator';
import { assignFleet } from '../src/services/optimizer/FleetAssignment';
import { generateBenchmarkPoints } from '../src/services/optimizer/Benchmark';
import { optimizeAdvanced } from '../src/services/optimizer/advanced';

const args = process.argv.slice(2);
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const only = arg('--only')?.split(',');
const mode = (arg('--mode') ?? 'balanced') as OptimizationMode;
const onlyInst = arg('--instances')?.split(',');

const TRUCKS = [
  { id: 'truck-1', name: 'Газель 1.5т', maxWeight: 1500, maxVolume: 10, rank: 1 },
  { id: 'truck-2', name: 'Фургон 3.0т', maxWeight: 3000, maxVolume: 18, rank: 2 },
  { id: 'truck-3', name: 'Грузовик 5.0т', maxWeight: 5000, maxVolume: 30, rank: 3 },
];
const baseLimits = (patch: Partial<RoutingLimits> = {}): RoutingLimits => ({
  maxWeight: 0, maxVolume: 0, maxSatir: 0, maxCustomers: 0, maxRegions: 0, truckTypes: TRUCKS,
  costPerRoute: 50, costPerKm: 2, costPerStore: 5, costPerKg: 0.1,
  allowCombineTimeSlots: false, allowCombineDates: false, optimizationMode: mode, timeWindowMode: 'soft', serviceTimeMinutes: 10,
  ...patch,
});

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Instance { name: string; orders: Order[]; limits: RoutingLimits }

function bakuStores(): Array<{ code: string; name: string; region: string; lat: number; lng: number; days: string; vol: number; kg: number; pcs: number }> {
  const p = '_rota_import/try_2.xlsx';
  if (!existsSync(p)) return [];
  const wb = XLSX.read(readFileSync(p));
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 }).slice(1) as unknown[][];
  return rows.filter(r => r[0] && Number(r[7]) && Number(r[8])).map(r => ({
    code: String(r[0]), name: String(r[1]), region: String(r[3]), lat: Number(r[7]), lng: Number(r[8]),
    days: String(r[5] ?? ''), vol: Number(r[9]) || 0, kg: Number(r[10]) || 0, pcs: Number(r[11]) || 0,
  }));
}

function instances(): Instance[] {
  const out: Instance[] = [];
  const stores = bakuStores();
  if (stores.length) {
    // Monday orders of the real stores: weekly volume / shipment days (big orders, 2–4 stops a truck)
    const mon = stores.filter(s => s.days.includes('1'));
    out.push({
      name: 'bakuBig', limits: baseLimits(),
      orders: mon.map((s, i) => {
        const n = Math.max(1, s.days.replace(/[^1-7]/g, '').length);
        return { id: `b${i}`, orderNumber: `B${i}`, customerName: s.name, code: s.code, weight: Math.round(s.kg / n), volume: Math.round((s.vol / n) * 100) / 100,
          region: s.region, satir: Math.round(s.pcs / n / 20), days: [1], timeSlot: 'День', shippingDate: '01.12.2026', lat: s.lat, lng: s.lng, status: 'not-in-route' } as Order;
      }),
    });
    // The same stores with small orders (8–15 stops a truck): sequencing matters
    const r = rng(5);
    const pick = stores.filter((_, i) => i % 3 === 0);
    out.push({
      name: 'bakuSmall', limits: baseLimits(),
      orders: pick.map((s, i) => ({ id: `s${i}`, orderNumber: `S${i}`, customerName: s.name, code: s.code, weight: Math.round(60 + r() * 240), volume: Math.round((0.4 + r() * 2.2) * 10) / 10,
        region: s.region, satir: Math.floor(1 + r() * 10), days: [1], timeSlot: 'День', shippingDate: '01.12.2026', lat: s.lat, lng: s.lng, status: 'not-in-route' } as Order)),
    });
    // Same, with a limit of 12 stops and 3 regions per truck, and few big trucks
    out.push({
      name: 'bakuLimits', limits: baseLimits({ maxCustomers: 12, maxRegions: 3, truckTypes: TRUCKS.map(t => ({ ...t, count: t.rank === 3 ? 2 : undefined })) }),
      orders: out[out.length - 1].orders.map(o => ({ ...o, id: `l${o.id}` })),
    });
  }
  // The app's own benchmark generator (3 time slots -> 3 separate groups)
  const benchLimits = baseLimits({ maxWeight: 1500, maxVolume: 12, truckTypes: TRUCKS.slice(0, 2) });
  out.push({ name: 'bench100', orders: generateBenchmarkPoints(100, 1700), limits: benchLimits });
  out.push({ name: 'bench300', orders: generateBenchmarkPoints(300, 5100), limits: benchLimits });
  return onlyInst ? out.filter(i => onlyInst.includes(i.name)) : out;
}

/** The app's offline matrix: straight line × 1.35, 38 km/h */
export function estimateMatrix(orders: Order[]): RoadMatrixLookup {
  const pts = [WAREHOUSE_LOCATION, ...orders];
  const n = pts.length;
  const d = Array.from({ length: n }, () => new Array(n).fill(0));
  const t = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (i === j) continue;
    const km = Math.round(Math.round(calculateDistance(pts[i].lat, pts[i].lng, pts[j].lat, pts[j].lng) * 10) / 10 * 1.35 * 10) / 10;
    d[i][j] = km; t[i][j] = Math.round((km / 38) * 60);
  }
  return new RoadMatrixLookup(n, d, t, false, true);
}

export function partitions(orders: Order[], limits: RoutingLimits): Order[][] {
  const m = new Map<string, Order[]>();
  for (const o of orders) {
    const k = `${limits.allowCombineDates === false ? o.shippingDate || '' : '*'}__${limits.allowCombineTimeSlots === false ? o.timeSlot || '' : '*'}`;
    m.set(k, [...(m.get(k) ?? []), o]);
  }
  return [...m.values()];
}

type Planner = (part: Order[], matrix: RoadMatrixLookup, limits: RoutingLimits) => Promise<number[][]>;

const classic = (fn: (o: Order[], l: RoutingLimits, p: (x: RS.ProgressUpdate) => void) => Promise<Route[]>): Planner => async (part, _m, limits) => {
  const routes = await fn(part, limits, () => {});
  const idx = new Map(part.map((o, i) => [o.id, i + 1]));
  return routes.map(r => r.orderIds.map(id => idx.get(id)!).filter(Boolean));
};

const smart = (m: OptimizationMode): Planner => (part, matrix, limits) =>
  optimizeMultiStartVRP(part.map((_, i) => i + 1), part, matrix, limits, getVRPConfigForMode(m));

export const PLANNERS: Record<string, Planner> = {
  savings: classic(RS.runSavings), ss: classic(RS.runSequentialSavings), sweep: classic(RS.runSweep), cluster: classic(RS.runCluster),
  nn: classic(RS.runNearestNeighbor), ni: classic(RS.runNearestInsertion), fi: classic(RS.runFarthestInsertion),
  sa: classic(RS.runSimulatedAnnealing), grasp: classic(RS.runGRASP), tabu_search: classic(RS.runTabuSearch), genetic_algo: classic(RS.runGeneticAlgorithm),
  ls: classic(RS.runLocalSearch), vns: classic(RS.runVNS), ils: classic(RS.runILS), lns: classic(RS.runLNS),
  aco: classic(RS.runACO), pso: classic(RS.runPSO), bco: classic(RS.runBCO),
  smart: smart(mode),
  sisr: (part, matrix, limits) => optimizeAdvanced('sisr', part.map((_, i) => i + 1), part, matrix, limits, getVRPConfigForMode(mode)),
  hgs: (part, matrix, limits) => optimizeAdvanced('hgs', part.map((_, i) => i + 1), part, matrix, limits, getVRPConfigForMode(mode)),
};

export interface Score { routes: number; km: number; hours: number; maxH: number; over: number; bad: number; noTruck: number; cost: number; smart: number; ms: number }

export function score(plan: number[][], part: Order[], matrix: RoadMatrixLookup, limits: RoutingLimits): Omit<Score, 'ms'> {
  const routes = plan.filter(r => r.length);
  let km = 0, min = 0, maxMin = 0, over = 0, bad = 0;
  for (const r of routes) {
    km += matrix.calculateRoundTripDistance(r);
    const s = evaluateRouteSchedule(r, matrix, part, limits.serviceTimeMinutes ?? 10, 480);
    min += s.totalDurationMinutes; maxMin = Math.max(maxMin, s.totalDurationMinutes);
    if (s.totalDurationMinutes > 600) over++;
    if (!checkHardLimits(r.map(i => part[i - 1]), limits)) bad++;
  }
  const noTruck = assignFleet(routes.map(r => r.map(i => part[i - 1])), limits).unassigned;
  return { routes: routes.length, km, hours: min / 60, maxH: maxMin / 60, over, bad, noTruck, cost: 50 * routes.length + 2 * km,
    smart: evaluateSolutionScore(routes, part, matrix, limits, getVRPConfigForMode(mode)) };
}

export async function runOne(name: string, plan: Planner, inst: Instance): Promise<Score> {
  const tot: Score = { routes: 0, km: 0, hours: 0, maxH: 0, over: 0, bad: 0, noTruck: 0, cost: 0, smart: 0, ms: 0 };
  for (const part of partitions(inst.orders, inst.limits)) {
    const matrix = estimateMatrix(part);
    const t0 = Date.now();
    const p = await plan(part, matrix, inst.limits);
    tot.ms += Date.now() - t0;
    // every order exactly once
    const seen = p.flat().sort((a, b) => a - b);
    if (seen.length !== part.length || seen.some((v, i) => v !== i + 1)) throw new Error(`${name}: plan does not cover every order once`);
    const s = score(p, part, matrix, inst.limits);
    tot.routes += s.routes; tot.km += s.km; tot.hours += s.hours; tot.maxH = Math.max(tot.maxH, s.maxH);
    tot.over += s.over; tot.bad += s.bad; tot.noTruck += s.noTruck; tot.cost += s.cost; tot.smart += s.smart;
  }
  return tot;
}

export async function main(extra: Record<string, Planner> = {}) {
  const all = { ...PLANNERS, ...extra };
  const names = Object.keys(all).filter(n => !only || only.includes(n));
  for (const inst of instances()) {
    const parts = partitions(inst.orders, inst.limits);
    console.log(`\n## ${inst.name}: ${inst.orders.length} orders, ${parts.length} group(s), ${inst.orders.reduce((s, o) => s + o.volume, 0).toFixed(0)} m³`);
    console.log('| router | trucks | km | hours | max h | >10h | broken | no truck | cost | SMART score | time s |');
    console.log('|---|---|---|---|---|---|---|---|---|---|---|');
    const rows: Array<[string, Score]> = [];
    for (const n of names) {
      try {
        const s = await runOne(n, all[n], inst);
        rows.push([n, s]);
        console.log(`| ${n} | ${s.routes} | ${s.km.toFixed(1)} | ${s.hours.toFixed(1)} | ${s.maxH.toFixed(1)} | ${s.over} | ${s.bad} | ${s.noTruck} | ${s.cost.toFixed(0)} | ${Number.isFinite(s.smart) ? s.smart.toFixed(3) : '∞'} | ${(s.ms / 1000).toFixed(1)} |`);
      } catch (e) {
        console.log(`| ${n} | error: ${(e as Error).message} |`);
      }
    }
  }
}

if (process.argv[1]?.endsWith('routing-benchmark.ts')) main();
