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
function SearchForm({ query, semesters = [], onChange, onSearch, onStop, isPolling, loading }) {
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
          <label htmlFor="Semester">Semester</label>
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
          <label htmlFor="CourseNo">Course No.</label>
          <input
            id="CourseNo"
            name="CourseNo"
            type="text"
            value={query.CourseNo}
            onChange={handleChange}
            placeholder="e.g. CS3001"
          />
        </div>

        <div className="form-group">
          <label htmlFor="CourseName">Course Name</label>
          <input
            id="CourseName"
            name="CourseName"
            type="text"
            value={query.CourseName}
            onChange={handleChange}
            placeholder="e.g. Java"
          />
        </div>

        <div className="form-group">
          <label htmlFor="CourseTeacher">Teacher</label>
          <input
            id="CourseTeacher"
            name="CourseTeacher"
            type="text"
            value={query.CourseTeacher}
            onChange={handleChange}
            placeholder="e.g. 陳教授"
          />
        </div>
      </div>

      <div className="form-actions">
        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading}
        >
          {loading ? "Searching…" : isPolling ? "Refresh now" : "Search"}
        </button>

        {isPolling && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onStop}
          >
            Stop auto-refresh
          </button>
        )}

        <span className="form-hint">
          Auto-refreshes every 60s and alerts you the moment a slot opens.
        </span>
      </div>
    </form>
  );
}

export default SearchForm;
