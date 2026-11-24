/** "Rules" tab: rule sets, the seven tables, Excel import / export / template and the rules check. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Download, FileDown, FilePlus2, Pencil, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useRotaI18n } from '../../i18n';
import { rotaStore, useRotaState } from '../../store/workspace';
import { Btn, Modal, SeverityDot } from '../ui';
import { SHEET_IDS, SheetId } from '../../rules/schema';
import { emptyRuleSet, newId, PartyRule, RuleSet } from '../../rules/types';
import { buildRulesWorkbook, downloadWorkbook, parseRulesWorkbook, RulesParseResult } from '../../rules/excel';
import { countIssues, RuleIssue, validateRules } from '../../rules/validate';
import { diffRuleSets } from '../../rules/diff';
import { canonicalSpellings, nameKey } from '../../core/names';
import { cellId } from './cells';
import { AlgoTable, GeneralTable, MatrixTable, PartiesTable, SegmentsTable, StoresTable, WeightsTable } from './RuleTables';
import { partyWindowsFromStores } from '../../data/storeImport';
import { safeFileName } from '../../core/download';

/** Copies with fresh ids (so a duplicated set never shares row ids with the original) */
function cloneRuleSet(rs: RuleSet, name: string): RuleSet {
  const now = new Date().toISOString();
  const re = <T extends { id: string }>(l: T[], p: string) => l.map(x => ({ ...x, id: newId(p) }));
  return {
    ...rs, id: newId('rules'), name, createdAt: now, updatedAt: now,
    parties: re(rs.parties, 'party'), segments: re(rs.segments, 'seg'), phases: re(rs.phases, 'phase'), stores: re(rs.stores, 'store'), matrix: re(rs.matrix, 'mx'),
    general: { ...rs.general }, weights: { ...rs.weights },
  };
}

