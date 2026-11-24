/** The seven rule tables (same layout as the sheets of the rules Excel file). */
import React from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Wand2 } from 'lucide-react';
import { useRotaI18n } from '../../i18n';
import { cn } from '../../../lib/utils';
import { Btn } from '../ui';
import { BoolCell, cellId, NumCell, SelectCell, TextCell, Th } from './cells';
import { ALGO_COLS, GENERAL_KEYS, PARTY_COLS, SEGMENT_COLS, STORE_COLS, WEIGHT_ORDER } from '../../rules/schema';
import {
  AlgoPhase, GroupKeys, MatrixCell, MatrixKind, MatrixRow, newId, PartyChangeMode, PartyRule, PhaseStart, PhaseType, RuleKind, RuleSet,
  SegmentRule, StoreException,
} from '../../rules/types';

export interface TableProps {
  rs: RuleSet;
  update: (fn: (rs: RuleSet) => RuleSet) => void;
  /** "rowId:field" of cells with errors */
  invalid: Set<string>;
}

const tableCls = 'w-full border-separate border-spacing-0 text-[12.5px]';
const tdCls = 'px-1 py-0.5 border-b border-ink-100 align-middle';
const wrapCls = 'rounded-xl border border-ink-200 bg-ink-0 overflow-x-auto';

const RowDelete: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  const { t } = useRotaI18n();
  return (
    <button type="button" onClick={onClick} title={t.rules.actions.deleteRow} aria-label={t.rules.actions.deleteRow}
      className="h-7 w-7 inline-flex items-center justify-center rounded-md text-ink-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer">
      <Trash2 size={13} />
    </button>
  );
};

function patchList<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T[] {
  return list.map(x => (x.id === id ? { ...x, ...patch } : x));
}

// ------------------------------------------------------------------------------------------------

