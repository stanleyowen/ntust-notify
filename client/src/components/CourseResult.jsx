import { memo } from "react";
import { useTranslation } from "react-i18next";
import { formatSchedule } from "../lib/course";
import { Icon } from "./Icon";
import { SeatMeter } from "./SeatMeter";

/**
 * One search result row.
 *
 * @param {{
 *   course: Record<string, any>,
 *   watched: boolean,
 *   pending: boolean,
 *   onWatch: (course: Record<string, any>) => void,
 *   onUnwatch: (courseNo: string) => void,
 * }} props
 */
function CourseResultImpl({ course, watched, pending, onWatch, onUnwatch }) {
  const { t } = useTranslation();
  const name = course.CourseName || course.CourseNo;
  const kind = course.RequireOption === "R" ? t("course.required") : course.RequireOption === "E" ? t("course.elective") : null;

  return (
    <li className="result">
      <div className="result-main">
        <h3 className="result-name">{name}</h3>
        <p className="result-sub">
          <span className="mono">{course.CourseNo}</span>
          {course.CourseTeacher && <span>{course.CourseTeacher}</span>}
          {course.CreditPoint && <span>{t("course.credits", { count: Number(course.CreditPoint) || 0 })}</span>}
          {kind && <span className="tag">{kind}</span>}
        </p>
        <p className="result-facts">
          <span>
            <Icon name="clock" size={14} />
            {formatSchedule(course.Node, t)}
          </span>
          {course.ClassRoomNo && (
            <span>
              <Icon name="pin" size={14} />
              {course.ClassRoomNo}
            </span>
          )}
        </p>
        {course.Contents && (
          <p className="result-notes" title={course.Contents}>
            {course.Contents}
          </p>
        )}
      </div>

      <div className="result-seats">
        <SeatMeter course={course} />
      </div>

      <div className="result-action">
        <button
          type="button"
          className={`btn btn-watch ${watched ? "is-watching" : ""}`}
          aria-pressed={watched}
          aria-label={watched ? t("course.unwatchLabel", { name }) : t("course.watchLabel", { name })}
          disabled={pending}
          onClick={() => (watched ? onUnwatch(course.CourseNo) : onWatch(course))}
        >
          {pending ? <span className="spinner spinner-sm" aria-hidden="true" /> : <Icon name={watched ? "check" : "star"} size={16} />}
          <span className="btn-watch-label">{watched ? t("course.watching") : t("course.watch")}</span>
        </button>
      </div>
    </li>
  );
}

export const CourseResult = memo(CourseResultImpl);
