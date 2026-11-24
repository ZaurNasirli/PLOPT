/**
 * Acceptance run of the Rota optimizer (section 4.8 of the task):
 *   npx tsx scripts/rota-acceptance.ts [stores.xlsx] [rules.xlsx] [--fast] [--seed N]
 * Defaults: _rota_import/try_2.xlsx and _rota_import/Pravila_primer.xlsx.
 */
import { readFileSync } from 'fs';
import { readStoreWorkbook, autoDetectMapping, buildStores } from '../src/rota/data/storeImport';
import { parseRulesWorkbook } from '../src/rota/rules/excel';
import { validateRules } from '../src/rota/rules/validate';
import { getRotaDict } from '../src/rota/i18n';
import { planFromDataset } from '../src/rota/store/workspace';
import { compileModel, popcount } from '../src/rota/engine/model';
import { SearchState, phaseWeights } from '../src/rota/engine/state';
import { baseWeights, localRunners, runPipeline } from '../src/rota/engine/pipeline';
import { buildReport } from '../src/rota/engine/report';
import { DAY_DIGIT } from '../src/rota/types';

const args = process.argv.slice(2);
const files = args.filter((a, k) => !a.startsWith('--') && !['--seed', '--dump', '--w'].includes(args[k - 1]));
const storesPath = files[0] ?? '_rota_import/try_2.xlsx';
const rulesPath = files[1] ?? '_rota_import/Pravila_primer.xlsx';
const mode = args.includes('--fast') ? 'fast' : 'exact';
const seedArg = args.indexOf('--seed');
const seed = seedArg >= 0 ? Number(args[seedArg + 1]) : 20261124;

const ab = (p: string) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const t = getRotaDict('ru');

