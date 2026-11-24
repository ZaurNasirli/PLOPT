/**
 * Rota page: shipment-day and party planning for stores.
 * Tabs: Analytics · Kanban · Map · Rules · Scenarios · Report, with filters shared by all of them.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, CalendarRange, FileSpreadsheet, FileText, Layers, Map as MapIcon, Redo2, Scale, Sparkles, Trash2, Undo2, Upload } from 'lucide-react';
import { cn } from '../lib/utils';
import { useRotaI18n } from './i18n';
import { rotaStore, ensureRotaLoaded, useRotaState } from './store/workspace';
import { activeRuleSet, applyFilters, buildStoreViews, dayTotals, distinct, EMPTY_FILTERS, RotaFilters } from './state/views';
import { ALL_WEEKDAYS, RotaDataset, Weekday } from './types';
import { digitsToDays } from './core/names';
import { Btn, IconBtn } from './components/ui';
import { FilterBar } from './components/FilterBar';
import { BalancePanel } from './components/BalancePanel';
import { StoreImportFlow } from './components/StoreImportFlow';
import { generateDemoDataset } from './data/demo';

export type RotaTab = 'analytics' | 'kanban' | 'map' | 'rules' | 'scenarios' | 'report';
export type RotaSkin = 'plopt' | 'logisticpro';

const TAB_ICONS: Record<RotaTab, React.ReactNode> = {
  analytics: <BarChart3 size={15} />,
  kanban: <CalendarRange size={15} />,
  map: <MapIcon size={15} />,
  rules: <Scale size={15} />,
  scenarios: <Layers size={15} />,
  report: <FileText size={15} />,
};
const TABS: RotaTab[] = ['analytics', 'kanban', 'map', 'rules', 'scenarios', 'report'];

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

const RotaModule: React.FC = () => {
  const i18n = useRotaI18n();
  const { t, f, int } = i18n;
  useEffect(() => { ensureRotaLoaded(); }, []);

  const ws = useRotaState(s => s.ws);
  const canUndo = useRotaState(s => s.past.length > 0);
  const canRedo = useRotaState(s => s.future.length > 0);
  const saveState = useRotaState(s => s.saveState);

  const [skin, setSkin] = useState<RotaSkin>(() => readPref('rota_skin', ['plopt', 'logisticpro'] as const, 'plopt'));
  const [tab, setTab] = useState<RotaTab>(() => readPref('rota_tab', TABS, 'analytics'));
  const [filters, setFilters] = useState<RotaFilters>(EMPTY_FILTERS);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => writePref('rota_skin', skin), [skin]);
  useEffect(() => writePref('rota_tab', tab), [tab]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const rules = activeRuleSet(ws);
  const views = useMemo(() => buildStoreViews(ws, rules), [ws, rules]);
  const filtered = useMemo(() => applyFilters(views, filters), [views, filters]);
  const options = useMemo(() => ({
    regions: distinct(views.map(v => v.region)),
    parties: distinct(views.flatMap(v => [v.currentParty, v.party])),
    segments: distinct(views.map(v => v.segment)),
    formats: distinct(views.map(v => v.storeFormat)),
  }), [views]);

  /** Working days from the rules; without rules, the days that have shipments */
  const workingDays: Weekday[] = useMemo(() => {
    const fromRules = rules?.general.workingDays ? digitsToDays(rules.general.workingDays) : [];
    if (fromRules.length) return fromRules;
    const totals = dayTotals(views);
    return ALL_WEEKDAYS.filter(d => totals[d].stores > 0);
  }, [rules, views]);

  // Ctrl+Z / Ctrl+Y (also with the Russian layout), not while typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const isZ = k === 'z' || k === 'я' || e.code === 'KeyZ';
      const isY = k === 'y' || k === 'н' || e.code === 'KeyY';
      if (isZ) { e.preventDefault(); if (e.shiftKey) rotaStore.redo(); else rotaStore.undo(); }
      else if (isY) { e.preventDefault(); rotaStore.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleImport = useCallback((dataset: RotaDataset) => {
    rotaStore.setDataset(dataset);
    setFilters(EMPTY_FILTERS);
    setToast(f(t.importer.imported, { n: int(dataset.stores.length) }));
  }, [f, t, int]);

  const hasData = Boolean(ws.dataset);

  return (
    <div className="rota-root flex-1 min-w-0 flex flex-col overflow-hidden" data-skin={skin}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 border-b border-ink-200 bg-ink-0">
        <div className="min-w-0">
          <h1 className="text-[17px] font-bold text-ink-900 leading-tight">{t.module.title}</h1>
          <div className="text-[12px] text-ink-500 truncate max-w-[340px]">
            {ws.dataset
              ? <>{ws.dataset.isDemo ? t.header.demoName : ws.dataset.name} · {f(t.header.stores, { n: int(ws.dataset.stores.length) })}</>
              : t.module.subtitle}
          </div>
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto" role="tablist" aria-label={t.module.title}>
          {TABS.map(id => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'h-8.5 px-3 inline-flex items-center gap-1.5 rounded-lg text-[13px] font-semibold whitespace-nowrap cursor-pointer transition-colors',
                tab === id ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
              )}
            >
              {TAB_ICONS[id]} {t.module.tabs[id]}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <IconBtn label={t.header.undo} disabled={!canUndo} onClick={() => rotaStore.undo()}><Undo2 size={15} /></IconBtn>
          <IconBtn label={t.header.redo} disabled={!canRedo} onClick={() => rotaStore.redo()}><Redo2 size={15} /></IconBtn>
          <span className="w-px h-6 bg-ink-200 mx-1" />
          <Btn icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>{t.header.importStores}</Btn>
          {!hasData && <Btn icon={<Sparkles size={14} />} variant="ghost" onClick={() => handleImport(generateDemoDataset(t.header.demoName))}>{t.header.loadDemo}</Btn>}
          {hasData && (
            <IconBtn
              label={t.header.clearData}
              className="hover:border-rose-300 hover:text-rose-700"
              onClick={() => { if (window.confirm(t.header.clearConfirm)) rotaStore.clearDataset(); }}
            >
              <Trash2 size={15} />
            </IconBtn>
          )}
          <label className="inline-flex items-center gap-1 text-[12px] text-ink-500 ml-1">
            <span className="hidden xl:inline">{t.header.skin}</span>
            <select
              value={skin}
              onChange={e => setSkin(e.target.value as RotaSkin)}
              aria-label={t.header.skin}
              className="h-8 px-1.5 rounded-lg border border-ink-200 bg-ink-0 text-[12px] font-semibold text-ink-700 cursor-pointer"
            >
              <option value="plopt">{t.header.skinPlopt}</option>
              <option value="logisticpro">{t.header.skinLogisticPro}</option>
            </select>
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) setImportFile(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {hasData && (tab === 'analytics' || tab === 'kanban' || tab === 'map' || tab === 'report') && (
        <FilterBar filters={filters} options={options} shown={filtered.length} total={views.length} onChange={setFilters} />
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto bg-ink-50">
        {!hasData && tab !== 'rules' && tab !== 'scenarios' ? (
          <EmptyState onImport={() => fileRef.current?.click()} onDemo={() => handleImport(generateDemoDataset(t.header.demoName))} />
        ) : tab === 'analytics' ? (
          <BalancePanel totals={dayTotals(filtered)} workingDays={workingDays} showWeight />
        ) : (
          <div className="p-8 text-center text-[13px] text-ink-500">{t.module.tabSoon}</div>
        )}
      </div>

      {/* Footer: save state */}
      <div className="px-4 py-1 border-t border-ink-200 bg-ink-0 text-[11px] text-ink-400 flex items-center gap-3">
        <span>{saveState === 'saving' ? t.header.saving : saveState === 'saved' ? t.header.saved : ''}</span>
        {ws.dataset && <span className="ml-auto">{f(t.header.importedAt, { date: new Date(ws.dataset.importedAt).toLocaleString(t.locale) })}</span>}
      </div>

      {importFile && (
        <StoreImportFlow file={importFile} hasData={hasData} onImport={handleImport} onClose={() => setImportFile(null)} />
      )}

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[3100] bg-night-900 text-white text-[13px] font-semibold px-4 py-2.5 rounded-xl shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
};

const EmptyState: React.FC<{ onImport: () => void; onDemo: () => void }> = ({ onImport, onDemo }) => {
  const { t } = useRotaI18n();
  return (
    <div className="h-full grid place-items-center p-6">
      <div className="max-w-md text-center">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-brand-50 text-brand-700 grid place-items-center mb-4"><FileSpreadsheet size={26} /></div>
        <h2 className="text-[18px] font-bold text-ink-900">{t.empty.title}</h2>
        <p className="text-[13px] text-ink-600 mt-2 leading-relaxed">{t.empty.text}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Btn variant="primary" icon={<Upload size={14} />} onClick={onImport}>{t.empty.importBtn}</Btn>
          <Btn icon={<Sparkles size={14} />} onClick={onDemo}>{t.empty.demoBtn}</Btn>
        </div>
      </div>
    </div>
  );
};

export default RotaModule;
