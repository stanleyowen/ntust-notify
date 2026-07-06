import { useTranslation } from "react-i18next";
import { enrollment, formatNode, isFull } from "../utils/course";
import { BellIcon, CloseIcon, RefreshIcon } from "./icons";

/**
 * Single glanceable status card for a watched course.
 *
 * The card leads with the information a user checks most often — open/full
 * status and seats remaining — and keeps course metadata secondary.
 *
 * @param {{
 *   course: Record<string, any>,
 *   onToggleNotify: (courseNo: string) => void | Promise<void>,
 *   onUnwatch: (courseNo: string) => void | Promise<void>,
 * }} props - Component props.
 * @returns {JSX.Element}
 */
function WatchCard({ course, onToggleNotify, onUnwatch }) {
  const { t } = useTranslation();
  const e = enrollment(course);
  const notifyOn = course.notifyEnabled ?? false;

  const meta = [
    formatNode(course.Node, t),
    course.ClassRoomNo || null,
    course.CreditPoint != null && course.CreditPoint !== ""
      ? t("watchlist.credits", { n: course.CreditPoint })
      : null,
  ].filter(Boolean);

  return (
    <article
      className={`watch-card ${e.full ? "watch-card-full" : "watch-card-open"}`}
    >
      <div className="watch-card-top">
        <span className={`status-badge ${e.full ? "badge-full" : "badge-open"}`}>
          <span className="status-dot" /> {e.full ? t("table.full") : t("table.open")}
        </span>
        <button
          type="button"
          className={`alert-toggle ${notifyOn ? "alert-toggle-on" : ""}`}
          role="switch"
          aria-checked={notifyOn}
          title={notifyOn ? t("watchlist.alertsOnTitle") : t("watchlist.alertsOffTitle")}
          onClick={() => onToggleNotify(course.CourseNo)}
        >
          <BellIcon filled={notifyOn} />
          {t("watchlist.alerts")}
          <span className="switch-track" aria-hidden="true">
            <span className="switch-knob" />
          </span>
        </button>
      </div>

      <h3 className="watch-card-name">{course.CourseName}</h3>
      <p className="watch-card-sub">
        <span className="code">{course.CourseNo}</span>
        {course.CourseTeacher ? ` · ${course.CourseTeacher}` : ""}
      </p>

      <div className="watch-card-seats">
        {e.hasEnrollment ? (
          <>
            <div className="watch-card-seats-row">
              <span
                className={`seats-left ${e.full ? "seats-left-full" : "seats-left-open"}`}
              >
                {e.full
                  ? t("watchlist.noSeats")
                  : t("watchlist.seatsLeft", { count: e.remaining })}
              </span>
              <span className="seats-enrolled">
                {t("watchlist.enrolled", { enrolled: e.enrolled, limit: e.limit })}
              </span>
            </div>
            <div className="progress-bar">
              <div
                className={`progress-fill ${e.full ? "progress-fill-full" : "progress-fill-open"}`}
                style={{ width: `${e.pct}%` }}
              />
            </div>
          </>
        ) : (
          <span className="seats-enrolled">{t("common.dash")}</span>
        )}
      </div>

      {meta.length > 0 && <p className="watch-card-meta">{meta.join(" · ")}</p>}

      <div className="watch-card-footer">
        <button
          type="button"
          className="remove-btn"
          title={t("watchlist.removeTitle", { courseNo: course.CourseNo })}
          onClick={() => onUnwatch(course.CourseNo)}
        >
          <CloseIcon /> {t("watchlist.remove")}
        </button>
      </div>
    </article>
  );
}

/**
 * Watchlist dashboard: summary stat cards, a refresh toolbar, and one status
 * card per watched course.
 *
 * @param {{
 *   courses: Array<Record<string, any>>,
 *   refreshing: boolean,
 *   lastUpdated: Date | null,
 *   onRefresh: () => void,
 *   onToggleNotify: (courseNo: string) => void | Promise<void>,
 *   onUnwatch: (courseNo: string) => void | Promise<void>,
 * }} props - Component props.
 * @returns {JSX.Element}
 */
function WatchlistPanel({
  courses,
  refreshing,
  lastUpdated,
  onRefresh,
  onToggleNotify,
  onUnwatch,
}) {
  const { t, i18n } = useTranslation();

  const openCount = courses.filter((c) => !isFull(c)).length;
  const fullCount = courses.length - openCount;
  const alertCount = courses.filter((c) => c.notifyEnabled).length;

  const stats = [
    { label: t("watchlist.statWatched"), value: courses.length, cls: "" },
    { label: t("watchlist.statOpen"), value: openCount, cls: "stat-value-open" },
    { label: t("watchlist.statFull"), value: fullCount, cls: "stat-value-full" },
    { label: t("watchlist.statAlerts"), value: alertCount, cls: "stat-value-alerts" },
  ];

  return (
    <div className="watchlist-panel">
      <div className="stats-grid">
        {stats.map((s) => (
          <div key={s.label} className="stat-card">
            <span className={`stat-value ${s.cls}`}>{s.value}</span>
            <span className="stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="watchlist-toolbar">
        <button
          type="button"
          className="btn btn-secondary btn-sm refresh-btn"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RefreshIcon />
          {refreshing ? t("watchlist.refreshing") : t("watchlist.refresh")}
        </button>
        {lastUpdated && !refreshing && (
          <span className="watchlist-updated">
            {t("watchlist.updated", {
              time: lastUpdated.toLocaleTimeString(i18n.language),
            })}
          </span>
        )}
      </div>

      <div className="watch-grid">
        {courses.map((c) => (
          <WatchCard
            key={c.CourseNo}
            course={c}
            onToggleNotify={onToggleNotify}
            onUnwatch={onUnwatch}
          />
        ))}
      </div>
    </div>
  );
}

export default WatchlistPanel;
