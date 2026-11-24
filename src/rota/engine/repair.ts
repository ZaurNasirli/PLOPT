/**
 * Exact repair of small "N or 0" groups (reference/fix.py): for each group that still has a day
 * with 1..N-1 stores and at most 3 stores, every combination of their allowed masks is tried
 * with everything else fixed, and the cheapest is kept. Repeated while it improves (max 5 rounds).
 */
import type { EngineModel, Weights } from './model';
import { SearchState, phaseWeights } from './state';
import type { PlanState } from './anneal';

const MAX_GROUP = 3;
const MAX_ROUNDS = 5;

export function repairGroups(m: EngineModel, base: Weights, start: PlanState, chgMul: number, grpMul: number): PlanState & { improvedGroups: number } {
  const st = new SearchState(m, start.mask, start.party, phaseWeights(base, chgMul, grpMul));
  const N = m.N;
  let improvedGroups = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let improved = false;
    for (let g = 0; g < m.GP * m.GR; g++) {
      let bad = false;
      for (const d of m.wd) { const n = st.G[g * 7 + d]; if (n > 0 && n < N) bad = true; }
      if (!bad) continue;
      const members: number[] = [];
      for (let i = 0; i < m.S; i++) if (st.groupOf(st.party[i], m.rid[i]) === g) members.push(i);
      if (members.length === 0 || members.length > MAX_GROUP) continue;
      const parties = [...new Set(members.map(i => st.party[i]))];
      const regions = [...new Set(members.map(i => m.rid[i]))];
      const local = () => {
        let c = st.dayCost() + st.budCost() + st.grpCost(g);
        for (const p of parties) c += st.partyCost(p);
        for (const r of regions) c += st.regCost(r);
        for (const i of members) c += st.storeCost(i, st.mask[i], st.party[i]);
        return c;
      };
      const options = members.map(i => m.allowedCounts[i].flatMap(n => m.masksByCount[i][n]));
      const set = (i: number, mk: number) => {
        st.apply(i, st.mask[i], st.party[i], -1);
        st.mask[i] = mk;
        st.apply(i, mk, st.party[i], 1);
      };
      const baseCost = local();
      let bestCost = baseCost;
      let bestCombo = members.map(i => st.mask[i]);
      const startMasks = [...bestCombo];
      const idx = new Array(members.length).fill(0);
      // odometer over the cartesian product
      for (;;) {
        for (let k = 0; k < members.length; k++) set(members[k], options[k][idx[k]]);
        const c = local();
        if (c < bestCost - 1e-9) { bestCost = c; bestCombo = members.map(i => st.mask[i]); }
        let k = 0;
        while (k < members.length && ++idx[k] >= options[k].length) { idx[k] = 0; k++; }
        if (k === members.length) break;
      }
      members.forEach((i, k) => set(i, bestCost < baseCost - 1e-9 ? bestCombo[k] : startMasks[k]));
      if (bestCost < baseCost - 1e-9) { improved = true; improvedGroups++; }
    }
    if (!improved) break;
  }
  return { mask: st.mask, party: st.party, improvedGroups };
}
