import React, { useState, useMemo } from 'react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip 
} from 'recharts';
import { Calendar, TrendingUp, Package, Box, Weight, ChevronRight } from 'lucide-react';
import { Order } from '../../types';
import { useTranslation } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';

interface WeeklyOrdersTrendWidgetProps {
  orders: Order[];
  className?: string;
}

type MetricType = 'orders' | 'volume' | 'weight';
type RangeMode = 'next7' | 'monSun';

// Normalize date to DD.MM.YYYY
const normalizeDate = (val: any): string => {
  if (!val) return '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    return `${String(val.getDate()).padStart(2, '0')}.${String(val.getMonth() + 1).padStart(2, '0')}.${val.getFullYear()}`;
  }
  const str = String(val).trim();
  if (!str || str === '-' || str.toLowerCase() === 'null') return '';

  const dmy = str.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (dmy) {
    return `${String(parseInt(dmy[1], 10)).padStart(2, '0')}.${String(parseInt(dmy[2], 10)).padStart(2, '0')}.${dmy[3]}`;
  }
  const ymd = str.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (ymd) {
    return `${String(parseInt(ymd[3], 10)).padStart(2, '0')}.${String(parseInt(ymd[2], 10)).padStart(2, '0')}.${ymd[1]}`;
  }
  return str;
};

