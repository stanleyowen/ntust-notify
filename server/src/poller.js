"use strict";

/**
 * Background poller: detects FULL → OPEN transitions on watched courses and
 * alerts subscribers exactly once per open window.
 *
 * - Reads only the in-memory store mirror (no Firestore reads per cycle).
 * - Fetches each distinct (semester, course) once per cycle, at the fastest
 *   interval any subscriber is entitled to, with bounded concurrency.
 * - Never changes alert state based on stale data from a failed fetch.
 * - The first cycle after startup seeds state silently so a restart doesn't
 *   re-alert for courses that were already open.
 */

const { NORMAL_MIN_INTERVAL_MS, PRIVILEGED_MIN_INTERVAL_MS } = require("./config");
const { sanitizeInterval } = require("./validate");
const { isFull, runPool } = require("./ntust");
const { alertsActive } = require("./store");

const TICK_MS = 1_000;
const EXPIRY_SWEEP_MS = 10 * 60 * 1000;

/**
 * @param {{
 *   store: ReturnType<typeof import("./store").createFirestoreStore>,
 *   ntust: ReturnType<typeof import("./ntust").createNtustClient>,
 *   notifier: ReturnType<typeof import("./notifier").createNotifier>,
 *   concurrency: number,
 *   now?: () => number,
 *   logger?: Pick<Console, "log" | "warn" | "error">,
 * }} deps
 */
