import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// All values come from VITE_ environment variables.
// Copy .env.example → .env and fill in your Firebase project credentials.

/**
 * Firebase configuration object used to initialize the client SDK.
 *
 * All properties are injected at build time through Vite environment variables.
 * The frontend uses this object to connect to the correct Firebase project for
 * authentication and Firestore access.
 *
 * @type {{
 *   apiKey: string,
 *   authDomain: string,
 *   projectId: string,
 *   storageBucket: string,
 *   messagingSenderId: string,
 *   appId: string,
 * }}
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
 *
 * This is the root Firebase object passed into auth and Firestore initializers.
 *
 * @type {import("firebase/app").FirebaseApp}
 */
const app = initializeApp(firebaseConfig);

/**
 * Firebase Authentication instance used by the client.
 *
 * Components can import this object anywhere they need to sign in users,
 * observe auth state, or retrieve ID tokens for authenticated API requests.
 *
 * @type {import("firebase/auth").Auth}
 */
export const auth = getAuth(app);

/**
 * Google authentication provider used for browser sign-in flows.
 *
 * This provider is typically passed into Firebase auth helper functions such as
 * signInWithPopup or signInWithRedirect.
 *
 * @type {import("firebase/auth").GoogleAuthProvider}
 */
export const googleProvider = new GoogleAuthProvider();

/**
 * Firestore database instance used by the frontend.
 *
 * This is the primary entry point for reading and writing user settings,
 * watched courses, and other app data stored in Firebase.
 *
 * @type {import("firebase/firestore").Firestore}
 */
export const db = getFirestore(app);
