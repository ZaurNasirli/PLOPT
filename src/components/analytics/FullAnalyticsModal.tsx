import React from 'react';
import { motion } from 'motion/react';
import { BarChart2, X } from 'lucide-react';
import { Route, Order } from '../../types';
import { RoutingLimits } from '../../services/routingService';
import { Button } from '../common/UIComponents';
import { EnhancedKpiView } from '../EnhancedKpiView';
import { useTranslation } from '../../i18n/I18nContext';

interface FullAnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  routes: Route[];
  orders: Order[];
  limits: RoutingLimits;
}

export const FullAnalyticsModal: React.FC<FullAnalyticsModalProps> = ({
  isOpen,
  onClose,
  routes,
  orders,
  limits
}) => {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center p-2 sm:p-4 bg-background/80 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-card border shadow-2xl rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        <div className="p-4 sm:p-5 border-b flex justify-between items-center bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <BarChart2 size={22} />
            </div>
            <div>
              <h2 className="text-xl font-bold">{t('btnOpenFullAnalytics')}</h2>
              <p className="text-xs text-muted-foreground">{t('analyticsSubtitle') || t('analyticsTitle')}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full h-9 w-9 cursor-pointer" title={t('btnClose')}>
            <X size={20} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-6 scrollbar-thin">
          <EnhancedKpiView 
            routes={routes} 
            orders={orders} 
            limits={limits} 
            onSelectRoute={() => {
              onClose();
            }}
          />
        </div>

        <div className="p-4 border-t bg-muted/20 flex justify-end">
          <Button onClick={onClose} className="px-6 h-9 text-xs cursor-pointer font-semibold">{t('btnClose')}</Button>
        </div>
      </motion.div>
    </div>
  );
};
