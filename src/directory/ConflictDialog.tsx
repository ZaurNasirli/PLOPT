/**
 * "The file and the directory disagree — which one is the main source?"
 * Any import (Yol, Ritm, Proqnoz, the directory itself) awaits askDirectoryConflicts(); the host
 * rendered once in App shows the dialog. Closing it keeps the directory values.
 */
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../i18n/I18nContext';
import { DIR_FIELDS, DirConflict, DirField, Resolution } from './directory';

interface Pending {
  conflicts: DirConflict[];
  source: string;
  newCount: number;
  resolve: (r: Resolution) => void;
}

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

export function askDirectoryConflicts(conflicts: DirConflict[], source: string, newCount = 0): Promise<Resolution> {
  if (!conflicts.length) return Promise.resolve(new Map());
  return new Promise(resolve => {
    pending = { conflicts, source, newCount, resolve };
    emit();
  });
}

export const FIELD_LABEL_KEYS: Record<DirField, string> = {
  name: 'dirFieldName', region: 'dirFieldRegion', format: 'dirFieldFormat', coords: 'dirFieldCoords', receivingWindow: 'dirFieldReceiving',
  address: 'dirFieldAddress', contactPerson: 'dirFieldContact', phone: 'dirFieldPhone', access: 'dirFieldAccess', vehicleLimits: 'dirFieldVehicle', notes: 'dirFieldNotes',
};

export const DirectoryConflictHost: React.FC = () => {
  const current = useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l); }, () => pending, () => pending);
  if (!current) return null;
  return <Dialog key={current.conflicts.length + current.source} p={current} />;
};

const Dialog: React.FC<{ p: Pending }> = ({ p }) => {
  const { t } = useTranslation();
  const [choice, setChoice] = useState<Map<string, 'dir' | 'file'>>(() => new Map(p.conflicts.map(c => [c.id, 'dir'])));
  const [open, setOpen] = useState<DirField | null>(null);
  const byField = useMemo(() => {
    const m = new Map<DirField, DirConflict[]>();
    for (const c of p.conflicts) m.set(c.field, [...(m.get(c.field) ?? []), c]);
    return DIR_FIELDS.filter(f => m.has(f)).map(f => ({ field: f, list: m.get(f)! }));
  }, [p.conflicts]);
  const stores = new Set(p.conflicts.map(c => c.key)).size;

  const finish = (r: Resolution) => {
    pending = null;
    emit();
    p.resolve(r);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(new Map()); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const setAll = (v: 'dir' | 'file', list = p.conflicts) => setChoice(prev => { const n = new Map(prev); for (const c of list) n.set(c.id, v); return n; });
  const seg = (active: boolean) => cn('h-7 px-2.5 text-[12px] font-semibold cursor-pointer border-r last:border-r-0', active ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground hover:bg-muted');

  return (
    <div className="fixed inset-0 z-[3500] bg-black/45 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label={t('dirConflictTitle')} className="bg-card text-foreground border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-3.5 border-b">
          <div>
            <h2 className="text-[16px] font-bold">{t('dirConflictTitle')}</h2>
            <p className="text-[12.5px] text-muted-foreground mt-1">{t('dirConflictText', { source: p.source, n: stores })}</p>
            {p.newCount > 0 && <p className="text-[12.5px] text-muted-foreground mt-0.5">{t('dirNewStores', { n: p.newCount })}</p>}
          </div>
          <button type="button" onClick={() => finish(new Map())} aria-label={t('dirClose')} className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg border hover:bg-muted cursor-pointer"><X size={15} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {byField.map(({ field, list }) => {
            const allFile = list.every(c => choice.get(c.id) === 'file');
            const allDir = list.every(c => choice.get(c.id) === 'dir');
            return (
              <div key={field} className="rounded-xl border">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="font-bold text-[13px] flex-1">{t(FIELD_LABEL_KEYS[field])} <span className="text-muted-foreground font-semibold">· {t('dirDiffs', { n: list.length })}</span></span>
                  <span className="inline-flex rounded-lg border overflow-hidden">
                    <button type="button" className={seg(allDir)} onClick={() => setAll('dir', list)}>{t('dirKeepDir')}</button>
                    <button type="button" className={seg(allFile)} onClick={() => setAll('file', list)}>{t('dirTakeFile')}</button>
                  </span>
                  <button type="button" className="text-[12px] font-semibold text-primary hover:underline cursor-pointer" onClick={() => setOpen(open === field ? null : field)}>
                    {open === field ? t('dirHide') : t('dirShow')}
                  </button>
                </div>
                {open === field && (
                  <table className="w-full text-[12px] border-t">
                    <thead className="text-muted-foreground">
                      <tr><th className="text-left px-3 py-1">{t('dirFieldCode')}</th><th className="text-left px-2">{t('dirInDir')}</th><th className="text-left px-2">{t('dirInFile')}</th></tr>
                    </thead>
                    <tbody>
                      {list.map(c => (
                        <tr key={c.id} className="border-t">
                          <td className="px-3 py-1 font-semibold whitespace-nowrap">{c.code} <span className="font-normal text-muted-foreground">{c.name}</span></td>
                          {(['dir', 'file'] as const).map(side => (
                            <td key={side} className="px-2">
                              <label className={cn('inline-flex items-center gap-1.5 cursor-pointer rounded px-1', choice.get(c.id) === side && 'bg-primary/10 font-semibold')}>
                                <input type="radio" name={c.id} checked={choice.get(c.id) === side} onChange={() => setChoice(prev => new Map(prev).set(c.id, side))} className="accent-[var(--color-primary)]" />
                                {side === 'dir' ? c.dirValue : c.fileValue}
                              </label>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => setAll('dir')} className="h-9 px-3 rounded-lg border text-[13px] font-semibold hover:bg-muted cursor-pointer mr-auto">{t('dirAllDir')}</button>
          <button type="button" onClick={() => setAll('file')} className="h-9 px-3 rounded-lg border text-[13px] font-semibold hover:bg-muted cursor-pointer">{t('dirAllFile')}</button>
          <button type="button" onClick={() => finish(new Map([...choice.entries()].filter(([, v]) => v === 'file')))} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-[13px] font-bold cursor-pointer">{t('dirApply')}</button>
        </div>
      </div>
    </div>
  );
};
