/**
 * Course display helpers shared by search results and the watchlist.
 */

/** NTUST's sentinel Restrict1 value for "no enrollment cap". */
const NO_CAP = 9999;

/** NTUST weekday codes in display order. */
export const DAY_CODES = ["M", "T", "W", "R", "F", "S", "U"];

/** Period code → start time (minutes after midnight). Each period is 50 min. */
const PERIOD_START = {
  A: 7 * 60 + 10,
  1: 8 * 60 + 10,
  2: 9 * 60 + 10,
  3: 10 * 60 + 10,
  4: 11 * 60 + 10,
  n: 12 * 60 + 10,
  5: 12 * 60 + 10,
  6: 13 * 60 + 10,
  N: 13 * 60 + 10,
  7: 14 * 60 + 10,
  8: 15 * 60 + 10,
  9: 16 * 60 + 10,
  10: 17 * 60 + 10,
  11: 18 * 60 + 10,
  12: 19 * 60 + 10,
  13: 20 * 60 + 10,
  14: 21 * 60 + 10,
};
const PERIOD_MINUTES = 50;

/** @param {number} m */
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/**
 * Enrollment numbers derived from an NTUST course record.
 *
 * @param {{ Restrict1?: string | number, ChooseStudent?: number | null }} course
 */
export function enrollment(course) {
  const limit = Number.parseInt(String(course.Restrict1 ?? ""), 10);
  const enrolled = Number(course.ChooseStudent);
  // NTUST uses 9999 to mean "no enrollment cap" — such a course is never full.
  const unlimited = Number.isFinite(limit) && limit >= NO_CAP;
  const known = !unlimited && Number.isFinite(limit) && limit > 0 && Number.isFinite(enrolled);
  const full = known && enrolled >= limit;
  return {
    unlimited,
    known,
    limit: known ? limit : null,
    enrolled: Number.isFinite(enrolled) ? enrolled : null,
    full,
    remaining: known ? Math.max(0, limit - enrolled) : null,
    pct: known ? Math.min(100, Math.round((enrolled / limit) * 100)) : 0,
  };
}

/** @param {{ Restrict1?: string | number, ChooseStudent?: number | null }} course */
export const isFull = (course) => enrollment(course).full;

/**
 * Groups NTUST schedule codes into readable day/time ranges.
 * "W9,R3,R4" → [{ day: "W", start: "16:10", end: "17:00" }, { day: "R", start: "10:10", end: "12:00" }]
 *
 * @param {string | undefined} node
 * @returns {Array<{ day: string, start: string, end: string, periods: string }>}
 */
export function scheduleBlocks(node) {
  if (!node) return [];
  /** @type {Map<string, Array<{ code: string, start: number }>>} */
  const byDay = new Map();
  for (const raw of node.split(",")) {
    const code = raw.trim();
    if (code.length < 2) continue;
    const day = code[0];
    const period = code.slice(1);
    const start = PERIOD_START[/^\d+$/.test(period) ? Number(period) : period];
    if (start == null) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ code: period, start });
  }

  const blocks = [];
  const order = [...byDay.keys()].sort((a, b) => DAY_CODES.indexOf(a) - DAY_CODES.indexOf(b));
  for (const day of order) {
    const slots = byDay.get(day).sort((a, b) => a.start - b.start);
    let run = [slots[0]];
    const flush = () => {
      blocks.push({
        day,
        start: hhmm(run[0].start),
        end: hhmm(run[run.length - 1].start + PERIOD_MINUTES),
        periods: run.map((s) => s.code).join(","),
      });
    };
    for (let i = 1; i < slots.length; i++) {
      if (slots[i].start - run[run.length - 1].start === 60) run.push(slots[i]);
      else {
        flush();
        run = [slots[i]];
      }
    }
    flush();
  }
  return blocks;
}

/**
 * Human-readable schedule, localised via i18n day names.
 *
 * @param {string | undefined} node
 * @param {(key: string) => string} t
 * @returns {string}
 */
export function formatSchedule(node, t) {
  const blocks = scheduleBlocks(node);
  if (!blocks.length) return t("course.noSchedule");
  return blocks.map((b) => `${t(`days.${b.day}`)} ${b.start}–${b.end}`).join(" · ");
}

/**
 * Whether a string looks like a course number (e.g. "CS3003301", "cs30").
 *
 * @param {string} s
 */
export const looksLikeCourseNo = (s) => /^[A-Za-z]{2,3}\d[\dA-Za-z]*$/.test(s.trim());

/** NTUST's public course query (details) and course selection (register) sites. */
export const NTUST_QUERY_URL = "https://querycourse.ntust.edu.tw/";
export const NTUST_REGISTER_URL = "https://courseselection.ntust.edu.tw/";

/**
 * Formats a poll interval for display ("30 sec", "5 min").
 *
 * @param {number} ms
 * @param {(k: string, o?: any) => string} t
 */
export function formatInterval(ms, t) {
  return ms < 60_000 ? t("alerts.seconds", { count: ms / 1000 }) : t("alerts.minutes", { count: ms / 60_000 });
}
