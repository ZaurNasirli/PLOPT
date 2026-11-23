import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  X, 
  Plus, 
  Trash2, 
  Users, 
  UserMinus, 
  Lock, 
  Unlock, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle 
} from 'lucide-react';
import { Order, Route } from '../../types';
import { RoutingLimits } from '../../services/routingService';
import { Button, Badge } from '../common/UIComponents';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n/I18nContext';

interface ConstraintsModalProps {
  isOpen: boolean;
  onClose: () => void;
  limits: RoutingLimits;
  setLimits: React.Dispatch<React.SetStateAction<RoutingLimits>>;
  orders: Order[];
  routes: Route[];
}

export const ConstraintsModal: React.FC<ConstraintsModalProps> = ({
  isOpen,
  onClose,
  limits,
  setLimits,
  orders,
  routes
}) => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'together' | 'avoid' | 'locks'>('together');

  // Must Stay Together state
  const [newGroupOrderA, setNewGroupOrderA] = useState('');
  const [newGroupOrderB, setNewGroupOrderB] = useState('');

  // Avoid Together state
  const [avoidOrderA, setAvoidOrderA] = useState('');
  const [avoidOrderB, setAvoidOrderB] = useState('');

  if (!isOpen) return null;

  const uniqueStores = Array.from(new Set(orders.map(o => o.customerName)))
    .map(name => {
      const order = orders.find(o => o.customerName === name)!;
      return { id: order.id, name: String(name), region: order.region };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleAddMustStayTogether = () => {
    if (!newGroupOrderA || !newGroupOrderB || newGroupOrderA === newGroupOrderB) return;
    const existing = limits.mustStayTogether || [];
    
    // Check if either already in a group
    let merged = false;
    const updated = existing.map(group => {
      if (group.includes(newGroupOrderA) || group.includes(newGroupOrderB)) {
        merged = true;
        return Array.from(new Set([...group, newGroupOrderA, newGroupOrderB]));
      }
      return group;
    });

    if (!merged) {
      updated.push([newGroupOrderA, newGroupOrderB]);
    }

    setLimits(prev => ({
      ...prev,
      mustStayTogether: updated
    }));

    setNewGroupOrderA('');
    setNewGroupOrderB('');
  };

  const handleRemoveMustStayGroup = (groupIdx: number) => {
    setLimits(prev => ({
      ...prev,
      mustStayTogether: (prev.mustStayTogether || []).filter((_, i) => i !== groupIdx)
    }));
  };

  const handleAddAvoidTogether = () => {
    if (!avoidOrderA || !avoidOrderB || avoidOrderA === avoidOrderB) return;
    const existing = limits.mustNotStayTogether || [];
    // Check duplicate
    const isDup = existing.some(([a, b]) => 
      (a === avoidOrderA && b === avoidOrderB) || (a === avoidOrderB && b === avoidOrderA)
    );
    if (!isDup) {
      setLimits(prev => ({
        ...prev,
        mustNotStayTogether: [...existing, [avoidOrderA, avoidOrderB]]
      }));
    }
    setAvoidOrderA('');
    setAvoidOrderB('');
  };

  const handleRemoveAvoidPair = (pairIdx: number) => {
    setLimits(prev => ({
      ...prev,
      mustNotStayTogether: (prev.mustNotStayTogether || []).filter((_, i) => i !== pairIdx)
    }));
  };

  const handleUnlockStop = (orderId: string) => {
    setLimits(prev => {
      const nextStops = { ...(prev.lockedStops || {}) };
      delete nextStops[orderId];
      return { ...prev, lockedStops: nextStops };
    });
  };

  const handleUnlockRoute = (routeId: string) => {
    setLimits(prev => ({
      ...prev,
      lockedRoutes: (prev.lockedRoutes || []).filter(id => id !== routeId)
    }));
  };

  const getStoreName = (id: string) => {
    const o = orders.find(ord => ord.id === id);
    return o ? `${o.customerName} (${o.region})` : id;
  };

  return (
    <div className="fixed inset-0 z-[3300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 15 }}
        className="bg-card border shadow-2xl rounded-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[85vh] text-card-foreground"
      >
        {/* Header */}
        <div className="p-5 border-b flex items-center justify-between bg-primary/5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/15 text-primary rounded-xl">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">
                Управление ограничениями совместимости и блокировками
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Настройка правил "Must Stay Together", "Avoid Together", а также фиксированных остановок
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Buttons */}
        <div className="flex border-b bg-muted/20 px-6 pt-2">
          {[
            { id: 'together' as const, label: 'Must Stay Together', icon: <Users size={14} />, count: limits.mustStayTogether?.length || 0 },
            { id: 'avoid' as const, label: 'Avoid Together', icon: <UserMinus size={14} />, count: limits.mustNotStayTogether?.length || 0 },
            { id: 'locks' as const, label: 'Фиксированные остановки / Маршруты', icon: <Lock size={14} />, count: (Object.keys(limits.lockedStops || {}).length) + (limits.lockedRoutes?.length || 0) }
          ].map((tab, tabIdx) => (
            <button
              key={`constraints-tab-${tab.id}-${tabIdx}`}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "pb-3 px-4 text-xs font-bold transition-all border-b-2 flex items-center gap-2 cursor-pointer",
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.count > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-primary/15 text-primary font-bold">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto space-y-5 scrollbar-thin">
          {/* MUST STAY TOGETHER */}
          {activeTab === 'together' && (
            <div className="space-y-4">
              <div className="p-3 bg-muted/25 rounded-xl border text-xs text-muted-foreground">
                Магазины из одной группы обязаны доставляться в одном рейсе (на одном транспортном средстве).
              </div>

              {/* Add form */}
              <div className="p-4 rounded-xl border bg-card space-y-3 shadow-2xs">
                <span className="text-xs font-bold text-foreground block">
                  Объединить два магазина в группу:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <select
                    value={newGroupOrderA}
                    onChange={(e) => setNewGroupOrderA(e.target.value)}
                    className="h-9 text-xs rounded-lg border border-input bg-background px-3 font-medium"
                  >
                    <option value="">Выберите магазин А...</option>
                    {uniqueStores.map((s, sIdx) => (
                      <option key={`must-a-${s.id || 's'}-${sIdx}`} value={s.id}>{s.name} ({s.region})</option>
                    ))}
                  </select>

                  <select
                    value={newGroupOrderB}
                    onChange={(e) => setNewGroupOrderB(e.target.value)}
                    className="h-9 text-xs rounded-lg border border-input bg-background px-3 font-medium"
                  >
                    <option value="">Выберите магазин B...</option>
                    {uniqueStores.map((s, sIdx) => (
                      <option key={`must-b-${s.id || 's'}-${sIdx}`} value={s.id}>{s.name} ({s.region})</option>
                    ))}
                  </select>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!newGroupOrderA || !newGroupOrderB || newGroupOrderA === newGroupOrderB}
                  onClick={handleAddMustStayTogether}
                  className="gap-1.5 cursor-pointer text-xs"
                >
                  <Plus size={14} /> Добавить обязательную связку
                </Button>
              </div>

              {/* Existing Groups */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                  Активные связки ({limits.mustStayTogether?.length || 0})
                </span>
                {!limits.mustStayTogether || limits.mustStayTogether.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground italic border rounded-xl bg-muted/10">
                    Нет активных правил "Must Stay Together"
                  </div>
                ) : (
                  limits.mustStayTogether.map((group, idx) => (
                    <div key={`must-stay-${idx}`} className="p-3 rounded-xl border bg-card flex items-center justify-between gap-3 shadow-2xs">
                      <div className="flex flex-wrap gap-1.5 items-center">
                        <Users size={14} className="text-primary mr-1" />
                        {group.map((id, idIdx) => (
                          <span key={`must-stay-item-${id}-${idIdx}`} className="px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20 text-xs font-semibold">
                            {getStoreName(id)}
                          </span>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveMustStayGroup(idx)}
                        className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                        title="Удалить правило"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* AVOID TOGETHER */}
          {activeTab === 'avoid' && (
            <div className="space-y-4">
              <div className="p-3 bg-muted/25 rounded-xl border text-xs text-muted-foreground">
                Указанные пары магазинов НЕ должны попадать в одну машину (конфликтующие заказы).
              </div>

              {/* Add form */}
              <div className="p-4 rounded-xl border bg-card space-y-3 shadow-2xs">
                <span className="text-xs font-bold text-foreground block">
                  Запретить совместную доставку двух магазинов:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <select
                    value={avoidOrderA}
                    onChange={(e) => setAvoidOrderA(e.target.value)}
                    className="h-9 text-xs rounded-lg border border-input bg-background px-3 font-medium"
                  >
                    <option value="">Выберите магазин А...</option>
                    {uniqueStores.map((s, sIdx) => (
                      <option key={`avoid-a-${s.id || 's'}-${sIdx}`} value={s.id}>{s.name} ({s.region})</option>
                    ))}
                  </select>

                  <select
                    value={avoidOrderB}
                    onChange={(e) => setAvoidOrderB(e.target.value)}
                    className="h-9 text-xs rounded-lg border border-input bg-background px-3 font-medium"
                  >
                    <option value="">Выберите магазин B...</option>
                    {uniqueStores.map((s, sIdx) => (
                      <option key={`avoid-b-${s.id || 's'}-${sIdx}`} value={s.id}>{s.name} ({s.region})</option>
                    ))}
                  </select>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!avoidOrderA || !avoidOrderB || avoidOrderA === avoidOrderB}
                  onClick={handleAddAvoidTogether}
                  className="gap-1.5 cursor-pointer text-xs"
                >
                  <Plus size={14} /> Запретить совместную доставку
                </Button>
              </div>

              {/* Existing Avoid Pairs */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
                  Запрещенные пары ({limits.mustNotStayTogether?.length || 0})
                </span>
                {!limits.mustNotStayTogether || limits.mustNotStayTogether.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground italic border rounded-xl bg-muted/10">
                    Нет активных правил "Avoid Together"
                  </div>
                ) : (
                  limits.mustNotStayTogether.map(([a, b], idx) => (
                    <div key={`avoid-${a}-${b}-${idx}`} className="p-3 rounded-xl border bg-card flex items-center justify-between gap-3 shadow-2xs">
                      <div className="flex items-center gap-2 text-xs">
                        <UserMinus size={14} className="text-destructive" />
                        <span className="font-semibold text-foreground">{getStoreName(a)}</span>
                        <span className="text-destructive font-black text-xs">≠</span>
                        <span className="font-semibold text-foreground">{getStoreName(b)}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveAvoidPair(idx)}
                        className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                        title="Удалить ограничение"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* LOCKS (LOCKED STOPS & LOCKED ROUTES) */}
          {activeTab === 'locks' && (
            <div className="space-y-6">
              {/* Locked Stops */}
              <div className="space-y-3">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Lock size={14} className="text-amber-500" />
                  <span>Зафиксированные остановки (Locked Stops)</span>
                </span>
                {(!limits.lockedStops || Object.keys(limits.lockedStops).length === 0) ? (
                  <div className="py-5 text-center text-xs text-muted-foreground italic border rounded-xl bg-muted/10">
                    Нет зафиксированных точек. Закрепить точку можно из модального окна деталей маршрута.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(limits.lockedStops).map(([orderId, routeId], lsIdx) => {
                      const r = routes.find(rt => rt.id === routeId);
                      return (
                        <div key={`locked-stop-${orderId}-${routeId}-${lsIdx}`} className="p-3 rounded-xl border bg-card flex items-center justify-between gap-3">
                          <div className="text-xs">
                            <span className="font-bold text-foreground mr-2">{getStoreName(orderId)}</span>
                            <span className="text-muted-foreground">
                              → закреплен за: <b>{r?.name || routeId}</b>
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-amber-600 hover:text-amber-700 cursor-pointer"
                            onClick={() => handleUnlockStop(orderId)}
                          >
                            <Unlock size={12} className="mr-1" /> Разблокировать
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Locked Routes */}
              <div className="space-y-3 pt-3 border-t">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Lock size={14} className="text-amber-500" />
                  <span>Зафиксированные маршруты (Locked Routes)</span>
                </span>
                {(!limits.lockedRoutes || limits.lockedRoutes.length === 0) ? (
                  <div className="py-5 text-center text-xs text-muted-foreground italic border rounded-xl bg-muted/10">
                    Нет зафиксированных маршрутов. Зафиксировать маршрут можно кликом на значок замка на карточке рейса.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {limits.lockedRoutes.map((routeId, lrIdx) => {
                      const r = routes.find(rt => rt.id === routeId);
                      return (
                        <div key={`locked-route-${routeId}-${lrIdx}`} className="p-3 rounded-xl border bg-card flex items-center justify-between gap-3">
                          <div className="text-xs flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r?.color || '#3b82f6' }} />
                            <span className="font-bold text-foreground">{r?.name || routeId}</span>
                            <span className="text-muted-foreground">({r?.orderIds.length || 0} точек) — иммунитет от изменений</span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-amber-600 hover:text-amber-700 cursor-pointer"
                            onClick={() => handleUnlockRoute(routeId)}
                          >
                            <Unlock size={12} className="mr-1" /> Разблокировать
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
