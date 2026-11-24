/**
 * Search state with incrementally updated totals and the cost function of reference/opt2.py.
 * Lower cost is better.
 */
import type { EngineModel, Weights } from './model';
import { popcount } from './model';

export class SearchState {
  readonly m: EngineModel;
  mask: Uint8Array;
  party: Int32Array;
  /** per day: m³, pcs, kg, number of stores */
  DV = new Float64Array(7);
  DP = new Float64Array(7);
  DW = new Float64Array(7);
  DC = new Float64Array(7);
  /** party × day m³, region × day m³, group × day store count */
  PV: Float64Array;
  RV: Float64Array;
  G: Int32Array;
  /** effective weights (phase multipliers applied) */
  w: Weights;
  /** cost of a party for a store: pcost[i*P + q], NaN = not allowed */
  pcost: Float64Array;
  /** party options of a store (for random choice) */
  popts: Int32Array[];

  constructor(m: EngineModel, mask: Uint8Array, party: Int32Array, w: Weights) {
    this.m = m;
    this.mask = Uint8Array.from(mask);
    this.party = Int32Array.from(party);
    this.w = { ...w };
    this.PV = new Float64Array(m.P * 7);
    this.RV = new Float64Array(m.R * 7);
    this.G = new Int32Array(m.GP * m.GR * 7);
    this.pcost = new Float64Array(m.S * m.P).fill(NaN);
    this.popts = [];
    for (let i = 0; i < m.S; i++) {
      for (const [q, c] of m.partyOpt[i]) this.pcost[i * m.P + q] = c;
      this.popts.push(Int32Array.from(m.partyOpt[i].keys()));
    }
    for (let i = 0; i < m.S; i++) this.apply(i, this.mask[i], this.party[i], 1);
  }

  /** Adds (sgn = 1) or removes (sgn = -1) a store's contribution to every total */
  apply(i: number, mask: number, p: number, sgn: number) {
    const m = this.m;
    const n = popcount(mask);
    if (!n) return;
    const r = m.rid[i];
    const g = (m.groupP[p] * m.GR + m.groupR[r]) * 7;
    const pb = p * 7, rb = r * 7;
    if (m.share) {
      // real rhythm: each day gets its own share of the week
      const b = (i * 128 + mask) * 7;
      for (let d = 0; d < 7; d++) {
        if (!((mask >> d) & 1)) continue;
        const f = m.share[b + d] * sgn;
        const v = m.vol[i] * f;
        this.DV[d] += v; this.DP[d] += m.pcs[i] * f; this.DW[d] += m.wt[i] * f; this.DC[d] += sgn;
        this.PV[pb + d] += v; this.RV[rb + d] += v; this.G[g + d] += sgn;
      }
      return;
    }
    const v = (m.vol[i] / n) * sgn, q = (m.pcs[i] / n) * sgn, k = (m.wt[i] / n) * sgn;
    for (let d = 0; d < 7; d++) {
      if (!((mask >> d) & 1)) continue;
      this.DV[d] += v; this.DP[d] += q; this.DW[d] += k; this.DC[d] += sgn;
      this.PV[pb + d] += v; this.RV[rb + d] += v; this.G[g + d] += sgn;
    }
  }

  dayCost(): number {
    const m = this.m, w = this.w;
    let c = 0;
    for (const d of m.wd) {
      if (m.TV > 0) { const x = (this.DV[d] - m.TV) / m.TV; c += w.Wv * x * x; }
      if (m.TP > 0) { const x = (this.DP[d] - m.TP) / m.TP; c += w.Wp * x * x; }
      if (m.TC > 0) { const x = (this.DC[d] - m.TC) / m.TC; c += w.Wc * x * x; }
      if (m.useWeight && m.TW > 0) { const x = (this.DW[d] - m.TW) / m.TW; c += w.Ww * x * x; }
    }
    return c;
  }

  partyCost(p: number): number {
    const m = this.m;
    const b = p * 7;
    let s = 0;
    for (const d of m.wd) s += this.PV[b + d];
    if (s <= 1e-9 || m.TOT <= 0) return 0;
    const mu = s / m.wd.length;
    let c = 0;
    for (const d of m.wd) { const x = (this.PV[b + d] - mu) / mu; c += x * x; }
    return this.w.Wparty * (s / m.TOT) * c;
  }

