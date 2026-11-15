"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createNtustClient, isFull } = require("../src/ntust");
const { silentLogger } = require("./helpers");

const RAW = {
  Semester: "1151",
  CourseNo: "CS3003301",
  CourseName: "離散數學",
  CourseTeacher: "項天瑞",
  CreditPoint: "3",
  ChooseStudent: 63,
  Restrict1: "80",
  ClassRoomNo: "TR-309",
  Node: "W9,R3,R4",
  Contents: "限80人",
  NTU_People: 0,
  Secret: { nested: true },
};

/** Fake fetch that counts calls and can be told to fail. */
function fakeFetch(body = [RAW]) {
  const f = async (url, init) => {
    f.calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
    await new Promise((r) => setTimeout(r, 5));
    if (f.fail) throw new Error("ECONNRESET");
    return { ok: true, status: 200, json: async () => body };
  };
  f.calls = [];
  f.fail = false;
  return f;
}

test("search projects fields and drops unknown ones", async () => {
  const fetchImpl = fakeFetch();
  const c = createNtustClient({ fetchImpl, logger: silentLogger });
  const { results } = await c.search({ semester: "1151", courseNo: "CS3", courseName: "", teacher: "" });
  assert.equal(results.length, 1);
  assert.equal(results[0].CourseName, "離散數學");
  assert.equal(results[0].Secret, undefined);
  assert.equal(results[0].NTU_People, undefined);
});

test("concurrent identical searches share one upstream request and are cached", async () => {
  const fetchImpl = fakeFetch();
  const c = createNtustClient({ fetchImpl, logger: silentLogger });
  const q = { semester: "1151", courseNo: "CS3", courseName: "", teacher: "" };
  await Promise.all([c.search(q), c.search(q), c.search(q)]);
  await c.search(q);
  assert.equal(fetchImpl.calls.length, 1);
});

test("search warms the per-course cache used by watch + poller", async () => {
  const fetchImpl = fakeFetch();
  const c = createNtustClient({ fetchImpl, logger: silentLogger });
  await c.search({ semester: "1151", courseNo: "CS3", courseName: "", teacher: "" });
  const r = await c.getCourse("1151", "CS3003301", { maxAgeMs: 60_000 });
  assert.equal(r.course.CourseNo, "CS3003301");
  assert.equal(fetchImpl.calls.length, 1);
});

test("getCourse returns stale data with error on failure", async () => {
  let t = 0;
  const fetchImpl = fakeFetch();
  const c = createNtustClient({ fetchImpl, now: () => t, logger: silentLogger });
  await c.getCourse("1151", "CS3003301", { maxAgeMs: 1000 });
  t = 5000;
  fetchImpl.fail = true;
  const r = await c.getCourse("1151", "CS3003301", { maxAgeMs: 1000 });
  assert.equal(r.error, "ECONNRESET");
  assert.equal(r.course.CourseNo, "CS3003301");
  assert.equal(c.cacheInfo("1151", "CS3003301").stats.consecutiveFailures, 1);
});

test("isFull", () => {
  assert.equal(isFull({ Restrict1: "80", ChooseStudent: 80 }), true);
  assert.equal(isFull({ Restrict1: "80", ChooseStudent: 79 }), false);
  assert.equal(isFull({ Restrict1: "", ChooseStudent: 999 }), false);
  assert.equal(isFull({ Restrict1: "0", ChooseStudent: 1 }), false);
  assert.equal(isFull({ Restrict1: "9999", ChooseStudent: 9999 }), false, "9999 = no cap");
});

test("rows for the same course (one per time/room block) are merged", async () => {
  const fetchImpl = fakeFetch([
    { ...RAW, CourseNo: "CS3004301", Node: "M1,M2", ClassRoomNo: "TR-410" },
    { ...RAW, CourseNo: "CS3004301", Node: "W3", ClassRoomNo: "TR-212" },
    { ...RAW, CourseNo: "CS3005301", Node: "F1", ClassRoomNo: "TR-101" },
  ]);
  const c = createNtustClient({ fetchImpl, logger: silentLogger });
  const { results } = await c.search({ semester: "1151", courseNo: "CS300", courseName: "", teacher: "" });
  assert.equal(results.length, 2);
  assert.equal(results[0].Node, "M1,M2,W3");
  assert.equal(results[0].ClassRoomNo, "TR-410, TR-212");
  const one = await c.getCourse("1151", "CS3004301", { maxAgeMs: 60_000 });
  assert.equal(one.course.Node, "M1,M2,W3");
});
