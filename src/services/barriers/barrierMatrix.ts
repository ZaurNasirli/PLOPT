// Applies road barriers to a distance/duration matrix used by the optimizer.
//
// The base matrix comes from OSRM, which cannot avoid closed roads. Re-querying the whole
// matrix from Valhalla is not possible on the free server (100 pairs per request), so:
//   1. One OSRM table request measures travel time from every point to every barrier probe
//      and back. The fastest trip i→j goes through barrier b exactly when
//      t(i→b) + t(b→j) ≈ t(i→j). Only those pairs are affected.
//   2. Affected pairs are re-measured with Valhalla twice — with and without the barriers —
//      and the OSRM value is scaled by that ratio. This keeps every cell on the same (OSRM)
//      scale while adding the real detour cost.

import { RoadBarrier } from '../../types';
import { getBarrierHash, barrierProbePoints } from './barrierStore';
import { LatLng, haversineMeters } from './geometry';
import { valhallaMatrix, ValhallaMatrixCell, MAX_MATRIX_PAIRS } from './valhallaClient';

const OSRM_TABLE_ENDPOINTS = [
  'https://router.project-osrm.org/table/v1/driving/',
  'https://routing.openstreetmap.de/routed-car/table/v1/driving/'
];
const OSRM_MAX_COORDS = 100;
const MAX_PROBES = 45;
/** Upper bound of Valhalla requests per matrix (with + without barriers), protects the free server */
const MAX_VALHALLA_REQUESTS = 80;
/** Penalty for a pair that cannot be driven at all once barriers are applied */
const UNREACHABLE_PENALTY_MIN = 240;
const UNREACHABLE_PENALTY_KM = 50;

export interface BarrierMatrixInfo {
  barriersCount: number;
  /** pairs whose fastest route goes through a barrier */
  affectedPairs: number;
  /** affected pairs corrected with real Valhalla detours */
  correctedPairs: number;
  /** pairs that became impossible to drive */
  unreachablePairs: number;
  valhallaRequests: number;
  /** some affected pairs could not be corrected (server unavailable or request budget exhausted) */
  partial: boolean;
  /** probe times came from a straight-line estimate because OSRM was unavailable */
  usedEstimate: boolean;
}

// Barrier-independent Valhalla values per pair, plus barrier-specific ones (keyed by barrier hash)
const baseCache = new Map<string, ValhallaMatrixCell | null>();
const barrierCache = new Map<string, ValhallaMatrixCell | null>();
const coordKey = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
const pairKey = (a: LatLng, b: LatLng) => `${coordKey(a)}->${coordKey(b)}`;

