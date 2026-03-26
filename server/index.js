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
 * Upstream NTUST course query endpoint used for both direct course searches and
 * background availability polling.
 */
const NTUST_API = "https://querycourse.ntust.edu.tw/QueryCourse/api/courses";

// ─── Auth emails & poll intervals ────────────────────────────────────────────
// AUTH_EMAILS: comma-separated list of email addresses that may poll as fast as
// 1 s. All other users are capped at a 30 s minimum.
const AUTH_EMAILS = process.env.AUTH_EMAILS
  ? process.env.AUTH_EMAILS.split(",").map((e) => e.trim().toLowerCase())
  : [];

/**
 * Poll intervals exposed to regular users.
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
 * Poll intervals exposed to privileged users. These users may select the extra
 * 1-second polling option in addition to the normal set.
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
const ALLOWED_ORIGINS = [
  ...(process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["https://notify.stanleyowen.com", "https://ntust.netlify.app"]),
];

app.use(
  cors({
    /**
     * Validates whether an incoming browser origin may access the API.
     * Requests without an Origin header (for example curl or server-to-server
     * traffic) are allowed.
     *
     * @param {string | undefined} origin - Incoming request origin.
     * @param {(err: Error | null, allow?: boolean) => void} callback - CORS callback.
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
// Course proxy: max 30 requests per minute per IP.
const courseLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

// Poll options / general: max 60 requests per minute per IP.
const generalLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

// ─── Auth middleware ──────────────────────────────────────────────────────────
/**
 * Verifies the Firebase ID token attached to the Authorization header and
 * stores the decoded user payload on req.user.
 *
 * @param {import("express").Request} req - Express request object.
 * @param {import("express").Response} res - Express response object.
 * @param {import("express").NextFunction} next - Express next callback.
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
 * Lightweight health endpoint used by deployments and uptime checks.
 */
app.get("/health", generalLimiter, (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * GET /api/notify/status
 * Authorization: Bearer <firebase-id-token>
 *
 * Returns the current in-memory polling state for the requesting user's watched
 * courses, including whether each course is currently considered full/open,
 * whether the open-state notification has already been sent, and the current
 * NTUST cache health.
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
 * Authorization: Bearer <firebase-id-token>
 *
 * Sends immediate test notifications through the configured Discord webhook and
 * email channel so the user can verify both integrations without waiting for a
 * real course state change.
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
   * Synthetic course payload used purely for smoke-testing notification output.
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
 * Authorization: Bearer <firebase-id-token>
 *
 * Returns the polling interval options available to the caller. Unauthenticated
 * callers receive the regular user defaults.
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
 * Authorization: Bearer <firebase-id-token>
 * Body: { Semester, CourseNo, CourseName, CourseTeacher }
 *
 * Proxies course search requests to the official NTUST API while applying this
 * service's timeout, validation, and rate limiting rules.
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
 * Determines whether a course is currently full according to its enrollment
 * limit and chosen student count.
 *
 * @param {{Restrict1: string | number, ChooseStudent: number}} course - Course record.
 * @returns {boolean}
 */
function isFull(course) {
  const limit = parseInt(course.Restrict1, 10);
  return !isNaN(limit) && limit > 0 && course.ChooseStudent >= limit;
}

/**
 * Calculates the number of remaining seats for a course.
 *
 * @param {{Restrict1: string | number, ChooseStudent: number}} course - Course record.
 * @returns {number | string}
 */
function remainingSlots(course) {
  const limit = parseInt(course.Restrict1, 10);
  return !isNaN(limit) ? Math.max(0, limit - course.ChooseStudent) : "?";
}

/**
 * Maps NTUST schedule day codes to readable English day names.
 *
 * @type {Record<string, string>}
 */
const DAY_MAP = { M: "Mon", T: "Tue", W: "Wed", R: "Thu", F: "Fri", S: "Sat" };

/**
 * Maps NTUST period codes to approximate start times.
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
 * Converts NTUST node strings such as "M1,W3" into a more readable schedule
 * string such as "Mon 08:10, Wed 10:10".
 *
 * @param {string} node - Raw NTUST schedule string.
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
 * Sends a Discord webhook notification announcing that a course has opened.
 *
 * @param {Record<string, any>} course - Course data payload.
 * @param {{discordWebhook?: string, discordTagMe?: boolean, discordUserId?: string}} notify - User notification preferences.
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
 * Sends an email notification announcing that a course has opened.
 *
 * @param {Record<string, any>} course - Course data payload.
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
// stateMap key: `uid::courseNo`
// value: { wasFull: boolean, notifiedOpen: boolean }
//   wasFull      – whether the course was full on the last poll.
//   notifiedOpen – whether a notification has already been sent for the current
//                  open window. This resets to false once the course becomes
//                  full again, allowing one fresh alert the next time it opens.
const stateMap = new Map();

// Track when each user was last polled so per-user intervals are respected.
const userLastPolled = new Map();

// Cache the last NTUST result per course key.
// key: `semester::courseNo` → { course: object, fetchedAt: number }
const courseCache = new Map();

// Track NTUST fetch health per course.
// key: `semester::courseNo` → { lastSuccessAt, lastErrorAt, lastError, consecutiveFailures, totalFetches }
const fetchStats = new Map();

let isFirstNotifyRun = true;
let pollRunning = false;

// ─── In-memory Firestore mirror ───────────────────────────────────────────────
// onSnapshot listeners keep these maps current in real time so the poll loop
// can avoid repeated Firestore reads.
const usersData = new Map();
const watchedCoursesData = new Map();
const watchListeners = new Map();

/**
 * Creates a real-time listener for a user's watchedCourses subcollection and
 * mirrors the latest documents into memory.
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
 * Attaches the top-level Firestore listener for users and dynamically manages
 * the watched-courses subcollection listeners for each active user.
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
 * Executes one notification polling cycle.
 *
 * The poller builds a deduplicated course list from in-memory Firestore state,
 * fetches fresh or cached NTUST course data, detects FULL → OPEN transitions on
 * a per-user basis, and sends Discord/email notifications exactly once per open
 * window.
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

      // If the fetch failed and we are using stale data, preserve the existing
      // state rather than risk a missed FULL → OPEN transition.
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
          // Reset the open-window notification state once the course is full.
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
     * Schedules the next polling cycle only after the current cycle has fully
     * completed. This avoids overlapping executions that could otherwise create
     * duplicate work or inconsistent notification state.
     *
     * @returns {void}
     */
    function scheduleNextPoll() {
      setTimeout(async () => {
        await pollNotifications();
        scheduleNextPoll();
      }, 1_000);
    }

    // Give the initial onSnapshot listeners a moment to populate memory before
    // the first notification sweep starts.
    setTimeout(() => {
      pollNotifications().then(scheduleNextPoll);
    }, 2_000);
  }
});
