import { initializeApp } from "firebase/app";
import {
  initializeAuth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
} from "firebase/auth";

/**
 * Firebase is used for Google sign-in ONLY. All data access goes through the
 * API server — the browser never talks to Firestore (and firestore.rules
 * denies it outright). That keeps the bundle small and the data model
 * server-validated.
 */
const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

/** initializeAuth with explicit deps tree-shakes better than getAuth(). */
export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
  popupRedirectResolver: browserPopupRedirectResolver,
});

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
