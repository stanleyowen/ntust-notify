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

const NTUST_API = "https://querycourse.ntust.edu.tw/QueryCourse/api/courses";

// ─── Auth emails & poll intervals ────────────────────────────────────────────
// AUTH_EMAILS: comma-separated list of email addresses that may poll as fast as
// 1 s.  All other users are capped at a 10 s minimum.
const AUTH_EMAILS = process.env.AUTH_EMAILS
  ? process.env.AUTH_EMAILS.split(",").map((e) => e.trim().toLowerCase())
  : [];

const NORMAL_POLL_OPTIONS = [
  { label: "30 seconds", value: 30_000 },
  { label: "1 minute", value: 60_000 },
  { label: "3 minutes", value: 180_000 },
  { label: "5 minutes", value: 300_000 },
  { label: "10 minutes", value: 600_000 },
];
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
    // Falls back to GOOGLE_APPLICATION_CREDENTIALS or ADC
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
// Allowed origins: ALLOWED_ORIGINS env var (comma-separated) merged with
// localhost variants that are always allowed for local development.
const ALLOWED_ORIGINS = [
  ...(process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : ["https://notify.stanleyowen.com", "https://ntust.netlify.app"]),
];

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests with no origin (curl, Postman, server-to-server)
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
// Trust the first proxy hop (nginx, Caddy, etc.) so express-rate-limit can
// read the real client IP from X-Forwarded-For instead of the proxy's IP.
app.set("trust proxy", 1);
app.use(helmet()); // Sets X-Content-Type-Options, X-Frame-Options, HSTS, etc.
app.use(express.json({ limit: "16kb" })); // Reject oversized bodies

// ─── Rate limiting ───────────────────────────────────────────────────────────────
// Course proxy: max 30 requests per minute per IP
const courseLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});
// Poll options / general: max 60 per minute per IP
const generalLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
});

// ─── Auth middleware ───────────────────────────────────────────────────────────────
// Verifies Firebase ID token for routes that require a logged-in user.
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
app.get("/health", generalLimiter, (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * GET /api/poll-options
 * Authorization: Bearer <firebase-id-token>
 * Returns the available poll intervals and minInterval for the requesting user.
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
 * Authorization: Bearer <firebase-id-token>  (required)
 * Body: { Semester, CourseNo, CourseName, CourseTeacher }
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
function isFull(course) {
  const limit = parseInt(course.Restrict1, 10);
  return !isNaN(limit) && limit > 0 && course.ChooseStudent >= limit;
}

function remainingSlots(course) {
  const limit = parseInt(course.Restrict1, 10);
  return !isNaN(limit) ? Math.max(0, limit - course.ChooseStudent) : "?";
}

const DAY_MAP = { M: "Mon", T: "Tue", W: "Wed", R: "Thu", F: "Fri", S: "Sat" };
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
//   wasFull      – was the course full on the last poll?
//   notifiedOpen – have we already sent a notification for the *current* open
//                  window?  Reset to false whenever the course becomes full
//                  again, allowing one fresh alert the next time it opens.
const stateMap = new Map();
// Track when each user was last polled so per-user intervals are respected.
const userLastPolled = new Map(); // uid → Date.now() timestamp
// Cache the last NTUST result per course key to avoid redundant fetches.
// key: `semester::courseNo` → { course: object, fetchedAt: number }
const courseCache = new Map();
let isFirstNotifyRun = true;
let pollRunning = false; // prevents concurrent poll executions

// ─── In-memory Firestore mirror ───────────────────────────────────────────────
// onSnapshot listeners keep these maps current in real time.
// Zero Firestore reads happen inside the poll loop — only when data changes.
const usersData = new Map(); // uid → { email, notifyPrefs }
const watchedCoursesData = new Map(); // uid → Map<courseNo, course doc fields>
const watchListeners = new Map(); // uid → unsubscribe fn for subcollection

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

async function pollNotifications() {
  if (!db || pollRunning) return;
  pollRunning = true;
  try {
    // Build courseMap from in-memory data — no Firestore reads.
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
      if (!isFirstNotifyRun && Date.now() - lastPolled < effectiveInterval)
        continue;
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

    // 3. For each unique course, fetch live data from NTUST (or reuse cache).
    for (const [key, entry] of courseMap) {
      const cached = courseCache.get(key);
      const now = Date.now();
      let course;
      let isStale = false;

      if (cached && now - cached.fetchedAt < entry.maxAgeMs) {
        // Cached result is still fresh enough for all due subscribers — skip NTUST.
        course = cached.course;
        console.log(
          `[NOTIFY] Cache hit for ${entry.CourseNo} (${Math.round((now - cached.fetchedAt) / 1000)}s old, max ${Math.round(entry.maxAgeMs / 1000)}s)`,
        );
      } else {
        // Fetch fresh data from NTUST.
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
        } catch (err) {
          console.error(
            `[NOTIFY] Failed to fetch ${entry.CourseNo}:`,
            err.message,
          );
          // Fall back to stale cache so we don't lose the course reference,
          // but mark it stale so we don't make state-transition decisions on
          // potentially outdated enrollment data.
          course = cached?.course ?? null;
          isStale = true;
        }
      }

      if (!course) continue;

      // If the fetch failed and we're using stale data, preserve the existing
      // state rather than risk a missed FULL → OPEN transition caused by
      // outdated enrollment counts.
      if (isStale) {
        console.log(
          `[NOTIFY] Skipping state update for ${entry.CourseNo} — using stale data`,
        );
        continue;
      }

      const nowFull = isFull(course);

      // Notify each subscriber if slot just opened
      for (const sub of entry.subscribers) {
        const stateKey = `${sub.uid}::${entry.CourseNo}`;
        const prev = stateMap.get(stateKey);

        if (isFirstNotifyRun) {
          // Seed state — no alerts on first scan
          stateMap.set(stateKey, { wasFull: nowFull, notifiedOpen: !nowFull });
          continue;
        }

        // Course went from FULL → OPEN and we haven't notified yet this window
        if (!nowFull && prev?.wasFull && !prev?.notifiedOpen) {
          console.log(
            `[NOTIFY] Slot opened for ${entry.CourseNo} — notifying uid ${sub.uid}`,
          );

          const n = sub.notify;
          if (n.discord) await sendDiscordNotification(course, n);
          if (n.email) await sendEmailNotification(course, sub.email);

          stateMap.set(stateKey, { wasFull: false, notifiedOpen: true });
        } else if (nowFull) {
          // Course is full — reset so the next open window triggers a fresh alert
          stateMap.set(stateKey, { wasFull: true, notifiedOpen: false });
        } else {
          // Course still open but already notified (or no prior full state)
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
    // Give the initial onSnapshot a moment to populate in-memory data,
    // then start the poll loop.
    // Use recursive setTimeout (not setInterval) so each poll only starts
    // after the previous one fully completes, preventing concurrent executions
    // and the cache-hit pile-up that causes missed notifications.
    function scheduleNextPoll() {
      setTimeout(async () => {
        await pollNotifications();
        scheduleNextPoll();
      }, 1_000);
    }
    setTimeout(() => {
      pollNotifications().then(scheduleNextPoll);
    }, 2_000);
  }
});
