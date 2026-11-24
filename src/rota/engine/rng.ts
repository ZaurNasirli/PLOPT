/** mulberry32: small, fast, seeded; the same seed gives the same run */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed of one search: from the run seed, the phase and the parallel search number */
export function deriveSeed(runSeed: number, phase: number, k: number): number {
  let h = (runSeed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (phase + 1), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (k + 1), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
