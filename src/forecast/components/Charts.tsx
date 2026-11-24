/** Proqnoz charts: weeks with the forecast, next week by day (even vs rhythm), chain rhythm. */
import React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ErrorBar, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const AXIS = { fontSize: 11, fill: 'var(--color-muted-foreground)' };
const GRID = 'var(--color-border)';

interface TipRow { name: string; value: string; color: string }
const TipBox: React.FC<{ title: string; rows: TipRow[]; note?: string }> = ({ title, rows, note }) => (
  <div className="rounded-lg border bg-popover text-popover-foreground shadow-lg px-2.5 py-2 text-[12px]">
    <div className="font-semibold mb-1">{title}</div>
    {rows.map(r => (
      <div key={r.name} className="flex items-center gap-1.5 tabular-nums">
        <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: r.color }} />
        <span className="text-muted-foreground">{r.name}</span>
        <span className="ml-auto pl-3 font-semibold">{r.value}</span>
      </div>
    ))}
    {note && <div className="text-muted-foreground mt-1">{note}</div>}
  </div>
);

export interface WeekPoint {
  label: string;
  title: string;
  fact: number | null;
  forecast: number | null;
  /** [below, above] the forecast for the 80% whisker */
  err: [number, number] | null;
  partial: boolean;
  rangeText?: string;
}

export const WeeksChart: React.FC<{ data: WeekPoint[]; fmt: (v: number) => string; labels: { fact: string; forecast: string; partial: string } }> = ({ data, fmt, labels }) => (
  <ResponsiveContainer width="100%" height={240}>
    <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
      <CartesianGrid vertical={false} stroke={GRID} />
      <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
      <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} tickFormatter={v => fmt(Number(v))} />
      <Tooltip
        cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }}
        content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const p = payload[0].payload as WeekPoint;
          const rows: TipRow[] = [];
          if (p.fact !== null) rows.push({ name: labels.fact, value: fmt(p.fact), color: 'var(--fc-s1)' });
          if (p.forecast !== null) rows.push({ name: labels.forecast, value: fmt(p.forecast), color: 'var(--fc-s2)' });
          return <TipBox title={p.title} rows={rows} note={p.partial ? labels.partial : p.rangeText} />;
        }}
      />
      <Legend verticalAlign="top" height={26} iconType="square" itemSorter={null} wrapperStyle={{ fontSize: 12 }} />
      {/* one stack: each week has either the actual or the forecast, so the bar stays centred */}
      <Bar dataKey="fact" name={labels.fact} stackId="w" fill="var(--fc-s1)" radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={false}>
        {data.map((d, i) => <Cell key={i} fillOpacity={d.partial ? 0.38 : 1} />)}
      </Bar>
      <Bar dataKey="forecast" name={labels.forecast} stackId="w" fill="var(--fc-s2)" radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={false}>
        <ErrorBar dataKey="err" width={8} strokeWidth={1.5} stroke="var(--color-foreground)" direction="y" />
      </Bar>
    </BarChart>
  </ResponsiveContainer>
);

export interface DayPoint { label: string; even: number; rhythm: number }

export const ByDayChart: React.FC<{ data: DayPoint[]; fmt: (v: number) => string; labels: { even: string; rhythm: string } }> = ({ data, fmt, labels }) => (
  <ResponsiveContainer width="100%" height={220}>
    <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
      <CartesianGrid vertical={false} stroke={GRID} />
      <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
      <YAxis tick={AXIS} tickLine={false} axisLine={false} width={52} tickFormatter={v => fmt(Number(v))} />
      <Tooltip
        cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }}
        content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const p = payload[0].payload as DayPoint;
          return <TipBox title={p.label} rows={[
            { name: labels.rhythm, value: fmt(p.rhythm), color: 'var(--fc-s1)' },
            { name: labels.even, value: fmt(p.even), color: 'var(--fc-s2)' },
          ]} />;
        }}
      />
      <Legend verticalAlign="top" height={26} iconType="square" itemSorter={null} wrapperStyle={{ fontSize: 12 }} />
      <Bar dataKey="rhythm" name={labels.rhythm} fill="var(--fc-s1)" radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
      <Bar dataKey="even" name={labels.even} fill="var(--fc-s2)" radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
    </BarChart>
  </ResponsiveContainer>
);

export const RhythmChart: React.FC<{ data: Array<{ label: string; share: number }>; fmt: (v: number) => string }> = ({ data, fmt }) => (
  <ResponsiveContainer width="100%" height={150}>
    <BarChart data={data} margin={{ top: 18, right: 4, left: 4, bottom: 0 }}>
      <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
      <YAxis hide domain={[0, 'dataMax']} />
      <Tooltip
        cursor={{ fill: 'var(--color-muted)', opacity: 0.5 }}
        content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const p = payload[0].payload as { label: string; share: number };
          return <TipBox title={p.label} rows={[{ name: '', value: fmt(p.share), color: 'var(--fc-s1)' }]} />;
        }}
      />
      <Bar dataKey="share" fill="var(--fc-s1)" radius={[4, 4, 0, 0]} maxBarSize={30} isAnimationActive={false}
        label={{ position: 'top', fontSize: 10.5, fill: 'var(--color-muted-foreground)', formatter: (v: unknown) => fmt(Number(v)) }} />
    </BarChart>
  </ResponsiveContainer>
);
