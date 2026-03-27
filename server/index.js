require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const nodemailer = require("nodemailer");
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 3000;

/**
 * Upstream NTUST course query API endpoint.
 *
 * This endpoint is used in two different flows:
 * 1. Direct course search requests from the frontend.
 * 2. Background polling that checks whether watched courses have open seats.
 *
 * @type {string}
 */
const NTUST_API = "https://querycourse.ntust.edu.tw/QueryCourse/api/courses";

// ─── Auth emails & poll intervals ────────────────────────────────────────────
// AUTH_EMAILS: comma-separated list of email addresses that may poll as fast as
// 1 s. All other users are capped at a 30 s minimum.

/**
 * List of privileged email addresses that are allowed to use a faster polling
 * interval than normal users.
 *
 * The value is read from AUTH_EMAILS in the environment, split by commas, and
 * normalized to lowercase so email comparisons are case-insensitive.
 *
 * @type {string[]}
 */
const AUTH_EMAILS = process.env.AUTH_EMAILS
  ? process.env.AUTH_EMAILS.split(",").map((e) => e.trim().toLowerCase())
  : [];

/**
 * Poll interval choices available to regular users.
 *
 * Each item contains a human-readable label for the UI and the interval value
 * in milliseconds that the backend uses when deciding whether a user should be
 * polled again.
 *
 * @type {{label: string, value: number}[]}
 */
const NORMAL_POLL_OPTIONS = [
  { label: "30 seconds", value: 30_000 },
  { label: "1 minute", value: 60_000 },
  { label: "3 minutes", value: 180_000 },
  { label: "5 minutes", value: 300_000 },
  { label: "10 minutes", value: 600_000 },
];

/**
 * Poll interval choices available to privileged users.
 *
 * These users get access to an additional 1-second option, while still keeping
 * all regular polling options.
 *
 * @type {{label: string, value: number}[]}
 */
const AUTH_POLL_OPTIONS = [
  { label: "1 second", value: 1_000 },
  ...NORMAL_POLL_OPTIONS,
];

// ─── Firebase Admin ───────────────────────────────────────────────────────────
// Provide credentials via GOOGLE_APPLICATION_CREDENTIALS env var (path to
// service-account JSON) or by setting FIREBASE_SERVICE_ACCOUNT_JSON to the
// JSON string directly.

/**
 * Firestore database instance used by the backend.
 *
 * This remains null when Firebase Admin is not configured correctly. In that
 * case, the server still starts, but notification polling and auth-dependent
 * Firestore-backed features are effectively disabled.
 *
 * @type {import("firebase-admin/firestore").Firestore | null}
 */
let db = null;

try {
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    credential = admin.credential.cert(sa);
  } else {
    // Falls back to GOOGLE_APPLICATION_CREDENTIALS or ADC.
    credential = admin.credential.applicationDefault();
  }

  admin.initializeApp({ credential });
  db = admin.firestore();
  console.log("[FIREBASE] Admin SDK initialized.");
} catch (err) {
  console.warn(
    "[FIREBASE] Admin SDK not configured – notification polling disabled.",
    err.message,
  );
}

// ─── Email transport ─────────────────────────────────────────────────────────
// Configure SMTP via .env (e.g. Gmail App Password or any SMTP relay).

/**
 * Nodemailer transport used to send email notifications.
 *
 * This stays null if SMTP credentials are missing, which means email alerts are
 * silently skipped while the rest of the app continues to work.
 *
 * @type {import("nodemailer").Transporter | null}
 */
let mailer = null;

