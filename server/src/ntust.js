"use strict";

/**
 * NTUST course API client.
 *
 * One shared instance serves the search route, the watchlist "live" route and
 * the notification poller, so all three share:
 *   - a per-course cache (search results warm it, so watching a course you
 *     just found is instant and the poller's first fetch is often free),
 *   - in-flight de-duplication (concurrent asks for the same thing make one
 *     upstream request),
 *   - HTTP keep-alive (Node's fetch pools connections, unlike the old axios
 *     setup which opened a fresh TLS connection per request).
 *
 * Responses are projected down to the fields the app uses, which shrinks
 * payloads to the browser and limits what upstream data we pass along.
 */

const COURSES_URL = "https://querycourse.ntust.edu.tw/QueryCourse/api/courses";
const SEMESTERS_URL = "https://querycourse.ntust.edu.tw/QueryCourse/api/semestersinfo";

const COURSE_FIELDS = [
  "Semester",
  "CourseNo",
  "CourseName",
  "CourseTeacher",
  "CreditPoint",
  "RequireOption",
  "ChooseStudent",
  "Restrict1",
  "ClassRoomNo",
  "Node",
  "Contents",
];

const SEARCH_TTL_MS = 20_000;
const SEARCH_CACHE_MAX = 500;
const SEMESTERS_TTL_MS = 60 * 60 * 1000;
const RETENTION_MS = 60 * 60 * 1000;
const MAX_RESULTS = 400;
/** NTUST's sentinel Restrict1 value for "no enrollment cap". */
const NO_CAP = 9999;

/**
 * Keeps only known fields and coerces them to primitive types, so nothing
 * unexpected (nested objects, huge blobs) flows through to clients.
 *
 * @param {Record<string, unknown>} c
 * @returns {Record<string, string | number>}
 */
function projectCourse(c) {
  /** @type {Record<string, string | number>} */
  const out = {};
  for (const f of COURSE_FIELDS) {
    const v = c[f];
    if (v == null) continue;
    if (f === "ChooseStudent") {
      const n = Number(v);
      if (Number.isFinite(n)) out[f] = n;
    } else if (typeof v === "string" || typeof v === "number") {
      out[f] = String(v).slice(0, f === "Contents" ? 300 : 120);
    }
  }
  return out;
}

/**
 * NTUST returns one row per time/room block of the same course (e.g. a
 * lecture on Monday in TR-410 and a lab on Wednesday in TR-212). Enrollment is
 * identical across rows, so merge them into one record whose Node and
 * ClassRoomNo cover every block.
 *
 * @param {Record<string, any>[]} rows - Projected rows.
 * @returns {Record<string, any>[]}
 */
function mergeCourseRows(rows) {
  /** @type {Map<string, Record<string, any>>} */
  const byNo = new Map();
  const uniqJoin = (a, b, sep) => [...new Set([...String(a ?? "").split(sep), ...String(b ?? "").split(sep)].map((s) => s.trim()).filter(Boolean))].join(sep);
  for (const row of rows) {
    const key = `${row.Semester ?? ""}::${row.CourseNo ?? ""}`;
    const prev = byNo.get(key);
    if (!prev) {
      byNo.set(key, { ...row });
      continue;
    }
    prev.Node = uniqJoin(prev.Node, row.Node, ",").slice(0, 120);
    prev.ClassRoomNo = uniqJoin(prev.ClassRoomNo, row.ClassRoomNo, ", ").slice(0, 120);
  }
  return [...byNo.values()];
}

/**
 * Whether a projected course is full.
 *
 * @param {{ Restrict1?: string | number, ChooseStudent?: number }} course
 * @returns {boolean}
 */
function isFull(course) {
  const limit = Number.parseInt(String(course.Restrict1 ?? ""), 10);
  // NTUST uses 9999 as "no enrollment cap" — such a course can never be full.
  return Number.isFinite(limit) && limit > 0 && limit < NO_CAP && Number(course.ChooseStudent) >= limit;
}

/**
 * Runs items through an async worker with bounded concurrency.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<R>} worker - Must not throw.
 * @returns {Promise<R[]>}
 */