(async () => {
  const sheet = readStoreWorkbook(ab(storesPath), storesPath);
  const stores = buildStores(sheet, autoDetectMapping(sheet.headers), 'weekly').stores;
  const rules = parseRulesWorkbook(ab(rulesPath), rulesPath, t).ruleSet;
  // --w Wreg=900,Wparty=800 : try other penalty values without editing the rules file
  const wIdx = args.indexOf('--w');
  if (wIdx >= 0) for (const kv of args[wIdx + 1].split(',')) { const [k, v] = kv.split('='); (rules.weights as Record<string, number | null>)[k] = Number(v); }
  const errors = validateRules(rules, stores, t).filter(i => i.severity === 'error');
  if (errors.length) { console.error('rules have errors:', errors.map(e => e.text)); process.exit(1); }
  const plan = planFromDataset({ name: '', importedAt: '', volumeMode: 'weekly', stores });
  const model = compileModel({ stores, original: plan, current: plan, rules });
  const opts = { mode: mode as 'fast' | 'exact', chgFactor: 1, grpFactor: 1, seed };
  const base = baseWeights(rules, opts);
  const t0 = Date.now();
  let lastPct = -1;
  const res = await runPipeline(model, rules, opts, localRunners(model, base), {
    onProgress: p => {
      const pct = Math.floor(p.fraction * 20) * 5;
      if (pct !== lastPct) { lastPct = pct; process.stderr.write(`  ${pct}% phase ${p.phase}/${p.phases}${p.spreadV !== undefined ? ` spread ${(p.spreadV * 100).toFixed(2)}% viol ${p.violations}` : ''}\n`); }
    },
  });
  const secs = (Date.now() - t0) / 1000;
  const lastAnneal = [...rules.phases].reverse().find(p => p.type === 'anneal');
  const origDays = stores.map(s => s.originalDays.map(d => DAY_DIGIT[d] - 1));
  const rep = buildReport(model, base, { chg: lastAnneal?.chgMul ?? 1, grp: lastAnneal?.grpMul ?? 1 }, res, origDays);

  const segOf = (i: number) => model.segment[i].toUpperCase();
  const urban = rep.chain;
  const cand = urban.filter(c => c.status !== 'fixedParty');
  const up1 = urban.filter(c => c.status === 'up1').length;
  const up2 = urban.filter(c => c.status === 'up2').length;
  const araz = Object.entries(rep.partyChangesBySegment).filter(([s]) => s.toUpperCase() === 'ARAZ').reduce((a, [, n]) => a + n, 0);
  const fr = Object.entries(rep.partyChangesBySegment).filter(([s]) => s.toUpperCase() === 'FRANCHISE').reduce((a, [, n]) => a + n, 0);
  const violParties = [...new Set(rep.violations.map(v => model.parties[v.party]))];
  const f1 = (x: number) => `${x.toFixed(1)}%`;
  const rows: Array<[string, string, string, string]> = [
    ['Разброс m³ по дням Пн–Сб', f1(rep.before.spreadV), f1(rep.after.spreadV), '≤ 1% (эталон 0.7%)'],
    ['Разброс шт', f1(rep.before.spreadP), f1(rep.after.spreadP), '≤ 2% (1.0%)'],
    ['Разброс количества магазинов', f1(rep.before.spreadC), f1(rep.after.spreadC), '≤ 5% (3.7%)'],
    ['Групп «3 или 0» с 1–2 магазинами', String(rep.before.violations), `${rep.after.violations} (${violParties.join(', ')})`, '6 (все в 15-2)'],
    ['Urban переведено', '—', `${up1 + up2} из ${cand.length} (${up1} на 1 шаг, ${up2} на 2)`, '95 из 97 (92 + 3)'],
    ['Смены партии у ARAZ', '—', String(araz), '≤ 10 (8)'],
    ['Franchise со сменой партии', '—', String(fr), '0'],
    ['Urban с изменённым кол-вом дней (не воскр.)', '—', String(rep.fixedCountChanged), '0'],
    ['Магазино-дней', String(rep.before.storeDays), String(rep.after.storeDays), '≤ 1451'],
    ['Разброс m³ внутри партии / региона', `${f1(rep.before.partySpreadMax)} / ${f1(rep.before.regionSpreadMax)}`, `${f1(rep.after.partySpreadMax)} / ${f1(rep.after.regionSpreadMax)}`, '≤ 10% / ≤ 13%'],
    ['Выведено из неизменяемых партий', '—', String(rep.movedOutOfFixed), '0'],
    ['Смен партии без пересечения времени', '—', String(rep.timeConflicts), '0'],
    ['Нарушений лимитов дней', '—', String(rep.dayLimitBreaks), '0'],
  ];
  const finalCost = new SearchState(model, res.mask, res.party, phaseWeights(base, lastAnneal?.chgMul ?? 1, lastAnneal?.grpMul ?? 1)).total();
  console.log(`\nmode=${mode} seed=${seed} time=${secs.toFixed(1)}s stopped=${res.stopped} cost=${finalCost.toFixed(3)}`);
  const dumpIdx = args.indexOf('--dump');
  if (dumpIdx >= 0) {
    const { writeFileSync } = await import('fs');
    writeFileSync(args[dumpIdx + 1], JSON.stringify({ codes: model.codes, mask: [...res.mask], party: [...res.party].map(p => model.parties[p]) }));
  }
  if (args.includes('--detail')) {
    const sp = (arr: number[]) => { const tot = arr.reduce((a, b) => a + b, 0); const w = model.wd.map(d => arr[d]); return tot > 0 ? ((Math.max(...w) - Math.min(...w)) / (tot / model.wd.length)) * 100 : 0; };
    const PV = Array.from({ length: model.P }, () => new Array(7).fill(0)), RV = Array.from({ length: model.R }, () => new Array(7).fill(0));
    for (let i = 0; i < model.S; i++) { const n = popcount(res.mask[i]); for (let d = 0; d < 7; d++) if ((res.mask[i] >> d) & 1) { PV[res.party[i]][d] += model.vol[i] / n; RV[model.rid[i]][d] += model.vol[i] / n; } }
    console.log('party spreads', model.parties.map((p, k) => `${p}:${sp(PV[k]).toFixed(1)}`).join('  '));
    console.log('region spreads', model.regions.map((p, k) => `${p}:${sp(RV[k]).toFixed(1)}`).join('  '));
  }
  for (const r of rows) console.log(`| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`);
  console.log('\nRemaining violations:');
  for (const v of rep.violations) console.log(`  ${model.parties[v.party]} · ${model.regions[v.region]} · day ${v.day + 1}: ${v.count} → ${JSON.stringify(v.reason)}`);
  console.log('\nUrban not moved / 2 steps:');
  for (const c of urban.filter(c => c.status === 'notMoved' || c.status === 'up2')) console.log(`  ${model.codes[c.i]} ${segOf(c.i)} ${c.status} ${JSON.stringify(c.reason)}`);
})();
