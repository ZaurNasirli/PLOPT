import React from 'react';
import { 
  HelpCircle, LayoutDashboard, Upload, MapPin, 
  Navigation, TrendingUp, Truck, X 
} from 'lucide-react';
import { Button } from '../common/UIComponents';
import { useTranslation } from '../../i18n/I18nContext';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-card border rounded-2xl max-w-xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-primary/10 rounded-lg text-primary">
              <HelpCircle size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold">{t('helpTitle')}</h2>
              <p className="text-[11px] text-muted-foreground">{t('helpSubtitle')}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full cursor-pointer" onClick={onClose} title={t('btnClose')}>
            <X size={16} />
          </Button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1 scrollbar-thin text-xs text-muted-foreground leading-relaxed">
          <section className="space-y-1.5">
            <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
              <LayoutDashboard size={15} className="text-primary" /> {t('helpOverviewTitle')}
            </h3>
            <p>
              {t('helpOverviewText')}
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
              <Upload size={15} className="text-primary" /> {t('helpImportTitle')}
            </h3>
            <p>
              {t('helpImportText')}
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
              <Navigation size={15} className="text-primary" /> {t('helpRoutingTitle')}
            </h3>
            <p>
              {t('helpRoutingText')}
            </p>
          </section>
        </div>

        <div className="p-3 border-t bg-muted/30 flex justify-end">
          <Button size="sm" onClick={onClose} className="cursor-pointer font-semibold">
            {t('understood')}
          </Button>
        </div>
      </div>
    </div>
  );
};
