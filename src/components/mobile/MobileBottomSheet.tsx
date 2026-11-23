import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export type BottomSheetState = 'peek' | 'half' | 'full';

interface MobileBottomSheetProps {
  isOpen?: boolean;
  state?: BottomSheetState;
  onStateChange?: (state: BottomSheetState) => void;
  peekContent: React.ReactNode;
  children: React.ReactNode;
  title?: string;
  onClose?: () => void;
  className?: string;
}

export const MobileBottomSheet: React.FC<MobileBottomSheetProps> = ({
  isOpen = true,
  state: controlledState,
  onStateChange,
  peekContent,
  children,
  title,
  onClose,
  className
}) => {
  const [internalState, setInternalState] = useState<BottomSheetState>('peek');
  const currentState = controlledState !== undefined ? controlledState : internalState;

  const updateState = (newState: BottomSheetState) => {
    if (onStateChange) {
      onStateChange(newState);
    } else {
      setInternalState(newState);
    }
  };

  const heights = {
    peek: '80px',
    half: '52vh',
    full: '88vh'
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop when in half or full state */}
      <AnimatePresence>
        {currentState !== 'peek' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-[1200] backdrop-blur-[2px]"
            onClick={() => updateState('peek')}
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={false}
        animate={{
          height: heights[currentState]
        }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
        className={cn(
          "fixed bottom-16 left-0 right-0 z-[1300] bg-card/95 backdrop-blur-md border-t border-border rounded-t-3xl shadow-2xl flex flex-col overflow-hidden max-w-lg mx-auto",
          className
        )}
      >
        {/* Drag Handle & Header */}
        <div 
          className="shrink-0 px-4 pt-2.5 pb-2 cursor-pointer select-none border-b border-border/40"
          onClick={() => {
            if (currentState === 'peek') updateState('half');
            else if (currentState === 'half') updateState('full');
            else updateState('peek');
          }}
        >
          {/* Visual pill handle */}
          <div className="w-12 h-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/50 rounded-full mx-auto mb-2 transition-colors" />

          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0 pr-2">
              {peekContent}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted/60 text-muted-foreground transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  if (currentState === 'peek') updateState('half');
                  else if (currentState === 'half') updateState('peek');
                  else updateState('half');
                }}
                aria-label={currentState === 'peek' ? 'Развернуть' : 'Свернуть'}
              >
                {currentState === 'peek' ? (
                  <ChevronUp size={18} />
                ) : (
                  <ChevronDown size={18} />
                )}
              </button>

              {onClose && currentState !== 'peek' && (
                <button
                  type="button"
                  className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted/60 text-muted-foreground transition-colors cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateState('peek');
                    onClose();
                  }}
                  aria-label="Закрыть"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3 pb-8 scrollbar-thin">
          {children}
        </div>
      </motion.div>
    </>
  );
};
