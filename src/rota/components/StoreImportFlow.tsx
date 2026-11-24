import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { useRotaI18n } from '../i18n';
import { Btn, Modal, SeverityDot } from './ui';
import { cn } from '../../lib/utils';
import {
  autoDetectMapping, buildStores, columnLetter, missingRequired, RawSheet, readStoreWorkbook, REQUIRED_FIELDS,
  STORE_FIELDS, StoreField, StoreImportResult, StoreMapping,
} from '../data/storeImport';
import type { ImportIssue, RotaDataset, VolumeMode } from '../types';

type Step =
  | { kind: 'reading' }
  | { kind: 'mapping'; sheet: RawSheet; mapping: StoreMapping; mode: VolumeMode }
  | { kind: 'check'; sheet: RawSheet; mapping: StoreMapping; mode: VolumeMode; result: StoreImportResult }
  | { kind: 'error'; message: string };

/** Store file: read → (column mapping if something is not recognised) → check → import */
export const StoreImportFlow: React.FC<{
  file: File;
  hasData: boolean;
  onImport: (dataset: RotaDataset) => void;
  onClose: () => void;
}> = ({ file, hasData, onImport, onClose }) => {
  const { t, f } = useRotaI18n();
  const [step, setStep] = useState<Step>({ kind: 'reading' });

  useEffect(() => {
    let cancelled = false;
    file.arrayBuffer()
      .then(buf => {
        if (cancelled) return;
        const sheet = readStoreWorkbook(buf, file.name);
        if (!sheet.rows.length) { setStep({ kind: 'error', message: t.importer.noRows }); return; }
        const mapping = autoDetectMapping(sheet.headers);
        const mode: VolumeMode = 'weekly';
        if (missingRequired(mapping).length) setStep({ kind: 'mapping', sheet, mapping, mode });
        else setStep({ kind: 'check', sheet, mapping, mode, result: buildStores(sheet, mapping, mode) });
      })
      .catch(e => { if (!cancelled) setStep({ kind: 'error', message: f(t.importer.readError, { error: String((e as Error)?.message ?? e) }) }); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  if (step.kind === 'reading') {
    return (
      <Modal title={t.importer.reading} onClose={onClose} width="md">
        <div className="py-6 text-center text-ink-500 text-[13px]">{t.common.loading}</div>
      </Modal>
    );
  }
  if (step.kind === 'error') {
    return (
      <Modal title={t.importer.validationTitle} onClose={onClose} width="md" footer={<Btn onClick={onClose}>{t.common.close}</Btn>}>
        <p className="text-[13px] text-rose-700">{step.message}</p>
      </Modal>
    );
  }
  if (step.kind === 'mapping') {
    return (
      <MappingModal
        sheet={step.sheet}
        mapping={step.mapping}
        mode={step.mode}
        onClose={onClose}
        onConfirm={(mapping, mode) => setStep({ kind: 'check', sheet: step.sheet, mapping, mode, result: buildStores(step.sheet, mapping, mode) })}
      />
    );
  }
  return (
    <CheckModal
      result={step.result}
      fileName={file.name}
      hasData={hasData}
      onClose={onClose}
      onRemap={() => setStep({ kind: 'mapping', sheet: step.sheet, mapping: step.mapping, mode: step.mode })}
      onImport={() => {
        onImport({ name: file.name, importedAt: new Date().toISOString(), volumeMode: step.mode, stores: step.result.stores, headers: step.result.headers });
        onClose();
      }}
    />
  );
};

const MappingModal: React.FC<{
  sheet: RawSheet;
  mapping: StoreMapping;
  mode: VolumeMode;
  onClose: () => void;
  onConfirm: (m: StoreMapping, mode: VolumeMode) => void;
}> = ({ sheet, mapping: initial, mode: initialMode, onClose, onConfirm }) => {
  const { t, f } = useRotaI18n();
  const [mapping, setMapping] = useState(initial);
  const [mode, setMode] = useState(initialMode);
  const missing = missingRequired(mapping);
  const label = (fld: StoreField) => t.importer.fields[fld];
  const sample = (idx: number) => {
    const v = sheet.rows.find(r => String(r[idx] ?? '').trim() !== '')?.[idx];
    return v === undefined ? '' : String(v).slice(0, 24);
  };
  return (
    <Modal
      title={<span className="inline-flex items-center gap-2"><FileSpreadsheet size={17} /> {t.importer.mappingTitle}</span>}
      onClose={onClose}
      footer={
        <>
          {missing.length > 0 && <span className="mr-auto text-[12px] text-rose-700">{f(t.importer.missingRequired, { fields: missing.map(label).join(', ') })}</span>}
          <Btn onClick={onClose}>{t.common.cancel}</Btn>
          <Btn variant="primary" disabled={missing.length > 0} onClick={() => onConfirm(mapping, mode)}>{t.importer.continue}</Btn>
        </>
      }
    >
      <p className="text-[13px] text-ink-600 mb-3">{t.importer.mappingDesc}</p>
      <div className="grid sm:grid-cols-2 gap-x-5 gap-y-2.5">
        {STORE_FIELDS.map(fld => {
          const req = REQUIRED_FIELDS.includes(fld);
          const id = `rota-map-${fld}`;
          return (
            <div key={fld} className="min-w-0">
              <label htmlFor={id} className="block text-[12px] font-semibold text-ink-700 mb-0.5">
                {label(fld)}{req && <span className="text-rose-600"> *</span>}
              </label>
              <select
                id={id}
                value={mapping[fld]}
                onChange={e => setMapping(m => ({ ...m, [fld]: Number(e.target.value) }))}
                className={cn('w-full h-8 px-2 rounded-lg border bg-ink-0 text-[12.5px] text-ink-900', req && mapping[fld] < 0 ? 'border-rose-400' : 'border-ink-200')}
              >
                <option value={-1}>{t.importer.notMapped}</option>
                {sheet.headers.map((h, i) => (
                  <option key={i} value={i}>{columnLetter(i)} · {h || '—'}{sample(i) ? `  (${sample(i)})` : ''}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <fieldset className="mt-4 border border-ink-200 rounded-xl p-3">
        <legend className="px-1 text-[12px] font-bold text-ink-700">{t.importer.volumeMode}</legend>
        {(['weekly', 'per_delivery'] as VolumeMode[]).map(m => (
          <label key={m} className="flex items-center gap-2 py-0.5 text-[12.5px] text-ink-800 cursor-pointer">
            <input type="radio" name="rota-volume-mode" className="accent-brand-600" checked={mode === m} onChange={() => setMode(m)} />
            {m === 'weekly' ? t.importer.volumeModeWeekly : t.importer.volumeModePerDelivery}
          </label>
        ))}
      </fieldset>
    </Modal>
  );
};

const CheckModal: React.FC<{
  result: StoreImportResult;
  fileName: string;
  hasData: boolean;
  onClose: () => void;
  onRemap: () => void;
  onImport: () => void;
}> = ({ result, fileName, hasData, onClose, onRemap, onImport }) => {
  const { t, f, int } = useRotaI18n();
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of result.issues) counts[i.severity] += 1;

  // group issues by severity + code
  const groups = useMemo(() => {
    const m = new Map<string, ImportIssue[]>();
    for (const i of result.issues) {
      const k = `${i.severity}:${i.code}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    const order = { error: 0, warning: 1, info: 2 };
    return [...m.entries()].sort((a, b) => order[a[1][0].severity] - order[b[1][0].severity]);
  }, [result.issues]);

  const issueText = (i: ImportIssue) => f((t.importIssues as Record<string, string>)[i.code] ?? i.code, i.params);

  return (
    <Modal
      title={<span className="inline-flex items-center gap-2"><FileSpreadsheet size={17} /> {t.importer.validationTitle} · <span className="text-ink-500 font-semibold">{fileName}</span></span>}
      onClose={onClose}
      footer={
        <>
          <Btn className="mr-auto" variant="ghost" onClick={onRemap}>{t.importer.remap}</Btn>
          <Btn onClick={onClose}>{t.common.cancel}</Btn>
          <Btn variant="primary" disabled={result.stores.length === 0} onClick={onImport}>{f(t.importer.importN, { n: int(result.stores.length) })}</Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        {[
          { l: t.importer.rows, v: int(result.totalRows), c: 'text-ink-900' },
          { l: t.importer.storesOk, v: int(result.stores.length), c: 'text-emerald-700' },
          { l: t.importer.errors, v: int(counts.error), c: counts.error ? 'text-rose-700' : 'text-ink-400' },
          { l: t.importer.warnings, v: int(counts.warning), c: counts.warning ? 'text-amber-700' : 'text-ink-400' },
          { l: t.importer.infos, v: int(counts.info), c: counts.info ? 'text-sky-700' : 'text-ink-400' },
        ].map(k => (
          <div key={k.l} className="rounded-xl border border-ink-200 bg-ink-50 px-3 py-2">
            <div className={cn('text-[20px] font-bold tabular-nums', k.c)}>{k.v}</div>
            <div className="text-[11.5px] text-ink-500">{k.l}</div>
          </div>
        ))}
      </div>
      {counts.error > 0 && <p className="text-[12.5px] text-rose-700 mb-2">{t.importer.rowsSkipped}</p>}
      {hasData && (
        <p className="flex items-start gap-1.5 text-[12.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 mb-3">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {t.importer.replaceWarning}
        </p>
      )}
      {groups.length === 0 ? (
        <p className="text-[13px] text-ink-500">{t.importer.noIssues}</p>
      ) : (
        <div className="space-y-2">
          {groups.map(([key, list]) => <IssueGroup key={key} list={list} text={issueText} />)}
        </div>
      )}
    </Modal>
  );
};

const IssueGroup: React.FC<{ list: ImportIssue[]; text: (i: ImportIssue) => string }> = ({ list, text }) => {
  const { t, f } = useRotaI18n();
  const [open, setOpen] = useState(false);
  const first = list[0];
  const withRows = list.filter(i => i.rowNumber);
  const shown = open ? withRows : withRows.slice(0, 4);
  const generic = (t.importIssues as Record<string, string>)[first.code] ?? first.code;
  return (
    <div className="rounded-xl border border-ink-200">
      <div className="flex items-center gap-2 px-3 py-2">
        <SeverityDot severity={first.severity} />
        <span className="text-[13px] font-semibold text-ink-900 flex-1">{withRows.length ? (t.importIssueTitles as Record<string, string>)[first.code] ?? generic : text(first)}</span>
        <span className="text-[12px] font-bold tabular-nums text-ink-500">{list.length}</span>
      </div>
      {withRows.length === 0 && list.length > 1 && (
        <ul className="px-3 pb-2 space-y-0.5">
          {list.slice(1).map((i, k) => <li key={k} className="text-[12.5px] text-ink-700">{text(i)}</li>)}
        </ul>
      )}
      {withRows.length > 0 && (
        <ul className="border-t border-ink-100 px-3 py-1.5 space-y-0.5">
          {shown.map((i, k) => (
            <li key={k} className="text-[12.5px] text-ink-700 flex gap-2">
              <span className="text-ink-400 tabular-nums shrink-0">{f(t.importer.row, { n: i.rowNumber! })}</span>
              <span className="font-semibold shrink-0">{i.storeCode}</span>
              <span className="truncate">{i.storeName}</span>
              {i.params && <span className="text-ink-500 truncate">· {text(i)}</span>}
            </li>
          ))}
          {withRows.length > 4 && (
            <li>
              <button type="button" className="text-[12px] font-semibold text-brand-700 hover:underline cursor-pointer" onClick={() => setOpen(o => !o)}>
                {open ? t.importer.showLess : f(t.importer.showAll, { n: withRows.length })}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
};
