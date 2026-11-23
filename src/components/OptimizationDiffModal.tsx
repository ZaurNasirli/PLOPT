import React from 'react';
import { motion } from 'motion/react';
import { 
  CheckCircle2, 
  X, 
  RotateCcw, 
  Wand2, 
  TrendingDown, 
  TrendingUp, 
  ArrowRight, 
  Truck, 
  Layers, 
  DollarSign,
  ThumbsUp
} from 'lucide-react';
import { RouteHistoryEntry } from '../services/routeHistoryService';
import { Route, Order } from '../types';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n/I18nContext';

interface OptimizationDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: RouteHistoryEntry | null;
  onRollback: (routes: Route[], orders: Order[]) => void;
}

export const OptimizationDiffModal: React.FC<OptimizationDiffModalProps> = ({
  isOpen,
  onClose,
  entry,
  onRollback
}) => {
  const { t } = useTranslation();
  if (!isOpen || !entry) return null;

  const { diff, snapshotBefore } = entry;

  const distPercent = diff.distanceBefore > 0 
    ? Math.round(((diff.distanceAfter - diff.distanceBefore) / diff.distanceBefore) * 1000) / 10 
    : 0;

  const costPercent = diff.estimatedCostBefore > 0 
    ? Math.round(((diff.estimatedCostAfter - diff.estimatedCostBefore) / diff.estimatedCostBefore) * 1000) / 10 
    : 0;

  const deltaText = (delta: number, unit: string) => {
    const value = Math.round(Math.abs(delta) * 10) / 10;
    if (value === 0) return t('optDiffNoChange');
    return delta < 0
      ? t('optDiffSavings', { value: `${value} ${unit}` })
      : t('optDiffIncrease', { value: `${value} ${unit}` });
  };

  return (
    <div className="fixed inset-0 z-[3300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 15 }}
        className="bg-card border rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden text-card-foreground"
      >
        {/* Header */}
        <div className="p-5 border-b flex items-center justify-between bg-primary/5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/15 text-primary rounded-xl">
              <Wand2 size={24} />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">{t('optDiffTitle')}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {entry.title}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content: Summary comparison cards */}
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {/* Mileage */}
            <div className="p-3.5 rounded-xl border bg-card space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
                <span className="flex items-center gap-1">
                  <Layers size={13} className="text-emerald-500" /> {t('optDiffMileage')}
                </span>
                {diff.distanceDelta !== 0 && diff.distanceBefore > 0 && (
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5",
                    diff.distanceDelta < 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"
                  )}>
                    {diff.distanceDelta < 0 ? <TrendingDown size={10} /> : <TrendingUp size={10} />}
                    {distPercent}%
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-muted-foreground line-through">{diff.distanceBefore}</span>
                <ArrowRight size={12} className="text-muted-foreground" />
                <span className="text-xl font-black text-foreground">{diff.distanceAfter} <span className="text-xs font-normal">{t('unitKm')}</span></span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {deltaText(diff.distanceDelta, t('unitKm'))}
              </div>
            </div>

            {/* Cost */}
            <div className="p-3.5 rounded-xl border bg-card space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
                <span className="flex items-center gap-1">
                  <DollarSign size={13} className="text-amber-500" /> {t('optDiffCost')}
                </span>
                {diff.estimatedCostDelta !== 0 && diff.estimatedCostBefore > 0 && (
                  <span className={cn(
                    "text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5",
                    diff.estimatedCostDelta < 0 ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600"
                  )}>
                    {costPercent}%
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-muted-foreground line-through">{diff.estimatedCostBefore} ₼</span>
                <ArrowRight size={12} className="text-muted-foreground" />
                <span className="text-xl font-black text-foreground">{diff.estimatedCostAfter} <span className="text-xs font-normal">₼</span></span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {deltaText(diff.estimatedCostDelta, '₼')}
              </div>
            </div>

            {/* Routes count */}
            <div className="p-3.5 rounded-xl border bg-card space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
                <span className="flex items-center gap-1">
                  <Truck size={13} className="text-primary" /> {t('optDiffRoutes')}
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
                <span className="text-xl font-black text-foreground">{diff.routesAfter}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {t('optDiffRoutesUsed')}
              </div>
            </div>

            {/* Average load */}
            <div className="p-3.5 rounded-xl border bg-card space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground font-semibold">
                <span className="flex items-center gap-1">
                  <Truck size={13} className="text-sky-500" /> {t('optDiffVolumeLoad')}
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
                <span className="text-xl font-black text-foreground">{diff.avgVolumeLoadAfter}%</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                {t('optDiffCapacity')}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-muted/40 border text-xs text-muted-foreground">
            {t('optDiffHistoryNotice')}
          </div>
        </div>

        {/* Footer actions */}
        <div className="p-4 border-t bg-muted/20 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              onRollback(snapshotBefore.routes, snapshotBefore.orders);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-input bg-background hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors cursor-pointer"
          >
            <RotateCcw size={13} />
            <span>{t('optDiffRollback')}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs cursor-pointer"
          >
            <ThumbsUp size={14} />
            <span>{t('optDiffAccept')}</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
};
