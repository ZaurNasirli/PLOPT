import React, { useEffect, useRef, useState } from 'react';
import { Cloud, CloudAlert, CloudCheck, CloudOff, CloudUpload, Loader2, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { CloudSyncApi } from '../../hooks/useCloudSync';
import { useTranslation } from '../../i18n/I18nContext';
import { cn } from '../../lib/utils';

interface CloudSyncButtonProps {
  cloud: CloudSyncApi;
  variant?: 'desktop' | 'mobile';
  /** Extra facts shown in the panel (e.g. store directory and road cache sizes) */
  details?: { label: string; value: string }[];
}

export const CloudSyncButton: React.FC<CloudSyncButtonProps> = ({ cloud, variant = 'desktop', details = [] }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { status, user, error, lastSyncedAt } = cloud;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);

  const statusText: Record<typeof status, string> = {
    disabled: t('cloudNotConfiguredShort'),
    connecting: t('cloudStatusConnecting'),
    'signed-out': t('cloudStatusSignedOut'),
    loading: t('cloudStatusLoading'),
    synced: t('cloudStatusSynced'),
    saving: t('cloudStatusSaving'),
    error: t('cloudStatusError'),
  };

  const errorText = error
    ? {
        permission: t('cloudErrPermission'),
        domain: t('cloudErrDomain'),
        offline: t('cloudErrOffline'),
        'no-database': t('cloudErrNoDb'),
        unknown: t('cloudErrUnknown', { message: error.message }),
      }[error.code]
    : null;

  const icon = (() => {
    const size = 15;
    switch (status) {
      case 'disabled': return <CloudOff size={size} className="text-muted-foreground" />;
      case 'connecting':
      case 'loading': return <Loader2 size={size} className="text-primary animate-spin" />;
      case 'saving': return <CloudUpload size={size} className="text-amber-500 animate-pulse" />;
      case 'synced': return <CloudCheck size={size} className="text-emerald-500" />;
      case 'error': return <CloudAlert size={size} className="text-destructive" />;
      default: return <Cloud size={size} className="text-muted-foreground" />;
    }
  })();

  const lastSyncLabel = lastSyncedAt
    ? t('cloudLastSync', { time: lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })
    : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'relative flex items-center justify-center cursor-pointer transition-colors',
          variant === 'desktop'
            ? 'h-8 w-8 rounded-lg border border-input bg-card/60 shadow-xs hover:border-primary'
            : 'w-8 h-8 rounded-lg hover:bg-muted/80'
        )}
        title={`${t('cloudTitle')}: ${statusText[status]}`}
        aria-label={t('cloudTitle')}
      >
        {icon}
        {status === 'signed-out' && (
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500 ring-1 ring-card" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-24px)] z-[3500] rounded-xl border bg-card text-card-foreground shadow-2xl p-3 space-y-3 text-xs">
          <div className="flex items-center gap-2">
            {icon}
            <div className="min-w-0">
              <div className="font-bold text-sm">{t('cloudTitle')}</div>
              <div className="text-muted-foreground">{statusText[status]}</div>
            </div>
          </div>

          {status === 'disabled' && (
            <p className="text-muted-foreground leading-relaxed">{t('cloudNotConfigured')}</p>
          )}

          {user && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/40 border">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-7 h-7 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold">
                  {(user.name || user.email || '?').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                {user.name && <div className="font-semibold truncate">{user.name}</div>}
                {user.email && <div className="text-muted-foreground truncate">{user.email}</div>}
              </div>
            </div>
          )}

          {lastSyncLabel && user && <div className="text-muted-foreground">{lastSyncLabel}</div>}

          {details.length > 0 && (
            <div className="space-y-0.5 p-2 rounded-lg bg-muted/30 border">
              {details.map(d => (
                <div key={d.label} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{d.label}</span>
                  <span className="font-semibold text-right">{d.value}</span>
                </div>
              ))}
            </div>
          )}

          {errorText && (
            <div className="p-2 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive leading-relaxed break-words">
              {errorText}
            </div>
          )}

          {status === 'signed-out' && (
            <p className="text-muted-foreground leading-relaxed">{t('cloudSignInHint')}</p>
          )}

          <div className="flex flex-col gap-1.5">
            {(status === 'signed-out' || (status === 'error' && !user)) && (
              <button
                type="button"
                onClick={() => { void cloud.signIn(); }}
                className="h-8 rounded-lg bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-1.5 cursor-pointer hover:bg-primary/90"
              >
                <LogIn size={14} /> {t('cloudSignIn')}
              </button>
            )}
            {user && (
              <>
                <button
                  type="button"
                  onClick={() => { void cloud.reload(); setOpen(false); }}
                  disabled={status === 'loading' || status === 'saving'}
                  className="h-8 rounded-lg border font-semibold flex items-center justify-center gap-1.5 cursor-pointer hover:bg-accent disabled:opacity-50"
                >
                  <RefreshCw size={14} /> {t('cloudReload')}
                </button>
                <button
                  type="button"
                  onClick={() => { void cloud.signOut(); setOpen(false); }}
                  className="h-8 rounded-lg border font-semibold flex items-center justify-center gap-1.5 cursor-pointer hover:bg-accent text-destructive"
                >
                  <LogOut size={14} /> {t('cloudSignOut')}
                </button>
              </>
            )}
          </div>

          {status !== 'disabled' && (
            <p className="text-[10px] text-muted-foreground">{t('cloudLocalNote')}</p>
          )}
        </div>
      )}
    </div>
  );
};
