import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import type { LessonRecord } from "../types/admin";

const toSemesterScope = (value?: string | null | string[]) => {
  if (value === null) return null;
  if (Array.isArray(value)) {
    const ids = Array.from(new Set(value.map((entry) => entry.trim()).filter(Boolean)));
    return ids.length ? ids : [];
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
};

export function useLessons(semesterId?: string | null | string[]) {
  const [lessons, setLessons] = useState<LessonRecord[]>([]);
  const [lessonsReady, setLessonsReady] = useState<boolean>(!db);
  const [lessonsError, setLessonsError] = useState<string>("");
  const semesterScope = toSemesterScope(semesterId);
  const semesterScopeKey = semesterScope === null ? "__none__" : semesterScope.join("|");

  useEffect(() => {
    if (!db) {
      setLessonsError("Firestore is not configured.");
      setLessonsReady(true);
      return;
    }
    if (semesterScope === null) {
      setLessons([]);
      setLessonsError("");
      setLessonsReady(true);
      return;
    }

    const lessonsRef = collection(db, "lessons");
    const q =
      semesterScope.length === 0
        ? lessonsRef
        : semesterScope.length === 1
          ? query(lessonsRef, where("semester", "==", semesterScope[0]))
          : query(lessonsRef, where("semester", "in", semesterScope.slice(0, 10)));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next: LessonRecord[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as LessonRecord;
          if (!data) return;
          if (semesterScope.length > 10 && !semesterScope.includes(String(data.semester || ""))) return;
          next.push({
            ...data,
            id: data.id || docSnap.id,
            syncSource: data.syncSource === "api" ? "api" : data.syncSource === "manual" ? "manual" : undefined,
            externalId: typeof data.externalId === "string" ? data.externalId : undefined
          });
        });
        next.sort((a, b) => {
          if (a.day !== b.day) return a.day.localeCompare(b.day);
          if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
          return a.roomId.localeCompare(b.roomId);
        });
        setLessons(next);
        setLessonsError("");
        setLessonsReady(true);
      },
      () => {
        setLessonsError("Failed to load lessons.");
        setLessonsReady(true);
      }
    );

    return () => unsubscribe();
  }, [semesterScopeKey]);

  const upsertLesson = async (lesson: LessonRecord) => {
    if (!db) return;
    if (!lesson.id) return;
    await setDoc(doc(db, "lessons", lesson.id), lesson);
  };

  const removeLesson = async (lessonId: string) => {
    if (!db) return;
    if (!lessonId) return;
    await deleteDoc(doc(db, "lessons", lessonId));
  };

  return {
    lessons,
    lessonsReady,
    lessonsError,
    upsertLesson,
    removeLesson
  };
}