export const PartiesTable: React.FC<TableProps & { onAddFromStores: () => void }> = ({ rs, update, invalid, onAddFromStores }) => {
  const { t } = useRotaI18n();
  const H = t.rules.cols.parties;
  const T = t.rules.tips.parties;
  const set = (id: string, patch: Partial<PartyRule>) => update(r => ({ ...r, parties: patchList(r.parties, id, patch) }));
  const bad = (id: string, f: string) => invalid.has(`${id}:${f}`);
  return (
    <div className="space-y-2">
      <div className={wrapCls}>
        <table className={tableCls}>
          <thead><tr>{PARTY_COLS.map(k => <Th key={k} label={H[k]} tip={T[k]} />)}<th className="w-8" /></tr></thead>
          <tbody>
            {rs.parties.map(p => (
              <tr key={p.id}>
                <td className={cn(tdCls, 'w-20')}><TextCell id={cellId('parties', p.id, 'code')} value={p.code} onChange={v => set(p.id, { code: v })} invalid={bad(p.id, 'code')} /></td>
                <td className={cn(tdCls, 'min-w-40')}><TextCell id={cellId('parties', p.id, 'name')} value={p.name} onChange={v => set(p.id, { name: v })} invalid={bad(p.id, 'name')} /></td>
                <td className={cn(tdCls, 'w-36')}><TextCell id={cellId('parties', p.id, 'window')} value={p.window} placeholder={t.rules.windowPlaceholder} mono onChange={v => set(p.id, { window: v })} invalid={bad(p.id, 'window')} /></td>
                <td className={cn(tdCls, 'w-24')}><NumCell id={cellId('parties', p.id, 'chainOrder')} value={p.chainOrder} integer onChange={v => set(p.id, { chainOrder: v })} invalid={bad(p.id, 'chainOrder')} /></td>
                <td className={cn(tdCls, 'w-24')}><BoolCell id={cellId('parties', p.id, 'fixed')} value={p.fixed} allowEmpty={false} onChange={v => set(p.id, { fixed: Boolean(v) })} /></td>
                <td className={cn(tdCls, 'w-24')}><NumCell id={cellId('parties', p.id, 'truckM3')} value={p.truckM3} onChange={v => set(p.id, { truckM3: v })} /></td>
                <td className={cn(tdCls, 'w-24')}><NumCell id={cellId('parties', p.id, 'truckKg')} value={p.truckKg} onChange={v => set(p.id, { truckKg: v })} /></td>
                <td className={cn(tdCls, 'w-24')}><NumCell id={cellId('parties', p.id, 'trucksPerDay')} value={p.trucksPerDay} integer onChange={v => set(p.id, { trucksPerDay: v })} /></td>
                <td className={tdCls}><RowDelete onClick={() => update(r => ({ ...r, parties: r.parties.filter(x => x.id !== p.id) }))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Btn size="sm" icon={<Plus size={13} />} onClick={() => update(r => ({
          ...r,
          parties: [...r.parties, { id: newId('party'), code: '', name: '', window: '', chainOrder: null, fixed: false, truckM3: null, truckKg: null, trucksPerDay: null }],
        }))}>{t.rules.actions.addRow}</Btn>
        <Btn size="sm" icon={<Wand2 size={13} />} onClick={onAddFromStores}>{t.rules.actions.addFromStores}</Btn>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------

export const SegmentsTable: React.FC<TableProps & { suggestions: { segment: string[]; format: string[] } }> = ({ rs, update, invalid, suggestions }) => {
  const { t } = useRotaI18n();
  const H = t.rules.cols.segments;
  const T = t.rules.tips.segments;
  const E = t.rules.enums;
  const set = (id: string, patch: Partial<SegmentRule>) => update(r => ({ ...r, segments: patchList(r.segments, id, patch) }));
  const bad = (id: string, f: string) => invalid.has(`${id}:${f}`);
  const numKeys = ['maxStepsUp', 'bonus1', 'bonus2', 'changePenalty', 'maxPlusDays', 'maxMinusDays', 'minDays', 'maxDays', 'minDaysOneDay', 'sundayMin', 'sundayMax'] as const;
  const intKeys = new Set(['maxStepsUp', 'maxPlusDays', 'maxMinusDays', 'minDays', 'maxDays', 'minDaysOneDay', 'sundayMin', 'sundayMax']);
  return (
    <div className="space-y-2">
      <div className={wrapCls}>
        <table className={tableCls}>
          <thead><tr>{SEGMENT_COLS.map(k => <Th key={k} label={H[k]} tip={T[k]} className={k === 'value' || k === 'partyChange' ? '' : 'w-20'} />)}<th className="w-8" /></tr></thead>
          <tbody>
            {rs.segments.map(s => (
              <tr key={s.id}>
                <td className={cn(tdCls, 'w-28')}>
                  <SelectCell<RuleKind> id={cellId('segments', s.id, 'kind')} value={s.kind} allowEmpty={false}
                    options={[{ value: 'segment', label: E.kind.segment }, { value: 'format', label: E.kind.format }]}
                    onChange={v => set(s.id, { kind: v ?? 'segment' })} />
                </td>
                <td className={cn(tdCls, 'min-w-28')}>
                  <TextCell id={cellId('segments', s.id, 'value')} value={s.value} list={`rota-sugg-${s.kind}`} onChange={v => set(s.id, { value: v })} invalid={bad(s.id, 'value')} />
                </td>
                <td className={cn(tdCls, 'min-w-40')}>
                  <SelectCell<PartyChangeMode> id={cellId('segments', s.id, 'partyChange')} value={s.partyChange}
                    options={(['none', 'chain_up', 'swap_part', 'any'] as PartyChangeMode[]).map(v => ({ value: v, label: E.partyChange[v] }))}
                    onChange={v => set(s.id, { partyChange: v })} invalid={bad(s.id, 'partyChange')} />
                </td>
                {numKeys.slice(0, 4).map(k => (
                  <td key={k} className={cn(tdCls, 'w-20')}><NumCell id={cellId('segments', s.id, k)} value={s[k]} integer={intKeys.has(k)} onChange={v => set(s.id, { [k]: v })} invalid={bad(s.id, k)} /></td>
                ))}
                <td className={cn(tdCls, 'w-20')}><BoolCell id={cellId('segments', s.id, 'changeDayCount')} value={s.changeDayCount} onChange={v => set(s.id, { changeDayCount: v })} invalid={bad(s.id, 'changeDayCount')} /></td>
                {numKeys.slice(4).map(k => (
                  <td key={k} className={cn(tdCls, 'w-20')}><NumCell id={cellId('segments', s.id, k)} value={s[k]} integer={intKeys.has(k)} onChange={v => set(s.id, { [k]: v })} invalid={bad(s.id, k)} /></td>
                ))}
                <td className={tdCls}><RowDelete onClick={() => update(r => ({ ...r, segments: r.segments.filter(x => x.id !== s.id) }))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <datalist id="rota-sugg-segment">{suggestions.segment.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="rota-sugg-format">{suggestions.format.map(v => <option key={v} value={v} />)}</datalist>
      <Btn size="sm" icon={<Plus size={13} />} onClick={() => update(r => ({
        ...r,
        segments: [...r.segments, {
          id: newId('seg'), kind: 'segment', value: '', partyChange: null, maxStepsUp: null, bonus1: null, bonus2: null, changePenalty: null,
          changeDayCount: null, maxPlusDays: null, maxMinusDays: null, minDays: null, maxDays: null, minDaysOneDay: null, sundayMin: null, sundayMax: null,
        }],
      }))}>{t.rules.actions.addRow}</Btn>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------

export const GeneralTable: React.FC<TableProps> = ({ rs, update, invalid }) => {
  const { t } = useRotaI18n();
  const L = t.rules.general.labels;
  const T = t.rules.general.tips;
  const C = t.rules.cols.general;
  const E = t.rules.enums;
  const g = rs.general;
  const set = (patch: Partial<typeof g>) => update(r => ({ ...r, general: { ...r.general, ...patch } }));
  return (
    <div className={wrapCls}>
      <table className={tableCls}>
        <thead><tr><Th label={C.param} /><Th label={C.value} className="w-56" /><Th label={C.note} /></tr></thead>
        <tbody>
          {GENERAL_KEYS.map(k => {
            const id = cellId('general', k, k);
            const bad = invalid.has(`${k}:${k}`);
            let cell: React.ReactNode;
            if (k === 'workingDays') cell = <TextCell id={id} value={g.workingDays ?? ''} mono placeholder="1…7" onChange={v => set({ workingDays: v ? v.replace(/\s/g, '') : null })} invalid={bad} />;
            else if (k === 'groupMin') cell = <NumCell id={id} value={g.groupMin} integer onChange={v => set({ groupMin: v })} invalid={bad} />;
            else if (k === 'fastMultiplier') cell = <NumCell id={id} value={g.fastMultiplier} onChange={v => set({ fastMultiplier: v })} invalid={bad} />;
            else if (k === 'priorityNote') cell = <TextCell id={id} value={g.priorityNote ?? ''} onChange={v => set({ priorityNote: v || null })} />;
            else if (k === 'groupKeys') cell = (
              <SelectCell<GroupKeys> id={id} value={g.groupKeys} invalid={bad}
                options={(['party+region+day', 'party+day', 'region+day'] as GroupKeys[]).map(v => ({ value: v, label: E.groupKeys[v] }))}
                onChange={v => set({ groupKeys: v })} />
            );
            else cell = <BoolCell id={id} value={g[k] as boolean | null} onChange={v => set({ [k]: v })} invalid={bad} />;
            return (
              <tr key={k}>
                <td className={cn(tdCls, 'font-semibold text-ink-800 px-2')}>{L[k]}</td>
                <td className={tdCls}>{cell}</td>
                <td className={cn(tdCls, 'text-[12px] text-ink-500 px-2')}>{T[k]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const WeightsTable: React.FC<TableProps> = ({ rs, update, invalid }) => {
  const { t } = useRotaI18n();
  const C = t.rules.cols.weights;
  return (
    <div className={wrapCls}>
      <table className={tableCls}>
        <thead><tr><Th label={C.code} className="w-20" /><Th label={C.param} /><Th label={C.value} className="w-36" /><Th label={C.note} /></tr></thead>
        <tbody>
          {WEIGHT_ORDER.map(code => (
            <tr key={code}>
              <td className={cn(tdCls, 'font-mono font-bold text-ink-700 px-2')}>{code}</td>
              <td className={cn(tdCls, 'font-semibold text-ink-800 px-2')}>{t.rules.weights.labels[code]}</td>
              <td className={tdCls}>
                <NumCell id={cellId('weights', code, code)} value={rs.weights[code]} invalid={invalid.has(`${code}:${code}`)}
                  onChange={v => update(r => ({ ...r, weights: { ...r.weights, [code]: v } }))} />
              </td>
              <td className={cn(tdCls, 'text-[12px] text-ink-500 px-2')}>{t.rules.weights.tips[code]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------

export const AlgoTable: React.FC<TableProps> = ({ rs, update, invalid }) => {
  const { t } = useRotaI18n();
  const H = t.rules.cols.algo;
  const T = t.rules.tips.algo;
  const E = t.rules.enums;
  const set = (id: string, patch: Partial<AlgoPhase>) => update(r => ({ ...r, phases: patchList(r.phases, id, patch) }));
  const bad = (id: string, f: string) => invalid.has(`${id}:${f}`);
  const move = (i: number, d: -1 | 1) => update(r => {
    const phases = [...r.phases];
    const j = i + d;
    if (j < 0 || j >= phases.length) return r;
    [phases[i], phases[j]] = [phases[j], phases[i]];
    return { ...r, phases };
  });
  return (
    <div className="space-y-2">
      <div className={wrapCls}>
        <table className={tableCls}>
          <thead><tr>{ALGO_COLS.map(k => <Th key={k} label={H[k]} tip={T[k]} />)}<th className="w-20" /></tr></thead>
          <tbody>
            {rs.phases.map((p, i) => (
              <tr key={p.id}>
                <td className={cn(tdCls, 'w-12 text-center font-bold text-ink-700')}>{i + 1}</td>
                <td className={cn(tdCls, 'w-32')}>
                  <SelectCell<PhaseType> id={cellId('algo', p.id, 'type')} value={p.type} invalid={bad(p.id, 'type')}
                    options={(['anneal', 'repair'] as PhaseType[]).map(v => ({ value: v, label: E.phaseType[v] }))}
                    onChange={v => set(p.id, { type: v })} />
                </td>
                {(['iterations', 'T0', 'T1', 'chgMul', 'grpMul'] as const).map(k => (
                  <td key={k} className={cn(tdCls, 'w-28')}>
                    <NumCell id={cellId('algo', p.id, k)} value={p[k]} integer={k === 'iterations'} onChange={v => set(p.id, { [k]: v })} invalid={bad(p.id, k)} />
                  </td>
                ))}
                <td className={cn(tdCls, 'w-32')}>
                  <SelectCell<PhaseStart> id={cellId('algo', p.id, 'start')} value={p.start} invalid={bad(p.id, 'start')}
                    options={(['original', 'best'] as PhaseStart[]).map(v => ({ value: v, label: E.start[v] }))}
                    onChange={v => set(p.id, { start: v })} />
                </td>
                <td className={cn(tdCls, 'w-24')}><NumCell id={cellId('algo', p.id, 'seeds')} value={p.seeds} integer onChange={v => set(p.id, { seeds: v })} invalid={bad(p.id, 'seeds')} /></td>
                <td className={cn(tdCls, 'whitespace-nowrap')}>
                  <button type="button" className="h-7 w-6 inline-flex items-center justify-center text-ink-400 hover:text-ink-800 cursor-pointer disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="↑"><ArrowUp size={13} /></button>
                  <button type="button" className="h-7 w-6 inline-flex items-center justify-center text-ink-400 hover:text-ink-800 cursor-pointer disabled:opacity-30" disabled={i === rs.phases.length - 1} onClick={() => move(i, 1)} aria-label="↓"><ArrowDown size={13} /></button>
                  <RowDelete onClick={() => update(r => ({ ...r, phases: r.phases.filter(x => x.id !== p.id) }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Btn size="sm" icon={<Plus size={13} />} onClick={() => update(r => ({
        ...r,
        phases: [...r.phases, { id: newId('phase'), type: null, iterations: null, T0: null, T1: null, chgMul: null, grpMul: null, start: null, seeds: null }],
      }))}>{t.rules.actions.addRow}</Btn>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------

export const StoresTable: React.FC<TableProps & { storeCodes: string[] }> = ({ rs, update, invalid, storeCodes }) => {
  const { t } = useRotaI18n();
  const H = t.rules.cols.stores;
  const T = t.rules.tips.stores;
  const set = (id: string, patch: Partial<StoreException>) => update(r => ({ ...r, stores: patchList(r.stores, id, patch) }));
  const bad = (id: string, f: string) => invalid.has(`${id}:${f}`);
  const listText = (l: string[]) => l.join(', ');
  const toList = (v: string) => v.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
  return (
    <div className="space-y-2">
      <div className={wrapCls}>
        <table className={tableCls}>
          <thead><tr>{STORE_COLS.map(k => <Th key={k} label={H[k]} tip={T[k]} />)}<th className="w-8" /></tr></thead>
          <tbody>
            {rs.stores.map(s => (
              <tr key={s.id}>
                <td className={cn(tdCls, 'w-28')}><TextCell id={cellId('stores', s.id, 'storeCode')} value={s.storeCode} list="rota-store-codes" onChange={v => set(s.id, { storeCode: v })} invalid={bad(s.id, 'storeCode')} /></td>
                <td className={cn(tdCls, 'w-20')}><BoolCell id={cellId('stores', s.id, 'lockDays')} value={s.lockDays} allowEmpty={false} onChange={v => set(s.id, { lockDays: Boolean(v) })} /></td>
                <td className={cn(tdCls, 'w-20')}><BoolCell id={cellId('stores', s.id, 'lockParty')} value={s.lockParty} allowEmpty={false} onChange={v => set(s.id, { lockParty: Boolean(v) })} /></td>
                <td className={cn(tdCls, 'w-36')}><TextCell id={cellId('stores', s.id, 'allowedParties')} value={listText(s.allowedParties)} onChange={v => set(s.id, { allowedParties: toList(v) })} invalid={bad(s.id, 'allowedParties')} /></td>
                <td className={cn(tdCls, 'w-36')}><TextCell id={cellId('stores', s.id, 'forbiddenParties')} value={listText(s.forbiddenParties)} onChange={v => set(s.id, { forbiddenParties: toList(v) })} invalid={bad(s.id, 'forbiddenParties')} /></td>
                <td className={cn(tdCls, 'w-24')}>
                  <TextCell id={cellId('stores', s.id, 'forbiddenDays')} mono value={s.forbiddenDays.join('')}
                    onChange={v => set(s.id, { forbiddenDays: [...new Set(v.replace(/[^1-7]/g, '').split('').map(Number))].sort() })} />
                </td>
                <td className={cn(tdCls, 'w-20')}><NumCell id={cellId('stores', s.id, 'minDays')} value={s.minDays} integer onChange={v => set(s.id, { minDays: v })} invalid={bad(s.id, 'minDays')} /></td>
                <td className={cn(tdCls, 'w-20')}><NumCell id={cellId('stores', s.id, 'maxDays')} value={s.maxDays} integer onChange={v => set(s.id, { maxDays: v })} /></td>
                <td className={cn(tdCls, 'min-w-32')}><TextCell id={cellId('stores', s.id, 'comment')} value={s.comment} onChange={v => set(s.id, { comment: v })} /></td>
                <td className={tdCls}><RowDelete onClick={() => update(r => ({ ...r, stores: r.stores.filter(x => x.id !== s.id) }))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <datalist id="rota-store-codes">{storeCodes.map(c => <option key={c} value={c} />)}</datalist>
      <Btn size="sm" icon={<Plus size={13} />} onClick={() => update(r => ({
        ...r,
        stores: [...r.stores, { id: newId('store'), storeCode: '', lockDays: false, lockParty: false, allowedParties: [], forbiddenParties: [], forbiddenDays: [], minDays: null, maxDays: null, comment: '' }],
      }))}>{t.rules.actions.addRow}</Btn>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------

export const MatrixTable: React.FC<TableProps & { suggestions: Record<MatrixKind, string[]> }> = ({ rs, update, invalid, suggestions }) => {
  const { t } = useRotaI18n();
  const E = t.rules.enums;
  const C = t.rules.cols.matrix;
  const codes = rs.parties.map(p => p.code).filter(Boolean);
  for (const m of rs.matrix) for (const [k, v] of Object.entries(m.cells)) if (v && !codes.includes(k)) codes.push(k);
  const set = (id: string, patch: Partial<MatrixRow>) => update(r => ({ ...r, matrix: patchList(r.matrix, id, patch) }));
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-ink-500">{t.rules.tips.matrix} {t.rules.actions.addPartyColumns}.</p>
      <div className={wrapCls}>
        <table className={tableCls}>
          <thead>
            <tr>
              <Th label={C.kind} className="w-32" />
              <Th label={C.value} />
              {codes.map(c => <Th key={c} label={c} className="w-24 text-center" />)}
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rs.matrix.map(m => (
              <tr key={m.id}>
                <td className={tdCls}>
                  <SelectCell<MatrixKind> id={cellId('matrix', m.id, 'kind')} value={m.kind} allowEmpty={false}
                    options={(['segment', 'format', 'region'] as MatrixKind[]).map(v => ({ value: v, label: E.kind[v] }))}
                    onChange={v => set(m.id, { kind: v ?? 'segment' })} />
                </td>
                <td className={cn(tdCls, 'min-w-32')}><TextCell id={cellId('matrix', m.id, 'value')} value={m.value} list={`rota-mx-${m.kind}`} onChange={v => set(m.id, { value: v })} invalid={invalid.has(`${m.id}:value`)} /></td>
                {codes.map(c => (
                  <td key={c} className={tdCls}>
                    <SelectCell<'allow' | 'deny'> id={cellId('matrix', m.id, c)} value={(m.cells[c] ?? null) as 'allow' | 'deny' | null}
                      options={[{ value: 'allow', label: E.matrixCell.allow }, { value: 'deny', label: E.matrixCell.deny }]}
                      onChange={v => set(m.id, { cells: { ...m.cells, [c]: v as MatrixCell } })} />
                  </td>
                ))}
                <td className={tdCls}><RowDelete onClick={() => update(r => ({ ...r, matrix: r.matrix.filter(x => x.id !== m.id) }))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(['segment', 'format', 'region'] as MatrixKind[]).map(k => <datalist key={k} id={`rota-mx-${k}`}>{suggestions[k].map(v => <option key={v} value={v} />)}</datalist>)}
      <Btn size="sm" icon={<Plus size={13} />} onClick={() => update(r => ({ ...r, matrix: [...r.matrix, { id: newId('mx'), kind: 'segment', value: '', cells: {} }] }))}>
        {t.rules.actions.addRow}
      </Btn>
    </div>
  );
};
