import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import type { ScheduleConfig } from "../types/schedule";

export type SemesterRange = ScheduleConfig["semesterRanges"][number];

const DEFAULT_RANGES: SemesterRange[] = [];

export function useScheduleSettings() {
  const [semesterRanges, setSemesterRanges] = useState<SemesterRange[]>(DEFAULT_RANGES);
  const [settingsReady, setSettingsReady] = useState<boolean>(!db);
  const [settingsError, setSettingsError] = useState<string>("");

  useEffect(() => {
    if (!db) {
      setSettingsError("Firestore is not configured.");
      setSettingsReady(true);
      return;
    }

    const ref = doc(db, "settings", "schedule");
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as { semesterRanges?: SemesterRange[] } | undefined;
        setSemesterRanges(data?.semesterRanges ?? DEFAULT_RANGES);
        setSettingsError("");
        setSettingsReady(true);
      },
      () => {
        setSettingsError("Failed to load schedule settings.");
        setSettingsReady(true);
      }
    );

    return () => unsubscribe();
  }, []);

  const saveSemesterRanges = async (ranges: SemesterRange[]) => {
    if (!db) return;
    await setDoc(
      doc(db, "settings", "schedule"),
      { semesterRanges: ranges },
      { merge: true }
    );
  };

  return {
    semesterRanges,
    settingsReady,
    settingsError,
    saveSemesterRanges
  };
}
