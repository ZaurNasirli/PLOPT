import React, { useState, useMemo } from 'react';
import { 
  Trash2, 
  MapPin, 
  Truck, 
  Calendar, 
  Clock, 
  CheckSquare, 
  Square, 
  X, 
  ChevronDown, 
  Check, 
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Layers
} from 'lucide-react';
import { Order, Route, Store } from '../types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from '../i18n/I18nContext';
import { toLocalDateStr } from '../lib/utils';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const roundUp = (num: number, decimals: number = 1): number => {
  const factor = Math.pow(10, decimals);
  return Math.ceil(num * factor) / factor;
};

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
  children: React.ReactNode, 
  variant?: 'primary' | 'outline' | 'ghost' | 'destructive' | 'default', 
  size?: 'sm' | 'md' | 'lg' | 'icon',
  className?: string,
  onClick?: (e: any) => void,
  id?: string,
  disabled?: boolean,
  title?: string
}) => {
  const variants = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    default: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
    ghost: "hover:bg-accent hover:text-accent-foreground",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90"
  };
  const sizes = {
    sm: "h-8 px-3 text-xs",
    md: "h-10 px-4 py-2 text-sm",
    lg: "h-12 px-8 text-base",
    icon: "h-8 w-8 p-0"
  };
  return (
    <button 
      id={id}
      type="button"
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
        variants[variant],
        sizes[size],
        className
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
};

interface BulkActionsMenuProps {
  orders: Order[];
  stores: Store[];
  filteredStores: Store[];
  selectedOrderIds: string[];
  routes: Route[];
  onSelectAll: (orderIds: string[]) => void;
  onClearSelection: () => void;
  onDeleteSelected: (orderIds: string[]) => void;
  onAssignRegion: (orderIds: string[], region: string) => void;
  onAssignRoute: (orderIds: string[], routeId: string) => void;
  onRemoveFromRoute: (orderIds: string[]) => void;
  onChangeShippingDate: (orderIds: string[], date: string) => void;
  onChangeTimeSlot: (orderIds: string[], timeSlot: string) => void;
  onCreateRouteFromSelected: (orderIds: string[]) => void;
}

