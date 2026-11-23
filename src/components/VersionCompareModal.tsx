import React from 'react';
import { motion } from 'motion/react';
import { 
  X, 
  GitCompare, 
  RotateCcw, 
  TrendingDown, 
  TrendingUp, 
  ArrowRight, 
  Layers, 
  Route as RouteIcon, 
  Truck, 
  DollarSign, 
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { RouteHistoryEntry } from '../services/routeHistoryService';
import { Route, Order } from '../types';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n/I18nContext';

interface VersionCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: RouteHistoryEntry | null;
  onRestoreSnapshot: (routes: Route[], orders: Order[], message: string) => void;
}

export const VersionCompareModal: React.FC<VersionCompareModalProps> = ({
  isOpen,
  onClose,
  entry,
  onRestoreSnapshot
}) => {
  const { t } = useTranslation();
  if (!isOpen || !entry) return null;

  const { diff, snapshotBefore, snapshotAfter } = entry;

  const getPercentDelta = (before: number, after: number) => {
    if (before === 0) return 0;
    return Math.round(((after - before) / before) * 1000) / 10;
  };

  const distPercent = getPercentDelta(diff.distanceBefore, diff.distanceAfter);
  const costPercent = getPercentDelta(diff.estimatedCostBefore, diff.estimatedCostAfter);

  return (
    <div className="fixed inset-0 z-[3200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 15 }}
        className="bg-card border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden text-card-foreground"
      >
        {/* Modal Header */}
        <div className="p-5 border-b flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 text-primary rounded-xl">
              <GitCompare size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">{t('vCompTitle')}</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                  {entry.actionType}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {entry.title} • {entry.timeFormatted}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
          {/* Key KPI Comparison Bento Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            {/* Routes Count Card */}
            <div className="p-3.5 rounded-xl border bg-card flex flex-col justify-between space-y-2">
              <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <RouteIcon size={14} className="text-primary" /> {t('navRoutes')}
                </span>
                {diff.routesDelta !== 0 && (
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded",
                    diff.routesDelta < 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
                  )}>
                    {diff.routesDelta > 0 ? `+${diff.routesDelta}` : diff.routesDelta}
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-muted-foreground line-through">{diff.routesBefore}</span>
                <ArrowRight size={12} className="text-muted-foreground" />
                <span className="text-2xl font-black text-foreground">{diff.routesAfter}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{t('vCompRoutesCount')}</span>
            </div>

            {/* Total Distance Card */}
            <div className="p-3.5 rounded-xl border bg-card flex flex-col justify-between space-y-2">
              <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <Layers size={14} className="text-emerald-500" /> {t('optDiffMileage')}
                </span>
                {diff.distanceDelta !== 0 && (
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5",
                    diff.distanceDelta < 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"
                  )}>
                    {diff.distanceDelta < 0 ? <TrendingDown size={11} /> : <TrendingUp size={11} />}
                    {distPercent}%
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-muted-foreground line-through">{diff.distanceBefore}</span>
                <ArrowRight size={12} className="text-muted-foreground" />
                <span className="text-2xl font-black text-foreground">{diff.distanceAfter} <span className="text-xs font-medium">{t('unitKm')}</span></span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {t('vCompDifference', { value: `${diff.distanceDelta > 0 ? `+${diff.distanceDelta}` : diff.distanceDelta} ${t('unitKm')}` })}
              </span>
            </div>

            {/* Average Volume Load Card */}
            <div className="p-3.5 rounded-xl border bg-card flex flex-col justify-between space-y-2">
              <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <Truck size={14} className="text-sky-500" /> {t('vCompVolumeLoadCard')}
                </span>
                {diff.avgVolumeLoadDelta !== 0 && (
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded",
                    diff.avgVolumeLoadDelta > 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
                  )}>
                    {diff.avgVolumeLoadDelta > 0 ? `+${diff.avgVolumeLoadDelta}%` : `${diff.avgVolumeLoadDelta}%`}
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-muted-foreground line-through">{diff.avgVolumeLoadBefore}%</span>
                <ArrowRight size={12} className="text-muted-foreground" />
                <span className="text-2xl font-black text-foreground">{diff.avgVolumeLoadAfter}%</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{t('vCompAvgVolumeCard')}</span>
            </div>

            {/* Estimated Cost Card */}
            <div className="p-3.5 rounded-xl border bg-card flex flex-col justify-between space-y-2">
              <div className="flex items-center justify-between text-muted-foreground text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <DollarSign size={14} className="text-amber-500" /> {t('vCompCostCard')}
                </span>
                {diff.estimatedCostDelta !== 0 && (
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded",
                    diff.estimatedCostDelta < 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"
                  )}>
                    {costPercent}%
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-muted-foreground line-through">{diff.estimatedCostBefore} ₼</span>
                <ArrowRight size={12} className="text-muted-foreground" />
                <span className="text-2xl font-black text-foreground">{diff.estimatedCostAfter} <span className="text-xs font-medium">₼</span></span>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {t('optDiffSavings', { value: diff.estimatedCostDelta < 0 ? `${Math.abs(diff.estimatedCostDelta)} ₼` : `${diff.estimatedCostDelta} ₼` })}
              </span>
            </div>
          </div>

          {/* Side by Side Snapshot Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Version BEFORE */}
            <div className="p-4 rounded-xl border bg-muted/20 flex flex-col gap-3">
              <div className="flex items-center justify-between pb-2 border-b">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                  <h3 className="font-bold text-sm">{t('vCompStateBefore')}</h3>
                </div>
                <span className="text-xs font-semibold text-muted-foreground">
                  {t('vCompRoutesOrdersSummary', { routes: snapshotBefore.routes.length, km: diff.distanceBefore })}
                </span>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1 scrollbar-thin">
                {snapshotBefore.routes.map((r, rIdx) => (
                  <div key={`vcomp-before-${r.id}-${rIdx}`} className="p-2.5 bg-card rounded-lg border text-xs flex items-center justify-between">
                    <div className="flex items-center gap-2 truncate">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                      <span className="font-semibold truncate max-w-[140px]">{r.name}</span>
                      <span className="text-[10px] text-muted-foreground">({r.orderIds.length} {t('orderFilterAssigned')})</span>
                    </div>
                    <span className="font-bold text-foreground shrink-0">{r.distance} {t('unitKm')}</span>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  onRestoreSnapshot(
                    snapshotBefore.routes,
                    snapshotBefore.orders,
                    `Restored previous version (${entry.timeFormatted})`
                  );
                  onClose();
                }}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold border border-primary/30 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors mt-auto cursor-pointer"
              >
                <RotateCcw size={13} />
                <span>{t('vCompRestoreBefore')}</span>
              </button>
            </div>

            {/* Version AFTER */}
            <div className="p-4 rounded-xl border bg-primary/5 flex flex-col gap-3">
              <div className="flex items-center justify-between pb-2 border-b border-primary/20">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                  <h3 className="font-bold text-sm text-primary">{t('vCompStateAfter')}</h3>
                </div>
                <span className="text-xs font-semibold text-primary">
                  {t('vCompRoutesOrdersSummary', { routes: snapshotAfter.routes.length, km: diff.distanceAfter })}
                </span>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1 scrollbar-thin">
                {snapshotAfter.routes.map((r, rIdx) => (
                  <div key={`vcomp-after-${r.id}-${rIdx}`} className="p-2.5 bg-card rounded-lg border border-primary/20 text-xs flex items-center justify-between">
                    <div className="flex items-center gap-2 truncate">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                      <span className="font-semibold truncate max-w-[140px]">{r.name}</span>
                      <span className="text-[10px] text-muted-foreground">({r.orderIds.length} {t('orderFilterAssigned')})</span>
                    </div>
                    <span className="font-bold text-foreground shrink-0">{r.distance} {t('unitKm')}</span>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={onClose}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors mt-auto cursor-pointer"
              >
                <CheckCircle2 size={13} />
                <span>{t('vCompKeepCurrent')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t bg-muted/20 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {t('vCompFooterNotice')}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-muted hover:bg-accent transition-colors cursor-pointer"
          >
            {t('btnClose')}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
