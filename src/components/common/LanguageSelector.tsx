import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useTranslation } from '../../i18n/I18nContext';
import { FlagIcon } from './FlagIcon';
import { cn } from '../../lib/utils';

export const LanguageSelector: React.FC<{ className?: string }> = ({ className }) => {
  const { language, setLanguage, languages, currentLanguageOption, t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className={cn("relative inline-block text-left z-[2000]", className)} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "h-8 px-2.5 flex items-center gap-1.5 rounded-lg border border-input bg-background/90 hover:bg-accent hover:text-accent-foreground shadow-xs transition-all cursor-pointer select-none",
          isOpen && "ring-2 ring-primary/30 border-primary"
        )}
        title={currentLanguageOption.nativeName}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <FlagIcon code={currentLanguageOption.code} size="md" />
        <ChevronDown 
          size={12} 
          className={cn("transition-transform duration-200 text-muted-foreground", isOpen && "rotate-180 text-foreground")} 
        />
      </button>

      {isOpen && (
        <div 
          className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-border bg-card/95 backdrop-blur-md shadow-2xl p-1.5 ring-1 ring-black/5 dark:ring-white/10"
          style={{ zIndex: 99999 }}
        >
          <div className="px-2.5 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border/50 mb-1">
            {t('selectLanguage')}
          </div>
          <div className="space-y-0.5">
            {languages.map((item, langIdx) => {
              const isSelected = language === item.code;
              return (
                <button
                  key={`lang-${item.code}-${langIdx}`}
                  type="button"
                  onClick={() => {
                    setLanguage(item.code);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors cursor-pointer select-none",
                    isSelected
                      ? "bg-primary/10 text-primary font-bold shadow-xs"
                      : "text-foreground hover:bg-accent/80 font-medium"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <FlagIcon code={item.code} size="lg" />
                    <span className="text-xs">{item.nativeName}</span>
                  </div>
                  {isSelected && <Check size={14} className="text-primary shrink-0 ml-2" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
