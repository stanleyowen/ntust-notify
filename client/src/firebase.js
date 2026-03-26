import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// All values come from VITE_ environment variables.
// Copy .env.example → .env and fill in your Firebase project credentials.
/**
 * Firebase configuration object consumed by the client SDK. All values are
 * injected at build time via Vite environment variables.
 */
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/**
 * Shared Firebase application instance for the frontend.
 */
const app = initializeApp(firebaseConfig);

/**
 * Firebase Authentication instance used throughout the client.
 */
export const auth = getAuth(app);

/**
 * Google sign-in provider used for browser-based authentication flows.
 */
export const googleProvider = new GoogleAuthProvider();

/**
 * Firestore instance used by the frontend to read and write app data.
 */
export const db = getFirestore(app);
