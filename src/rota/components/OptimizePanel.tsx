/**
 * "Optimize" button with the list of what is missing, the run dialog (mode, scope, sliders, seed),
 * progress with "Stop", and the result with "Apply" (one undo step).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Dices, Play, Sparkles, Square } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useRotaI18n } from '../i18n';
import { rotaStore, useRotaState } from '../store/workspace';
import { validateRules } from '../rules/validate';
import { newSeed, RunHandle, RunOutcome, startOptimization } from '../engine/client';
import type { PhaseProgress, RunMode } from '../engine/pipeline';
import { phaseIterations } from '../engine/pipeline';
import type { EngineScope } from '../engine/model';
import { Btn, Modal, MultiSelect } from './ui';
import { setLastRun } from '../state/lastRun';

type ScopeKind = 'all' | 'regions' | 'parties' | 'filtered';
const STRICTNESS = [0.5, 1, 2];

export const OptimizeButton: React.FC<{ filteredCodes: string[]; filtersOn: boolean; onToast: (s: string) => void }> = ({ filteredCodes, filtersOn, onToast }) => {
  const { t, f } = useRotaI18n();
  const ws = useRotaState(s => s.ws);
  const rules = ws.ruleSets.find(r => r.id === ws.activeRuleSetId) ?? null;
  const errors = useMemo(
    () => (ws.dataset ? validateRules(rules, ws.dataset.stores, t).filter(i => i.severity === 'error') : []),
    [rules, ws.dataset, t]
  );
  const [open, setOpen] = useState(false);
  const ready = Boolean(ws.dataset) && errors.length === 0;

  if (!ready) {
    const list = ws.dataset ? errors.map(e => e.text) : [t.opt.noData];
    return (
      <div className="flex items-start gap-2 max-w-sm">
        <Btn variant="primary" disabled icon={<Sparkles size={14} />}>{t.opt.button}</Btn>
        <div className="text-[11.5px] leading-snug text-ink-600" title={list.join('\n')}>
          <div className="font-bold text-amber-700 inline-flex items-center gap-1"><AlertTriangle size={12} /> {t.opt.missing}</div>
          <ul className="list-disc pl-4">
            {list.slice(0, 3).map((x, i) => <li key={i} className="truncate max-w-72">{x}</li>)}
          </ul>
          {list.length > 3 && <div className="text-ink-400">{f(t.opt.more, { n: list.length - 3 })}</div>}
        </div>
      </div>
    );
  }
  return (
    <>
      <Btn variant="primary" icon={<Sparkles size={14} />} onClick={() => setOpen(true)}>{t.opt.button}</Btn>
      {open && <RunDialog onClose={() => setOpen(false)} filteredCodes={filtersOn ? filteredCodes : null} onToast={onToast} />}
    </>
  );
};

const RunDialog: React.FC<{ onClose: () => void; filteredCodes: string[] | null; onToast: (s: string) => void }> = ({ onClose, filteredCodes, onToast }) => {
  const { t, f, int, num } = useRotaI18n();
  const ws = useRotaState(s => s.ws);
  const rules = ws.ruleSets.find(r => r.id === ws.activeRuleSetId)!;
  const fastOk = (rules.general.fastMultiplier ?? 0) > 0;
  const [mode, setMode] = useState<RunMode>('exact');
  const [scopeKind, setScopeKind] = useState<ScopeKind>('all');
  const [regions, setRegions] = useState<string[]>([]);
  const [parties, setParties] = useState<string[]>([]);
  const [balance, setBalance] = useState(0); // -2..2 → Wchg × 2^x
  const [strict, setStrict] = useState(1);
  const [seed, setSeed] = useState(() => newSeed());
  const [debug, setDebug] = useState(false);
  const [progress, setProgress] = useState<PhaseProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<RunOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handle = useRef<RunHandle | null>(null);

  const allRegions = useMemo(() => [...new Set(ws.dataset?.stores.map(s => s.region) ?? [])].sort(), [ws.dataset]);
  const allParties = useMemo(() => [...new Set(ws.dataset?.stores.map(s => ws.current.party[s.storeCode] ?? s.party) ?? [])].sort(), [ws]);
  const totalIt = (m: RunMode) => rules.phases.filter(p => p.type === 'anneal').reduce((a, p) => a + phaseIterations(p, rules, m) * Math.max(1, p.seeds ?? 1), 0);
  const chgFactor = Math.pow(2, balance);

  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 250);
    return () => clearInterval(id);
  }, [running]);
  useEffect(() => () => handle.current?.stop(), []);

  const start = () => {
    if (!ws.dataset) return;
    const scope: EngineScope | null =
      scopeKind === 'regions' && regions.length ? { regions }
      : scopeKind === 'parties' && parties.length ? { parties }
      : scopeKind === 'filtered' && filteredCodes ? { storeCodes: filteredCodes }
      : null;
    setRunning(true);
    setError(null);
    setProgress(null);
    const h = startOptimization(
      { stores: ws.dataset.stores, original: ws.original, current: ws.current, rules, scope },
      { mode, chgFactor, grpFactor: STRICTNESS[strict], seed, debug },
      p => setProgress(p)
    );
    handle.current = h;
    h.promise
      .then(res => { setResult(res); setLastRun({ outcome: res, ruleSetId: rules.id, ruleSetName: rules.name, ruleSet: rules, mode, appliedAt: null }); })
      .catch(e => setError(String((e as Error)?.message ?? e)))
      .finally(() => { setRunning(false); setStopping(false); handle.current = null; });
  };

  if (result) return <ResultDialog result={result} onClose={onClose} onApply={() => {
    rotaStore.updatePlan(() => result.plan);
    setLastRun(prev => (prev ? { ...prev, appliedAt: new Date().toISOString() } : prev));
    onToast(t.opt.applied);
    onClose();
  }} />;

  return (
    <Modal
      title={t.opt.title}
      onClose={() => { if (!running) onClose(); }}
      width="lg"
      footer={running ? (
        <Btn variant="danger" icon={<Square size={13} />} disabled={stopping} onClick={() => { setStopping(true); handle.current?.stop(); }}>
          {stopping ? t.opt.stopping : t.opt.stop}
        </Btn>
      ) : (
        <>
          <Btn onClick={onClose}>{t.common.cancel}</Btn>
          <Btn variant="primary" icon={<Play size={13} />} onClick={start}
            disabled={(scopeKind === 'regions' && !regions.length) || (scopeKind === 'parties' && !parties.length)}>{t.opt.start}</Btn>
        </>
      )}
    >
      {running ? (
        <div className="space-y-3 py-2">
          <div className="text-[14px] font-bold text-ink-900">{t.opt.running}</div>
          <div className="h-3 rounded-full bg-ink-100 overflow-hidden">
            <div className="h-full bg-brand-600 transition-[width] duration-300" style={{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-ink-700 tabular-nums">
            <span className="font-semibold">{Math.round((progress?.fraction ?? 0) * 100)}%</span>
            {progress && <span>{f(t.opt.phase, { n: progress.phase, m: progress.phases, type: progress.type === 'repair' ? t.opt.repair : t.opt.anneal })}</span>}
            {progress?.spreadV !== undefined && <span>{t.opt.spread}: <b>{num(progress.spreadV * 100, 2)}%</b></span>}
            {progress?.violations !== undefined && <span>{t.opt.violations}: <b>{progress.violations}</b></span>}
            <span className="text-ink-500">{f(t.opt.elapsed, { s: Math.round(elapsed) })}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {error && <p className="text-[12.5px] text-rose-700">{f(t.opt.failed, { error })}</p>}
          <Field label={t.opt.mode}>
            <div className="flex flex-wrap gap-2">
              {(['exact', 'fast'] as RunMode[]).map(m => (
                <label key={m} className={cn('flex-1 min-w-48 rounded-xl border px-3 py-2 cursor-pointer', mode === m ? 'border-brand-500 bg-brand-50' : 'border-ink-200', m === 'fast' && !fastOk && 'opacity-50 cursor-not-allowed')}>
                  <input type="radio" name="rota-mode" className="accent-brand-600 mr-2" checked={mode === m} disabled={m === 'fast' && !fastOk} onChange={() => setMode(m)} />
                  <span className="text-[13px] font-bold text-ink-900">{m === 'exact' ? t.opt.exact : t.opt.fast}</span>
                  <div className="text-[11.5px] text-ink-500 mt-0.5">
                    {m === 'exact' ? f(t.opt.exactHint, { n: int(totalIt('exact')) })
                      : fastOk ? f(t.opt.fastHint, { k: rules.general.fastMultiplier ?? 0, n: int(totalIt('fast')) }) : t.opt.fastUnavailable}
                  </div>
                </label>
              ))}
            </div>
          </Field>
          <Field label={t.opt.scope}>
            <div className="space-y-1.5">
              {([
                ['all', t.opt.scopeAll],
                ['regions', t.opt.scopeRegions],
                ['parties', t.opt.scopeParties],
                ...(filteredCodes ? [['filtered', f(t.opt.scopeFiltered, { n: int(filteredCodes.length) })]] : []),
              ] as Array<[ScopeKind, string]>).map(([k, label]) => (
                <div key={k} className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-[13px] text-ink-800 cursor-pointer">
                    <input type="radio" name="rota-scope" className="accent-brand-600" checked={scopeKind === k} onChange={() => setScopeKind(k)} />
                    {label}
                  </label>
                  {k === 'regions' && scopeKind === 'regions' && <MultiSelect label={t.filters.region} options={allRegions} selected={regions} onChange={setRegions} />}
                  {k === 'parties' && scopeKind === 'parties' && <MultiSelect label={t.filters.party} options={allParties} selected={parties} onChange={setParties} />}
                </div>
              ))}
              {scopeKind !== 'all' && <p className="text-[11.5px] text-ink-500">{t.opt.scopeNote}</p>}
            </div>
          </Field>
          <Field label={t.opt.balance}>
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-ink-500 w-24 text-right">{t.opt.balanceLeft}</span>
              <input type="range" min={-2} max={2} step={0.5} value={balance} onChange={e => setBalance(Number(e.target.value))} className="flex-1 accent-brand-600" aria-label={t.opt.balance} />
              <span className="text-[12px] text-ink-500 w-32">{t.opt.balanceRight}</span>
            </div>
            <div className="text-[11.5px] text-ink-500 text-center">{balance === 0 ? t.opt.neutral : f(t.opt.factor, { k: num(chgFactor, 2) })}</div>
          </Field>
          <Field label={t.opt.strictness}>
            <div className="inline-flex rounded-lg border border-ink-200 overflow-hidden" role="radiogroup">
              {[t.opt.softer, t.opt.asRules, t.opt.stricter].map((label, k) => (
                <button key={k} type="button" role="radio" aria-checked={strict === k} onClick={() => setStrict(k)}
                  className={cn('h-8 px-3 text-[12.5px] font-semibold cursor-pointer border-r border-ink-200 last:border-r-0', strict === k ? 'bg-brand-600 text-white' : 'bg-ink-0 text-ink-700 hover:bg-ink-50')}>
                  {label}{k !== 1 && <span className="opacity-70"> · Wgrp × {STRICTNESS[k]}</span>}
                </button>
              ))}
            </div>
          </Field>
          <div className="flex flex-wrap items-end gap-4">
            <Field label={t.opt.seed}>
              <div className="flex items-center gap-1.5">
                <input type="number" value={seed} onChange={e => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                  className="h-8 w-36 px-2 rounded-lg border border-ink-200 bg-ink-0 text-[12.5px] tabular-nums text-ink-900" />
                <Btn size="sm" variant="ghost" icon={<Dices size={13} />} onClick={() => setSeed(newSeed())}>{t.opt.newSeed}</Btn>
              </div>
            </Field>
            <label className="inline-flex items-center gap-2 text-[12px] text-ink-600 pb-1.5 cursor-pointer">
              <input type="checkbox" className="accent-brand-600" checked={debug} onChange={e => setDebug(e.target.checked)} /> {t.opt.debug}
            </label>
          </div>
        </div>
      )}
    </Modal>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div className="text-[12px] font-bold text-ink-700 mb-1.5">{label}</div>
    {children}
  </div>
);

const ResultDialog: React.FC<{ result: RunOutcome; onClose: () => void; onApply: () => void }> = ({ result, onClose, onApply }) => {
  const { t, f, int, num } = useRotaI18n();
  const r = result.report;
  const cand = r.chain.filter(c => c.status !== 'fixedParty');
  const one = r.chain.filter(c => c.status === 'up1').length;
  const two = r.chain.filter(c => c.status === 'up2').length;
  const moved = r.chain.filter(c => c.steps > 0).length;
  const p = (x: number) => `${num(x, 1)}%`;
  const rows: Array<[string, string, string]> = [
    [t.opt.spreadV, p(r.before.spreadV), p(r.after.spreadV)],
    [t.opt.spreadP, p(r.before.spreadP), p(r.after.spreadP)],
    [t.opt.spreadC, p(r.before.spreadC), p(r.after.spreadC)],
    [t.opt.groupViol, int(r.before.violations), int(r.after.violations)],
    [t.opt.storeDays, int(r.before.storeDays), int(r.after.storeDays)],
    [t.opt.partyRegion, `${p(r.before.partySpreadMax)} / ${p(r.before.regionSpreadMax)}`, `${p(r.after.partySpreadMax)} / ${p(r.after.regionSpreadMax)}`],
    [t.opt.changed, '—', int(r.changedStores)],
    [t.opt.partyChanges, '—', Object.entries(r.partyChangesBySegment).map(([s, n]) => `${s} ${n}`).join(' · ') || '0'],
  ];
  if (cand.length) rows.push([t.opt.chainMoved, '—', f(t.opt.chainMovedValue, { moved, cand: cand.length, one, two })]);
  return (
    <Modal
      title={t.opt.resultTitle}
      onClose={onClose}
      footer={<><Btn onClick={onClose}>{t.opt.discard}</Btn><Btn variant="primary" onClick={onApply}>{t.opt.apply}</Btn></>}
    >
      {result.stopped && <p className="text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">{t.opt.stoppedNote}</p>}
      <table className="w-full text-[13px] tabular-nums">
        <thead className="text-ink-500 text-[12px]">
          <tr><th className="text-left py-1.5">{t.opt.measure}</th><th className="text-right">{t.opt.before}</th><th className="text-right">{t.opt.after}</th></tr>
        </thead>
        <tbody>
          {rows.map(([l, b, a]) => (
            <tr key={l} className="border-t border-ink-100">
              <td className="py-1.5 text-ink-800">{l}</td>
              <td className="text-right text-ink-500">{b}</td>
              <td className="text-right font-bold text-ink-900">{a}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11.5px] text-ink-400">{f(t.opt.timeSeed, { s: num(result.seconds, 1), seed: result.seed })}</p>
      {result.debugNotes.length > 0 && (
        <div className="mt-2 text-[11.5px] text-rose-700"><b>{t.opt.debugNotes}:</b> {result.debugNotes.join('; ')}</div>
      )}
    </Modal>
  );
};
