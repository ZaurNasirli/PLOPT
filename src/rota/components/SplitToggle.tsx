/** "Even / by rhythm" switch of the week split, and the note when volumes come from a Proqnoz forecast. */
import React from 'react';
import { RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useRotaI18n } from '../i18n';
import { rotaStore, useRotaState } from '../store/workspace';
import { scheduleShares } from '../core/rhythm';

const dmy = (iso: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

export const SplitToggle: React.FC<{ onToast?: (msg: string) => void }> = () => {
  const { t, f, m3 } = useRotaI18n();
  const mode = useRotaState(s => s.ws.splitMode);
  const rhythm = useRotaState(s => s.ws.rhythm);
  const example = rhythm ? scheduleShares(rhythm.chain, [0, 3], rhythm.direction).map(x => m3(20 * x)) : null;
  const rhythmTitle = rhythm && example
    ? f(t.split.rhythmHint, { file: rhythm.source, from: dmy(rhythm.from), to: dmy(rhythm.to), a: example[0], b: example[3] })
    : t.split.noRhythm;
  const seg = (active: boolean, disabled = false) => cn(
    'h-7 px-2.5 text-[12px] font-semibold border-r last:border-r-0 border-ink-200',
    active ? 'bg-brand-600 text-white' : 'bg-ink-0 text-ink-700 hover:bg-ink-100',
    disabled ? 'opacity-45 cursor-not-allowed hover:bg-ink-0' : 'cursor-pointer'
  );
  return (
    <div className="inline-flex items-center gap-1.5" role="group" aria-label={t.split.label}>
      <span className="text-[11.5px] text-ink-500 whitespace-nowrap">{t.split.label}</span>
      <span className="inline-flex rounded-lg border border-ink-200 overflow-hidden">
        <button type="button" className={seg(mode === 'uniform')} aria-pressed={mode === 'uniform'} title={t.split.uniformHint}
          onClick={() => rotaStore.setSplitMode('uniform')}>{t.split.uniform}</button>
        <button type="button" className={seg(mode === 'rhythm', !rhythm)} aria-pressed={mode === 'rhythm'} disabled={!rhythm} title={rhythmTitle}
          onClick={() => rotaStore.setSplitMode('rhythm')}>{t.split.rhythm}</button>
      </span>
    </div>
  );
};

export const VolumeSourceNote: React.FC<{ onToast?: (msg: string) => void }> = ({ onToast }) => {
  const { t, f } = useRotaI18n();
  const src = useRotaState(s => s.ws.volumeSource);
  if (!src) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-brand-800 bg-brand-50 border border-brand-200 rounded-md px-1.5 py-0.5">
      {f(t.split.forecastVolumes, { date: dmy(src.week) })}
      <button type="button" title={t.split.restore} aria-label={t.split.restore}
        className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline cursor-pointer"
        onClick={() => { if (window.confirm(t.split.restoreConfirm)) { rotaStore.restoreFileVolumes(); onToast?.(t.split.restored); } }}>
        <RotateCcw size={11} /> {t.split.restore}
      </button>
    </span>
  );
};
