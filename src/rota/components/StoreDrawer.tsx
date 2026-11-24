/** Store card: details, days and party editors (with checks), locks and store exceptions. */
import React, { useEffect, useMemo, useState } from 'react';
import { Lock, RotateCcw, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useRotaI18n } from '../i18n';
import { ALL_WEEKDAYS, StoreView, Weekday } from '../types';
import type { RotaWorkspace } from '../store/workspace';
import type { RuleSet } from '../rules/types';
import type { PlanChecker } from '../state/checks';
import { applyMoves, MoveResult, setLocks, updateException } from '../state/actions';
import { nameKey, sortDays } from '../core/names';
import { onDay } from '../state/views';
import { checkText } from './checkText';
import { partyColor } from './ui';

export const StoreDrawer: React.FC<{
  view: StoreView;
  ws: RotaWorkspace;
  rules: RuleSet | null;
  checker: PlanChecker;
  parties: string[];
  onClose: () => void;
  onMoved: (r: MoveResult) => void;
}> = ({ view, ws, rules, checker, parties, onClose, onMoved }) => {
  const i18n = useRotaI18n();
  const { t, f, dayShort, m3, int } = i18n;
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setMessage(null), [view.storeCode]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const exception = rules?.stores.find(e => e.storeCode === view.storeCode) ?? null;
  const issues = checker.storeIssues.get(view.storeCode) ?? [];
  const partyOptions = useMemo(() => parties.map(p => ({ p, reason: checker.checkParty(view.storeCode, p) })), [parties, checker, view.storeCode]);

  const apply = (req: { days?: Weekday[]; party?: string }) => {
    const res = applyMoves(ws, checker, [{ code: view.storeCode, ...req }]);
    setMessage(res.rejected.length ? checkText(res.rejected[0].reason, i18n) : null);
    onMoved({ ...res, rejected: [] });
  };
  const toggleDay = (d: Weekday) => {
    const days = view.currentDays.includes(d) ? view.currentDays.filter(x => x !== d) : sortDays([...view.currentDays, d]);
    apply({ days });
  };

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1 border-b border-ink-100 last:border-0">
      <span className="text-ink-500">{label}</span>
      <span className="text-ink-900 font-semibold text-right">{value}</span>
    </div>
  );

  return (
    <div className="fixed inset-y-0 right-0 z-[2000] w-full max-w-md bg-ink-0 border-l border-ink-200 shadow-2xl flex flex-col" role="dialog" aria-label={view.storeName}>
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-ink-200">
        <div className="min-w-0">
          <div className="text-[12px] font-mono text-ink-500">{view.storeCode}</div>
          <h2 className="text-[17px] font-bold text-ink-900 truncate">{view.storeName}</h2>
          <div className="text-[12px] text-ink-500">{view.region} · {view.segment} · {view.storeFormat}</div>
        </div>
        <button type="button" onClick={onClose} aria-label={t.common.close} className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-ink-200 text-ink-600 hover:text-ink-900 cursor-pointer"><X size={15} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-[12.5px]">
        <section>
          {row(t.drawer.receiving, view.receivingTime || '—')}
          {row(t.drawer.partyWindow, view.currentPartyWindow || '—')}
          {row(t.drawer.weekly, `${m3(view.weeklyVolume)} ${t.units.m3} · ${int(view.weeklyQty)} ${t.units.pcs} · ${int(view.weeklyWeight)} ${t.units.kg}`)}
          {view.shareCur
            ? row(t.drawer.byDay, `${view.currentDays.map(d => `${dayShort(d)} ${m3(onDay(view, d))}`).join(' · ')} ${t.units.m3}`)
            : row(t.drawer.daily, `${m3(view.dailyVolume)} ${t.units.m3} · ${int(view.dailyQty)} ${t.units.pcs} · ${int(view.dailyWeight)} ${t.units.kg}`)}
        </section>

        <section>
          <h3 className="font-bold text-ink-800 mb-1.5">{t.drawer.days}</h3>
          <div className="grid grid-cols-7 gap-1">
            {ALL_WEEKDAYS.map(d => {
              const on = view.currentDays.includes(d);
              const was = view.originalDays.includes(d);
              return (
                <button key={d} type="button" onClick={() => toggleDay(d)} aria-pressed={on}
                  className={cn('h-9 rounded-lg border text-[12px] font-bold cursor-pointer relative', on ? 'bg-brand-600 border-brand-600 text-white' : 'bg-ink-0 border-ink-200 text-ink-600 hover:border-brand-400')}>
                  {dayShort(d)}
                  {was && <span className={cn('absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full', on ? 'bg-white' : 'bg-ink-400')} />}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-500">{f(t.drawer.inFile, { days: view.originalDays.map(dayShort).join(' '), party: view.party })}</p>
        </section>

        <section>
          <h3 className="font-bold text-ink-800 mb-1.5">{t.drawer.party}</h3>
          <ul className="rounded-xl border border-ink-200 divide-y divide-ink-100">
            {partyOptions.map(({ p, reason }) => {
              const current = nameKey(p) === nameKey(view.currentParty);
              return (
                <li key={p}>
                  <button type="button" disabled={current || reason !== null} onClick={() => apply({ party: p })} title={reason ? checkText(reason, i18n) : undefined}
                    className={cn('w-full flex items-center gap-2 px-2.5 py-1.5 text-left', current ? 'bg-brand-50' : reason ? 'opacity-55 cursor-not-allowed' : 'hover:bg-ink-50 cursor-pointer')}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: partyColor(p, parties) }} />
                    <span className={cn('flex-1', current ? 'font-bold text-ink-900' : 'text-ink-800')}>{p}</span>
                    {!current && reason && <span className="text-[11px] text-rose-600">{t.drawer.notAllowed}</span>}
                    {current && <span className="text-[11px] text-brand-700">✓</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[11px] text-ink-400">{t.drawer.allowedHint}</p>
        </section>

        {message && <p className="px-2.5 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800">{message}</p>}

        <button type="button" onClick={() => apply({ days: view.originalDays, party: view.party })}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-600 hover:text-brand-700 cursor-pointer">
          <RotateCcw size={13} /> {t.drawer.reset}
        </button>

        {issues.length > 0 && (
          <section>
            <h3 className="font-bold text-ink-800 mb-1">{t.drawer.issues}</h3>
            <ul className="space-y-1">
              {issues.map((i, k) => <li key={k} className={i.severity === 'hard' ? 'text-rose-700' : 'text-amber-700'}>{i.severity === 'hard' ? '⛔' : '⚠️'} {checkText(i, i18n)}</li>)}
            </ul>
          </section>
        )}

        <section>
          <h3 className="font-bold text-ink-800 mb-1.5 inline-flex items-center gap-1.5"><Lock size={13} /> {t.drawer.locks}</h3>
          {!rules ? <p className="text-ink-500">{t.bulk.needRules}</p> : (
            <div className="flex gap-2">
              {([['lockDays', t.drawer.lockDays], ['lockParty', t.drawer.lockParty]] as const).map(([k, label]) => {
                const on = Boolean(exception?.[k]);
                return (
                  <button key={k} type="button" aria-pressed={on}
                    onClick={() => updateException(ws, view.storeCode, { [k]: !on })}
                    className={cn('h-8 px-3 rounded-lg border text-[12.5px] font-semibold cursor-pointer', on ? 'bg-amber-50 border-amber-400 text-amber-800' : 'bg-ink-0 border-ink-200 text-ink-700 hover:border-ink-300')}>
                    {on ? '🔒' : '🔓'} {label}
                  </button>
                );
              })}
              <button type="button" onClick={() => setLocks(ws, [view.storeCode], exception?.lockDays && exception?.lockParty ? 'none' : 'all')}
                className="h-8 px-3 rounded-lg border border-ink-200 text-[12.5px] font-semibold text-ink-700 hover:border-ink-300 cursor-pointer">
                {exception?.lockDays && exception?.lockParty ? t.bulk.unlock : t.bulk.lockAll}
              </button>
            </div>
          )}
        </section>

        {rules && (
          <section>
            <h3 className="font-bold text-ink-800 mb-1.5">{t.drawer.exceptions}</h3>
            <div className="grid grid-cols-2 gap-2">
              <ExField label={t.rules.cols.stores.allowedParties} value={(exception?.allowedParties ?? []).join(', ')} onCommit={v => updateException(ws, view.storeCode, { allowedParties: v.split(/[,;\s]+/).filter(Boolean) })} />
              <ExField label={t.rules.cols.stores.forbiddenParties} value={(exception?.forbiddenParties ?? []).join(', ')} onCommit={v => updateException(ws, view.storeCode, { forbiddenParties: v.split(/[,;\s]+/).filter(Boolean) })} />
              <ExField label={t.rules.cols.stores.forbiddenDays} value={(exception?.forbiddenDays ?? []).join('')} onCommit={v => updateException(ws, view.storeCode, { forbiddenDays: [...new Set(v.replace(/[^1-7]/g, '').split('').map(Number))].sort() })} />
              <div className="grid grid-cols-2 gap-2">
                <ExField label={t.rules.cols.stores.minDays} value={exception?.minDays?.toString() ?? ''} onCommit={v => updateException(ws, view.storeCode, { minDays: v.trim() ? Number(v) || null : null })} />
                <ExField label={t.rules.cols.stores.maxDays} value={exception?.maxDays?.toString() ?? ''} onCommit={v => updateException(ws, view.storeCode, { maxDays: v.trim() ? Number(v) || null : null })} />
              </div>
              <div className="col-span-2">
                <ExField label={t.rules.cols.stores.comment} value={exception?.comment ?? ''} onCommit={v => updateException(ws, view.storeCode, { comment: v })} />
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

const ExField: React.FC<{ label: string; value: string; onCommit: (v: string) => void }> = ({ label, value, onCommit }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="block min-w-0">
      <span className="block text-[11px] text-ink-500 truncate" title={label}>{label}</span>
      <input value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft !== value) onCommit(draft); }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className="w-full h-8 px-2 rounded-lg border border-ink-200 bg-ink-0 text-[12.5px] text-ink-900 focus:outline-none focus:border-brand-500" />
    </label>
  );
};
