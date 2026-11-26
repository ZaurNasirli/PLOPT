import React from 'react';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import type { Order } from '../../types';
import { useTranslation } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';

/** Marks a stop of a store-to-store transfer: «pickup → B» on the sender, «transfer ← A» on the receiver */
export const TransferBadge: React.FC<{ order: Pick<Order, 'stopType' | 'transferStoreName' | 'transferStoreCode' | 'transferVolume'>; compact?: boolean; className?: string }> = ({ order, compact, className }) => {
  const { t } = useTranslation();
  if (order.stopType !== 'pickup' && order.stopType !== 'drop') return null;
  const other = order.transferStoreName || order.transferStoreCode || '';
  const pickup = order.stopType === 'pickup';
  const label = pickup ? t('transferPickupTo', { store: other }) : t('transferDropFrom', { store: other });
  return (
    <span
      title={pickup ? t('transferPickupHint', { store: other }) : t('transferDropHint', { store: other })}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-bold shrink-0 max-w-full truncate',
        compact ? 'text-[8px]' : 'text-[10px]',
        pickup ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300' : 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
        className
      )}
    >
      {pickup ? <ArrowUpFromLine size={compact ? 9 : 11} className="shrink-0" /> : <ArrowDownToLine size={compact ? 9 : 11} className="shrink-0" />}
      <span className="truncate">{label}</span>
    </span>
  );
};
