import { createContext, useContext, useEffect, useState } from "react";
import {
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, googleProvider, db } from "../firebase";

/**
 * React context used to expose authentication state and auth actions to the
 * rest of the application.
 *
 * @type {import("react").Context<{
 *   user: import("firebase/auth").User | null | undefined,
 *   signInWithGoogle: () => Promise<void>,
 *   signOut: () => Promise<void>,
 * } | null>}
 */
const AuthContext = createContext(null);

/**
 * Authentication provider that wraps the application.
 *
 * This component keeps track of Firebase auth state and exposes the current
 * user plus sign-in/sign-out helpers through React context.
 *
 * @param {{ children: import("react").ReactNode }} props - Component props.
 * @returns {JSX.Element}
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out

  /**
   * Subscribes to Firebase auth state changes and keeps the local user state in
   * sync with the current session.
   *
   * @returns {() => void}
   */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser ?? null);
    });
    return unsub;
  }, []);

  /**
   * Starts a Google popup sign-in flow and upserts the user's profile document
   * in Firestore after successful authentication.
   *
   * @returns {Promise<void>}
   */
  async function signInWithGoogle() {
    const result = await signInWithPopup(auth, googleProvider);
    const u = result.user;

    // Upsert user document in Firestore.
    await setDoc(
      doc(db, "users", u.uid),
      {
        uid: u.uid,
        email: u.email,
        displayName: u.displayName,
        photoURL: u.photoURL,
        lastLogin: serverTimestamp(),
      },
      { merge: true }, // preserve existing fields like createdAt
    );
  }

  /**
   * Signs the current user out of Firebase Authentication.
   *
   * @returns {Promise<void>}
   */
  async function signOut() {
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
/**
 * Returns the current authentication context.
 *
 * This hook must only be used inside the AuthProvider tree.
 *
 * @returns {{
 *   user: import("firebase/auth").User | null | undefined,
 *   signInWithGoogle: () => Promise<void>,
 *   signOut: () => Promise<void>,
 * }}
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
