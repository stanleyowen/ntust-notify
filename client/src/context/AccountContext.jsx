import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, errorMessage } from "../lib/api";
import { alertStatus } from "../lib/course";
import { useToast } from "./ToastContext";
import { useAuth } from "./AuthContext";

/**
 * @typedef {{
 *   email: boolean, discord: boolean, discordWebhook: string,
 *   discordTagMe: boolean, discordUserId: string, pollInterval: number,
 * }} Prefs
 *
 * @typedef {Record<string, any> & { CourseNo: string, Semester: string | null, notifyEnabled: boolean }} WatchedCourse
 */

const AccountContext = createContext(/** @type {ReturnType<typeof useAccountState> | null} */ (null));

const REFETCH_AFTER_MS = 60_000;

function useAccountState() {
  const { t } = useTranslation();
  const toast = useToast();
  const { signOut } = useAuth();

  const [status, setStatus] = useState(/** @type {"loading" | "ready" | "error"} */ ("loading"));
  const [loadError, setLoadError] = useState(/** @type {string | null} */ (null));
  const [profile, setProfile] = useState(/** @type {{ uid: string, email: string, displayName: string, photoURL: string } | null} */ (null));
  const [prefs, setPrefs] = useState(/** @type {Prefs | null} */ (null));
  const [watchlist, setWatchlist] = useState(/** @type {WatchedCourse[]} */ ([]));
  const [limits, setLimits] = useState({ maxWatched: 30, alertDurationDays: 30, pollOptions: [30_000, 60_000, 180_000, 300_000, 600_000], privileged: false });
  const [emailAvailable, setEmailAvailable] = useState(true);
  const [pending, setPending] = useState(() => new Set());
  const [live, setLive] = useState(() => ({ map: new Map(), updatedAt: /** @type {number | null} */ (null), loading: false }));
  const lastLoad = useRef(0);
  const watchlistRef = useRef(watchlist);
  watchlistRef.current = watchlist;
  const limitsRef = useRef(limits);
  limitsRef.current = limits;

  /** @param {any} data */
  const apply = useCallback((data) => {
    setProfile(data.user);
    setPrefs(data.prefs);
    setWatchlist(data.watchlist);
    setLimits(data.limits);
    setEmailAvailable(data.emailAvailable !== false);
    setStatus("ready");
    setLoadError(null);
    lastLoad.current = Date.now();
  }, []);

  /** @param {{ session?: boolean, silent?: boolean }} [opts] */
  const load = useCallback(
    async ({ session = false, silent = false } = {}) => {
      if (!silent) setStatus((s) => (s === "ready" ? s : "loading"));
      try {
        apply(await api(session ? "/api/session" : "/api/me", { method: session ? "POST" : "GET" }));
      } catch (err) {
        if (silent) return;
        setLoadError(errorMessage(err, t));
        setStatus("error");
      }
    },
    [apply, t],
  );

  useEffect(() => {
    load({ session: true });
  }, [load]);

  // Cross-device sync: refetch when the tab regains focus after a while.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current > REFETCH_AFTER_MS) {
        load({ silent: true });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  /** @param {string} courseNo @param {boolean} on */
  const markPending = (courseNo, on) =>
    setPending((s) => {
      const next = new Set(s);
      if (on) next.add(courseNo);
      else next.delete(courseNo);
      return next;
    });

  /**
   * Adds a course (alerts on by default — that's why people watch).
   *
   * @param {Record<string, any>} course - Search result.
   * @param {{ notifyEnabled?: boolean, quiet?: boolean }} [opts]
   */
  const watch = useCallback(
    async (course, { notifyEnabled = true, quiet = false } = {}) => {
      const courseNo = course.CourseNo;
      markPending(courseNo, true);
      const days = limitsRef.current.alertDurationDays;
      const optimistic = {
        ...course,
        notifyEnabled,
        alertsExpireAt: notifyEnabled ? Date.now() + days * 86_400_000 : null,
        addedAt: Date.now(),
      };
      setWatchlist((list) => (list.some((c) => c.CourseNo === courseNo) ? list : [...list, optimistic]));
      try {
        const { course: saved } = await api(`/api/watchlist/${encodeURIComponent(courseNo)}`, {
          method: "PUT",
          body: { semester: course.Semester, notifyEnabled },
        });
        setWatchlist((list) => list.map((c) => (c.CourseNo === courseNo ? saved : c)));
        if (!quiet) toast(t("toast.watched", { name: course.CourseName || courseNo, days }), { tone: "success" });
        return true;
      } catch (err) {
        setWatchlist((list) => list.filter((c) => c !== optimistic));
        toast(errorMessage(err, t), { tone: "error" });
        return false;
      } finally {
        markPending(courseNo, false);
      }
    },
    [t, toast],
  );

  /** @param {string} courseNo */
  const unwatch = useCallback(
    async (courseNo) => {
      const prev = watchlistRef.current.find((c) => c.CourseNo === courseNo);
      if (!prev) return;
      markPending(courseNo, true);
      setWatchlist((list) => list.filter((c) => c.CourseNo !== courseNo));
      try {
        await api(`/api/watchlist/${encodeURIComponent(courseNo)}`, { method: "DELETE" });
        toast(t("toast.removed", { name: prev.CourseName || courseNo }), {
          action: prev.Semester
            ? { label: t("toast.undo"), onClick: () => watch(prev, { notifyEnabled: alertStatus(prev).on, quiet: true }) }
            : undefined,
        });
      } catch (err) {
        setWatchlist((list) => (list.some((c) => c.CourseNo === courseNo) ? list : [...list, prev]));
        toast(errorMessage(err, t), { tone: "error" });
      } finally {
        markPending(courseNo, false);
      }
    },
    [t, toast, watch],
  );

  /**
   * Turns a course's alerts on/off. Turning on (or "extending" while on)
   * restarts the server-side countdown.
   *
   * @param {string} courseNo
   * @param {boolean} enabled
   * @param {{ extend?: boolean }} [opts]
   */
  const setAlerts = useCallback(
    async (courseNo, enabled, { extend = false } = {}) => {
      const prev = watchlistRef.current.find((c) => c.CourseNo === courseNo);
      if (!prev) return;
      const days = limitsRef.current.alertDurationDays;
      const replace = (entry) => setWatchlist((list) => list.map((c) => (c.CourseNo === courseNo ? entry : c)));
      replace(enabled ? { ...prev, notifyEnabled: true, alertsExpireAt: Date.now() + days * 86_400_000 } : { ...prev, notifyEnabled: false });
      try {
        const { course } = await api(`/api/watchlist/${encodeURIComponent(courseNo)}`, { method: "PATCH", body: { notifyEnabled: enabled } });
        replace(course);
        if (extend) toast(t("toast.extended", { days }), { tone: "success" });
      } catch (err) {
        replace(prev);
        toast(errorMessage(err, t), { tone: "error" });
      }
    },
    [t, toast],
  );

  /**
   * Saves preferences. Throws so forms can show the error inline.
   *
   * @param {Prefs} next
   */
  const savePrefs = useCallback(async (next) => {
    const { prefs: saved } = await api("/api/me/prefs", { method: "PUT", body: next });
    setPrefs(saved);
    return saved;
  }, []);

  /** One-click "use email" from the setup prompts. */
  const enableEmail = useCallback(async () => {
    if (!prefs) return;
    try {
      await savePrefs({ ...prefs, email: true });
      toast(t("toast.emailOn"), { tone: "success" });
    } catch (err) {
      toast(errorMessage(err, t), { tone: "error" });
    }
  }, [prefs, savePrefs, t, toast]);

  const lastLiveFetch = useRef(0);
  /** @param {{ force?: boolean }} [opts] - force bypasses the 15 s throttle (manual refresh). */
  const refreshLive = useCallback(async ({ force = false } = {}) => {
    if (watchlistRef.current.length === 0) return;
    if (!force && Date.now() - lastLiveFetch.current < 15_000) return;
    lastLiveFetch.current = Date.now();
    setLive((l) => ({ ...l, loading: true }));
    try {
      const { courses } = await api("/api/watchlist/live");
      setLive({ map: new Map(courses.filter((c) => !c.missing).map((c) => [c.CourseNo, c])), updatedAt: Date.now(), loading: false });
    } catch (err) {
      setLive((l) => ({ ...l, loading: false }));
      toast(errorMessage(err, t), { tone: "error" });
    }
  }, [t, toast]);

  const deleteAccount = useCallback(async () => {
    await api("/api/me", { method: "DELETE" });
    await signOut();
  }, [signOut]);

  /** Watchlist with the freshest seat counts overlaid. */
  const courses = useMemo(
    () =>
      watchlist.map((c) => {
        const l = live.map.get(c.CourseNo);
        const merged = l
          ? { ...c, ChooseStudent: l.ChooseStudent, Restrict1: l.Restrict1, ClassRoomNo: l.ClassRoomNo ?? c.ClassRoomNo, live: true, stale: l.stale }
          : c;
        return { ...merged, alerts: alertStatus(merged) };
      }),
    [watchlist, live.map],
  );

  const watchedSet = useMemo(() => new Set(watchlist.map((c) => c.CourseNo)), [watchlist]);
  const hasChannel = Boolean(prefs && (prefs.email || prefs.discord));

  return {
    status,
    loadError,
    reload: () => load({ session: true }),
    profile,
    prefs,
    limits,
    emailAvailable,
    hasChannel,
    courses,
    watchedSet,
    pending,
    live: { updatedAt: live.updatedAt, loading: live.loading },
    watch,
    unwatch,
    setAlerts,
    savePrefs,
    enableEmail,
    refreshLive,
    deleteAccount,
  };
}

/** @param {{ children: import("react").ReactNode }} props */
export function AccountProvider({ children }) {
  const value = useAccountState();
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used inside <AccountProvider>");
  return ctx;
}