export const RulesTab: React.FC<{ onToast: (s: string) => void }> = ({ onToast }) => {
  const { t, f, lang } = useRotaI18n();
  const ws = useRotaState(s => s.ws);
  const rs = ws.ruleSets.find(r => r.id === ws.activeRuleSetId) ?? null;
  const stores = ws.dataset?.stores ?? null;
  const [sheet, setSheet] = useState<SheetId>('parties');
  const [showCheck, setShowCheck] = useState(false);
  const [showFromStores, setShowFromStores] = useState(false);
  const [imported, setImported] = useState<{ file: string; result: RulesParseResult } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const issues = useMemo(() => validateRules(rs, stores, t), [rs, stores, t]);
  const counts = countIssues(issues);
  const invalid = useMemo(() => new Set(issues.filter(i => i.severity === 'error' && i.rowId && i.field).map(i => `${i.rowId}:${i.field}`)), [issues]);
  const issuesBySheet = useMemo(() => {
    const m: Partial<Record<SheetId, number>> = {};
    for (const i of issues) if (i.severity === 'error') m[i.sheet] = (m[i.sheet] ?? 0) + 1;
    return m;
  }, [issues]);

  // Jump to a cell after switching the sub-tab
  useEffect(() => {
    if (!focus) return;
    const id = requestAnimationFrame(() => {
      const el = document.getElementById(focus) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        el.focus({ preventScroll: true });
        el.classList.add('ring-2', 'ring-rose-400');
        setTimeout(() => el.classList.remove('ring-2', 'ring-rose-400'), 1800);
      }
      setFocus(null);
    });
    return () => cancelAnimationFrame(id);
  }, [focus, sheet]);

  const update = (fn: (r: RuleSet) => RuleSet) => {
    if (!rs) return;
    rotaStore.updateRuleSets(sets => sets.map(s => (s.id === rs.id ? { ...fn(s), updatedAt: new Date().toISOString() } : s)));
  };

  const createSet = () => {
    const created = emptyRuleSet(f(t.rules.sets.defaultName, { n: ws.ruleSets.length + 1 }));
    rotaStore.updateRuleSets(sets => [...sets, created], created.id);
  };

  const onImportFile = async (file: File) => {
    try {
      const result = parseRulesWorkbook(await file.arrayBuffer(), file.name, t);
      if (!result.found.length) { setImportError(t.rules.import.noSheets); return; }
      setImported({ file: file.name, result });
    } catch (e) {
      setImportError(f(t.rules.import.readError, { error: String((e as Error)?.message ?? e) }));
    }
  };

  const goTo = (i: RuleIssue) => {
    setSheet(i.sheet);
    setShowCheck(false);
    if (i.rowId && i.field) setFocus(cellId(i.sheet, i.rowId, i.field));
  };

  const suggestions = useMemo(() => {
    const segs = canonicalSpellings((stores ?? []).map(s => s.segment)).spelling;
    const fmts = canonicalSpellings((stores ?? []).map(s => s.storeFormat)).spelling;
    const regs = canonicalSpellings((stores ?? []).map(s => s.region)).spelling;
    return { segment: [...segs.values()].sort(), format: [...fmts.values()].sort(), region: [...regs.values()].sort() };
  }, [stores]);

  const fileInput = (
    <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
      onChange={e => { const file = e.target.files?.[0]; if (file) void onImportFile(file); e.target.value = ''; }} />
  );
  const templateBtn = (
    <Btn icon={<FileDown size={14} />} onClick={() => downloadWorkbook(buildRulesWorkbook(null, t), `${t.rules.files.template}_${lang}.xlsx`)}>
      {t.rules.actions.template}
    </Btn>
  );

  const modals = (
    <>
      {fileInput}
      {importError && (
        <Modal title={t.rules.actions.importExcel} width="md" onClose={() => setImportError(null)} footer={<Btn onClick={() => setImportError(null)}>{t.common.close}</Btn>}>
          <p className="text-[13px] text-rose-700">{importError}</p>
        </Modal>
      )}
      {imported && (
        <ImportPreview
          file={imported.file}
          result={imported.result}
          current={rs}
          onClose={() => setImported(null)}
          onApply={mode => {
            const next = imported.result.ruleSet;
            if (mode === 'replace' && rs) {
              rotaStore.updateRuleSets(sets => sets.map(s => (s.id === rs.id ? { ...next, id: rs.id, name: rs.name, createdAt: rs.createdAt, updatedAt: new Date().toISOString() } : s)));
            } else {
              rotaStore.updateRuleSets(sets => [...sets, next], next.id);
            }
            setImported(null);
            onToast(t.rules.import.done);
          }}
        />
      )}
    </>
  );

  if (!rs) {
    return (
      <div className="h-full grid place-items-center p-6">
        <div className="max-w-md text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-brand-50 text-brand-700 grid place-items-center mb-4"><ShieldCheck size={26} /></div>
          <h2 className="text-[18px] font-bold text-ink-900">{t.rules.empty.title}</h2>
          <p className="text-[13px] text-ink-600 mt-2 leading-relaxed">{t.rules.empty.text}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Btn variant="primary" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>{t.rules.actions.importExcel}</Btn>
            <Btn icon={<FilePlus2 size={14} />} onClick={createSet}>{t.rules.empty.create}</Btn>
            {templateBtn}
          </div>
        </div>
        {modals}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      {/* Rule set bar */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-ink-600">
          {t.rules.sets.label}
          <select
            value={rs.id}
            onChange={e => rotaStore.setActiveRuleSet(e.target.value)}
            className="h-8.5 px-2 rounded-lg border border-ink-200 bg-ink-0 text-[13px] font-bold text-ink-900 cursor-pointer max-w-64"
            title={t.rules.sets.active}
          >
            {ws.ruleSets.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <Btn size="sm" variant="ghost" icon={<FilePlus2 size={13} />} onClick={createSet}>{t.rules.sets.create}</Btn>
        <Btn size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => {
          const name = window.prompt(t.rules.sets.renamePrompt, rs.name);
          if (name && name.trim()) update(r => ({ ...r, name: name.trim() }));
        }}>{t.rules.sets.rename}</Btn>
        <Btn size="sm" variant="ghost" icon={<Copy size={13} />} onClick={() => {
          const copy = cloneRuleSet(rs, `${rs.name} ${t.rules.sets.copySuffix}`);
          rotaStore.updateRuleSets(sets => [...sets, copy], copy.id);
        }}>{t.rules.sets.duplicate}</Btn>
        <Btn size="sm" variant="ghost" className="hover:text-rose-700" icon={<Trash2 size={13} />} onClick={() => {
          if (window.confirm(f(t.rules.sets.removeConfirm, { name: rs.name }))) rotaStore.updateRuleSets(sets => sets.filter(s => s.id !== rs.id));
        }}>{t.rules.sets.remove}</Btn>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCheck(true)}
            className={cn(
              'h-8.5 px-3 inline-flex items-center gap-1.5 rounded-lg border text-[12.5px] font-bold cursor-pointer',
              counts.errors ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-emerald-300 bg-emerald-50 text-emerald-700'
            )}
          >
            {counts.errors ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
            {counts.errors ? f(t.rules.actions.notReady, { n: counts.errors }) : t.rules.actions.ready}
            {counts.warnings > 0 && <span className="font-semibold text-amber-700">· {f(t.rules.actions.warnings, { n: counts.warnings })}</span>}
          </button>
          <Btn icon={<ShieldCheck size={14} />} onClick={() => setShowCheck(true)}>{t.rules.actions.check}</Btn>
          <Btn icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>{t.rules.actions.importExcel}</Btn>
          <Btn icon={<Download size={14} />} onClick={() => downloadWorkbook(buildRulesWorkbook(rs, t), `${safeFileName(rs.name)}.xlsx`)}>{t.rules.actions.exportExcel}</Btn>
          {templateBtn}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-wrap gap-1 border-b border-ink-200" role="tablist">
        {SHEET_IDS.map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={sheet === id}
            onClick={() => setSheet(id)}
            className={cn(
              'h-9 px-3 -mb-px border-b-2 text-[13px] font-semibold inline-flex items-center gap-1.5 cursor-pointer',
              sheet === id ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-500 hover:text-ink-900'
            )}
          >
            {t.rules.tabs[id]}
            {issuesBySheet[id] ? <span className="px-1.5 rounded-full bg-rose-100 text-rose-700 text-[11px] font-bold">{issuesBySheet[id]}</span> : null}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-ink-500">{t.rules.sheetNotes[sheet]}</p>

      {sheet === 'parties' && <PartiesTable rs={rs} update={update} invalid={invalid} onAddFromStores={() => setShowFromStores(true)} />}
      {sheet === 'segments' && <SegmentsTable rs={rs} update={update} invalid={invalid} suggestions={suggestions} />}
      {sheet === 'general' && <GeneralTable rs={rs} update={update} invalid={invalid} />}
      {sheet === 'weights' && <WeightsTable rs={rs} update={update} invalid={invalid} />}
      {sheet === 'algo' && <AlgoTable rs={rs} update={update} invalid={invalid} />}
      {sheet === 'stores' && <StoresTable rs={rs} update={update} invalid={invalid} storeCodes={(stores ?? []).map(s => s.storeCode)} />}
      {sheet === 'matrix' && <MatrixTable rs={rs} update={update} invalid={invalid} suggestions={suggestions} />}

      {showCheck && <CheckModal issues={issues} onClose={() => setShowCheck(false)} onGoTo={goTo} />}
      {showFromStores && (
        <FromStoresModal
          rs={rs}
          onClose={() => setShowFromStores(false)}
          onAdd={parties => { update(r => ({ ...r, parties: [...r.parties, ...parties] })); setShowFromStores(false); }}
        />
      )}
      {modals}
    </div>
  );
};

// ------------------------------------------------------------------------------------------------

const CheckModal: React.FC<{ issues: RuleIssue[]; onClose: () => void; onGoTo: (i: RuleIssue) => void }> = ({ issues, onClose, onGoTo }) => {
  const { t } = useRotaI18n();
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');
  const Section: React.FC<{ title: string; list: RuleIssue[] }> = ({ title, list }) => (
    <div>
      <h3 className="text-[12.5px] font-bold text-ink-700 mb-1.5">{title} · {list.length}</h3>
      <ul className="rounded-xl border border-ink-200 divide-y divide-ink-100">
        {list.map((i, k) => (
          <li key={k} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
            <SeverityDot severity={i.severity} />
            <span className="text-ink-400 shrink-0 w-32 truncate">{t.rules.tabs[i.sheet]}</span>
            <span className="flex-1 text-ink-800">{i.text}</span>
            <button type="button" className="text-[12px] font-semibold text-brand-700 hover:underline cursor-pointer shrink-0" onClick={() => onGoTo(i)}>{t.rules.validation.goTo} →</button>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <Modal title={t.rules.validation.title} onClose={onClose} footer={<Btn onClick={onClose}>{t.common.close}</Btn>}>
      <div className="space-y-4">
        {errors.length === 0 && (
          <p className="flex items-center gap-2 text-[13px] font-semibold text-emerald-700"><CheckCircle2 size={16} /> {t.rules.validation.ok}</p>
        )}
        {errors.length > 0 && <Section title={t.rules.validation.errors} list={errors} />}
        {warnings.length > 0 && <Section title={t.rules.validation.warnings} list={warnings} />}
      </div>
    </Modal>
  );
};

const ImportPreview: React.FC<{
  file: string;
  result: RulesParseResult;
  current: RuleSet | null;
  onClose: () => void;
  onApply: (mode: 'replace' | 'new') => void;
}> = ({ file, result, current, onClose, onApply }) => {
  const { t, f } = useRotaI18n();
  const diff = useMemo(() => diffRuleSets(current, result.ruleSet, t), [current, result, t]);
  const missing = SHEET_IDS.filter(s => !result.found.includes(s));
  const [open, setOpen] = useState<SheetId | null>(null);
  return (
    <Modal
      title={f(t.rules.import.title, { file })}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>{t.common.cancel}</Btn>
          <Btn onClick={() => onApply('new')}>{t.rules.import.asNew}</Btn>
          {current && <Btn variant="primary" onClick={() => onApply('replace')}>{t.rules.import.replace}</Btn>}
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] text-ink-700">{f(t.rules.import.found, { found: result.found.length, total: SHEET_IDS.length })}</p>
        {missing.length > 0 && <p className="text-[12.5px] text-amber-800">{f(t.rules.import.missingSheets, { list: missing.map(s => t.rules.tabs[s]).join(', ') })}</p>}
        {!current && <p className="text-[12.5px] text-ink-500">{t.rules.import.noCurrent}</p>}
        <div className="rounded-xl border border-ink-200 overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead className="bg-ink-50 text-ink-600">
              <tr>
                <th className="text-left px-3 py-2">{t.rules.import.section}</th>
                <th className="px-2 py-2 text-emerald-700">{t.rules.import.added}</th>
                <th className="px-2 py-2 text-amber-700">{t.rules.import.changed}</th>
                <th className="px-2 py-2 text-rose-700">{t.rules.import.removed}</th>
                <th className="px-2 py-2">{t.rules.import.unchanged}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {diff.map(d => {
                const any = d.added.length + d.changed.length + d.removed.length > 0;
                return (
                  <React.Fragment key={d.section}>
                    <tr className="border-t border-ink-100">
                      <td className="px-3 py-1.5 font-semibold text-ink-800">{t.rules.tabs[d.section]}</td>
                      <td className="text-center tabular-nums">{d.added.length || '—'}</td>
                      <td className="text-center tabular-nums">{d.changed.length || '—'}</td>
                      <td className="text-center tabular-nums">{d.removed.length || '—'}</td>
                      <td className="text-center tabular-nums text-ink-500">{d.unchanged || '—'}</td>
                      <td className="text-right pr-3">
                        {any && (
                          <button type="button" className="text-[12px] font-semibold text-brand-700 hover:underline cursor-pointer" onClick={() => setOpen(open === d.section ? null : d.section)}>
                            {t.rules.import.details}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open === d.section && (
                      <tr>
                        <td colSpan={6} className="px-3 pb-2 text-[12px]">
                          {d.added.length > 0 && <div className="text-emerald-700">+ {d.added.join(' · ')}</div>}
                          {d.changed.length > 0 && <div className="text-amber-700">~ {d.changed.join(' · ')}</div>}
                          {d.removed.length > 0 && <div className="text-rose-700">− {d.removed.join(' · ')}</div>}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {result.problems.length > 0 && (
          <div>
            <h3 className="text-[12.5px] font-bold text-ink-700 mb-1">{t.rules.import.problems}</h3>
            <ul className="text-[12px] text-amber-800 space-y-0.5 list-disc pl-5">{result.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
        )}
      </div>
    </Modal>
  );
};

const FromStoresModal: React.FC<{ rs: RuleSet; onClose: () => void; onAdd: (p: PartyRule[]) => void }> = ({ rs, onClose, onAdd }) => {
  const { t, f } = useRotaI18n();
  const stores = useRotaState(s => s.ws.dataset?.stores ?? null);
  const candidates = useMemo(() => {
    if (!stores) return [];
    const windows = partyWindowsFromStores(stores);
    const have = new Set(rs.parties.map(p => nameKey(p.name)));
    const counts = new Map<string, { name: string; n: number }>();
    for (const s of stores) {
      const k = nameKey(s.party);
      if (!k || have.has(k)) continue;
      const c = counts.get(k) ?? { name: s.party, n: 0 };
      c.n += 1;
      counts.set(k, c);
    }
    return [...counts.entries()].map(([k, c]) => ({ key: k, name: c.name, n: c.n, window: windows.get(k) ?? '' })).sort((a, b) => a.name.localeCompare(b.name));
  }, [stores, rs.parties]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.map(c => c.key)));
  return (
    <Modal
      title={t.rules.fromStores.title}
      width="md"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>{t.common.cancel}</Btn>
          <Btn variant="primary" disabled={picked.size === 0} onClick={() => onAdd(candidates.filter(c => picked.has(c.key)).map(c => ({
            id: newId('party'), code: '', name: c.name, window: c.window, chainOrder: null, fixed: false, truckM3: null, truckKg: null, trucksPerDay: null,
          })))}>{f(t.rules.fromStores.add, { n: picked.size })}</Btn>
        </>
      }
    >
      {!stores ? <p className="text-[13px] text-ink-500">{t.rules.fromStores.noData}</p>
        : candidates.length === 0 ? <p className="text-[13px] text-ink-500">{t.rules.fromStores.none}</p>
        : (
          <>
            <p className="text-[12.5px] text-ink-600 mb-3">{t.rules.fromStores.text}</p>
            <ul className="rounded-xl border border-ink-200 divide-y divide-ink-100">
              {candidates.map(c => (
                <li key={c.key}>
                  <label className="flex items-center gap-3 px-3 py-2 text-[13px] cursor-pointer">
                    <input type="checkbox" className="accent-brand-600" checked={picked.has(c.key)}
                      onChange={() => setPicked(p => { const n = new Set(p); if (n.has(c.key)) n.delete(c.key); else n.add(c.key); return n; })} />
                    <span className="font-semibold text-ink-900 flex-1">{c.name}</span>
                    <span className="font-mono text-ink-600">{c.window || '—'}</span>
                    <span className="text-ink-400 text-[12px] w-16 text-right">{f(t.rules.fromStores.stores, { n: c.n })}</span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
    </Modal>
  );
};
