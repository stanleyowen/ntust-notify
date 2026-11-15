"use strict";

/**
 * Input validation and sanitisation.
 *
 * Everything that crosses a trust boundary — request bodies, URL params, and
 * values read back from Firestore — goes through one of these helpers. They
 * never throw; they return either a clean value or a `{ error }` code that the
 * route layer turns into a 400 response.
 */

const {
  DEFAULT_POLL_INTERVAL_MS,
  NORMAL_POLL_OPTIONS,
  PRIVILEGED_POLL_OPTIONS,
} = require("./config");

/** NTUST semester codes look like "1151" or "114H". */
const SEMESTER_RE = /^\d{3}[0-9A-Z]$/;

/** Full course numbers, e.g. "CS3003301". Upper-cased before testing. */
const COURSE_NO_RE = /^[A-Z0-9]{4,12}$/;

/** Partial course number accepted by search (NTUST does a contains-match). */
const COURSE_NO_PARTIAL_RE = /^[A-Z0-9]{0,12}$/;

/** Discord user IDs are numeric snowflakes. */
const DISCORD_ID_RE = /^\d{15,22}$/;

const DISCORD_HOSTS = new Set([
  "discord.com",
  "discordapp.com",
  "ptb.discord.com",
  "canary.discord.com",
]);

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;

/**
 * Trims, strips control characters and length-caps a free-text value.
 * Non-strings become "".
 *
 * @param {unknown} value
 * @param {number} maxLen
 * @returns {string}
 */
function cleanText(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS_RE, "").trim().slice(0, maxLen);
}

/**
 * @param {unknown} value
 * @returns {string | null} Normalised semester code, or null if invalid.
 */
function parseSemester(value) {
  if (typeof value !== "string") return null;
  const s = value.trim().toUpperCase();
  return SEMESTER_RE.test(s) ? s : null;
}

/**
 * @param {unknown} value
 * @returns {string | null} Normalised full course number, or null if invalid.
 */
function parseCourseNo(value) {
  if (typeof value !== "string") return null;
  const s = value.replace(/\s+/g, "").toUpperCase();
  return COURSE_NO_RE.test(s) ? s : null;
}

/**
 * Validates a course search request body.
 *
 * @param {unknown} body
 * @returns {{ value?: { semester: string, courseNo: string, courseName: string, teacher: string }, error?: string }}
 */
function parseSearch(body) {
  const b = body && typeof body === "object" ? body : {};
  const semester = parseSemester(b.semester ?? b.Semester);
  if (!semester) return { error: "invalid_semester" };

  const rawNo = typeof (b.courseNo ?? b.CourseNo) === "string" ? (b.courseNo ?? b.CourseNo) : "";
  const courseNo = rawNo.replace(/\s+/g, "").toUpperCase();
  if (!COURSE_NO_PARTIAL_RE.test(courseNo)) return { error: "invalid_course_no" };

  const courseName = cleanText(b.courseName ?? b.CourseName, 60);
  const teacher = cleanText(b.teacher ?? b.CourseTeacher, 40);

  // Single-character name/teacher queries return most of the catalogue —
  // expensive upstream and useless to the user. Course numbers need ≥2 chars.
  const meaningful = courseNo.length >= 2 || courseName.length >= 1 || teacher.length >= 1;
  if (!meaningful) return { error: "empty_query" };

  return { value: { semester, courseNo, courseName, teacher } };
}

/**
 * Validates a Discord webhook URL. This is the SSRF guard: the server POSTs to
 * this URL, so it must be an https Discord webhook and nothing else.
 *
 * @param {unknown} url
 * @returns {boolean}
 */
function isValidDiscordWebhook(url) {
  if (typeof url !== "string" || url.length > 300) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    DISCORD_HOSTS.has(u.hostname) &&
    u.port === "" &&
    u.username === "" &&
    u.password === "" &&
    u.hash === "" &&
    /^\/api\/webhooks\/\d{15,22}\/[\w-]{20,120}\/?$/.test(u.pathname) &&
    (u.search === "" || /^\?thread_id=\d{15,22}$/.test(u.search))
  );
}

/**
 * Poll interval choices for a user.
 *
 * @param {boolean} privileged
 * @returns {number[]}
 */
function pollOptionsFor(privileged) {
  return privileged ? PRIVILEGED_POLL_OPTIONS : NORMAL_POLL_OPTIONS;
}

/**
 * Coerces a stored poll interval into a safe integer in [1s, 1h].
 *
 * @param {unknown} value
 * @returns {number}
 */
function sanitizeInterval(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.min(Math.max(Math.trunc(n), 1_000), 3_600_000);
}

/**
 * Normalises notification preferences read back from Firestore. Never trusts
 * stored shape — bad fields fall back to safe defaults.
 *
 * @param {unknown} raw
 */
function normalizePrefs(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const webhook = typeof p.discordWebhook === "string" ? p.discordWebhook.trim() : "";
  const userId = typeof p.discordUserId === "string" ? p.discordUserId.trim() : "";
  return {
    email: p.email === true,
    discord: p.discord === true,
    discordWebhook: isValidDiscordWebhook(webhook) ? webhook : "",
    discordTagMe: p.discordTagMe === true,
    discordUserId: DISCORD_ID_RE.test(userId) ? userId : "",
    pollInterval: sanitizeInterval(p.pollInterval ?? DEFAULT_POLL_INTERVAL_MS),
  };
}

/**
 * Validates a preferences update from the client. Unlike normalizePrefs this
 * rejects bad input so the user gets told, rather than silently dropping it.
 *
 * @param {unknown} body
 * @param {boolean} privileged
 * @returns {{ value?: ReturnType<typeof normalizePrefs>, error?: string }}
 */
function parsePrefs(body, privileged) {
  if (!body || typeof body !== "object") return { error: "invalid_body" };
  const b = /** @type {Record<string, unknown>} */ (body);

  for (const key of ["email", "discord", "discordTagMe"]) {
    if (b[key] !== undefined && typeof b[key] !== "boolean") return { error: "invalid_body" };
  }

  const webhook = cleanText(b.discordWebhook, 300);
  const userId = cleanText(b.discordUserId, 30);
  const discord = b.discord === true;
  const tagMe = b.discordTagMe === true;

  if (webhook && !isValidDiscordWebhook(webhook)) return { error: "invalid_webhook" };
  if (discord && !webhook) return { error: "webhook_required" };
  if (userId && !DISCORD_ID_RE.test(userId)) return { error: "invalid_discord_user_id" };
  if (discord && tagMe && !userId) return { error: "discord_user_id_required" };

  const interval = b.pollInterval === undefined ? DEFAULT_POLL_INTERVAL_MS : b.pollInterval;
  if (typeof interval !== "number" || !pollOptionsFor(privileged).includes(interval)) {
    return { error: "invalid_interval" };
  }

  return {
    value: {
      email: b.email === true,
      discord,
      discordWebhook: webhook,
      discordTagMe: tagMe,
      discordUserId: userId,
      pollInterval: interval,
    },
  };
}

module.exports = {
  cleanText,
  parseSemester,
  parseCourseNo,
  parseSearch,
  parsePrefs,
  normalizePrefs,
  sanitizeInterval,
  isValidDiscordWebhook,
  pollOptionsFor,
  DISCORD_ID_RE,
};