// Parse DD.MM.YYYY into Date
const parseDate = (str: string): Date | null => {
  if (!str) return null;
  const dmy = str.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (dmy) {
    const d = new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
};

const DAY_NAMES_RU = [
  { short: 'Вс', full: 'Воскресенье' }, // 0
  { short: 'Пн', full: 'Понедельник' }, // 1
  { short: 'Вт', full: 'Вторник' },     // 2
  { short: 'Ср', full: 'Среда' },       // 3
  { short: 'Чт', full: 'Четверг' },     // 4
  { short: 'Пт', full: 'Пятница' },     // 5
  { short: 'Сб', full: 'Суббота' }      // 6
];

export const WeeklyOrdersTrendWidget: React.FC<WeeklyOrdersTrendWidgetProps> = ({
  orders = [],
  className
}) => {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<MetricType>('orders');
  const [rangeMode, setRangeMode] = useState<RangeMode>('next7');

  const safeOrders = useMemo(() => orders || [], [orders]);

  // Compute 7 days for the upcoming week
  const weekData = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Check if any orders have dates in the upcoming 7 days from today
    const upcomingEndDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const hasUpcomingDatedOrders = safeOrders.some(o => {
      const d = parseDate(normalizeDate(o.shippingDate));
      return d !== null && d >= today && d < upcomingEndDate;
    });

    // If no orders match the upcoming 7 days from today, find the earliest order date in the dataset
    // or anchor to today so that mock data or schedule days will populate gracefully
    let anchorDate = today;
    if (!hasUpcomingDatedOrders) {
      const validDates = safeOrders
        .map(o => parseDate(normalizeDate(o.shippingDate)))
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime());
      
      // If dataset has dates and none are upcoming, check if we should anchor to dataset's week or today
      if (validDates.length > 0 && validDates[0].getTime() > today.getTime()) {
        anchorDate = validDates[0];
      }
    }

    const daysList: {
      dayIndex: number;
      date: Date;
      dateStr: string;
      isoDay: number; // 1 = Mon ... 7 = Sun
      shortLabel: string;
      fullDayName: string;
      ordersCount: number;
      volume: number;
      weight: number;
      value: number;
    }[] = [];

    // Determine start day
    let startDate: Date;
    if (rangeMode === 'next7') {
      startDate = new Date(anchorDate);
    } else {
      // Mon to Sun starting from Monday of anchor week
      const currentDay = anchorDate.getDay(); // 0 is Sun, 1 is Mon
      const diffToMon = currentDay === 0 ? -6 : 1 - currentDay;
      startDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate() + diffToMon);
    }

    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
      const dateStr = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
      const dayOfWeek = d.getDay(); // 0-6
      const isoDay = dayOfWeek === 0 ? 7 : dayOfWeek; // 1-7
      const dayMeta = DAY_NAMES_RU[dayOfWeek];

      // Match orders for this day:
      // 1. Exact shippingDate match
      // 2. Or if order has no explicit date, check if its schedule days includes isoDay
      // 3. Or if whole dataset has 0 exact calendar matches, allow matching schedule days (o.days)
      const matchedOrders = safeOrders.filter(o => {
        const oDateNorm = normalizeDate(o.shippingDate);
        if (oDateNorm) {
          if (oDateNorm === dateStr) return true;
          // If no orders match the calendar week, also allow schedule days matching for rich visualization
          if (!hasUpcomingDatedOrders && o.days && o.days.includes(isoDay)) return true;
          return false;
        }
        return o.days && o.days.includes(isoDay);
      });

      const ordersCount = matchedOrders.length;
      const volume = matchedOrders.reduce((sum, o) => sum + (o.volume || 0), 0);
      const weight = matchedOrders.reduce((sum, o) => sum + (o.weight || 0), 0);

      let val = ordersCount;
      if (metric === 'volume') val = parseFloat(volume.toFixed(2));
      if (metric === 'weight') val = Math.round(weight);

      daysList.push({
        dayIndex: i,
        date: d,
        dateStr,
        isoDay,
        shortLabel: `${dayMeta.short} ${String(d.getDate()).padStart(2, '0')}`,
        fullDayName: dayMeta.full,
        ordersCount,
        volume: parseFloat(volume.toFixed(2)),
        weight: Math.round(weight),
        value: val
      });
    }

    return daysList;
  }, [safeOrders, rangeMode, metric]);

  // Summary statistics
  const totalOrders = useMemo(() => {
    return weekData.reduce((sum, d) => sum + d.ordersCount, 0);
  }, [weekData]);

  const totalVolume = useMemo(() => {
    return weekData.reduce((sum, d) => sum + d.volume, 0).toFixed(1);
  }, [weekData]);

  const totalWeight = useMemo(() => {
    return Math.round(weekData.reduce((sum, d) => sum + d.weight, 0));
  }, [weekData]);

  const peakDay = useMemo(() => {
    if (weekData.length === 0) return null;
    return [...weekData].sort((a, b) => b.value - a.value)[0];
  }, [weekData]);

  const avgPerDay = useMemo(() => {
    if (weekData.length === 0) return '0';
    const sum = weekData.reduce((s, d) => s + d.value, 0);
    return (sum / weekData.length).toFixed(metric === 'volume' ? 1 : 0);
  }, [weekData, metric]);

  // Date range title (e.g., "23.09 — 29.09")
  const dateRangeLabel = useMemo(() => {
    if (weekData.length < 2) return '';
    const first = weekData[0].dateStr.substring(0, 5);
    const last = weekData[weekData.length - 1].dateStr.substring(0, 5);
    return `${first} — ${last}`;
  }, [weekData]);

  // Metric unit
  const metricUnit = metric === 'orders' ? t('unitPcs') || 'шт' : metric === 'volume' ? t('unitM3') : t('unitKg');

  // Custom Recharts Tooltip
  const renderTooltip = (props: any) => {
    if (!props) return null;
    const { active, payload } = props;
    if (active && Array.isArray(payload) && payload.length > 0 && payload[0]?.payload) {
      const data = payload[0].payload;
      return (
        <div className="bg-popover/95 border border-border backdrop-blur-md px-3 py-2 rounded-lg shadow-xl text-xs space-y-1.5 z-50 pointer-events-none">
          <div className="flex items-center justify-between gap-4 border-b pb-1">
            <span className="font-bold text-foreground">{data.fullDayName}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{data.dateStr}</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-primary font-bold">
              <span className="flex items-center gap-1.5">
                <Package className="w-3 h-3" />
                {t('analyticsMetricOrders') || 'Заказы'}:
              </span>
              <span>{data.ordersCount} {t('unitPcs') || 'шт'}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-muted-foreground text-[10px]">
              <span className="flex items-center gap-1.5">
                <Box className="w-3 h-3 text-blue-500" />
                {t('analyticsMetricVolume') || 'Объем'}:
              </span>
              <span className="font-semibold text-foreground">{data.volume} {t('unitM3')}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-muted-foreground text-[10px]">
              <span className="flex items-center gap-1.5">
                <Weight className="w-3 h-3 text-amber-500" />
                {t('analyticsMetricWeight') || 'Вес'}:
              </span>
              <span className="font-semibold text-foreground">{data.weight} {t('unitKg')}</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={cn("p-3.5 border rounded-xl bg-card space-y-3 shadow-xs", className)}>
      {/* Header with Title and Range Switcher */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <TrendingUp className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-bold leading-tight flex items-center gap-1.5">
              {t('analyticsWeeklyOrdersTitle')}
              <span className="text-[10px] font-normal text-muted-foreground font-mono">
                ({dateRangeLabel})
              </span>
            </h4>
            <p className="text-[10px] text-muted-foreground hidden sm:block">
              {t('analyticsWeeklyOrdersSubtitle')}
            </p>
          </div>
        </div>

        {/* Range mode toggle */}
        <div className="flex items-center bg-muted/50 p-0.5 rounded-md border text-[10px]">
          <button
            type="button"
            onClick={() => setRangeMode('next7')}
            className={cn(
              "px-2 py-0.5 rounded transition-all font-medium cursor-pointer",
              rangeMode === 'next7' 
                ? "bg-card text-foreground shadow-xs font-bold" 
                : "text-muted-foreground hover:text-foreground"
            )}
            title={t('analyticsRangeNext7')}
          >
            {t('analyticsRangeNext7') || '7 дней'}
          </button>
          <button
            type="button"
            onClick={() => setRangeMode('monSun')}
            className={cn(
              "px-2 py-0.5 rounded transition-all font-medium cursor-pointer",
              rangeMode === 'monSun' 
                ? "bg-card text-foreground shadow-xs font-bold" 
                : "text-muted-foreground hover:text-foreground"
            )}
            title={t('analyticsRangeMonSun')}
          >
            {t('analyticsRangeMonSun') || 'Пн-Вс'}
          </button>
        </div>
      </div>

      {/* Metric Selector Pills */}
      <div className="flex items-center justify-between text-[10px] border-b pb-2">
        <span className="text-muted-foreground font-medium uppercase tracking-wider text-[9px]">
          {t('paramMetric') || 'Метрика'}:
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMetric('orders')}
            className={cn(
              "px-2 py-0.5 rounded-md text-[10px] transition-colors cursor-pointer",
              metric === 'orders'
                ? "bg-primary text-primary-foreground font-bold shadow-xs"
                : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {t('analyticsMetricOrders')}
          </button>
          <button
            type="button"
            onClick={() => setMetric('volume')}
            className={cn(
              "px-2 py-0.5 rounded-md text-[10px] transition-colors cursor-pointer",
              metric === 'volume'
                ? "bg-primary text-primary-foreground font-bold shadow-xs"
                : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {t('analyticsMetricVolume')}
          </button>
          <button
            type="button"
            onClick={() => setMetric('weight')}
            className={cn(
              "px-2 py-0.5 rounded-md text-[10px] transition-colors cursor-pointer",
              metric === 'weight'
                ? "bg-primary text-primary-foreground font-bold shadow-xs"
                : "bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground"
            )}
          >
            {t('analyticsMetricWeight')}
          </button>
        </div>
      </div>

      {/* Recharts Line Chart */}
      <div className="w-full h-44 -ml-2 select-none">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={weekData} margin={{ top: 12, right: 10, left: -20, bottom: 4 }}>
            <CartesianGrid 
              strokeDasharray="3 3" 
              vertical={false} 
              stroke="currentColor" 
              className="text-border/40" 
            />
            <XAxis 
              dataKey="shortLabel" 
              tick={{ fontSize: 9, fill: 'currentColor' }}
              tickLine={false}
              axisLine={{ stroke: 'currentColor', className: 'text-border/60' }}
              className="text-muted-foreground font-medium"
            />
            <YAxis 
              allowDecimals={metric === 'volume'}
              tick={{ fontSize: 9, fill: 'currentColor' }}
              tickLine={false}
              axisLine={false}
              className="text-muted-foreground font-medium"
              width={26}
            />
            <Tooltip content={renderTooltip} />
            <Line 
              type="monotone" 
              dataKey="value" 
              name={t('analyticsMetricOrders')}
              stroke="#3b82f6" 
              strokeWidth={2.5}
              dot={{ r: 3.5, fill: '#3b82f6', stroke: '#ffffff', strokeWidth: 1.5 }}
              activeDot={{ r: 6, fill: '#2563eb', stroke: '#ffffff', strokeWidth: 2 }}
              isAnimationActive={true}
              animationDuration={600}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Summary KPI Pills */}
      <div className="grid grid-cols-3 gap-1.5 pt-1 border-t text-[10px]">
        <div className="p-1.5 rounded-lg bg-muted/30 border border-border/40 text-center">
          <span className="text-muted-foreground block text-[9px] uppercase font-semibold">
            {t('analyticsTotalWeek')}
          </span>
          <span className="font-bold text-foreground text-xs mt-0.5 block">
            {metric === 'orders' ? totalOrders : metric === 'volume' ? `${totalVolume} ${t('unitM3')}` : `${totalWeight} ${t('unitKg')}`}
          </span>
        </div>

        <div className="p-1.5 rounded-lg bg-muted/30 border border-border/40 text-center">
          <span className="text-muted-foreground block text-[9px] uppercase font-semibold">
            {t('analyticsPeakDay')}
          </span>
          <span className="font-bold text-amber-600 dark:text-amber-400 text-xs mt-0.5 block truncate">
            {peakDay && peakDay.value > 0 ? `${peakDay.fullDayName.slice(0, 2)} (${peakDay.value})` : '—'}
          </span>
        </div>

        <div className="p-1.5 rounded-lg bg-muted/30 border border-border/40 text-center">
          <span className="text-muted-foreground block text-[9px] uppercase font-semibold">
            {t('analyticsAvgDay')}
          </span>
          <span className="font-bold text-primary text-xs mt-0.5 block">
            {avgPerDay} {metricUnit}
          </span>
        </div>
      </div>
    </div>
  );
};
