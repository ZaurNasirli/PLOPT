import React from 'react';
import { Table2, EyeOff, Lock } from 'lucide-react';
import { RouteInsight } from '../../services/routeInsights';
import { useTranslation } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';
import { LoadBar, RouteDot, RouteListFilter, RouteListSort, StatusPill } from './RouteViewParts';

interface RouteSummaryListProps {
  /** already filtered and sorted */
  items: RouteInsight[];
  totalCount: number;
  selectedRouteId: string | null;
  lockedRouteIds: string[];
  filter: RouteListFilter;
  sort: RouteListSort;
  onSetFilter: (f: RouteListFilter) => void;
  onSetSort: (s: RouteListSort) => void;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onOpenTable: () => void;
}

/** Compact, uniform list of routes: status and load are readable at a glance. */
export const RouteSummaryList: React.FC<RouteSummaryListProps> = ({
  items, totalCount, selectedRouteId, lockedRouteIds, filter, sort, onSetFilter, onSetSort, onSelect, onHover, onOpenTable
}) => {
  const { t } = useTranslation();

  return (
    <div className="border rounded-xl bg-card overflow-hidden">
      <div className="px-3 py-2.5 border-b space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-bold">
            {t('rvRoutes')} <span className="text-muted-foreground font-semibold tabular-nums">· {t('rvOf', { shown: items.length, total: totalCount })}</span>
          </span>
          <button
            type="button"
            onClick={onOpenTable}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border text-[12px] font-semibold hover:border-primary hover:text-primary cursor-pointer"
            title={t('rvSummaryTable')}
          >
            <Table2 size={13} /> {t('rvSummaryTable')}
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex gap-1" role="group" aria-label={t('rvRoutes')}>
            {(['all', 'attention'] as RouteListFilter[]).map(f => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => onSetFilter(f)}
                className={cn(
                  'h-7 px-2.5 rounded-full border text-[12px] font-semibold cursor-pointer',
                  filter === f ? 'bg-primary/12 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {f === 'all' ? t('rvFilterAll') : t('rvFilterAttention')}
              </button>
            ))}
          </div>
          <select
            id="route-list-sort"
            value={sort}
            onChange={e => onSetSort(e.target.value as RouteListSort)}
            className="h-7 px-1.5 rounded-lg border bg-background text-[12px] font-semibold cursor-pointer"
            aria-label={t('rvSort')}
          >
            <option value="num">{t('rvSortNum')}</option>
            <option value="km">{t('rvSortKm')}</option>
            <option value="load">{t('rvSortLoad')}</option>
            <option value="low">{t('rvSortLow')}</option>
          </select>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="p-6 text-center text-[13px] text-muted-foreground">
          {totalCount === 0 ? t('rvEmpty') : t('rvNoAttention')}
        </div>
      ) : (
        <ul className="divide-y" role="listbox" aria-label={t('rvRoutes')}>
          {items.map(i => {
            const selected = i.route.id === selectedRouteId;
            const locked = lockedRouteIds.includes(i.route.id);
            return (
              <li
                key={`rv-row-${i.route.id}`}
                id={`rv-row-${i.route.id}`}
                role="option"
                aria-selected={selected}
                tabIndex={0}
                onClick={() => onSelect(selected ? null : i.route.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(selected ? null : i.route.id); } }}
                onMouseEnter={() => onHover(i.route.id)}
                onMouseLeave={() => onHover(null)}
                className={cn(
                  'relative px-3 py-2.5 cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
                  selected ? 'bg-primary/10' : 'hover:bg-muted/50',
                  !i.route.isVisible && 'opacity-55'
                )}
              >
                {selected && <span className="absolute left-0 inset-y-0 w-1" style={{ backgroundColor: i.route.color }} />}
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <RouteDot color={i.route.color} />
                    <span className="font-semibold text-[14px] truncate" title={i.route.name}>{i.route.name}</span>
                    {locked && <Lock size={12} className="text-amber-500 shrink-0" aria-label={t('rvLocked')} />}
                    {i.route.barrierStatus === 'detour' && (
                      <span className="text-[11px] shrink-0" title={t('barrierRouteDetourBadge')} aria-label={t('barrierRouteDetourBadge')}>🚧</span>
                    )}
                    {!i.route.isVisible && <EyeOff size={12} className="text-muted-foreground shrink-0" />}
                  </span>
                  <StatusPill status={i.status} />
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[12.5px] text-muted-foreground">
                  <span className="tabular-nums shrink-0">
                    {i.stopsCount} {t('rvStops')} · <span className="text-foreground font-semibold">{i.km}</span> {t('unitKm')}
                  </span>
                  <LoadBar pct={i.loadPct} className="flex-1" />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
