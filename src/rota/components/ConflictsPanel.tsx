/** All rule problems of the current plan; a click selects the stores on the Kanban / map. */
import React, { useMemo, useState } from 'react';
import { AlertOctagon, AlertTriangle, ChevronDown, ChevronRight, TrendingDown, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useRotaI18n } from '../i18n';
import type { PlanChecker } from '../state/checks';
import type { StoreView } from '../types';
import { checkText } from './checkText';

export interface BalanceWarning {
  before: number;
  after: number;
}

export const ConflictsPanel: React.FC<{
  checker: PlanChecker;
  views: StoreView[];
  balanceWarning: BalanceWarning | null;
  onDismissWarning: () => void;
  onFocus: (codes: string[]) => void;
  onClose: () => void;
}> = ({ checker, views, balanceWarning, onDismissWarning, onFocus, onClose }) => {
  const i18n = useRotaI18n();
  const { t, f, dayShort, num } = i18n;
  const byCode = useMemo(() => new Map(views.map(v => [v.storeCode, v])), [views]);
  const hard = useMemo(() => {
    const out: Array<{ code: string; texts: string[] }> = [];
    for (const [code, list] of checker.storeIssues) {
      const h = list.filter(i => i.severity === 'hard');
      if (h.length && byCode.has(code)) out.push({ code, texts: h.map(i => checkText(i, i18n)) });
    }
    return out.sort((a, b) => a.code.localeCompare(b.code));
  }, [checker, byCode, i18n]);
  const uneven = useMemo(
    () => [...checker.storeIssues.entries()].filter(([c, l]) => byCode.has(c) && l.some(i => i.code === 'uneven')).map(([c]) => c).sort(),
    [checker, byCode]
  );
  const groups = checker.groupIssues;

  return (
    <aside className="w-80 shrink-0 border-l border-ink-200 bg-ink-0 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-ink-200">
        <span className="text-[13px] font-bold text-ink-900">{t.conflicts.title}</span>
        <button type="button" onClick={onClose} aria-label={t.common.close} className="h-7 w-7 inline-flex items-center justify-center rounded-md text-ink-500 hover:bg-ink-100 cursor-pointer"><X size={14} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2 text-[12.5px]">
        {!checker.full && <p className="px-2 py-1.5 rounded-lg bg-ink-50 text-ink-600 text-[12px]">{t.conflicts.partial}</p>}
        {balanceWarning && (
          <div className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800">
            <TrendingDown size={14} className="shrink-0 mt-0.5" />
            <span className="flex-1">{f(t.conflicts.balanceWorse, { before: `${num(balanceWarning.before, 2)}%`, after: `${num(balanceWarning.after, 2)}%` })}</span>
            <button type="button" onClick={onDismissWarning} className="text-rose-500 hover:text-rose-800 cursor-pointer" aria-label={t.common.close}><X size={13} /></button>
          </div>
        )}
        {!hard.length && !groups.length && !uneven.length && <p className="px-2 py-3 text-ink-500">{t.conflicts.none}</p>}
        <Section icon={<AlertOctagon size={14} className="text-rose-600" />} title={t.conflicts.hard} count={hard.length} defaultOpen>
          {hard.map(h => (
            <Item key={h.code} onClick={() => onFocus([h.code])}>
              <div className="font-semibold text-ink-900">{h.code} <span className="font-normal text-ink-600">{byCode.get(h.code)?.storeName}</span></div>
              {h.texts.map((x, k) => <div key={k} className="text-rose-700">{x}</div>)}
            </Item>
          ))}
        </Section>
        <Section icon={<AlertTriangle size={14} className="text-amber-600" />} title={`${t.conflicts.soft} · ${t.conflicts.groups}`} count={groups.length} defaultOpen>
          {groups.map((g, k) => (
            <Item key={k} onClick={() => onFocus(g.stores)}>
              <div className="text-ink-800">{f(t.conflicts.group, { party: g.party || '—', region: g.region || '—', day: dayShort(g.day), count: g.count, min: g.min })}</div>
              <div className="text-ink-500 truncate">{g.stores.join(', ')}</div>
            </Item>
          ))}
        </Section>
        <Section icon={<AlertTriangle size={14} className="text-amber-600" />} title={`${t.conflicts.soft} · ${t.conflicts.uneven}`} count={uneven.length}>
          {uneven.map(c => (
            <Item key={c} onClick={() => onFocus([c])}>
              <span className="font-semibold text-ink-900">{c}</span> <span className="text-ink-600">{byCode.get(c)?.storeName}</span>
              <span className="text-ink-400"> · {byCode.get(c)?.currentDays.map(dayShort).join(' ')}</span>
            </Item>
          ))}
        </Section>
      </div>
    </aside>
  );
};

const Section: React.FC<{ icon: React.ReactNode; title: string; count: number; defaultOpen?: boolean; children: React.ReactNode }> = ({ icon, title, count, defaultOpen, children }) => {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  if (!count) return null;
  return (
    <div className="rounded-xl border border-ink-200">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="w-full flex items-center gap-2 px-2.5 py-2 text-left cursor-pointer">
        {open ? <ChevronDown size={13} className="text-ink-400" /> : <ChevronRight size={13} className="text-ink-400" />}
        {icon}
        <span className="flex-1 font-bold text-ink-800">{title}</span>
        <span className="px-1.5 rounded-full bg-ink-100 text-ink-700 text-[11px] font-bold tabular-nums">{count}</span>
      </button>
      {open && <ul className="border-t border-ink-100 divide-y divide-ink-100 max-h-[40vh] overflow-y-auto">{children}</ul>}
    </div>
  );
};

const Item: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => (
  <li>
    <button type="button" onClick={onClick} className={cn('w-full text-left px-2.5 py-1.5 hover:bg-ink-50 cursor-pointer leading-snug')}>{children}</button>
  </li>
);
