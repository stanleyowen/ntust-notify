import { useTranslation } from "react-i18next";

/**
 * NTUST weekday codes, in display order. The readable label for each code is
 * resolved at render time via i18n ("days.<code>").
 *
 * @type {string[]}
 */
const DAY_CODES = ["M", "T", "W", "R", "F", "S"];

/**
 * Maps NTUST period codes to display times.
 *
 * @type {Record<string, string>}
 */
const PERIOD_MAP = {
  1: "08:10", 2: "09:10", 3: "10:10", 4: "11:10", 5: "12:10",
  6: "13:10", 7: "14:10", 8: "15:10", 9: "16:10", 10: "17:10",
  11: "18:10", 12: "19:10", A: "07:10", n: "12:10", N: "13:10",
};

/**
 * Converts an NTUST schedule node string into a human-readable display string.
 *
 * Example:
 * - Input: "M1,W3"
 * - Output: "Mon 08:10, Wed 10:10"
 *
 * @param {string} node - Raw NTUST schedule node string.
 * @param {(key: string) => string} t - i18n translation function.
 * @returns {string}
 */
function formatNode(node, t) {
  if (!node) return t("common.na");
  return node
    .split(",")
    .map((n) => {
      const code = n[0];
      const day = DAY_CODES.includes(code) ? t(`days.${code}`) : code;
      const period = n.slice(1);
      const time = PERIOD_MAP[isNaN(period) ? period : parseInt(period, 10)] ?? period;
      return `${day} ${time}`;
    })
    .join(", ");
}

/**
 * Renders a single course row inside the course table.
 *
 * This component derives watch state, notification state, enrollment progress,
 * and full/open status from the course record and helper callbacks passed in by
 * the parent table.
 *
 * @param {{
 *   course: Record<string, any>,
 *   isWatched: (courseNo: string) => boolean,
 *   onWatch: (course: Record<string, any>) => void | Promise<void>,
 *   onUnwatch: (courseNo: string) => void | Promise<void>,
 *   isNotifyEnabled: (courseNo: string) => boolean,
 *   onToggleNotify: (courseNo: string) => void | Promise<void>,
 * }} props - Component props.
 * @returns {JSX.Element}
 */
function CourseRow({ course, isWatched, onWatch, onUnwatch, isNotifyEnabled, onToggleNotify }) {
  const { t } = useTranslation();
  const limit = parseInt(course.Restrict1, 10);
  const enrolled = course.ChooseStudent;
  const hasEnrollment = !isNaN(limit) && limit > 0 && enrolled != null;
  const full = hasEnrollment && enrolled >= limit;
  const remaining = hasEnrollment ? Math.max(0, limit - enrolled) : "?";
  const pct = hasEnrollment ? (enrolled / limit) * 100 : 0;
  const watched = isWatched(course.CourseNo);
  const notifyOn = watched && isNotifyEnabled(course.CourseNo);

  return (
    <tr className={full ? "row-full" : "row-open"}>
      <td className="action-cell" data-label={t("table.watch")}>
        <button
          className={`watch-btn ${watched ? "watch-btn-active" : ""}`}
          title={watched ? t("table.removeFromWatchlist") : t("table.addToWatchlist")}
          aria-pressed={watched}
          onClick={() =>
            watched ? onUnwatch(course.CourseNo) : onWatch(course)
          }
        >
          {watched ? "★" : "☆"}
        </button>
        {watched && (
          <button
            className={`notify-btn ${notifyOn ? "notify-btn-active" : ""}`}
            title={notifyOn ? t("table.notifyOn") : t("table.notifyOff")}
            aria-pressed={notifyOn}
            onClick={() => onToggleNotify(course.CourseNo)}
          >
            🔔
          </button>
        )}
      </td>
      <td data-label={t("table.status")}>
        <span className={`status-badge ${full ? "badge-full" : "badge-open"}`}>
          <span className="status-dot" /> {full ? t("table.full") : t("table.open")}
        </span>
      </td>
      <td className="code" data-label={t("table.courseNo")}>{course.CourseNo}</td>
      <td data-label={t("table.name")}>{course.CourseName}</td>
      <td data-label={t("table.teacher")}>{course.CourseTeacher || t("common.dash")}</td>
      <td data-label={t("table.enrollment")}>
        {hasEnrollment ? (
          <div className="enrollment">
            <span>
              {enrolled} / {limit}
              <span className="remaining"> {t("table.left", { n: remaining })}</span>
            </span>
            <div className="progress-bar">
              <div
                className={`progress-fill ${full ? "progress-fill-full" : "progress-fill-open"}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
          </div>
        ) : (
          t("common.dash")
        )}
      </td>
      <td data-label={t("table.credits")}>{course.CreditPoint ?? t("common.dash")}</td>
      <td data-label={t("table.room")}>{course.ClassRoomNo || t("common.dash")}</td>
      <td className="schedule" data-label={t("table.schedule")}>{formatNode(course.Node, t)}</td>
    </tr>
  );
}

/**
 * Renders the main course results table.
 *
 * The table is reused both for search results and for the user's watchlist. It
 * also handles the two empty/loading states before rendering rows.
 *
 * @param {{
 *   courses: Array<Record<string, any>>,
 *   loading: boolean,
 *   isWatched: (courseNo: string) => boolean,
 *   onWatch: (course: Record<string, any>) => void | Promise<void>,
 *   onUnwatch: (courseNo: string) => void | Promise<void>,
 *   isNotifyEnabled: (courseNo: string) => boolean,
 *   onToggleNotify: (courseNo: string) => void | Promise<void>,
 * }} props - Component props.
 * @returns {JSX.Element | null}
 */
function CourseTable({ courses, loading, isWatched, onWatch, onUnwatch, isNotifyEnabled, onToggleNotify }) {
  const { t } = useTranslation();

  const headers = [
    t("table.watch"),
    t("table.status"),
    t("table.courseNo"),
    t("table.name"),
    t("table.teacher"),
    t("table.enrollment"),
    t("table.credits"),
    t("table.room"),
    t("table.schedule"),
  ];

  if (loading && courses.length === 0) {
    return (
      <div className="table-wrapper">
        <table className="course-table course-table-skeleton">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: 9 }).map((__, j) => (
                  <td key={j}>
                    <span className="skeleton-bar" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!loading && courses.length === 0) {
    return null;
  }

  return (
    <div className="table-wrapper">
      <table className="course-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {courses.map((c) => (
            <CourseRow
              key={c.CourseNo}
              course={c}
              isWatched={isWatched}
              onWatch={onWatch}
              onUnwatch={onUnwatch}
              isNotifyEnabled={isNotifyEnabled}
              onToggleNotify={onToggleNotify}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default CourseTable;