if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  console.log("[SMTP] Mailer configured via", process.env.SMTP_HOST);
} else {
  console.warn("[SMTP] Not configured – email notifications disabled.");
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allowed origins: ALLOWED_ORIGINS env var (comma-separated) merged with the
// default production frontends.

/**
 * Browser origins that are allowed to call this backend.
 *
 * The list is built from ALLOWED_ORIGINS if provided; otherwise, it falls back
 * to the known production frontend origins.
 *
 * @type {string[]}
 */
const ALLOWED_ORIGINS = [
  ...(process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["https://notify.stanleyowen.com", "https://ntust.netlify.app"]),
];

app.use(
  cors({
    /**
     * Validates whether an incoming request origin is allowed by the CORS
     * policy.
     *
     * Requests without an Origin header are allowed so tools such as curl,
     * Postman, or server-to-server callers can still use the API.
     *
     * @param {string | undefined} origin - The Origin request header value.
     * @param {(err: Error | null, allow?: boolean) => void} callback - Callback used by the cors middleware.
     * @returns {void}
     */
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// ─── Middleware ───────────────────────────────────────────────────────────────
// Trust the first proxy hop (nginx, Caddy, etc.) so express-rate-limit can read
// the real client IP from X-Forwarded-For instead of the proxy's IP.
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "16kb" }));

// ─── Rate limiting ────────────────────────────────────────────────────────────

/**
 * Rate limiter for the /api/courses proxy route.
 *
 * This route fans out to the upstream NTUST API, so it uses a stricter limit to
 * reduce abuse and protect the remote service.
 */
const courseLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

/**
 * General-purpose rate limiter for lighter routes such as health checks,
 * polling option lookup, and notification test/status endpoints.
 */
const generalLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

// ─── Auth middleware ──────────────────────────────────────────────────────────
/**
 * Verifies the Firebase ID token supplied in the Authorization header.
 *
 * On success, the decoded Firebase token payload is attached to req.user so
 * downstream route handlers can access the authenticated user's UID and email.
 *
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @param {import("express").NextFunction} next - Express continuation callback.
 * @returns {Promise<void>}
 */
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────
/**
 * GET /health
 *
 * Minimal health-check route used by deployments, uptime monitors, reverse
 * proxies, and humans who want a quick confirmation that the API process is
 * alive.
 *
 * @param {import("express").Request} _req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @returns {void}
 */
app.get("/health", generalLimiter, (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * GET /api/notify/status
 *
 * Returns a detailed snapshot of the backend's in-memory notification state for
 * the authenticated user.
 *
 * The response includes:
 * - Whether the poller has completed its first initialization run.
 * - Whether the user currently has any notification channel enabled.
 * - The requested and effective polling interval.
 * - Per-course state such as cached NTUST data and recent fetch health.
 *
 * @param {import("express").Request & { user: { uid: string, email?: string } }} req - Authenticated request.
 * @param {import("express").Response} res - Express response object.
 * @returns {void}
 */
app.get("/api/notify/status", generalLimiter, requireAuth, (req, res) => {
  const uid = req.user.uid;
  const userData = usersData.get(uid);
  const notifyPrefs = userData?.notifyPrefs ?? {};
  const userEmail = userData?.email ?? req.user.email ?? "";

  const isAuthUser =
    AUTH_EMAILS.length > 0 && AUTH_EMAILS.includes(userEmail.toLowerCase());
  const requestedInterval = notifyPrefs.pollInterval ?? 60_000;
  const effectiveInterval = Math.max(
    requestedInterval,
    isAuthUser ? 1_000 : 30_000,
  );
  const hasAnyNotify = !!(notifyPrefs.email || notifyPrefs.discord);

  const courses = watchedCoursesData.get(uid);
  const now = Date.now();
  const watching = [];

  if (courses) {
    for (const [, w] of courses) {
      const stateKey = `${uid}::${w.CourseNo}`;
      const state = stateMap.get(stateKey) ?? null;
      const cacheKey = `${w.Semester ?? ""}::${w.CourseNo}`;
      const cached = courseCache.get(cacheKey);
      const stats = fetchStats.get(cacheKey) ?? null;

      // Explain why the poller might be skipping this course.
      const skipReasons = [];
      if (!hasAnyNotify) {
        skipReasons.push(
          "no notification channel enabled (email/discord both off)",
        );
      }
      if (!w.notifyEnabled) skipReasons.push("bell not enabled for this course");

      watching.push({
        courseNo: w.CourseNo,
        courseName: w.CourseName ?? "",
        notifyEnabled: w.notifyEnabled ?? false,
        skipReasons,
        state: state
          ? { wasFull: state.wasFull, notifiedOpen: state.notifiedOpen }
          : null,
        cache: cached
          ? {
              ageMs: now - cached.fetchedAt,
              ageSeconds: Math.round((now - cached.fetchedAt) / 1000),
              chooseStudent: cached.course.ChooseStudent,
              restrict1: cached.course.Restrict1,
            }
          : null,
        ntust: stats
          ? {
              lastSuccessAt: stats.lastSuccessAt
                ? new Date(stats.lastSuccessAt).toISOString()
                : null,
              lastErrorAt: stats.lastErrorAt
                ? new Date(stats.lastErrorAt).toISOString()
                : null,
              lastError: stats.lastError ?? null,
              consecutiveFailures: stats.consecutiveFailures,
              totalFetches: stats.totalFetches,
            }
          : null,
      });
    }
  }

  res.json({
    pollerReady: !isFirstNotifyRun,
    hasAnyNotify,
    isAuthUser,
    requestedIntervalMs: requestedInterval,
    effectiveIntervalMs: effectiveInterval,
    lastPolled: userLastPolled.has(uid)
      ? new Date(userLastPolled.get(uid)).toISOString()
      : null,
    watching,
  });
});

/**
 * POST /api/notify/test
 *
 * Sends a fake notification immediately using the authenticated user's current
 * notification preferences.
 *
 * This is intended for setup validation only and does not modify notification
 * state or watched course state.
 *
 * @param {import("express").Request & { user: { uid: string } }} req - Authenticated request.
 * @param {import("express").Response} res - Express response object.
 * @returns {Promise<void>}
 */
app.post("/api/notify/test", generalLimiter, requireAuth, async (req, res) => {
  const uid = req.user.uid;
  const userData = usersData.get(uid);
  if (!userData) {
    return res
      .status(404)
      .json({ error: "User data not yet loaded — retry in a few seconds." });
  }

  const { email: userEmail, notifyPrefs } = userData;
  const results = { discord: null, email: null };

  /**
   * Synthetic course object used only for test-notification delivery.
   *
   * It mimics the shape of a real NTUST course record closely enough for the
   * Discord and email formatting helpers to render a realistic message.
   *
   * @type {Record<string, string | number>}
   */
  const fakeCourse = {
    CourseNo: "TEST0000",
    CourseName: "Test Notification",
    CourseTeacher: "NTUST Notify",
    Restrict1: "30",
    ChooseStudent: 29,
    CreditPoint: 3,
    ClassRoomNo: "TR-101",
    Node: "M1,W3",
    Semester: "1142",
  };

  if (notifyPrefs.discord) {
    try {
      await sendDiscordNotification(fakeCourse, notifyPrefs);
      results.discord = "sent";
    } catch (err) {
      results.discord = `failed: ${err.message}`;
    }
  } else {
    results.discord = "not configured";
  }

  if (notifyPrefs.email) {
    try {
      await sendEmailNotification(fakeCourse, userEmail);
      results.email = "sent";
    } catch (err) {
      results.email = `failed: ${err.message}`;
    }
  } else {
    results.email = "not configured";
  }

  res.json({ results });
});

/**
 * GET /api/poll-options
 *
 * Returns the minimum allowed poll interval and the list of selectable poll
 * intervals for the current caller.
 *
 * If the caller is not authenticated, or Firebase is unavailable, the route
 * falls back to the standard non-privileged polling options.
 *
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @returns {Promise<void>}
 */
app.get("/api/poll-options", generalLimiter, async (req, res) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token || !db) {
    return res.json({ minInterval: 30_000, options: NORMAL_POLL_OPTIONS });
  }

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const email = (decoded.email ?? "").toLowerCase();
    const isAuth = AUTH_EMAILS.length > 0 && AUTH_EMAILS.includes(email);

    return res.json({
      minInterval: isAuth ? 1_000 : 30_000,
      options: isAuth ? AUTH_POLL_OPTIONS : NORMAL_POLL_OPTIONS,
    });
  } catch {
    return res.json({ minInterval: 30_000, options: NORMAL_POLL_OPTIONS });
  }
});

