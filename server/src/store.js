"use strict";

/**
 * Firestore-backed user store with a real-time in-memory mirror.
 *
 * SECURITY MODEL
 * --------------
 * The server is the ONLY Firestore client. firestore.rules denies all browser
 * access, so every write passes through validated API routes. On top of that,
 * nothing security-relevant is read from document fields:
 *   - a user's email (alert destination + privilege check) comes from their
 *     Firebase Auth record / verified ID token, never from users/{uid}.email;
 *   - every stored field is re-normalised when read back.
 * So even if rules were misconfigured, a tampered document could not redirect
 * email or grant the fast-poll privilege.
 *
 * PERFORMANCE
 * -----------
 * onSnapshot listeners keep `users` and `watched` current, so the poll loop
 * and most API reads never touch Firestore.
 */

const { EventEmitter } = require("node:events");
const { normalizePrefs, parseCourseNo, parseSemester } = require("./validate");

const SESSION_WRITE_THROTTLE_MS = 10 * 60 * 1000;
const READY_TIMEOUT_MS = 20_000;

/**
 * @typedef {{
 *   CourseNo: string, Semester: string | null, CourseName: string, CourseTeacher: string,
 *   Restrict1: string, ChooseStudent: number | null, CreditPoint: string,
 *   ClassRoomNo: string, Node: string, Contents: string,
 *   notifyEnabled: boolean, addedAt: number | null,
 * }} WatchedCourse
 *
 * @typedef {{ prefs: ReturnType<typeof normalizePrefs>, displayName: string, photoURL: string }} UserRecord
 * @typedef {{ email: string, emailVerified: boolean }} Identity
 */

/**
 * @param {unknown} v
 * @param {number} max
 */
const str = (v, max) => (typeof v === "string" || typeof v === "number" ? String(v).slice(0, max) : "");

/**
 * Normalises a watchedCourses document. Returns null for unusable docs.
 *
 * @param {Record<string, any>} d
 * @returns {WatchedCourse | null}
 */
function normalizeWatched(d) {
  const courseNo = parseCourseNo(d?.CourseNo);
  if (!courseNo) return null;
  const enrolled = Number(d.ChooseStudent);
  const addedAt = d.addedAt && typeof d.addedAt.toMillis === "function" ? d.addedAt.toMillis() : typeof d.addedAt === "number" ? d.addedAt : null;
  return {
    CourseNo: courseNo,
    Semester: parseSemester(d.Semester),
    CourseName: str(d.CourseName, 120),
    CourseTeacher: str(d.CourseTeacher, 120),
    Restrict1: str(d.Restrict1, 10),
    ChooseStudent: Number.isFinite(enrolled) ? enrolled : null,
    CreditPoint: str(d.CreditPoint, 10),
    ClassRoomNo: str(d.ClassRoomNo, 60),
    Node: str(d.Node, 120),
    Contents: str(d.Contents, 300),
    notifyEnabled: d.notifyEnabled === true,
    addedAt,
  };
}

/**
 * @param {Record<string, any>} d
 * @returns {UserRecord}
 */
function normalizeUser(d) {
  return {
    prefs: normalizePrefs(d?.notifyPrefs),
    displayName: str(d?.displayName, 100),
    photoURL: /^https:\/\//.test(str(d?.photoURL, 500)) ? str(d.photoURL, 500) : "",
  };
}

/**
 * @param {{
 *   db: import("firebase-admin/firestore").Firestore,
 *   auth: import("firebase-admin/auth").Auth,
 *   FieldValue: typeof import("firebase-admin/firestore").FieldValue,
 *   privilegedEmails: Set<string>,
 *   now?: () => number,
 *   logger?: Pick<Console, "log" | "warn" | "error">,
 * }} deps
 */
