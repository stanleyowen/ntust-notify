const express = require("express");
const axios = require("axios");

const router = express.Router();

const NTUST_API = "https://querycourse.ntust.edu.tw/QueryCourse/api/courses";
const DEMO_SEMESTER = process.env.DEMO_SEMESTER || "1142";

// ─── In-memory course repository (ported from fake-backend-example.py) ───────

const NULLABLE_STR_FIELDS = [
  "CourseTeacher", "Dimension", "CreditPoint", "RequireOption", "AllYear",
  "Restrict1", "Restrict2", "NTURestrict", "NTNURestrict", "CourseTimes",
  "PracticalTimes", "ClassRoomNo", "Node", "Contents",
];

const NULLABLE_INT_FIELDS = [
  "ChooseStudent", "ThreeStudent", "AllStudent",
  "NTU_People", "NTNU_People", "AbroadPeople",
];

let courses = [];
let initialized = false;
let updateCursor = 0;
let simInterval = null;

function sanitize(course) {
  for (const field of NULLABLE_STR_FIELDS) {
    if (course[field] == null) course[field] = "";
  }
  for (const field of NULLABLE_INT_FIELDS) {
    if (course[field] == null) course[field] = 0;
  }
  return course;
}

function simulateBatchUpdate() {
  if (!initialized || courses.length === 0) return;

  for (const course of courses) {
    const restrict2Str = course.Restrict2 || "0";
    const capacity = /^\d+$/.test(restrict2Str) ? parseInt(restrict2Str, 10) : 0;
    if (capacity <= 0) continue;

    const currentChoose = course.ChooseStudent || 0;
    const threeStudent = course.ThreeStudent || 0;
    const rand = Math.random();

    let newChoose;
    if (rand < 0.5) {
      newChoose = Math.max(0, capacity - threeStudent);
    } else if (rand < 0.9) {
      newChoose = Math.max(0, currentChoose - 1);
    } else {
      newChoose = Math.max(0, currentChoose - 2);
    }

    course.ChooseStudent = newChoose;
    course.AllStudent = newChoose + threeStudent;
  }
}

async function loadCourseData(semester) {
  const payload = {
    Semester: semester,
    CourseNo: "",
    CourseName: "",
    CourseTeacher: " ",
    Dimension: "",
    CourseNotes: "",
    CampusNotes: "",
    ForeignLanguage: 0,
    OnlyIntensive: 0,
    OnlyGeneral: 0,
    OnleyNTUST: 0,
    OnlyMaster: 0,
    OnlyUnderGraduate: 0,
    OnlyNode: 0,
    Language: "zh",
  };

  const response = await axios.post(NTUST_API, payload, {
    headers: { "Content-Type": "application/json" },
    timeout: 30000,
  });

  courses = response.data.map(sanitize);
  initialized = true;
  updateCursor = 0;
  console.log(`[DEMO] Loaded ${courses.length} courses for semester ${semester}`);
}

/**
 * Search the in-memory course repository.
 * Exported so the notification poller can use it for demo-flagged watched courses.
 */
function searchCourses(criteria) {
  if (!initialized) return null;

  const qSemester = criteria.Semester || "";
  const qNo = (criteria.CourseNo || "").toUpperCase();
  const qName = (criteria.CourseName || "").trim();
  const qTeacher = criteria.CourseTeacher || "";
  const qDim = criteria.Dimension || "";

  return courses.filter((c) => {
    if (qSemester && c.Semester !== qSemester) return false;
    if (qNo && !(c.CourseNo || "").toUpperCase().includes(qNo)) return false;
    if (qName && !(c.CourseName || "").includes(qName)) return false;
    if (qTeacher && !(c.CourseTeacher || "").includes(qTeacher)) return false;
    if (qDim && c.Dimension !== qDim) return false;
    return true;
  });
}

function isInitialized() {
  return initialized;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.use(express.json({ limit: "16kb" }));

router.get("/health", (_req, res) => {
  res.json({
    status: initialized ? "ok" : "loading",
    coursesCount: courses.length,
    updateCursor,
  });
});

router.post("/courses", (req, res) => {
  if (!initialized) {
    return res.status(503).json({ error: "Demo data is still loading. Please retry shortly." });
  }
  res.json(searchCourses(req.body));
});

// ─── Lifecycle ───────────────────────────────────────────────────────────────

async function initDemo() {
  try {
    await loadCourseData(DEMO_SEMESTER);
    simInterval = setInterval(simulateBatchUpdate, 10_000);
    console.log("[DEMO] Simulation worker started.");
  } catch (err) {
    console.error("[DEMO] Failed to initialize:", err.message);
    console.warn("[DEMO] Demo routes will return 503 until data is loaded.");
  }
}

function stopDemo() {
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }
  courses = [];
  initialized = false;
}

module.exports = { router, initDemo, stopDemo, searchCourses, isInitialized };
