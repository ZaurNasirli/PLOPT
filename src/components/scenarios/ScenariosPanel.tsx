import React, { useState } from 'react';
import { Save, Play, Trash2, Edit2, BarChart2, Plus, Sparkles } from 'lucide-react';
import { Button, Input } from '../common/UIComponents';
import { RouteVersion } from '../../types';
import { useTranslation } from '../../i18n/I18nContext';

interface ScenariosPanelProps {
  routeVersions: RouteVersion[];
  onLoadVersion: (version: RouteVersion) => void;
  onDeleteVersion: (id: string) => void;
  onClearAllVersions: () => void;
  onRenameScenario: (id: string, newName: string) => void;
  onViewAnalytics: (version: RouteVersion) => void;
  onSaveCurrentScenario?: () => void;
  onOpenWhatIf?: () => void;
}

export const ScenariosPanel: React.FC<ScenariosPanelProps> = ({
  routeVersions,
  onLoadVersion,
  onDeleteVersion,
  onClearAllVersions,
  onRenameScenario,
  onViewAnalytics,
  onSaveCurrentScenario,
  onOpenWhatIf,
}) => {
  const { t } = useTranslation();
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
  const [editingScenarioName, setEditingScenarioName] = useState<string>('');

  const handleSaveRename = (id: string) => {
    if (editingScenarioName.trim()) {
      onRenameScenario(id, editingScenarioName.trim());
    }
    setEditingScenarioId(null);
  };

  return (
    <div className="p-4 space-y-4 overflow-y-auto flex-1 scrollbar-thin w-full overflow-x-hidden">
      {onOpenWhatIf && (
        <button
          type="button"
          onClick={onOpenWhatIf}
          className="w-full p-2.5 rounded-xl border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-all shadow-xs"
        >
          <Sparkles size={14} />
          <span>🔮 What-If Анализ (5 vs 6 vs 7 машин)</span>
        </button>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[10px] text-muted-foreground">
          {t('scenariosTitle')} ({routeVersions.length})
        </h3>
        <div className="flex items-center gap-1">
          {onSaveCurrentScenario && (
            <Button 
              variant="outline" 
              size="sm" 
              className="h-7 px-2 text-[10px] gap-1 cursor-pointer"
              onClick={onSaveCurrentScenario}
              title={t('btnSaveScenario')}
            >
              <Plus size={12} /> {t('btnSave')}
            </Button>
          )}
          {routeVersions.length > 0 && (
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-destructive h-7 px-2 text-[10px] cursor-pointer" 
              onClick={onClearAllVersions}
            >
              {t('btnDeleteAllScenarios')}
            </Button>
          )}
        </div>
      </div>

      {routeVersions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-3 opacity-60">
          <Save className="w-12 h-12 text-muted-foreground stroke-1" />
          <p className="text-xs text-muted-foreground">
            {t('scenariosEmpty')}<br />
            {t('scenariosEmptyDesc')}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {routeVersions.map((version, vIdx) => (
            <div 
              key={`scenario-ver-${version.id || 'ver'}-${vIdx}`} 
              className="p-3 border rounded-lg bg-card hover:border-primary/50 transition-all group relative"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="flex-1 mr-2">
                  {editingScenarioId === version.id ? (
                    <div className="flex items-center gap-2">
                      <Input 
                        value={editingScenarioName} 
                        onChange={(e) => setEditingScenarioName(e.target.value)} 
                        className="h-7 text-xs" 
                        autoFocus 
                        onBlur={() => handleSaveRename(version.id)} 
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(version.id);
                          if (e.key === 'Escape') setEditingScenarioId(null);
                        }} 
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <h4 className="text-xs font-bold truncate max-w-[160px]">{version.name}</h4>
                      <button 
                        onClick={() => {
                          setEditingScenarioId(version.id);
                          setEditingScenarioName(version.name);
                        }} 
                        className="text-muted-foreground hover:text-primary p-0.5"
                        title={t('btnEdit')}
                      >
                        <Edit2 size={11} />
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground">{version.createdAt}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-7 w-7 text-blue-500 hover:bg-blue-500/10 cursor-pointer" 
                    onClick={() => onViewAnalytics(version)} 
                    title={t('analyticsTitle')}
                  >
                    <BarChart2 size={13} />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-7 w-7 text-primary hover:bg-primary/10 cursor-pointer" 
                    onClick={() => onLoadVersion(version)} 
                    title={t('btnLoadScenario')}
                  >
                    <Play size={13} />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-7 w-7 text-destructive hover:bg-destructive/10 cursor-pointer" 
                    onClick={() => onDeleteVersion(version.id)} 
                    title={t('btnDelete')}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-dashed">
                <div className="flex flex-col">
                  <span className="text-[9px] text-muted-foreground uppercase font-semibold">{t('tabRoutes')}</span>
                  <span className="text-xs font-bold">{version.routes.length}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-muted-foreground uppercase font-semibold">{t('statTotal')}</span>
                  <span className="text-xs font-bold">
                    {version.orders.filter(o => o.status === 'in-route').length}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
