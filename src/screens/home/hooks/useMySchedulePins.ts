import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc
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
  // Canonical storage: `users/{email}.myPins` (array)
  // - We keep pins on the user doc so they reliably persist across devices.
  // - A best-effort migration pulls from older `users/{email}/mySchedulePins` when accessible.
  useEffect(() => {
    if (!normalizedEmail) return;
    const firestore = db;
    if (!firestore) return;

    const userRef = doc(firestore, "users", normalizedEmail);

    let cancelled = false;
    const localSeedPins = loadMySchedulePins(normalizedEmail);
    let seedAttempted = false;

    const seedDocIfNeeded = async (remotePins: MySchedulePin[]) => {
      if (seedAttempted) return;
      if (remotePins.length) return;
      if (!localSeedPins.length) return;
      seedAttempted = true;
      try {
        await setDoc(
          userRef,
          { email: normalizedEmail, myPins: localSeedPins, myPinsUpdatedAt: serverTimestamp() },
          { merge: true }
        );
      } catch {
        // Best-effort.
      }
    };

    const migrateFromSubcollection = async () => {
      // Older builds stored pins in `users/{email}/mySchedulePins/{pinId}`.
      // Pull them once and write into the canonical `myPins` array when possible.
      try {
        const pinsRef = collection(firestore, "users", normalizedEmail, "mySchedulePins");
        const snap = await getDocs(pinsRef);
        const migrated: MySchedulePin[] = [];
        snap.forEach((docSnap) => {
          const normalized = normalizePin(docSnap.data() as any, docSnap.id);
          if (!normalized) return;
          migrated.push(normalized);
        });
        if (!migrated.length) return;
        migrated.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        const userSnap = await getDoc(userRef);
        const data = userSnap.exists() ? (userSnap.data() as any) : null;
        const existing = Array.isArray(data?.myPins)
          ? (data.myPins as unknown[]).map((p: any) => normalizePin(p as any, String(p?.id || ""))).filter(Boolean) as MySchedulePin[]
          : [];
        const mergedById = new Map<string, MySchedulePin>();
        existing.forEach((p) => mergedById.set(p.id, p));
        migrated.forEach((p) => mergedById.set(p.id, p));
        const merged = Array.from(mergedById.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        await setDoc(
          userRef,
          { email: normalizedEmail, myPins: merged, myPinsUpdatedAt: serverTimestamp() },
          { merge: true }
        );
      } catch {
        // ignore
      }
    };

    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        if (cancelled) return;
        const data = snapshot.exists() ? (snapshot.data() as any) : null;
        const remotePinsRaw = Array.isArray(data?.myPins) ? (data.myPins as unknown[]) : [];
        const next = remotePinsRaw
          .filter(Boolean)
          .map((p: any) => normalizePin(p as any, String(p?.id || "")))
          .filter(Boolean) as MySchedulePin[];
        next.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        if (next.length) {
          setPins(next);
          saveMySchedulePins(normalizedEmail, next);
        } else {
          void seedDocIfNeeded([]);
        }
      },
      () => {
        // Listener failed (permissions/offline) => stay with local pins.
        void seedDocIfNeeded([]);
      }
    );

    void migrateFromSubcollection();
    void seedDocIfNeeded([]);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [normalizedEmail]);

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
      // Optimistic local update (also serves offline mode).
      const optimisticNext = (() => {
        const now = Date.now();
        return exists
          ? pins.filter((entry) => entry.id !== id)
          : [
              ...pins,
              {
                id,
                ...base,
                title: pin.title,
                meta: pin.meta,
                reservedEmail: pin.reservedEmail,
                createdAt: now
              }
            ];
      })();
      setPins(optimisticNext);
      saveMySchedulePins(normalizedEmail, optimisticNext);

      if (!firestore) return;
      try {
        await setDoc(
          doc(firestore, "users", normalizedEmail),
          { email: normalizedEmail, myPins: optimisticNext, myPinsUpdatedAt: serverTimestamp() },
          { merge: true }
        );
      } catch {
        // Best-effort: keep local state.
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
