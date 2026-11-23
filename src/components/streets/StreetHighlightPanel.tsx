import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  MapPin, 
  Paintbrush, 
  MousePointerClick, 
  Trash2, 
  Eye, 
  EyeOff, 
  Plus, 
  Check, 
  RotateCcw, 
  Sparkles, 
  Route as RouteIcon,
  Sliders,
  CheckSquare,
  Square,
  AlertCircle,
  Folder,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  Edit2,
  Palette,
  Layers,
  X
} from 'lucide-react';
import { Order, StreetHighlight, StreetGroup } from '../../types';
import { Button, Input } from '../common/UIComponents';
import { cn } from '../../lib/utils';
import { POPULAR_BAKU_STREETS, searchStreetByName } from '../../services/streetService';

interface StreetHighlightPanelProps {
  orders: Order[];
  streetHighlights: StreetHighlight[];
  streetGroups: StreetGroup[];
  onAddStreetHighlight: (highlight: StreetHighlight) => void;
  onRemoveStreetHighlight: (id: string) => void;
  onToggleStreetVisibility: (id: string) => void;
  onUpdateStreet?: (streetId: string, updates: Partial<StreetHighlight>) => void;
  onClearAllStreets: () => void;
  onSelectOrders: (orderIds: string[]) => void;
  onCreateRouteFromOrders: (orderIds: string[]) => void;
  selectedOrderIds: string[];
  // Mode controls
  activeMode: 'name' | 'click' | 'brush' | null;
  onSetActiveMode: (mode: 'name' | 'click' | 'brush' | null) => void;
  // Brush props
  brushRadiusMeters: number;
  onSetBrushRadiusMeters: (radius: number) => void;
  currentBrushTrail: [number, number][];
  currentBrushOrderIds: string[];
  onSaveCurrentBrushAsStreet: () => void;
  onClearCurrentBrush: () => void;
  // Grouping handlers
  onAddGroup: (name: string, color: string) => StreetGroup;
  onUpdateGroup: (groupId: string, updates: Partial<StreetGroup>) => void;
  onDeleteGroup: (groupId: string, deleteStreets?: boolean) => void;
  onAssignStreetToGroup: (streetId: string, groupId?: string) => void;
  onBulkAssignStreetsToGroup: (streetIds: string[], groupId?: string) => void;
  // Line appearance styling
  streetLineWidth?: number;
  onSetStreetLineWidth?: (width: number) => void;
  streetLineOpacity?: number;
  onSetStreetLineOpacity?: (opacity: number) => void;
}

const COLOR_PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // purple
  '#06b6d4', // cyan
  '#ef4444', // red
  '#14b8a6', // teal
  '#f97316', // orange
  '#6366f1'  // indigo
];

