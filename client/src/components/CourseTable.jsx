/**
 * Maps NTUST weekday codes to readable day abbreviations.
 *
 * @type {Record<string, string>}
 */
const DAY_MAP = { M: "Mon", T: "Tue", W: "Wed", R: "Thu", F: "Fri", S: "Sat" };

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
 * @returns {string}
 */
function formatNode(node) {
  if (!node) return "N/A";
  return node
    .split(",")
    .map((n) => {
      const day = DAY_MAP[n[0]] ?? n[0];
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
      <td className="action-cell" data-label="Watch">
        <button
          className={`watch-btn ${watched ? "watch-btn-active" : ""}`}
          title={watched ? "Remove from watchlist" : "Add to watchlist"}
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
            title={notifyOn ? "Notifications on — click to disable" : "Notifications off — click to enable"}
            aria-pressed={notifyOn}
            onClick={() => onToggleNotify(course.CourseNo)}
          >
            🔔
          </button>
        )}
      </td>
      <td data-label="Status">
        <span className={`status-badge ${full ? "badge-full" : "badge-open"}`}>
          <span className="status-dot" /> {full ? "FULL" : "OPEN"}
        </span>
      </td>
      <td className="code" data-label="Course No.">{course.CourseNo}</td>
      <td data-label="Name">{course.CourseName}</td>
      <td data-label="Teacher">{course.CourseTeacher || "—"}</td>
      <td data-label="Enrollment">
        {hasEnrollment ? (
          <div className="enrollment">
            <span>
              {enrolled} / {limit}
              <span className="remaining"> ({remaining} left)</span>
            </span>
            <div className="progress-bar">
              <div
                className={`progress-fill ${full ? "progress-fill-full" : "progress-fill-open"}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
          </div>
        ) : (
          "—"
        )}
      </td>
      <td data-label="Credits">{course.CreditPoint ?? "—"}</td>
      <td data-label="Room">{course.ClassRoomNo || "—"}</td>
      <td className="schedule" data-label="Schedule">{formatNode(course.Node)}</td>
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
  if (loading && courses.length === 0) {
    return (
      <div className="table-wrapper">
        <table className="course-table course-table-skeleton">
          <thead>
            <tr>
              <th>Watch</th>
              <th>Status</th>
              <th>Course No.</th>
              <th>Name</th>
              <th>Teacher</th>
              <th>Enrollment</th>
              <th>Credits</th>
              <th>Room</th>
              <th>Schedule</th>
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
            <th>Watch</th>
            <th>Status</th>
            <th>Course No.</th>
            <th>Name</th>
            <th>Teacher</th>
            <th>Enrollment</th>
            <th>Credits</th>
            <th>Room</th>
            <th>Schedule</th>
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
