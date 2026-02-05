import { useCallback, useEffect, useRef, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { loadMySchedulePins, saveMySchedulePins } from "../../../lib/storage";
import type { MySchedulePin } from "../../../types/mySchedule";

type PinIdInput = Pick<MySchedulePin, "kind" | "dateKey" | "roomId" | "startMinutes" | "durationMinutes" | "lessonId">;

type UseMySchedulePinsArgs = {
  email?: string | null;
  pinIdFor: (pin: PinIdInput) => string;
  showToast?: (message: string) => void;
};

export function useMySchedulePins({ email, pinIdFor, showToast }: UseMySchedulePinsArgs) {
  const [pins, setPins] = useState<MySchedulePin[]>([]);
  const pinsSyncReadyRef = useRef(false);
  const pinsSuppressWriteRef = useRef(false);
  const pinsWriteTimerRef = useRef<number | null>(null);
  const pinsDirtyRef = useRef(false);

  useEffect(() => {
    const rawEmail = email?.trim().toLowerCase();
    if (!rawEmail) {
      setPins([]);
      return;
    }

    const localPins = loadMySchedulePins(rawEmail);
    setPins(localPins);
    pinsSyncReadyRef.current = false;
    pinsSuppressWriteRef.current = true;
    pinsDirtyRef.current = false;
    if (pinsWriteTimerRef.current) {
      window.clearTimeout(pinsWriteTimerRef.current);
      pinsWriteTimerRef.current = null;
    }

    let cancelled = false;
    const loadRemote = async () => {
      const firestore = db;
      if (!firestore) {
        pinsSyncReadyRef.current = true;
        pinsSuppressWriteRef.current = false;
        return;
      }
      let loadedRemotePins = false;
      try {
        const snap = await getDoc(doc(firestore, "users", rawEmail));
        if (!snap.exists()) {
          pinsSyncReadyRef.current = true;
          pinsSuppressWriteRef.current = false;
          return;
        }
        const data = snap.data() as Record<string, unknown>;
        const hasRemotePins = Object.prototype.hasOwnProperty.call(data, "myPins") && Array.isArray(data.myPins);
        if (hasRemotePins) {
          loadedRemotePins = true;
          const remotePins = (data.myPins as unknown[]).filter(Boolean) as MySchedulePin[];
          if (cancelled) return;
          if (pinsDirtyRef.current) {
            // User changed pins before the fetch resolved; keep local state and sync it back.
            pinsSuppressWriteRef.current = false;
            return;
          }
          pinsSuppressWriteRef.current = true;
          setPins(remotePins);
          saveMySchedulePins(rawEmail, remotePins);
          return;
        }

        // Migration path: if this user already has local pins, persist them to Firestore once.
        if (localPins.length) {
          await setDoc(
            doc(firestore, "users", rawEmail),
            { myPins: localPins, myPinsUpdatedAt: serverTimestamp() },
            { merge: true }
          );
        }
      } catch {
        // Keep local pins if the fetch fails.
      } finally {
        pinsSyncReadyRef.current = true;
        if (!loadedRemotePins) pinsSuppressWriteRef.current = false;
      }
    };

    void loadRemote();
    return () => {
      cancelled = true;
    };
  }, [email]);

  useEffect(() => {
    const rawEmail = email?.trim().toLowerCase();
    if (!rawEmail) return;
    saveMySchedulePins(rawEmail, pins);
    const firestore = db;
    if (!firestore) return;
    if (!pinsSyncReadyRef.current) return;
    if (pinsSuppressWriteRef.current) {
      pinsSuppressWriteRef.current = false;
      return;
    }
    if (pinsWriteTimerRef.current) window.clearTimeout(pinsWriteTimerRef.current);
    pinsWriteTimerRef.current = window.setTimeout(() => {
      void setDoc(doc(firestore, "users", rawEmail), { myPins: pins, myPinsUpdatedAt: serverTimestamp() }, { merge: true });
    }, 500);
  }, [email, pins]);

  const togglePin = useCallback(
    (pin: Omit<MySchedulePin, "id" | "createdAt">) => {
      const rawEmail = email?.trim().toLowerCase();
      if (!rawEmail) return;
      pinsDirtyRef.current = true;
      setPins((prev) => {
        const base = {
          kind: pin.kind,
          dateKey: pin.dateKey,
          lessonId: pin.lessonId,
          roomId: pin.roomId,
          startMinutes: pin.startMinutes,
          durationMinutes: pin.durationMinutes
        };
        const id = pinIdFor(base);
        const exists = prev.some((entry) => entry.id === id);
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
                lessonId: pin.lessonId,
                createdAt: Date.now()
              }
            ];
        showToast?.(exists ? "הוסר מהמערכת שלי" : "נוסף למערכת שלי");
        return next;
      });
    },
    [email, pinIdFor, showToast]
  );

  const isPinned = useCallback(
    (pin: PinIdInput) => Boolean(email && pins.some((entry) => entry.id === pinIdFor(pin))),
    [email, pinIdFor, pins]
  );

  return { pins, setPins, togglePin, isPinned };
}