function createPoller({ store, ntust, notifier, concurrency, now = Date.now, logger = console }) {
  /** @type {Map<string, { wasFull: boolean, notifiedOpen: boolean }>} key: uid::courseNo */
  const state = new Map();
  /** @type {Map<string, number>} */
  const lastPolled = new Map();
  let seeded = false;
  let running = false;
  let stopped = false;
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  /** @type {NodeJS.Timeout | null} */
  let expiryTimer = null;

  async function sweepExpired() {
    try {
      const n = await store.expireAlerts();
      if (n > 0) logger.log(`[NOTIFY] Switched off ${n} expired alert(s).`);
    } catch (err) {
      logger.error(`[NOTIFY] expiry sweep failed: ${err.message}`);
    }
  }

  store.events.on("unwatched", (uid, courseNo) => state.delete(`${uid}::${courseNo}`));
  store.events.on("userRemoved", (uid) => lastPolled.delete(uid));

  /**
   * The interval at which a user's courses are checked.
   *
   * @param {string} uid
   * @param {{ pollInterval: number }} prefs
   */
  function effectiveInterval(uid, prefs) {
    const floor = store.isPrivileged(uid) ? PRIVILEGED_MIN_INTERVAL_MS : NORMAL_MIN_INTERVAL_MS;
    return Math.max(sanitizeInterval(prefs.pollInterval), floor);
  }

  /**
   * Fastest interval among active subscribers of a course (what NTUST actually
   * sees), or null if nobody has alerts on for it.
   *
   * @param {string} semester
   * @param {string} courseNo
   */
  function sharedInterval(semester, courseNo) {
    let min = Infinity;
    store.forEachUser((uid, user, courses) => {
      if (!user.prefs.email && !user.prefs.discord) return;
      const w = courses.get(courseNo);
      if (!w || !alertsActive(w, now()) || w.Semester !== semester) return;
      min = Math.min(min, effectiveInterval(uid, user.prefs));
    });
    return min === Infinity ? null : min;
  }

  /**
   * @param {string} uid
   * @param {Record<string, any>} course
   * @param {ReturnType<typeof import("./validate").normalizePrefs>} prefs
   */
  async function deliver(uid, course, prefs) {
    const jobs = [];
    if (prefs.discord) jobs.push(notifier.sendDiscord(course, prefs));
    if (prefs.email) {
      jobs.push(
        store.alertEmail(uid).then((to) => {
          if (!to) throw new Error("no_verified_email");
          return notifier.sendEmail(course, to);
        }),
      );
    }
    const results = await Promise.allSettled(jobs);
    for (const r of results) {
      if (r.status === "rejected") {
        logger.warn(`[NOTIFY] delivery to ${uid} failed for ${course.CourseNo}: ${r.reason?.message ?? r.reason}`);
      }
    }
  }

  /**
   * @param {{ semester: string, courseNo: string, maxAgeMs: number, subscribers: Array<{ uid: string, prefs: any }> }} entry
   */
  async function processCourse(entry) {
    const { course, error } = await ntust.getCourse(entry.semester, entry.courseNo, { maxAgeMs: entry.maxAgeMs });
    // Stale or missing data must not flip alert state.
    if (error || !course) return;

    const nowFull = isFull(course);
    await Promise.all(
      entry.subscribers.map(async ({ uid, prefs }) => {
        const key = `${uid}::${entry.courseNo}`;
        const prev = state.get(key);

        if (!seeded) {
          state.set(key, { wasFull: nowFull, notifiedOpen: !nowFull });
          return;
        }
        if (nowFull) {
          state.set(key, { wasFull: true, notifiedOpen: false });
        } else if (prev?.wasFull && !prev.notifiedOpen) {
          // Mark first so an overlapping cycle can never double-send.
          state.set(key, { wasFull: false, notifiedOpen: true });
          logger.log(`[NOTIFY] ${entry.courseNo} opened — alerting ${uid}`);
          await deliver(uid, course, prefs);
        } else {
          state.set(key, { wasFull: false, notifiedOpen: prev?.notifiedOpen ?? false });
        }
      }),
    );
  }

  /** Runs one poll cycle. Exposed for tests. */
  async function cycle() {
    if (running) return;
    running = true;
    try {
      /** @type {Map<string, { semester: string, courseNo: string, maxAgeMs: number, subscribers: Array<{ uid: string, prefs: any }> }>} */
      const work = new Map();
      const t = now();

      store.forEachUser((uid, user, courses) => {
        const { prefs } = user;
        if (!prefs.email && !prefs.discord) return;
        const interval = effectiveInterval(uid, prefs);
        if (seeded && t - (lastPolled.get(uid) ?? 0) < interval) return;

        let any = false;
        for (const w of courses.values()) {
          if (!alertsActive(w, t) || !w.Semester) continue;
          any = true;
          const key = `${w.Semester}::${w.CourseNo}`;
          let entry = work.get(key);
          if (!entry) {
            entry = { semester: w.Semester, courseNo: w.CourseNo, maxAgeMs: interval, subscribers: [] };
            work.set(key, entry);
          }
          entry.maxAgeMs = Math.min(entry.maxAgeMs, interval);
          entry.subscribers.push({ uid, prefs });
        }
        if (any) lastPolled.set(uid, t);
      });

      if (work.size > 0) {
        await runPool([...work.values()], concurrency, (e) =>
          processCourse(e).catch((err) => logger.error(`[NOTIFY] ${e.courseNo}: ${err.message}`)),
        );
      }
      if (!seeded) {
        seeded = true;
        logger.log(`[NOTIFY] Initial state seeded for ${state.size} subscription(s).`);
      }
    } catch (err) {
      logger.error(`[NOTIFY] poll cycle error: ${err.message}`);
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => {
      await cycle();
      schedule();
    }, TICK_MS);
  }

  return {
    async start() {
      await store.whenReady();
      if (stopped) return;
      await sweepExpired();
      expiryTimer = setInterval(sweepExpired, EXPIRY_SWEEP_MS);
      expiryTimer.unref();
      await cycle();
      schedule();
      logger.log("[NOTIFY] Poller running.");
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (expiryTimer) clearInterval(expiryTimer);
    },
    cycle,
    sweepExpired,
    isSeeded: () => seeded,
    effectiveInterval,
    sharedInterval,
    stateFor: (uid, courseNo) => state.get(`${uid}::${courseNo}`) ?? null,
    lastPolledAt: (uid) => lastPolled.get(uid) ?? null,
  };
}

module.exports = { createPoller };
