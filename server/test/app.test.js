"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { loadConfig } = require("../src/config");
const { createMemoryStore, createFakeNtust, createFakeNotifier, silentLogger } = require("./helpers");

const HOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABC-123";
const ORIGIN = "https://notify.example.com";
const TOKENS = {
  "token-alice-0000000000000": { uid: "alice", email: "Alice@Example.com", email_verified: true, name: "Alice" },
  "token-boss-00000000000000": { uid: "boss", email: "boss@example.com", email_verified: true, name: "Boss" },
  "token-unverified-00000000": { uid: "eve", email: "eve@example.com", email_verified: false },
  "token-revoked-00000000000": { uid: "mallory", email: "mallory@example.com", email_verified: true, revoked: true },
};

/** Boots an app on an ephemeral port and returns a tiny fetch helper. */
async function boot({ env = {} } = {}) {
  const config = loadConfig({ ALLOWED_ORIGINS: ORIGIN, AUTH_EMAILS: "boss@example.com", MAX_WATCHED_PER_USER: "2", TRUST_PROXY: "0", ...env });
  const store = createMemoryStore({ privilegedEmails: config.privilegedEmails });
  const ntust = createFakeNtust();
  const notifier = createFakeNotifier();
  ntust.set("1151", { CourseNo: "CS3003301", CourseName: "離散數學", CourseTeacher: "項", Restrict1: "80", ChooseStudent: 80, Node: "W9" });
  ntust.set("1151", { CourseNo: "CS3004301", CourseName: "OS", Restrict1: "60", ChooseStudent: 10 });
  ntust.set("1151", { CourseNo: "CS3005301", CourseName: "DB", Restrict1: "60", ChooseStudent: 10 });
  /** @type {Array<{ token: string, checkRevoked: boolean }>} */
  const verifyCalls = [];
  const app = createApp({
    config,
    ntust,
    store,
    poller: null,
    notifier,
    logger: silentLogger,
    verifyIdToken: async (t, { checkRevoked = false } = {}) => {
      verifyCalls.push({ token: t, checkRevoked });
      if (t === "token-authdown-0000000000") throw Object.assign(new Error("down"), { code: "auth/internal-error" });
      if (!TOKENS[t]) throw new Error("bad token");
      if (checkRevoked && TOKENS[t].revoked) throw Object.assign(new Error("revoked"), { code: "auth/id-token-revoked" });
      return TOKENS[t];
    },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  /**
   * @param {string} path
   * @param {{ method?: string, token?: string, body?: any, raw?: string, origin?: string }} [o]
   */
  const call = async (path, o = {}) => {
    const headers = { Origin: o.origin ?? ORIGIN };
    if (o.token) headers.Authorization = `Bearer ${o.token}`;
    if (o.body !== undefined || o.raw !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(base + path, {
      method: o.method ?? "GET",
      headers,
      body: o.raw ?? (o.body !== undefined ? JSON.stringify(o.body) : undefined),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, headers: res.headers, json, text };
  };
  return { call, store, ntust, notifier, verifyCalls, close: () => new Promise((r) => server.close(r)) };
}

const ALICE = "token-alice-0000000000000";
const BOSS = "token-boss-00000000000000";

test("health + security headers", async (t) => {
  const { call, close } = await boot();
  t.after(close);
  const r = await call("/health");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-powered-by"), null);
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  const csp = r.headers.get("content-security-policy");
  assert.match(csp, /default-src 'none'/);
  // helmet's HTML defaults must not be merged into the API policy.
  assert.doesNotMatch(csp, /unsafe-inline|script-src|style-src/);
});

test("CORS: allowed origin reflected, unknown origin gets no CORS headers (not a 500)", async (t) => {
  const { call, close } = await boot();
  t.after(close);
  const ok = await call("/api/semesters");
  assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
  const bad = await call("/api/semesters", { origin: "https://evil.example" });
  assert.equal(bad.status, 200);
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});

test("auth: missing, malformed, invalid and unverified tokens are rejected", async (t) => {
  const { call, close } = await boot();
  t.after(close);
  assert.equal((await call("/api/me")).status, 401);
  assert.equal((await call("/api/me", { token: "x" })).status, 401);
  assert.equal((await call("/api/me", { token: "token-nope-0000000000000000" })).json.code, "invalid_token");
  assert.equal((await call("/api/me", { token: "token-unverified-00000000" })).status, 403);
});

test("errors are JSON and never leak stack traces", async (t) => {
  const { call, close } = await boot();
  t.after(close);
  const bad = await call("/api/courses", { method: "POST", token: ALICE, raw: "{not json" });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, "invalid_body");
  assert.doesNotMatch(bad.text, /at .*\.js/);
  const big = await call("/api/courses", { method: "POST", token: ALICE, body: { courseName: "x".repeat(20_000) } });
  assert.equal(big.status, 413);
  const nf = await call("/api/nope");
  assert.equal(nf.status, 404);
  assert.equal(nf.json.code, "not_found");
});

test("search validates input and returns results", async (t) => {
  const { call, close } = await boot();
  t.after(close);
  assert.equal((await call("/api/courses", { method: "POST", token: ALICE, body: { semester: "1151" } })).json.code, "empty_query");
  const r = await call("/api/courses", { method: "POST", token: ALICE, body: { semester: "1151", courseNo: "cs3" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.results.length, 3);
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("session + me bootstrap payload", async (t) => {
  const { call, close } = await boot();
  t.after(close);
  const s = await call("/api/session", { method: "POST", token: ALICE });
  assert.equal(s.status, 200);
  assert.equal(s.json.user.email, "alice@example.com");
  assert.deepEqual(s.json.watchlist, []);
  assert.equal(s.json.limits.privileged, false);
  assert.ok(!s.json.limits.pollOptions.includes(1000));
  const boss = await call("/api/session", { method: "POST", token: BOSS });
  assert.equal(boss.json.limits.privileged, true);
  assert.ok(boss.json.limits.pollOptions.includes(1000));
});

test("watch uses server-side NTUST metadata, ignores client-supplied fields", async (t) => {
  const { call, close } = await boot();
  t.after(close);
  await call("/api/session", { method: "POST", token: ALICE });
  const r = await call("/api/watchlist/cs3003301", {
    method: "PUT",
    token: ALICE,
    body: { semester: "1151", CourseName: "<img src=x onerror=alert(1)>", Restrict1: "1" },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.course.CourseName, "離散數學");
  assert.equal(r.json.course.Restrict1, "80");
  assert.equal(r.json.course.notifyEnabled, true);

  const missing = await call("/api/watchlist/CS9999999", { method: "PUT", token: ALICE, body: { semester: "1151" } });
  assert.equal(missing.status, 404);
  const badSem = await call("/api/watchlist/CS3003301", { method: "PUT", token: ALICE, body: { semester: "../x" } });
  assert.equal(badSem.json.code, "invalid_semester");
});

test("watchlist size is capped per user", async (t) => {
  const { call, close } = await boot();
  t.after(close);
  await call("/api/session", { method: "POST", token: ALICE });
  for (const c of ["CS3003301", "CS3004301"]) {
    assert.equal((await call(`/api/watchlist/${c}`, { method: "PUT", token: ALICE, body: { semester: "1151" } })).status, 201);
  }
  const third = await call("/api/watchlist/CS3005301", { method: "PUT", token: ALICE, body: { semester: "1151" } });
  assert.equal(third.status, 409);
  assert.equal(third.json.code, "watchlist_full");
  // Re-watching an existing course is still allowed.
  assert.equal((await call("/api/watchlist/CS3003301", { method: "PUT", token: ALICE, body: { semester: "1151" } })).status, 200);
});

test("toggle + remove + users are isolated from each other", async (t) => {
  const { call, close } = await boot();
  t.after(close);
  await call("/api/session", { method: "POST", token: ALICE });
  await call("/api/session", { method: "POST", token: BOSS });
  await call("/api/watchlist/CS3003301", { method: "PUT", token: ALICE, body: { semester: "1151" } });

  // Boss can't see or modify Alice's entries.
  assert.equal((await call("/api/me", { token: BOSS })).json.watchlist.length, 0);
  assert.equal((await call("/api/watchlist/CS3003301", { method: "PATCH", token: BOSS, body: { notifyEnabled: false } })).status, 404);

  const off = await call("/api/watchlist/CS3003301", { method: "PATCH", token: ALICE, body: { notifyEnabled: false } });
  assert.equal(off.json.course.notifyEnabled, false);
  assert.equal((await call("/api/watchlist/CS3003301", { method: "PATCH", token: ALICE, body: { notifyEnabled: "no" } })).status, 400);
  assert.equal((await call("/api/watchlist/CS3003301", { method: "DELETE", token: ALICE })).status, 204);
  assert.equal((await call("/api/me", { token: ALICE })).json.watchlist.length, 0);
});

test("prefs: validation and privileged intervals", async (t) => {
  const { call, close } = await boot();
  t.after(close);
  await call("/api/session", { method: "POST", token: ALICE });
  await call("/api/session", { method: "POST", token: BOSS });
  const fast = await call("/api/me/prefs", { method: "PUT", token: ALICE, body: { email: true, pollInterval: 1000 } });
  assert.equal(fast.json.code, "invalid_interval");
  const ssrf = await call("/api/me/prefs", {
    method: "PUT",
    token: ALICE,
    body: { discord: true, discordWebhook: "http://169.254.169.254/latest/meta-data", pollInterval: 60000 },
  });
  assert.equal(ssrf.json.code, "invalid_webhook");
  const ok = await call("/api/me/prefs", { method: "PUT", token: ALICE, body: { email: true, discord: true, discordWebhook: HOOK, pollInterval: 60000 } });
  assert.equal(ok.status, 200);
  assert.equal((await call("/api/me/prefs", { method: "PUT", token: BOSS, body: { email: true, pollInterval: 1000 } })).status, 200);
});

test("test notification reports real per-channel outcomes and is rate limited", async (t) => {
  const { call, notifier, close } = await boot();
  t.after(close);
  await call("/api/session", { method: "POST", token: ALICE });
  await call("/api/me/prefs", { method: "PUT", token: ALICE, body: { email: true, discord: true, discordWebhook: HOOK, pollInterval: 60000 } });
  notifier.failDiscord(true);
  const r = await call("/api/notify/test", { method: "POST", token: ALICE });
  assert.deepEqual(r.json.results.email, { status: "sent" });
  assert.deepEqual(r.json.results.discord, { status: "failed", code: "discord_404" });
  // Email went to the verified token address, lower-cased.
  assert.equal(notifier.sent[0].to, "alice@example.com");
  for (let i = 0; i < 4; i++) await call("/api/notify/test", { method: "POST", token: ALICE });
  assert.equal((await call("/api/notify/test", { method: "POST", token: ALICE })).status, 429);
});

test("delete account wipes the user's data", async (t) => {
  const { call, store, close } = await boot();
  t.after(close);
  await call("/api/session", { method: "POST", token: ALICE });
  await call("/api/watchlist/CS3003301", { method: "PUT", token: ALICE, body: { semester: "1151" } });
  assert.equal((await call("/api/me", { method: "DELETE", token: ALICE })).status, 204);
  assert.equal(store.getUser("alice"), null);
  assert.equal(store.listWatched("alice").length, 0);
  // The still-valid ID token can't use the API or re-create the account.
  assert.equal((await call("/api/session", { method: "POST", token: ALICE })).json.code, "invalid_token");
  assert.equal((await call("/api/me", { token: ALICE })).status, 401);
  assert.equal(store.getUser("alice"), null);
});

test("sign-in and account deletion check token revocation; other routes don't", async (t) => {
  const { call, verifyCalls, close } = await boot();
  t.after(close);
  await call("/api/session", { method: "POST", token: ALICE });
  await call("/api/me", { token: ALICE });
  assert.deepEqual(
    verifyCalls.map((c) => c.checkRevoked),
    [true, false],
  );
  const REVOKED = "token-revoked-00000000000";
  const r = await call("/api/session", { method: "POST", token: REVOKED });
  assert.equal(r.status, 401);
  assert.equal(r.json.code, "invalid_token");
  assert.equal((await call("/api/me", { method: "DELETE", token: REVOKED })).status, 401);
});

test("Firebase Auth outage is a 503, not a forced sign-out", async (t) => {
  const { call, close } = await boot();
  t.after(close);
  const r = await call("/api/me", { token: "token-authdown-0000000000" });
  assert.equal(r.status, 503);
  assert.equal(r.json.code, "auth_unavailable");
});

test("notify status doesn't reveal other users' polling of the same course", async (t) => {
  const { call, close } = await boot();
  t.after(close);
  await call("/api/session", { method: "POST", token: ALICE });
  await call("/api/watchlist/CS3003301", { method: "PUT", token: ALICE, body: { semester: "1151" } });
  const r = await call("/api/notify/status", { token: ALICE });
  assert.equal(r.status, 200);
  assert.equal(r.json.courses.length, 1);
  assert.equal("sharedIntervalMs" in r.json.courses[0], false);
});

test("config: listens on loopback unless HOST is set", () => {
  assert.equal(loadConfig({}).host, "127.0.0.1");
  assert.equal(loadConfig({ HOST: " 0.0.0.0 " }).host, "0.0.0.0");
});

test("alerts get a 30-day expiry; re-enabling renews it", async (t) => {
  const { call, close } = await boot();
  t.after(close);
  await call("/api/session", { method: "POST", token: ALICE });
  const DAY = 24 * 60 * 60 * 1000;
  const r = await call("/api/watchlist/CS3003301", { method: "PUT", token: ALICE, body: { semester: "1151" } });
  assert.ok(Math.abs(r.json.course.alertsExpireAt - (Date.now() + 30 * DAY)) < 5000);
  const off = await call("/api/watchlist/CS3003301", { method: "PATCH", token: ALICE, body: { notifyEnabled: false } });
  assert.equal(off.json.course.notifyEnabled, false);
  const on = await call("/api/watchlist/CS3003301", { method: "PATCH", token: ALICE, body: { notifyEnabled: true } });
  assert.ok(on.json.course.alertsExpireAt >= r.json.course.alertsExpireAt);
  assert.equal((await call("/api/me", { token: ALICE })).json.limits.alertDurationDays, 30);
});
