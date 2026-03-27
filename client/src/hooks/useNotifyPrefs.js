import { useEffect, useState, useCallback } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../firebase";

/**
 * Default notification preference values used before Firestore data loads and
 * as a fallback for any missing fields in the stored document.
 *
 * @type {{
 *   email: boolean,
 *   discord: boolean,
 *   discordWebhook: string,
 *   discordTagMe: boolean,
 *   discordUserId: string,
 *   pollInterval: number,
 * }}
 */
export const DEFAULT_NOTIFY_PREFS = {
  email: false,
  discord: false,
  discordWebhook: "",
  discordTagMe: false,
  discordUserId: "",
  pollInterval: 60_000, // ms; enforced server-side (min 30 s for normal users, 1 s for auth)
};

/**
 * Subscribes to and updates the current user's notification preferences stored
 * in Firestore at users/{uid}.notifyPrefs.
 *
 * The hook returns the latest merged preference object plus a save function that
 * writes the full notifyPrefs payload back to Firestore.
 *
 * @param {string | undefined | null} uid - Firebase user ID.
 * @returns {{
 *   prefs: typeof DEFAULT_NOTIFY_PREFS,
 *   savePrefs: (newPrefs: typeof DEFAULT_NOTIFY_PREFS) => Promise<void>,
 * }}
 */
export function useNotifyPrefs(uid) {
  const [prefs, setPrefs] = useState(DEFAULT_NOTIFY_PREFS);

  /**
   * Subscribes to the user's Firestore document and keeps local preference state
   * synchronized in real time.
   *
   * @returns {() => void | undefined}
   */
  useEffect(() => {
    if (!uid) {
      setPrefs(DEFAULT_NOTIFY_PREFS);
      return;
    }

    const ref = doc(db, "users", uid);
    const unsub = onSnapshot(ref, (snap) => {
      setPrefs({
        ...DEFAULT_NOTIFY_PREFS,
        ...(snap.data()?.notifyPrefs ?? {}),
      });
    });

    return unsub;
  }, [uid]);

  /**
   * Saves a new notification preference object to Firestore.
   *
   * @param {typeof DEFAULT_NOTIFY_PREFS} newPrefs - New preference values.
   * @returns {Promise<void>}
   */
  const savePrefs = useCallback(
    async (newPrefs) => {
      if (!uid) return;
      await updateDoc(doc(db, "users", uid), { notifyPrefs: newPrefs });
    },
    [uid],
  );

  return { prefs, savePrefs };
}
