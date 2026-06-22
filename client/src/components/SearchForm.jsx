/**
 * Search form used to collect NTUST course query criteria.
 *
 * The form is controlled by the parent component, which owns the query object.
 * Submitting the form starts or refreshes the client-side polling flow.
 *
 * @param {{
 *   query: { Semester: string, CourseNo: string, CourseName: string, CourseTeacher: string },
 *   semesters: Array<{ Semester: string, EngSemester?: string }>,
 *   onChange: import("react").Dispatch<import("react").SetStateAction<{ Semester: string, CourseNo: string, CourseName: string, CourseTeacher: string }>>,
 *   onSearch: () => void,
 *   onStop: () => void,
 *   isPolling: boolean,
 *   loading: boolean,
 * }} props - Component props.
 * @returns {JSX.Element}
 */
import { useTranslation } from "react-i18next";

function SearchForm({ query, semesters = [], onChange, onSearch, onStop, isPolling, loading }) {
  const { t } = useTranslation();

  /**
   * Handles form submission by preventing the browser reload and delegating the
   * actual search logic to the parent component.
   *
   * @param {import("react").FormEvent<HTMLFormElement>} e - Form submit event.
   * @returns {void}
   */
  function handleSubmit(e) {
    e.preventDefault();
    onSearch();
  }

  /**
   * Updates a single field in the controlled query object.
   *
   * @param {import("react").ChangeEvent<HTMLInputElement>} e - Input change event.
   * @returns {void}
   */
  function handleChange(e) {
    onChange((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  return (
    <form className="search-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <div className="form-group">
          <label htmlFor="Semester">{t("search.semester")}</label>
          <select
            id="Semester"
            name="Semester"
            value={query.Semester}
            onChange={handleChange}
          >
            {semesters.map((s) => (
              <option key={s.Semester} value={s.Semester}>
                {s.EngSemester ? `${s.EngSemester} (${s.Semester})` : s.Semester}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="CourseNo">{t("search.courseNo")}</label>
          <input
            id="CourseNo"
            name="CourseNo"
            type="text"
            value={query.CourseNo}
            onChange={handleChange}
            placeholder={t("search.courseNoPlaceholder")}
          />
        </div>

        <div className="form-group">
          <label htmlFor="CourseName">{t("search.courseName")}</label>
          <input
            id="CourseName"
            name="CourseName"
            type="text"
            value={query.CourseName}
            onChange={handleChange}
            placeholder={t("search.courseNamePlaceholder")}
          />
        </div>

        <div className="form-group">
          <label htmlFor="CourseTeacher">{t("search.teacher")}</label>
          <input
            id="CourseTeacher"
            name="CourseTeacher"
            type="text"
            value={query.CourseTeacher}
            onChange={handleChange}
            placeholder={t("search.teacherPlaceholder")}
          />
        </div>
      </div>

      <div className="form-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading}
        >
          {loading
            ? t("search.searching")
            : isPolling
              ? t("search.refreshNow")
              : t("search.search")}
        </button>

        {isPolling && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onStop}
          >
            {t("search.stopAutoRefresh")}
          </button>
        )}

        <span className="form-hint">{t("search.hint")}</span>
      </div>
    </form>
  );
}

export default SearchForm;
