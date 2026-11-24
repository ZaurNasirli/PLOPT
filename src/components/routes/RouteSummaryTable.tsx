import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { RouteInsight, formatHoursMinutes } from '../../services/routeInsights';
import { useTranslation } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';
import { LoadBar, RouteDot, RouteListFilter, RouteListSort, StatusPill } from './RouteViewParts';

interface RouteSummaryTableProps {
  items: RouteInsight[];
  totalCount: number;
  selectedRouteId: string | null;
  filter: RouteListFilter;
  sort: RouteListSort;
  onSetFilter: (f: RouteListFilter) => void;
  onSetSort: (s: RouteListSort) => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** Full-width summary of every route with all numbers side by side. */
export const RouteSummaryTable: React.FC<RouteSummaryTableProps> = ({
  items, totalCount, selectedRouteId, filter, sort, onSetFilter, onSetSort, onSelect, onClose
}) => {
  const { t } = useTranslation();
  const hm = (m: number) => formatHoursMinutes(m, t('unitHourShort'), t('unitMinShort'));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const totals = items.reduce((acc, i) => ({ km: acc.km + i.km, min: acc.min + i.totalMin, stops: acc.stops + i.stopsCount }), { km: 0, min: 0, stops: 0 });
  const sortHeader = (key: RouteListSort, label: string, cls = '') => (
    <th className={cn('px-3 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap', cls)}>
      <button type="button" className={cn('uppercase tracking-wide cursor-pointer hover:text-foreground', sort === key && 'text-foreground underline underline-offset-4')} onClick={() => onSetSort(sort === key ? 'num' : key)}>
        {label}
      </button>
    </th>
  );
  const plainHeader = (label: string, cls = '') => (
    <th className={cn('px-3 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap', cls)}>{label}</th>
  );

  return (
    <div className="fixed inset-0 z-[3200] bg-black/45 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-6xl bg-card border rounded-2xl shadow-2xl overflow-hidden my-6" onClick={e => e.stopPropagation()} role="dialog" aria-label={t('rvSummaryTable')}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b">
          <div>
            <h2 className="text-[18px] font-bold">{t('rvSummaryTable')}</h2>
            <p className="text-[12.5px] text-muted-foreground tabular-nums">
              {t('rvOf', { shown: items.length, total: totalCount })} · {Math.round(totals.km * 10) / 10} {t('unitKm')} · {totals.stops} {t('rvStops')} · {hm(totals.min)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(['all', 'attention'] as RouteListFilter[]).map(f => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => onSetFilter(f)}
                className={cn('h-8 px-3 rounded-full border text-[12.5px] font-semibold cursor-pointer', filter === f ? 'bg-primary/12 border-primary' : 'text-muted-foreground hover:text-foreground')}
              >
                {f === 'all' ? t('rvFilterAll') : t('rvFilterAttention')}
              </button>
            ))}
            <button type="button" onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-lg border hover:border-primary cursor-pointer" aria-label={t('rvClose')}>
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead className="bg-muted/50 text-left">
              <tr>
                {sortHeader('num', t('rvColRoute'))}
                {plainHeader(t('rvColStatus'))}
                {plainHeader(t('rvColStops'), 'text-right')}
                {sortHeader('km', t('rvColKm'), 'text-right')}
                {plainHeader(t('rvColTime'), 'text-right')}
                {sortHeader('load', t('rvColLoad'))}
                {plainHeader(t('rvColTruck'))}
                {plainHeader(t('rvColWeight'), 'text-right')}
                {plainHeader(t('rvColVolume'), 'text-right')}
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.length === 0 && (
                <tr><td colSpan={9} className="px-5 py-8 text-center text-muted-foreground">{totalCount === 0 ? t('rvEmpty') : t('rvNoAttention')}</td></tr>
              )}
              {items.map(i => (
                <tr
                  key={`rv-table-${i.route.id}`}
                  tabIndex={0}
                  onClick={() => onSelect(i.route.id)}
                  onKeyDown={e => { if (e.key === 'Enter') onSelect(i.route.id); }}
                  className={cn('cursor-pointer hover:bg-muted/50 outline-none focus-visible:bg-primary/10', i.route.id === selectedRouteId && 'bg-primary/10')}
                >
                  <td className="px-3 py-2.5 whitespace-nowrap"><span className="inline-flex items-center gap-2 font-semibold"><RouteDot color={i.route.color} />{i.route.name}</span></td>
                  <td className="px-3 py-2.5"><StatusPill status={i.status} /></td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{i.stopsCount}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{i.km}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{hm(i.totalMin)}</td>
                  <td className="px-3 py-2.5 min-w-[150px]"><LoadBar pct={i.loadPct} /></td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{i.truckName || '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{Math.round(i.weight)} {t('unitKg')}{i.wtPct !== null && <span className="text-muted-foreground"> · {i.wtPct}%</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{Math.round(i.volume * 10) / 10} {t('unitM3')}{i.volPct !== null && <span className="text-muted-foreground"> · {i.volPct}%</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
