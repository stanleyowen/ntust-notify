"""Backend main module for QueryCourse API."""

import argparse
import asyncio
import logging
import math
import os
import random
import sys
import typing
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager, suppress
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

# Configuration
API_URL = "https://querycourse.ntust.edu.tw/QueryCourse/api//courses"
HEADERS = {"content-type": "application/json; charset=utf-8"}

# Logging Setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s.%(msecs)03d | %(levelname)s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
# Silence noisy loggers
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)


# --- Pydantic Models ---
class CourseQueryRequest(BaseModel):
    """Course query request model."""

    Semester: str = ""
    CourseNo: str = ""
    CourseName: str = ""
    CourseTeacher: str = ""
    Dimension: str = ""
    CourseNotes: str = ""
    CampusNotes: str = ""
    ForeignLanguage: int = 0
    OnlyGeneral: int = 0
    OnleyNTUST: int = 0
    OnlyMaster: int = 0
    OnlyUnderGraduate: int = 0
    OnlyNode: int = 0
    Language: str = "zh"


class CourseResponse(BaseModel):
    """Course response model."""

    Semester: str
    CourseNo: str
    CourseName: str
    CourseTeacher: str
    Dimension: str
    CreditPoint: str
    RequireOption: str
    AllYear: str
    ChooseStudent: int
    Restrict1: str
    Restrict2: str
    ThreeStudent: int
    AllStudent: int
    NTURestrict: str
    NTNURestrict: str
    CourseTimes: str
    PracticalTimes: str
    ClassRoomNo: str
    ThreeNode: str | None = None
    Node: str
    Contents: str
    NTU_People: int
    NTNU_People: int
    AbroadPeople: int


# --- Service Layer ---
class CourseRepository:
    """Manages course data storage and retrieval."""

    NULLABLE_STR_FIELDS: typing.ClassVar[list[str]] = [
        "CourseTeacher",
        "Dimension",
        "CreditPoint",
        "RequireOption",
        "AllYear",
        "Restrict1",
        "Restrict2",
        "NTURestrict",
        "NTNURestrict",
        "CourseTimes",
        "PracticalTimes",
        "ClassRoomNo",
        "Node",
        "Contents",
    ]

    NULLABLE_INT_FIELDS: typing.ClassVar[list[str]] = [
        "ChooseStudent",
        "ThreeStudent",
        "AllStudent",
        "NTU_People",
        "NTNU_People",
        "AbroadPeople",
    ]

    def __init__(self) -> None:
        """Initialize repository."""
        self._courses: list[dict] = []
        self._initialized: bool = False
        self.update_cursor: int = 0

    @property
    def is_initialized(self) -> bool:
        """Check if data is loaded."""
        return self._initialized

    @property
    def count(self) -> int:
        """Return number of courses."""
        return len(self._courses)

    def clear(self) -> None:
        """Clear in-memory data."""
        self._courses.clear()
        self._initialized = False
        self.update_cursor = 0

    def _sanitize(self, course: dict) -> dict:
        """Help sanitize a single course record."""
        for field in self.NULLABLE_STR_FIELDS:
            if course.get(field) is None:
                course[field] = ""

        for field in self.NULLABLE_INT_FIELDS:
            if course.get(field) is None:
                course[field] = 0
        return course

    def simulate_batch_update(self) -> None:
        """
        Update a batch of courses to simulate registration changes.
        Target: Update 1/60th of total courses per call.
        """
        if not self._initialized or not self._courses:
            return

        total_courses = len(self._courses)
        batch_size = math.ceil(total_courses / 60)

        start_idx = self.update_cursor
        end_idx = start_idx + batch_size

        batch = self._courses[start_idx:end_idx]

        needed = batch_size - len(batch)
        if needed > 0:
            batch.extend(self._courses[0:needed])
            self.update_cursor = needed
        else:
            self.update_cursor = end_idx

        for course in batch:
            try:
                restrict2_str = course.get("Restrict2", "0")
                capacity = (
                    int(restrict2_str)
                    if restrict2_str and restrict2_str.isdigit()
                    else 0
                )
            except ValueError:
                capacity = 0

            if capacity <= 0:
                continue

            current_choose = course.get("ChooseStudent", 0)
            three_student = course.get("ThreeStudent", 0)
            rand = random.random()

            if rand < 0.5:
                # 50% Full
                new_choose = max(0, capacity - three_student)
            elif rand < 0.9:
                # 40% Dropout 1
                new_choose = max(0, current_choose - 1)
            else:
                # 10% Dropout 2
                new_choose = max(0, current_choose - 2)

            new_all = new_choose + three_student
            course["ChooseStudent"] = new_choose
            course["AllStudent"] = new_all

    async def load_data(self, semester: str) -> None:
        """Fetch and load data from upstream API."""
        payload = {
            "Semester": semester,
            "CourseNo": "",
            "CourseName": "",
            "CourseTeacher": " ",
            "Dimension": "",
            "CourseNotes": "",
            "CampusNotes": "",
            "ForeignLanguage": 0,
            "OnlyIntensive": 0,
            "OnlyGeneral": 0,
            "OnleyNTUST": 0,
            "OnlyMaster": 0,
            "OnlyUnderGraduate": 0,
            "OnlyNode": 0,
            "Language": "zh",
        }

        try:
            async with httpx.AsyncClient(http2=True) as client:
                response = await client.post(
                    API_URL,
                    json=payload,
                    headers=HEADERS,
                    timeout=30.0,
                )
                response.raise_for_status()
                raw_data = response.json()

                # Process data
                self._courses = [self._sanitize(c) for c in raw_data]
                self._initialized = True
                self.update_cursor = 0
                logger.info("Repository loaded: %d courses", len(self._courses))

        except httpx.HTTPError:
            logger.exception("HTTP Error fetching data")
            sys.exit(1)
        except Exception:
            logger.exception("Unexpected error during data load")
            sys.exit(1)

    def search(self, criteria: CourseQueryRequest) -> list[dict]:
        """Filter courses based on criteria."""
        if not self._initialized:
            raise HTTPException(status_code=503, detail="Data not initialized")

        # Extract criteria for faster access
        q_semester = criteria.Semester
        q_no = criteria.CourseNo.upper() if criteria.CourseNo else ""
        q_name = criteria.CourseName.strip()
        q_teacher = criteria.CourseTeacher
        q_dim = criteria.Dimension

        # High-performance list comprehension
        return [
            c
            for c in self._courses
            if (not q_semester or c.get("Semester") == q_semester)
               and (not q_no or q_no in (c.get("CourseNo") or "").upper())
               and (not q_name or q_name in (c.get("CourseName") or ""))
               and (not q_teacher or q_teacher in (c.get("CourseTeacher") or ""))
               and (not q_dim or c.get("Dimension") == q_dim)
        ]


