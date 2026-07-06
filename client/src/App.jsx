import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import SearchForm from "./components/SearchForm";
import CourseTable from "./components/CourseTable";
import WatchlistPanel from "./components/WatchlistPanel";
import NotifyPrefsPanel from "./components/NotifyPrefsPanel";
import LoginPage from "./components/LoginPage";
import UserMenu from "./components/UserMenu";
import LanguageSwitcher from "./components/LanguageSwitcher";
import WelcomeBanner from "./components/WelcomeBanner";
import { useAuth } from "./context/AuthContext";
import { useWatchedCourses } from "./hooks/useWatchedCourses";
import { useNotifyPrefs } from "./hooks/useNotifyPrefs";
import { auth } from "./firebase";
import { isFull } from "./utils/course";
import "./index.css";

/**
 * Base URL for backend API requests.
 *
 * In development this is usually an empty string so requests go through the Vite
 * dev server and its proxy configuration. In production it can be set to a full
 * backend origin via VITE_API_URL.
 *
 * @type {string}
 */
const API_BASE = import.meta.env.VITE_API_URL ?? "";

/**
 * Client-side auto-refresh interval used while the search page is actively
 * polling.
 *
 * This timer controls how often the browser re-runs the current search query.
 * It is separate from the server-side watched-course notification poller.
 *
 * @type {number}
 */
/**
 * Built-in semester list used to seed the dropdown so it always renders, even
 * before (or if) the live list from the backend loads.
 *
 * @type {Array<{ Semester: string, EngSemester: string }>}
 */
