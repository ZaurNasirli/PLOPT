import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, Play, BarChart2, CheckCircle2, TrendingDown, TrendingUp, Clock, Truck, ShieldCheck, RefreshCw } from 'lucide-react';
import { runComprehensiveBenchmark, BenchmarkReport } from '../services/optimizer/Benchmark';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n/I18nContext';

interface BenchmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BenchmarkModal: React.FC<BenchmarkModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [isRunning, setIsRunning] = useState(false);
  const [report, setReport] = useState<BenchmarkReport | null>(null);

  if (!isOpen) return null;

  const handleRunBenchmark = async () => {
    setIsRunning(true);
    try {
      // Allow UI to update
      await new Promise(r => setTimeout(r, 100));
      const res = await runComprehensiveBenchmark();
      setReport(res);
    } catch (e) {
      console.error('Benchmark failed:', e);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[3400] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 15 }}
        className="bg-card border shadow-2xl rounded-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh] text-card-foreground"
      >
        {/* Header */}
        <div className="p-5 border-b flex items-center justify-between bg-primary/5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/15 text-primary rounded-xl">
              <BarChart2 size={24} />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">
                🧪 Benchmark: Baseline SMART vs Improved Hybrid VRP
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Автоматическое тестирование и объективное сравнение на 10, 30, 100 и 300 точках
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

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 scrollbar-thin">
          <div className="p-4 rounded-xl border bg-muted/20 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-bold text-foreground block">
                Сравнение алгоритмической эффективности
              </span>
              <p className="text-[11px] text-muted-foreground max-w-xl">
                Тестирует оба алгоритма на одних и тех же данных с учетом реальной дорожной матрицы OSRM, вместимости транспорта и окон доставки.
              </p>
            </div>
            <button
              type="button"
              disabled={isRunning}
              onClick={handleRunBenchmark}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-all cursor-pointer",
                isRunning
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {isRunning ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Вычисление (10, 30, 100, 300)...</span>
                </>
              ) : (
                <>
                  <Play size={14} />
                  <span>Запустить Benchmark</span>
                </>
              )}
            </button>
          </div>

          {report && (
            <div className="space-y-5">
              {/* Detailed Instances Comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {report.results.map((res, rIdx) => (
                  <div key={`bench-card-${res.pointCount}-${rIdx}`} className="p-4 rounded-xl border bg-card space-y-3 shadow-xs">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="text-sm font-black text-primary">
                        {res.pointCount} точек
                      </span>
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                        res.savings.distancePercent >= 0 
                          ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                          : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                      )}>
                        {res.savings.distancePercent >= 0 ? `-${res.savings.distancePercent}% км` : `+${Math.abs(res.savings.distancePercent)}% км`}
                      </span>
                    </div>

                    {/* All 11 Required Comparison Metrics */}
                    <div className="space-y-1.5 text-[11px]">
                      {/* 1. Distance */}
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Дистанция:</span>
                        <span>
                          <span className="line-through text-muted-foreground mr-1.5">{res.baseline.distanceKm}</span>
                          <b className="text-emerald-600 font-bold">{res.improved.distanceKm} км</b>
                        </span>
                      </div>

                      {/* 2. Duration */}
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Длительность:</span>
                        <span>
                          <span className="line-through text-muted-foreground mr-1.5">{res.baseline.durationMin}</span>
                          <b className="text-foreground">{res.improved.durationMin} мин</b>
                        </span>
                      </div>

                      {/* 3. Number of Vehicles */}
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Кол-во машин:</span>
                        <span>
                          <span className="line-through text-muted-foreground mr-1.5">{res.baseline.vehicles}</span>
                          <b className={cn(res.improved.vehicles <= res.baseline.vehicles ? "text-emerald-600" : "text-amber-600")}>
                            {res.improved.vehicles} авто
                          </b>
                        </span>
                      </div>

                      {/* 4. Volume Utilization */}
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Загрузка по объёму:</span>
                        <span>
                          <span className="line-through text-muted-foreground mr-1.5">{res.baseline.volumeUtil}%</span>
                          <b className="text-emerald-600 font-bold">{res.improved.volumeUtil}%</b>
                        </span>
                      </div>

                      {/* 5. Weight Utilization */}
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Загрузка по весу:</span>
                        <span>
                          <span className="line-through text-muted-foreground mr-1.5">{res.baseline.weightUtil}%</span>
                          <b className="text-foreground">{res.improved.weightUtil}%</b>
                        </span>
                      </div>

                      {/* 6. Average Utilization */}
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Средняя загрузка:</span>
                        <span>
                          <span className="line-through text-muted-foreground mr-1.5">{res.baseline.avgUtil}%</span>
                          <b className="text-foreground">{res.improved.avgUtil}%</b>
                        </span>
                      </div>

                      {/* 7 & 8. Min / Max Utilization */}
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Мин / Макс загрузка:</span>
                        <span className="font-mono text-[10px]">
                          {res.improved.minUtil}% / {res.improved.maxUtil}%
                        </span>
                      </div>

                      {/* 9. Stops */}
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Остановок:</span>
                        <span className="font-semibold">{res.improved.stops}</span>
                      </div>

                      {/* 10. Optimization Score */}
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Score цели:</span>
                        <span>
                          <span className="line-through text-muted-foreground mr-1">{res.baseline.score.toFixed(2)}</span>
                          <b className="text-primary">{res.improved.score.toFixed(2)}</b>
                        </span>
                      </div>

                      {/* 11. Execution Time */}
                      <div className="flex items-center justify-between pt-1 border-t">
                        <span className="text-muted-foreground">Время расчета:</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {res.improved.timeMs} мс (база: {res.baseline.timeMs} мс)
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Dynamic Factual Summary */}
              <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-primary">
                  <ShieldCheck size={16} />
                  <span>Итог фактического сравнения BASELINE vs IMPROVED:</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {report.summary}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-[11px]">
                  <div className="p-2.5 rounded-lg bg-card border shadow-2xs">
                    <strong className="block text-foreground">Фактическая дистанция</strong>
                    <span className="text-muted-foreground">
                      Дельта: {report.results.reduce((s, r) => s + r.savings.distanceKmDelta, 0).toFixed(1)} км
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-card border shadow-2xs">
                    <strong className="block text-foreground">Экономия автопарка</strong>
                    <span className="text-muted-foreground">
                      Высвобождено: {report.results.reduce((s, r) => s + r.savings.vehiclesSaved, 0)} машин
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-card border shadow-2xs">
                    <strong className="block text-foreground">Фактическая скорость</strong>
                    <span className="text-muted-foreground">
                      100 точек: {report.results.find(r => r.pointCount === 100)?.improved.timeMs ?? '< 1000'} мс
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
