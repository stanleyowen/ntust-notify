"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const v = require("../src/validate");

const HOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABC-123";

test("discord webhook: accepts real webhooks", () => {
  assert.ok(v.isValidDiscordWebhook(HOOK));
  assert.ok(v.isValidDiscordWebhook(HOOK.replace("discord.com", "discordapp.com")));
  assert.ok(v.isValidDiscordWebhook(`${HOOK}?thread_id=123456789012345678`));
});

test("discord webhook: rejects SSRF and lookalike targets", () => {
  for (const bad of [
    "http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
    "https://discord.com.evil.io/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
    "https://evil.io/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
    "https://discord.com@169.254.169.254/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
    "https://user:pw@discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
    "https://discord.com:8443/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
    "https://discord.com/api/webhooks/../../users/@me",
    "https://discord.com/api/v9/users/@me",
    `${HOOK}?wait=true&redirect=http://x`,
    "",
    null,
    42,
    "x".repeat(400),
  ]) {
    assert.equal(v.isValidDiscordWebhook(bad), false, String(bad));
  }
});

test("parseCourseNo normalises and validates", () => {
  assert.equal(v.parseCourseNo(" cs3003301 "), "CS3003301");
  assert.equal(v.parseCourseNo("CS30/../x"), null);
  assert.equal(v.parseCourseNo("../../etc"), null);
  assert.equal(v.parseCourseNo({}), null);
});

test("parseSearch requires a semester and a meaningful query", () => {
  assert.equal(v.parseSearch({}).error, "invalid_semester");
  assert.equal(v.parseSearch({ semester: "1151" }).error, "empty_query");
  assert.equal(v.parseSearch({ semester: "1151", courseNo: "C" }).error, "empty_query");
  assert.equal(v.parseSearch({ semester: "1151", courseNo: "CS'--" }).error, "invalid_course_no");
  assert.deepEqual(v.parseSearch({ semester: "1151", courseNo: "cs 3" }).value, {
    semester: "1151",
    courseNo: "CS3",
    courseName: "",
    teacher: "",
  });
  // Legacy capitalised keys still work.
  assert.equal(v.parseSearch({ Semester: "114H", CourseName: "Java" }).value.courseName, "Java");
  // Non-string fields are dropped, not forwarded.
  assert.equal(v.parseSearch({ semester: "1151", courseName: { $ne: 1 } }).error, "empty_query");
});

test("parsePrefs enforces per-user interval options", () => {
  assert.equal(v.parsePrefs({ pollInterval: 1000 }, false).error, "invalid_interval");
  assert.equal(v.parsePrefs({ pollInterval: 1000 }, true).value.pollInterval, 1000);
  assert.equal(v.parsePrefs({ pollInterval: "60000" }, false).error, "invalid_interval");
});

test("parsePrefs validates discord fields", () => {
  assert.equal(v.parsePrefs({ discord: true }, false).error, "webhook_required");
  assert.equal(v.parsePrefs({ discord: true, discordWebhook: "https://evil.io/x" }, false).error, "invalid_webhook");
  assert.equal(
    v.parsePrefs({ discord: true, discordWebhook: HOOK, discordTagMe: true }, false).error,
    "discord_user_id_required",
  );
  assert.equal(v.parsePrefs({ discordUserId: "@everyone" }, false).error, "invalid_discord_user_id");
  assert.equal(v.parsePrefs({ email: "yes" }, false).error, "invalid_body");
  const ok = v.parsePrefs({ email: true, discord: true, discordWebhook: HOOK, pollInterval: 30000 }, false);
  assert.equal(ok.error, undefined);
  assert.equal(ok.value.email, true);
});

test("normalizePrefs drops tampered stored values", () => {
  const p = v.normalizePrefs({
    email: "true",
    discord: true,
    discordWebhook: "http://169.254.169.254/",
    discordUserId: "@everyone",
    pollInterval: -5,
  });
  assert.equal(p.email, false);
  assert.equal(p.discordWebhook, "");
  assert.equal(p.discordUserId, "");
  assert.equal(p.pollInterval, 1000); // clamped; the poller then applies the per-user floor
  assert.equal(v.normalizePrefs({ pollInterval: "NaN" }).pollInterval, 60000);
});
