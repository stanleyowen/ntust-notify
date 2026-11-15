"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPoller } = require("../src/poller");
const { createMemoryStore, createFakeNtust, createFakeNotifier, silentLogger } = require("./helpers");

const HOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_ABC-123";

async function setup() {
  let t = 1_000_000;
  const store = createMemoryStore();
  const ntust = createFakeNtust();
  const notifier = createFakeNotifier();
  const poller = createPoller({ store, ntust, notifier, concurrency: 4, now: () => t, logger: silentLogger });
  await store.upsertSession({ uid: "u1", email: "alice@example.com", emailVerified: true, name: "", picture: "" });
  await store.savePrefs("u1", { email: true, discord: true, discordWebhook: HOOK, pollInterval: 30_000 });
  ntust.set("1151", { CourseNo: "CS3003301", CourseName: "DM", Restrict1: "80", ChooseStudent: 80 });
  await store.putWatched("u1", { Semester: "1151", CourseNo: "CS3003301", CourseName: "DM" }, true);
  return { store, ntust, notifier, poller, advance: (ms) => (t += ms) };
}

test("first cycle seeds silently, then FULL→OPEN alerts exactly once", async () => {
  const { ntust, notifier, poller, advance } = await setup();
  await poller.cycle();
  assert.equal(notifier.sent.length, 0);
  assert.equal(poller.isSeeded(), true);

  ntust.set("1151", { CourseNo: "CS3003301", CourseName: "DM", Restrict1: "80", ChooseStudent: 79 });
  advance(30_000);
  await poller.cycle();
  assert.deepEqual(
    notifier.sent.map((s) => s.channel).sort(),
    ["discord", "email"],
  );
  assert.equal(notifier.sent.find((s) => s.channel === "email").to, "alice@example.com");

  advance(30_000);
  await poller.cycle();
  assert.equal(notifier.sent.length, 2, "no duplicate alert while still open");

  // Full again, then open again → a fresh alert.
  ntust.set("1151", { CourseNo: "CS3003301", CourseName: "DM", Restrict1: "80", ChooseStudent: 80 });
  advance(30_000);
  await poller.cycle();
  ntust.set("1151", { CourseNo: "CS3003301", CourseName: "DM", Restrict1: "80", ChooseStudent: 70 });
  advance(30_000);
  await poller.cycle();
  assert.equal(notifier.sent.length, 4);
});

test("per-user interval is enforced", async () => {
  const { ntust, poller, advance } = await setup();
  await poller.cycle();
  const before = ntust.calls.length;
  advance(10_000);
  await poller.cycle();
  assert.equal(ntust.calls.length, before, "not re-polled before 30 s");
  advance(25_000);
  await poller.cycle();
  assert.equal(ntust.calls.length, before + 1);
});

test("a failed fetch never flips state or alerts", async () => {
  const { ntust, notifier, poller, advance } = await setup();
  await poller.cycle();
  ntust.fail(true);
  advance(30_000);
  await poller.cycle();
  assert.equal(notifier.sent.length, 0);
  assert.deepEqual(poller.stateFor("u1", "CS3003301"), { wasFull: true, notifiedOpen: false });
});

test("email goes to the verified auth identity, never a document field", async () => {
  const { store, ntust, notifier, poller, advance } = await setup();
  await poller.cycle();
  // Simulate an unverified identity: email must not be sent.
  store._identities.set("u1", { email: "victim@example.com", emailVerified: false });
  ntust.set("1151", { CourseNo: "CS3003301", CourseName: "DM", Restrict1: "80", ChooseStudent: 1 });
  advance(30_000);
  await poller.cycle();
  assert.equal(notifier.sent.filter((s) => s.channel === "email").length, 0);
  assert.equal(notifier.sent.filter((s) => s.channel === "discord").length, 1);
});

test("unwatching clears per-course alert state", async () => {
  const { store, poller } = await setup();
  await poller.cycle();
  assert.ok(poller.stateFor("u1", "CS3003301"));
  await store.removeWatched("u1", "CS3003301");
  assert.equal(poller.stateFor("u1", "CS3003301"), null);
});
