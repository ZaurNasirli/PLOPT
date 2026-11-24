import React from 'react';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n/I18nContext';
import type { StoreStatus } from '../engine';

const STYLE: Record<StoreStatus, string> = {
  active: 'bg-muted text-muted-foreground',
  new: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  silent: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  closed: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
};

/** Status as text on a tinted chip (the label carries the meaning, the tint only helps scanning) */
export const StatusBadge: React.FC<{ status: StoreStatus }> = ({ status }) => {
  const { t } = useTranslation();
  return <span className={cn('inline-block px-1.5 py-px rounded text-[11px] font-semibold whitespace-nowrap', STYLE[status])}>{t(`fcStatus_${status}`)}</span>;
};
