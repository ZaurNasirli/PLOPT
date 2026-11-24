/**
 * Proqnoz: real orders of the last weeks → next week's orders per store, openings and closures,
 * the real split of a week between the order days; the result can be sent to Ritm.
 */
import React, { useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, Download, Search, Settings2, Sparkles, Trash2, Upload } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n/I18nContext';
import { useRotaI18n } from '../rota/i18n';
import { ALL_WEEKDAYS } from '../rota/types';
import { scheduleShares } from '../rota/core/rhythm';
import { applyIncoming, directoryStore, findConflicts, findRecord, IncomingStore, resolvedKey } from '../directory/directory';
import { askDirectoryConflicts } from '../directory/ConflictDialog';
import { addDays, analyze, Analysis, fmtDate, Measure, MEASURES, METHODS, mondayOf, StoreStatus } from './engine';
import { autoDetectOrderMapping, buildOrders, missingOrderFields, OrderMapping, OrdersSheet, readOrdersWorkbook, ORDER_FIELDS } from './ordersImport';
import { forecastStore, useForecastState } from './store';
import { generateDemoOrders } from './demo';
import { dmy, exportForecast } from './exportXlsx';
import { ByDayChart, RhythmChart, WeeksChart, WeekPoint } from './components/Charts';
import { MappingDialog } from './components/MappingDialog';
import { TransferDialog } from './components/TransferDialog';
import { StoreDetail } from './components/StoreDetail';
import { StatusBadge } from './components/StatusBadge';
import './forecast.css';

type SortKey = 'forecast' | 'change' | 'code';
const btn = 'h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border text-[13px] font-semibold hover:bg-muted cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

const Tile: React.FC<{ label: string; value: React.ReactNode; hint?: React.ReactNode; title?: string }> = ({ label, value, hint, title }) => (
  <div className="rounded-xl border bg-card px-3.5 py-3 min-w-0" title={title}>
    <div className="text-[12px] text-muted-foreground truncate">{label}</div>
    <div className="text-[22px] font-bold leading-tight tabular-nums mt-0.5">{value}</div>
    {hint && <div className="text-[11.5px] text-muted-foreground mt-0.5">{hint}</div>}
  </div>
);

const Panel: React.FC<{ title: string; text?: React.ReactNode; right?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ title, text, right, className, children }) => (
  <section className={cn('rounded-xl border bg-card p-3.5 min-w-0', className)}>
    <div className="flex items-start gap-2 mb-2">
      <div className="min-w-0 flex-1">
        <h2 className="text-[14px] font-bold">{title}</h2>
        {text && <p className="text-[12px] text-muted-foreground mt-0.5">{text}</p>}
      </div>
      {right}
    </div>
    {children}
  </section>
);

