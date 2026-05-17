import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deleteField, doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import {
  loadUserAvailability,
  loadUserAvailabilityDateOffs,
  saveUserAvailability,
  saveUserAvailabilityDateOffs
} from "../../../lib/storage";
import { defaultUserAvailability, normalizeUserAvailability } from "../../../lib/collaboration";
import { collaborationWeekdays } from "../../../types/collaboration";
import type { DayKey } from "../../../types/schedule";
import type { AvailabilityDateOffs, UserAvailability } from "../../../types/collaboration";

type UseUserAvailabilityArgs = {
  email?: string | null;
};

export function useUserAvailability({ email }: UseUserAvailabilityArgs) {
  const nonUiDays: DayKey[] = ["fri", "sat"].filter((dayKey) => !collaborationWeekdays.includes(dayKey as DayKey)) as DayKey[];
  const normalizedEmail = useMemo(() => (email || "").trim().toLowerCase(), [email]);
  const [availability, setAvailability] = useState<UserAvailability>(defaultUserAvailability);
  const [dateOffs, setDateOffs] = useState<AvailabilityDateOffs>({});
  const availabilityRef = useRef<UserAvailability>(availability);
  const dateOffsRef = useRef<AvailabilityDateOffs>(dateOffs);

  const normalizeDateOffs = useCallback((raw: unknown): AvailabilityDateOffs => {
    const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const next: AvailabilityDateOffs = {};
    Object.entries(input).forEach(([dateKey, value]) => {
      if (!dateKey) return;
      if (value) next[dateKey] = true;
    });
    return next;
  }, []);

  useEffect(() => {
    availabilityRef.current = availability;
  }, [availability]);

  useEffect(() => {
    dateOffsRef.current = dateOffs;
  }, [dateOffs]);

  useEffect(() => {
    if (!normalizedEmail) {
      setAvailability(defaultUserAvailability());
      setDateOffs({});
      return;
    }
    setAvailability(normalizeUserAvailability(loadUserAvailability(normalizedEmail)));
    setDateOffs(normalizeDateOffs(loadUserAvailabilityDateOffs(normalizedEmail)));
  }, [normalizeDateOffs, normalizedEmail]);

  useEffect(() => {
    if (!normalizedEmail || !db) return;
    const userRef = doc(db, "users", normalizedEmail);
    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        const raw = snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : {};
        const normalized = normalizeUserAvailability(raw.availability);
        const normalizedDateOffs = normalizeDateOffs(raw.availabilityDateOffs);
        setAvailability(normalized);
        setDateOffs(normalizedDateOffs);
        saveUserAvailability(normalizedEmail, normalized);
        saveUserAvailabilityDateOffs(normalizedEmail, normalizedDateOffs);
      },
      () => {
        // Keep local state if the listener is blocked.
      }
    );
    return () => unsubscribe();
  }, [normalizeDateOffs, normalizedEmail]);

  const updateAvailability = useCallback(
    async (next: UserAvailability, nextDateOffs: AvailabilityDateOffs = dateOffsRef.current) => {
      if (!normalizedEmail) return;
      const prevDateOffs = dateOffsRef.current;
      const normalized = normalizeUserAvailability(next);
      const normalizedDateOffs = normalizeDateOffs(nextDateOffs);
      setAvailability(normalized);
      setDateOffs(normalizedDateOffs);
      availabilityRef.current = normalized;
      dateOffsRef.current = normalizedDateOffs;
      saveUserAvailability(normalizedEmail, normalized);
      saveUserAvailabilityDateOffs(normalizedEmail, normalizedDateOffs);
      if (!db) return;
      try {
        const userRef = doc(db, "users", normalizedEmail);
        const persistedAvailability = collaborationWeekdays.reduce<Record<string, unknown>>((acc, dayKey) => {
          acc[dayKey] = normalized[dayKey];
          return acc;
        }, {});
        await setDoc(
          userRef,
          {
            email: normalizedEmail,
            availability: persistedAvailability,
            availabilityUpdatedAt: serverTimestamp()
          },
          { merge: true }
        );
        const dateOffUpdates: Record<string, unknown> = {};
        nonUiDays.forEach((dayKey) => {
          dateOffUpdates[`availability.${dayKey}`] = deleteField();
        });
        const nextDateKeys = Object.keys(normalizedDateOffs);
        if (!nextDateKeys.length) {
          dateOffUpdates.availabilityDateOffs = {};
        } else {
          Object.keys(prevDateOffs).forEach((dateKey) => {
            if (!normalizedDateOffs[dateKey]) {
              dateOffUpdates[`availabilityDateOffs.${dateKey}`] = deleteField();
            }
          });
          nextDateKeys.forEach((dateKey) => {
            dateOffUpdates[`availabilityDateOffs.${dateKey}`] = true;
          });
        }
        if (Object.keys(dateOffUpdates).length) {
          await updateDoc(userRef, dateOffUpdates);
        }
      } catch {
        // Best effort: keep local.
      }
    },
    [normalizeDateOffs, normalizedEmail]
  );

  const setDayAvailability = useCallback(
    async (dayKey: DayKey, updates: Partial<{ enabled: boolean; startMinutes: number; endMinutes: number }>) => {
      const latestAvailability = availabilityRef.current;
      const current = latestAvailability[dayKey] || { enabled: false, startMinutes: 9 * 60, endMinutes: 22 * 60 };
      const next: UserAvailability = {
        ...latestAvailability,
        [dayKey]: {
          enabled: typeof updates.enabled === "boolean" ? updates.enabled : current.enabled,
          startMinutes: typeof updates.startMinutes === "number" ? updates.startMinutes : current.startMinutes,
          endMinutes: typeof updates.endMinutes === "number" ? updates.endMinutes : current.endMinutes
        }
      };
      await updateAvailability(next);
    },
    [updateAvailability]
  );

  const setDateOff = useCallback(
    async (dateKey: string, off: boolean) => {
      if (!dateKey) return;
      const nextDateOffs: AvailabilityDateOffs = { ...dateOffsRef.current };
      if (off) nextDateOffs[dateKey] = true;
      else delete nextDateOffs[dateKey];
      await updateAvailability(availabilityRef.current, nextDateOffs);
    },
    [updateAvailability]
  );

  return {
    availability,
    dateOffs,
    updateAvailability,
    setDayAvailability,
    setDateOff
  };
}
