import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { FileSpreadsheet, X } from 'lucide-react';
import { Button } from '../common/UIComponents';
import { useTranslation } from '../../i18n/I18nContext';

export interface RequiredField {
  key: string;
  label: string;
  synonyms?: string[];
  optional?: boolean;
}

export const REQUIRED_FIELDS: RequiredField[] = [
  { key: 'orderNumber', label: 'Номер заказа', synonyms: ['номер заказа', 'order number', 'order_number', '№', 'id', 'номер'] },
  { key: 'customerName', label: 'Название магазина', synonyms: ['название магазина', 'store name', 'customer name', 'клиент', 'магазин', 'покупатель'] },
  { key: 'code', label: 'Код', synonyms: ['код', 'code', 'артикул', 'код магазина'] },
  { key: 'weight', label: 'Вес', synonyms: ['вес', 'weight', 'кг', 'масса', 'вес (кг)'] },
  { key: 'volume', label: 'Объем', synonyms: ['обьем заказа', 'объем заказа', 'volume', 'м3', 'куб', 'объем (м³)', 'объем'] },
  { key: 'region', label: 'Регион', synonyms: ['регион', 'region', 'район', 'зона'] },
  { key: 'satir', label: 'Sətir', synonyms: ['sətir', 'satir', 'строка', 'строк'] },
  { key: 'days', label: 'Дни (1-7)', synonyms: ['день', 'day', 'дни', 'дни работы'] },
  { key: 'timeSlot', label: 'Время', synonyms: ['время', 'time', 'окно', 'временное окно'] },
  { key: 'shippingDate', label: 'Дата отправки', synonyms: ['дата отправки', 'shipping date', 'дата', 'delivery date', 'date', 'дата доставки', 'gün', 'tarih'] },
  { key: 'distance', label: 'Дистанция (км)', synonyms: ['дистанция', 'дистанция (км)', 'distance', 'расстояние', 'км', 'пробег', 'дистанция, км'], optional: true },
  { key: 'lat', label: 'Широта', synonyms: ['широта', 'lat', 'latitude'] },
  { key: 'lng', label: 'Долгота', synonyms: ['долгота', 'lng', 'longitude'] },
  { key: 'allowedTruckType', label: 'Тип грузовика', synonyms: ['тип грузовика', 'truck type', 'машина', 'тип авто', 'тип грузовика (заказ)'], optional: true },
  { key: 'warehouseType', label: 'Тип склада', synonyms: ['тип склада', 'warehouse type', 'склад', 'anbar', 'anbar növü', 'тип_склада', 'warehouse_type', 'depot', 'тип складов', 'anbar novu'], optional: true },
  { key: 'routeId', label: 'Номер маршрута', synonyms: ['номер маршрута', 'маршрут', 'марщрут', 'route', 'routeid', 'номер рейса', 'рейс', 'назначенный маршрут'], optional: true },
];

interface ExcelMappingModalProps {
  show: boolean;
  data: any[];
  headers: string[];
  mapping: Record<string, string>;
  requiredFields: RequiredField[];
  onClose: () => void;
  onUpdateMapping: (key: string, value: string) => void;
  onProcessImport: (data: any[], mapping: Record<string, string>) => void;
}

export const ExcelMappingModal: React.FC<ExcelMappingModalProps> = ({
  show,
  data,
  headers,
  mapping,
  requiredFields,
  onClose,
  onUpdateMapping,
  onProcessImport
}) => {
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {show && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-card border rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]"
          >
            <div className="p-4 border-b flex items-center justify-between bg-primary/5">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-primary" />
                <h3 className="font-bold text-base">{t('excelMappingTitle')}</h3>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose} title={t('btnClose')}>
                <X size={18} />
              </Button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-3 scrollbar-thin">
              <p className="text-xs text-muted-foreground">
                {t('excelMappingDesc')}
              </p>

              <div className="grid grid-cols-2 gap-3">
                {requiredFields.map((field, fIdx) => (
                  <div key={`field-map-${field.key}-${fIdx}`} className="space-y-1">
                    <label className="text-[11px] font-medium flex items-center justify-between">
                      <span>{field.label} {field.optional && <span className="text-muted-foreground text-[9px]">({t('optional')})</span>}</span>
                    </label>
                    <select 
                      className="w-full h-8 text-xs bg-background border rounded-lg px-2 focus:ring-1 focus:ring-primary"
                      value={mapping[field.key] || ''}
                      onChange={(e) => onUpdateMapping(field.key, e.target.value)}
                    >
                      <option value="">-- {t('notSelected')} --</option>
                      {headers.map((h, hIdx) => (
                        <option key={`excel-col-${h || 'empty'}-${hIdx}`} value={h}>{h}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t bg-muted/20 flex justify-end gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={onClose}
                className="cursor-pointer"
              >
                {t('btnCancel')}
              </Button>
              <Button 
                size="sm" 
                onClick={() => onProcessImport(data, mapping)}
                className="cursor-pointer font-semibold"
              >
                {t('btnConfirmImport')} ({data.length})
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