/**
 * POST /api/courses
 *
 * Proxies a course search request to the official NTUST API.
 *
 * This route accepts a partial search payload from the client, fills in the
 * remaining NTUST-specific fields expected by the upstream API, and returns the
 * resulting array of courses.
 *
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @returns {Promise<void>}
 */
app.post("/api/courses", courseLimiter, requireAuth, async (req, res) => {
  const payload = {
    Semester: req.body.Semester ?? "1142",
    CourseNo: req.body.CourseNo ?? "",
    CourseName: req.body.CourseName ?? "",
    CourseTeacher: req.body.CourseTeacher ?? "",
    Dimension: "",
    CourseNotes: "",
    ForeignLanguage: 0,
    OnlyGeneral: 0,
    OnleyNTUST: 0,
    OnlyUnderGraduate: 0,
    OnlyMaster: 0,
    Language: "zh",
    CampusNotes: "undefined",
  };

  try {
    const response = await axios.post(NTUST_API, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    });

    if (!Array.isArray(response.data)) {
      return res
        .status(502)
        .json({ error: "Unexpected response format from NTUST API" });
    }

    return res.json(response.data);
  } catch (err) {
    console.error("[ERROR] Failed to fetch courses:", err.message);
    return res.status(502).json({
      error: "Failed to fetch courses from NTUST API",
      detail: err.message,
    });
  }
});

