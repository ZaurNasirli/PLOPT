import React, { useState } from 'react';
import { HelpCircle, Zap, Target, Scale, CheckCircle2, ChevronRight, X, ArrowUpDown, Info } from 'lucide-react';
import { ALGORITHMS_DATA, AlgorithmDetail, getAlgorithmById } from '../data/algorithmsData';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from '../i18n/I18nContext';

/** The routers used in almost every case: they handle store-to-store transfers with the exact load along the route */
const MAIN_ROUTERS = [
  { id: 'sisr', name: 'SISR', icon: '✂️', hintKey: 'algoMainSisr' },
  { id: 'hgs', name: 'HGS', icon: '🧬', hintKey: 'algoMainHgs' },
  { id: 'smart_logistics', name: 'SMART', icon: '🧠', hintKey: 'algoMainSmart' },
];

interface AlgorithmSelectorProps {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}

export const AlgorithmSelector: React.FC<AlgorithmSelectorProps> = ({
  value,
  onChange,
  disabled = false
}) => {
  const { t } = useTranslation();
  const [showComparisonModal, setShowComparisonModal] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>('all');

  const currentAlgo = getAlgorithmById(value);

  const categories = [
    { id: 'all', label: t('algoAllAlgorithms') },
    { id: 'Базовые', label: t('algoCatBasic') },
    { id: 'Эвристики', label: t('algoCatHeuristic') },
    { id: 'Локальный поиск', label: t('algoCatLocalSearch') },
    { id: 'Метаэвристики', label: t('algoCatMetaheuristic') }
  ];

  const mainIds = MAIN_ROUTERS.map(r => r.id);
  const filteredAlgorithms = (filterCategory === 'all'
    ? ALGORITHMS_DATA
    : ALGORITHMS_DATA.filter(a => a.category === filterCategory))
    .slice()
    .sort((a, b) => (mainIds.includes(a.id) ? mainIds.indexOf(a.id) : 99) - (mainIds.includes(b.id) ? mainIds.indexOf(b.id) : 99));

  return (
    <div className="space-y-1 relative" id="algorithm-selector-container">
      {/* Label and Info Trigger */}
      <div className="flex items-center justify-between">
        <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider flex items-center gap-1">
          <span>{t('algoRoutingAlgorithm')}</span>
          {currentAlgo && (
            <span className="text-[9px] font-normal px-1.5 py-0.2 rounded bg-primary/10 text-primary border border-primary/20">
              {currentAlgo.badge}
            </span>
          )}
        </label>
        <button
          type="button"
          id="algorithm-compare-button"
          onClick={() => setShowComparisonModal(true)}
          className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-1 font-medium hover:underline transition-colors cursor-pointer"
          title={t('algoCompareSubtitle')}
        >
          <HelpCircle size={12} className="shrink-0" />
          <span>{t('algoCompareButton')}</span>
        </button>
      </div>

      {/* The three main routers: exact transfers and load along the route; used in almost every case */}
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-1.5 space-y-1" id="algorithm-main-routers">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-bold text-primary uppercase tracking-wider">⭐ {t('algoMainTitle')}</span>
          <span className="text-[9px] text-muted-foreground">{t('algoMainHint')}</span>
        </div>
        <div className="grid grid-cols-3 gap-1">
          {MAIN_ROUTERS.map(r => (
            <button
              key={`main-${r.id}`}
              type="button"
              id={`algorithm-main-${r.id}`}
              disabled={disabled}
              onClick={() => onChange(r.id)}
              aria-pressed={value === r.id}
              className={`h-12 rounded-lg border text-left px-2 transition-colors cursor-pointer disabled:opacity-50 ${
                value === r.id
                  ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                  : 'bg-background border-border hover:border-primary/50'
              }`}
            >
              <div className="text-xs font-bold leading-tight">{r.icon} {r.name}</div>
              <div className={`text-[9px] leading-tight mt-0.5 ${value === r.id ? 'text-primary-foreground/85' : 'text-muted-foreground'}`}>{t(r.hintKey)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Select Dropdown & Quick Tooltip Toggle */}
      <div className="relative flex items-center gap-1.5">
        <select
          id="algorithm-select-dropdown"
          className="h-8 w-full bg-background border rounded-lg px-2 text-xs font-medium focus:ring-1 focus:ring-primary focus:border-primary transition-colors cursor-pointer"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        >
          <option value="">{t('algoSelectPlaceholder')}</option>
          <optgroup label={`⭐ ${t('algoMainTitle')}`}>
            <option value="sisr">✂️ SISR — разрезание цепочек</option>
            <option value="hgs">🧬 HGS — гибридный генетический поиск</option>
            <option value="smart_logistics">🧠 SMART — Smart Logistics Optimizer</option>
          </optgroup>
          <optgroup label={`🤖 ${t('algoAiGroup')}`}>
            <option value="ai_mode">🤖 Режим ИИ (Gemini Neural Router)</option>
          </optgroup>
          <optgroup label={`⚡ ${t('algoCatBasic')}`}>
            <option value="savings">Clarke-Wright (Savings)</option>
            <option value="ss">Sequential Savings</option>
            <option value="sweep">Sweep Algorithm</option>
            <option value="cluster">Cluster-First, Route-Second</option>
            <option value="nn">Nearest Neighbor</option>
            <option value="ni">Nearest Insertion</option>
            <option value="fi">Farthest Insertion</option>
          </optgroup>
          <optgroup label={`🎯 ${t('algoCatHeuristic')}`}>
            <option value="sa">Simulated Annealing (SA)</option>
            <option value="grasp">GRASP</option>
            <option value="tabu_search">Tabu Search</option>
            <option value="genetic_algo">Genetic Algorithm (GA)</option>
          </optgroup>
          <optgroup label={`🔍 ${t('algoCatLocalSearch')}`}>
            <option value="ls">Hill Climbing (2-Opt)</option>
            <option value="vns">Variable Neighborhood Search (VNS)</option>
            <option value="ils">Iterated Local Search (ILS)</option>
            <option value="lns">Large Neighborhood Search (LNS)</option>
          </optgroup>
          <optgroup label={`🐜 ${t('algoCatMetaheuristic')}`}>
            <option value="aco">Ant Colony Optimization (ACO)</option>
            <option value="pso">Particle Swarm Optimization (PSO)</option>
            <option value="bco">Bee Colony Optimization (BCO)</option>
          </optgroup>
        </select>

        {currentAlgo && (
          <button
            type="button"
            id="algorithm-active-info-button"
            onClick={() => setShowTooltip(prev => !prev)}
            className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-lg border text-xs transition-colors cursor-pointer ${
              showTooltip 
                ? 'bg-primary text-primary-foreground border-primary' 
                : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground'
            }`}
            title={t('algoTradeoffLabel')}
          >
            <Info size={14} />
          </button>
        )}
      </div>

      {/* Dynamic Trade-off Card for Selected Algorithm */}
      {currentAlgo && (
        <div 
          id={`algorithm-card-${currentAlgo.id}`}
          className="mt-1 p-2 rounded-lg border bg-muted/20 border-border/80 text-[11px] space-y-1.5 transition-all"
        >
          <div className="flex items-center justify-between text-[10px]">
            <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold">
              <Zap size={11} className="shrink-0" />
              <span>{t('algoSpeedLabel')}: {currentAlgo.speedText}</span>
              <span className="text-[9px] opacity-75">({'⭐'.repeat(Math.round(currentAlgo.speedRating))})</span>
            </div>
            <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
              <Target size={11} className="shrink-0" />
              <span>{t('algoAccuracyLabel')}: {currentAlgo.accuracyText}</span>
              <span className="text-[9px] opacity-75">({'⭐'.repeat(Math.round(currentAlgo.accuracyRating))})</span>
            </div>
          </div>

          <div className="text-[10px] text-foreground/90 leading-tight">
            <span className="font-bold text-muted-foreground">⚖️ {t('algoTradeoffLabel')} </span>
            <span>{currentAlgo.tradeoff}</span>
          </div>

          <div className="text-[10px] text-primary dark:text-primary-foreground/90 font-medium leading-tight">
            <span className="font-bold">💡 {t('algoBestForLabel')} </span>
            <span>{currentAlgo.bestFor}</span>
          </div>
        </div>
      )}

      {/* Floating Detailed Tooltip Popover if opened */}
      <AnimatePresence>
        {showTooltip && currentAlgo && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            className="absolute top-full left-0 right-0 z-50 mt-1 p-3 rounded-xl border bg-card text-card-foreground shadow-xl space-y-2.5 text-xs"
          >
            <div className="flex items-center justify-between border-b pb-1.5">
              <span className="font-bold text-xs flex items-center gap-1.5">
                <span>{currentAlgo.name}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted font-normal text-muted-foreground">{currentAlgo.category}</span>
              </span>
              <button 
                onClick={() => setShowTooltip(false)}
                className="text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {currentAlgo.description}
            </p>

            <div className="grid grid-cols-2 gap-2 bg-muted/40 p-2 rounded-lg text-[10px]">
              <div>
                <span className="text-muted-foreground block">{t('algoSpeedLabel')}:</span>
                <span className="font-bold text-amber-600 dark:text-amber-400">{currentAlgo.speedText}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">{t('algoAccuracyLabel')}:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">{currentAlgo.accuracyText}</span>
              </div>
            </div>

            <div className="text-[11px] leading-snug">
              <strong className="text-primary block mb-0.5">{t('algoTradeoffLabel')}</strong>
              <p className="text-muted-foreground">{currentAlgo.tradeoff}</p>
            </div>

            <button
              type="button"
              className="w-full text-[10px] h-6 mt-1 gap-1 flex items-center justify-center border rounded-lg bg-background hover:bg-muted font-medium transition-colors cursor-pointer"
              onClick={() => {
                setShowTooltip(false);
                setShowComparisonModal(true);
              }}
            >
              <Scale size={12} /> {t('algoOpenComparisonTable')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Full Comparison Modal */}
      <AnimatePresence>
        {showComparisonModal && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border text-card-foreground shadow-2xl rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden"
            >
              {/* Modal Header */}
              <div className="p-5 border-b flex justify-between items-center bg-muted/30">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 text-primary rounded-xl">
                    <Scale size={22} />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold">{t('algoCompareTitle')}</h2>
                    <p className="text-xs text-muted-foreground">
                      {t('algoCompareSubtitle')}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowComparisonModal(false)}
                  className="rounded-full h-8 w-8 flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Category Filter Pills */}
              <div className="px-5 py-2.5 border-b bg-muted/10 flex items-center gap-2 overflow-x-auto">
                <span className="text-xs font-semibold text-muted-foreground shrink-0">{t('algoCategoryLabel')}</span>
                {categories.map((cat, catIdx) => (
                  <button
                    key={`cat-${cat.id}-${catIdx}`}
                    onClick={() => setFilterCategory(cat.id)}
                    className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                      filterCategory === cat.id
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Table / Grid */}
              <div className="flex-1 overflow-y-auto p-5 scrollbar-thin space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredAlgorithms.map((algo, algoIdx) => {
                    const isSelected = value === algo.id;
                    return (
                      <div
                        key={`algo-${algo.id}-${algoIdx}`}
                        onClick={() => {
                          onChange(algo.id);
                          setShowComparisonModal(false);
                        }}
                        className={`p-3.5 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between gap-2.5 ${
                          isSelected
                            ? 'border-primary bg-primary/5 ring-1 ring-primary/20 shadow-sm'
                            : mainIds.includes(algo.id)
                              ? 'border-primary/40 bg-primary/[0.03] hover:border-primary/70'
                              : 'border-border hover:border-primary/40 bg-card hover:bg-muted/20'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-xs text-foreground">{algo.name}</span>
                              {mainIds.includes(algo.id) && (
                                <span className="text-[9px] px-1.5 py-0.2 rounded bg-primary text-primary-foreground font-bold">⭐ {t('algoMainBadge')}</span>
                              )}
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-semibold">
                                {algo.category}
                              </span>
                            </div>
                            <span className="text-[10px] text-muted-foreground font-mono">{algo.shortName}</span>
                          </div>
                          {isSelected ? (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                              <CheckCircle2 size={12} /> {t('algoSelectedBadge')}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground hover:text-primary">
                              {t('algoSelectArrow')}
                            </span>
                          )}
                        </div>

                        {/* Trade-off Bar */}
                        <div className="grid grid-cols-2 gap-2 bg-muted/40 p-2 rounded-lg text-[10px]">
                          <div className="space-y-0.5">
                            <span className="text-muted-foreground flex items-center gap-1 font-medium">
                              <Zap size={11} className="text-amber-500" /> {t('algoSpeedLabel')}:
                            </span>
                            <span className="font-bold text-amber-600 dark:text-amber-400 block truncate">
                              {algo.speedText}
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            <span className="text-muted-foreground flex items-center gap-1 font-medium">
                              <Target size={11} className="text-emerald-500" /> {t('algoAccuracyLabel')}:
                            </span>
                            <span className="font-bold text-emerald-600 dark:text-emerald-400 block truncate">
                              {algo.accuracyText}
                            </span>
                          </div>
                        </div>

                        {/* Tradeoff description */}
                        <div className="text-[10px] text-muted-foreground leading-snug">
                          <strong className="text-foreground">{t('algoTradeoffLabel')} </strong>
                          {algo.tradeoff}
                        </div>

                        {/* Best For */}
                        <div className="text-[10px] bg-primary/5 p-1.5 rounded text-primary font-medium flex items-center gap-1">
                          <span className="font-bold shrink-0">💡 {t('algoBestForLabel')}</span>
                          <span className="truncate">{algo.bestFor}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 border-t bg-muted/20 flex justify-between items-center text-xs text-muted-foreground">
                <span>{t('algoSelectPrompt')}</span>
                <button 
                  type="button" 
                  onClick={() => setShowComparisonModal(false)}
                  className="px-3 py-1.5 border rounded-lg hover:bg-muted font-medium transition-colors cursor-pointer"
                >
                  {t('btnClose')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
