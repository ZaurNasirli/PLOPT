/** Scenarios: original / current / saved plans, compare two side by side, roll back, workspace JSON. */
import React, { useMemo, useRef, useState } from 'react';
import { Copy, Download, Pencil, Save, Trash2, Undo2, Upload } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useRotaI18n } from '../i18n';
import { rotaStore, RotaScenario, useRotaState } from '../store/workspace';
import { planDiff, planMetrics, PlanMetrics } from '../state/planMetrics';
import { newId, RuleSet } from '../rules/types';
import type { PlanSnapshot } from '../types';
import { Btn } from './ui';
import { saveBlob } from '../core/download';

type Ref = 'original' | 'current' | string;

export const ScenariosTab: React.FC<{ onToast: (s: string) => void }> = ({ onToast }) => {
  const { t, f, num, int, dayShort, lang } = useRotaI18n();
  const ws = useRotaState(s => s.ws);
  const rules = ws.ruleSets.find(r => r.id === ws.activeRuleSetId) ?? null;
  const [a, setA] = useState<Ref>('original');
  const [b, setB] = useState<Ref>('current');
  const fileRef = useRef<HTMLInputElement>(null);
  const date = () => new Date().toLocaleString(t.locale, { dateStyle: 'short', timeStyle: 'short' });

  const planOf = (r: Ref): { plan: PlanSnapshot; rules: RuleSet | null; name: string } => {
    if (r === 'original') return { plan: ws.original, rules, name: t.scen.original };
    if (r === 'current') return { plan: ws.current, rules, name: t.scen.current };
    const s = ws.scenarios.find(x => x.id === r);
    return s ? { plan: s.plan, rules: s.ruleSetSnapshot ?? rules, name: s.name } : { plan: ws.current, rules, name: t.scen.current };
  };
  const metricsCache = useMemo(() => new Map<string, PlanMetrics>(), [ws, rules]);
  const metrics = (r: Ref) => {
    let m = metricsCache.get(r);
    if (!m) { const p = planOf(r); m = planMetrics(ws, p.plan, p.rules); metricsCache.set(r, m); }
    return m;
  };
  const diffs = useMemo(() => (ws.dataset ? planDiff(ws, planOf(a).plan, planOf(b).plan) : []), [ws, a, b]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    const name = window.prompt(t.scen.namePrompt, f(t.scen.defaultManual, { date: date() }));
    if (!name) return;
    const sc: RotaScenario = {
      id: newId('scen'), name: name.trim(), kind: 'manual', createdAt: new Date().toISOString(), plan: ws.current,
      ruleSetId: rules?.id ?? null, ruleSetName: rules?.name ?? null, ruleSetSnapshot: rules, runInfo: null,
    };
    rotaStore.updateScenarios(list => [...list, sc]);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ format: 'plopt-rota-workspace', version: 1, exportedAt: new Date().toISOString(), workspace: ws })], { type: 'application/json' });
    saveBlob(blob, `rota_${lang}_${new Date().toISOString().slice(0, 10)}.json`);
  };
  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const workspace = data?.format === 'plopt-rota-workspace' ? data.workspace : data?.version === 1 && data?.original ? data : null;
      if (!workspace) { onToast(t.scen.importBad); return; }
      if (!window.confirm(f(t.scen.importConfirm, { file: file.name }))) return;
      rotaStore.replaceWorkspace(workspace);
      onToast(t.scen.imported);
    } catch {
      onToast(t.scen.importBad);
    }
  };

  const refs: Array<{ id: Ref; name: string }> = [
    { id: 'original', name: t.scen.original },
    { id: 'current', name: t.scen.current },
    ...ws.scenarios.map(s => ({ id: s.id, name: s.name })),
  ];
  const p1 = (x: number | null) => (x === null ? '—' : `${num(x, 1)}%`);
  const rows: Array<{ label: string; get: (m: PlanMetrics) => string }> = [
    { label: t.scen.measures.spreadV, get: m => p1(m.spreadV) },
    { label: t.scen.measures.spreadP, get: m => p1(m.spreadP) },
    { label: t.scen.measures.spreadC, get: m => p1(m.spreadC) },
    { label: t.scen.measures.violations, get: m => (m.violations === null ? '—' : int(m.violations)) },
    { label: t.scen.measures.storeDays, get: m => int(m.storeDays) },
    { label: t.scen.measures.changed, get: m => int(m.changed) },
    { label: t.scen.measures.partyChanges, get: m => int(m.partyChanges) },
  ];
  const days = (d: string[]) => d.map(x => dayShort(x as never)).join(' ');

  const card = (id: Ref, sc: RotaScenario | null) => {
    const m = metrics(id);
    const name = sc ? sc.name : id === 'original' ? t.scen.original : t.scen.current;
    return (
      <li key={id} className="rounded-xl border border-ink-200 bg-ink-0 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-bold text-ink-900">{name}</span>
          {sc && <span className={cn('px-1.5 rounded text-[11px] font-bold', sc.kind === 'auto' ? 'bg-brand-100 text-brand-800' : 'bg-ink-100 text-ink-700')}>{t.scen.kind[sc.kind]}</span>}
          <span className="ml-auto flex gap-1">
            {id !== 'current' && (
              <Btn size="sm" icon={<Undo2 size={13} />} onClick={() => {
                rotaStore.updatePlan(() => planOf(id).plan);
                onToast(f(t.scen.applied, { name }));
              }}>{t.scen.apply}</Btn>
            )}
            {sc && <Btn size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => {
              const n = window.prompt(t.scen.namePrompt, sc.name);
              if (n && n.trim()) rotaStore.updateScenarios(list => list.map(x => (x.id === sc.id ? { ...x, name: n.trim() } : x)));
            }}>{t.scen.rename}</Btn>}
            {sc && <Btn size="sm" variant="ghost" className="hover:text-rose-700" icon={<Trash2 size={13} />} onClick={() => {
              if (window.confirm(f(t.scen.removeConfirm, { name: sc.name }))) rotaStore.updateScenarios(list => list.filter(x => x.id !== sc.id));
            }}>{t.scen.remove}</Btn>}
          </span>
        </div>
        {sc && (
          <div className="text-[11.5px] text-ink-500 mt-0.5">
            {f(t.scen.created, { date: new Date(sc.createdAt).toLocaleString(t.locale, { dateStyle: 'short', timeStyle: 'short' }) })}
            {' · '}{sc.ruleSetName ? f(t.scen.rules, { name: sc.ruleSetName }) : t.scen.noRules}
            {sc.runInfo && <> · {f(t.scen.run, { mode: sc.runInfo.mode === 'fast' ? t.opt.fast : t.opt.exact, seed: sc.runInfo.seed })}</>}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-700 tabular-nums">
          {rows.map(r => <span key={r.label}>{r.label}: <b className="text-ink-900">{r.get(m)}</b></span>)}
        </div>
      </li>
    );
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[16px] font-bold text-ink-900 mr-2">{t.scen.title}</h2>
        <Btn variant="primary" icon={<Save size={14} />} disabled={!ws.dataset} onClick={save}>{t.scen.saveCurrent}</Btn>
        <span className="ml-auto text-[12px] text-ink-500">{t.scen.workspace}:</span>
        <Btn icon={<Download size={14} />} onClick={exportJson}>{t.scen.exportJson}</Btn>
        <Btn icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>{t.scen.importJson}</Btn>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden"
          onChange={e => { const file = e.target.files?.[0]; if (file) void importJson(file); e.target.value = ''; }} />
      </div>

      {ws.dataset && (
        <>
          <ul className="grid gap-2 lg:grid-cols-2">
            {card('original', null)}
            {card('current', null)}
            {ws.scenarios.map(s => card(s.id, s))}
          </ul>
          {ws.scenarios.length === 0 && <p className="text-[12.5px] text-ink-500">{t.scen.empty}</p>}

          <section className="rounded-xl border border-ink-200 bg-ink-0 p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-[14px] font-bold text-ink-900">{t.scen.compare}</h3>
              {([['A', a, setA], ['B', b, setB]] as const).map(([label, val, set]) => (
                <label key={label} className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-600">
                  {label === 'A' ? t.scen.a : t.scen.b}
                  <select value={val} onChange={e => set(e.target.value)} className="h-8 px-2 rounded-lg border border-ink-200 bg-ink-0 text-[12.5px] font-semibold text-ink-900 cursor-pointer">
                    {refs.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <table className="w-full max-w-2xl text-[12.5px] tabular-nums">
              <thead className="text-ink-500"><tr><th className="text-left py-1">{t.scen.metric}</th><th className="text-right">A · {planOf(a).name}</th><th className="text-right">B · {planOf(b).name}</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.label} className="border-t border-ink-100">
                    <td className="py-1 text-ink-700">{r.label}</td>
                    <td className="text-right text-ink-900">{r.get(metrics(a))}</td>
                    <td className="text-right font-bold text-ink-900">{r.get(metrics(b))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] font-bold text-ink-800">{diffs.length ? f(t.scen.diffs, { n: diffs.length }) : t.scen.noDiffs}</span>
              {diffs.length > 0 && (
                <Btn size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => {
                  const text = diffs.map(d => [d.code, d.name, d.region, days(d.daysA), days(d.daysB), d.partyA, d.partyB].join('\t')).join('\n');
                  void navigator.clipboard?.writeText(text).then(() => onToast(t.scen.copied));
                }}>{t.scen.copy}</Btn>
              )}
            </div>
            {diffs.length > 0 && (
              <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-ink-200">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-ink-50 text-ink-500">
                    <tr>
                      <th className="text-left px-2 py-1">{t.importer.fields.storeCode}</th>
                      <th className="text-left px-2">{t.importer.fields.storeName}</th>
                      <th className="text-left px-2">{t.filters.region}</th>
                      <th className="text-left px-2">{t.scen.daysCol}: A → B</th>
                      <th className="text-left px-2">{t.scen.partyCol}: A → B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map(d => (
                      <tr key={d.code} className="border-t border-ink-100">
                        <td className="px-2 py-1 font-semibold text-ink-900">{d.code}</td>
                        <td className="px-2 text-ink-800 truncate max-w-56">{d.name}</td>
                        <td className="px-2 text-ink-600">{d.region}</td>
                        <td className="px-2 text-ink-800">{d.daysA.join() === d.daysB.join() ? days(d.daysA) : <>{days(d.daysA)} → <b>{days(d.daysB)}</b></>}</td>
                        <td className="px-2 text-ink-800">{d.partyA === d.partyB ? d.partyA : <>{d.partyA} → <b>{d.partyB}</b></>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