// ─── Notification helpers ─────────────────────────────────────────────────────
/**
 * Determines whether a course is currently full.
 *
 * A course is considered full only when Restrict1 is a valid positive number
 * and the current ChooseStudent count is greater than or equal to that limit.
 *
 * @param {{Restrict1: string | number, ChooseStudent: number}} course - Course record returned by NTUST.
 * @returns {boolean}
 */
function isFull(course) {
  const limit = parseInt(course.Restrict1, 10);
  return !isNaN(limit) && limit > 0 && course.ChooseStudent >= limit;
}

/**
 * Calculates how many seats remain in a course.
 *
 * If the course limit cannot be parsed as a number, the function returns "?"
 * to signal that the remaining-seat count is unknown.
 *
 * @param {{Restrict1: string | number, ChooseStudent: number}} course - Course record returned by NTUST.
 * @returns {number | string}
 */
function remainingSlots(course) {
  const limit = parseInt(course.Restrict1, 10);
  return !isNaN(limit) ? Math.max(0, limit - course.ChooseStudent) : "?";
}

/**
 * Maps NTUST weekday codes to human-readable English day abbreviations.
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
  1: "08:10",
  2: "09:10",
  3: "10:10",
  4: "11:10",
  5: "12:10",
  6: "13:10",
  7: "14:10",
  8: "15:10",
  9: "16:10",
  10: "17:10",
  11: "18:10",
  12: "19:10",
  A: "07:10",
  n: "12:10",
  N: "13:10",
};

/**
 * Converts an NTUST schedule node string into a human-readable schedule.
 *
 * Example:
 * - Input: "M1,W3"
 * - Output: "Mon 08:10, Wed 10:10"
 *
 * If no node string is provided, the function returns "N/A".
 *
 * @param {string} node - Raw schedule node string from NTUST.
 * @returns {string}
 */
function formatNode(node) {
  if (!node) return "N/A";

  return node
    .split(",")
    .map((n) => {
      const day = DAY_MAP[n[0]] ?? n[0];
      const period = n.slice(1);
      const time =
        PERIOD_MAP[isNaN(period) ? period : parseInt(period, 10)] ?? period;
      return `${day} ${time}`;
    })
    .join(", ");
}

/**
 * Sends a Discord webhook notification for an open course slot.
 *
 * The message is formatted as a Discord embed and can optionally mention the
 * user if their Discord ID and mention preference are configured.
 *
 * @param {Record<string, any>} course - Course data used to render the notification.
 * @param {{discordWebhook?: string, discordTagMe?: boolean, discordUserId?: string}} notify - Notification preferences for the user.
 * @returns {Promise<void>}
 */