export const BulkActionsMenu: React.FC<BulkActionsMenuProps> = ({
  orders,
  stores,
  filteredStores,
  selectedOrderIds,
  routes,
  onSelectAll,
  onClearSelection,
  onDeleteSelected,
  onAssignRegion,
  onAssignRoute,
  onRemoveFromRoute,
  onChangeShippingDate,
  onChangeTimeSlot,
  onCreateRouteFromSelected
}) => {
  const { t } = useTranslation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<'delete' | 'region' | 'route' | 'date' | 'time' | null>(null);
  
  // Modal states
  const [targetRegion, setTargetRegion] = useState('');
  const [customRegion, setCustomRegion] = useState('');
  const [targetRouteId, setTargetRouteId] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [targetTimeSlot, setTargetTimeSlot] = useState('09:00 - 18:00');

  // Filtered order IDs
  const allFilteredOrderIds = useMemo(() => {
    const ids: string[] = [];
    (filteredStores || []).forEach(s => {
      (s.orders || []).forEach(o => ids.push(o.id));
    });
    return ids;
  }, [filteredStores]);

  const isAllSelected = allFilteredOrderIds.length > 0 && allFilteredOrderIds.every(id => selectedOrderIds.includes(id));
  const isSomeSelected = selectedOrderIds.length > 0;

  // Existing regions
  const existingRegions = useMemo(() => {
    const set = new Set<string>();
    (orders || []).forEach(o => {
      if (o.region && o.region.trim()) set.add(o.region.trim());
    });
    return Array.from(set).sort();
  }, [orders]);

  // Selected orders & statistics
  const selectedOrders = useMemo(() => {
    return orders.filter(o => selectedOrderIds.includes(o.id));
  }, [orders, selectedOrderIds]);

  const selectedStats = useMemo(() => {
    const weight = selectedOrders.reduce((sum, o) => sum + o.weight, 0);
    const volume = selectedOrders.reduce((sum, o) => sum + o.volume, 0);
    const storeCount = new Set(selectedOrders.map(o => o.customerName)).size;
    return { count: selectedOrders.length, storeCount, weight, volume };
  }, [selectedOrders]);

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      onClearSelection();
    } else {
      onSelectAll(allFilteredOrderIds);
    }
  };

  const handleConfirmDelete = () => {
    onDeleteSelected(selectedOrderIds);
    setActiveModal(null);
  };

  const handleConfirmAssignRegion = () => {
    const finalRegion = (customRegion.trim() || targetRegion.trim());
    if (finalRegion) {
      onAssignRegion(selectedOrderIds, finalRegion);
      setCustomRegion('');
      setTargetRegion('');
      setActiveModal(null);
    }
  };

  const handleConfirmAssignRoute = () => {
    if (targetRouteId === 'new') {
      onCreateRouteFromSelected(selectedOrderIds);
    } else if (targetRouteId) {
      onAssignRoute(selectedOrderIds, targetRouteId);
    }
    setActiveModal(null);
  };

  const handleConfirmDate = () => {
    onChangeShippingDate(selectedOrderIds, targetDate);
    setActiveModal(null);
  };

  const handleConfirmTime = () => {
    onChangeTimeSlot(selectedOrderIds, targetTimeSlot);
    setActiveModal(null);
  };

  return (
    <div className="space-y-1.5" id="bulk-actions-container">
      {/* Selection Summary Bar & Action Trigger */}
      <div className="flex items-center justify-between gap-1.5 p-1.5 rounded-lg border bg-card text-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            id="bulk-select-all-btn"
            onClick={handleToggleSelectAll}
            className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title={isAllSelected ? t('bulkClearSelection') : t('bulkSelectAll')}
          >
            {isAllSelected ? (
              <CheckSquare size={16} className="text-primary shrink-0" />
            ) : isSomeSelected ? (
              <div className="w-4 h-4 rounded border-2 border-primary bg-primary/20 flex items-center justify-center">
                <div className="w-2 h-0.5 bg-primary rounded-full" />
              </div>
            ) : (
              <Square size={16} className="text-muted-foreground shrink-0" />
            )}
            <span>
              {isSomeSelected 
                ? `${t('bulkSelected', { count: selectedStats.count })}` 
                : `${t('filterAll')} (${allFilteredOrderIds.length})`
              }
            </span>
          </button>

          {isSomeSelected && (
            <span className="text-[10px] text-muted-foreground font-medium hidden sm:inline">
              ({selectedStats.storeCount} {t('bulkStoresShort')} / {Math.round(selectedStats.weight)} {t('unitKg')})
            </span>
          )}
        </div>

        {/* Action Menu Dropdown Button */}
        <div className="relative">
          <Button
            id="bulk-actions-menu-btn"
            size="sm"
            variant={isSomeSelected ? "default" : "outline"}
            className="h-7 text-xs px-2.5 gap-1.5 font-semibold transition-all shadow-sm"
            onClick={() => setIsMenuOpen(prev => !prev)}
            disabled={!isSomeSelected}
          >
            <Layers size={13} />
            <span>{t('bulkActionsTitle')}</span>
            <ChevronDown size={12} className={`transition-transform duration-200 ${isMenuOpen ? 'rotate-180' : ''}`} />
          </Button>

          {/* Dropdown Menu */}
          <AnimatePresence>
            {isMenuOpen && isSomeSelected && (
              <motion.div
                initial={{ opacity: 0, y: 5, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 5, scale: 0.95 }}
                className="absolute right-0 top-full mt-1.5 w-60 bg-card border rounded-xl shadow-xl z-[150] p-1.5 space-y-1 text-xs"
                onMouseLeave={() => setIsMenuOpen(false)}
              >
                <div className="px-2 py-1 border-b text-[10px] text-muted-foreground font-semibold uppercase tracking-wider flex justify-between items-center">
                  <span>{t('bulkActionsForCount', { count: selectedStats.count })}</span>
                  <button onClick={onClearSelection} className="hover:text-destructive text-[10px] cursor-pointer">{t('bulkClearBtn')}</button>
                </div>

                {/* Assign Region */}
                <button
                  id="bulk-assign-region-btn"
                  onClick={() => {
                    setActiveModal('region');
                    setIsMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent text-foreground text-left transition-colors cursor-pointer"
                >
                  <MapPin size={15} className="text-blue-500 shrink-0" />
                  <div>
                    <div className="font-semibold text-xs">{t('bulkAssignRegionTitle')}</div>
                    <div className="text-[10px] text-muted-foreground">{t('bulkAssignRegionDesc')}</div>
                  </div>
                </button>

                {/* Assign / Create Route */}
                <button
                  id="bulk-assign-route-btn"
                  onClick={() => {
                    setActiveModal('route');
                    setIsMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent text-foreground text-left transition-colors cursor-pointer"
                >
                  <Truck size={15} className="text-emerald-500 shrink-0" />
                  <div>
                    <div className="font-semibold text-xs">{t('bulkAssignRouteTitle')}</div>
                    <div className="text-[10px] text-muted-foreground">{t('bulkAssignRouteDesc')}</div>
                  </div>
                </button>

                {/* Change Shipping Date */}
                <button
                  id="bulk-change-date-btn"
                  onClick={() => {
                    setActiveModal('date');
                    setIsMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent text-foreground text-left transition-colors cursor-pointer"
                >
                  <Calendar size={15} className="text-purple-500 shrink-0" />
                  <div>
                    <div className="font-semibold text-xs">{t('bulkChangeDateTitle')}</div>
                    <div className="text-[10px] text-muted-foreground">{t('bulkChangeDateDesc')}</div>
                  </div>
                </button>

                {/* Change Time Slot */}
                <button
                  id="bulk-change-time-btn"
                  onClick={() => {
                    setActiveModal('time');
                    setIsMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent text-foreground text-left transition-colors cursor-pointer"
                >
                  <Clock size={15} className="text-amber-500 shrink-0" />
                  <div>
                    <div className="font-semibold text-xs">{t('bulkChangeTimeTitle')}</div>
                    <div className="text-[10px] text-muted-foreground">{t('bulkChangeTimeDesc')}</div>
                  </div>
                </button>

                {/* Remove from Route */}
                <button
                  id="bulk-remove-route-btn"
                  onClick={() => {
                    onRemoveFromRoute(selectedOrderIds);
                    setIsMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent text-foreground text-left transition-colors cursor-pointer"
                >
                  <RotateCcw size={15} className="text-orange-500 shrink-0" />
                  <div>
                    <div className="font-semibold text-xs">{t('bulkRemoveRouteTitle')}</div>
                    <div className="text-[10px] text-muted-foreground">{t('bulkRemoveRouteDesc')}</div>
                  </div>
                </button>

                {/* Delete Selected */}
                <div className="pt-1 border-t">
                  <button
                    id="bulk-delete-btn"
                    onClick={() => {
                      setActiveModal('delete');
                      setIsMenuOpen(false);
                    }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-destructive/10 text-destructive text-left transition-colors cursor-pointer"
                  >
                    <Trash2 size={15} className="shrink-0" />
                    <div>
                      <div className="font-semibold text-xs">{t('bulkDeleteSelectedTitle', { count: selectedStats.count })}</div>
                      <div className="text-[10px] opacity-80">{t('bulkDeleteSelectedDesc')}</div>
                    </div>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* --- MODAL: ASSIGN REGION --- */}
      <AnimatePresence>
        {activeModal === 'region' && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border text-card-foreground shadow-2xl rounded-2xl w-full max-w-md overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b flex justify-between items-center bg-muted/30">
                <div className="flex items-center gap-2">
                  <MapPin className="text-blue-500" size={18} />
                  <h3 className="font-bold text-sm">{t('bulkAssignRegionTitle')} ({selectedStats.count})</h3>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setActiveModal(null)} className="h-7 w-7 rounded-full cursor-pointer" title={t('btnClose')}>
                  <X size={16} />
                </Button>
              </div>

              <div className="p-4 space-y-3 text-xs">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground">{t('bulkSelectExistingRegion')}</label>
                  <select
                    className="w-full h-8 text-xs bg-background border rounded-lg px-2 focus:ring-1 focus:ring-primary cursor-pointer"
                    value={targetRegion}
                    onChange={(e) => {
                      setTargetRegion(e.target.value);
                      if (e.target.value) setCustomRegion('');
                    }}
                  >
                    <option value="">{t('bulkSelectRegionPlaceholder')}</option>
                    {existingRegions.map((r, rIdx) => (
                      <option key={`bulk-reg-${r}-${rIdx}`} value={r}>{r}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 my-1">
                  <div className="h-px bg-border flex-1" />
                  <span className="text-[10px] text-muted-foreground uppercase font-semibold">{t('bulkOrEnterNew')}</span>
                  <div className="h-px bg-border flex-1" />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground">{t('bulkNewRegionLabel')}</label>
                  <input
                    type="text"
                    placeholder={t('bulkNewRegionPlaceholder')}
                    className="w-full h-8 text-xs bg-background border rounded-lg px-2.5 focus:ring-1 focus:ring-primary"
                    value={customRegion}
                    onChange={(e) => {
                      setCustomRegion(e.target.value);
                      if (e.target.value) setTargetRegion('');
                    }}
                  />
                </div>

                <div className="bg-muted/30 p-2.5 rounded-lg text-[11px] text-muted-foreground">
                  {t('bulkRegionUpdateNote', { count: selectedStats.count, storeCount: selectedStats.storeCount })}
                </div>
              </div>

              <div className="p-3 border-t bg-muted/20 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setActiveModal(null)} className="cursor-pointer">{t('btnCancel')}</Button>
                <Button 
                  size="sm" 
                  disabled={!targetRegion && !customRegion.trim()}
                  onClick={handleConfirmAssignRegion}
                  className="gap-1.5 cursor-pointer font-semibold"
                >
                  <Check size={14} /> {t('bulkBtnAssignRegion')}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- MODAL: CONFIRM DELETE --- */}
      <AnimatePresence>
        {activeModal === 'delete' && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border text-card-foreground shadow-2xl rounded-2xl w-full max-w-md overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b flex justify-between items-center bg-destructive/10">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertTriangle size={18} />
                  <h3 className="font-bold text-sm">{t('bulkDeleteConfirmTitle', { count: selectedStats.count })}</h3>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setActiveModal(null)} className="h-7 w-7 rounded-full cursor-pointer" title={t('btnClose')}>
                  <X size={16} />
                </Button>
              </div>

              <div className="p-4 space-y-3 text-xs">
                <p className="text-foreground leading-relaxed">
                  {t('bulkDeleteConfirmPrompt', { count: selectedStats.count })}
                </p>
                <div className="bg-destructive/5 border border-destructive/20 p-2.5 rounded-lg text-[11px] text-destructive space-y-1">
                  <div className="font-semibold">{t('bulkAttention')}</div>
                  <div>{t('bulkDeleteWarning1')}</div>
                  <div>{t('bulkDeleteWarning2', { weight: roundUp(selectedStats.weight), volume: roundUp(selectedStats.volume) })}</div>
                </div>
              </div>

              <div className="p-3 border-t bg-muted/20 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setActiveModal(null)} className="cursor-pointer">{t('btnCancel')}</Button>
                <Button variant="destructive" size="sm" onClick={handleConfirmDelete} className="gap-1.5 cursor-pointer font-semibold">
                  <Trash2 size={14} /> {t('bulkBtnConfirmDelete', { count: selectedStats.count })}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- MODAL: ASSIGN ROUTE --- */}
      <AnimatePresence>
        {activeModal === 'route' && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border text-card-foreground shadow-2xl rounded-2xl w-full max-w-md overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b flex justify-between items-center bg-muted/30">
                <div className="flex items-center gap-2">
                  <Truck className="text-emerald-500" size={18} />
                  <h3 className="font-bold text-sm">{t('bulkAssignRouteModalTitle')}</h3>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setActiveModal(null)} className="h-7 w-7 rounded-full cursor-pointer" title={t('btnClose')}>
                  <X size={16} />
                </Button>
              </div>

              <div className="p-4 space-y-3 text-xs">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground">{t('bulkSelectActionLabel')}</label>
                  <select
                    className="w-full h-8 text-xs bg-background border rounded-lg px-2 focus:ring-1 focus:ring-primary cursor-pointer"
                    value={targetRouteId}
                    onChange={(e) => setTargetRouteId(e.target.value)}
                  >
                    <option value="">{t('bulkSelectRoutePlaceholder')}</option>
                    <option value="new">{t('bulkCreateNewRouteOption')}</option>
                    {routes.map((r, rIdx) => (
                      <option key={`bulk-route-${r.id}-${rIdx}`} value={r.id}>
                        {r.name} {t('bulkRouteStopsDistance', { count: r.orderIds.length, dist: r.distance })}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="bg-muted/30 p-2.5 rounded-lg text-[11px] text-muted-foreground">
                  {t('bulkOrdersForRouteNote', { count: selectedStats.count })}
                </div>
              </div>

              <div className="p-3 border-t bg-muted/20 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setActiveModal(null)} className="cursor-pointer">{t('btnCancel')}</Button>
                <Button 
                  size="sm" 
                  disabled={!targetRouteId}
                  onClick={handleConfirmAssignRoute}
                  className="gap-1.5 cursor-pointer font-semibold"
                >
                  <Check size={14} /> {t('btnApply')}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- MODAL: CHANGE DATE --- */}
      <AnimatePresence>
        {activeModal === 'date' && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border text-card-foreground shadow-2xl rounded-2xl w-full max-w-md overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b flex justify-between items-center bg-muted/30">
                <div className="flex items-center gap-2">
                  <Calendar className="text-purple-500" size={18} />
                  <h3 className="font-bold text-sm">{t('bulkSetShippingDateTitle')}</h3>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setActiveModal(null)} className="h-7 w-7 rounded-full cursor-pointer" title={t('btnClose')}>
                  <X size={16} />
                </Button>
              </div>

              <div className="p-4 space-y-3 text-xs">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground">{t('bulkShippingDateLabel')}</label>
                  <input
                    type="date"
                    className="w-full h-8 text-xs bg-background border rounded-lg px-2.5 focus:ring-1 focus:ring-primary cursor-pointer"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                  />
                </div>

                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1 text-[10px] h-7 cursor-pointer"
                    onClick={() => {
                      const today = toLocalDateStr();
                      setTargetDate(today);
                    }}
                  >
                    {t('dateToday')}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1 text-[10px] h-7 cursor-pointer"
                    onClick={() => {
                      const tomorrow = toLocalDateStr(new Date(Date.now() + 86400000));
                      setTargetDate(tomorrow);
                    }}
                  >
                    {t('dateTomorrow')}
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="flex-1 text-[10px] h-7 text-muted-foreground cursor-pointer"
                    onClick={() => setTargetDate('')}
                  >
                    {t('bulkClearDate')}
                  </Button>
                </div>
              </div>

              <div className="p-3 border-t bg-muted/20 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setActiveModal(null)} className="cursor-pointer">{t('btnCancel')}</Button>
                <Button size="sm" onClick={handleConfirmDate} className="gap-1.5 cursor-pointer font-semibold">
                  <Check size={14} /> {t('bulkSaveDate')}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- MODAL: CHANGE TIME SLOT --- */}
      <AnimatePresence>
        {activeModal === 'time' && (
          <div className="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border text-card-foreground shadow-2xl rounded-2xl w-full max-w-md overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b flex justify-between items-center bg-muted/30">
                <div className="flex items-center gap-2">
                  <Clock className="text-amber-500" size={18} />
                  <h3 className="font-bold text-sm">{t('bulkSetTimeSlotTitle')}</h3>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setActiveModal(null)} className="h-7 w-7 rounded-full cursor-pointer" title={t('btnClose')}>
                  <X size={16} />
                </Button>
              </div>

              <div className="p-4 space-y-3 text-xs">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-muted-foreground">{t('bulkTimeSlotLabel')}</label>
                  <select
                    className="w-full h-8 text-xs bg-background border rounded-lg px-2 focus:ring-1 focus:ring-primary cursor-pointer"
                    value={targetTimeSlot}
                    onChange={(e) => setTargetTimeSlot(e.target.value)}
                  >
                    <option value="08:00 - 12:00">08:00 - 12:00 ({t('shiftMorning')})</option>
                    <option value="09:00 - 13:00">09:00 - 13:00</option>
                    <option value="12:00 - 16:00">12:00 - 16:00</option>
                    <option value="13:00 - 18:00">13:00 - 18:00 ({t('shiftEvening')})</option>
                    <option value="09:00 - 18:00">09:00 - 18:00 ({t('shiftFullDay')})</option>
                    <option value="18:00 - 22:00">18:00 - 22:00</option>
                  </select>
                </div>
              </div>

              <div className="p-3 border-t bg-muted/20 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setActiveModal(null)} className="cursor-pointer">{t('btnCancel')}</Button>
                <Button size="sm" onClick={handleConfirmTime} className="gap-1.5 cursor-pointer font-semibold">
                  <Check size={14} /> {t('bulkSaveInterval')}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