const ForecastPage: React.FC<{ onOpenRitm?: () => void }> = ({ onOpenRitm }) => {
  const { t } = useTranslation();
  const { dayShort, m3, int, pct, num } = useRotaI18n();
  const { data, options, saveError } = useForecastState();
  const [mapping, setMapping] = useState<{ sheet: OrdersSheet; initial: OrderMapping } | null>(null);
  const lastSheet = useRef<OrdersSheet | null>(null);
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [draftOpts, setDraftOpts] = useState(options);
  const [showTransfer, setShowTransfer] = useState(false);
  const [measurePick, setMeasurePick] = useState<Measure | null>(null);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<StoreStatus | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('forecast');
  const [openCode, setOpenCode] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const flash = (text: string, action?: { label: string; run: () => void }) => {
    setToast({ text, action });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), action ? 8000 : 4500);
  };

  const analysis: Analysis | null = useMemo(() => {
    if (!data?.rows.length) return null;
    try { return analyze(data.rows, options); } catch { return null; }
  }, [data, options]);
  const measure: Measure = analysis ? (measurePick && analysis.measures[measurePick] ? measurePick : analysis.mainMeasure) : 'volume';
  const fmt = (m: Measure, v: number) => (m === 'volume' ? m3(v) : int(v));
  const unit = (m: Measure) => t(`fcUnit_${m}`);

  // ------------------------------------------------------------------ import
  const finishImport = async (sheet: OrdersSheet, m: OrderMapping) => {
    const res = buildOrders(sheet, m);
    if (!res.rows.length) { flash(t('fcNoRows')); return; }
    // the store directory decides names / regions / formats when the file disagrees with it
    const seen = new Map<string, IncomingStore>();
    for (const r of res.rows) {
      const s = seen.get(r.code) ?? { code: r.code };
      if (r.name) s.name = r.name;
      if (r.region) s.region = r.region;
      if (r.format) s.format = r.format;
      seen.set(r.code, s);
    }
    const incoming = [...seen.values()];
    const dir = directoryStore.get();
    const conflicts = findConflicts(dir, incoming);
    const newCount = incoming.filter(s => !findRecord(dir, s.code, s.name)).length;
    const resolution = await askDirectoryConflicts(conflicts, `Proqnoz · ${sheet.fileName}`, newCount);
    const resolved = applyIncoming(incoming, resolution);
    const rows = res.rows.map(r => {
      const rec = resolved.get(resolvedKey(r.code, r.name));
      return rec ? { ...r, name: rec.name || r.name, region: rec.region || r.region, format: rec.format || r.format } : r;
    });
    forecastStore.setData({ fileName: sheet.fileName, importedAt: new Date().toISOString(), isDemo: false, rows, headers: res.headers, skipped: res.skipped });
    setMeasurePick(null);
    const sk = res.skipped;
    if (sk.noDate + sk.noCode + sk.noValue + sk.negative > 0) {
      flash(`${t('fcSkipped', sk)}${res.badDateExample ? ` · ${t('fcBadDate', { value: res.badDateExample })}` : ''}`);
    }
  };

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const sheet = readOrdersWorkbook(await file.arrayBuffer(), file.name);
      lastSheet.current = sheet;
      const m = autoDetectOrderMapping(sheet.headers);
      if (missingOrderFields(m).length) setMapping({ sheet, initial: m });
      else await finishImport(sheet, m);
    } catch (e) {
      flash(t('fcReadError', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const loadDemo = () => {
    const start = addDays(mondayOf(fmtDate(new Date())), -28);
    const { rows } = generateDemoOrders({ start, weeks: 4, stores: 140, openingsPerWeek: 2, closures: 3 });
    forecastStore.setData({ fileName: t('fcDemoName'), importedAt: new Date().toISOString(), isDemo: true, rows, headers: {}, skipped: { noDate: 0, noCode: 0, noValue: 0, negative: 0 } });
    setMeasurePick(null);
  };

  // ------------------------------------------------------------------ derived views
  const weekData: WeekPoint[] = useMemo(() => {
    if (!analysis) return [];
    const pts: WeekPoint[] = analysis.weeks.map(w => ({
      label: dmy(w.start).slice(0, 5), title: `${dmy(w.start)} – ${dmy(addDays(w.start, 6))}`,
      fact: w.totals[measure], forecast: null, err: null, partial: !w.complete,
    }));
    const f = analysis.totals.forecast[measure], lo = analysis.totals.low[measure], hi = analysis.totals.high[measure];
    pts.push({
      label: dmy(analysis.targetWeek).slice(0, 5), title: `${dmy(analysis.targetWeek)} – ${dmy(addDays(analysis.targetWeek, 6))}`,
      fact: null, forecast: f, err: [f - lo, hi - f], partial: false, rangeText: t('fcRange', { low: fmt(measure, lo), high: fmt(measure, hi) }),
    });
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, measure, t]);

  const dayData = useMemo(() => {
    if (!analysis) return [];
    const even = new Array(7).fill(0), rhythm = new Array(7).fill(0);
    for (const s of analysis.stores) {
      if (s.status === 'closed' || !s.orderDays.length) continue;
      const f = s.forecast[measure];
      const sh = scheduleShares(s.profile, s.orderDays, analysis.rhythm.direction);
      for (const d of s.orderDays) { even[d] += f / s.orderDays.length; rhythm[d] += f * sh[d]; }
    }
    return ALL_WEEKDAYS.map((d, i) => ({ label: dayShort(d), even: even[i], rhythm: rhythm[i] })).filter(x => x.even > 0 || x.rhythm > 0);
  }, [analysis, measure, dayShort]);

  const counts = useMemo(() => {
    const c: Record<StoreStatus | 'all', number> = { all: 0, active: 0, new: 0, silent: 0, closed: 0 };
    for (const s of analysis?.stores ?? []) { c.all++; c[s.status]++; }
    return c;
  }, [analysis]);

  const lastIdx = useMemo(() => {
    if (!analysis) return -1;
    for (let i = analysis.weeks.length - 1; i >= 0; i--) if (analysis.weeks[i].complete) return i;
    return -1;
  }, [analysis]);
  const shownWeeks = useMemo(() => (analysis ? analysis.weeks.map((w, i) => ({ w, i })).filter(x => x.w.complete).slice(-4) : []), [analysis]);

  const rows = useMemo(() => {
    if (!analysis) return [];
    const s = q.trim().toLowerCase();
    const list = analysis.stores
      .filter(x => statusFilter === 'all' || x.status === statusFilter)
      .filter(x => !s || x.code.toLowerCase().includes(s) || x.name.toLowerCase().includes(s))
      .map(x => {
        const last = lastIdx >= 0 ? x.weekly[measure][lastIdx] : null;
        const change = last !== null && last > 0 && x.status !== 'closed' ? (x.forecast[measure] - last) / last : null;
        return { x, change };
      });
    if (sort === 'forecast') list.sort((p, r) => r.x.forecast[measure] - p.x.forecast[measure]);
    else if (sort === 'change') list.sort((p, r) => Math.abs(r.change ?? 0) - Math.abs(p.change ?? 0));
    else list.sort((p, r) => p.x.code.localeCompare(r.x.code));
    return list;
  }, [analysis, q, statusFilter, sort, measure, lastIdx]);
  const [limit, setLimit] = useState(200);

  const open = analysis?.stores.find(s => s.code === openCode) ?? null;
  const completeWeeks = analysis ? analysis.weeks.filter(w => w.complete).length : 0;
  const method = analysis?.method;
  const accuracy = analysis && method && analysis.backtest[method] !== null ? Math.max(0, 100 - (analysis.backtest[method] as number)) : null;
  const example = analysis ? scheduleShares(analysis.rhythm.chain, [0, 3], analysis.rhythm.direction) : null;

  // ------------------------------------------------------------------ render
  return (
    <div className="fc-root flex-1 min-w-0 flex flex-col overflow-hidden bg-background">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b bg-card">
        <div className="mr-2 min-w-0">
          <h1 className="text-[17px] font-bold leading-tight">{t('pageForecast')}</h1>
          <div className="text-[12px] text-muted-foreground truncate max-w-[520px]">
            {data && analysis
              ? t('fcFileInfo', { file: data.fileName, from: dmy(analysis.dataStart), to: dmy(analysis.dataEnd), rows: int(analysis.rowCount), stores: int(analysis.stores.length) })
              : t('fcSubtitle')}
          </div>
        </div>
        <span className="ml-auto" />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold cursor-pointer disabled:opacity-50"><Upload size={14} /> {t('fcLoad')}</button>
        {!data && <button type="button" onClick={loadDemo} className={btn}><Sparkles size={14} /> {t('fcDemo')}</button>}
        {analysis && (
          <>
            <button type="button" onClick={() => setShowTransfer(true)} className={btn}><ArrowRightLeft size={14} /> {t('fcToRitm')}</button>
            <button type="button" onClick={() => exportForecast(analysis, t, dayShort, t('fcXlsFile'))} className={btn}><Download size={14} /> {t('fcExport')}</button>
          </>
        )}
        <div className="relative">
          <button type="button" onClick={() => { setDraftOpts(options); setShowSettings(s => !s); }} aria-expanded={showSettings} className={btn}><Settings2 size={14} /> {t('fcSettings')}</button>
          {showSettings && (
            <div className="absolute right-0 top-10 z-[1500] w-80 rounded-xl border bg-popover text-popover-foreground shadow-xl p-3 space-y-2.5">
              {([['closedAfterDays', 'fcClosedAfter', 1, 90], ['newAfterWeeks', 'fcNewAfter', 1, 8]] as const).map(([k, label, min, max]) => (
                <label key={k} className="block">
                  <span className="block text-[12px] text-muted-foreground mb-0.5">{t(label)}</span>
                  <input type="number" min={min} max={max} value={draftOpts[k]} onChange={e => setDraftOpts({ ...draftOpts, [k]: Math.max(min, Math.min(max, Math.round(Number(e.target.value) || min))) })}
                    className="h-9 w-24 px-2 rounded-lg border bg-background text-[13px]" />
                </label>
              ))}
              <div className="flex justify-end">
                <button type="button" onClick={() => { forecastStore.setOptions(draftOpts); setShowSettings(false); }} className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-[12.5px] font-bold cursor-pointer">{t('fcApply')}</button>
              </div>
            </div>
          )}
        </div>
        {data && (
          <button type="button" aria-label={t('fcClear')} title={t('fcClear')} onClick={() => { if (window.confirm(t('fcClearConfirm'))) forecastStore.setData(null); }}
            className="h-9 w-9 inline-flex items-center justify-center rounded-lg border hover:bg-muted hover:text-destructive cursor-pointer"><Trash2 size={14} /></button>
        )}
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }} />
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {!analysis ? (
          <div className="max-w-2xl rounded-xl border bg-card p-5 space-y-2">
            <h2 className="text-[16px] font-bold">{t('fcEmptyTitle')}</h2>
            <p className="text-[13px]">{t('fcEmptyText')}</p>
            <p className="text-[12.5px] text-muted-foreground">{t('fcEmptyHint')}</p>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => fileRef.current?.click()} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground text-[13px] font-semibold cursor-pointer"><Upload size={14} /> {t('fcLoad')}</button>
              <button type="button" onClick={loadDemo} className={btn}><Sparkles size={14} /> {t('fcDemo')}</button>
            </div>
          </div>
        ) : (
          <>
            {(saveError || completeWeeks < 2 || (data && Object.keys(data.headers).length > 0)) && (
              <div className="space-y-1 text-[12px]">
                {completeWeeks < 2 && <p className="text-amber-700 dark:text-amber-300">{t('fcShortData')}</p>}
                {saveError && <p className="text-amber-700 dark:text-amber-300">{t('fcSaveError')}</p>}
                {data && Object.keys(data.headers).length > 0 && (
                  <p className="text-muted-foreground">
                    {t('fcColumnsInfo', { list: ORDER_FIELDS.filter(f => data.headers[f]).map(f => `${t(`fcField_${f}`)} ← «${data.headers[f]}»`).join(' · ') })}
                    {lastSheet.current && (
                      <button type="button" className="ml-2 text-primary font-semibold hover:underline cursor-pointer"
                        onClick={() => lastSheet.current && setMapping({ sheet: lastSheet.current, initial: autoDetectOrderMapping(lastSheet.current.headers) })}>{t('fcChangeColumns')}</button>
                    )}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold">{t('fcWeekOf', { from: dmy(analysis.targetWeek), to: dmy(addDays(analysis.targetWeek, 6)) })}</span>
              <span className="ml-auto text-[12px] text-muted-foreground">{t('fcMeasure')}</span>
              <span className="inline-flex rounded-lg border overflow-hidden" role="group" aria-label={t('fcMeasure')}>
                {MEASURES.filter(m => analysis.measures[m]).map(m => (
                  <button key={m} type="button" aria-pressed={measure === m} onClick={() => setMeasurePick(m)}
                    className={cn('h-8 px-3 text-[12.5px] font-semibold border-r last:border-r-0 cursor-pointer', measure === m ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}>{unit(m)}</button>
                ))}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <Tile label={`${t('fcForecastTotal')}, ${unit(measure)}`} value={fmt(measure, analysis.totals.forecast[measure])}
                hint={t('fcRange', { low: fmt(measure, analysis.totals.low[measure]), high: fmt(measure, analysis.totals.high[measure]) })} />
              <Tile label={t('fcOrdersNext')} value={int(analysis.ordersNext)} hint={t('fcOrdersHint')} />
              <Tile label={t('fcStoresActive')} value={int(counts.active + counts.new + counts.silent)} hint={t('fcStoresHint', { n: counts.silent })} />
              <Tile label={t('fcNewStores')} value={int(analysis.openings.total)}
                hint={analysis.openings.expected === null ? t('fcNewUnknown') : t('fcNewExpected', { exp: num(analysis.openings.expected, 1), low: analysis.openings.low, high: analysis.openings.high })} />
              <Tile label={t('fcClosedStores')} value={int(analysis.closures)} hint={t('fcClosedHint', { days: analysis.options.closedAfterDays })} />
              <Tile label={t('fcAccuracy')} value={accuracy === null ? '—' : pct(accuracy)}
                hint={accuracy === null ? t('fcAccuracyNA') : t('fcAccuracyHint', { method: t(`fcMethod_${method}`) })}
                title={`${t('fcMethodsTitle')}:\n${METHODS.map(mm => `${t(`fcMethod_${mm}`)}: ${analysis.backtest[mm] === null ? '—' : pct(analysis.backtest[mm] as number)}`).join('\n')}`} />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <Panel title={`${t('fcWeeksTitle')}, ${unit(measure)}`} className="xl:col-span-2">
                <WeeksChart data={weekData} fmt={v => fmt(measure, v)} labels={{ fact: t('fcHistory'), forecast: t('fcForecast'), partial: t('fcPartialWeek') }} />
              </Panel>
              <Panel title={t('fcOpeningsTitle')} text={t('fcOpeningsText', { weeks: analysis.options.newAfterWeeks, days: analysis.options.closedAfterDays })}>
                {analysis.openings.perWeek.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2.5 text-[12px]">
                    {analysis.openings.perWeek.map(w => (
                      <span key={w.start} className={cn('rounded-md border px-1.5 py-0.5 tabular-nums', w.partial && 'opacity-60')} title={w.partial ? t('fcPartialWeek') : undefined}>
                        <span className="text-muted-foreground">{dmy(w.start).slice(0, 5)}</span> +{w.count}
                      </span>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3 text-[12.5px]">
                  {(['open', 'closed'] as const).map(kind => {
                    const list = kind === 'open'
                      ? analysis.stores.filter(s => s.openedWeek).sort((x, y) => y.firstDate.localeCompare(x.firstDate))
                      : analysis.stores.filter(s => s.status === 'closed').sort((x, y) => y.lastDate.localeCompare(x.lastDate));
                    return (
                      <div key={kind}>
                        <h3 className="font-semibold mb-1">{kind === 'open' ? t('fcOpenings') : t('fcClosures')} · {list.length}</h3>
                        {!list.length ? <p className="text-muted-foreground">{kind === 'open' ? t('fcNoOpenings') : t('fcNoClosures')}</p> : (
                          <ul className="space-y-0.5 max-h-40 overflow-y-auto pr-1">
                            {list.map(s => (
                              <li key={s.code}>
                                <button type="button" onClick={() => setOpenCode(s.code)} className="w-full text-left flex gap-1.5 hover:bg-muted rounded px-1 cursor-pointer">
                                  <span className="font-semibold">{s.code}</span>
                                  <span className="truncate flex-1">{s.name}</span>
                                  <span className="text-muted-foreground whitespace-nowrap">{kind === 'open' ? t('fcFirstOrder', { date: dmy(s.firstDate) }) : t('fcLastOrder', { date: dmy(s.lastDate) })}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Panel>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <Panel title={`${t('fcByDayTitle')}, ${unit(measure)}`} text={t('fcByDayText')} className="xl:col-span-2">
                <ByDayChart data={dayData} fmt={v => fmt(measure, v)} labels={{ even: t('fcEven'), rhythm: t('fcRhythm') }} />
              </Panel>
              <Panel title={t('fcRhythmTitle')} text={t('fcRhythmText', { dir: t(analysis.rhythm.direction === 'forward' ? 'fcDirForward' : 'fcDirBackward') })}>
                <RhythmChart data={ALL_WEEKDAYS.map((d, i) => ({ label: dayShort(d), share: analysis.rhythm.chain[i] * 100 }))} fmt={v => pct(v)} />
                {example && <p className="text-[12px] text-muted-foreground mt-1">{t('fcRhythmExample', { a: m3(20 * example[0]), b: m3(20 * example[3]) })}</p>}
              </Panel>
            </div>

            <Panel title={t('fcStoresTitle')} right={<span className="text-[12px] text-muted-foreground">{t('fcShownOf', { shown: int(rows.length), total: int(counts.all) })}</span>}>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t('fcSearch')} aria-label={t('fcSearch')} className="h-8 pl-8 pr-2 w-56 rounded-lg border bg-background text-[12.5px]" />
                </div>
                <span className="inline-flex rounded-lg border overflow-hidden" role="group">
                  {(['all', 'active', 'new', 'silent', 'closed'] as const).map(st => (
                    <button key={st} type="button" aria-pressed={statusFilter === st} onClick={() => setStatusFilter(st)}
                      className={cn('h-8 px-2.5 text-[12px] font-semibold border-r last:border-r-0 cursor-pointer whitespace-nowrap', statusFilter === st ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}>
                      {st === 'all' ? t('fcAll') : t(`fcStatus_${st}`)} · {counts[st]}
                    </button>
                  ))}
                </span>
                <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="h-8 px-2 rounded-lg border bg-background text-[12.5px] cursor-pointer ml-auto" aria-label="sort">
                  <option value="forecast">↓ {t('fcColForecast')}</option>
                  <option value="change">↕ {t('fcColChange')}</option>
                  <option value="code">{t('fcColCode')}</option>
                </select>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-[12.5px]">
                  <thead className="text-muted-foreground bg-muted/50">
                    <tr>
                      <th className="text-left px-2.5 py-2">{t('fcColCode')}</th>
                      <th className="text-left px-2">{t('fcColName')}</th>
                      <th className="text-left px-2">{t('fcColRegion')}</th>
                      <th className="text-left px-2">{t('fcColStatus')}</th>
                      <th className="text-left px-2">{t('fcColDays')}</th>
                      {shownWeeks.map(({ w }) => <th key={w.start} className="text-right px-2 whitespace-nowrap">{dmy(w.start).slice(0, 5)}</th>)}
                      <th className="text-right px-2 whitespace-nowrap">{t('fcColForecast')}, {unit(measure)}</th>
                      <th className="text-right px-2 whitespace-nowrap">{t('fcColRange')}</th>
                      <th className="text-right px-2.5 whitespace-nowrap">{t('fcColChange')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, limit).map(({ x, change }) => (
                      <tr key={x.code} onClick={() => setOpenCode(x.code)} className="border-t hover:bg-muted/40 cursor-pointer">
                        <td className="px-2.5 py-1.5 font-semibold whitespace-nowrap">{x.code}</td>
                        <td className="px-2 truncate max-w-56">{x.name}</td>
                        <td className="px-2 text-muted-foreground whitespace-nowrap">{x.region}</td>
                        <td className="px-2"><StatusBadge status={x.status} /></td>
                        <td className="px-2 whitespace-nowrap">{x.orderDays.map(d => dayShort(ALL_WEEKDAYS[d])).join(' ')}</td>
                        {shownWeeks.map(({ w, i }) => { const v = x.weekly[measure][i]; return <td key={w.start} className="px-2 text-right tabular-nums text-muted-foreground">{v === null ? '—' : fmt(measure, v)}</td>; })}
                        <td className="px-2 text-right tabular-nums font-bold" title={x.lowData ? t('fcLowData') : undefined}>{x.status === 'closed' ? '—' : `${x.lowData ? '≈ ' : ''}${fmt(measure, x.forecast[measure])}`}</td>
                        <td className="px-2 text-right tabular-nums text-muted-foreground whitespace-nowrap">{x.status === 'closed' ? '' : `${fmt(measure, x.low[measure])} – ${fmt(measure, x.high[measure])}`}</td>
                        <td className={cn('px-2.5 text-right tabular-nums whitespace-nowrap', change !== null && Math.abs(change) >= 0.2 && 'font-semibold')}>
                          {change === null ? '' : `${change > 0 ? '+' : ''}${pct(change * 100)}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > limit && (
                <button type="button" onClick={() => setLimit(l => l + 300)} className="mt-2 text-[12.5px] font-semibold text-primary hover:underline cursor-pointer">+{Math.min(300, rows.length - limit)}</button>
              )}
            </Panel>
          </>
        )}
      </div>

      {mapping && (
        <MappingDialog sheet={mapping.sheet} initial={mapping.initial} onCancel={() => setMapping(null)}
          onApply={m => { const s = mapping.sheet; setMapping(null); void finishImport(s, m); }} />
      )}
      {showTransfer && analysis && data && (
        <TransferDialog analysis={analysis} fileName={data.fileName} onClose={() => setShowTransfer(false)}
          onDone={r => {
            setShowTransfer(false);
            const parts = [r.volumes ? t('fcToRitmDone', { n: r.volumes }) : '', r.rhythm ? t('fcToRitmDoneRhythm') : ''].filter(Boolean);
            flash(parts.join(' · '), onOpenRitm ? { label: t('fcOpenRitm'), run: onOpenRitm } : undefined);
          }} />
      )}
      {open && analysis && <StoreDetail s={open} a={analysis} measure={measure} fmt={fmt} onClose={() => setOpenCode(null)} />}
      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[3100] bg-foreground text-background text-[13px] font-semibold px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-3 max-w-[90vw]">
          <span>{toast.text}</span>
          {toast.action && <button type="button" onClick={() => { toast.action!.run(); setToast(null); }} className="underline font-bold cursor-pointer whitespace-nowrap">{toast.action.label}</button>}
        </div>
      )}
    </div>
  );
};

export default ForecastPage;
