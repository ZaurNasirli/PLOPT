import { useCallback, useEffect, useRef, useState } from 'react';
import { isFirebaseConfigured, loadFirebase } from '../services/cloud/firebaseClient';
import { CloudStore, createFirestoreStore } from '../services/cloud/cloudStore';

export type CloudStatus =
  | 'disabled'    // Firebase env variables are not set: local-only mode
  | 'connecting'  // loading the SDK / restoring the session
  | 'signed-out'
  | 'loading'     // reading the workspace from Firestore
  | 'synced'
  | 'saving'
  | 'error';

export interface CloudUser {
  uid: string;
  name: string | null;
  email: string | null;
  photoURL: string | null;
}

export type CloudErrorCode = 'permission' | 'domain' | 'offline' | 'no-database' | 'unknown';

export interface CloudError {
  code: CloudErrorCode;
  message: string;
}

export interface CloudSyncApi {
  status: CloudStatus;
  user: CloudUser | null;
  error: CloudError | null;
  lastSyncedAt: Date | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}

const SAVE_DEBOUNCE_MS = 1500;
const RETRY_AFTER_ERROR_MS = 15000;

function toCloudError(e: unknown): CloudError {
  const code = String((e as { code?: string })?.code || '');
  const message = String((e as { message?: string })?.message || e || '');
  if (code === 'permission-denied' || code === 'auth/insufficient-permission') return { code: 'permission', message };
  if (code === 'auth/unauthorized-domain') return { code: 'domain', message };
  if (code === 'unavailable' || code === 'auth/network-request-failed' || code === 'deadline-exceeded') return { code: 'offline', message };
  if (code === 'not-found' || /database .* does not exist/i.test(message)) return { code: 'no-database', message };
  return { code: 'unknown', message };
}

/**
 * Keeps a set of named values in sync with Firestore for the signed-in user.
 *
 * - On sign-in the workspace is read once. If the cloud already has data it replaces the
 *   local state (via `applyRemote`); if the cloud is empty the local data is uploaded.
 * - Afterwards every change is saved (debounced); only values whose JSON changed are written.
 * - localStorage keeps working as before, so the app still works offline or without Firebase.
 */
export function useCloudSync(
  values: Record<string, unknown>,
  applyRemote: (data: Record<string, unknown>) => void
): CloudSyncApi {
  const [status, setStatus] = useState<CloudStatus>(isFirebaseConfigured ? 'connecting' : 'disabled');
  const [user, setUser] = useState<CloudUser | null>(null);
  const [error, setError] = useState<CloudError | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [ready, setReady] = useState(false);

  const valuesRef = useRef(values);
  valuesRef.current = values;
  const applyRef = useRef(applyRemote);
  applyRef.current = applyRemote;

  const storeRef = useRef<CloudStore | null>(null);
  const baselineRef = useRef<Record<string, string>>({}); // last JSON known to be stored in the cloud
  const partsRef = useRef<Record<string, number>>({});
  const sessionRef = useRef(0); // bumped on every sign-in/out to drop stale async results
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async (): Promise<void> => {
    const store = storeRef.current;
    if (!store) return;
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    const session = sessionRef.current;
    const changed: [string, string][] = [];
    for (const [key, value] of Object.entries(valuesRef.current)) {
      const json = JSON.stringify(value ?? null);
      if (baselineRef.current[key] !== json) changed.push([key, json]);
    }
    if (changed.length === 0) return;

    savingRef.current = true;
    setStatus('saving');
    try {
      for (const [key, json] of changed) {
        const parts = await store.write(key, json, partsRef.current[key] ?? 0);
        if (session !== sessionRef.current) return;
        partsRef.current[key] = parts;
        baselineRef.current[key] = json;
      }
      setStatus('synced');
      setError(null);
      setLastSyncedAt(new Date());
    } catch (e) {
      if (session !== sessionRef.current) return;
      setStatus('error');
      setError(toCloudError(e));
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => { void flush(); }, RETRY_AFTER_ERROR_MS);
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        setTimeout(() => { void flush(); }, 300);
      }
    }
  }, []);

  const loadWorkspace = useCallback(async (uid: string, session: number) => {
    setStatus('loading');
    setReady(false);
    try {
      const store = await createFirestoreStore(uid);
      const snapshot = await store.readAll();
      if (session !== sessionRef.current) return;

      storeRef.current = store;
      partsRef.current = { ...snapshot.partCounts };
      const remoteKeys = Object.keys(snapshot.values);

      if (remoteKeys.length > 0) {
        // Existing cloud workspace: it is the source of truth
        const data: Record<string, unknown> = {};
        const baseline: Record<string, string> = {};
        for (const key of remoteKeys) {
          try {
            data[key] = JSON.parse(snapshot.values[key]);
            baseline[key] = snapshot.values[key];
          } catch {
            // Corrupted value: leave it out so the local value gets uploaded instead
          }
        }
        baselineRef.current = baseline;
        applyRef.current(data);
      } else {
        // First sign-in: the cloud is empty, upload what is in this browser
        baselineRef.current = {};
      }

      setReady(true);
      setStatus('synced');
      setError(null);
      setLastSyncedAt(new Date());
    } catch (e) {
      if (session !== sessionRef.current) return;
      storeRef.current = null;
      setStatus('error');
      setError(toCloudError(e));
    }
  }, []);

  // Restore the session and follow sign-in / sign-out
  useEffect(() => {
    if (!isFirebaseConfigured) return;
    let cancelled = false;
    let unsubscribe: () => void = () => {};

    loadFirebase()
      .then(({ auth, authMod }) => {
        if (cancelled) return;
        authMod.getRedirectResult(auth).catch(e => setError(toCloudError(e)));
        unsubscribe = authMod.onAuthStateChanged(auth, fbUser => {
          const session = ++sessionRef.current;
          storeRef.current = null;
          setReady(false);
          if (!fbUser) {
            setUser(null);
            setStatus('signed-out');
            return;
          }
          setUser({
            uid: fbUser.uid,
            name: fbUser.displayName,
            email: fbUser.email,
            photoURL: fbUser.photoURL,
          });
          void loadWorkspace(fbUser.uid, session);
        });
      })
      .catch(e => {
        if (cancelled) return;
        setStatus('error');
        setError(toCloudError(e));
      });

    return () => {
      cancelled = true;
      unsubscribe();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [loadWorkspace]);

  // Save changes (debounced)
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => { void flush(); }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [values, ready, flush]);

  // Best-effort save when the tab is hidden or closed
  useEffect(() => {
    if (!ready) return;
    const onHide = () => { void flush(); };
    const onVisibility = () => { if (document.visibilityState === 'hidden') onHide(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ready, flush]);

  const signIn = useCallback(async () => {
    try {
      setError(null);
      const { auth, authMod } = await loadFirebase();
      const provider = new authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await authMod.signInWithPopup(auth, provider);
      } catch (e) {
        const code = String((e as { code?: string })?.code || '');
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
          await authMod.signInWithRedirect(auth, provider);
          return;
        }
        throw e;
      }
    } catch (e) {
      setError(toCloudError(e));
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await flush();
      const { auth, authMod } = await loadFirebase();
      await authMod.signOut(auth);
    } catch (e) {
      setError(toCloudError(e));
    }
  }, [flush]);

  const reload = useCallback(async () => {
    if (!user) return;
    await flush();
    const session = ++sessionRef.current;
    await loadWorkspace(user.uid, session);
  }, [user, flush, loadWorkspace]);

  return { status, user, error, lastSyncedAt, signIn, signOut, reload };
}
