import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  setDoc
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import { stripUndefined } from "../lib/stripUndefined";
import type { LessonOverride, LessonOverrideAction } from "../types/admin";
import type { Lesson } from "../types/schedule";

type OverrideInput = {
  date: string;
  action: LessonOverrideAction;
  targetLessonId?: string;
  lesson?: Lesson;
  createdBy?: string;
};

export type LessonOverridesWindow = { startDate: string; endDate: string } | null;

export function useLessonOverrides(window: LessonOverridesWindow = null, enabled = true) {
  const [overrides, setOverrides] = useState<LessonOverride[]>([]);
  const [overridesReady, setOverridesReady] = useState<boolean>(!db);
  const [overridesError, setOverridesError] = useState<string>("");

  useEffect(() => {
    if (!enabled) {
      setOverrides([]);
      setOverridesError("");
      setOverridesReady(true);
      return;
    }
    if (!db) {
      setOverridesError("Firestore is not configured.");
      setOverridesReady(true);
      return;
    }

    const ref = collection(db, "lessonOverrides");
    const q = window
      ? query(ref, where("date", ">=", window.startDate), where("date", "<=", window.endDate))
      : ref;
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const next: LessonOverride[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Omit<LessonOverride, "id"> & { createdAt?: { toMillis: () => number } };
          next.push({
            id: docSnap.id,
            date: data.date,
            action: data.action,
            targetLessonId: data.targetLessonId,
            lesson: data.lesson,
            createdBy: data.createdBy,
            createdAt: data.createdAt?.toMillis ? data.createdAt.toMillis() : data.createdAt
          });
        });
        next.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        setOverrides(next);
        setOverridesError("");
        setOverridesReady(true);
      },
      () => {
        setOverridesError("Failed to load lesson overrides.");
        setOverridesReady(true);
      }
    );

    return () => unsubscribe();
  }, [enabled, window?.endDate, window?.startDate]);

  const overridesByDate = useMemo(() => {
    const map: Record<string, LessonOverride[]> = {};
    overrides.forEach((override) => {
      if (!override.date) return;
      if (!map[override.date]) {
        map[override.date] = [];
      }
      map[override.date].push(override);
    });
    return map;
  }, [overrides]);

  const addOverride = async (input: OverrideInput) => {
    if (!db) {
      setOverridesError("Firestore is not configured.");
      return false;
    }
    try {
      await addDoc(collection(db, "lessonOverrides"), {
        ...stripUndefined(input as unknown as Record<string, unknown>),
        createdAt: serverTimestamp()
      });
      return true;
    } catch {
      setOverridesError("Failed to save lesson override.");
      return false;
    }
  };

  const upsertOverride = async (override: LessonOverride) => {
    if (!db) return;
    await setDoc(doc(db, "lessonOverrides", override.id), {
      ...stripUndefined(override as unknown as Record<string, unknown>),
      createdAt: serverTimestamp()
    });
  };

  const removeOverride = async (overrideId: string) => {
    if (!db) return;
    await deleteDoc(doc(db, "lessonOverrides", overrideId));
  };

  return {
    overrides,
    overridesByDate,
    overridesReady,
    overridesError,
    addOverride,
    upsertOverride,
    removeOverride
  };
}