async function sendDiscordNotification(course, notify) {
  const webhookUrl = notify.discordWebhook;
  if (!webhookUrl) return;

  const limit = parseInt(course.Restrict1, 10);
  const enrolled = course.ChooseStudent;
  const remaining = remainingSlots(course);

  const embed = {
    title: "🎉 Course Slot Available!",
    color: 0x57f287,
    fields: [
      { name: "Course No.", value: course.CourseNo, inline: true },
      { name: "Name", value: course.CourseName, inline: true },
      { name: "Teacher", value: course.CourseTeacher || "N/A", inline: true },
      {
        name: "Enrollment",
        value: `${enrolled} / ${isNaN(limit) ? "?" : limit} (${remaining} remaining)`,
        inline: true,
      },
      {
        name: "Credits",
        value: String(course.CreditPoint ?? "?"),
        inline: true,
      },
      { name: "Room", value: course.ClassRoomNo || "N/A", inline: true },
      { name: "Schedule", value: formatNode(course.Node), inline: false },
    ],
    footer: {
      text: `Semester ${course.Semester} • ${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}`,
    },
    url: "https://querycourse.ntust.edu.tw",
  };

  const mention =
    notify.discordTagMe && notify.discordUserId
      ? `<@${notify.discordUserId}>`
      : "";

  try {
    await axios.post(webhookUrl, { content: mention, embeds: [embed] });
    console.log(`[DISCORD] Sent alert for ${course.CourseNo}`);
  } catch (err) {
    console.error("[DISCORD] Failed to send webhook:", err.message);
  }
}

/**
 * Sends an email notification for an open course slot.
 *
 * The function builds a small HTML email containing the key course details and
 * a link back to the official NTUST course query page.
 *
 * @param {Record<string, any>} course - Course data used to render the email.
 * @param {string} toEmail - Recipient email address.
 * @returns {Promise<void>}
 */