function createFirestoreStore({ db, auth, FieldValue, privilegedEmails, now = Date.now, logger = console }) {
  const events = new EventEmitter();
  /** @type {Map<string, UserRecord>} */
  const users = new Map();
  /** @type {Map<string, Map<string, WatchedCourse>>} */
  const watched = new Map();
  /** @type {Map<string, Identity>} */
  const identities = new Map();
  /** @type {Map<string, () => void>} */
  const watchUnsubs = new Map();
  /** @type {Set<string>} uids whose watchedCourses listener has delivered */
  const watchedLoaded = new Set();
  /** @type {Map<string, number>} */
  const lastSessionWrite = new Map();
  let usersUnsub = null;
  let ready = false;
  /** @type {() => void} */
  let markReady = () => {};
  const readyPromise = new Promise((resolve) => {
    markReady = () => {
      if (!ready) {
        ready = true;
        resolve();
      }
    };
  });

  const userRef = (uid) => db.collection("users").doc(uid);
  const watchedCol = (uid) => userRef(uid).collection("watchedCourses");

  /** @param {string} uid */
  function listenWatched(uid) {
    if (watchUnsubs.has(uid)) return;
    const unsub = watchedCol(uid).onSnapshot(
      (snap) => {
        const next = new Map();
        snap.forEach((doc) => {
          const w = normalizeWatched(doc.data());
          if (w) next.set(w.CourseNo, w);
        });
        const prev = watched.get(uid);
        if (prev) {
          for (const courseNo of prev.keys()) {
            if (!next.has(courseNo)) events.emit("unwatched", uid, courseNo);
          }
        }
        watched.set(uid, next);
        watchedLoaded.add(uid);
        checkInitialLoad();
      },
      (err) => {
        logger.error(`[FIRESTORE] watchedCourses listener error (${uid}): ${err.message}`);
        watchedLoaded.add(uid); // don't block readiness forever
        checkInitialLoad();
      },
    );
    watchUnsubs.set(uid, unsub);
  }

  /** @param {string} uid */
  function dropUser(uid) {
    const courses = watched.get(uid);
    if (courses) for (const courseNo of courses.keys()) events.emit("unwatched", uid, courseNo);
    users.delete(uid);
    watched.delete(uid);
    watchedLoaded.delete(uid);
    identities.delete(uid);
    lastSessionWrite.delete(uid);
    watchUnsubs.get(uid)?.();
    watchUnsubs.delete(uid);
    events.emit("userRemoved", uid);
  }

  let usersLoaded = false;
  function checkInitialLoad() {
    if (ready || !usersLoaded) return;
    for (const uid of users.keys()) if (!watchedLoaded.has(uid)) return;
    markReady();
    logger.log(`[FIRESTORE] Mirror ready — ${users.size} user(s).`);
  }

  /**
   * Fetches verified identities from Firebase Auth in batches of 100.
   *
   * @param {string[]} uids
   */
  async function resolveIdentities(uids) {
    for (let i = 0; i < uids.length; i += 100) {
      const chunk = uids.slice(i, i + 100);
      try {
        const { users: records } = await auth.getUsers(chunk.map((uid) => ({ uid })));
        for (const r of records) {
          identities.set(r.uid, { email: (r.email ?? "").toLowerCase(), emailVerified: r.emailVerified === true });
        }
      } catch (err) {
        logger.warn(`[AUTH] identity lookup failed: ${err.message}`);
      }
    }
  }

  /**
   * Subscribes to the users collection. Resolves when every existing user's
   * data has loaded (or after a timeout, so a slow listener can't wedge boot).
   *
   * @returns {Promise<void>}
   */
  function start() {
    usersUnsub = db.collection("users").onSnapshot(
      (snap) => {
        const added = [];
        snap.docChanges().forEach((change) => {
          const uid = change.doc.id;
          if (change.type === "removed") {
            dropUser(uid);
            return;
          }
          if (!users.has(uid)) added.push(uid);
          users.set(uid, normalizeUser(change.doc.data()));
          listenWatched(uid);
        });
        const unknown = added.filter((uid) => !identities.has(uid));
        if (unknown.length) void resolveIdentities(unknown);
        usersLoaded = true;
        checkInitialLoad();
      },
      (err) => logger.error(`[FIRESTORE] users listener error: ${err.message}`),
    );
    setTimeout(() => {
      if (!ready) {
        logger.warn("[FIRESTORE] Mirror readiness timed out — continuing with partial data.");
        markReady();
      }
    }, READY_TIMEOUT_MS).unref();
    return readyPromise;
  }

  function stop() {
    usersUnsub?.();
    for (const unsub of watchUnsubs.values()) unsub();
    watchUnsubs.clear();
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** @param {string} uid */
  function getUser(uid) {
    return users.get(uid) ?? null;
  }

  /**
   * @param {string} uid
   * @returns {WatchedCourse[]}
   */
  function listWatched(uid) {
    const m = watched.get(uid);
    if (!m) return [];
    return [...m.values()].sort((a, b) => (a.addedAt ?? 0) - (b.addedAt ?? 0));
  }

  /** @param {string} uid @param {string} courseNo */
  function getWatched(uid, courseNo) {
    return watched.get(uid)?.get(courseNo) ?? null;
  }

  /** @param {string} uid */
  function identity(uid) {
    return identities.get(uid) ?? null;
  }

  /**
   * Returns the verified email for alerts, looking it up if not yet cached.
   *
   * @param {string} uid
   * @returns {Promise<string | null>}
   */
  async function alertEmail(uid) {
    if (!identities.has(uid)) await resolveIdentities([uid]);
    const id = identities.get(uid);
    return id && id.emailVerified && id.email ? id.email : null;
  }

  /** @param {string} uid */
  function isPrivileged(uid) {
    const id = identities.get(uid);
    return Boolean(id && id.emailVerified && privilegedEmails.has(id.email));
  }

  /**
   * Iterates every user with their (live) watched map. Used by the poller.
   *
   * @param {(uid: string, user: UserRecord, courses: Map<string, WatchedCourse>) => void} cb
   */
  function forEachUser(cb) {
    for (const [uid, user] of users) cb(uid, user, watched.get(uid) ?? new Map());
  }

  // ── Writes (inputs are already validated by the route layer) ─────────────

  /**
   * Records a sign-in from a verified ID token. Creates the user document if
   * needed; otherwise refreshes profile fields at most every 10 minutes.
   *
   * @param {{ uid: string, email: string, emailVerified: boolean, name: string, picture: string }} claims
   */
  async function upsertSession(claims) {
    identities.set(claims.uid, { email: claims.email.toLowerCase(), emailVerified: claims.emailVerified });
    const existing = users.get(claims.uid);
    const last = lastSessionWrite.get(claims.uid) ?? 0;
    if (existing && now() - last < SESSION_WRITE_THROTTLE_MS) return;

    const profile = {
      displayName: str(claims.name, 100),
      photoURL: /^https:\/\//.test(claims.picture) ? str(claims.picture, 500) : "",
    };
    await userRef(claims.uid).set(
      {
        uid: claims.uid,
        email: claims.email, // informational only — never trusted for decisions
        ...profile,
        lastLogin: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    lastSessionWrite.set(claims.uid, now());
    users.set(claims.uid, { prefs: existing?.prefs ?? normalizePrefs(undefined), ...profile });
    if (!watched.has(claims.uid)) watched.set(claims.uid, new Map());
    listenWatched(claims.uid);
  }

  /**
   * @param {string} uid
   * @param {ReturnType<typeof normalizePrefs>} prefs
   */
  async function savePrefs(uid, prefs) {
    await userRef(uid).set({ notifyPrefs: prefs }, { merge: true });
    const u = users.get(uid) ?? normalizeUser({});
    users.set(uid, { ...u, prefs: normalizePrefs(prefs) });
  }

  /**
   * Adds or replaces a watched course. Metadata comes from NTUST, not from
   * the client.
   *
   * @param {string} uid
   * @param {Record<string, any>} course - Projected NTUST course record.
   * @param {boolean} notifyEnabled
   * @returns {Promise<WatchedCourse>}
   */
  async function putWatched(uid, course, notifyEnabled) {
    const existing = getWatched(uid, course.CourseNo);
    const doc = {
      CourseNo: course.CourseNo,
      Semester: course.Semester,
      CourseName: str(course.CourseName, 120),
      CourseTeacher: str(course.CourseTeacher, 120),
      Restrict1: str(course.Restrict1, 10),
      ChooseStudent: Number.isFinite(Number(course.ChooseStudent)) ? Number(course.ChooseStudent) : 0,
      CreditPoint: str(course.CreditPoint, 10),
      ClassRoomNo: str(course.ClassRoomNo, 60),
      Node: str(course.Node, 120),
      Contents: str(course.Contents, 300),
      notifyEnabled,
      ...(existing ? {} : { addedAt: FieldValue.serverTimestamp() }),
    };
    await watchedCol(uid).doc(course.CourseNo).set(doc, { merge: true });
    const entry = /** @type {WatchedCourse} */ (
      normalizeWatched({ ...doc, addedAt: existing?.addedAt ?? now() })
    );
    if (!watched.has(uid)) watched.set(uid, new Map());
    /** @type {Map<string, WatchedCourse>} */ (watched.get(uid)).set(entry.CourseNo, entry);
    return entry;
  }

  /**
   * @param {string} uid
   * @param {string} courseNo
   * @param {boolean} enabled
   * @returns {Promise<WatchedCourse | null>}
   */
  async function setNotify(uid, courseNo, enabled) {
    const existing = getWatched(uid, courseNo);
    if (!existing) return null;
    await watchedCol(uid).doc(courseNo).update({ notifyEnabled: enabled });
    const entry = { ...existing, notifyEnabled: enabled };
    /** @type {Map<string, WatchedCourse>} */ (watched.get(uid)).set(courseNo, entry);
    return entry;
  }

  /**
   * @param {string} uid
   * @param {string} courseNo
   * @returns {Promise<boolean>} false if it wasn't watched.
   */
  async function removeWatched(uid, courseNo) {
    if (!getWatched(uid, courseNo)) return false;
    await watchedCol(uid).doc(courseNo).delete();
    watched.get(uid)?.delete(courseNo);
    events.emit("unwatched", uid, courseNo);
    return true;
  }

  /**
   * Permanently deletes the user's data and their Firebase Auth account.
   *
   * @param {string} uid
   */
  async function deleteUser(uid) {
    const snap = await watchedCol(uid).get();
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = db.batch();
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await userRef(uid).delete();
    dropUser(uid);
    try {
      await auth.deleteUser(uid);
    } catch (err) {
      if (err?.code !== "auth/user-not-found") throw err;
    }
  }

  return {
    events,
    start,
    stop,
    whenReady: () => readyPromise,
    isReady: () => ready,
    getUser,
    listWatched,
    getWatched,
    identity,
    alertEmail,
    isPrivileged,
    forEachUser,
    upsertSession,
    savePrefs,
    putWatched,
    setNotify,
    removeWatched,
    deleteUser,
  };
}

module.exports = { createFirestoreStore, normalizeWatched, normalizeUser };
