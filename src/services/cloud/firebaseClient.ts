/**
 * Firebase client configuration.
 *
 * The web config is read from VITE_FIREBASE_* environment variables (set them in
 * Vercel → Project → Settings → Environment Variables, or in .env.local for local runs).
 * These values are public client identifiers, not secrets: access to the data is
 * protected by Firebase Authentication + Firestore security rules (see firestore.rules).
 *
 * The SDK is loaded lazily, so the app stays fully functional (localStorage only)
 * and does not download Firebase at all when the variables are not set.
 */
const env = (import.meta.env ?? {}) as ImportMetaEnv; // undefined outside Vite (e.g. node scripts)

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

/**
 * Shared mode: one secret workspace id for everybody who opens the site (VITE_SHARED_WORKSPACE).
 * The app signs in anonymously by itself, so nobody has to log in on any device: the link is the key.
 * Without it the data is private to each Google account (users/{uid}).
 */
export const SHARED_WORKSPACE: string | null = (env.VITE_SHARED_WORKSPACE || '').trim() || null;
/** Firestore root collection of the workspace */
export const CLOUD_ROOT = SHARED_WORKSPACE ? 'workspaces' : 'users';

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId
);

export interface FirebaseHandles {
  auth: import('firebase/auth').Auth;
  db: import('firebase/firestore').Firestore;
  authMod: typeof import('firebase/auth');
  fsMod: typeof import('firebase/firestore');
}

let handlesPromise: Promise<FirebaseHandles> | null = null;

export function loadFirebase(): Promise<FirebaseHandles> {
  if (!isFirebaseConfigured) {
    return Promise.reject(new Error('Firebase is not configured'));
  }
  if (!handlesPromise) {
    handlesPromise = (async () => {
      const [{ initializeApp }, authMod, fsMod] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore'),
      ]);
      const app = initializeApp(firebaseConfig);
      const auth = authMod.getAuth(app);
      const db = fsMod.getFirestore(app);
      // Local testing against the Firebase emulators (`npx firebase-tools emulators:start`)
      if (env.VITE_FIREBASE_USE_EMULATOR === 'true') {
        authMod.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        fsMod.connectFirestoreEmulator(db, '127.0.0.1', 8080);
        // Test helper (emulator builds only): sign in with a fake Google account without the popup
        (window as unknown as Record<string, unknown>).__ploptEmulatorSignIn = (email: string) =>
          authMod.signInWithCredential(
            auth,
            authMod.GoogleAuthProvider.credential(JSON.stringify({ sub: email, email, email_verified: true, name: email.split('@')[0] }))
          );
      }
      return { auth, db, authMod, fsMod };
    })();
    handlesPromise.catch(() => {
      handlesPromise = null; // allow a retry after e.g. a network failure while loading the SDK
    });
  }
  return handlesPromise;
}