async function sendEmailNotification(course, toEmail) {
  if (!mailer || !toEmail) return;

  const limit = parseInt(course.Restrict1, 10);
  const enrolled = course.ChooseStudent;
  const remaining = remainingSlots(course);

  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:auto">
      <h2 style="color:#22c55e">🎉 A slot just opened!</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px;color:#6b7280">Course No.</td><td style="padding:6px;font-weight:600">${course.CourseNo}</td></tr>
        <tr><td style="padding:6px;color:#6b7280">Name</td><td style="padding:6px;font-weight:600">${course.CourseName}</td></tr>
        <tr><td style="padding:6px;color:#6b7280">Teacher</td><td style="padding:6px">${course.CourseTeacher || "N/A"}</td></tr>
        <tr><td style="padding:6px;color:#6b7280">Enrollment</td><td style="padding:6px">${enrolled} / ${isNaN(limit) ? "?" : limit} (${remaining} remaining)</td></tr>
        <tr><td style="padding:6px;color:#6b7280">Credits</td><td style="padding:6px">${course.CreditPoint ?? "?"}</td></tr>
        <tr><td style="padding:6px;color:#6b7280">Room</td><td style="padding:6px">${course.ClassRoomNo || "N/A"}</td></tr>
        <tr><td style="padding:6px;color:#6b7280">Schedule</td><td style="padding:6px">${formatNode(course.Node)}</td></tr>
      </table>
      <p style="margin-top:16px">
        <a href="https://querycourse.ntust.edu.tw" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open Course Query</a>
      </p>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px">Semester ${course.Semester} • NTUST Course Tracker</p>
    </div>
  `;

  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to: toEmail,
      subject: `🎉 Slot opened: ${course.CourseNo} ${course.CourseName}`,
      html,
    });
    console.log(`[EMAIL] Sent alert for ${course.CourseNo} → ${toEmail}`);
  } catch (err) {
    console.error("[EMAIL] Failed to send:", err.message);
  }
}

// ─── Notification polling ─────────────────────────────────────────────────────

/**
 * Per-user, per-course notification state.
 *
 * Key format:
 * - `${uid}::${courseNo}`
 *
 * Value shape:
 * - wasFull: whether the course was full on the previous successful poll.
 * - notifiedOpen: whether an OPEN notification has already been sent for the
 *   current open window.
 *
 * @type {Map<string, { wasFull: boolean, notifiedOpen: boolean }>}
 */
const stateMap = new Map();

/**
 * Last time each user was polled.
 *
 * Key format:
 * - uid
 *
 * Value:
 * - Unix timestamp in milliseconds.
 *
 * @type {Map<string, number>}
 */
const userLastPolled = new Map();

/**
 * Cached NTUST course responses used to avoid redundant upstream requests.
 *
 * Key format:
 * - `${semester}::${courseNo}`
 *
 * Value shape:
 * - course: last fetched NTUST course object.
 * - fetchedAt: Unix timestamp in milliseconds.
 *
 * @type {Map<string, { course: Record<string, any>, fetchedAt: number }>}
 */
const courseCache = new Map();

/**
 * Operational stats for each NTUST fetch target.
 *
 * This is mainly used for observability in the status route, so the client can
 * understand recent fetch success/failure behavior.
 *
 * @type {Map<string, {
 *   lastSuccessAt?: number | null,
 *   lastErrorAt?: number | null,
 *   lastError?: string | null,
 *   consecutiveFailures: number,
 *   totalFetches: number,
 * }>} 
 */
const fetchStats = new Map();

/**
 * Whether the poller is still on its first initialization sweep.
 *
 * During the first run, state is seeded without sending alerts so users do not
 * get spammed for courses that were already open before the backend started.
 *
 * @type {boolean}
 */
let isFirstNotifyRun = true;

/**
 * Guard flag that prevents overlapping poll cycles.
 *
 * @type {boolean}
 */
let pollRunning = false;

// ─── In-memory Firestore mirror ───────────────────────────────────────────────
// onSnapshot listeners keep these maps current in real time so the poll loop
// can avoid repeated Firestore reads.

/**
 * Cached user records mirrored from Firestore.
 *
 * Key format:
 * - uid
 *
 * Value shape:
 * - email: user's email address.
 * - notifyPrefs: notification preference object stored in Firestore.
 *
 * @type {Map<string, { email: string, notifyPrefs: Record<string, any> }>}
 */
const usersData = new Map();

/**
 * Cached watched-course records mirrored from each user's watchedCourses
 * subcollection.
 *
 * Outer map key:
 * - uid
 *
 * Inner map key:
 * - courseNo
 *
 * @type {Map<string, Map<string, Record<string, any>>>}
 */
const watchedCoursesData = new Map();

/**
 * Active unsubscribe callbacks for watchedCourses snapshot listeners.
 *
 * Key format:
 * - uid
 *
 * Value:
 * - Firestore unsubscribe function.
 *
 * @type {Map<string, () => void>}
 */
const watchListeners = new Map();

/**
 * Ensures that a real-time Firestore listener exists for a user's watched
 * courses subcollection.
 *
 * When the snapshot updates, the backend rebuilds the user's in-memory course
 * map so the poll loop can read current course preferences without performing
 * Firestore queries every cycle.
 *
 * @param {string} uid - Firebase user ID.
 * @returns {void}
 */
function setupWatchedCoursesListener(uid) {
  if (watchListeners.has(uid)) return;

  const unsub = db
    .collection("users")
    .doc(uid)
    .collection("watchedCourses")
    .onSnapshot(
      (snap) => {
        const courses = new Map();
        snap.forEach((doc) => {
          const d = doc.data();
          courses.set(d.CourseNo, d);
        });
        watchedCoursesData.set(uid, courses);
      },
      (err) =>
        console.error(
          `[FIRESTORE] watchedCourses error (${uid}):`,
          err.message,
        ),
    );

  watchListeners.set(uid, unsub);
}

/**
 * Sets up the top-level Firestore snapshot listener for the users collection.
 *
 * This listener keeps the in-memory user cache synchronized and creates or
 * removes subcollection listeners as users appear, update, or are deleted.
 *
 * @returns {void}
 */
function setupFirestoreListeners() {
  if (!db) return;

  console.log("[FIRESTORE] Setting up real-time listeners…");
  db.collection("users").onSnapshot(
    (snap) => {
      snap.docChanges().forEach((change) => {
        const uid = change.doc.id;
        if (change.type === "removed") {
          usersData.delete(uid);
          watchedCoursesData.delete(uid);
          const unsub = watchListeners.get(uid);
          if (unsub) {
            unsub();
            watchListeners.delete(uid);
          }
        } else {
          const d = change.doc.data();
          usersData.set(uid, {
            email: d.email ?? "",
            notifyPrefs: d.notifyPrefs ?? {},
          });
          setupWatchedCoursesListener(uid);
        }
      });
    },
    (err) => console.error("[FIRESTORE] users listener error:", err.message),
  );
}

/**
 * Runs a single notification polling cycle.
 *
 * High-level flow:
 * 1. Read user and watched-course state from in-memory caches.
 * 2. Build a deduplicated course map across all eligible subscribers.
 * 3. Reuse fresh cached NTUST data or fetch live data when needed.
 * 4. Detect FULL → OPEN transitions for each subscriber.
 * 5. Send Discord/email notifications exactly once per open window.
 *
 * Important behavior:
 * - No Firestore reads happen inside the poll loop.
 * - Stale NTUST cache is never used to change notification state.
 * - The first poll seeds state without sending alerts.
 *
 * @returns {Promise<void>}
 */
async function pollNotifications() {
  if (!db || pollRunning) return;

  pollRunning = true;
  try {
    // Build a unique course map from in-memory data — no Firestore reads.
    const courseMap = new Map();

    for (const [uid, userData] of usersData) {
      const { email: userEmail, notifyPrefs } = userData;
      const hasAnyNotify = notifyPrefs.email || notifyPrefs.discord;
      if (!hasAnyNotify) continue;

      const isAuthUser =
        AUTH_EMAILS.length > 0 && AUTH_EMAILS.includes(userEmail.toLowerCase());
      const minInterval = isAuthUser ? 1_000 : 30_000;
      const requestedInterval = notifyPrefs.pollInterval ?? 60_000;
      const effectiveInterval = Math.max(requestedInterval, minInterval);

      const lastPolled = userLastPolled.get(uid) ?? 0;
      if (!isFirstNotifyRun && Date.now() - lastPolled < effectiveInterval) {
        continue;
      }
      userLastPolled.set(uid, Date.now());

      const courses = watchedCoursesData.get(uid);
      if (!courses) continue;

      for (const [, w] of courses) {
        if (!w.notifyEnabled) continue;

        const key = `${w.Semester ?? ""}::${w.CourseNo}`;
        if (!courseMap.has(key)) {
          courseMap.set(key, {
            Semester: w.Semester ?? "1142",
            CourseNo: w.CourseNo,
            subscribers: [],
            maxAgeMs: effectiveInterval,
          });
        } else {
          const entry = courseMap.get(key);
          entry.maxAgeMs = Math.min(entry.maxAgeMs, effectiveInterval);
        }

        courseMap
          .get(key)
          .subscribers.push({ uid, email: userEmail, notify: notifyPrefs });
      }
    }

    if (courseMap.size === 0) return;

    // For each unique course, fetch live data from NTUST or reuse fresh cache.
    for (const [key, entry] of courseMap) {
      const cached = courseCache.get(key);
      const now = Date.now();
      let course;
      let isStale = false;

      if (cached && now - cached.fetchedAt < entry.maxAgeMs) {
        course = cached.course;
        console.log(
          `[NOTIFY] Cache hit for ${entry.CourseNo} (${Math.round((now - cached.fetchedAt) / 1000)}s old, max ${Math.round(entry.maxAgeMs / 1000)}s)`,
        );
      } else {
        try {
          const res = await axios.post(
            NTUST_API,
            {
              Semester: entry.Semester,
              CourseNo: entry.CourseNo,
              CourseName: "",
              CourseTeacher: "",
              Dimension: "",
              CourseNotes: "",
              ForeignLanguage: 0,
              OnlyGeneral: 0,
              OnleyNTUST: 0,
              OnlyUnderGraduate: 0,
              OnlyMaster: 0,
              Language: "zh",
              CampusNotes: "undefined",
            },
            { headers: { "Content-Type": "application/json" }, timeout: 15000 },
          );

          const courses = Array.isArray(res.data) ? res.data : [];
          course = courses.find((c) => c.CourseNo === entry.CourseNo) ?? null;
          if (course) courseCache.set(key, { course, fetchedAt: now });

          const prev = fetchStats.get(key) ?? {
            totalFetches: 0,
            consecutiveFailures: 0,
          };
          fetchStats.set(key, {
            ...prev,
            lastSuccessAt: now,
            lastError: null,
            lastErrorAt: prev.lastErrorAt ?? null,
            consecutiveFailures: 0,
            totalFetches: prev.totalFetches + 1,
          });
        } catch (err) {
          console.error(
            `[NOTIFY] Failed to fetch ${entry.CourseNo}:`,
            err.message,
          );

          const prev = fetchStats.get(key) ?? {
            totalFetches: 0,
            consecutiveFailures: 0,
          };
          fetchStats.set(key, {
            ...prev,
            lastError: err.message,
            lastErrorAt: now,
            lastSuccessAt: prev.lastSuccessAt ?? null,
            consecutiveFailures: (prev.consecutiveFailures ?? 0) + 1,
            totalFetches: prev.totalFetches + 1,
          });

          // Fall back to stale cache so we keep the last known course record,
          // but avoid making state-transition decisions based on outdated data.
          course = cached?.course ?? null;
          isStale = true;
        }
      }

      if (!course) continue;

      // If stale data is being used, preserve the previous notification state.
      if (isStale) {
        console.log(
          `[NOTIFY] Skipping state update for ${entry.CourseNo} — using stale data`,
        );
        continue;
      }

      const nowFull = isFull(course);

      // Notify each subscriber independently if a slot just opened.
      for (const sub of entry.subscribers) {
        const stateKey = `${sub.uid}::${entry.CourseNo}`;
        const prev = stateMap.get(stateKey);

        if (isFirstNotifyRun) {
          // Seed initial state without sending alerts.
          stateMap.set(stateKey, { wasFull: nowFull, notifiedOpen: !nowFull });
          continue;
        }

        if (!nowFull && prev?.wasFull && !prev?.notifiedOpen) {
          console.log(
            `[NOTIFY] Slot opened for ${entry.CourseNo} — notifying uid ${sub.uid}`,
          );

          const n = sub.notify;
          if (n.discord) await sendDiscordNotification(course, n);
          if (n.email) await sendEmailNotification(course, sub.email);

          stateMap.set(stateKey, { wasFull: false, notifiedOpen: true });
        } else if (nowFull) {
          // Reset the notification flag so the next reopen triggers a new alert.
          stateMap.set(stateKey, { wasFull: true, notifiedOpen: false });
        } else {
          stateMap.set(stateKey, {
            wasFull: false,
            notifiedOpen: prev?.notifiedOpen ?? false,
          });
        }
      }
    }

    if (isFirstNotifyRun) {
      isFirstNotifyRun = false;
      console.log(
        `[NOTIFY] First run — state seeded for ${stateMap.size} subscription(s).`,
      );
    }
  } catch (err) {
    console.error("[NOTIFY] Poll error:", err.message);
  } finally {
    pollRunning = false;
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[SERVER] NTUST Notify API running on port ${PORT}`);

  if (db) {
    const authNote = AUTH_EMAILS.length
      ? ` (${AUTH_EMAILS.length} auth email(s) may poll at 1 s)`
      : "";
    console.log(
      `[NOTIFY] Polling loop started — per-user intervals enforced${authNote}`,
    );

    setupFirestoreListeners();

    /**
     * Schedules the next polling cycle after the current cycle has completed.
     *
     * Recursive setTimeout is used instead of setInterval so the backend never
     * starts a new poll while the previous poll is still running.
     *
     * @returns {void}
     */
    function scheduleNextPoll() {
      setTimeout(async () => {
        await pollNotifications();
        scheduleNextPoll();
      }, 1_000);
    }

    // Give Firestore listeners a brief moment to warm up before the first poll.
    setTimeout(() => {
      pollNotifications().then(scheduleNextPoll);
    }, 2_000);
  }
});