course_repo = CourseRepository()


# --- Background Tasks ---
async def simulation_worker():
    """A background task to update the course counts every second."""
    logger.info("Simulation worker started.")
    try:
        while True:
            if course_repo.is_initialized:
                course_repo.simulate_batch_update()
            await asyncio.sleep(1)
    except asyncio.CancelledError:
        logger.info("Simulation worker cancelled.")
    except Exception:
        logger.exception("Simulation worker crashed unexpectedly")


# --- FastAPI Lifecycle & Routes ---
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, Any]:
    """Lifespan manager to handle data loading and background tasks."""
    semester = os.getenv("SEMESTER")
    if not semester:
        logger.error("Error: SEMESTER environment variable is required.")
        sys.exit(1)

    # 1. Load Data
    logger.info("Initializing... Fetching data for Semester: %s", semester)
    await course_repo.load_data(semester)

    # 2. Start Background Simulation Task
    sim_task = asyncio.create_task(simulation_worker())

    yield

    # 3. Cleanup
    sim_task.cancel()
    with suppress(asyncio.CancelledError):
        await sim_task

    course_repo.clear()


app = FastAPI(title="Course Query API", version="2.0.0", lifespan=lifespan)


@app.post("/QueryCourse/api//courses")
async def query_courses(request: CourseQueryRequest) -> list[dict]:
    """Endpoint to query courses."""
    logger.info("Querying courses: %s", request.model_dump_json(indent=2))
    return course_repo.search(request)


@app.get("/")
async def root() -> dict:
    """Root endpoint."""
    return {"message": "Course Query API (In-Memory) is running"}


@app.get("/healthz")
async def health_check() -> dict:
    """Health check endpoint."""
    return {
        "status": "healthy",
        "courses_count": course_repo.count,
        "update_cursor": course_repo.update_cursor,
    }


def main() -> None:
    """Entry point for script execution."""
    parser = argparse.ArgumentParser(description="Run the Course Query API server")
    parser.add_argument(
        "-S",
        "--semester",
        required=True,
        help="Target Semester (e.g., 1142) [Required]",
    )
    args = parser.parse_args()

    os.environ["SEMESTER"] = args.semester

    logger.info("Starting server for Semester: %s", args.semester)
    uvicorn.run(app, host="localhost", port=8000, log_level="warning")


if __name__ == "__main__":
    main()