export const StreetHighlightPanel: React.FC<StreetHighlightPanelProps> = ({
  orders,
  streetHighlights,
  streetGroups,
  onAddStreetHighlight,
  onRemoveStreetHighlight,
  onToggleStreetVisibility,
  onUpdateStreet,
  onClearAllStreets,
  onSelectOrders,
  onCreateRouteFromOrders,
  selectedOrderIds,
  activeMode,
  onSetActiveMode,
  brushRadiusMeters,
  onSetBrushRadiusMeters,
  currentBrushTrail,
  currentBrushOrderIds,
  onSaveCurrentBrushAsStreet,
  onClearCurrentBrush,
  onAddGroup,
  onUpdateGroup,
  onDeleteGroup,
  onAssignStreetToGroup,
  onBulkAssignStreetsToGroup,
  streetLineWidth = 6,
  onSetStreetLineWidth,
  streetLineOpacity = 0.9,
  onSetStreetLineOpacity,
}) => {
  // Method 1 (Name) state
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [selectedColor, setSelectedColor] = useState(COLOR_PALETTE[0]);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Group creation state
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState(COLOR_PALETTE[1]);

  // Group editing state (renaming & palette popovers)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [colorPickerGroupId, setColorPickerGroupId] = useState<string | null>(null);

  // Multi-selection of streets for bulk grouping
  const [selectedStreetIds, setSelectedStreetIds] = useState<string[]>([]);
  const [isMultiSelectActive, setIsMultiSelectActive] = useState(false);
  const [bulkColorPickerOpen, setBulkColorPickerOpen] = useState(false);

  // Group collapsed state map (collapsed by default)
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Record<string, boolean>>({});
  const [isStyleOpen, setIsStyleOpen] = useState(false);
  const [stylePopoverGroupId, setStylePopoverGroupId] = useState<string | null>(null);

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroupIds(prev => {
      const currentlyCollapsed = prev[groupId] !== false;
      return {
        ...prev,
        [groupId]: !currentlyCollapsed
      };
    });
  };

  const handleSearchAndAdd = async (queryToUse?: string) => {
    const query = (queryToUse || searchQuery).trim();
    if (!query) return;

    setIsSearching(true);
    setSearchError(null);

    try {
      const result = await searchStreetByName(query, orders);
      if (!result || result.coordinates.length < 2) {
        setSearchError('Улица не найдена. Уточните название или выберите из списка популярных улиц ниже.');
        setIsSearching(false);
        return;
      }

      const newHighlight: StreetHighlight = {
        id: `street-${Date.now()}`,
        name: result.name,
        color: selectedColor,
        coordinates: result.coordinates,
        multiCoordinates: result.multiCoordinates,
        orderIds: result.orders.map(o => o.id),
        source: 'name',
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isVisible: true
      };

      onAddStreetHighlight(newHighlight);
      if (result.orders.length > 0) {
        onSelectOrders(result.orders.map(o => o.id));
      }
      setSearchQuery('');
    } catch (_e) {
      setSearchError('Ошибка поиска улицы. Попробуйте снова.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleCreateGroupSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newGroupName.trim()) return;

    const group = onAddGroup(newGroupName.trim(), newGroupColor);
    // If there were selected streets, automatically assign them to the new group
    if (selectedStreetIds.length > 0) {
      onBulkAssignStreetsToGroup(selectedStreetIds, group.id);
      setSelectedStreetIds([]);
    }

    setNewGroupName('');
    setIsCreatingGroup(false);
  };

  const handleStartRenameGroup = (group: StreetGroup) => {
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
  };

  const handleSaveRenameGroup = (groupId: string) => {
    if (editingGroupName.trim()) {
      onUpdateGroup(groupId, { name: editingGroupName.trim() });
    }
    setEditingGroupId(null);
    setEditingGroupName('');
  };

  const handleToggleStreetSelection = (streetId: string) => {
    setSelectedStreetIds(prev => 
      prev.includes(streetId) ? prev.filter(id => id !== streetId) : [...prev, streetId]
    );
  };

  const handleSelectAllStreets = () => {
    if (selectedStreetIds.length === streetHighlights.length) {
      setSelectedStreetIds([]);
    } else {
      setSelectedStreetIds(streetHighlights.map(s => s.id));
    }
  };

  // Orders calculation for brush
  const brushedOrders = orders.filter(o => currentBrushOrderIds.includes(o.id));
  const brushWeight = brushedOrders.reduce((sum, o) => sum + o.weight, 0);
  const brushVolume = brushedOrders.reduce((sum, o) => sum + o.volume, 0);

  // Total orders in all highlighted streets
  const allHighlightedOrderIds = Array.from(
    new Set(streetHighlights.filter(s => s.isVisible !== false).flatMap(s => s.orderIds || []))
  );

  // Grouped and ungrouped lists
  const ungroupedStreets = streetHighlights.filter(s => !s.groupId);

  return (
    <div className="p-4 space-y-4 overflow-y-auto flex-1 scrollbar-thin w-full overflow-x-hidden">
      {/* Header with clear description */}
      <div className="space-y-1 border-b pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <MapPin size={16} />
            </div>
            <h3 className="text-sm font-bold">Выделение улиц</h3>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
              {streetHighlights.length} улиц
            </span>
            {streetGroups.length > 0 && (
              <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                {streetGroups.length} групп
              </span>
            )}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Выделяйте улицы по названию, кликом или кистью, а затем группируйте их для совместного управления цветом и маршрутами.
        </p>
      </div>

      {/* Methods & Style Selector Switcher */}
      <div className="grid grid-cols-4 gap-1 p-1 bg-muted/50 rounded-xl border">
        {/* Method 1: Search by Name */}
        <button
          onClick={() => onSetActiveMode(activeMode === 'name' ? null : 'name')}
          className={cn(
            "flex flex-col items-center justify-center py-2 px-1 rounded-lg text-[10px] font-medium transition-all gap-1 text-center",
            activeMode === 'name' 
              ? "bg-background text-primary shadow-sm font-bold border border-primary/20" 
              : "text-muted-foreground hover:text-foreground hover:bg-background/50"
          )}
        >
          <Search size={14} className={activeMode === 'name' ? "text-primary" : ""} />
          <span className="truncate w-full">По названию</span>
        </button>

        {/* Method 2: Click on Map */}
        <button
          onClick={() => onSetActiveMode(activeMode === 'click' ? null : 'click')}
          className={cn(
            "flex flex-col items-center justify-center py-2 px-1 rounded-lg text-[10px] font-medium transition-all gap-1 text-center",
            activeMode === 'click' 
              ? "bg-background text-primary shadow-sm font-bold border border-primary/20" 
              : "text-muted-foreground hover:text-foreground hover:bg-background/50"
          )}
        >
          <MousePointerClick size={14} className={activeMode === 'click' ? "text-primary" : ""} />
          <span className="truncate w-full">Клик</span>
        </button>

        {/* Method 3: Brush */}
        <button
          onClick={() => onSetActiveMode(activeMode === 'brush' ? null : 'brush')}
          className={cn(
            "flex flex-col items-center justify-center py-2 px-1 rounded-lg text-[10px] font-medium transition-all gap-1 text-center",
            activeMode === 'brush' 
              ? "bg-background text-primary shadow-sm font-bold border border-primary/20" 
              : "text-muted-foreground hover:text-foreground hover:bg-background/50"
          )}
        >
          <Paintbrush size={14} className={activeMode === 'brush' ? "text-primary" : ""} />
          <span className="truncate w-full">Кисть</span>
        </button>

        {/* Line Style Toggle Button */}
        <button
          onClick={() => setIsStyleOpen(!isStyleOpen)}
          className={cn(
            "flex flex-col items-center justify-center py-2 px-1 rounded-lg text-[10px] font-medium transition-all gap-1 text-center",
            isStyleOpen 
              ? "bg-primary text-primary-foreground shadow-sm font-bold border border-primary" 
              : "text-muted-foreground hover:text-foreground hover:bg-background/50"
          )}
          title="Открыть настройку общей толщины и яркости линий"
        >
          <Sliders size={14} className={isStyleOpen ? "text-primary-foreground" : ""} />
          <span className="truncate w-full">Стиль линий</span>
        </button>
      </div>

      {/* METHOD 1: NAME SEARCH PANEL */}
      <AnimatePresence>
        {activeMode === 'name' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-3 rounded-xl border bg-card space-y-3 shadow-sm overflow-hidden"
          >
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>Способ 1: Поиск по названию</span>
              <span className="text-[10px] text-muted-foreground">Реальная геометрия дорог</span>
            </div>

            {/* Input and Action */}
            <div className="flex gap-1.5">
              <Input
                placeholder="Например: Низами, Нефтяников, Бабек..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchAndAdd()}
                className="h-8 text-xs flex-1"
              />
              <Button
                size="sm"
                className="h-8 px-3 text-xs gap-1"
                onClick={() => handleSearchAndAdd()}
                disabled={isSearching || !searchQuery.trim()}
              >
                {isSearching ? <Sparkles size={13} className="animate-spin" /> : <Plus size={13} />}
                <span>Добавить</span>
              </Button>
            </div>

            {searchError && (
              <div className="flex items-start gap-1.5 text-[10px] text-destructive bg-destructive/10 p-2 rounded-lg">
                <AlertCircle size={13} className="shrink-0 mt-0.5" />
                <span>{searchError}</span>
              </div>
            )}

            {/* Color selection for added street */}
            <div className="space-y-1">
              <span className="text-[10px] text-muted-foreground font-medium">Цвет подсветки:</span>
              <div className="flex items-center gap-1.5">
                {COLOR_PALETTE.slice(0, 7).map((color, cIdx) => (
                  <button
                    key={`color-palette-item-${color}-${cIdx}`}
                    onClick={() => setSelectedColor(color)}
                    className={cn(
                      "w-5 h-5 rounded-full transition-transform",
                      selectedColor === color ? "scale-125 ring-2 ring-foreground ring-offset-1" : "hover:scale-110"
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            {/* Popular Baku Streets suggestions */}
            <div className="space-y-1.5 pt-1">
              <span className="text-[10px] text-muted-foreground font-medium">Популярные проспекты и улицы Баку:</span>
              <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto pr-1">
                {POPULAR_BAKU_STREETS.map((st, stIdx) => (
                  <button
                    key={`popular-st-${st.name}-${stIdx}`}
                    onClick={() => handleSearchAndAdd(st.name)}
                    disabled={isSearching}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-muted/80 hover:bg-primary/10 hover:text-primary hover:border-primary/30 border text-left truncate max-w-[190px] transition-colors"
                    title={st.name}
                  >
                    {st.name.split('(')[0].trim()}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* METHOD 2: CLICK ON MAP PANEL */}
      <AnimatePresence>
        {activeMode === 'click' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-3 rounded-xl border bg-card space-y-2 shadow-sm overflow-hidden"
          >
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>Способ 2: Выделение кликом на карте</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            </div>
            <div className="text-[11px] text-muted-foreground bg-primary/5 border border-primary/10 p-2.5 rounded-lg space-y-1">
              <p className="font-semibold text-primary">Режим клика активен:</p>
              <p>
                Нажмите на любую улицу или отрезок дороги на карте. Алгоритм автоматически привяжется к центральной оси дороги, определит её название и выделит реальный контур улицы с прилегающими заказами.
              </p>
            </div>
            <div className="flex justify-end pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
                onClick={() => onSetActiveMode(null)}
              >
                Отключить режим клика
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* METHOD 3: BRUSH PANEL */}
      <AnimatePresence>
        {activeMode === 'brush' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="p-3 rounded-xl border bg-card space-y-3 shadow-sm overflow-hidden"
          >
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>Способ 3: Ручная кисть</span>
              <span className="text-[10px] text-primary font-bold">{brushRadiusMeters}м радиус</span>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><Sliders size={11} /> Радиус захвата:</span>
                <span className="font-bold text-foreground">{brushRadiusMeters} метров</span>
              </div>
              <input
                type="range"
                min="20"
                max="300"
                step="10"
                value={brushRadiusMeters}
                onChange={(e) => onSetBrushRadiusMeters(Number(e.target.value))}
                className="w-full accent-primary h-1.5 bg-muted rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[9px] text-muted-foreground">
                <span>Узкий (20м)</span>
                <span>Стандарт (80м)</span>
                <span>Широкий (250м)</span>
              </div>
            </div>

            {/* Live Brush Stats */}
            {currentBrushTrail.length > 0 && (
              <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/20 space-y-2">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-semibold">Текущий мазок кисти:</span>
                  <span className="font-bold text-primary">{currentBrushOrderIds.length} заказов</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground border-t border-primary/10 pt-1">
                  <div>Вес: <span className="text-foreground font-bold">{Math.ceil(brushWeight)} кг</span></div>
                  <div>Объём: <span className="text-foreground font-bold">{Math.ceil(brushVolume)} м³</span></div>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    className="flex-1 h-7 text-[10px] gap-1"
                    onClick={onSaveCurrentBrushAsStreet}
                  >
                    <Check size={12} /> Сохранить как улицу
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px] px-2 text-destructive hover:bg-destructive/10"
                    onClick={onClearCurrentBrush}
                  >
                    <RotateCcw size={12} />
                  </Button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-[9.5px] text-muted-foreground">
                Зажмите левую кнопку мыши на карте и ведите курсор
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
                onClick={() => onSetActiveMode(null)}
              >
                Выйти из кисти
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* LINE APPEARANCE: THICKNESS & BRIGHTNESS CONTROLS (COLLAPSIBLE) */}
      <AnimatePresence>
        {isStyleOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 bg-muted/40 border rounded-xl space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sliders size={14} className="text-primary" />
                  <span className="text-xs font-bold text-foreground">Общая толщина и яркость линий</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onSetStreetLineWidth?.(6);
                      onSetStreetLineOpacity?.(0.9);
                    }}
                    className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
                    title="Сбросить толщину (6px) и яркость (90%) к значениям по умолчанию"
                  >
                    <RotateCcw size={10} />
                    <span>Сброс</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsStyleOpen(false)}
                    className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted"
                    title="Скрыть панель стиля"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>

              {/* Thickness Slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground font-medium">Толщина линий на карте:</span>
                  <span className="font-bold text-foreground px-1.5 py-0.2 rounded bg-background border text-[10px]">
                    {streetLineWidth || 6} px
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="2"
                    max="16"
                    step="1"
                    value={streetLineWidth || 6}
                    onChange={(e) => onSetStreetLineWidth?.(Number(e.target.value))}
                    className="flex-1 accent-primary h-1.5 bg-muted rounded-lg cursor-pointer"
                  />
                </div>
                <div className="flex items-center gap-1 pt-0.5">
                  {[3, 6, 9, 12, 16].map((w, wIdx) => (
                    <button
                      key={`brush-w-btn-${w}-${wIdx}`}
                      type="button"
                      onClick={() => onSetStreetLineWidth?.(w)}
                      className={cn(
                        "flex-1 py-0.5 rounded text-[9px] font-semibold transition-all border",
                        (streetLineWidth || 6) === w 
                          ? "bg-primary text-primary-foreground border-primary shadow-xs" 
                          : "bg-background hover:bg-muted text-muted-foreground border-border"
                      )}
                    >
                      {w}px
                    </button>
                  ))}
                </div>
              </div>

              {/* Brightness / Opacity Slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground font-medium">Яркость / Непрозрачность:</span>
                  <span className="font-bold text-foreground px-1.5 py-0.2 rounded bg-background border text-[10px]">
                    {Math.round((streetLineOpacity !== undefined ? streetLineOpacity : 0.9) * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0.2"
                    max="1.0"
                    step="0.05"
                    value={streetLineOpacity !== undefined ? streetLineOpacity : 0.9}
                    onChange={(e) => onSetStreetLineOpacity?.(Number(e.target.value))}
                    className="flex-1 accent-primary h-1.5 bg-muted rounded-lg cursor-pointer"
                  />
                </div>
                <div className="flex items-center gap-1 pt-0.5">
                  {[0.4, 0.6, 0.8, 0.9, 1.0].map((op, opIdx) => (
                    <button
                      key={`brush-op-btn-${op}-${opIdx}`}
                      type="button"
                      onClick={() => onSetStreetLineOpacity?.(op)}
                      className={cn(
                        "flex-1 py-0.5 rounded text-[9px] font-semibold transition-all border",
                        Math.abs((streetLineOpacity !== undefined ? streetLineOpacity : 0.9) - op) < 0.03
                          ? "bg-primary text-primary-foreground border-primary shadow-xs" 
                          : "bg-background hover:bg-muted text-muted-foreground border-border"
                      )}
                    >
                      {Math.round(op * 100)}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Visual Line Preview */}
              <div className="pt-1 flex items-center justify-between px-2.5 py-1.5 bg-background rounded-lg border">
                <span className="text-[10px] text-muted-foreground font-medium">Предпросмотр линии:</span>
                <div className="flex-1 max-w-[170px] h-7 flex items-center justify-center relative px-2">
                  <div 
                    style={{
                      width: '100%',
                      height: `${Math.max(streetLineWidth || 6, 2)}px`,
                      backgroundColor: selectedColor || '#3b82f6',
                      opacity: streetLineOpacity !== undefined ? streetLineOpacity : 0.9,
                      borderRadius: '9999px',
                      boxShadow: `0 0 ${(streetLineWidth || 6) * 1.6}px ${selectedColor || '#3b82f6'}`
                    }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* GROUPING MANAGEMENT HEADER & BUTTONS */}
      <div className="space-y-2 pt-1 border-t">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Layers size={14} className="text-primary" />
            <h4 className="text-xs font-bold text-foreground">Группы и улицы</h4>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-6 px-2 text-[10px] gap-1",
                isMultiSelectActive && "bg-primary/10 border-primary text-primary"
              )}
              onClick={() => {
                setIsMultiSelectActive(!isMultiSelectActive);
                if (isMultiSelectActive) setSelectedStreetIds([]);
              }}
              title="Выбор нескольких улиц для массового отнесения к группе"
            >
              <CheckSquare size={11} />
              <span>{isMultiSelectActive ? 'Отмена выбора' : 'Выбрать улицы'}</span>
            </Button>

            <Button
              size="sm"
              className="h-6 px-2 text-[10px] gap-1 bg-primary/90 hover:bg-primary"
              onClick={() => setIsCreatingGroup(!isCreatingGroup)}
            >
              <FolderPlus size={12} />
              <span>Новая группа</span>
            </Button>
          </div>
        </div>

        {/* INLINE CREATE GROUP FORM */}
        <AnimatePresence>
          {isCreatingGroup && (
            <motion.form
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              onSubmit={handleCreateGroupSubmit}
              className="p-3 rounded-xl border bg-muted/40 space-y-2.5 overflow-hidden"
            >
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="flex items-center gap-1.5">
                  <FolderPlus size={13} className="text-primary" />
                  Создание группы улиц
                </span>
                <button
                  type="button"
                  onClick={() => setIsCreatingGroup(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X size={13} />
                </button>
              </div>

              <Input
                placeholder="Название группы (например: Центр, Ясамал, Север...)"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                className="h-8 text-xs"
                autoFocus
              />

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground font-medium">
                  <span>Цвет группы (применится ко всем улицам группы):</span>
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: newGroupColor }} />
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {COLOR_PALETTE.map((c, cIdx) => (
                    <button
                      key={`new-group-color-${c}-${cIdx}`}
                      type="button"
                      onClick={() => setNewGroupColor(c)}
                      className={cn(
                        "w-5 h-5 rounded-full transition-all",
                        newGroupColor === c ? "scale-125 ring-2 ring-foreground ring-offset-1" : "hover:scale-110 opacity-80 hover:opacity-100"
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {selectedStreetIds.length > 0 && (
                <div className="text-[10px] text-primary bg-primary/10 px-2 py-1 rounded">
                  В новую группу сразу войдут {selectedStreetIds.length} выбранных улиц!
                </div>
              )}

              <div className="flex gap-2 justify-end pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2.5"
                  onClick={() => setIsCreatingGroup(false)}
                >
                  Отмена
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  className="h-7 text-xs px-3 gap-1"
                  disabled={!newGroupName.trim()}
                >
                  <Check size={12} /> Создать группу
                </Button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* BULK ACTIONS TOOLBAR (when streets are selected via checkboxes) */}
        {selectedStreetIds.length > 0 && (
          <div className="p-2.5 rounded-xl border border-primary/30 bg-primary/10 space-y-2 animate-in fade-in">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-primary flex items-center gap-1.5">
                <CheckSquare size={13} />
                Выбрано улиц: {selectedStreetIds.length}
              </span>
              <button
                onClick={handleSelectAllStreets}
                className="text-[10px] text-primary hover:underline font-medium"
              >
                {selectedStreetIds.length === streetHighlights.length ? 'Снять все' : 'Выбрать все'}
              </button>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap text-xs">
              <div className="flex-1 min-w-[130px]">
                <select
                  className="w-full h-7 rounded border bg-background text-[11px] px-2 font-medium"
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__new__') {
                      setIsCreatingGroup(true);
                    } else if (val === '__none__') {
                      onBulkAssignStreetsToGroup(selectedStreetIds, undefined);
                      setSelectedStreetIds([]);
                    } else if (val) {
                      onBulkAssignStreetsToGroup(selectedStreetIds, val);
                      setSelectedStreetIds([]);
                    }
                  }}
                  defaultValue=""
                >
                  <option value="" disabled>Отнести в группу...</option>
                  {streetGroups.map((g, gIdx) => (
                    <option key={`bulk-street-group-opt-${g.id || 'grp'}-${gIdx}`} value={g.id}>📁 {g.name}</option>
                  ))}
                  <option value="__none__">❌ Убрать из групп</option>
                  <option value="__new__">➕ Создать новую группу...</option>
                </select>
              </div>

              {/* Quick bulk color palette */}
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[10px] gap-1"
                  onClick={() => setBulkColorPickerOpen(!bulkColorPickerOpen)}
                >
                  <Palette size={12} />
                  <span>Цвет</span>
                </Button>
                {bulkColorPickerOpen && (
                  <div className="absolute right-0 top-8 z-30 p-2 bg-popover rounded-lg border shadow-lg grid grid-cols-5 gap-1.5 w-36">
                    {COLOR_PALETTE.map((c, cIdx) => (
                      <button
                        key={`bulk-picker-color-${c}-${cIdx}`}
                        className="w-5 h-5 rounded-full hover:scale-125 transition-transform"
                        style={{ backgroundColor: c }}
                        onClick={() => {
                          if (onUpdateStreet) {
                            (selectedStreetIds || []).forEach(id => onUpdateStreet(id, { color: c }));
                          }
                          setBulkColorPickerOpen(false);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              <Button
                variant="destructive"
                size="sm"
                className="h-7 px-2 text-[10px]"
                onClick={() => {
                  (selectedStreetIds || []).forEach(id => onRemoveStreetHighlight(id));
                  setSelectedStreetIds([]);
                }}
                title="Удалить выбранные улицы"
              >
                <Trash2 size={12} />
              </Button>
            </div>
          </div>
        )}

        {/* LIST OF GROUPS AND STREETS */}
        {streetHighlights.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center space-y-2 bg-muted/20 border border-dashed rounded-xl">
            <RouteIcon className="w-8 h-8 text-muted-foreground/40" />
            <p className="text-[11px] text-muted-foreground">
              Нет выделенных улиц.<br />
              Выберите способ вверху (поиск, клик на карте или кисть).
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Header with expand/collapse all groups controls */}
            {streetGroups.length > 1 && (
              <div className="flex items-center justify-end gap-2 text-[10px] text-muted-foreground px-1 pb-0.5">
                <button
                  type="button"
                  className="text-primary hover:underline font-semibold cursor-pointer"
                  onClick={() => {
                    const allExpanded: Record<string, boolean> = {};
                    streetGroups.forEach(g => { allExpanded[g.id] = false; });
                    setCollapsedGroupIds(allExpanded);
                  }}
                >
                  Развернуть все
                </button>
                <span>•</span>
                <button
                  type="button"
                  className="hover:underline cursor-pointer"
                  onClick={() => {
                    const allCollapsed: Record<string, boolean> = {};
                    streetGroups.forEach(g => { allCollapsed[g.id] = true; });
                    setCollapsedGroupIds(allCollapsed);
                  }}
                >
                  Свернуть все
                </button>
              </div>
            )}

            {/* RENDER EACH GROUP */}
            {streetGroups.map((group, gIdx) => {
              const groupStreets = streetHighlights.filter(s => s.groupId === group.id);
              const isCollapsed = collapsedGroupIds[group.id] !== false;
              const groupOrders = orders.filter(o => 
                groupStreets.flatMap(s => s.orderIds || []).includes(o.id)
              );
              const groupWeight = groupOrders.reduce((sum, o) => sum + o.weight, 0);
              const groupVolume = groupOrders.reduce((sum, o) => sum + o.volume, 0);
              const allVisible = groupStreets.length > 0 && groupStreets.every(s => s.isVisible !== false);

              return (
                <div
                  key={`street-group-${group.id}-${gIdx}`}
                  className="rounded-xl border bg-card shadow-sm overflow-hidden transition-all"
                  style={{ borderLeftWidth: 4, borderLeftColor: group.color }}
                >
                  {/* GROUP HEADER */}
                  <div className="p-2.5 bg-muted/30 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Collapse toggle */}
                      <button
                        onClick={() => toggleGroupCollapse(group.id)}
                        className="text-muted-foreground hover:text-foreground transition-transform"
                      >
                        {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      </button>

                      {/* Group Color Swatch & Palette trigger */}
                      <div className="relative">
                        <button
                          onClick={() => setColorPickerGroupId(colorPickerGroupId === group.id ? null : group.id)}
                          className="w-4 h-4 rounded-full shadow-sm ring-1 ring-border hover:scale-125 transition-transform"
                          style={{ backgroundColor: group.color }}
                          title="Нажмите, чтобы изменить цвет всей группы"
                        />
                        {/* Inline color picker popup */}
                        {colorPickerGroupId === group.id && (
                          <div className="absolute left-0 top-6 z-30 p-2 bg-popover rounded-xl border shadow-xl grid grid-cols-5 gap-1.5 w-36 animate-in fade-in zoom-in-95">
                            {COLOR_PALETTE.map((c, cIdx) => (
                              <button
                                key={`edit-grp-color-${c}-${cIdx}`}
                                className={cn(
                                  "w-5 h-5 rounded-full transition-transform",
                                  group.color === c ? "scale-125 ring-2 ring-foreground" : "hover:scale-110"
                                )}
                                style={{ backgroundColor: c }}
                                onClick={() => {
                                  onUpdateGroup(group.id, { color: c });
                                  setColorPickerGroupId(null);
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Editable Name */}
                      {editingGroupId === group.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={editingGroupName}
                            onChange={(e) => setEditingGroupName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSaveRenameGroup(group.id)}
                            className="h-6 text-xs px-1.5 rounded border bg-background font-bold w-32"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveRenameGroup(group.id)}
                            className="text-primary hover:opacity-80 p-0.5"
                          >
                            <Check size={13} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <h5 
                            className="text-xs font-bold truncate text-foreground cursor-pointer hover:text-primary"
                            onClick={() => handleStartRenameGroup(group)}
                            title="Кликните для переименования группы"
                          >
                            {group.name}
                          </h5>
                          <button
                            onClick={() => handleStartRenameGroup(group)}
                            className="text-muted-foreground/60 hover:text-foreground"
                            title="Переименовать группу"
                          >
                            <Edit2 size={11} />
                          </button>
                        </div>
                      )}

                      {/* Count badge */}
                      <span className="text-[9.5px] px-1.5 py-0.2 rounded-full bg-muted font-medium text-muted-foreground shrink-0">
                        {groupStreets.length} ул. • {groupOrders.length} зак.
                      </span>
                    </div>

                    {/* Group Header Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Group line style settings */}
                      <div className="relative">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-6 w-6 text-muted-foreground hover:text-foreground",
                            stylePopoverGroupId === group.id && "text-primary bg-primary/10"
                          )}
                          onClick={() => setStylePopoverGroupId(stylePopoverGroupId === group.id ? null : group.id)}
                          title="Настроить толщину для всех линий этой группы"
                        >
                          <Sliders size={12} />
                        </Button>
                        {stylePopoverGroupId === group.id && (
                          <div className="absolute right-0 top-7 z-30 p-2.5 bg-popover rounded-xl border shadow-xl w-52 space-y-2 animate-in fade-in zoom-in-95 text-[10px]">
                            <div className="flex items-center justify-between font-bold text-foreground">
                              <span>Толщина группы</span>
                              <button
                                onClick={() => setStylePopoverGroupId(null)}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <X size={12} />
                              </button>
                            </div>
                            <div className="flex items-center justify-between text-muted-foreground">
                              <span>Толщина линий:</span>
                              <span className="font-bold text-foreground bg-background px-1.5 py-0.5 rounded border">
                                {group.thickness || streetLineWidth || 6} px
                              </span>
                            </div>
                            <div className="flex gap-1">
                              {[3, 6, 9, 12, 16].map((w, wIdx) => (
                                <button
                                  key={`grp-thickness-btn-${w}-${wIdx}`}
                                  type="button"
                                  onClick={() => onUpdateGroup(group.id, { thickness: w })}
                                  className={cn(
                                    "flex-1 py-0.5 rounded text-[9px] font-semibold border transition-all",
                                    (group.thickness || streetLineWidth || 6) === w
                                      ? "bg-primary text-primary-foreground border-primary"
                                      : "bg-background hover:bg-muted text-muted-foreground border-border"
                                  )}
                                >
                                  {w}px
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Toggle visibility of whole group */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          const newVis = !allVisible;
                          (groupStreets || []).forEach(s => {
                            if (s.isVisible !== newVis) onToggleStreetVisibility(s.id);
                          });
                        }}
                        title={allVisible ? "Скрыть все улицы группы на карте" : "Показать все улицы группы"}
                      >
                        {allVisible ? <Eye size={13} /> : <EyeOff size={13} />}
                      </Button>

                      {/* Select all orders of group */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-primary"
                        onClick={() => onSelectOrders(groupOrders.map(o => o.id))}
                        disabled={groupOrders.length === 0}
                        title="Выбрать все заказы группы"
                      >
                        <CheckSquare size={13} />
                      </Button>

                      {/* Create route from group */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-primary"
                        onClick={() => onCreateRouteFromOrders(groupOrders.map(o => o.id))}
                        disabled={groupOrders.length === 0}
                        title="Создать маршрут из заказов этой группы"
                      >
                        <Plus size={13} />
                      </Button>

                      {/* Delete group */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:bg-destructive/10"
                        onClick={() => onDeleteGroup(group.id, false)}
                        title="Удалить группу (улицы останутся в общем списке)"
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>

                  {/* GROUP BODY (LIST OF STREETS) */}
                  {!isCollapsed && (
                    <div className="p-2 space-y-2">
                      {groupStreets.length === 0 ? (
                        <div className="p-3 text-center text-[10.5px] text-muted-foreground bg-muted/10 rounded-lg">
                          В этой группе пока нет улиц.<br />
                          Выберите улицы с помощью чекбоксов или в строке улицы выберите «{group.name}».
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {groupStreets.map((street, sIdx) => {
                            const streetOrders = orders.filter(o => (street.orderIds || []).includes(o.id));
                            const isSelected = selectedStreetIds.includes(street.id);

                            return (
                              <StreetCardItem
                                key={`group-street-${street.id || 'st'}-${sIdx}`}
                                street={street}
                                orders={orders}
                                streetGroups={streetGroups}
                                isMultiSelectActive={isMultiSelectActive}
                                isSelected={isSelected}
                                onToggleSelect={() => handleToggleStreetSelection(street.id)}
                                onToggleVisibility={() => onToggleStreetVisibility(street.id)}
                                onRemove={() => onRemoveStreetHighlight(street.id)}
                                onAssignGroup={(gid) => onAssignStreetToGroup(street.id, gid)}
                                onSelectOrders={() => onSelectOrders(streetOrders.map(o => o.id))}
                                onCreateRoute={() => onCreateRouteFromOrders(streetOrders.map(o => o.id))}
                                selectedOrderIds={selectedOrderIds}
                                onUpdateStreet={(updates) => onUpdateStreet(street.id, updates)}
                                globalLineWidth={streetLineWidth}
                                globalLineOpacity={streetLineOpacity}
                              />
                            );
                          })}
                        </div>
                      )}

                      {/* Group Summary Row */}
                      {groupOrders.length > 0 && (
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 px-1 border-t">
                          <span>Всего в группе:</span>
                          <span className="font-semibold text-foreground">
                            {Math.ceil(groupWeight)} кг • {Math.ceil(groupVolume)} м³
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* UNGROUPED STREETS SECTION */}
            {ungroupedStreets.length > 0 && (
              <div className="rounded-xl border bg-card/60 shadow-sm overflow-hidden">
                <div className="p-2.5 bg-muted/20 flex items-center justify-between border-b">
                  <div className="flex items-center gap-1.5">
                    <Folder size={13} className="text-muted-foreground" />
                    <h5 className="text-xs font-semibold text-foreground">
                      {streetGroups.length > 0 ? `Улицы без группы (${ungroupedStreets.length})` : `Все улицы (${ungroupedStreets.length})`}
                    </h5>
                  </div>

                  {streetGroups.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px] px-2 text-primary hover:bg-primary/10"
                      onClick={() => {
                        setSelectedStreetIds(ungroupedStreets.map(s => s.id));
                        setIsCreatingGroup(true);
                      }}
                    >
                      + Создать группу из них
                    </Button>
                  )}
                </div>

                <div className="p-2 space-y-1.5">
                  {ungroupedStreets.map((street, sIdx) => {
                    const streetOrders = orders.filter(o => (street.orderIds || []).includes(o.id));
                    const isSelected = selectedStreetIds.includes(street.id);

                    return (
                      <StreetCardItem
                        key={`ungrouped-street-${street.id || 'st'}-${sIdx}`}
                        street={street}
                        orders={orders}
                        streetGroups={streetGroups}
                        isMultiSelectActive={isMultiSelectActive}
                        isSelected={isSelected}
                        onToggleSelect={() => handleToggleStreetSelection(street.id)}
                        onToggleVisibility={() => onToggleStreetVisibility(street.id)}
                        onRemove={() => onRemoveStreetHighlight(street.id)}
                        onAssignGroup={(gid) => onAssignStreetToGroup(street.id, gid)}
                        onSelectOrders={() => onSelectOrders(streetOrders.map(o => o.id))}
                        onCreateRoute={() => onCreateRouteFromOrders(streetOrders.map(o => o.id))}
                        selectedOrderIds={selectedOrderIds}
                        onUpdateStreet={(updates) => onUpdateStreet(street.id, updates)}
                        globalLineWidth={streetLineWidth}
                        globalLineOpacity={streetLineOpacity}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Global actions when multiple streets highlighted */}
        {streetHighlights.length > 0 && (
          <div className="p-3 bg-muted/30 border rounded-xl space-y-2 mt-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-muted-foreground">Всего на выделенных улицах:</span>
              <span className="font-bold text-primary">{allHighlightedOrderIds.length} зак.</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 h-8 text-xs font-semibold gap-1.5"
                onClick={() => onSelectOrders(allHighlightedOrderIds)}
                disabled={allHighlightedOrderIds.length === 0}
              >
                <CheckSquare size={13} />
                <span>Выбрать все заказы</span>
              </Button>
              <Button
                size="sm"
                className="flex-1 h-8 text-xs font-semibold gap-1.5"
                onClick={() => onCreateRouteFromOrders(allHighlightedOrderIds)}
                disabled={allHighlightedOrderIds.length === 0}
              >
                <Sparkles size={13} />
                <span>Создать маршрут</span>
              </Button>
            </div>

            <div className="pt-1 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-[10px] text-destructive hover:bg-destructive/10"
                onClick={onClearAllStreets}
              >
                Очистить все выделения
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface StreetCardItemProps {
  street: StreetHighlight;
  orders: Order[];
  streetGroups: StreetGroup[];
  isMultiSelectActive: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onToggleVisibility: () => void;
  onRemove: () => void;
  onAssignGroup: (groupId?: string) => void;
  onSelectOrders: () => void;
  onCreateRoute: () => void;
  selectedOrderIds: string[];
  onUpdateStreet?: (updates: Partial<StreetHighlight>) => void;
  globalLineWidth?: number;
  globalLineOpacity?: number;
}

const StreetCardItem: React.FC<StreetCardItemProps> = ({
  street,
  orders,
  streetGroups,
  isMultiSelectActive,
  isSelected,
  onToggleSelect,
  onToggleVisibility,
  onRemove,
  onAssignGroup,
  onSelectOrders,
  onCreateRoute,
  selectedOrderIds,
  onUpdateStreet,
  globalLineWidth = 6,
  globalLineOpacity = 0.9,
}) => {
  const [isCustomStyleOpen, setIsCustomStyleOpen] = useState(false);
  const streetOrders = orders.filter(o => (street.orderIds || []).includes(o.id));
  const isOrdersSelected = streetOrders.length > 0 && streetOrders.every(o => selectedOrderIds.includes(o.id));
  const weight = streetOrders.reduce((sum, o) => sum + o.weight, 0);
  const volume = streetOrders.reduce((sum, o) => sum + o.volume, 0);
  const effectiveWidth = street.thickness || globalLineWidth;
  const effectiveOpacity = street.opacity !== undefined ? street.opacity : globalLineOpacity;

  return (
    <div
      className={cn(
        "p-2.5 rounded-lg border bg-card hover:border-primary/40 transition-all space-y-1.5 shadow-2xs group",
        street.isVisible === false && "opacity-60 bg-muted/20",
        isSelected && "border-primary/60 bg-primary/5 ring-1 ring-primary/30"
      )}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex items-start gap-2 min-w-0">
          {/* Checkbox for multi-selection */}
          {isMultiSelectActive && (
            <button
              onClick={onToggleSelect}
              className="mt-0.5 text-primary hover:opacity-80 shrink-0"
            >
              {isSelected ? <CheckSquare size={14} className="text-primary" /> : <Square size={14} className="text-muted-foreground" />}
            </button>
          )}

          {/* Color Indicator */}
          <div
            className="w-3 h-3 rounded-full mt-0.5 shrink-0 shadow-xs ring-1 ring-border"
            style={{ backgroundColor: street.color }}
          />

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h6 className="text-[11.5px] font-bold truncate text-foreground" title={street.name}>
                {street.name}
              </h6>
              {street.thickness !== undefined && (
                <span className="text-[8.5px] px-1 py-0.2 rounded bg-primary/10 text-primary font-bold">
                  {street.thickness}px
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[9.5px] text-muted-foreground mt-0.5">
              <span className={cn(
                "px-1 py-0.2 rounded font-medium",
                street.source === 'name' && "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                street.source === 'click' && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                street.source === 'brush' && "bg-purple-500/10 text-purple-600 dark:text-purple-400"
              )}>
                {street.source === 'name' ? '🔤 Название' : street.source === 'click' ? '👆 Клик' : '🖌️ Кисть'}
              </span>
              <span>•</span>
              <span>{streetOrders.length} зак.</span>
              <span>•</span>
              <span>{Math.ceil(weight)} кг</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {/* Per-line style trigger */}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-6 w-6 transition-colors",
              isCustomStyleOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground",
              (street.thickness !== undefined || street.opacity !== undefined) && "text-primary"
            )}
            onClick={() => setIsCustomStyleOpen(!isCustomStyleOpen)}
            title={`Настроить толщину и яркость этой конкретной линии (${effectiveWidth}px)`}
          >
            <Sliders size={12} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onToggleVisibility}
            title={street.isVisible !== false ? 'Скрыть подсветку' : 'Показать подсветку'}
          >
            {street.isVisible !== false ? <Eye size={12} /> : <EyeOff size={12} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:bg-destructive/10"
            onClick={onRemove}
            title="Удалить улицу"
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      {/* PER-LINE INDIVIDUAL STYLE EDITOR (COLLAPSIBLE) */}
      {isCustomStyleOpen && (
        <div className="p-2.5 bg-muted/40 rounded-lg border space-y-2 text-[10px] animate-in fade-in zoom-in-95">
          <div className="flex items-center justify-between font-semibold">
            <span className="text-foreground">Стиль этой линии:</span>
            {(street.thickness !== undefined || street.opacity !== undefined) && (
              <button
                type="button"
                onClick={() => onUpdateStreet?.({ thickness: undefined, opacity: undefined })}
                className="text-[9px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors"
                title="Сбросить индивидуальные настройки и использовать общую толщину и яркость"
              >
                <RotateCcw size={9} />
                <span>Сброс к общей</span>
              </button>
            )}
          </div>

          {/* Individual thickness */}
          <div className="space-y-1">
            <div className="flex justify-between items-center text-muted-foreground">
              <span>Толщина:</span>
              <span className="font-bold text-foreground bg-background px-1.5 py-0.2 rounded border text-[9.5px]">
                {street.thickness !== undefined ? `${street.thickness} px (индивид.)` : `${globalLineWidth} px (общая)`}
              </span>
            </div>
            <input
              type="range"
              min="2"
              max="16"
              step="1"
              value={street.thickness ?? globalLineWidth}
              onChange={(e) => onUpdateStreet?.({ thickness: Number(e.target.value) })}
              className="w-full accent-primary h-1 bg-muted rounded cursor-pointer"
            />
            <div className="flex gap-1 pt-0.5">
              {[3, 6, 9, 12, 16].map((w, wIdx) => (
                <button
                  key={`card-w-${w}-${wIdx}`}
                  type="button"
                  onClick={() => onUpdateStreet?.({ thickness: w })}
                  className={cn(
                    "flex-1 py-0.5 rounded text-[9px] font-semibold border transition-all",
                    (street.thickness ?? globalLineWidth) === w
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted text-muted-foreground border-border"
                  )}
                >
                  {w}px
                </button>
              ))}
            </div>
          </div>

          {/* Individual opacity */}
          <div className="space-y-1">
            <div className="flex justify-between items-center text-muted-foreground">
              <span>Яркость / прозрачность:</span>
              <span className="font-bold text-foreground bg-background px-1.5 py-0.2 rounded border text-[9.5px]">
                {Math.round((street.opacity ?? globalLineOpacity) * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.2"
              max="1.0"
              step="0.05"
              value={street.opacity ?? globalLineOpacity}
              onChange={(e) => onUpdateStreet?.({ opacity: Number(e.target.value) })}
              className="w-full accent-primary h-1 bg-muted rounded cursor-pointer"
            />
          </div>

          {/* Individual color */}
          <div className="space-y-1">
            <span className="text-muted-foreground block">Цвет этой линии:</span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {COLOR_PALETTE.map((c, cIdx) => (
                <button
                  key={`card-color-${c}-${cIdx}`}
                  type="button"
                  className={cn(
                    "w-4 h-4 rounded-full transition-transform ring-1 ring-border",
                    street.color === c ? "scale-125 ring-2 ring-foreground" : "hover:scale-110"
                  )}
                  style={{ backgroundColor: c }}
                  onClick={() => onUpdateStreet?.({ color: c })}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Preview of this line */}
          <div className="pt-1 flex items-center justify-between px-2 py-1 bg-background rounded border">
            <span className="text-[9px] text-muted-foreground">Вид на карте:</span>
            <div className="w-28 h-5 flex items-center justify-center">
              <div 
                style={{
                  width: '100%',
                  height: `${Math.max(effectiveWidth, 2)}px`,
                  backgroundColor: street.color,
                  opacity: effectiveOpacity,
                  borderRadius: '9999px',
                  boxShadow: `0 0 ${effectiveWidth * 1.5}px ${street.color}`
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Group selector & Action buttons */}
      <div className="flex items-center gap-1.5 pt-0.5">
        {/* Group Selector Dropdown */}
        <div className="flex-1 min-w-[100px]">
          <select
            value={street.groupId || ''}
            onChange={(e) => onAssignGroup(e.target.value ? e.target.value : undefined)}
            className="w-full h-6 text-[9.5px] rounded border bg-muted/30 px-1.5 text-muted-foreground hover:text-foreground font-medium"
            title="Отнести эту улицу в группу"
          >
            <option value="">Без группы</option>
            {streetGroups.map((g, gIdx) => (
              <option key={`card-group-opt-${g.id || 'grp'}-${gIdx}`} value={g.id}>📁 {g.name}</option>
            ))}
          </select>
        </div>

        <Button
          variant="outline"
          size="sm"
          className={cn("h-6 text-[9.5px] px-2 gap-1", isOrdersSelected && "bg-primary/10 border-primary/30 text-primary")}
          onClick={onSelectOrders}
          disabled={streetOrders.length === 0}
        >
          <CheckSquare size={10} />
          <span>{isOrdersSelected ? 'Выбрано' : 'Заказы'}</span>
        </Button>
        <Button
          size="sm"
          className="h-6 text-[9.5px] px-2 gap-1 bg-primary/90 hover:bg-primary"
          onClick={onCreateRoute}
          disabled={streetOrders.length === 0}
          title="Создать отдельный маршрут из заказов этой улицы"
        >
          <Plus size={10} />
          <span>Маршрут</span>
        </Button>
      </div>
    </div>
  );
};