async function fetchOsrmTable(
  coords: LatLng[],
  sources: number[],
  destinations: number[]
): Promise<(number | null)[][] | null> {
  const coordStr = coords.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const query = `?annotations=duration&sources=${sources.join(';')}&destinations=${destinations.join(';')}`;
  for (const base of OSRM_TABLE_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(base + coordStr + query, { signal: controller.signal });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.code === 'Ok' && Array.isArray(data.durations)) return data.durations;
    } catch {
      // try next endpoint
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Travel times (seconds) point→probe [n][k] and probe→point [k][n] via OSRM. */
export async function fetchProbeTimes(
  points: LatLng[],
  probes: LatLng[]
): Promise<{ to: (number | null)[][]; from: (number | null)[][] } | null> {
  const k = probes.length;
  const chunkSize = Math.max(1, OSRM_MAX_COORDS - k);
  const to: (number | null)[][] = points.map(() => new Array(k).fill(null));
  const from: (number | null)[][] = probes.map(() => new Array(points.length).fill(null));

  for (let start = 0; start < points.length; start += chunkSize) {
    const chunk = points.slice(start, start + chunkSize);
    const coords = [...chunk, ...probes];
    const chunkIdx = chunk.map((_, i) => i);
    const probeIdx = probes.map((_, i) => chunk.length + i);

    const [toRes, fromRes] = await Promise.all([
      fetchOsrmTable(coords, chunkIdx, probeIdx),
      fetchOsrmTable(coords, probeIdx, chunkIdx)
    ]);
    if (!toRes || !fromRes) return null;
    for (let i = 0; i < chunk.length; i++) {
      for (let b = 0; b < k; b++) {
        to[start + i][b] = toRes[i]?.[b] ?? null;
        from[b][start + i] = fromRes[b]?.[i] ?? null;
      }
    }
  }
  return { to, from };
}

/** Groups pairs into sources × targets blocks of at most 100 pairs. */
export function packPairs(pairs: [number, number][]): { sources: number[]; targets: number[] }[] {
  const bySource = new Map<number, Set<number>>();
  for (const [i, j] of pairs) {
    if (!bySource.has(i)) bySource.set(i, new Set());
    bySource.get(i)!.add(j);
  }
  const blocks: { sources: number[]; targets: number[] }[] = [];
  let current: { sources: number[]; targets: Set<number> } | null = null;

  const sources = Array.from(bySource.keys()).sort((a, b) => a - b);
  for (const s of sources) {
    const targets = Array.from(bySource.get(s)!).sort((a, b) => a - b);
    // a single source with many targets is split on its own
    if (targets.length > MAX_MATRIX_PAIRS / 2) {
      for (let t = 0; t < targets.length; t += MAX_MATRIX_PAIRS) {
        blocks.push({ sources: [s], targets: targets.slice(t, t + MAX_MATRIX_PAIRS) });
      }
      continue;
    }
    if (current) {
      const union = new Set([...current.targets, ...targets]);
      if ((current.sources.length + 1) * union.size <= MAX_MATRIX_PAIRS) {
        current.sources.push(s);
        current.targets = union;
        continue;
      }
      blocks.push({ sources: current.sources, targets: Array.from(current.targets) });
    }
    current = { sources: [s], targets: new Set(targets) };
  }
  if (current) blocks.push({ sources: current.sources, targets: Array.from(current.targets) });
  return blocks;
}

/**
 * Returns corrected copies of `distances` (km) and `durations` (min) for `points`
 * (index 0 = depot) with the active barriers taken into account.
 */
export async function applyBarriersToMatrix(
  points: LatLng[],
  distances: number[][],
  durations: number[][],
  barriers: RoadBarrier[]
): Promise<{ distances: number[][]; durations: number[][]; info: BarrierMatrixInfo }> {
  const n = points.length;
  const dist = distances.map(r => [...r]);
  const dur = durations.map(r => [...r]);
  const info: BarrierMatrixInfo = {
    barriersCount: barriers.length,
    affectedPairs: 0,
    correctedPairs: 0,
    unreachablePairs: 0,
    valhallaRequests: 0,
    partial: false,
    usedEstimate: false
  };
  if (n < 2 || barriers.length === 0) return { distances: dist, durations: dur, info };

  // 1. Which pairs can go through a barrier?
  let probes = barriers.flatMap(b => barrierProbePoints(b));
  if (probes.length > MAX_PROBES) {
    const step = probes.length / MAX_PROBES;
    probes = Array.from({ length: MAX_PROBES }, (_, i) => probes[Math.floor(i * step)]);
  }
  const probeTimes = await fetchProbeTimes(points, probes.map(p => p.point));

  const affected: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const baseSec = dur[i][j] * 60;
      let through = false;
      for (let b = 0; b < probes.length && !through; b++) {
        if (probeTimes) {
          const t1 = probeTimes.to[i][b];
          const t2 = probeTimes.from[b][j];
          if (t1 === null || t2 === null) continue;
          // Base durations are rounded to whole minutes (±30 s). Measured on Baku avenues the truly
          // affected pairs stay within +40 s, so +45 s keeps all of them while pruning most others.
          through = t1 + t2 <= baseSec * 1.01 + 45 + probes[b].extraSeconds;
        } else {
          // OSRM unavailable: a trip of length L can only touch b if |ib| + |bj| <= L
          const viaKm = (haversineMeters(points[i], probes[b].point) + haversineMeters(probes[b].point, points[j])) / 1000;
          through = viaKm <= dist[i][j] + (probes[b].extraSeconds * 8.3) / 1000;
        }
      }
      if (through) affected.push([i, j]);
    }
  }
  info.usedEstimate = !probeTimes;
  info.affectedPairs = affected.length;
  if (affected.length === 0) return { distances: dist, durations: dur, info };

  // 2. Measure the affected pairs with Valhalla (with and without barriers)
  const hash = getBarrierHash();
  const needBarrier = affected.filter(([i, j]) => !barrierCache.has(`${hash}|${pairKey(points[i], points[j])}`));
  const needBase = affected.filter(([i, j]) => !baseCache.has(pairKey(points[i], points[j])));

  const runBlocks = async (pairs: [number, number][], withBarriers: boolean) => {
    for (const block of packPairs(pairs)) {
      if (info.valhallaRequests >= MAX_VALHALLA_REQUESTS) { info.partial = true; return; }
      info.valhallaRequests++;
      const src = block.sources.map(i => points[i]);
      const tgt = block.targets.map(j => points[j]);
      const res = await valhallaMatrix(src, tgt, withBarriers ? barriers : null);
      if (!res) { info.partial = true; continue; }
      block.sources.forEach((i, si) => block.targets.forEach((j, ti) => {
        if (i === j) return;
        const key = pairKey(points[i], points[j]);
        if (withBarriers) barrierCache.set(`${hash}|${key}`, res[si][ti]);
        else baseCache.set(key, res[si][ti]);
      }));
    }
  };
  await Promise.all([runBlocks(needBarrier, true), runBlocks(needBase, false)]);

  // 3. Correct the affected cells
  for (const [i, j] of affected) {
    const key = pairKey(points[i], points[j]);
    const bKey = `${hash}|${key}`;
    if (!barrierCache.has(bKey)) continue; // not measured (partial)
    const withB = barrierCache.get(bKey) ?? null;
    const without = baseCache.get(key) ?? null;

    if (!withB) {
      // Only reachable through a closed road
      dur[i][j] += UNREACHABLE_PENALTY_MIN;
      dist[i][j] += UNREACHABLE_PENALTY_KM;
      info.unreachablePairs++;
      continue;
    }
    if (without && without.seconds > 0) {
      const timeFactor = withB.seconds / without.seconds;
      if (timeFactor <= 1.005) continue; // barrier is not on the fastest path after all
      const distFactor = without.distanceKm > 0 ? withB.distanceKm / without.distanceKm : 1;
      // A closed road never makes a trip cheaper for the optimizer
      dur[i][j] = Math.round(dur[i][j] * timeFactor * 10) / 10;
      dist[i][j] = Math.round(dist[i][j] * Math.max(1, distFactor) * 10) / 10;
    } else {
      // Without the barrier-free reference the detour cannot be put on the OSRM scale
      // (Valhalla's absolute times are noticeably slower); leave the cell unchanged.
      info.partial = true;
      continue;
    }
    info.correctedPairs++;
  }

  return { distances: dist, durations: dur, info };
}
