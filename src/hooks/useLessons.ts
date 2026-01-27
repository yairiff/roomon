import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import type { LessonRecord } from "../types/admin";
import type { SemesterKey } from "../types/ui";

export function useLessons(semester?: SemesterKey | null) {
  const [lessons, setLessons] = useState<LessonRecord[]>([]);
  const [lessonsReady, setLessonsReady] = useState<boolean>(!db);
  const [lessonsError, setLessonsError] = useState<string>("");

  useEffect(() => {
    if (!db) {
      setLessonsError("Firestore is not configured.");
      setLessonsReady(true);
      return;
    }
    if (semester === null) {
      setLessons([]);
      setLessonsError("");
      setLessonsReady(true);
      return;
    }

    const lessonsRef = collection(db, "lessons");
    const q = semester ? query(lessonsRef, where("semester", "==", semester)) : lessonsRef;
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next: LessonRecord[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as LessonRecord;
          if (!data) return;
          next.push({
            ...data,
            id: data.id || docSnap.id
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
  }, [semester]);

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
