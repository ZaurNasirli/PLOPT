import React, { useState } from 'react';
import { Layers, Plus, Check, X, Edit2, Eye, EyeOff, Trash2, MousePointer2 } from 'lucide-react';
import { Button, Input } from '../common/UIComponents';
import { Zone, Order } from '../../types';
import { useTranslation } from '../../i18n/I18nContext';

interface DistrictsPanelProps {
  zones: Zone[];
  orders: Order[];
  isDrawingZone: boolean;
  onStartDrawingZone: () => void;
  onSaveZone: () => void;
  onCancelDrawingZone: () => void;
  onToggleZoneVisibility: (zoneId: string) => void;
  onDeleteZone: (zoneId: string) => void;
  onUpdateZoneName: (zoneId: string, name: string) => void;
  onSelectZoneOrders: (orderIds: string[]) => void;
}

export const DistrictsPanel: React.FC<DistrictsPanelProps> = ({
  zones,
  orders,
  isDrawingZone,
  onStartDrawingZone,
  onSaveZone,
  onCancelDrawingZone,
  onToggleZoneVisibility,
  onDeleteZone,
  onUpdateZoneName,
  onSelectZoneOrders,
}) => {
  const { t } = useTranslation();
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editingZoneName, setEditingZoneName] = useState<string>('');

  const roundUp = (num: number, decimals: number = 2) => {
    const factor = Math.pow(10, decimals);
    return (Math.ceil(num * factor) / factor).toFixed(decimals);
  };

  const handleSaveRename = (id: string) => {
    if (editingZoneName.trim()) {
      onUpdateZoneName(id, editingZoneName.trim());
    }
    setEditingZoneId(null);
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto flex-1 scrollbar-thin w-full overflow-x-hidden">
      <div className="flex gap-2">
        {isDrawingZone ? (
          <>
            <Button 
              className="flex-1 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-9 text-xs cursor-pointer" 
              onClick={onSaveZone}
            >
              <Check size={16} /> {t('districtsSaveZone')}
            </Button>
            <Button 
              variant="outline" 
              className="flex-1 gap-1.5 h-9 text-xs cursor-pointer" 
              onClick={onCancelDrawingZone}
            >
              <X size={16} /> {t('btnCancel')}
            </Button>
          </>
        ) : (
          <Button 
            className="w-full gap-2 h-9 text-xs cursor-pointer" 
            onClick={onStartDrawingZone}
          >
            <Plus size={16} /> {t('districtsCreateZone')}
          </Button>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wider text-[10px] text-muted-foreground">
            {t('districtsTitle', { count: zones.length })}
          </h3>
        </div>

        {zones.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center space-y-3 opacity-60">
            <Layers className="w-12 h-12 text-muted-foreground stroke-1" />
            <p className="text-xs text-muted-foreground">
              {t('districtsEmpty')}<br />
              {t('districtsEmptyDesc')}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {zones.map((zone, zIdx) => {
              const zoneOrders = orders.filter(o => zone.orderIds.includes(o.id));
              const totalWeight = zoneOrders.reduce((sum, o) => sum + o.weight, 0);
              const totalVolume = zoneOrders.reduce((sum, o) => sum + o.volume, 0);

              return (
                <div 
                  key={`district-zone-${zone.id || 'zone'}-${zIdx}`} 
                  className="p-3 border rounded-lg bg-card hover:border-primary/50 transition-all group relative"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1 mr-2">
                      {editingZoneId === zone.id ? (
                        <Input 
                          value={editingZoneName} 
                          onChange={(e) => setEditingZoneName(e.target.value)} 
                          className="h-7 text-xs mb-1" 
                          autoFocus 
                          onBlur={() => handleSaveRename(zone.id)} 
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename(zone.id);
                            if (e.key === 'Escape') setEditingZoneId(null);
                          }} 
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full shrink-0 shadow-xs" 
                            style={{ backgroundColor: zone.color }} 
                          />
                          <h4 className="text-xs font-bold truncate max-w-[150px]">{zone.name}</h4>
                          <button 
                            onClick={() => {
                              setEditingZoneId(zone.id);
                              setEditingZoneName(zone.name);
                            }} 
                            className="text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity p-0.5 cursor-pointer"
                            title={t('districtsRenameTitle')}
                          >
                            <Edit2 size={11} />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7 cursor-pointer" 
                        onClick={() => onToggleZoneVisibility(zone.id)}
                        title={zone.isVisible ? t('districtsHideOnMap') : t('districtsShowOnMap')}
                      >
                        {zone.isVisible ? <Eye size={13} /> : <EyeOff size={13} className="text-muted-foreground" />}
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7 text-destructive hover:bg-destructive/10 cursor-pointer" 
                        onClick={() => onDeleteZone(zone.id)}
                        title={t('districtsDeleteZone')}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-dashed text-center">
                    <div className="flex flex-col">
                      <span className="text-[9px] text-muted-foreground uppercase font-semibold">{t('districtsStoresCount')}</span>
                      <span className="text-xs font-bold">{zone.orderIds.length}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] text-muted-foreground uppercase font-semibold">{t('districtsWeightKg')}</span>
                      <span className="text-xs font-bold">{roundUp(totalWeight)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] text-muted-foreground uppercase font-semibold">{t('districtsVolumeM3')}</span>
                      <span className="text-xs font-bold">{roundUp(totalVolume)}</span>
                    </div>
                  </div>

                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full mt-3 h-7 text-[10px] gap-1.5 border border-dashed hover:border-primary hover:text-primary cursor-pointer" 
                    onClick={() => onSelectZoneOrders(zone.orderIds)}
                  >
                    <MousePointer2 size={12} /> {t('districtsSelectAllStores')}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
