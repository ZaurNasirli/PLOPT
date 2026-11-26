import React, { useEffect } from 'react';
import { BookOpen, X } from 'lucide-react';
import { Button } from '../common/UIComponents';
import yolGuide from '../../../docs/az/yol.md?raw';
import ritmGuide from '../../../docs/az/ritm.md?raw';
import proqnozGuide from '../../../docs/az/proqnoz.md?raw';
import magazalarGuide from '../../../docs/az/magazalar.md?raw';

/** Module instructions in Azerbaijani: the same files as docs/az/*.md in the repository */
export type GuideModule = 'yol' | 'ritm' | 'proqnoz' | 'magazalar';
const GUIDES: Record<GuideModule, string> = { yol: yolGuide, ritm: ritmGuide, proqnoz: proqnozGuide, magazalar: magazalarGuide };
const TABS: Array<[GuideModule, string]> = [['yol', 'Yol'], ['ritm', 'Ritm'], ['proqnoz', 'Proqnoz'], ['magazalar', 'Mağazalar']];

/** **bold** and `code` inside a line */
function inline(text: string, key: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={`${key}-${i}`} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={`${key}-${i}`} className="px-1 rounded bg-muted text-[0.92em]">{part.slice(1, -1)}</code>;
    return <React.Fragment key={`${key}-${i}`}>{part}</React.Fragment>;
  });
}

/** Small Markdown subset of the guides: headings, paragraphs, bullet and numbered lists */
function renderMarkdown(md: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const lines = md.replace(/\r/g, '').split('\n');
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushPara = () => {
    if (para.length) out.push(<p key={`p${out.length}`} className="leading-relaxed">{inline(para.join(' '), `p${out.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const k = `l${out.length}`;
    const items = list.items.map((it, i) => <li key={`${k}-${i}`} className="leading-relaxed">{inline(it, `${k}-${i}`)}</li>);
    out.push(list.ordered
      ? <ol key={k} className="list-decimal pl-5 space-y-1">{items}</ol>
      : <ul key={k} className="list-disc pl-5 space-y-1">{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (h) {
      flushPara(); flushList();
      const level = h[1].length;
      const cls = level === 1 ? 'text-lg font-bold text-foreground' : level === 2 ? 'text-sm font-bold text-foreground pt-2' : 'text-xs font-bold text-foreground';
      out.push(React.createElement(level === 1 ? 'h2' : level === 2 ? 'h3' : 'h4', { key: `h${out.length}`, className: cls }, inline(h[2], `h${out.length}`)));
    } else if (ul || ol) {
      flushPara();
      const ordered = Boolean(ol);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else if (list && /^\s{2,}/.test(raw)) {
      list.items[list.items.length - 1] += ' ' + line.trim();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara(); flushList();
  return out;
}

interface Props {
  module: GuideModule | null;
  onChangeModule: (m: GuideModule) => void;
  onClose: () => void;
}

export const ModuleGuideModal: React.FC<Props> = ({ module, onChangeModule, onClose }) => {
  useEffect(() => {
    if (!module) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [module, onClose]);
  if (!module) return null;
  return (
    <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4" onClick={onClose}>
      <div lang="az" className="bg-card border rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()} role="dialog" aria-label="Təlimat">
        <div className="p-3 sm:p-4 border-b flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 mr-auto">
            <div className="p-2 bg-primary/10 rounded-lg text-primary"><BookOpen size={18} /></div>
            <span className="text-base font-bold">Təlimat</span>
          </div>
          <div className="flex gap-1 bg-muted/60 rounded-lg p-1" role="tablist">
            {TABS.map(([id, label]) => (
              <button
                key={`guide-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={module === id}
                onClick={() => onChangeModule(id)}
                className={`px-2.5 h-7 rounded-md text-xs font-semibold cursor-pointer transition-colors ${module === id ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full cursor-pointer" onClick={onClose} title="Bağla">
            <X size={16} />
          </Button>
        </div>
        <div className="p-5 sm:p-6 space-y-3 overflow-y-auto flex-1 scrollbar-thin text-[13px] text-muted-foreground">
          {renderMarkdown(GUIDES[module])}
        </div>
      </div>
    </div>
  );
};
