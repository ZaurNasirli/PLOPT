import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, Trash2, Edit, Calendar as CalendarIcon, Users, Check, X, Search, 
  Truck, Phone, Award, Clock, ArrowLeft, ArrowRight, Shuffle, BarChart3, 
  AlertTriangle, Star, Shield, Briefcase
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Driver, Shift, Route, TruckType } from '../types';
import { useTranslation } from '../i18n/I18nContext';

interface RotaPageProps {
  routes: Route[];
  truckTypes: TruckType[];
  orders: any[];
}

// Initial mock data
const INITIAL_DRIVERS: Driver[] = [
  { id: 'drv-1', name: 'Иван Иванов', phone: '+7 (999) 111-22-33', truckTypeName: 'Газель 1.5т', licensePlate: 'А123БВ77', status: 'active', rating: 4.9, shiftsCount: 24 },
  { id: 'drv-2', name: 'Алексей Смирнов', phone: '+7 (999) 222-33-44', truckTypeName: 'Фургон 3т', licensePlate: 'Е456КХ99', status: 'on-shift', rating: 4.8, shiftsCount: 18 },
  { id: 'drv-3', name: 'Дмитрий Кузнецов', phone: '+7 (999) 333-44-55', truckTypeName: 'Газон 5т', licensePlate: 'О789РМ177', status: 'off-duty', rating: 4.7, shiftsCount: 30 },
  { id: 'drv-4', name: 'Сергей Попов', phone: '+7 (999) 444-55-66', truckTypeName: 'Камаз 10т', licensePlate: 'Т321УХ777', status: 'active', rating: 4.95, shiftsCount: 42 },
  { id: 'drv-5', name: 'Михаил Соколов', phone: '+7 (999) 555-66-77', truckTypeName: 'Камаз 10т', licensePlate: 'М654ОК199', status: 'vacation', rating: 4.6, shiftsCount: 12 },
  { id: 'drv-6', name: 'Владимир Новиков', phone: '+7 (999) 666-77-88', truckTypeName: 'Газель 1.5т', licensePlate: 'К987СР77', status: 'active', rating: 4.85, shiftsCount: 15 },
];

const INITIAL_SHIFTS: Shift[] = [
  { id: 'sh-1', driverId: 'drv-1', date: new Date().toISOString().split('T')[0], type: 'morning' },
  { id: 'sh-2', driverId: 'drv-2', date: new Date().toISOString().split('T')[0], type: 'full-day' },
  { id: 'sh-3', driverId: 'drv-4', date: new Date().toISOString().split('T')[0], type: 'morning' },
];

