import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Play, Plus, Sliders, Truck, Zap, Scale, Target, Clock, BarChart2, Sparkles } from 'lucide-react';
import { TruckType } from '../types';
import { RoutingLimits } from '../services/routingService';
import { AlgorithmSelector } from './AlgorithmSelector';
import { BenchmarkModal } from './BenchmarkModal';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n/I18nContext';

const Button = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  className, 
  onClick,
  id,
  disabled,
  title
}: { 
  children: React.ReactNode; 
  variant?: 'primary' | 'outline' | 'ghost' | 'destructive'; 
  size?: 'sm' | 'md' | 'lg' | 'icon';
  className?: string;
  onClick?: (e: any) => void;
  id?: string;
  disabled?: boolean;
  title?: string;
}) => {
  const variants = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
    ghost: "hover:bg-accent hover:text-accent-foreground",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90"
  };
  const sizes = {
    sm: "h-8 px-3 text-xs",
    md: "h-10 px-4 py-2",
    lg: "h-12 px-8",
    icon: "h-8 w-8 p-0"
  };
  return (
    <button 
      id={id}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {children}
    </button>
  );
};

const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input 
    className={cn(
      "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
);

interface RouterModalProps {
  isOpen: boolean;
  onClose: () => void;
  routingLimits: RoutingLimits;
  setRoutingLimits: React.Dispatch<React.SetStateAction<RoutingLimits>>;
  selectedAlgorithm: string;
  setSelectedAlgorithm: (algo: string) => void;
  isRouting: boolean;
  onRunRouting: () => void;
  hasFilteredStores: boolean;
  onOpenWhatIf?: () => void;
  onOpenConstraints?: () => void;
}

export const RouterModal: React.FC<RouterModalProps> = ({
  isOpen,
  onClose,
  routingLimits,
  setRoutingLimits,
  selectedAlgorithm,
  setSelectedAlgorithm,
  isRouting,
  onRunRouting,
  hasFilteredStores,
  onOpenWhatIf,
  onOpenConstraints
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'limits' | 'trucks'>('limits');
  const [isBenchmarkOpen, setIsBenchmarkOpen] = useState(false);

  if (!isOpen) return null;

  return (
    <>
      <AnimatePresence>
        <div key="router-modal-backdrop" className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ duration: 0.2 }}
          className="bg-card border shadow-2xl rounded-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="p-5 border-b flex items-center justify-between bg-muted/20">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center border border-primary/20">
                <Sliders size={20} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                  {t('routerTitle')}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {t('routerSubtitle')}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onClose} title={t('btnClose')}>
              <X size={18} />
            </Button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 px-6 pt-3 border-b bg-card">
            <button
              className={cn(
                "text-xs font-semibold uppercase tracking-wider pb-2.5 px-3 transition-all border-b-2 flex items-center gap-2 cursor-pointer",
                activeTab === 'limits' 
                  ? "text-primary border-primary font-bold" 
                  : "text-muted-foreground border-transparent hover:text-foreground"
              )}
              onClick={() => setActiveTab('limits')}
            >
              <Sliders size={14} />
              {t('routerTabGeneral')}
            </button>
            <button
              className={cn(
                "text-xs font-semibold uppercase tracking-wider pb-2.5 px-3 transition-all border-b-2 flex items-center gap-2 cursor-pointer",
                activeTab === 'trucks' 
                  ? "text-primary border-primary font-bold" 
                  : "text-muted-foreground border-transparent hover:text-foreground"
              )}
              onClick={() => setActiveTab('trucks')}
            >
              <Truck size={14} />
              {t('routerTabTrucks')} ({routingLimits.truckTypes.length})
            </button>
          </div>

          {/* Body Content */}
          <div className="p-6 overflow-y-auto max-h-[60vh] space-y-6 scrollbar-thin">
            {activeTab === 'limits' ? (
              <div className="space-y-6">
                {/* Limits Section */}
                <div>
                  <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
                    {t('routerTabGeneral')}
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3.5">
                    <div className="space-y-1.5 p-2.5 rounded-xl border bg-muted/10">
                      <label className="text-[11px] font-medium text-muted-foreground">{t('maxWeightLabel')}</label>
                      <Input
                        type="number"
                        value={routingLimits.maxWeight || ''}
                        onChange={(e) => setRoutingLimits({ ...routingLimits, maxWeight: Number(e.target.value) })}
                        className="h-8 text-xs font-semibold"
                        placeholder={t('noLimit')}
                      />
                    </div>
                    <div className="space-y-1.5 p-2.5 rounded-xl border bg-muted/10">
                      <label className="text-[11px] font-medium text-muted-foreground">{t('maxVolumeLabel')}</label>
                      <Input
                        type="number"
                        value={routingLimits.maxVolume || ''}
                        onChange={(e) => setRoutingLimits({ ...routingLimits, maxVolume: Number(e.target.value) })}
                        className="h-8 text-xs font-semibold"
                        placeholder={t('noLimit')}
                      />
                    </div>
                    <div className="space-y-1.5 p-2.5 rounded-xl border bg-muted/10">
                      <label className="text-[11px] font-medium text-muted-foreground">{t('maxSatirLabel')}</label>
                      <Input
                        type="number"
                        value={routingLimits.maxSatir || ''}
                        onChange={(e) => setRoutingLimits({ ...routingLimits, maxSatir: Number(e.target.value) })}
                        className="h-8 text-xs font-semibold"
                        placeholder={t('noLimit')}
                      />
                    </div>
                    <div className="space-y-1.5 p-2.5 rounded-xl border bg-muted/10">
                      <label className="text-[11px] font-medium text-muted-foreground">{t('maxOrdersLabel')}</label>
                      <Input
                        type="number"
                        value={routingLimits.maxCustomers || ''}
                        onChange={(e) => setRoutingLimits({ ...routingLimits, maxCustomers: Number(e.target.value) })}
                        className="h-8 text-xs font-semibold"
                        placeholder={t('noLimit')}
                      />
                    </div>
                    <div className="space-y-1.5 p-2.5 rounded-xl border bg-muted/10">
                      <label className="text-[11px] font-medium text-muted-foreground">{t('maxRegionsLabel')}</label>
                      <Input
                        type="number"
                        value={routingLimits.maxRegions || ''}
                        onChange={(e) => setRoutingLimits({ ...routingLimits, maxRegions: Number(e.target.value) })}
                        className="h-8 text-xs font-semibold"
                        placeholder={t('noLimit')}
                      />
                    </div>
                  </div>
                </div>

                {/* Pricing & Optional Cost Model */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      {t('tariffsAndCosts')}
                    </h3>
                    <label className="text-xs font-bold text-primary flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={routingLimits.costModel?.enabled ?? false}
                        onChange={(e) => setRoutingLimits({
                          ...routingLimits,
                          costModel: {
                            fuelCostPerKm: routingLimits.costModel?.fuelCostPerKm ?? 0.45,
                            driverCostPerHour: routingLimits.costModel?.driverCostPerHour ?? 8.0,
                            vehicleFixedCost: routingLimits.costModel?.vehicleFixedCost ?? 35.0,
                            tollCostPerRoute: routingLimits.costModel?.tollCostPerRoute ?? 0.0,
                            enabled: e.target.checked
                          }
                        })}
                        className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                      />
                      <span>Экономическая модель затрат (Cost Model)</span>
                    </label>
                  </div>

                  {routingLimits.costModel?.enabled ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 p-3.5 rounded-xl border border-primary/20 bg-primary/5">
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Топливо (AZN / км)</label>
                        <Input
                          type="number"
                          step="0.05"
                          value={routingLimits.costModel?.fuelCostPerKm ?? 0.45}
                          onChange={(e) => setRoutingLimits({
                            ...routingLimits,
                            costModel: { ...routingLimits.costModel!, fuelCostPerKm: Number(e.target.value) }
                          })}
                          className="h-8 text-xs font-bold"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Водитель (AZN / час)</label>
                        <Input
                          type="number"
                          step="0.5"
                          value={routingLimits.costModel?.driverCostPerHour ?? 8.0}
                          onChange={(e) => setRoutingLimits({
                            ...routingLimits,
                            costModel: { ...routingLimits.costModel!, driverCostPerHour: Number(e.target.value) }
                          })}
                          className="h-8 text-xs font-bold"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Фикс авто (AZN / рейс)</label>
                        <Input
                          type="number"
                          step="1"
                          value={routingLimits.costModel?.vehicleFixedCost ?? 35.0}
                          onChange={(e) => setRoutingLimits({
                            ...routingLimits,
                            costModel: { ...routingLimits.costModel!, vehicleFixedCost: Number(e.target.value) }
                          })}
                          className="h-8 text-xs font-bold"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Платные дороги (AZN)</label>
                        <Input
                          type="number"
                          step="0.5"
                          value={routingLimits.costModel?.tollCostPerRoute ?? 0.0}
                          onChange={(e) => setRoutingLimits({
                            ...routingLimits,
                            costModel: { ...routingLimits.costModel!, tollCostPerRoute: Number(e.target.value) }
                          })}
                          className="h-8 text-xs font-bold"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                      <div className="space-y-1.5 p-2.5 rounded-xl border bg-muted/10">
                        <label className="text-[11px] font-medium text-muted-foreground">{t('costPerRoute')}</label>
                        <Input
                          type="number"
                          value={routingLimits.costPerRoute || ''}
                          onChange={(e) => setRoutingLimits({ ...routingLimits, costPerRoute: Number(e.target.value) })}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1.5 p-2.5 rounded-xl border bg-muted/10">
                        <label className="text-[11px] font-medium text-muted-foreground">{t('costPerKm')}</label>
                        <Input
                          type="number"
                          value={routingLimits.costPerKm || ''}
                          onChange={(e) => setRoutingLimits({ ...routingLimits, costPerKm: Number(e.target.value) })}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1.5 p-2.5 rounded-xl border bg-muted/10">
                        <label className="text-[11px] font-medium text-muted-foreground">{t('costPerStore')}</label>
                        <Input
                          type="number"
                          value={routingLimits.costPerStore || ''}
                          onChange={(e) => setRoutingLimits({ ...routingLimits, costPerStore: Number(e.target.value) })}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1.5 p-2.5 rounded-xl border bg-muted/10">
                        <label className="text-[11px] font-medium text-muted-foreground">{t('costPerKg')}</label>
                        <Input
                          type="number"
                          value={routingLimits.costPerKg || ''}
                          onChange={(e) => setRoutingLimits({ ...routingLimits, costPerKg: Number(e.target.value) })}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Algorithm Selection & Constraints */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 pt-2 border-t">
                  <div className="md:col-span-3 space-y-3">
                    <AlgorithmSelector
                      value={selectedAlgorithm}
                      onChange={setSelectedAlgorithm}
                      disabled={isRouting}
                    />

                    {(selectedAlgorithm === 'smart_logistics' || selectedAlgorithm === 'sisr' || selectedAlgorithm === 'hgs') && (
                      <div className="p-3 rounded-xl border border-primary/20 bg-primary/5 space-y-2.5 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                            <span>{selectedAlgorithm === 'sisr' ? '✂️ Режим SISR:' : selectedAlgorithm === 'hgs' ? '🧬 Режим HGS:' : '🧠 Режим Hybrid VRP:'}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsBenchmarkOpen(true)}
                            className="text-[10px] text-primary hover:underline font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <BarChart2 size={12} />
                            <span>Тест Benchmark</span>
                          </button>
                        </div>

                        {/* Fast / Balanced / Quality segmented selector */}
                        <div className="grid grid-cols-3 gap-1.5 p-1 bg-background/80 rounded-lg border">
                          {(selectedAlgorithm === 'smart_logistics' ? [
                            { id: 'fast' as const, label: '⚡ Быстрый', desc: '1–2 старта, 2-Opt' },
                            { id: 'balanced' as const, label: '⚖️ Баланс', desc: '6 стартов, Or-Opt, 2-Opt*' },
                            { id: 'quality' as const, label: '🎯 Качество', desc: '14 стартов, ILS, 3-Opt' },
                          ] : [
                            // the new routers search for the whole time budget of the mode
                            { id: 'fast' as const, label: '⚡ Быстрый', desc: '≈ 2–6 с' },
                            { id: 'balanced' as const, label: '⚖️ Баланс', desc: '≈ 4–15 с' },
                            { id: 'quality' as const, label: '🎯 Качество', desc: '≈ 10–40 с' },
                          ]).map((mode, mIdx) => (
                            <button
                              key={`opt-mode-${mode.id}-${mIdx}`}
                              type="button"
                              onClick={() => setRoutingLimits({ ...routingLimits, optimizationMode: mode.id })}
                              className={cn(
                                "py-1.5 px-2 rounded-md text-[11px] font-bold transition-all text-center flex flex-col items-center cursor-pointer",
                                (routingLimits.optimizationMode || 'balanced') === mode.id
                                  ? "bg-primary text-primary-foreground shadow-xs"
                                  : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                              )}
                              title={mode.desc}
                            >
                              <span>{mode.label}</span>
                              <span className="text-[9px] font-normal opacity-80">{mode.desc}</span>
                            </button>
                          ))}
                        </div>

                        {/* Service time at each stop */}
                        <div className="flex items-center justify-between pt-1 border-t border-primary/10 text-[11px]">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Clock size={12} /> Время обслуживания точки:
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              value={routingLimits.serviceTimeMinutes ?? 10}
                              onChange={(e) => setRoutingLimits({ ...routingLimits, serviceTimeMinutes: Math.max(1, Number(e.target.value)) })}
                              className="h-6 w-14 text-xs text-center font-bold p-0.5"
                            />
                            <span className="text-[10px] text-muted-foreground">мин</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedAlgorithm === 'ai_mode' && (
                      <div className="p-3.5 rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/5 via-purple-500/5 to-pink-500/5 space-y-3 animate-in fade-in duration-150">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-foreground flex items-center gap-1.5">
                            <Sparkles size={14} className="text-indigo-500 animate-pulse" />
                            <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent font-extrabold">
                              Режим ИИ (Gemini Neural Router)
                            </span>
                          </span>
                          <span className="text-[10px] font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-500/20">
                            Gemini 3.8 Flash
                          </span>
                        </div>

                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          Нейросетевая оптимизация маршрутов: ИИ анализирует топологию Баку, дорожные коридоры, плотность точек, временные окна и лимиты транспорта. Формирует естественные маршруты опытного логиста и объясняет стратегию каждого рейса.
                        </p>

                        {/* Custom Dispatcher Prompt */}
                        <div className="space-y-1.5 pt-1 border-t border-indigo-500/15">
                          <label className="text-[10px] font-bold text-foreground flex items-center justify-between">
                            <span>💬 Дополнительные пожелания для ИИ (промпт):</span>
                            <span className="text-[9px] text-indigo-600 font-medium">Опционально</span>
                          </label>
                          <textarea
                            value={routingLimits.aiStrategyPrompt || ''}
                            onChange={(e) => setRoutingLimits({ ...routingLimits, aiStrategyPrompt: e.target.value })}
                            placeholder="Например: Сначала обслужить центр (Сабаил и Ясамал), тяжелые заказы отдать на большой фургон, избегать рейсов через узкие улицы..."
                            rows={2}
                            className="w-full text-xs p-2 rounded-lg border border-indigo-500/25 bg-background focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 resize-none transition-colors"
                          />
                        </div>

                        {/* Service time at each stop */}
                        <div className="flex items-center justify-between pt-1 border-t border-indigo-500/15 text-[11px]">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Clock size={12} /> Время обслуживания точки:
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              value={routingLimits.serviceTimeMinutes ?? 10}
                              onChange={(e) => setRoutingLimits({ ...routingLimits, serviceTimeMinutes: Math.max(1, Number(e.target.value)) })}
                              className="h-6 w-14 text-xs text-center font-bold p-0.5"
                            />
                            <span className="text-[10px] text-muted-foreground">мин</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-2 flex flex-col justify-between gap-2.5">
                    <label className="text-xs font-medium flex items-center gap-2.5 cursor-pointer select-none border rounded-xl p-2 bg-accent/20 hover:bg-accent/40 transition-colors">
                      <input
                        type="checkbox"
                        checked={routingLimits.allowCombineTimeSlots || false}
                        onChange={(e) => setRoutingLimits({ ...routingLimits, allowCombineTimeSlots: e.target.checked })}
                        className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                      />
                      <div>
                        <span className="text-xs font-semibold block text-foreground">{t('combineTimeWindows')}</span>
                        <span className="text-[10px] text-muted-foreground">{t('combineTimeWindowsDesc')}</span>
                      </div>
                    </label>

                    <label className="text-xs font-medium flex items-center gap-2.5 cursor-pointer select-none border rounded-xl p-2 bg-accent/20 hover:bg-accent/40 transition-colors">
                      <input
                        type="checkbox"
                        checked={routingLimits.allowCombineDates || false}
                        onChange={(e) => setRoutingLimits({ ...routingLimits, allowCombineDates: e.target.checked })}
                        className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                      />
                      <div>
                        <span className="text-xs font-semibold block text-foreground">{t('combineShippingDates')}</span>
                        <span className="text-[10px] text-muted-foreground">{t('combineShippingDatesDesc')}</span>
                      </div>
                    </label>

                    {/* Quick Tools Buttons: What-If and Constraints */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      {onOpenWhatIf && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenWhatIf();
                          }}
                          className="py-1.5 px-2 rounded-xl border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors shadow-2xs"
                        >
                          <span>🔮 What-If</span>
                        </button>
                      )}
                      {onOpenConstraints && (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenConstraints();
                          }}
                          className="py-1.5 px-2 rounded-xl border border-muted-foreground/30 bg-muted/40 hover:bg-muted text-foreground text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors shadow-2xs"
                        >
                          <span>🛡️ Связки</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {t('truckTypesDesc')}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8 text-xs font-semibold cursor-pointer"
                    onClick={() => {
                      const id = `type-${Date.now()}`;
                      setRoutingLimits(prev => ({
                        ...prev,
                        truckTypes: [
                          ...prev.truckTypes,
                          { id, name: t('newTruckType'), maxWeight: 1500, maxVolume: 10, rank: prev.truckTypes.length + 1 }
                        ]
                      }));
                    }}
                  >
                    <Plus size={14} /> {t('btnAddTruck')}
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
                  {routingLimits.truckTypes.map((truck, tIdx) => (
                    <div key={`modal-truck-${truck.id || 't'}-${tIdx}`} className="p-3.5 border rounded-2xl bg-muted/20 space-y-3 relative group hover:border-primary/40 transition-all">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-2.5 right-2.5 h-6 w-6 rounded-full bg-destructive/10 hover:bg-destructive text-destructive hover:text-white transition-colors"
                        onClick={() => {
                          setRoutingLimits(prev => ({
                            ...prev,
                            truckTypes: prev.truckTypes.filter(t => t.id !== truck.id)
                          }));
                        }}
                        title={t('btnDelete')}
                      >
                        <X size={12} />
                      </Button>
                      <div className="pr-7">
                        <Input
                          value={truck.name}
                          onChange={(e) => {
                            const newTypes = routingLimits.truckTypes.map(t => t.id === truck.id ? { ...t, name: e.target.value } : t);
                            setRoutingLimits({ ...routingLimits, truckTypes: newTypes });
                          }}
                          className="h-7 text-xs font-bold bg-transparent border-none p-0 focus-visible:ring-1 focus-visible:ring-primary rounded px-1"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground font-medium">{t('truckRank')}:</span>
                        <Input
                          type="number"
                          value={truck.rank}
                          onChange={(e) => {
                            const newTypes = routingLimits.truckTypes.map(t => t.id === truck.id ? { ...t, rank: Number(e.target.value) } : t);
                            setRoutingLimits({ ...routingLimits, truckTypes: newTypes });
                          }}
                          className="h-6 w-12 text-xs p-1 text-center font-bold"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1 border-t">
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground font-medium">{t('maxWeightLabel')}</label>
                          <Input
                            type="number"
                            value={truck.maxWeight}
                            onChange={(e) => {
                              const newTypes = routingLimits.truckTypes.map(t => t.id === truck.id ? { ...t, maxWeight: Number(e.target.value) } : t);
                              setRoutingLimits({ ...routingLimits, truckTypes: newTypes });
                            }}
                            className="h-7 text-xs font-medium"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-muted-foreground font-medium">{t('maxVolumeLabel')}</label>
                          <Input
                            type="number"
                            value={truck.maxVolume}
                            onChange={(e) => {
                              const newTypes = routingLimits.truckTypes.map(t => t.id === truck.id ? { ...t, maxVolume: Number(e.target.value) } : t);
                              setRoutingLimits({ ...routingLimits, truckTypes: newTypes });
                            }}
                            className="h-7 text-xs font-medium"
                          />
                        </div>
                      </div>
                      <div className="space-y-1 pt-1 border-t">
                        <label htmlFor={`truck-count-${truck.id}`} className="text-[10px] text-muted-foreground font-medium">{t('truckCountLabel')}</label>
                        <Input
                          id={`truck-count-${truck.id}`}
                          type="number"
                          min={0}
                          placeholder={t('truckCountPlaceholder')}
                          value={truck.count ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value;
                            const count = raw === '' ? undefined : Math.max(0, Math.floor(Number(raw)));
                            const newTypes = routingLimits.truckTypes.map(t => t.id === truck.id ? { ...t, count: count || undefined } : t);
                            setRoutingLimits({ ...routingLimits, truckTypes: newTypes });
                          }}
                          className="h-7 text-xs font-medium"
                        />
                        <span className="text-[9.5px] text-muted-foreground leading-tight block">{t('truckCountHint')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer Action Bar */}
          <div className="p-4 border-t bg-muted/20 flex items-center justify-between gap-4">
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground font-medium">{t('activeFleet')}:</span>
              <div className="flex gap-1.5">
                {routingLimits.truckTypes.slice(0, 3).map((truck, tIdx) => (
                  <div key={`modal-truck-footer-${truck.id || 't'}-${tIdx}`} className="text-[10px] px-2 py-0.5 rounded-md border bg-card/60 font-medium">
                    {truck.name}: {truck.maxWeight}{t('unitKg')} / {truck.maxVolume}{t('unitM3')}
                  </div>
                ))}
                {routingLimits.truckTypes.length > 3 && (
                  <span className="text-[10px] text-muted-foreground self-center">+{routingLimits.truckTypes.length - 3}</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <Button variant="outline" size="sm" onClick={onClose} className="h-10 px-4 cursor-pointer">
                {t('btnClose')}
              </Button>
              <Button
                id="modal-run-routing-button"
                className="gap-2 h-10 px-6 font-semibold shadow-md flex-1 sm:flex-initial cursor-pointer"
                onClick={() => {
                  onRunRouting();
                  onClose();
                }}
                disabled={isRouting}
              >
                <Play size={16} fill="currentColor" />
                {isRouting ? t('calculatingRoutes') : t('btnRunRouting')}
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
      </AnimatePresence>

      <BenchmarkModal
        isOpen={isBenchmarkOpen}
        onClose={() => setIsBenchmarkOpen(false)}
        engine={selectedAlgorithm === 'sisr' || selectedAlgorithm === 'hgs' ? selectedAlgorithm : undefined}
      />
    </>
  );
};
