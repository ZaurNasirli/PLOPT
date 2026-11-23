import React, { useState, useEffect } from 'react';
import { Smartphone, Monitor, Maximize2, Minimize2, Battery, Wifi, Signal, ArrowLeft } from 'lucide-react';
import { Button } from '../common/UIComponents';
import { cn } from '../../lib/utils';
import { useTranslation } from '../../i18n/I18nContext';

interface AndroidDeviceFrameProps {
  children: React.ReactNode;
  onSwitchToDesktop: () => void;
  showDeviceFrame: boolean;
  onToggleDeviceFrame: () => void;
}

export const AndroidDeviceFrame: React.FC<AndroidDeviceFrameProps> = ({
  children,
  onSwitchToDesktop,
  showDeviceFrame,
  onToggleDeviceFrame
}) => {
  const { t } = useTranslation();
  const [currentTime, setCurrentTime] = useState('09:41');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      setCurrentTime(`${hours}:${minutes}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full h-screen bg-slate-950/95 flex flex-col items-center justify-start overflow-hidden select-none">
      {/* Top Desktop Helper Toolbar */}
      <header className="w-full shrink-0 h-12 bg-slate-900 border-b border-slate-800 px-4 flex items-center justify-between text-xs text-slate-300 z-50">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-bold text-white flex items-center gap-1.5">
            <Smartphone size={15} className="text-emerald-400" />
            Android Mobile Format
          </span>
          <span className="hidden sm:inline-block px-2 py-0.5 rounded-md bg-slate-800 text-[10px] text-slate-400 font-mono">
            412 × 915 · Material 3
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleDeviceFrame}
            className="h-8 px-2.5 text-xs gap-1.5 text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer"
            title={showDeviceFrame ? t('mobileViewFullscreen') : t('mobileViewDeviceFrame')}
          >
            {showDeviceFrame ? (
              <>
                <Maximize2 size={13} />
                <span className="hidden md:inline">{t('mobileViewFullscreen')}</span>
              </>
            ) : (
              <>
                <Minimize2 size={13} />
                <span className="hidden md:inline">{t('mobileViewDeviceFrame')}</span>
              </>
            )}
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={onSwitchToDesktop}
            className="h-8 px-3 text-xs gap-1.5 shadow-sm font-semibold cursor-pointer"
            title={t('viewFormatDesktop')}
          >
            <Monitor size={14} />
            <span>{t('viewFormatDesktop')}</span>
          </Button>
        </div>
      </header>

      {/* Main Container */}
      <div className={cn(
        "flex-1 w-full flex items-center justify-center overflow-hidden p-0 sm:p-3 transition-all",
        !showDeviceFrame && "p-0"
      )}>
        {showDeviceFrame ? (
          /* Realistic Android Smartphone Shell */
          <div className="relative w-full max-w-[420px] h-[calc(100vh-64px)] max-h-[915px] bg-slate-900 rounded-[44px] p-3 shadow-2xl ring-1 ring-white/10 border-4 border-slate-700/80 flex flex-col overflow-hidden">
            {/* Phone Speaker & Camera Bezel */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-28 h-4 rounded-full flex items-center justify-center z-50 pointer-events-none">
              <div className="w-10 h-1 bg-slate-700 rounded-full" />
            </div>

            {/* Android Screen Display */}
            <div className="relative flex-1 w-full bg-background rounded-[34px] overflow-hidden flex flex-col shadow-inner border border-black/20">
              {/* Android Status Bar */}
              <div className="shrink-0 h-7 bg-card/90 backdrop-blur-md px-5 flex items-center justify-between text-[11px] font-semibold text-foreground z-40 select-none border-b border-border/20">
                <span className="font-mono">{currentTime}</span>
                {/* Punch Hole Camera */}
                <div className="w-3.5 h-3.5 rounded-full bg-black shadow-inner border border-slate-800" />
                <div className="flex items-center gap-1.5 text-foreground/80">
                  <span className="text-[10px] font-bold">5G</span>
                  <Signal size={11} />
                  <Wifi size={11} />
                  <div className="flex items-center gap-0.5">
                    <Battery size={13} className="text-emerald-500 fill-emerald-500" />
                  </div>
                </div>
              </div>

              {/* App Viewport inside Phone */}
              <div className="flex-1 w-full overflow-hidden flex flex-col relative">
                {children}
              </div>

              {/* Android Bottom Gesture Bar */}
              <div className="shrink-0 h-4 bg-card/90 backdrop-blur-md flex items-center justify-center z-40 select-none">
                <div className="w-28 h-1 bg-foreground/25 hover:bg-foreground/40 rounded-full transition-colors" />
              </div>
            </div>
          </div>
        ) : (
          /* Full-width Responsive Mobile Layout */
          <div className="w-full h-full flex flex-col bg-background overflow-hidden relative">
            {children}
          </div>
        )}
      </div>
    </div>
  );
};