export const RotaPage: React.FC<RotaPageProps> = ({ routes, truckTypes, orders }) => {
  const { t } = useTranslation();
  // Persistence state
  const [drivers, setDrivers] = useState<Driver[]>(() => {
    const saved = localStorage.getItem('rota_drivers');
    return saved ? JSON.parse(saved) : INITIAL_DRIVERS;
  });

  const [shifts, setShifts] = useState<Shift[]>(() => {
    const saved = localStorage.getItem('rota_shifts');
    return saved ? JSON.parse(saved) : INITIAL_SHIFTS;
  });

  useEffect(() => {
    localStorage.setItem('rota_drivers', JSON.stringify(drivers));
  }, [drivers]);

  useEffect(() => {
    localStorage.setItem('rota_shifts', JSON.stringify(shifts));
  }, [shifts]);

  const [activeTab, setActiveTab] = useState<'calendar' | 'drivers' | 'matching' | 'stats'>('calendar');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Date Navigation State
  const [currentDate, setCurrentDate] = useState(new Date());

  // Modals state
  const [showAddDriverModal, setShowAddDriverModal] = useState(false);
  const [showAddShiftModal, setShowAddShiftModal] = useState(false);
  const [selectedDateStr, setSelectedDateStr] = useState('');
  
  // New Driver Form state
  const [newDriver, setNewDriver] = useState({
    name: '',
    phone: '',
    truckTypeName: 'Газель 1.5т',
    licensePlate: '',
    status: 'active' as Driver['status'],
    rating: 5.0
  });

  // New Shift Form state
  const [newShift, setNewShift] = useState({
    driverId: '',
    type: 'full-day' as Shift['type'],
    routeId: ''
  });

  // Calculate current week dates
  const weekDates = useMemo(() => {
    const currentDay = currentDate.getDay();
    // Adjust so week starts on Monday
    const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
    const monday = new Date(currentDate);
    monday.setDate(currentDate.getDate() + distanceToMonday);

    const dates = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + i);
      dates.push(day);
    }
    return dates;
  }, [currentDate]);

  const changeWeek = (direction: 'next' | 'prev') => {
    const nextDate = new Date(currentDate);
    nextDate.setDate(currentDate.getDate() + (direction === 'next' ? 7 : -7));
    setCurrentDate(nextDate);
  };

  const handleAddDriver = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDriver.name || !newDriver.licensePlate) return;

    const created: Driver = {
      id: `drv-${Date.now()}`,
      name: newDriver.name,
      phone: newDriver.phone || '+7 (999) 000-00-00',
      truckTypeName: newDriver.truckTypeName,
      licensePlate: newDriver.licensePlate.toUpperCase(),
      status: newDriver.status,
      rating: newDriver.rating,
      shiftsCount: 0
    };

    setDrivers(prev => [...prev, created]);
    setShowAddDriverModal(false);
    setNewDriver({
      name: '',
      phone: '',
      truckTypeName: 'Газель 1.5т',
      licensePlate: '',
      status: 'active',
      rating: 5.0
    });
  };

  const handleDeleteDriver = (id: string) => {
    if (confirm('Вы уверены, что хотите удалить водителя? Все его смены также будут удалены.')) {
      setDrivers(prev => prev.filter(d => d.id !== id));
      setShifts(prev => prev.filter(s => s.driverId !== id));
    }
  };

  const handleOpenAddShift = (date: Date) => {
    setSelectedDateStr(date.toISOString().split('T')[0]);
    setShowAddShiftModal(true);
  };

  const handleAddShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShift.driverId) return;

    // Check if shift already exists for this driver and date
    const exists = shifts.some(s => s.driverId === newShift.driverId && s.date === selectedDateStr);
    if (exists) {
      alert('У этого водителя уже запланирована смена на этот день!');
      return;
    }

    const created: Shift = {
      id: `sh-${Date.now()}`,
      driverId: newShift.driverId,
      date: selectedDateStr,
      type: newShift.type,
      routeId: newShift.routeId || undefined
    };

    setShifts(prev => [...prev, created]);
    
    // Update driver shifts count and status dynamically
    setDrivers(prev => prev.map(d => {
      if (d.id === newShift.driverId) {
        return { 
          ...d, 
          shiftsCount: d.shiftsCount + 1,
          status: selectedDateStr === new Date().toISOString().split('T')[0] ? 'on-shift' : d.status
        };
      }
      return d;
    }));

    setShowAddShiftModal(false);
    setNewShift({ driverId: '', type: 'full-day', routeId: '' });
  };

  const handleDeleteShift = (id: string) => {
    const shiftToRemove = shifts.find(s => s.id === id);
    if (!shiftToRemove) return;

    setShifts(prev => prev.filter(s => s.id !== id));
    
    // Decrease shift count
    setDrivers(prev => prev.map(d => {
      if (d.id === shiftToRemove.driverId) {
        return { 
          ...d, 
          shiftsCount: Math.max(0, d.shiftsCount - 1),
          status: d.status === 'on-shift' ? 'active' : d.status
        };
      }
      return d;
    }));
  };

  // Filtered drivers based on search
  const filteredDrivers = useMemo(() => {
    return drivers.filter(d => 
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.truckTypeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.licensePlate.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [drivers, searchQuery]);

  // Statistics calculation
  const statsSummary = useMemo(() => {
    const activeCount = drivers.filter(d => d.status === 'active' || d.status === 'on-shift').length;
    const totalShifts = shifts.length;
    const vehicleTypes = drivers.reduce((acc, d) => {
      acc[d.truckTypeName] = (acc[d.truckTypeName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      activeCount,
      totalDrivers: drivers.length,
      totalShifts,
      vehicleTypes
    };
  }, [drivers, shifts]);

  // Shift type mapping helper
  const shiftTypeLabels = {
    'morning': { label: 'Утро (08:00 - 14:00)', bg: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
    'evening': { label: 'Вечер (14:00 - 20:00)', bg: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
    'full-day': { label: 'Полный день', bg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
    'off-duty': { label: 'Выходной', bg: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300' }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-y-auto p-6 space-y-6">
      
      {/* Upper Brand Ribbon */}
      <div className="flex justify-between items-center border-b pb-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-primary flex items-center gap-2">
            <Users className="w-6 h-6 text-primary animate-pulse" /> {t('rotaTitle')}
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            {t('rotaSubtitle')}
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex bg-muted p-1 rounded-lg border">
          <button 
            className={`px-4 py-2 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'calendar' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('calendar')}
          >
            <CalendarIcon size={14} /> {t('rotaTabCalendar')}
          </button>
          <button 
            className={`px-4 py-2 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'drivers' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('drivers')}
          >
            <Users size={14} /> {t('rotaTabDrivers', { count: drivers.length })}
          </button>
          <button 
            className={`px-4 py-2 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'matching' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('matching')}
          >
            <Shuffle size={14} /> {t('rotaTabMatching')}
          </button>
          <button 
            className={`px-4 py-2 text-xs font-bold rounded-md transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'stats' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('stats')}
          >
            <BarChart3 size={14} /> {t('rotaTabStats')}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1">
        <AnimatePresence mode="wait">
          
          {/* TAB 1: CALENDAR WEEK SCHEDULER */}
          {activeTab === 'calendar' && (
            <motion.div 
              key="calendar"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="space-y-6"
            >
              {/* Date controller bar */}
              <div className="flex items-center justify-between bg-card p-4 rounded-xl border shadow-sm">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={() => changeWeek('prev')}>
                    <ArrowLeft size={16} />
                  </Button>
                  <span className="font-bold text-sm min-w-[200px] text-center">
                    Неделя: {weekDates[0].toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} — {weekDates[6].toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  <Button variant="outline" size="icon" onClick={() => changeWeek('next')}>
                    <ArrowRight size={16} />
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Сегодня: {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
                  <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>Текущая неделя</Button>
                </div>
              </div>

              {/* Grid of Calendar Week Days */}
              <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
                {weekDates.map((date, dateIdx) => {
                  const dateStr = date.toISOString().split('T')[0];
                  const dayShifts = shifts.filter(s => s.date === dateStr);
                  const isToday = new Date().toISOString().split('T')[0] === dateStr;

                  return (
                    <div 
                      key={`rota-day-${dateStr}-${dateIdx}`} 
                      className={`bg-card rounded-xl border p-4 flex flex-col min-h-[300px] shadow-sm transition-all relative ${isToday ? 'ring-2 ring-primary bg-primary/5 border-primary/20' : ''}`}
                    >
                      <div className="flex justify-between items-center border-b pb-2 mb-3">
                        <div>
                          <div className="font-black text-sm uppercase tracking-wide text-primary">
                            {date.toLocaleDateString('ru-RU', { weekday: 'short' })}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                          </div>
                        </div>
                        {isToday && (
                          <span className="bg-primary text-primary-foreground text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider">Сегодня</span>
                        )}
                      </div>

                      {/* Day Shift Cards */}
                      <div className="flex-1 space-y-2 overflow-y-auto max-h-[220px] scrollbar-thin">
                        {dayShifts.length === 0 ? (
                          <div className="text-center py-8 text-muted-foreground/50 text-[10px] italic">Смен не запланировано</div>
                        ) : (
                          dayShifts.map((sh, shIdx) => {
                            const driver = drivers.find(d => d.id === sh.driverId);
                            const shiftInfo = shiftTypeLabels[sh.type] || { label: sh.type, bg: 'bg-muted' };
                            return (
                              <div key={`rota-shift-${sh.id}-${shIdx}`} className="p-2 border rounded-lg bg-background text-[11px] space-y-1 relative group hover:border-destructive transition-colors">
                                <div className="flex justify-between items-start">
                                  <span className="font-bold truncate max-w-[100px]">{driver ? driver.name : 'Неизвестно'}</span>
                                  <button 
                                    className="opacity-0 group-hover:opacity-100 text-destructive hover:bg-destructive/10 p-0.5 rounded transition-opacity"
                                    onClick={() => handleDeleteShift(sh.id)}
                                    title="Удалить смену"
                                  >
                                    <Trash2 size={10} />
                                  </button>
                                </div>
                                <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                                  <Truck size={8} /> <span>{driver ? driver.truckTypeName : '-'}</span>
                                </div>
                                <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                                  <Clock size={8} /> <span>{sh.routeId ? `Рейс: ${sh.routeId}` : 'Резерв'}</span>
                                </div>
                                <span className={`inline-block px-1 py-0.2 rounded text-[8px] font-bold uppercase tracking-wider ${shiftInfo.bg}`}>
                                  {sh.type === 'morning' ? 'Утро' : sh.type === 'evening' ? 'Вечер' : sh.type === 'full-day' ? 'Весь день' : 'Выходной'}
                                </span>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full mt-3 h-8 text-[10px] font-bold gap-1 rounded-lg"
                        onClick={() => handleOpenAddShift(date)}
                      >
                        <Plus size={10} /> Добавить смену
                      </Button>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* TAB 2: DRIVERS MANAGEMENT DATABASE */}
          {activeTab === 'drivers' && (
            <motion.div 
              key="drivers"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="space-y-6"
            >
              {/* Search & Action bar */}
              <div className="flex justify-between items-center gap-4 bg-card p-4 rounded-xl border shadow-sm flex-wrap">
                <div className="relative flex-1 max-w-md min-w-[280px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
                  <Input 
                    placeholder="Поиск по ФИО, авто или госномеру" 
                    className="pl-9" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <Button 
                  onClick={() => setShowAddDriverModal(true)} 
                  className="gap-2 text-xs font-bold rounded-lg px-4"
                >
                  <Plus size={16} /> Добавить водителя
                </Button>
              </div>

              {/* Drivers Card Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {filteredDrivers.length === 0 ? (
                  <div className="col-span-full text-center py-16 bg-card border rounded-2xl">
                    <p className="text-muted-foreground text-sm italic">Ни одного водителя не найдено</p>
                  </div>
                ) : (
                  filteredDrivers.map((driver, dIdx) => (
                    <Card key={`rota-driver-${driver.id}-${dIdx}`} className="p-5 flex flex-col justify-between border hover:shadow-md transition-all relative group overflow-hidden">
                      {/* Driver top badge and rating */}
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="font-black text-base">{driver.name}</h3>
                          <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                            <Phone size={12} /> {driver.phone}
                          </p>
                        </div>
                        <span className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded-full tracking-wider ${
                          driver.status === 'active' ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' :
                          driver.status === 'on-shift' ? 'bg-blue-500/10 text-blue-600 border border-blue-500/20' :
                          driver.status === 'vacation' ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' :
                          'bg-slate-500/10 text-slate-600 border border-slate-500/20'
                        }`}>
                          {driver.status === 'active' ? 'Активен' :
                           driver.status === 'on-shift' ? 'На смене' :
                           driver.status === 'vacation' ? 'В отпуске' : 'Выходной'}
                        </span>
                      </div>

                      {/* Driver vehicle specifics */}
                      <div className="p-3 bg-muted/40 rounded-xl space-y-2 text-xs border mb-4">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground flex items-center gap-1.5"><Truck size={12} /> Транспорт:</span>
                          <span className="font-bold">{driver.truckTypeName}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground flex items-center gap-1.5"><Shield size={12} /> Госномер:</span>
                          <span className="font-mono font-bold tracking-wider">{driver.licensePlate}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground flex items-center gap-1.5"><Briefcase size={12} /> Всего смен:</span>
                          <span className="font-bold">{driver.shiftsCount}</span>
                        </div>
                      </div>

                      {/* Driver Footer actions */}
                      <div className="flex items-center justify-between border-t pt-3">
                        <div className="flex items-center gap-1 text-xs text-amber-500 font-bold">
                          <Star size={14} className="fill-current" /> {driver.rating}
                        </div>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-destructive hover:bg-destructive/10 h-8 px-2"
                          onClick={() => handleDeleteDriver(driver.id)}
                        >
                          <Trash2 size={14} className="mr-1" /> Удалить
                        </Button>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </motion.div>
          )}

          {/* TAB 3: MATCHING ACTIVE ROUTES TO DRIVERS */}
          {activeTab === 'matching' && (
            <motion.div 
              key="matching"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="space-y-6"
            >
              <div className="bg-card p-4 rounded-xl border shadow-sm">
                <h3 className="font-bold text-sm text-primary mb-1 uppercase tracking-wider">Интеллектуальное назначение рейсов</h3>
                <p className="text-xs text-muted-foreground">Сопоставление сгенерированных активных маршрутов с доступными дежурными водителями.</p>
              </div>

              {routes.length === 0 ? (
                <div className="text-center py-16 bg-card border rounded-2xl">
                  <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3 animate-bounce" />
                  <h4 className="font-bold text-base mb-1">Нет активных маршрутов</h4>
                  <p className="text-muted-foreground text-xs max-w-sm mx-auto">
                    Перейдите во вкладку «Маршрутизация», импортируйте данные из Excel и сгенерируйте автоматические маршруты.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  
                  {/* Routes Column */}
                  <div className="space-y-4">
                    <h4 className="font-black text-sm uppercase tracking-wider text-muted-foreground">Активные маршруты ({routes.length})</h4>
                    <div className="space-y-4">
                      {routes.map((route, rIdx) => {
                        const assignedShift = shifts.find(s => s.routeId === route.id && s.date === new Date().toISOString().split('T')[0]);
                        const assignedDriver = assignedShift ? drivers.find(d => d.id === assignedShift.driverId) : null;

                        return (
                          <Card key={`rota-route-${route.id}-${rIdx}`} className="p-4 border shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1.5 h-full" style={{ backgroundColor: route.color }} />
                            <div className="flex justify-between items-start mb-3 pl-2">
                              <div>
                                <h5 className="font-black text-sm">{route.name}</h5>
                                <p className="text-[10px] text-muted-foreground mt-0.5">Расстояние: {route.distance} км • Заказов: {route.orderIds.length}</p>
                              </div>
                              <span className={`px-2 py-0.5 text-[9px] font-bold rounded uppercase ${
                                assignedDriver ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'
                              }`}>
                                {assignedDriver ? 'Водитель назначен' : 'Ожидает назначения'}
                              </span>
                            </div>

                            {assignedDriver ? (
                              <div className="bg-muted/40 p-3 rounded-lg border text-xs flex items-center justify-between pl-2">
                                <div className="flex items-center gap-2">
                                  <div className="p-1.5 bg-primary/10 rounded">
                                    <Truck size={14} className="text-primary" />
                                  </div>
                                  <div>
                                    <div className="font-bold">{assignedDriver.name}</div>
                                    <div className="text-[10px] text-muted-foreground">{assignedDriver.truckTypeName} • {assignedDriver.licensePlate}</div>
                                  </div>
                                </div>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="text-destructive h-7 px-2"
                                  onClick={() => {
                                    if (assignedShift) handleDeleteShift(assignedShift.id);
                                  }}
                                >
                                  Сбросить
                                </Button>
                              </div>
                            ) : (
                              <div className="space-y-2 pl-2">
                                <label className="text-[9px] font-bold uppercase text-muted-foreground">Назначить дежурного водителя:</label>
                                <div className="flex gap-2">
                                  <Select 
                                    className="h-8 text-[11px]"
                                    onChange={(e) => {
                                      const driverId = e.target.value;
                                      if (!driverId) return;

                                      const created: Shift = {
                                        id: `sh-${Date.now()}`,
                                        driverId,
                                        date: new Date().toISOString().split('T')[0],
                                        type: 'full-day',
                                        routeId: route.id
                                      };
                                      setShifts(prev => [...prev, created]);
                                      setDrivers(prev => prev.map(d => d.id === driverId ? { ...d, status: 'on-shift', shiftsCount: d.shiftsCount + 1 } : d));
                                    }}
                                    defaultValue=""
                                  >
                                    <option value="">-- Выберите водителя --</option>
                                    {drivers
                                      .filter(d => d.status !== 'vacation')
                                      .map((d, dIdx) => (
                                        <option key={`assign-d-${d.id}-${dIdx}`} value={d.id}>
                                          {d.name} ({d.truckTypeName})
                                        </option>
                                      ))}
                                  </Select>
                                </div>
                              </div>
                            )}
                          </Card>
                        );
                      })}
                    </div>
                  </div>

                  {/* Drivers On Shift Status */}
                  <div className="space-y-4">
                    <h4 className="font-black text-sm uppercase tracking-wider text-muted-foreground">Доступные дежурные водители ({drivers.filter(d => d.status !== 'vacation').length})</h4>
                    <div className="bg-card border rounded-2xl p-4 space-y-3">
                      {drivers.filter(d => d.status !== 'vacation').map((driver, drvIdx) => {
                        const isAssigned = shifts.some(s => s.driverId === driver.id && s.date === new Date().toISOString().split('T')[0] && s.routeId);
                        return (
                          <div key={`avail-driver-${driver.id}-${drvIdx}`} className="flex justify-between items-center p-3 border rounded-xl hover:bg-muted/30 transition-colors">
                            <div className="flex items-center gap-3">
                              <div className={`w-3 h-3 rounded-full ${isAssigned ? 'bg-blue-500' : 'bg-emerald-500'}`} />
                              <div>
                                <span className="font-bold text-xs">{driver.name}</span>
                                <p className="text-[10px] text-muted-foreground">{driver.truckTypeName} • {driver.licensePlate}</p>
                              </div>
                            </div>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              isAssigned ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300'
                            }`}>
                              {isAssigned ? 'Выполняет рейс' : 'Свободен'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </div>
              )}
            </motion.div>
          )}

          {/* TAB 4: STATISTICS & ANALYTICS */}
          {activeTab === 'stats' && (
            <motion.div 
              key="stats"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
            >
              <Card className="p-6 space-y-2">
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Всего водителей</div>
                <div className="text-4xl font-black text-primary">{statsSummary.totalDrivers}</div>
                <div className="text-[10px] text-muted-foreground">База данных транспортного цеха</div>
              </Card>

              <Card className="p-6 space-y-2">
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Активные & Дежурные</div>
                <div className="text-4xl font-black text-emerald-500">{statsSummary.activeCount}</div>
                <div className="text-[10px] text-muted-foreground">Доступно для планирования сегодня</div>
              </Card>

              <Card className="p-6 space-y-2">
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Запланировано смен</div>
                <div className="text-4xl font-black text-blue-500">{statsSummary.totalShifts}</div>
                <div className="text-[10px] text-muted-foreground">Общее количество рабочих смен</div>
              </Card>

              <Card className="p-6 space-y-2">
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Коэффициент готовности</div>
                <div className="text-4xl font-black text-indigo-500">
                  {drivers.length > 0 ? Math.round((statsSummary.activeCount / drivers.length) * 100) : 0}%
                </div>
                <div className="text-[10px] text-muted-foreground">Процент готового к выезду персонала</div>
              </Card>

              {/* Vehicle types breakdown */}
              <Card className="col-span-1 md:col-span-2 p-6 space-y-4">
                <h4 className="font-bold text-sm text-primary uppercase tracking-wider">Парк автомобилей (по типам)</h4>
                <div className="space-y-3">
                  {Object.entries(statsSummary.vehicleTypes).map(([type, count], vtIdx) => {
                    const pct = Math.round(((count as number) / drivers.length) * 100);
                    return (
                      <div key={`rota-vtype-${type}-${vtIdx}`} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-medium">{type}</span>
                          <span className="text-muted-foreground">{count} шт. ({pct}%)</span>
                        </div>
                        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Rota Guidelines */}
              <Card className="col-span-1 md:col-span-2 p-6 space-y-4">
                <h4 className="font-bold text-sm text-primary uppercase tracking-wider">Инструкции по распределению смен</h4>
                <div className="space-y-3 text-xs text-muted-foreground">
                  <div className="flex gap-2 items-start">
                    <div className="p-1 bg-primary/10 rounded text-primary mt-0.5">✓</div>
                    <p><strong>Минимальный отдых:</strong> Водителю не рекомендуется назначать вечернюю смену и следующую за ней утреннюю смену подряд.</p>
                  </div>
                  <div className="flex gap-2 items-start">
                    <div className="p-1 bg-primary/10 rounded text-primary mt-0.5">✓</div>
                    <p><strong>Соответствие транспорта:</strong> Всегда выбирайте автомобиль, вместимость которого соответствует весовому и объемному лимитам назначенного маршрута.</p>
                  </div>
                  <div className="flex gap-2 items-start">
                    <div className="p-1 bg-primary/10 rounded text-primary mt-0.5">✓</div>
                    <p><strong>Резервные водители:</strong> На каждый день рекомендуется оставлять как минимум одного водителя на Газели в резерве для внезапных срочных заказов.</p>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

        </AnimatePresence>
      </div>

      {/* --- ADD DRIVER MODAL --- */}
      <AnimatePresence>
        {showAddDriverModal && (
          <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border shadow-2xl rounded-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b flex items-center justify-between">
                <h3 className="font-black text-base uppercase tracking-wider">Добавление водителя</h3>
                <Button variant="ghost" size="icon" onClick={() => setShowAddDriverModal(false)}>
                  <X size={18} />
                </Button>
              </div>

              <form onSubmit={handleAddDriver} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">ФИО водителя</label>
                  <Input 
                    placeholder="Например, Петров Петр Петрович"
                    required
                    value={newDriver.name}
                    onChange={(e) => setNewDriver({ ...newDriver, name: e.target.value })}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Номер телефона</label>
                  <Input 
                    placeholder="+7 (999) 000-00-00"
                    value={newDriver.phone}
                    onChange={(e) => setNewDriver({ ...newDriver, phone: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Тип транспорта</label>
                    <Select 
                      value={newDriver.truckTypeName}
                      onChange={(e) => setNewDriver({ ...newDriver, truckTypeName: e.target.value })}
                    >
                      {Array.from(new Set([
                        ...truckTypes.map(t => t.name),
                        'Газель 1.5т',
                        'Фургон 3т',
                        'Газон 5т',
                        'Камаз 10т'
                      ])).map((tName, tIdx) => (
                        <option key={`truck-opt-${tName}-${tIdx}`} value={tName}>{tName}</option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Госномер авто</label>
                    <Input 
                      placeholder="А123БВ77"
                      required
                      value={newDriver.licensePlate}
                      onChange={(e) => setNewDriver({ ...newDriver, licensePlate: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Статус</label>
                    <Select 
                      value={newDriver.status}
                      onChange={(e) => setNewDriver({ ...newDriver, status: e.target.value as any })}
                    >
                      <option value="active">Активен</option>
                      <option value="off-duty">Выходной</option>
                      <option value="vacation">В отпуске</option>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase text-muted-foreground">Рейтинг водителя</label>
                    <Input 
                      type="number" 
                      step="0.05" 
                      min="1" 
                      max="5"
                      value={newDriver.rating}
                      onChange={(e) => setNewDriver({ ...newDriver, rating: parseFloat(e.target.value) })}
                    />
                  </div>
                </div>

                <div className="pt-4 border-t flex gap-3">
                  <Button variant="outline" type="button" className="flex-1" onClick={() => setShowAddDriverModal(false)}>Отмена</Button>
                  <Button type="submit" className="flex-1">Добавить</Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* --- ADD SHIFT MODAL --- */}
      <AnimatePresence>
        {showAddShiftModal && (
          <div className="fixed inset-0 z-[4000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border shadow-2xl rounded-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b flex items-center justify-between">
                <div>
                  <h3 className="font-black text-base uppercase tracking-wider">Планирование смены</h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Дата: {selectedDateStr}</p>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setShowAddShiftModal(false)}>
                  <X size={18} />
                </Button>
              </div>

              <form onSubmit={handleAddShift} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Выберите водителя</label>
                  <Select 
                    required
                    value={newShift.driverId}
                    onChange={(e) => setNewShift({ ...newShift, driverId: e.target.value })}
                  >
                    <option value="">-- Выберите водителя --</option>
                    {drivers.map((d, dIdx) => (
                      <option key={`shift-driver-${d.id}-${dIdx}`} value={d.id}>{d.name} ({d.truckTypeName})</option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Тип смены</label>
                  <Select 
                    value={newShift.type}
                    onChange={(e) => setNewShift({ ...newShift, type: e.target.value as any })}
                  >
                    <option value="morning">Утро (08:00 - 14:00)</option>
                    <option value="evening">Вечер (14:00 - 20:00)</option>
                    <option value="full-day">Полный рабочий день</option>
                    <option value="off-duty">Выходной день</option>
                  </Select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Назначить на рейс (Необязательно)</label>
                  <Select 
                    value={newShift.routeId}
                    onChange={(e) => setNewShift({ ...newShift, routeId: e.target.value })}
                  >
                    <option value="">-- Оставить в резерве / Без рейса --</option>
                    {routes.map((r, rIdx) => (
                      <option key={`shift-route-${r.id}-${rIdx}`} value={r.id}>{r.name} (Заказов: {r.orderIds.length})</option>
                    ))}
                  </Select>
                </div>

                <div className="pt-4 border-t flex gap-3">
                  <Button variant="outline" type="button" className="flex-1" onClick={() => setShowAddShiftModal(false)}>Отмена</Button>
                  <Button type="submit" className="flex-1">Запланировать</Button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};

// Simple helper component Card for pristine visuals
const Card = ({ children, className, ...props }: { children: React.ReactNode, className?: string, [key: string]: any }) => (
  <div className={cn("bg-card text-card-foreground rounded-xl border shadow-sm", className)} {...props}>
    {children}
  </div>
);

const Button = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  className, 
  onClick,
  id,
  disabled,
  title,
  type = 'button'
}: { 
  children: React.ReactNode, 
  variant?: 'primary' | 'outline' | 'ghost' | 'destructive', 
  size?: 'sm' | 'md' | 'lg' | 'icon',
  className?: string,
  onClick?: (e: any) => void,
  id?: string,
  disabled?: boolean,
  title?: string,
  type?: 'button' | 'submit' | 'reset'
}) => {
  const variants = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
    ghost: "hover:bg-accent hover:text-accent-foreground",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90"
  };
  const sizes = {
    sm: "h-8 px-3 text-xs",
    md: "h-10 px-4 py-2",
    lg: "h-12 px-8",
    icon: "h-8 w-8 p-0"
  };
  return (
    <button 
      id={id}
      onClick={onClick}
      disabled={disabled}
      title={title}
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {children}
    </button>
  );
};

const Input = ({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input 
    className={cn(
      "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
);

const Select = ({ children, className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select 
    className={cn(
      "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  >
    {children}
  </select>
);

// Simple cn helper if not imported
function cn(...classes: any[]) {
  return classes.filter(Boolean).join(' ');
}
