/**
 * Shared course helpers used by the search table, the watchlist panel, and
 * App-level summary stats.
 */

/**
 * NTUST weekday codes, in display order. The readable label for each code is
 * resolved at render time via i18n ("days.<code>").
 *
 * @type {string[]}
 */
export const DAY_CODES = ["M", "T", "W", "R", "F", "S"];

/**
 * Maps NTUST period codes to display times.
 *
 * @type {Record<string, string>}
 */
export const PERIOD_MAP = {
  1: "08:10", 2: "09:10", 3: "10:10", 4: "11:10", 5: "12:10",
  6: "13:10", 7: "14:10", 8: "15:10", 9: "16:10", 10: "17:10",
  11: "18:10", 12: "19:10", A: "07:10", n: "12:10", N: "13:10",
};

/**
 * Derives enrollment display data from a course record.
 *
 * @param {{ Restrict1: string | number, ChooseStudent: number }} course - Course record returned by the backend.
 * @returns {{
 *   limit: number,
 *   enrolled: number,
 *   hasEnrollment: boolean,
 *   full: boolean,
 *   remaining: number | null,
 *   pct: number,
 * }}
 */
export function enrollment(course) {
  const limit = parseInt(course.Restrict1, 10);
  const enrolled = course.ChooseStudent;
  const hasEnrollment = !isNaN(limit) && limit > 0 && enrolled != null;
  const full = hasEnrollment && enrolled >= limit;
  const remaining = hasEnrollment ? Math.max(0, limit - enrolled) : null;
  const pct = hasEnrollment ? Math.min((enrolled / limit) * 100, 100) : 0;
  return { limit, enrolled, hasEnrollment, full, remaining, pct };
}

/**
 * Determines whether a course is currently full.
 *
 * @param {{ Restrict1: string | number, ChooseStudent: number }} course - Course record returned by the backend.
 * @returns {boolean}
 */
export function isFull(course) {
  return enrollment(course).full;
}

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
export function formatNode(node, t) {
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
