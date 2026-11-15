import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { auth, googleProvider } from "../firebase";

/**
 * @typedef {{
 *   user: import("firebase/auth").User | null | undefined,
 *   signIn: () => Promise<void>,
 *   signOut: () => Promise<void>,
 * }} AuthValue
 */

const AuthContext = createContext(/** @type {AuthValue | null} */ (null));

/** Errors that just mean "the user changed their mind" — not worth showing. */
const SILENT_ERRORS = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);

/**
 * Provides Firebase auth state. `user` is undefined while Firebase restores
 * the session, null when signed out.
 *
 * @param {{ children: import("react").ReactNode }} props
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(/** @type {AuthValue["user"]} */ (undefined));

  useEffect(() => {
    // Completes a redirect sign-in (the fallback when popups are blocked).
    getRedirectResult(auth).catch(() => {});
    return onAuthStateChanged(auth, (u) => setUser(u ?? null));
  }, []);

  const signIn = useCallback(async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = /** @type {{ code?: string }} */ (err)?.code ?? "";
      if (SILENT_ERRORS.has(code)) return;
      if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      throw err;
    }
  }, []);

  const signOut = useCallback(() => firebaseSignOut(auth), []);

  const value = useMemo(() => ({ user, signIn, signOut }), [user, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** @returns {AuthValue} */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
