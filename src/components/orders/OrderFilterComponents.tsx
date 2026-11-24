import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { Button } from '../common/UIComponents';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n/I18nContext';

export function DropdownFilter({ 
  label, 
  children, 
  isOpen, 
  onToggle, 
  onClose 
}: { 
  label: string; 
  children: React.ReactNode; 
  isOpen: boolean; 
  onToggle: () => void; 
  onClose: () => void; 
}) {
  return (
    <div className="relative flex-1">
      <Button variant="outline" size="sm" className="w-full justify-between text-[10px] h-7 px-2" onClick={onToggle}>
        {label} <ChevronDown size={10} />
      </Button>
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            className="absolute top-full left-0 w-48 bg-card border shadow-lg rounded-md z-[60] p-2 max-h-64 overflow-y-auto scrollbar-thin mt-1"
            onMouseLeave={onClose}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export const FilterItem: React.FC<{ 
  label: string; 
  checked: boolean; 
  onChange: () => void; 
}> = ({ label, checked, onChange }) => {
  return (
    <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-accent rounded cursor-pointer text-xs">
      <input type="checkbox" checked={checked} onChange={onChange} className="rounded border-input" />
      {label}
    </label>
  );
};

export function StatBlock({ 
  label, 
  data, 
  color, 
  isRoute, 
  rangeType 
}: { 
  label: string; 
  data: any; 
  color: string; 
  isRoute?: boolean; 
  rangeType: 'volume' | 'weight' | 'satir'; 
}) {
  const { t } = useTranslation();
  const metricValue = rangeType === 'volume' 
    ? `${Math.ceil(data.volume)} ${t('m3')}` 
    : rangeType === 'weight' 
      ? `${Math.ceil(data.weight)} ${t('kg')}` 
      : `${data.satir} ${t('satirUnit')}`;
  
  const ordersText = `${data.orders} ${t('ordersShort') || 'зак.'}`;
  const routesText = isRoute ? ` · ${data.routeCount} ${t('routesShortLabel')} · ${Math.round((Number(data.distance) || 0) * 10) / 10} ${t('unitKm')}` : '';

  return (
    <div className="flex flex-col min-w-0 shrink">
      <span className="text-[9px] xl:text-[10px] text-muted-foreground uppercase tracking-wider font-semibold leading-none mb-0.5 truncate">{label}</span>
      <div className={cn("text-[11px] xl:text-[12px] font-semibold whitespace-nowrap", color)}>
        <span>{ordersText} · {metricValue}</span>
        {routesText && <span className="hidden xl:inline text-opacity-90">{routesText}</span>}
      </div>
    </div>
  );
}

export function DataValue({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="text-[12px] font-medium">{value}</span>
    </div>
  );
}
