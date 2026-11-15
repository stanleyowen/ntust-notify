import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccount } from "../context/AccountContext";
import { useToast } from "../context/ToastContext";
import { api, errorMessage } from "../lib/api";
import { isFull, looksLikeCourseNo } from "../lib/course";
import { load, save } from "../lib/storage";
import { CourseResult } from "./CourseResult";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";

/** Shown until (or if) the live semester list loads. */
const FALLBACK_SEMESTERS = [
  { Semester: "1151", EngSemester: "2026 Fall" },
  { Semester: "114H", EngSemester: "2026 Summer" },
  { Semester: "1142", EngSemester: "2026 Spring" },
  { Semester: "1141", EngSemester: "2025 Fall" },
];

const MODES = /** @type {const} */ (["courseNo", "courseName", "teacher"]);
const RECENT_KEY = "ntust-recent-searches";
const SEMESTER_KEY = "ntust-semester";

/**
 * @typedef {{ semester: string, mode: typeof MODES[number], q: string }} Query
 */

/** Skeleton rows while results load. */
function ResultSkeleton() {
  return (
    <ul className="results" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <li key={i} className="result result-skeleton">
          <div className="result-main">
            <span className="sk sk-title" />
            <span className="sk sk-line" />
            <span className="sk sk-line sk-short" />
          </div>
          <div className="result-seats">
            <span className="sk sk-line" />
            <span className="sk sk-bar" />
          </div>
          <div className="result-action">
            <span className="sk sk-btn" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SearchView() {
  const { t } = useTranslation();
  const toast = useToast();
  const { watch, unwatch, watchedSet, pending, hasChannel, enableEmail, emailAvailable, profile } = useAccount();
  const inputId = useId();
  const inputRef = useRef(/** @type {HTMLInputElement | null} */ (null));
  const modeTouched = useRef(false);
  const abortRef = useRef(/** @type {AbortController | null} */ (null));
  const firstWatchPrompted = useRef(false);

  const [semesters, setSemesters] = useState(FALLBACK_SEMESTERS);
  const [semester, setSemester] = useState(() => load(SEMESTER_KEY, null) ?? FALLBACK_SEMESTERS[0].Semester);
  const [mode, setMode] = useState(/** @type {Query["mode"]} */ ("courseNo"));
  const [q, setQ] = useState("");
  const [results, setResults] = useState(/** @type {Record<string, any>[] | null} */ (null));
  const [fetchedAt, setFetchedAt] = useState(/** @type {number | null} */ (null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(/** @type {string | null} */ (null));
  const [filter, setFilter] = useState(/** @type {"all" | "open" | "full"} */ ("all"));
  const [recent, setRecent] = useState(/** @type {Query[]} */ (() => load(RECENT_KEY, [])));
  const [lastQuery, setLastQuery] = useState(/** @type {Query | null} */ (null));

  // Live semester list; default to the newest one unless the user picked one.
  useEffect(() => {
    const ctrl = new AbortController();
    api("/api/semesters", { auth: false, signal: ctrl.signal })
      .then(({ semesters: list }) => {
        if (!Array.isArray(list) || list.length === 0) return;
        setSemesters(list);
        setSemester((s) => (list.some((x) => x.Semester === s) ? s : list[0].Semester));
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runSearch = useCallback(
    async (/** @type {Query} */ query) => {
      const text = query.q.trim();
      if (!text || (query.mode === "courseNo" && text.length < 2)) {
        setError(t("errors.empty_query"));
        inputRef.current?.focus();
        return;
      }
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setLoading(true);
      setError(null);
      setFilter("all");
      try {
        const body = { semester: query.semester, courseNo: "", courseName: "", teacher: "" };
        body[query.mode] = text;
        const data = await api("/api/courses", { method: "POST", body, signal: ctrl.signal });
        setResults(data.results);
        setFetchedAt(data.fetchedAt);
        setLastQuery(query);
        const entry = { semester: query.semester, mode: query.mode, q: text };
        setRecent((prev) => {
          const next = [entry, ...prev.filter((r) => !(r.q === text && r.mode === query.mode && r.semester === query.semester))].slice(0, 6);
          save(RECENT_KEY, next);
          return next;
        });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setError(errorMessage(err, t));
      } finally {
        if (abortRef.current === ctrl) setLoading(false);
      }
    },
    [t],
  );

  function onSubmit(e) {
    e.preventDefault();
    runSearch({ semester, mode, q });
  }

  function onInput(value) {
    setQ(value);
    if (error) setError(null);
    // Auto-pick the right field until the user chooses one explicitly.
    if (!modeTouched.current && value.trim()) {
      setMode(looksLikeCourseNo(value) ? "courseNo" : "courseName");
    }
  }

  function chooseSemester(value) {
    setSemester(value);
    save(SEMESTER_KEY, value);
  }

  /** Watch + a one-time nudge to turn on a channel if none is set up. */
  const handleWatch = useCallback(
    async (course) => {
      const ok = await watch(course);
      if (ok && !hasChannel && !firstWatchPrompted.current) {
        firstWatchPrompted.current = true;
        toast(t("toast.noChannel"), {
          action: emailAvailable
            ? { label: t("toast.useEmail"), onClick: enableEmail }
            : { label: t("toast.setup"), onClick: () => (window.location.hash = "/alerts") },
        });
      }
    },
    [watch, hasChannel, toast, t, enableEmail, emailAvailable],
  );

  const openCount = useMemo(() => (results ? results.filter((c) => !isFull(c)).length : 0), [results]);
  const visible = useMemo(() => {
    if (!results) return [];
    if (filter === "open") return results.filter((c) => !isFull(c));
    if (filter === "full") return results.filter(isFull);
    return results;
  }, [results, filter]);

  const semesterLabel = (s) => (s.EngSemester ? `${s.EngSemester} · ${s.Semester}` : s.Semester);
  const placeholders = {
    courseNo: t("search.placeholderCourseNo"),
    courseName: t("search.placeholderCourseName"),
    teacher: t("search.placeholderTeacher"),
  };

  return (
    <div className="view">
      <header className="view-head">
        <h1 className="view-title">{t("search.title")}</h1>
        <p className="view-sub">{t("search.subtitle", { email: profile?.email ?? "" })}</p>
      </header>

      <form className="searchbar card" onSubmit={onSubmit} role="search">
        <div className="searchbar-row">
          <label className="field field-semester">
            <span className="field-label">{t("search.semester")}</span>
            <span className="select-wrap">
              <select value={semester} onChange={(e) => chooseSemester(e.target.value)}>
                {semesters.map((s) => (
                  <option key={s.Semester} value={s.Semester}>
                    {semesterLabel(s)}
                  </option>
                ))}
              </select>
              <Icon name="chevronDown" size={16} className="select-chevron" />
            </span>
          </label>

          <div className="field field-mode">
            <span className="field-label" id={`${inputId}-mode`}>
              {t("search.by")}
            </span>
            <div className="segmented" role="group" aria-labelledby={`${inputId}-mode`}>
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="segmented-btn"
                  aria-pressed={mode === m}
                  onClick={() => {
                    modeTouched.current = true;
                    setMode(m);
                    inputRef.current?.focus();
                  }}
                >
                  {t(`search.mode.${m}`)}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="searchbar-query">
          <label htmlFor={inputId} className="visually-hidden">
            {t(`search.mode.${mode}`)}
          </label>
          <span className="input-icon">
            <Icon name="search" size={18} />
          </span>
          <input
            ref={inputRef}
            id={inputId}
            className="input input-lg"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCapitalize={mode === "courseNo" ? "characters" : "off"}
            spellCheck={false}
            maxLength={60}
            value={q}
            placeholder={placeholders[mode]}
            onChange={(e) => onInput(e.target.value)}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? `${inputId}-err` : undefined}
          />
          <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
            {loading ? <span className="spinner spinner-sm" aria-hidden="true" /> : null}
            {loading ? t("search.searching") : t("search.submit")}
          </button>
        </div>
      </form>

      {error && (
        <div className="notice notice-error" role="alert" id={`${inputId}-err`}>
          <Icon name="alert" size={16} />
          <span>{error}</span>
          {lastQuery && results === null && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => runSearch({ semester, mode, q })}>
              {t("common.retry")}
            </button>
          )}
        </div>
      )}

      {loading && results === null && <ResultSkeleton />}

      {results === null && !loading && (
        <section className="idle">
          {recent.length > 0 && (
            <div className="recent">
              <div className="recent-head">
                <h2 className="label-sm">{t("search.recent")}</h2>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setRecent([]);
                    save(RECENT_KEY, null);
                  }}
                >
                  {t("search.clearRecent")}
                </button>
              </div>
              <div className="chips">
                {recent.map((r) => (
                  <button
                    key={`${r.semester}-${r.mode}-${r.q}`}
                    type="button"
                    className="chip"
                    onClick={() => {
                      modeTouched.current = true;
                      setQ(r.q);
                      setMode(r.mode);
                      chooseSemester(r.semester);
                      runSearch(r);
                    }}
                  >
                    <Icon name="clock" size={14} />
                    {r.q}
                    <span className="chip-meta">{r.semester}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <EmptyState icon="search" title={t("search.idleTitle")} body={t("search.idleBody")}>
            <ul className="tips">
              <li>{t("search.tip1")}</li>
              <li>{t("search.tip2")}</li>
              <li>{t("search.tip3")}</li>
            </ul>
          </EmptyState>
        </section>
      )}

      {results !== null && (
        <section aria-labelledby="results-title" aria-busy={loading}>
          <div className="results-bar">
            <h2 id="results-title" className="results-count">
              {t("search.results", { count: results.length })}
              {results.length > 0 && <span className="results-open"> · {t("search.openCount", { count: openCount })}</span>}
            </h2>
            {results.length > 0 && (
              <div className="segmented segmented-sm" role="group" aria-label={t("search.filterLabel")}>
                {[
                  ["all", results.length],
                  ["open", openCount],
                  ["full", results.length - openCount],
                ].map(([key, n]) => (
                  <button key={key} type="button" className="segmented-btn" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                    {t(`search.filter.${key}`)}
                    <span className="segmented-count">{n}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {results.length === 0 ? (
            <EmptyState icon="search" title={t("search.noResultsTitle")} body={t("search.noResultsBody")} compact />
          ) : visible.length === 0 ? (
            <EmptyState icon="info" title={t(`search.filterEmpty.${filter}`)} compact />
          ) : (
            <ul className={`results ${loading ? "is-refreshing" : ""}`}>
              {visible.map((c) => (
                <CourseResult
                  key={`${c.Semester}-${c.CourseNo}`}
                  course={c}
                  watched={watchedSet.has(c.CourseNo)}
                  pending={pending.has(c.CourseNo)}
                  onWatch={handleWatch}
                  onUnwatch={unwatch}
                />
              ))}
            </ul>
          )}

          {fetchedAt && results.length > 0 && (
            <p className="results-foot">
              {t("search.updated", { time: new Date(fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
