import { useEffect, useState, useCallback } from "react";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";

/**
 * Synchronizes the current user's watchedCourses subcollection from Firestore.
 *
 * Firestore schema:
 * - users/{uid}/watchedCourses/{courseNo}
 * - document fields include course metadata plus watch-specific flags such as
 *   notifyEnabled.
 *
 * @param {string | undefined | null} uid - Firebase user ID.
 * @returns {{
 *   watchedCourses: Array<Record<string, any>>,
 *   loading: boolean,
 *   watchCourse: (course: Record<string, any>) => Promise<void>,
 *   unwatchCourse: (courseNo: string) => Promise<void>,
 *   isWatched: (courseNo: string) => boolean,
 *   toggleNotify: (courseNo: string) => Promise<void>,
 *   isNotifyEnabled: (courseNo: string) => boolean,
 * }}
 */
export function useWatchedCourses(uid, { demo = false } = {}) {
  const [watchedCourses, setWatchedCourses] = useState([]); // array of { CourseNo, ... }
  const [loading, setLoading] = useState(false);

  /**
   * Subscribes to the watchedCourses subcollection for the current user and
   * keeps the local array synchronized in real time.
   *
   * @returns {() => void | undefined}
   */
  useEffect(() => {
    if (!uid) {
      setWatchedCourses([]);
      return;
    }

    setLoading(true);
    const colRef = collection(db, "users", uid, "watchedCourses");

    const unsub = onSnapshot(colRef, (snap) => {
      setWatchedCourses(snap.docs.map((d) => d.data()));
      setLoading(false);
    });

    return unsub;
  }, [uid]);

  /**
   * Adds a course to the user's watchlist.
   *
   * The hook stores the core course metadata plus enrollment-related fields so
   * the watchlist table can render without needing to re-query search results.
   *
   * @param {Record<string, any>} course - Course object to save.
   * @returns {Promise<void>}
   */
  const watchCourse = useCallback(
    async (course) => {
      if (!uid) return;
      const ref = doc(db, "users", uid, "watchedCourses", course.CourseNo);
      await setDoc(ref, {
        CourseNo: course.CourseNo,
        CourseName: course.CourseName,
        CourseTeacher: course.CourseTeacher ?? "",
        Semester: course.Semester ?? "",
        // Enrollment fields needed for the watchlist table display.
        Restrict1: course.Restrict1 ?? "",
        ChooseStudent: course.ChooseStudent ?? 0,
        CreditPoint: course.CreditPoint ?? "",
        ClassRoomNo: course.ClassRoomNo ?? "",
        Node: course.Node ?? "",
        addedAt: serverTimestamp(),
        ...(demo ? { demo: true } : {}),
      });
    },
    [uid, demo],
  );

  /**
   * Removes a course from the user's watchlist.
   *
   * @param {string} courseNo - Course number to remove.
   * @returns {Promise<void>}
   */
  const unwatchCourse = useCallback(
    async (courseNo) => {
      if (!uid) return;
      const ref = doc(db, "users", uid, "watchedCourses", courseNo);
      await deleteDoc(ref);
    },
    [uid],
  );

  /**
   * Returns whether a given course number is currently present in the watchlist.
   *
   * @param {string} courseNo - Course number to check.
   * @returns {boolean}
   */
  const isWatched = useCallback(
    (courseNo) => watchedCourses.some((c) => c.CourseNo === courseNo),
    [watchedCourses],
  );

  /**
   * Toggles the notifyEnabled flag for a watched course.
   *
   * @param {string} courseNo - Course number to update.
   * @returns {Promise<void>}
   */
  const toggleNotify = useCallback(
    async (courseNo) => {
      if (!uid) return;
      const ref = doc(db, "users", uid, "watchedCourses", courseNo);
      const current = watchedCourses.find((c) => c.CourseNo === courseNo);
      await updateDoc(ref, {
        notifyEnabled: !(current?.notifyEnabled ?? false),
      });
    },
    [uid, watchedCourses],
  );

  /**
   * Returns whether notifications are enabled for the given watched course.
   *
   * @param {string} courseNo - Course number to check.
   * @returns {boolean}
   */
  const isNotifyEnabled = useCallback(
    (courseNo) => {
      const course = watchedCourses.find((c) => c.CourseNo === courseNo);
      return course?.notifyEnabled ?? false;
    },
    [watchedCourses],
  );

  return {
    watchedCourses,
    loading,
    watchCourse,
    unwatchCourse,
    isWatched,
    toggleNotify,
    isNotifyEnabled,
  };
}
