// Shared time budget for the optimizer's search loops.
// The optimizer runs synchronously (in a Web Worker or on the main thread), so a module-level
// deadline is enough; loops call timeUp() and stop gracefully, keeping the best solution so far.

let deadline = Infinity;

export function setSearchDeadline(timestampMs: number): void {
  deadline = timestampMs;
}

export function clearSearchDeadline(): void {
  deadline = Infinity;
}

export function timeUp(): boolean {
  return deadline !== Infinity && Date.now() > deadline;
}

/** Small deterministic PRNG (mulberry32) so optimizer runs are reproducible. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
