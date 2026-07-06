import { useTranslation } from "react-i18next";
import { enrollment, formatNode } from "../utils/course";
import { BellIcon, StarIcon } from "./icons";

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
  const e = enrollment(course);
  const watched = isWatched(course.CourseNo);
  const notifyOn = watched && isNotifyEnabled(course.CourseNo);
  const watchTitle = watched
    ? t("table.removeFromWatchlist")
    : t("table.addToWatchlist");
  const notifyTitle = notifyOn ? t("table.notifyOn") : t("table.notifyOff");

  return (
    <tr className={e.full ? "row-full" : "row-open"}>
      <td className="action-cell" data-label={t("table.watch")}>
        <button
          className={`watch-btn ${watched ? "watch-btn-active" : ""}`}
          title={watchTitle}
          aria-label={watchTitle}
          aria-pressed={watched}
          onClick={() =>
            watched ? onUnwatch(course.CourseNo) : onWatch(course)
          }
        >
          <StarIcon filled={watched} />
        </button>
        {watched && (
          <button
            className={`notify-btn ${notifyOn ? "notify-btn-active" : ""}`}
            title={notifyTitle}
            aria-label={notifyTitle}
            aria-pressed={notifyOn}
            onClick={() => onToggleNotify(course.CourseNo)}
          >
            <BellIcon filled={notifyOn} />
          </button>
        )}
      </td>
      <td data-label={t("table.status")}>
        <span className={`status-badge ${e.full ? "badge-full" : "badge-open"}`}>
          <span className="status-dot" /> {e.full ? t("table.full") : t("table.open")}
        </span>
      </td>
      <td className="code" data-label={t("table.courseNo")}>{course.CourseNo}</td>
      <td data-label={t("table.name")}>{course.CourseName}</td>
      <td data-label={t("table.teacher")}>{course.CourseTeacher || t("common.dash")}</td>
      <td data-label={t("table.enrollment")}>
        {e.hasEnrollment ? (
          <div className="enrollment">
            <span>
              {e.enrolled} / {e.limit}
              <span className={`remaining ${e.full ? "" : "remaining-open"}`}>
                {" "}
                {t("table.left", { n: e.remaining })}
              </span>
            </span>
            <div className="progress-bar">
              <div
                className={`progress-fill ${e.full ? "progress-fill-full" : "progress-fill-open"}`}
                style={{ width: `${e.pct}%` }}
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
 * Renders the main course results table for the search tab.
 *
 * It also handles the two empty/loading states before rendering rows.
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
