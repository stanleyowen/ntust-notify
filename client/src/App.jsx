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

// In production set VITE_API_URL=https://test-api.smashit.tw in your .env

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
 * Whether the app is running in demo mode (accessed via /demo path).
 * In demo mode, course searches hit the fake backend while everything else
 * (auth, watchlist, notifications) works normally.
 */
const IS_DEMO = window.location.pathname.startsWith("/demo");

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
  } = useWatchedCourses(uid, { demo: IS_DEMO });
  const { prefs, savePrefs } = useNotifyPrefs(uid);

  /**
   * Current course query submitted to the backend search API.
   *
   * @type {[{ Semester: string, CourseNo: string, CourseName: string, CourseTeacher: string }, import("react").Dispatch<import("react").SetStateAction<{ Semester: string, CourseNo: string, CourseName: string, CourseTeacher: string }>>]}
   */
  const [query, setQuery] = useState({
    Semester: "1142",
    CourseNo: "",
    CourseName: "",
    CourseTeacher: "",
  });

  /**
   * Course search results currently shown on the Search tab.
   *
   * @type {[Array<Record<string, any>>, import("react").Dispatch<import("react").SetStateAction<Array<Record<string, any>>>>]}
   */
  const [courses, setCourses] = useState([]);

  /**
   * Whether the search request is currently in flight.
   *
   * @type {[boolean, import("react").Dispatch<import("react").SetStateAction<boolean>>]}
   */
  const [loading, setLoading] = useState(false);

  /**
   * User-facing error message for failed searches.
   *
   * @type {[string | null, import("react").Dispatch<import("react").SetStateAction<string | null>>]}
   */
  const [error, setError] = useState(null);

  /**
   * Timestamp of the most recent successful search refresh.
   *
   * @type {[Date | null, import("react").Dispatch<import("react").SetStateAction<Date | null>>]}
   */
  const [lastUpdated, setLastUpdated] = useState(null);

  /**
   * Temporary toast notifications shown at the bottom of the app.
   *
   * @type {[Array<{ id: number, message: string }>, import("react").Dispatch<import("react").SetStateAction<Array<{ id: number, message: string }>>>]}
   */
  const [toasts, setToasts] = useState([]);

  /**
   * Whether the client-side search auto-polling loop is active.
   *
   * @type {[boolean, import("react").Dispatch<import("react").SetStateAction<boolean>>]}
   */
  const [isPolling, setIsPolling] = useState(false);

  /**
   * Currently visible top-level tab.
   *
   * Supported values:
   * - search
   * - watched
   * - notifications
   *
   * @type {["search" | "watched" | "notifications", import("react").Dispatch<import("react").SetStateAction<"search" | "watched" | "notifications">>]}
   */
  const [activeTab, setActiveTab] = useState("search");

  // Track previous enrollment state for slot-opening detection.

  /**
   * Stores the previous known fullness state for each searched course.
   *
   * This is used only by the client-side search polling loop so the UI can show
   * a toast when a course transitions from FULL to OPEN while the user is
   * actively watching the search results page.
   *
   * @type {import("react").MutableRefObject<Map<string, { wasFull: boolean }>>}
   */
  const prevStateRef = useRef(new Map());

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

  /**
   * Adds a temporary toast notification to the UI and removes it automatically
   * after a short delay.
   *
   * @param {string} message - Message text to display in the toast.
   * @returns {void}
   */
  function addToast(message) {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 8000);
  }

  /**
   * Fetches courses for the current query from the backend.
   *
   * Behavior differs slightly depending on whether this is the first poll cycle:
   * - On the initial fetch, the component seeds previous course state but does
   *   not show slot-opened toasts.
   * - On later fetches, the component compares the current and previous course
   *   fullness states and emits a toast when a course becomes open.
   *
   * @param {boolean} [isInitial=false] - Whether this fetch is the first cycle of a polling session.
   * @returns {Promise<void>}
   */
  const fetchCourses = useCallback(
    async (isInitial = false) => {
      if (!query.CourseNo && !query.CourseName && !query.CourseTeacher) {
        setError("Please enter at least one search field (Course No, Name, or Teacher).");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const token = await auth.currentUser?.getIdToken();
        const coursesUrl = IS_DEMO ? `${API_BASE}/api/demo/courses` : `${API_BASE}/api/courses`;
        const res = await fetch(coursesUrl, {
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
    [query],
  );

  /**
   * Starts or stops the client-side polling loop depending on isPolling.
   *
   * When polling starts, the component performs an immediate fetch and then
   * repeats the same search at a fixed interval until polling is disabled.
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
   * Starts a fresh polling session for the current search query.
   *
   * If polling is already active, it is briefly stopped and restarted so the
   * latest query state is used immediately.
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

  // In demo mode, periodically refresh watched courses with live enrollment data
  // from the fake backend so the watchlist shows current numbers.
  const [liveWatchedData, setLiveWatchedData] = useState(new Map());

  useEffect(() => {
    if (!IS_DEMO || watchedCourses.length === 0) {
      setLiveWatchedData(new Map());
      return;
    }

    async function refreshWatchedData() {
      try {
        const token = await auth.currentUser?.getIdToken();
        const courseNos = watchedCourses.map((c) => c.CourseNo);
        const res = await fetch(`${API_BASE}/api/demo/courses/batch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ courseNos }),
        });
        if (res.ok) {
          const data = await res.json();
          const map = new Map();
          data.forEach((c) => map.set(c.CourseNo, c));
          setLiveWatchedData(map);
        }
      } catch {
        /* ignore refresh errors */
      }
    }

    refreshWatchedData();
    const id = setInterval(refreshWatchedData, 10_000);
    return () => clearInterval(id);
  }, [watchedCourses]);

  // Merge live enrollment data into watched courses for demo mode.
  const enrichedWatchedCourses = IS_DEMO
    ? watchedCourses.map((w) => {
        const live = liveWatchedData.get(w.CourseNo);
        return live ? { ...w, ...live, notifyEnabled: w.notifyEnabled } : w;
      })
    : watchedCourses;

  /**
   * Courses currently displayed in the table.
   *
   * The Search tab shows live search results, while the Watchlist tab shows the
   * user's saved watched courses.
   */
  const displayedCourses = activeTab === "watched" ? enrichedWatchedCourses : courses;

  /**
   * Whether the course table should be rendered for the current tab.
   */
  const showCourseTable = activeTab === "search" || activeTab === "watched";

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div>
            <h1>NTUST Course Tracker</h1>
            <p className="subtitle">Monitor course availability in real time</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            {IS_DEMO && <span className="demo-badge">Demo Mode</span>}
            <UserMenu />
          </div>
        </div>

        <div className="tabs">
          <button
            className={`tab ${activeTab === "search" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("search")}
          >
            Search
          </button>
          <button
            className={`tab ${activeTab === "watched" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("watched")}
          >
            Watchlist
            {watchedCourses.length > 0 && (
              <span className="tab-badge">{watchedCourses.length}</span>
            )}
          </button>
          <button
            className={`tab ${activeTab === "notifications" ? "tab-active" : ""}`}
            onClick={() => setActiveTab("notifications")}
          >
            🔔 Notifications
          </button>
        </div>
      </header>

      <main className="app-main">
        {activeTab === "search" && (
          <SearchForm
            query={query}
            onChange={setQuery}
            onSearch={handleSearch}
            onStop={handleStopPolling}
            isPolling={isPolling}
            loading={loading}
          />
        )}

        {error && <div className="error-banner">{error}</div>}

        {activeTab === "search" && lastUpdated && (
          <div className="status-bar">
            <span>
              {courses.length} course{courses.length !== 1 ? "s" : ""} found
            </span>
            <span>
              Last updated: {lastUpdated.toLocaleTimeString("zh-TW")}
              {isPolling && (
                <span className="polling-badge"> • Auto-refreshing every 60s</span>
              )}
            </span>
          </div>
        )}

        {activeTab === "watched" && watchedCourses.length === 0 && (
          <div className="placeholder">
            <p>Your watchlist is empty. Search for courses and click ★ to watch them.</p>
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
          <NotifyPrefsPanel prefs={prefs} onSave={savePrefs} demo={IS_DEMO} />
        )}
      </main>

      {/* Toast notifications */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.message}
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
 * This component waits for Firebase authentication state to resolve before
 * deciding whether to show:
 * - a loading spinner,
 * - the login page, or
 * - the authenticated tracker UI.
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