const FALLBACK_SEMESTERS = [
  { Semester: "1151", EngSemester: "2026 Fall" },
  { Semester: "114H", EngSemester: "2026 Summer" },
  { Semester: "1142", EngSemester: "2026 Spring" },
  { Semester: "1141", EngSemester: "2025 Fall" },
  { Semester: "113H", EngSemester: "2025 Summer" },
  { Semester: "1132", EngSemester: "2025 Spring" },
  { Semester: "1131", EngSemester: "2024 Fall" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Inner component – only rendered when the user is authenticated.
// Keeping it separate ensures all hooks are called unconditionally.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main authenticated application view.
 *
 * This component coordinates the course search workflow, the user's watchlist,
 * notification preferences, and lightweight in-browser polling that refreshes
 * the current search results.
 *
 * @param {{ uid: string }} props - Component props.
 * @param {string} props.uid - Firebase user ID of the authenticated user.
 * @returns {JSX.Element}
 */
function TrackerApp({ uid }) {
  const { t, i18n } = useTranslation();
  const {
    watchedCourses,
    watchCourse,
    unwatchCourse,
    isWatched,
    toggleNotify,
    isNotifyEnabled,
  } = useWatchedCourses(uid);
  const { prefs, savePrefs } = useNotifyPrefs(uid);

  const [query, setQuery] = useState({
    Semester: "1142",
    CourseNo: "",
    CourseName: "",
    CourseTeacher: "",
  });

  const [semesters, setSemesters] = useState(FALLBACK_SEMESTERS);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeTab, setActiveTab] = useState("search");
  const [statusFilter, setStatusFilter] = useState("all");
  const [liveWatched, setLiveWatched] = useState(() => new Map());
  const [watchlistRefreshing, setWatchlistRefreshing] = useState(false);
  const [watchlistUpdated, setWatchlistUpdated] = useState(null);

  const fetchCourses = useCallback(
    async () => {
      if (!query.CourseNo && !query.CourseName && !query.CourseTeacher) {
        setError(t("errors.noSearchField"));
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(`${API_BASE}/api/courses`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(query),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        const data = await res.json();
        setCourses(data);
        setHasSearched(true);
        setLastUpdated(new Date());
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [query, t],
  );

  /**
   * Loads the list of available semesters once so the search form can render a
   * dropdown. Merges API results with FALLBACK_SEMESTERS so the current
   * selection always remains available, even if the NTUST API has dropped older
   * semesters from its list. Never mutates query.Semester — changing the
   * semester state would recreate fetchCourses and retrigger the polling effect,
   * causing a silent mid-search semester switch that returns 0 results.
   *
   * @returns {void}
   */
  useEffect(() => {
    let cancelled = false;

    async function loadSemesters() {
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch(`${API_BASE}/api/semesters`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data) || data.length === 0) return;

        // Prepend any FALLBACK entries absent from the API so the current
        // semester selection always has a matching <option>.
        const merged = [
          ...data,
          ...FALLBACK_SEMESTERS.filter(
            (fs) => !data.some((s) => s.Semester === fs.Semester),
          ),
        ];
        setSemesters(merged);
      } catch {
        // Keep the fallback list if the fetch fails.
      }
    }

    loadSemesters();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Latest watchlist snapshot, readable from the stable refreshWatchlist
   * callback without retriggering the tab-open effect on every Firestore sync.
   *
   * @type {import("react").MutableRefObject<Array<Record<string, any>>>}
   */
  const watchedRef = useRef(watchedCourses);
  useEffect(() => {
    watchedRef.current = watchedCourses;
  }, [watchedCourses]);

  /**
   * Fetches live enrollment for every watched course via the course-search
   * proxy. Firestore only stores enrollment as of the moment the course was
   * starred, so without this the watchlist would show stale seat counts.
   *
   * Runs one request per watched course (the NTUST API has no batch lookup);
   * triggered only on tab open and manual refresh to stay well inside the
   * backend's 30 req/min course-route rate limit.
   *
   * @returns {Promise<void>}
   */
  const refreshWatchlist = useCallback(async () => {
    const watched = watchedRef.current;
    if (watched.length === 0) return;

    setWatchlistRefreshing(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const results = await Promise.all(
        watched.map(async (c) => {
          try {
            const res = await fetch(`${API_BASE}/api/courses`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({
                Semester: c.Semester ?? "",
                CourseNo: c.CourseNo,
                CourseName: "",
                CourseTeacher: "",
              }),
            });
            if (!res.ok) return null;
            const data = await res.json();
            return Array.isArray(data)
              ? (data.find((d) => d.CourseNo === c.CourseNo) ?? null)
              : null;
          } catch {
            return null;
          }
        }),
      );

      setLiveWatched((prev) => {
        const next = new Map(prev);
        results.forEach((r) => {
          if (r) next.set(r.CourseNo, r);
        });
        return next;
      });
      setWatchlistUpdated(new Date());
    } finally {
      setWatchlistRefreshing(false);
    }
  }, []);

  /**
   * Refreshes live watchlist enrollment whenever the Watchlist tab is opened.
   *
   * @returns {void}
   */
  useEffect(() => {
    if (activeTab === "watched") refreshWatchlist();
  }, [activeTab, refreshWatchlist]);

  /**
   * Watched courses overlaid with the freshest enrollment data. notifyEnabled
   * always comes from Firestore since the NTUST record doesn't carry it.
   */
  const mergedWatched = useMemo(
    () =>
      watchedCourses.map((c) => {
        const live = liveWatched.get(c.CourseNo);
        return live ? { ...c, ...live, notifyEnabled: c.notifyEnabled } : c;
      }),
    [watchedCourses, liveWatched],
  );

  function handleSearch() {
    fetchCourses();
  }

  // Search result counts + client-side status filter.
  const openCount = courses.filter((c) => !isFull(c)).length;
  const filteredCourses =
    statusFilter === "open"
      ? courses.filter((c) => !isFull(c))
      : statusFilter === "full"
        ? courses.filter(isFull)
        : courses;

  const watchedNotify = mergedWatched.filter((c) => c.notifyEnabled).length;

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              📚
            </span>
            <div>
              <h1>{t("common.appName")}</h1>
              <p className="subtitle">{t("header.subtitle")}</p>
            </div>
          </div>
          <div className="header-actions">
            <LanguageSwitcher />
            <UserMenu />
          </div>
        </div>

        <nav className="tabs" aria-label={t("header.nav")}>
          <button
            className={`tab ${activeTab === "search" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("search")}
          >
            <span aria-hidden="true">🔍</span> {t("header.tabSearch")}
          </button>
          <button
            className={`tab ${activeTab === "watched" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("watched")}
          >
            <span aria-hidden="true">★</span> {t("header.tabWatchlist")}
            {watchedCourses.length > 0 && (
              <span className="tab-badge">{watchedCourses.length}</span>
            )}
          </button>
          <button
            className={`tab ${activeTab === "notifications" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("notifications")}
          >
            <span aria-hidden="true">🔔</span> {t("header.tabNotifications")}
          </button>
        </nav>
      </header>

      <main className="app-main">
        <WelcomeBanner />

        {activeTab === "search" && (
          <SearchForm
            query={query}
            semesters={semesters}
            onChange={setQuery}
            onSearch={handleSearch}
            loading={loading}
          />
        )}

        {error && (
          <div className="error-banner" role="alert">
            <span aria-hidden="true">⚠</span> {error}
          </div>
        )}

        {activeTab === "search" && lastUpdated && (
          <div className="status-bar">
            <div
              className="filter-chips"
              role="group"
              aria-label={t("filter.label")}
            >
              {[
                { key: "all", count: courses.length },
                { key: "open", count: openCount },
                { key: "full", count: courses.length - openCount },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`chip chip-${f.key} ${statusFilter === f.key ? "chip-active" : ""}`}
                  aria-pressed={statusFilter === f.key}
                  onClick={() => setStatusFilter(f.key)}
                >
                  {t(`filter.${f.key}`)}
                  <span className="chip-count">{f.count}</span>
                </button>
              ))}
            </div>
            <span className="status-bar-right">
              {t("status.updated", {
                time: lastUpdated.toLocaleTimeString(i18n.language),
              })}
            </span>
          </div>
        )}

        {activeTab === "search" && !hasSearched && !loading && (
          <div className="placeholder">
            <span className="placeholder-icon" aria-hidden="true">
              🔎
            </span>
            <p className="placeholder-title">{t("placeholder.searchTitle")}</p>
            <p className="placeholder-hint">{t("placeholder.searchHint")}</p>
          </div>
        )}

        {activeTab === "search" && hasSearched && !loading && courses.length === 0 && (
          <div className="placeholder">
            <span className="placeholder-icon" aria-hidden="true">
              🗂️
            </span>
            <p className="placeholder-title">{t("placeholder.noMatchTitle")}</p>
            <p className="placeholder-hint">{t("placeholder.noMatchHint")}</p>
          </div>
        )}

        {activeTab === "search" &&
          hasSearched &&
          !loading &&
          courses.length > 0 &&
          filteredCourses.length === 0 && (
            <div className="placeholder placeholder-compact">
              <p className="placeholder-title">
                {statusFilter === "open"
                  ? t("filter.emptyOpen")
                  : t("filter.emptyFull")}
              </p>
              <p className="placeholder-hint">{t("filter.emptyHint")}</p>
            </div>
          )}

        {activeTab === "watched" && watchedCourses.length === 0 && (
          <div className="placeholder">
            <span className="placeholder-icon" aria-hidden="true">
              ⭐
            </span>
            <p className="placeholder-title">{t("placeholder.emptyWatchlistTitle")}</p>
            <p className="placeholder-hint">{t("placeholder.emptyWatchlistHint")}</p>
          </div>
        )}

        {activeTab === "search" && (
          <CourseTable
            courses={filteredCourses}
            loading={loading}
            isWatched={isWatched}
            onWatch={watchCourse}
            onUnwatch={unwatchCourse}
            isNotifyEnabled={isNotifyEnabled}
            onToggleNotify={toggleNotify}
          />
        )}

        {activeTab === "watched" && watchedCourses.length > 0 && (
          <WatchlistPanel
            courses={mergedWatched}
            refreshing={watchlistRefreshing}
            lastUpdated={watchlistUpdated}
            onRefresh={refreshWatchlist}
            onToggleNotify={toggleNotify}
            onUnwatch={unwatchCourse}
          />
        )}

        {activeTab === "notifications" && (
          <NotifyPrefsPanel
            prefs={prefs}
            onSave={savePrefs}
            watchedCount={watchedCourses.length}
            notifyEnabledCount={watchedNotify}
          />
        )}
      </main>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component – resolves auth then renders the right screen.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Root application component.
 *
 * @returns {JSX.Element}
 */
function App() {
  const { user } = useAuth();

  if (user === undefined) {
    // Firebase is still initialising.
    return (
      <div className="app-loading">
        <div className="spinner" />
      </div>
    );
  }

  if (user === null) return <LoginPage />;

  return <TrackerApp uid={user.uid} />;
}

export default App;
