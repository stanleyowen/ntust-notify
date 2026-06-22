import { useState, useEffect, useCallback, useRef } from "react";
import SearchForm from "./components/SearchForm";
import CourseTable from "./components/CourseTable";
import NotifyPrefsPanel from "./components/NotifyPrefsPanel";
import LoginPage from "./components/LoginPage";
import UserMenu from "./components/UserMenu";
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
        setError("Enter at least one search field — course no., name, or teacher.");
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
              addToast(`🎉 Slot opened: ${course.CourseNo} ${course.CourseName}`);
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
    [query, addToast],
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
   * dropdown. If the current selection is no longer valid, it falls back to the
   * most recent semester returned by the API.
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

        setSemesters(data);
        setQuery((prev) =>
          data.some((s) => s.Semester === prev.Semester)
            ? prev
            : { ...prev, Semester: data[0].Semester },
        );
      } catch {
        // Keep the free-text fallback if the list can't be loaded.
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
              <h1>NTUST Notify</h1>
              <p className="subtitle">Track course availability in real time</p>
            </div>
          </div>
          <UserMenu />
        </div>

        <nav className="tabs" aria-label="Main sections">
          <button
            className={`tab ${activeTab === "search" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("search")}
          >
            <span aria-hidden="true">🔍</span> Search
          </button>
          <button
            className={`tab ${activeTab === "watched" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("watched")}
          >
            <span aria-hidden="true">★</span> Watchlist
            {watchedCourses.length > 0 && (
              <span className="tab-badge">{watchedCourses.length}</span>
            )}
          </button>
          <button
            className={`tab ${activeTab === "notifications" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("notifications")}
          >
            <span aria-hidden="true">🔔</span> Notifications
          </button>
        </nav>
      </header>

      <main className="app-main">
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
              <strong>{courses.length}</strong> course
              {courses.length !== 1 ? "s" : ""} found
            </span>
            <span className="status-bar-right">
              Updated {lastUpdated.toLocaleTimeString("zh-TW")}
              {isPolling && (
                <span className="polling-badge">
                  <span className="pulse-dot" /> Auto-refreshing every 60s
                </span>
              )}
            </span>
          </div>
        )}

        {activeTab === "watched" && watchedCourses.length > 0 && (
          <div className="status-bar">
            <span>
              <strong>{watchedCourses.length}</strong> watched ·{" "}
              <span className="stat-open">{watchedOpen} open</span>
            </span>
            <span className="status-bar-right">
              <span aria-hidden="true">🔔</span> {watchedNotify} with alerts on
            </span>
          </div>
        )}

        {activeTab === "search" && !hasSearched && !loading && (
          <div className="placeholder">
            <span className="placeholder-icon" aria-hidden="true">
              🔎
            </span>
            <p className="placeholder-title">Search for a course to get started</p>
            <p className="placeholder-hint">
              Fill in a course number, name, or teacher above, then hit Search.
              Click ★ on any result to add it to your watchlist.
            </p>
          </div>
        )}

        {activeTab === "search" && hasSearched && !loading && courses.length === 0 && (
          <div className="placeholder">
            <span className="placeholder-icon" aria-hidden="true">
              🗂️
            </span>
            <p className="placeholder-title">No courses matched your search</p>
            <p className="placeholder-hint">
              Try a different course number, name, or teacher.
            </p>
          </div>
        )}

        {activeTab === "watched" && watchedCourses.length === 0 && (
          <div className="placeholder">
            <span className="placeholder-icon" aria-hidden="true">
              ⭐
            </span>
            <p className="placeholder-title">Your watchlist is empty</p>
            <p className="placeholder-hint">
              Search for courses and click ★ to track them here.
            </p>
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
          <NotifyPrefsPanel prefs={prefs} onSave={savePrefs} />
        )}
      </main>

      {/* Toast notifications */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className="toast" role="status">
            <span className="toast-message">{t.message}</span>
            <button
              className="toast-close"
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
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
