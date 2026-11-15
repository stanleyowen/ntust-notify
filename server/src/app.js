"use strict";

/**
 * Express application: middleware stack and API routes.
 *
 * Dependencies are injected so the whole HTTP surface can be exercised in
 * tests without Firebase or network access.
 */

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { rateLimit } = require("express-rate-limit");
const { parseSearch, parseSemester, parseCourseNo, parsePrefs, normalizePrefs, pollOptionsFor } = require("./validate");

const LIVE_MAX_AGE_MS = 30_000;
const WATCH_LOOKUP_MAX_AGE_MS = 5 * 60_000;
const BEARER_RE = /^Bearer ([A-Za-z0-9._-]{20,4096})$/;

/** Error that maps directly to an HTTP response. */
class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code - Stable machine-readable code the client localises.
   * @param {string} [message]
   */
  constructor(status, code, message) {
    super(message ?? code);
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {{
 *   config: ReturnType<typeof import("./config").loadConfig>,
 *   ntust: ReturnType<typeof import("./ntust").createNtustClient>,
 *   store: ReturnType<typeof import("./store").createFirestoreStore> | null,
 *   poller: ReturnType<typeof import("./poller").createPoller> | null,
 *   notifier: ReturnType<typeof import("./notifier").createNotifier>,
 *   verifyIdToken: ((token: string) => Promise<Record<string, any>>) | null,
 *   logger?: Pick<Console, "log" | "warn" | "error">,
 * }} deps
 */
function createApp({ config, ntust, store, poller, notifier, verifyIdToken, logger = console }) {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.set("etag", false);

  // JSON-only API: lock the CSP all the way down. useDefaults:false so
  // helmet's HTML-oriented defaults (style-src 'unsafe-inline', …) aren't merged in.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );

  const allowed = new Set(config.allowedOrigins);
  app.use(
    cors({
      // Unknown origins get no CORS headers (browser blocks the response)
      // rather than a 500 with an error message.
      origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 600, // cache preflights for 10 min — fewer round-trips
    }),
  );

  app.use(express.json({ limit: "8kb", strict: true }));

  // ── Rate limiting ────────────────────────────────────────────────────────
  const limitHandler = (_req, res) =>
    res.status(429).json({ error: "Too many requests — please slow down.", code: "rate_limited" });
  const base = { standardHeaders: "draft-8", legacyHeaders: false, handler: limitHandler };

  // Coarse per-IP flood ceiling, applied before token verification so floods
  // can't burn CPU on JWT checks. Deliberately generous: thousands of students
  // share a handful of campus NAT IPs during course selection, so real abuse
  // control is the per-user limiters below.
  const ipLimiter = rateLimit({ ...base, windowMs: 60_000, limit: 1200 });
  /** Per-user limiter (runs after auth, so it can't be dodged by rotating IPs). */
  const perUser = (windowMs, limit) =>
    rateLimit({ ...base, windowMs, limit, keyGenerator: (req) => `u:${req.user.uid}` });
  const searchLimiter = perUser(60_000, 40);
  const writeLimiter = perUser(60_000, 60);
  const readLimiter = perUser(60_000, 60);
  const liveLimiter = perUser(60_000, 12);
  const testLimiter = perUser(10 * 60_000, 5);

  // ── Auth ─────────────────────────────────────────────────────────────────

  // ID tokens stay cryptographically valid for up to an hour after the account
  // is deleted. Remember recent deletions so a leftover token (e.g. on another
  // device) can't keep using the API or re-create the user document.
  const TOKEN_LIFETIME_MS = 60 * 60 * 1000;
  /** @type {Map<string, number>} uid → deletedAt */
  const deletedUids = new Map();
  function rememberDeleted(uid) {
    const t = Date.now();
    for (const [u, at] of deletedUids) if (t - at > TOKEN_LIFETIME_MS) deletedUids.delete(u);
    deletedUids.set(uid, t);
  }

  /**
   * Builds the auth middleware. `checkRevoked` additionally asks Firebase Auth
   * whether the token was revoked or the account disabled/deleted. It costs a
   * network round-trip, so it's only used on sign-in and account deletion.
   *
   * @param {{ checkRevoked?: boolean }} [opts]
   */
  function authenticate({ checkRevoked = false } = {}) {
    return async function requireAuth(req, _res, next) {
      if (!verifyIdToken || !store) throw new HttpError(503, "auth_unavailable", "Authentication is not configured.");
      const match = BEARER_RE.exec(req.get("authorization") ?? "");
      if (!match) throw new HttpError(401, "unauthorized", "Sign in required.");
      let decoded;
      try {
        decoded = await verifyIdToken(match[1], { checkRevoked });
      } catch (err) {
        // Firebase Auth itself unreachable: not the user's fault, don't force a re-login.
        if (err?.code === "auth/internal-error") {
          throw new HttpError(503, "auth_unavailable", "Sign-in service is temporarily unavailable.");
        }
        throw new HttpError(401, "invalid_token", "Your session expired — please sign in again.");
      }
      if (deletedUids.has(decoded.uid)) {
        throw new HttpError(401, "invalid_token", "Your session expired — please sign in again.");
      }
      if (!decoded.email || decoded.email_verified !== true) {
        throw new HttpError(403, "email_unverified", "A verified Google account is required.");
      }
      req.user = {
        uid: decoded.uid,
        email: String(decoded.email).toLowerCase(),
        emailVerified: true,
        name: typeof decoded.name === "string" ? decoded.name : "",
        picture: typeof decoded.picture === "string" ? decoded.picture : "",
      };
      await store.whenReady();
      next();
    };
  }
  const requireAuth = authenticate();
  const requireFreshAuth = authenticate({ checkRevoked: true });

  /** When alerts turned on now should switch themselves off. */
  const alertExpiry = () => Date.now() + config.alertDurationDays * 24 * 60 * 60 * 1000;

  /** Builds the bootstrap payload the client needs after sign-in. */
  function accountPayload(req) {
    const { uid, email, name, picture } = req.user;
    const user = store.getUser(uid);
    const privileged = store.isPrivileged(uid);
    return {
      user: { uid, email, displayName: user?.displayName || name, photoURL: user?.photoURL || picture },
      prefs: user?.prefs ?? normalizePrefs(undefined),
      watchlist: store.listWatched(uid),
      limits: {
        maxWatched: config.maxWatchedPerUser,
        alertDurationDays: config.alertDurationDays,
        pollOptions: pollOptionsFor(privileged),
        privileged,
      },
      emailAvailable: notifier.emailEnabled,
    };
  }

  const api = express.Router();
  api.use(ipLimiter);
  api.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  // ── Public routes ────────────────────────────────────────────────────────
  api.get("/semesters", async (_req, res) => {
    try {
      const semesters = await ntust.semesters();
      res.set("Cache-Control", "public, max-age=600");
      res.json({ semesters });
    } catch (err) {
      logger.warn(`[NTUST] semesters failed: ${err.message}`);
      throw new HttpError(502, "upstream_unavailable", "NTUST course system is not responding.");
    }
  });

  // ── Authenticated routes ─────────────────────────────────────────────────
  api.post("/courses", requireAuth, searchLimiter, async (req, res) => {
    const parsed = parseSearch(req.body);
    if (parsed.error) throw new HttpError(400, parsed.error);
    try {
      const { results, fetchedAt } = await ntust.search(parsed.value);
      res.json({ results, fetchedAt });
    } catch (err) {
      logger.warn(`[NTUST] search failed: ${err.message}`);
      throw new HttpError(502, "upstream_unavailable", "NTUST course system is not responding.");
    }
  });

  api.post("/session", requireFreshAuth, writeLimiter, async (req, res) => {
    await store.upsertSession(req.user);
    res.json(accountPayload(req));
  });

  api.get("/me", requireAuth, readLimiter, (req, res) => {
    res.json(accountPayload(req));
  });

  api.put("/me/prefs", requireAuth, writeLimiter, async (req, res) => {
    const parsed = parsePrefs(req.body, store.isPrivileged(req.user.uid));
    if (parsed.error) throw new HttpError(400, parsed.error);
    await store.savePrefs(req.user.uid, parsed.value);
    res.json({ prefs: parsed.value });
  });

  api.delete("/me", requireFreshAuth, writeLimiter, async (req, res) => {
    // Tombstone first so concurrent requests can't re-create data mid-delete;
    // lift it again if the delete fails, so the user isn't locked out.
    rememberDeleted(req.user.uid);
    try {
      await store.deleteUser(req.user.uid);
    } catch (err) {
      deletedUids.delete(req.user.uid);
      throw err;
    }
    logger.log(`[ACCOUNT] Deleted account ${req.user.uid}`);
    res.status(204).end();
  });

  api.get("/watchlist/live", requireAuth, liveLimiter, async (req, res) => {
    const list = store.listWatched(req.user.uid).filter((w) => w.Semester);
    const results = await ntust.getCourses(
      list.map((w) => ({ semester: /** @type {string} */ (w.Semester), courseNo: w.CourseNo })),
      { maxAgeMs: LIVE_MAX_AGE_MS, concurrency: config.pollConcurrency },
    );
    const courses = results
      .map((r, i) =>
        r.course ? { ...r.course, fetchedAt: r.fetchedAt, stale: Boolean(r.error) } : { CourseNo: list[i].CourseNo, missing: true },
      );
    res.json({ courses, fetchedAt: Date.now() });
  });

  api.put("/watchlist/:courseNo", requireAuth, writeLimiter, async (req, res) => {
    const { uid } = req.user;
    const courseNo = parseCourseNo(req.params.courseNo);
    const semester = parseSemester(req.body?.semester);
    if (!courseNo) throw new HttpError(400, "invalid_course_no");
    if (!semester) throw new HttpError(400, "invalid_semester");
    const notifyEnabled = req.body?.notifyEnabled === undefined ? true : req.body.notifyEnabled === true;

    const existing = store.getWatched(uid, courseNo);
    if (!existing && store.listWatched(uid).length >= config.maxWatchedPerUser) {
      throw new HttpError(409, "watchlist_full", `You can watch up to ${config.maxWatchedPerUser} courses.`);
    }

    // Course metadata is looked up server-side — never taken from the client.
    const { course, error } = await ntust.getCourse(semester, courseNo, { maxAgeMs: WATCH_LOOKUP_MAX_AGE_MS });
    if (!course) {
      if (error) throw new HttpError(502, "upstream_unavailable", "NTUST course system is not responding.");
      throw new HttpError(404, "course_not_found", "That course doesn't exist in this semester.");
    }
    const entry = await store.putWatched(uid, course, notifyEnabled, notifyEnabled ? alertExpiry() : null);
    res.status(existing ? 200 : 201).json({ course: entry });
  });

  api.patch("/watchlist/:courseNo", requireAuth, writeLimiter, async (req, res) => {
    const courseNo = parseCourseNo(req.params.courseNo);
    if (!courseNo) throw new HttpError(400, "invalid_course_no");
    if (typeof req.body?.notifyEnabled !== "boolean") throw new HttpError(400, "invalid_body");
    // Enabling (or re-enabling to "extend") restarts the countdown.
    const entry = await store.setNotify(req.user.uid, courseNo, req.body.notifyEnabled, req.body.notifyEnabled ? alertExpiry() : null);
    if (!entry) throw new HttpError(404, "not_watched");
    res.json({ course: entry });
  });

  api.delete("/watchlist/:courseNo", requireAuth, writeLimiter, async (req, res) => {
    const courseNo = parseCourseNo(req.params.courseNo);
    if (!courseNo) throw new HttpError(400, "invalid_course_no");
    await store.removeWatched(req.user.uid, courseNo);
    res.status(204).end();
  });

  api.post("/notify/test", requireAuth, testLimiter, async (req, res) => {
    const { uid } = req.user;
    const prefs = store.getUser(uid)?.prefs;
    if (!prefs) throw new HttpError(409, "no_prefs", "Save your alert settings first.");
    const sample = {
      CourseNo: "TEST0000",
      CourseName: "Test alert — your setup works",
      CourseTeacher: "NTUST Notify",
      Restrict1: "30",
      ChooseStudent: 29,
      CreditPoint: "3",
      ClassRoomNo: "TR-101",
      Node: "M1,W3",
      Semester: "—",
    };

    /** @param {boolean} enabled @param {() => Promise<void>} send */
    const attempt = async (enabled, send) => {
      if (!enabled) return { status: "off" };
      try {
        await send();
        return { status: "sent" };
      } catch (err) {
        logger.warn(`[NOTIFY] test delivery failed for ${uid}: ${err.message}`);
        // Only expose our own stable codes, never raw transport errors.
        const code = /^[a-z_0-9]+$/.test(err.message) ? err.message : "delivery_failed";
        return { status: "failed", code };
      }
    };

    const [discord, email] = await Promise.all([
      attempt(prefs.discord, () => notifier.sendDiscord(sample, prefs)),
      attempt(prefs.email, async () => {
        const to = await store.alertEmail(uid);
        if (!to) throw new Error("no_verified_email");
        await notifier.sendEmail(sample, to);
      }),
    ]);
    res.json({ results: { discord, email } });
  });

  api.get("/notify/status", requireAuth, readLimiter, (req, res) => {
    const { uid } = req.user;
    const prefs = store.getUser(uid)?.prefs ?? normalizePrefs(undefined);
    const effective = poller ? poller.effectiveInterval(uid, prefs) : null;
    const t = Date.now();

    const courses = store.listWatched(uid).map((w) => {
      const info = w.Semester ? ntust.cacheInfo(w.Semester, w.CourseNo) : { cached: null, stats: null };
      return {
        courseNo: w.CourseNo,
        courseName: w.CourseName,
        notifyEnabled: w.notifyEnabled,
        alertsExpireAt: w.alertsExpireAt,
        state: poller?.stateFor(uid, w.CourseNo) ?? null,
        // No shared/global poll interval here: it would reveal whether other
        // (possibly privileged) users watch the same course.
        cache: info.cached
          ? {
              ageMs: t - info.cached.fetchedAt,
              enrolled: info.cached.course.ChooseStudent ?? null,
              limit: info.cached.course.Restrict1 ?? null,
            }
          : null,
        health: info.stats
          ? {
              lastSuccessAt: info.stats.lastSuccessAt,
              lastErrorAt: info.stats.lastErrorAt,
              lastError: info.stats.lastError ? String(info.stats.lastError).slice(0, 100) : null,
              consecutiveFailures: info.stats.consecutiveFailures,
              totalFetches: info.stats.totalFetches,
            }
          : null,
      };
    });

    res.json({
      pollerReady: Boolean(poller?.isSeeded()),
      channels: { email: prefs.email, discord: prefs.discord },
      intervalMs: { requested: prefs.pollInterval, effective },
      privileged: store.isPrivileged(uid),
      lastPolledAt: poller?.lastPolledAt(uid) ?? null,
      courses,
    });
  });

  app.get("/health", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ status: "ok", firestore: store ? (store.isReady() ? "ready" : "loading") : "disabled" });
  });

  app.use("/api", api);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found", code: "not_found" });
  });

  // Central error handler: stable JSON, never a stack trace.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    if (err?.type === "entity.too.large") {
      return res.status(413).json({ error: "Request too large", code: "payload_too_large" });
    }
    if (err?.type === "entity.parse.failed" || err?.type === "encoding.unsupported") {
      return res.status(400).json({ error: "Malformed JSON", code: "invalid_body" });
    }
    logger.error("[SERVER] Unhandled error:", err?.stack ?? err);
    res.status(500).json({ error: "Something went wrong on our side.", code: "internal" });
  });

  return app;
}

module.exports = { createApp, HttpError };
