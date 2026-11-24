import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Info, Lock, Trash2, Unlock, Wand2, X } from 'lucide-react';
import { RouteInsight, formatHoursMinutes } from '../../services/routeInsights';
import { useTranslation } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';
import { RouteDot, StatusPill } from './RouteViewParts';

interface RouteFocusPanelProps {
  insight: RouteInsight;
  position: number; // 1-based, 0 when the route is hidden by the list filter
  total: number;
  isLocked: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onShowDetails: () => void;
  onOptimize: () => void;
  onToggleVisibility: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
}

/** One route in focus: key numbers and the stops in visit order. Sits over the bottom of the map. */
export const RouteFocusPanel: React.FC<RouteFocusPanelProps> = ({
  insight, position, total, isLocked, onPrev, onNext, onClose, onShowDetails, onOptimize, onToggleVisibility, onToggleLock, onDelete
}) => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { route } = insight;
  const hm = (m: number) => formatHoursMinutes(m, t('unitHourShort'), t('unitMinShort'));

  const iconBtn = 'h-8 w-8 inline-flex items-center justify-center rounded-lg border bg-background hover:border-primary hover:text-primary cursor-pointer transition-colors';

  return (
    <section
      aria-label={route.name}
      className="absolute left-3 right-3 bottom-3 z-[1000] max-h-[48%] flex flex-col rounded-2xl border bg-card/97 backdrop-blur shadow-2xl overflow-hidden"
      onClick={e => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b">
        <div className="flex items-center gap-2.5 min-w-0">
          <RouteDot color={route.color} className="w-3.5 h-3.5" />
          <h2 className="text-[18px] font-bold truncate">{route.name}</h2>
          <StatusPill status={insight.status} />
          {isLocked && <Lock size={14} className="text-amber-500" aria-label={t('rvLocked')} />}
          {route.barrierStatus === 'detour' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-500/35 bg-amber-500/12 text-amber-800 dark:text-amber-300 text-[11.5px] font-bold whitespace-nowrap">
              🚧 {t('barrierRouteDetourBadge')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" className={iconBtn} onClick={onPrev} title={t('rvPrev')} aria-label={t('rvPrev')}>←</button>
          <span className="text-[12.5px] text-muted-foreground tabular-nums min-w-[52px] text-center" title={t('rvKeyboardHint')}>
            {position > 0 ? t('rvOf', { shown: position, total }) : `— / ${total}`}
          </span>
          <button type="button" className={iconBtn} onClick={onNext} title={t('rvNext')} aria-label={t('rvNext')}>→</button>
          <span className="w-px h-6 bg-border mx-1" />
          <button type="button" className={iconBtn} onClick={onShowDetails} title={t('rvDetails')} aria-label={t('rvDetails')}><Info size={15} /></button>
          <button type="button" className={iconBtn} onClick={onOptimize} title={t('rvOptimize')} aria-label={t('rvOptimize')}><Wand2 size={15} /></button>
          <button type="button" className={iconBtn} onClick={onToggleVisibility} title={route.isVisible ? t('rvHide') : t('rvShow')} aria-label={route.isVisible ? t('rvHide') : t('rvShow')}>
            {route.isVisible ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
          <button type="button" className={iconBtn} onClick={onToggleLock} title={isLocked ? t('rvUnlock') : t('rvLock')} aria-label={isLocked ? t('rvUnlock') : t('rvLock')}>
            {isLocked ? <Unlock size={15} /> : <Lock size={15} />}
          </button>
          {confirmDelete ? (
            <span className="inline-flex items-center gap-1">
              <button type="button" className="h-8 px-2.5 rounded-lg bg-destructive text-destructive-foreground text-[12px] font-bold cursor-pointer" onClick={() => { setConfirmDelete(false); onDelete(); }}>
                {t('rvDelete')}
              </button>
              <button type="button" className="h-8 px-2 rounded-lg border text-[12px] cursor-pointer" onClick={() => setConfirmDelete(false)}>{t('rvCancel')}</button>
            </span>
          ) : (
            <button type="button" className={cn(iconBtn, 'hover:border-destructive hover:text-destructive')} onClick={() => setConfirmDelete(true)} title={t('rvDelete')} aria-label={t('rvDelete')}><Trash2 size={15} /></button>
          )}
          <button type="button" className={iconBtn} onClick={() => setCollapsed(c => !c)} title={collapsed ? t('rvExpand') : t('rvCollapse')} aria-label={collapsed ? t('rvExpand') : t('rvCollapse')}>
            {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          <button type="button" className={iconBtn} onClick={onClose} title={t('rvClose')} aria-label={t('rvClose')}><X size={15} /></button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Key numbers */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border shrink-0">
            {[
              { v: String(insight.stopsCount), u: '', l: t('rvStopsLong') },
              { v: String(insight.km), u: t('unitKm'), l: insight.isRealRoad ? t('rvKmLong') : t('rvKmStraight') },
              { v: hm(insight.totalMin), u: '', l: t('rvTimeLong') },
              {
                v: insight.loadPct === null ? '—' : `${insight.loadPct}`,
                u: insight.loadPct === null ? '' : '%',
                l: `${t('rvLoadLong')}${insight.truckName ? ` · ${insight.truckName}` : ''}`
              }
            ].map(k => (
              <div key={k.l} className="bg-card px-3.5 py-2">
                <div className="text-[22px] font-bold tabular-nums leading-tight">
                  {k.v}{k.u && <span className="text-[13px] font-semibold text-muted-foreground ml-1">{k.u}</span>}
                </div>
                <div className="text-[12px] text-muted-foreground truncate" title={k.l}>{k.l}</div>
              </div>
            ))}
          </div>

          {/* Stops in visit order */}
          <ol className="overflow-y-auto grid grid-cols-1 lg:grid-cols-2 border-t">
            <StopRow n="С" dark name={t('rvDepotStart')} sub="" right="0" unitKm={t('unitKm')} />
            {insight.stops.map((s, k) => (
              <StopRow
                key={`stop-${route.id}-${k}`}
                n={String(k + 1)}
                color={route.color}
                name={s.name}
                sub={`${s.orders} ${t('rvOrdersShort')} · ${Math.round(s.volume * 10) / 10} ${t('unitM3')} · ${Math.round(s.weight)} ${t('unitKg')}`}
                right={`+${s.legKm}`}
                total={`${s.cumulativeKm} ${t('rvTotal')}`}
                unitKm={t('unitKm')}
              />
            ))}
            <StopRow n="С" dark name={t('rvDepotEnd')} sub="" right={`+${insight.returnKm}`} total={`${insight.km} ${t('rvTotal')}`} unitKm={t('unitKm')} />
          </ol>
        </>
      )}
    </section>
  );
};

const StopRow: React.FC<{ n: string; name: string; sub: string; right: string; total?: string; unitKm: string; color?: string; dark?: boolean }> = ({ n, name, sub, right, total, unitKm, color, dark }) => (
  <li className="grid grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-2.5 px-3.5 py-2 border-b lg:odd:border-r">
    <span
      className={cn('w-6 h-6 rounded-full grid place-items-center text-[11.5px] font-bold text-white', dark && 'bg-foreground text-background')}
      style={!dark ? { backgroundColor: color } : undefined}
    >
      {n}
    </span>
    <div className="min-w-0">
      <div className="font-semibold text-[13.5px] truncate" title={name}>{name}</div>
      {sub && <div className="text-[12px] text-muted-foreground tabular-nums">{sub}</div>}
    </div>
    <div className="text-right text-[12px] text-muted-foreground tabular-nums leading-tight">
      {right} {unitKm}{total && <><br />{total}</>}
    </div>
  </li>
);
