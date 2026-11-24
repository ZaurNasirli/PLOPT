import React from 'react';
import { Ban } from 'lucide-react';
import { useRotaI18n } from '../i18n';
import { Btn, Modal } from './ui';
import type { Rejected } from '../state/actions';
import { checkText } from './checkText';

export interface RejectionInfo {
  applied: number;
  rejected: Rejected[];
  names: Map<string, { name: string; region: string }>;
}

/** Why a manual change was refused (hard rules) */
export const RejectionModal: React.FC<{ info: RejectionInfo; onClose: () => void }> = ({ info, onClose }) => {
  const i18n = useRotaI18n();
  const { t, f } = i18n;
  const batch = info.applied > 0 || info.rejected.length > 1;
  return (
    <Modal
      title={<span className="inline-flex items-center gap-2 text-rose-700"><Ban size={17} /> {batch ? t.rejection.batchTitle : t.rejection.title}</span>}
      onClose={onClose}
      width="md"
      footer={<Btn variant="primary" onClick={onClose}>{t.common.close}</Btn>}
    >
      {batch && (
        <p className="text-[12.5px] text-ink-600 mb-3">
          {f(t.rejection.applied, { n: info.applied })} · <span className="text-rose-700 font-semibold">{f(t.rejection.rejected, { n: info.rejected.length })}</span>
        </p>
      )}
      <ul className="rounded-xl border border-ink-200 divide-y divide-ink-100 max-h-[50vh] overflow-y-auto">
        {info.rejected.map((r, k) => {
          const s = info.names.get(r.code);
          return (
            <li key={k} className="px-3 py-2">
              <div className="text-[12.5px] font-bold text-ink-900">{r.code} <span className="font-semibold text-ink-600">{s?.name}</span> <span className="text-ink-400 font-normal">· {s?.region}</span></div>
              <div className="text-[12.5px] text-rose-700">{checkText(r.reason, i18n)}</div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
};
