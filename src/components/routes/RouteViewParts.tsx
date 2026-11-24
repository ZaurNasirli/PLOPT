import React from 'react';
import { RouteInsight, RouteStatus, statusIcon, statusTone } from '../../services/routeInsights';
import { useTranslation } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';

export type RouteListSort = 'num' | 'km' | 'load' | 'low';
export type RouteListFilter = 'all' | 'attention';

/** Filter + sort shared by the list, the summary table and ←/→ navigation. */
export function orderInsights(insights: RouteInsight[], filter: RouteListFilter, sort: RouteListSort): RouteInsight[] {
  const list = insights.filter(i => filter === 'all' || i.status !== 'ok');
  const indexed = list.map((i, idx) => ({ i, idx }));
  const load = (x: RouteInsight) => x.loadPct ?? -1;
  indexed.sort((a, b) => {
    switch (sort) {
      case 'km': return b.i.km - a.i.km;
      case 'load': return load(b.i) - load(a.i);
      case 'low': return load(a.i) - load(b.i);
      default: return a.idx - b.idx;
    }
  });
  return indexed.map(x => x.i);
}

const toneClass: Record<'bad' | 'warn' | 'info' | 'ok', string> = {
  bad: 'bg-rose-500/12 text-rose-700 dark:text-rose-300 border-rose-500/30',
  warn: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/35',
  info: 'bg-sky-500/12 text-sky-800 dark:text-sky-300 border-sky-500/30',
  ok: 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-300 border-emerald-500/30'
};

export function useStatusLabel() {
  const { t } = useTranslation();
  return (s: RouteStatus) => ({
    notruck: t('rvStatusNoTruck'),
    blocked: t('rvStatusBlocked'),
    over: t('rvStatusOver'),
    low: t('rvStatusLow'),
    long: t('rvStatusLong'),
    ok: t('rvStatusOk')
  }[s]);
}

export const StatusPill: React.FC<{ status: RouteStatus; className?: string }> = ({ status, className }) => {
  const label = useStatusLabel();
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11.5px] font-bold whitespace-nowrap', toneClass[statusTone[status]], className)}>
      <span aria-hidden="true">{statusIcon[status]}</span>
      {label(status)}
    </span>
  );
};

export const LoadBar: React.FC<{ pct: number | null; className?: string }> = ({ pct, className }) => {
  if (pct === null) return <span className={cn('text-[12px] text-muted-foreground', className)}>—</span>;
  const color = pct > 103 ? 'bg-rose-500' : pct < 45 ? 'bg-amber-500' : 'bg-emerald-600 dark:bg-emerald-500';
  return (
    <span className={cn('inline-flex items-center gap-1.5 min-w-0', className)}>
      <span className="relative h-2 w-full min-w-[44px] rounded-full bg-muted overflow-hidden">
        <span className={cn('absolute inset-y-0 left-0 rounded-full', color)} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="text-[12.5px] font-semibold tabular-nums shrink-0">{pct}%</span>
    </span>
  );
};

export const RouteDot: React.FC<{ color: string; className?: string }> = ({ color, className }) => (
  <span className={cn('inline-block w-3 h-3 rounded-full shrink-0 ring-2 ring-card', className)} style={{ backgroundColor: color }} />
);
