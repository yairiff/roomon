import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { loadMySchedulePins, saveMySchedulePins } from "../../../lib/storage";
import type { MySchedulePin } from "../../../types/mySchedule";

type PinIdInput = Pick<
  MySchedulePin,
  "kind" | "dateKey" | "roomId" | "startMinutes" | "durationMinutes" | "lessonId"
>;

type UseMySchedulePinsArgs = {
  email?: string | null;
  pinIdFor: (pin: PinIdInput) => string;
  showToast?: (message: string) => void;
};

const normalizePin = (raw: Partial<MySchedulePin> & Record<string, unknown>, fallbackId: string): MySchedulePin | null => {
  const id = String(raw.id || fallbackId || "").trim();
  const kind = raw.kind as MySchedulePin["kind"];
  const dateKey = String(raw.dateKey || "").trim();
  const roomId = String(raw.roomId || "").trim();
  const startMinutes = Number(raw.startMinutes);
  const durationMinutes = Number(raw.durationMinutes);
  if (!id || !kind || !dateKey || !roomId) return null;
  if (!Number.isFinite(startMinutes) || !Number.isFinite(durationMinutes)) return null;
  return {
    id,
    kind,
    dateKey,
    lessonId: typeof raw.lessonId === "string" ? raw.lessonId : undefined,
    roomId,
    startMinutes,
    durationMinutes,
    title: String(raw.title || ""),
    meta: String(raw.meta || ""),
    reservedEmail: typeof raw.reservedEmail === "string" ? raw.reservedEmail : undefined,
    createdAt: Number(raw.createdAt || 0) || 0
  };
};

export function useMySchedulePins({ email, pinIdFor, showToast }: UseMySchedulePinsArgs) {
  const normalizedEmail = useMemo(() => (email || "").trim().toLowerCase(), [email]);
  const [pins, setPins] = useState<MySchedulePin[]>([]);

  // Load local immediately for responsiveness (and for offline usage).
  useEffect(() => {
    if (!normalizedEmail) {
      setPins([]);
      return;
    }
    setPins(loadMySchedulePins(normalizedEmail));
  }, [normalizedEmail]);

  // Remote subscription + migration:
  // - Canonical storage: `users/{email}/mySchedulePins/{pinId}`
  // - Legacy storage: `users/{email}.myPins` (array)
  useEffect(() => {
    if (!normalizedEmail) return;
    const firestore = db;
    if (!firestore) return;

    const userRef = doc(firestore, "users", normalizedEmail);
    const pinsRef = collection(firestore, "users", normalizedEmail, "mySchedulePins");

    let cancelled = false;
    let seeded = false;

    const seedIfNeeded = async (remotePins: MySchedulePin[]) => {
      if (seeded) return;
      if (remotePins.length) {
        seeded = true;
        return;
      }

      // Prefer legacy doc pins (for users signing in on a fresh device).
      let legacyPins: MySchedulePin[] = [];
      try {
        const snap = await getDoc(userRef);
        const data = snap.exists() ? (snap.data() as Record<string, unknown>) : null;
        if (data && Array.isArray((data as any).myPins)) {
          legacyPins = ((data as any).myPins as unknown[])
            .filter(Boolean)
            .map((p: any) => normalizePin(p as any, String(p?.id || "")))
            .filter(Boolean) as MySchedulePin[];
        }
      } catch {
        // ignore
      }

      const localPins = loadMySchedulePins(normalizedEmail);
      const seedPins = legacyPins.length ? legacyPins : localPins;
      if (!seedPins.length) {
        seeded = true;
        return;
      }

      try {
        const batch = writeBatch(firestore);
        seedPins.forEach((pin) => {
          const id = pin.id || pinIdFor(pin);
          const nextPin: MySchedulePin = { ...pin, id, createdAt: pin.createdAt || Date.now() };
          batch.set(doc(firestore, "users", normalizedEmail, "mySchedulePins", id), nextPin, { merge: true });
        });
        batch.set(userRef, { email: normalizedEmail, myPinsUpdatedAt: serverTimestamp() }, { merge: true });
        await batch.commit();
      } catch {
        // If seeding fails (rules), keep local pins only.
      } finally {
        seeded = true;
      }
    };

    const unsubscribe = onSnapshot(
      pinsRef,
      (snapshot) => {
        const next: MySchedulePin[] = [];
        snapshot.forEach((docSnap) => {
          const normalized = normalizePin(docSnap.data() as any, docSnap.id);
          if (!normalized) return;
          next.push(normalized);
        });
        next.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        if (cancelled) return;
        setPins(next);
        saveMySchedulePins(normalizedEmail, next);
        void seedIfNeeded(next);
      },
      () => {
        // Listener failed (permissions/offline) => stay with local pins.
        void seedIfNeeded([]);
      }
    );

    void seedIfNeeded([]);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [normalizedEmail, pinIdFor]);

  const togglePin = useCallback(
    async (pin: Omit<MySchedulePin, "id" | "createdAt">) => {
      if (!normalizedEmail) return;

      const base: PinIdInput = {
        kind: pin.kind,
        dateKey: pin.dateKey,
        lessonId: pin.lessonId,
        roomId: pin.roomId,
        startMinutes: pin.startMinutes,
        durationMinutes: pin.durationMinutes
      };
      const id = pinIdFor(base);
      const exists = pins.some((entry) => entry.id === id);
      showToast?.(exists ? "הוסר מהמערכת שלי" : "נוסף למערכת שלי");

      const firestore = db;
      if (!firestore) {
        // Local-only fallback.
        setPins((prev) => {
          const next = exists
            ? prev.filter((entry) => entry.id !== id)
            : [
                ...prev,
                {
                  id,
                  ...base,
                  title: pin.title,
                  meta: pin.meta,
                  reservedEmail: pin.reservedEmail,
                  createdAt: Date.now()
                }
              ];
          saveMySchedulePins(normalizedEmail, next);
          return next;
        });
        return;
      }

      try {
        if (exists) {
          await deleteDoc(doc(firestore, "users", normalizedEmail, "mySchedulePins", id));
        } else {
          const nextPin: MySchedulePin = {
            id,
            ...base,
            title: pin.title,
            meta: pin.meta,
            reservedEmail: pin.reservedEmail,
            createdAt: Date.now()
          };
          await setDoc(doc(firestore, "users", normalizedEmail, "mySchedulePins", id), nextPin, { merge: true });
        }
        await setDoc(doc(firestore, "users", normalizedEmail), { email: normalizedEmail, myPinsUpdatedAt: serverTimestamp() }, { merge: true });
      } catch {
        // Keep UX responsive even if remote write fails.
        setPins((prev) => {
          const next = exists
            ? prev.filter((entry) => entry.id !== id)
            : [
                ...prev,
                {
                  id,
                  ...base,
                  title: pin.title,
                  meta: pin.meta,
                  reservedEmail: pin.reservedEmail,
                  createdAt: Date.now()
                }
              ];
          saveMySchedulePins(normalizedEmail, next);
          return next;
        });
      }
    },
    [normalizedEmail, pinIdFor, pins, showToast]
  );

  const isPinned = useCallback(
    (pin: PinIdInput) => Boolean(normalizedEmail && pins.some((entry) => entry.id === pinIdFor(pin))),
    [normalizedEmail, pinIdFor, pins]
  );

  return { pins, setPins, togglePin, isPinned };
}