async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(lanes);
  return results;
}

/**
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, now?: () => number, logger?: Pick<Console, "warn"> }} [opts]
 */
function createNtustClient({
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  now = Date.now,
  logger = console,
} = {}) {
  /** @type {Map<string, { course: Record<string, any>, fetchedAt: number }>} */
  const courseCache = new Map();
  /** @type {Map<string, { lastSuccessAt: number | null, lastErrorAt: number | null, lastError: string | null, consecutiveFailures: number, totalFetches: number }>} */
  const stats = new Map();
  /** @type {Map<string, { results: Record<string, any>[], fetchedAt: number }>} */
  const searchCache = new Map();
  /** @type {Map<string, Promise<any>>} */
  const inflight = new Map();
  let semestersCache = { data: /** @type {any[] | null} */ (null), fetchedAt: 0 };

  /**
   * Shares one in-flight promise between concurrent callers with the same key.
   *
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  function dedupe(key, fn) {
    const existing = inflight.get(key);
    if (existing) return existing;
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  /**
   * @param {string} url
   * @param {RequestInit} init
   * @returns {Promise<unknown>}
   */
  async function requestJson(url, init) {
    const res = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`NTUST responded ${res.status}`);
    return res.json();
  }

  /**
   * @param {{ semester: string, courseNo?: string, courseName?: string, teacher?: string }} q
   * @returns {Promise<Record<string, any>[]>}
   */
  async function queryCourses(q) {
    const data = await requestJson(COURSES_URL, {
      method: "POST",
      body: JSON.stringify({
        Semester: q.semester,
        CourseNo: q.courseNo ?? "",
        CourseName: q.courseName ?? "",
        CourseTeacher: q.teacher ?? "",
        Dimension: "",
        CourseNotes: "",
        ForeignLanguage: 0,
        OnlyGeneral: 0,
        OnleyNTUST: 0,
        OnlyUnderGraduate: 0,
        OnlyMaster: 0,
        Language: "zh",
        CampusNotes: "undefined",
      }),
    });
    if (!Array.isArray(data)) throw new Error("Unexpected response format from NTUST");
    return mergeCourseRows(data.slice(0, MAX_RESULTS).map(projectCourse));
  }

  /**
   * Cached, de-duplicated course search. Results also warm the per-course
   * cache used by the watchlist and poller.
   *
   * @param {{ semester: string, courseNo: string, courseName: string, teacher: string }} q
   * @returns {Promise<{ results: Record<string, any>[], fetchedAt: number }>}
   */
  async function search(q) {
    const key = JSON.stringify([q.semester, q.courseNo, q.courseName, q.teacher]);
    const hit = searchCache.get(key);
    if (hit && now() - hit.fetchedAt < SEARCH_TTL_MS) return hit;

    return dedupe(`search:${key}`, async () => {
      const results = await queryCourses(q);
      const fetchedAt = now();
      for (const c of results) {
        if (c.CourseNo) courseCache.set(`${q.semester}::${c.CourseNo}`, { course: c, fetchedAt });
      }
      const entry = { results, fetchedAt };
      searchCache.delete(key); // re-insert so Map order approximates LRU
      searchCache.set(key, entry);
      if (searchCache.size > SEARCH_CACHE_MAX) {
        searchCache.delete(searchCache.keys().next().value);
      }
      return entry;
    });
  }

  /**
   * @param {string} key
   * @param {{ ok: true } | { ok: false, error: string }} outcome
   */
  function recordStats(key, outcome) {
    const prev = stats.get(key) ?? {
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      consecutiveFailures: 0,
      totalFetches: 0,
    };
    const t = now();
    stats.set(
      key,
      outcome.ok
        ? { ...prev, lastSuccessAt: t, lastError: null, consecutiveFailures: 0, totalFetches: prev.totalFetches + 1 }
        : {
            ...prev,
            lastErrorAt: t,
            lastError: outcome.error,
            consecutiveFailures: prev.consecutiveFailures + 1,
            totalFetches: prev.totalFetches + 1,
          },
    );
  }

  /**
   * Returns one course, from cache if younger than maxAgeMs, else live.
   *
   * On upstream failure the last cached record (if any) is returned with
   * `error` set, so callers can show something but know it's stale.
   *
   * @param {string} semester
   * @param {string} courseNo
   * @param {{ maxAgeMs: number }} opts
   * @returns {Promise<{ course: Record<string, any> | null, fetchedAt: number | null, error: string | null }>}
   */
  async function getCourse(semester, courseNo, { maxAgeMs }) {
    const key = `${semester}::${courseNo}`;
    const cached = courseCache.get(key);
    if (cached && now() - cached.fetchedAt < maxAgeMs) {
      return { course: cached.course, fetchedAt: cached.fetchedAt, error: null };
    }

    return dedupe(`course:${key}`, async () => {
      try {
        const results = await queryCourses({ semester, courseNo });
        const course = results.find((c) => c.CourseNo === courseNo) ?? null;
        const fetchedAt = now();
        if (course) courseCache.set(key, { course, fetchedAt });
        recordStats(key, { ok: true });
        return { course, fetchedAt, error: null };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[NTUST] fetch ${courseNo} (${semester}) failed: ${message}`);
        recordStats(key, { ok: false, error: message });
        const stale = courseCache.get(key);
        return { course: stale?.course ?? null, fetchedAt: stale?.fetchedAt ?? null, error: message };
      }
    });
  }

  /**
   * Fetches several courses with bounded concurrency.
   *
   * @param {Array<{ semester: string, courseNo: string }>} list
   * @param {{ maxAgeMs: number, concurrency: number }} opts
   */
  function getCourses(list, { maxAgeMs, concurrency }) {
    return runPool(list, concurrency, (c) => getCourse(c.semester, c.courseNo, { maxAgeMs }));
  }

  /**
   * Semester list, cached for an hour; serves stale data on upstream failure.
   *
   * @returns {Promise<Array<{ Semester: string, EngSemester: string, CurrentSemester: boolean }>>}
   */
  async function semesters() {
    if (semestersCache.data && now() - semestersCache.fetchedAt < SEMESTERS_TTL_MS) {
      return semestersCache.data;
    }
    return dedupe("semesters", async () => {
      try {
        const data = await requestJson(SEMESTERS_URL, { method: "GET" });
        if (!Array.isArray(data)) throw new Error("Unexpected response format from NTUST");
        const list = data
          .filter((s) => s && typeof s.Semester === "string" && /^\d{3}[0-9A-Z]$/.test(s.Semester))
          .slice(0, 40)
          .map((s) => ({
            Semester: s.Semester,
            EngSemester: typeof s.EngSemester === "string" ? s.EngSemester.slice(0, 40) : "",
            CurrentSemester: s.CurrentSemester === true,
          }));
        semestersCache = { data: list, fetchedAt: now() };
        return list;
      } catch (err) {
        if (semestersCache.data) return semestersCache.data;
        throw err;
      }
    });
  }

  /**
   * @param {string} semester
   * @param {string} courseNo
   */
  function cacheInfo(semester, courseNo) {
    const key = `${semester}::${courseNo}`;
    return { cached: courseCache.get(key) ?? null, stats: stats.get(key) ?? null };
  }

  /** Evicts entries nobody has touched within the retention window. */
  function sweep() {
    const t = now();
    let evicted = 0;
    for (const [key, v] of courseCache) {
      if (t - v.fetchedAt > RETENTION_MS) {
        courseCache.delete(key);
        evicted++;
      }
    }
    for (const [key, s] of stats) {
      if (courseCache.has(key)) continue;
      if (t - Math.max(s.lastSuccessAt ?? 0, s.lastErrorAt ?? 0) > RETENTION_MS) {
        stats.delete(key);
        evicted++;
      }
    }
    for (const [key, v] of searchCache) {
      if (t - v.fetchedAt > SEARCH_TTL_MS) {
        searchCache.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  return { search, getCourse, getCourses, semesters, cacheInfo, sweep };
}

module.exports = { createNtustClient, projectCourse, mergeCourseRows, isFull, runPool, COURSE_FIELDS };
