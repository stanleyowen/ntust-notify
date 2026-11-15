"use strict";

const { EventEmitter } = require("node:events");
const { normalizePrefs } = require("../src/validate");
const { normalizeWatched, alertsActive } = require("../src/store");

/**
 * In-memory stand-in for createFirestoreStore with the same interface.
 *
 * @param {{ privilegedEmails?: Set<string> }} [opts]
 */
function createMemoryStore({ privilegedEmails = new Set(), now = Date.now } = {}) {
  const events = new EventEmitter();
  const users = new Map();
  const watched = new Map();
  const identities = new Map();
  let t = 1;

  const store = {
    events,
    start: async () => {},
    stop: () => {},
    whenReady: async () => {},
    isReady: () => true,
    getUser: (uid) => users.get(uid) ?? null,
    listWatched: (uid) => [...(watched.get(uid)?.values() ?? [])].sort((a, b) => a.addedAt - b.addedAt),
    getWatched: (uid, c) => watched.get(uid)?.get(c) ?? null,
    identity: (uid) => identities.get(uid) ?? null,
    alertEmail: async (uid) => {
      const id = identities.get(uid);
      return id && id.emailVerified ? id.email : null;
    },
    isPrivileged: (uid) => {
      const id = identities.get(uid);
      return Boolean(id && id.emailVerified && privilegedEmails.has(id.email));
    },
    forEachUser: (cb) => {
      for (const [uid, u] of users) cb(uid, u, watched.get(uid) ?? new Map());
    },
    upsertSession: async (c) => {
      identities.set(c.uid, { email: c.email, emailVerified: c.emailVerified });
      if (!users.has(c.uid)) users.set(c.uid, { prefs: normalizePrefs(undefined), displayName: c.name, photoURL: c.picture });
    },
    savePrefs: async (uid, prefs) => {
      users.set(uid, { ...(users.get(uid) ?? { displayName: "", photoURL: "" }), prefs: normalizePrefs(prefs) });
    },
    putWatched: async (uid, course, notifyEnabled, expireAt) => {
      if (!watched.has(uid)) watched.set(uid, new Map());
      const prev = watched.get(uid).get(course.CourseNo);
      const entry = normalizeWatched({
        ...course,
        notifyEnabled,
        alertsExpireAt: notifyEnabled ? expireAt : (prev?.alertsExpireAt ?? null),
        addedAt: prev?.addedAt ?? t++,
      });
      watched.get(uid).set(entry.CourseNo, entry);
      return entry;
    },
    setNotify: async (uid, courseNo, enabled, expireAt) => {
      const w = watched.get(uid)?.get(courseNo);
      if (!w) return null;
      const entry = enabled ? { ...w, notifyEnabled: true, alertsExpireAt: expireAt } : { ...w, notifyEnabled: false };
      watched.get(uid).set(courseNo, entry);
      return entry;
    },
    removeWatched: async (uid, courseNo) => {
      const ok = Boolean(watched.get(uid)?.delete(courseNo));
      if (ok) events.emit("unwatched", uid, courseNo);
      return ok;
    },
    expireAlerts: async () => {
      let n = 0;
      const t0 = now();
      for (const courses of watched.values()) {
        for (const w of courses.values()) {
          if (w.notifyEnabled && !alertsActive(w, t0)) {
            courses.set(w.CourseNo, { ...w, notifyEnabled: false, alertsExpireAt: w.alertsExpireAt ?? t0 });
            n++;
          }
        }
      }
      return n;
    },
    // Test-only: insert a raw (e.g. legacy) watched doc.
    _rawWatch: (uid, doc) => {
      if (!watched.has(uid)) watched.set(uid, new Map());
      const w = normalizeWatched(doc);
      watched.get(uid).set(w.CourseNo, w);
    },
    deleteUser: async (uid) => {
      users.delete(uid);
      watched.delete(uid);
      identities.delete(uid);
      events.emit("userRemoved", uid);
    },
    // Test-only helpers.
    _users: users,
    _identities: identities,
  };
  return store;
}

/**
 * Fake NTUST client whose course data tests can mutate.
 */
function createFakeNtust() {
  const courses = new Map();
  let failing = false;
  const calls = [];
  const client = {
    calls,
    set(semester, course) {
      courses.set(`${semester}::${course.CourseNo}`, { Semester: semester, ...course });
    },
    fail(v) {
      failing = v;
    },
    async search(q) {
      calls.push(["search", q]);
      const results = [...courses.values()].filter((c) => c.Semester === q.semester && c.CourseNo.includes(q.courseNo));
      return { results, fetchedAt: Date.now() };
    },
    async getCourse(semester, courseNo) {
      calls.push(["getCourse", semester, courseNo]);
      if (failing) return { course: null, fetchedAt: null, error: "boom" };
      const course = courses.get(`${semester}::${courseNo}`) ?? null;
      return { course: course ? { ...course } : null, fetchedAt: Date.now(), error: null };
    },
    async getCourses(list) {
      return Promise.all(list.map((c) => client.getCourse(c.semester, c.courseNo)));
    },
    async semesters() {
      return [{ Semester: "1151", EngSemester: "2026 Fall", CurrentSemester: true }];
    },
    cacheInfo: () => ({ cached: null, stats: null }),
    sweep: () => 0,
  };
  return client;
}

function createFakeNotifier() {
  const sent = [];
  let failDiscord = false;
  return {
    sent,
    emailEnabled: true,
    failDiscord(v) {
      failDiscord = v;
    },
    async sendDiscord(course, prefs) {
      if (failDiscord) throw new Error("discord_404");
      sent.push({ channel: "discord", courseNo: course.CourseNo, to: prefs.discordWebhook });
    },
    async sendEmail(course, to) {
      sent.push({ channel: "email", courseNo: course.CourseNo, to });
    },
  };
}

const silentLogger = { log() {}, warn() {}, error() {} };

module.exports = { createMemoryStore, createFakeNtust, createFakeNotifier, silentLogger };