  regCost(r: number): number {
    const m = this.m;
    const rv = m.rvol[r];
    if (rv <= 1e-9 || m.TOT <= 0) return 0;
    const mu = rv / m.wd.length;
    const b = r * 7;
    let c = 0;
    for (const d of m.wd) { const x = (this.RV[b + d] - mu) / mu; c += x * x; }
    return this.w.Wreg * (rv / m.TOT) * c;
  }

  /** "N or 0" penalty of one group (index into G / 7) */
  grpCost(g: number): number {
    const N = this.m.N;
    if (N <= 1) return 0;
    const b = g * 7;
    let c = 0;
    for (const d of this.m.wd) { const n = this.G[b + d]; if (n > 0 && n < N) c += N - n; }
    return this.w.Wgrp * c;
  }

  storeCost(i: number, mask: number, p: number): number {
    const m = this.m, w = this.w;
    let c = w.Wspc * m.spc[mask] + this.pcost[i * m.P + p];
    if (mask !== m.omask[i]) c += w.Wchg;
    if (!m.rescheduled[i]) {
      const dn = popcount(mask) - m.on[i];
      c += dn > 0 ? w.Winc * dn : w.Wdec * -dn;
    }
    return c;
  }

  budCost(): number {
    const m = this.m;
    if (!m.budgetCap) return 0;
    let s = 0;
    for (const d of m.wd) s += this.DC[d];
    return this.w.Wbud * Math.max(0, s - m.budget);
  }

  groupOf(p: number, r: number): number {
    return this.m.groupP[p] * this.m.GR + this.m.groupR[r];
  }

  total(): number {
    const m = this.m;
    let c = this.dayCost() + this.budCost();
    for (let p = 0; p < m.P; p++) c += this.partyCost(p);
    for (let r = 0; r < m.R; r++) c += this.regCost(r);
    for (let g = 0; g < m.GP * m.GR; g++) c += this.grpCost(g);
    for (let i = 0; i < m.S; i++) c += this.storeCost(i, this.mask[i], this.party[i]);
    return c;
  }

  /** The part of the cost that can change when store i moves between parties p1 and p2 */
  localCost(i: number, mask: number, p: number, p1: number, p2: number): number {
    const r = this.m.rid[i];
    let c = this.dayCost() + this.regCost(r) + this.storeCost(i, mask, p) + this.budCost();
    const g1 = this.groupOf(p1, r);
    c += this.partyCost(p1) + this.grpCost(g1);
    if (p2 !== p1) {
      c += this.partyCost(p2);
      const g2 = this.groupOf(p2, r);
      if (g2 !== g1) c += this.grpCost(g2);
    }
    return c;
  }

  /** Change of the total cost if store i gets (mask2, p2). The state is left as it was. */
  delta(i: number, mask2: number, p2: number): number {
    const m1 = this.mask[i], p1 = this.party[i];
    const before = this.localCost(i, m1, p1, p1, p2);
    this.apply(i, m1, p1, -1);
    this.apply(i, mask2, p2, 1);
    const after = this.localCost(i, mask2, p2, p1, p2);
    this.apply(i, mask2, p2, -1);
    this.apply(i, m1, p1, 1);
    return after - before;
  }

  /** Number of group-days with 1..N-1 stores (all days, so a plan with Sunday shipments is counted too) */
  violations(): number {
    const N = this.m.N;
    let v = 0;
    for (let k = 0; k < this.G.length; k++) if (this.G[k] > 0 && this.G[k] < N) v++;
    return v;
  }

  /** (max − min) / target of the daily m³ over the working days */
  spreadV(): number {
    const m = this.m;
    let lo = Infinity, hi = -Infinity;
    for (const d of m.wd) { lo = Math.min(lo, this.DV[d]); hi = Math.max(hi, this.DV[d]); }
    return m.TV > 0 ? (hi - lo) / m.TV : 0;
  }
}

/** Phase weights: Wchg and Wgrp multiplied by the phase and the run dialog factors */
export function phaseWeights(base: Weights, chgMul: number, grpMul: number): Weights {
  return { ...base, Wchg: base.Wchg * chgMul, Wgrp: base.Wgrp * grpMul };
}
