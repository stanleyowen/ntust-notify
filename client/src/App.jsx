import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation, Trans } from "react-i18next";
import SearchForm from "./components/SearchForm";
import CourseTable from "./components/CourseTable";
import NotifyPrefsPanel from "./components/NotifyPrefsPanel";
import LoginPage from "./components/LoginPage";
import UserMenu from "./components/UserMenu";
import LanguageSwitcher from "./components/LanguageSwitcher";
import WelcomeBanner from "./components/WelcomeBanner";
import { useAuth } from "./context/AuthContext";
import { useWatchedCourses } from "./hooks/useWatchedCourses";
import { useNotifyPrefs } from "./hooks/useNotifyPrefs";
import { auth } from "./firebase";
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
const POLL_INTERVAL_MS = 60_000;

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

/**
 * Determines whether a course is currently full.
 *
 * @param {{ Restrict1: string | number, ChooseStudent: number }} course - Course record returned by the backend.
 * @returns {boolean}
 */
function isFull(course) {
  const limit = parseInt(course.Restrict1, 10);
  return !isNaN(limit) && limit > 0 && course.ChooseStudent >= limit;
}

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
  const [toasts, setToasts] = useState([]);
  const [isPolling, setIsPolling] = useState(false);
  const [activeTab, setActiveTab] = useState("search");

  /**
   * Stores the previous known fullness state for each searched course so the UI
   * can surface a toast when a course transitions from FULL to OPEN while the
   * user is actively watching the search results page.
   *
   * @type {import("react").MutableRefObject<Map<string, { wasFull: boolean }>>}
   */
  const prevStateRef = useRef(new Map());

  /**
   * Removes a toast by id.
   *
   * @param {number} id - Toast identifier.
   * @returns {void}
   */
  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * Adds a temporary toast notification to the UI and removes it automatically
   * after a short delay.
   *
   * @param {string} message - Message text to display in the toast.
   * @returns {void}
   */
  const addToast = useCallback(
    (message) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, message }]);
      setTimeout(() => dismissToast(id), 8000);
    },
    [dismissToast],
  );

  /**
   * Fetches courses for the current query from the backend.
   *
   * @param {boolean} [isInitial=false] - Whether this fetch is the first cycle of a polling session.
   * @returns {Promise<void>}
   */
  const fetchCourses = useCallback(
    async (isInitial = false) => {
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

        if (isInitial) {
          // Seed state on first fetch – no alerts yet.
          const map = new Map();
          data.forEach((c) => map.set(c.CourseNo, { wasFull: isFull(c) }));
          prevStateRef.current = map;
        } else {
          // Check for slot openings relative to the previous poll result.
          data.forEach((course) => {
            const prev = prevStateRef.current.get(course.CourseNo);
            const nowFull = isFull(course);
            if (prev?.wasFull && !nowFull) {
              addToast(
                t("toast.slotOpened", {
                  courseNo: course.CourseNo,
                  courseName: course.CourseName,
                }),
              );
            }
            prevStateRef.current.set(course.CourseNo, { wasFull: nowFull });
          });
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [query, addToast, t],
  );

  /**
   * Starts or stops the client-side polling loop depending on isPolling.
   *
   * @returns {void}
   */
  useEffect(() => {
    if (!isPolling) return;

    fetchCourses(true);
    const intervalId = setInterval(() => fetchCourses(false), POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [isPolling, fetchCourses]);

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
   * Starts a fresh polling session for the current search query.
   *
   * @returns {void}
   */
  function handleSearch() {
    setIsPolling(false);
    setTimeout(() => setIsPolling(true), 0);
  }

  /**
   * Stops the client-side search polling loop.
   *
   * @returns {void}
   */
  function handleStopPolling() {
    setIsPolling(false);
  }

  const displayedCourses = activeTab === "watched" ? watchedCourses : courses;
  const showCourseTable = activeTab === "search" || activeTab === "watched";

  // Watchlist summary stats.
  const watchedOpen = watchedCourses.filter((c) => !isFull(c)).length;
  const watchedNotify = watchedCourses.filter((c) =>
    isNotifyEnabled(c.CourseNo),
  ).length;

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
            onStop={handleStopPolling}
            isPolling={isPolling}
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
            <span>
              <Trans
                i18nKey="status.coursesFound"
                count={courses.length}
                values={{ count: courses.length }}
                components={[<strong key="0" />]}
              />
            </span>
            <span className="status-bar-right">
              {t("status.updated", {
                time: lastUpdated.toLocaleTimeString(i18n.language),
              })}
              {isPolling && (
                <span className="polling-badge">
                  <span className="pulse-dot" /> {t("status.autoRefreshing")}
                </span>
              )}
            </span>
          </div>
        )}

        {activeTab === "watched" && watchedCourses.length > 0 && (
          <div className="status-bar">
            <span>
              <Trans
                i18nKey="status.watchedSummary"
                values={{ count: watchedCourses.length, open: watchedOpen }}
                components={[<strong key="0" />, <span key="1" />, <span key="2" className="stat-open" />]}
              />
            </span>
            <span className="status-bar-right">
              <span aria-hidden="true">🔔</span>{" "}
              {t("status.alertsOn", { count: watchedNotify })}
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

        {activeTab === "watched" && watchedCourses.length === 0 && (
          <div className="placeholder">
            <span className="placeholder-icon" aria-hidden="true">
              ⭐
            </span>
            <p className="placeholder-title">{t("placeholder.emptyWatchlistTitle")}</p>
            <p className="placeholder-hint">{t("placeholder.emptyWatchlistHint")}</p>
          </div>
        )}

        {showCourseTable && (
          <CourseTable
            courses={displayedCourses}
            loading={loading && activeTab === "search"}
            isWatched={isWatched}
            onWatch={watchCourse}
            onUnwatch={unwatchCourse}
            isNotifyEnabled={isNotifyEnabled}
            onToggleNotify={toggleNotify}
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

      {/* Toast notifications */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast" role="status">
            <span className="toast-message">{toast.message}</span>
            <button
              className="toast-close"
              onClick={() => dismissToast(toast.id)}
              aria-label={t("toast.dismiss")}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
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
