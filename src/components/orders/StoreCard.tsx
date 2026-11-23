import React from 'react';
import { motion } from 'motion/react';
import { CheckSquare, Square } from 'lucide-react';
import { Store } from '../../types';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n/I18nContext';

interface StoreCardProps {
  store: Store;
  showDetails: boolean;
  isSelected: boolean;
  selectedOrderIds?: string[];
  onToggleSelectStore?: (e: React.MouseEvent) => void;
  onToggleOrder?: (orderId: string) => void;
  onToggle: () => void;
}

export const StoreCard: React.FC<StoreCardProps> = ({
  store,
  showDetails,
  isSelected,
  selectedOrderIds = [],
  onToggleSelectStore,
  onToggleOrder,
  onToggle
}) => {
  const { t } = useTranslation();
  const storeOrderIds = store.orders.map(o => o.id);
  const selectedInStoreCount = storeOrderIds.filter(id => selectedOrderIds.includes(id)).length;
  const isPartiallySelected = selectedInStoreCount > 0 && selectedInStoreCount < storeOrderIds.length;
  const isFullySelected = storeOrderIds.length > 0 && selectedInStoreCount === storeOrderIds.length;

  return (
    <div 
      className={cn(
        "px-2.5 py-1.5 cursor-pointer transition-all border rounded-xl hover:border-primary/50 text-xs flex flex-col gap-1 group",
        isFullySelected 
          ? "border-primary bg-primary/10 shadow-xs" 
          : isPartiallySelected
            ? "border-primary/50 bg-primary/5"
            : "bg-card border-border/70 hover:bg-muted/30"
      )}
      onClick={onToggle}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-xs truncate max-w-[170px] text-foreground flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onToggleSelectStore) onToggleSelectStore(e);
            }}
            className="p-0.5 rounded hover:bg-primary/20 transition-colors shrink-0"
            title={isFullySelected ? t('deselectStore') : t('selectStoreOrders')}
          >
            {isFullySelected ? (
              <CheckSquare size={14} className="text-primary" />
            ) : isPartiallySelected ? (
              <div className="w-3.5 h-3.5 rounded border-2 border-primary bg-primary/20 flex items-center justify-center">
                <div className="w-1.5 h-0.5 bg-primary rounded-full" />
              </div>
            ) : (
              <Square size={14} className="text-muted-foreground group-hover:text-foreground" />
            )}
          </button>
          <span className="truncate">{store.name}</span>
        </div>
        <span className="text-[10px] font-bold text-muted-foreground bg-muted/80 px-1.5 py-0.2 rounded shrink-0">
          {store.orderCount} {t('unitOrders')}
        </span>
      </div>
      
      <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium pt-0.5 border-t border-border/30">
        <span>{Math.ceil(store.totalVolume)} {t('unitM3')} • {Math.ceil(store.totalWeight)} {t('unitKg')}</span>
        <span className="truncate max-w-[90px]">{store.region}</span>
      </div>

      {showDetails && (
        <motion.div 
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="space-y-1 pt-1 border-t border-dashed border-border/50 text-muted-foreground text-[9px]"
        >
          <div className="grid grid-cols-2 gap-y-0.5 gap-x-2">
            <div>{t('satir')}: <span className="text-foreground font-semibold">{store.totalSatir}</span></div>
            <div>{t('filterDays')}: <span className="text-foreground font-semibold">{store.days.join(', ')}</span></div>
            <div className="col-span-2">{t('filterTimeSlots')}: <span className="text-foreground font-semibold">{store.timeSlots.join(', ')}</span></div>
            {store.shippingDates && store.shippingDates.length > 0 && (
              <div className="col-span-2">{t('filterShippingDates')}: <span className="text-primary font-semibold">{store.shippingDates.join(', ')}</span></div>
            )}
            {store.warehouseType && (
              <div className="col-span-2">{t('filterWarehouse')}: <span className="text-foreground font-semibold">{store.warehouseType}</span></div>
            )}
          </div>

          {/* Orders Breakdown with multi-select */}
          <div className="pt-1 border-t border-border/30 space-y-1">
            <div className="text-[8.5px] font-bold uppercase tracking-wider text-muted-foreground">
              {t('storeOrders')} ({store.orders.length}):
            </div>
            <div className="space-y-1 max-h-28 overflow-y-auto scrollbar-thin pr-0.5">
              {store.orders.map((o, oIdx) => {
                const isOrderSel = selectedOrderIds.includes(o.id);
                return (
                  <div
                    key={`store-order-${store.name || 's'}-${o.id || 'o'}-${oIdx}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onToggleOrder) onToggleOrder(o.id);
                    }}
                    className={cn(
                      "flex items-center justify-between p-1 rounded border text-[8.5px] transition-colors cursor-pointer",
                      isOrderSel 
                        ? "bg-primary/15 border-primary/40 font-medium text-foreground" 
                        : "bg-background/80 border-border/40 hover:bg-muted/40 text-muted-foreground"
                    )}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      {isOrderSel ? (
                        <CheckSquare size={10} className="text-primary shrink-0" />
                      ) : (
                        <Square size={10} className="text-muted-foreground shrink-0" />
                      )}
                      <span className="font-mono text-foreground font-semibold truncate">{o.orderNumber || o.code}</span>
                      <span className="text-[8px] opacity-80">({Math.ceil(o.weight)}{t('unitKg')})</span>
                      {o.warehouseType && (
                        <span className="text-[7.5px] px-1 py-0.2 rounded bg-muted/80 text-muted-foreground font-medium truncate max-w-[65px]" title={`${t('filterWarehouse')}: ${o.warehouseType}`}>
                          {o.warehouseType}
                        </span>
                      )}
                    </div>
                    <span className={cn(
                      "px-1 py-0.2 rounded text-[7.5px] font-bold shrink-0",
                      o.status === 'in-route' ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                    )}>
                      {o.status === 'in-route' ? t('orderStatusInRoute') : t('orderStatusFree')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};
