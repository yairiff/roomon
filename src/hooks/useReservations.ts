import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { stripUndefined } from "../lib/stripUndefined";
import { formatDateKey } from "../lib/date";
import type { Reservation, ReservationMap, ReservationParticipant } from "../types/reservations";
import { normalizeReservationParticipantList } from "../lib/reservationParticipants";

export type ReservationsWindow = { startDate: string; endDate: string } | null;

const parseNumeric = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
};

const parseMinutesValue = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : null;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const timeMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return hour * 60 + minute;
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric);
};

const parseDurationMinutes = (
  data: Partial<Reservation> & Record<string, unknown>,
  startMinutes: number
): number => {
  const durationMinutes = parseNumeric(data.durationMinutes);
  if (durationMinutes !== null && durationMinutes > 0) return Math.round(durationMinutes);

  const endMinutes = parseMinutesValue(data.endMinutes ?? data.endTime);
  if (endMinutes !== null && endMinutes > startMinutes) {
    return Math.round(endMinutes - startMinutes);
  }

  const durationHours = parseNumeric(data.durationHours ?? data.hours);
  if (durationHours !== null && durationHours > 0) {
    return Math.round(durationHours * 60);
  }

  const duration = parseNumeric(data.duration);
  if (duration !== null && duration > 0) {
    // Legacy schema stored duration in hours.
    if (duration <= 12) return Math.round(duration * 60);
    return Math.round(duration);
  }

  return 60;
};

export function useReservations(window: ReservationsWindow = null) {
  const [reservationMap, setReservationMap] = useState<ReservationMap>({});
  const [reservationsReady, setReservationsReady] = useState<boolean>(!db);
  const [reservationsError, setReservationsError] = useState<string>("");

  useEffect(() => {
    if (!db) {
      setReservationsError("Firestore is not configured. Update your .env.");
      setReservationsReady(true);
      return;
    }

    setReservationsReady(false);
    const reservationsRef = collection(db, "reservations");
    const q = window
      ? query(
        reservationsRef,
        where("date", ">=", window.startDate),
        where("date", "<=", window.endDate)
      )
      : reservationsRef;

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const nextMap: ReservationMap = {};
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as Partial<Reservation> & Record<string, unknown>;
          const dateKey = (() => {
            const rawDate = data.date as unknown;
            if (typeof rawDate === "string") return rawDate.trim();
            if (rawDate instanceof Date) return formatDateKey(rawDate);
            if (
              rawDate &&
              typeof rawDate === "object" &&
              "toDate" in rawDate &&
              typeof (rawDate as { toDate?: unknown }).toDate === "function"
            ) {
              const dt = (rawDate as { toDate: () => Date }).toDate();
              return dt instanceof Date ? formatDateKey(dt) : "";
            }
            return "";
          })();
          const roomId = typeof data.roomId === "string"
            ? data.roomId.trim()
            : typeof data.room === "string"
              ? data.room.trim()
              : "";
          const rawTime = data.time ?? data.startMinutes ?? data.startTime;
          const time = parseMinutesValue(rawTime);
          if (!dateKey || !roomId || time === null) return;
          const kind = data.kind === "special" || data.kind === "exam" || data.kind === "closed" ? data.kind : undefined;
          const reservedPhone =
            typeof data.reservedPhone === "string"
              ? data.reservedPhone
              : typeof data.phone === "string"
                ? data.phone
                : "";
          const reservedPicture =
            typeof data.reservedPicture === "string"
              ? data.reservedPicture
              : typeof data.picture === "string"
                ? data.picture
                : "";
          const privateDescription =
            typeof data.privateDescription === "string"
              ? data.privateDescription.trim()
              : typeof data.description === "string"
                ? data.description.trim()
                : "";
          const sharedDescription =
            typeof data.sharedDescription === "string" ? data.sharedDescription.trim() : "";
          const durationMinutes = parseDurationMinutes(data, time);
          const participants = Array.isArray(data.participants)
            ? normalizeReservationParticipantList(
                (data.participants as unknown[])
                  .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
                  .map((entry) => ({
                    email: typeof entry.email === "string" ? entry.email : "",
                    status:
                      entry.status === "pending" || entry.status === "approved" || entry.status === "declined"
                        ? entry.status
                        : undefined,
                    updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0
                  })),
                typeof data.reservedEmail === "string" ? data.reservedEmail : ""
              )
            : [];
          const reservation: Reservation = {
            id: docSnap.id,
            date: dateKey,
            time,
            durationMinutes,
            roomId,
            reservedBy: data.reservedBy ?? "",
            reservedEmail: data.reservedEmail ?? "",
            ...(reservedPhone ? { reservedPhone } : {}),
            ...(reservedPicture ? { reservedPicture } : {}),
            ...(privateDescription ? { privateDescription } : {}),
            ...(sharedDescription ? { sharedDescription } : {}),
            ...(typeof data.linkedGroupId === "string" && data.linkedGroupId.trim()
              ? { linkedGroupId: data.linkedGroupId.trim() }
              : {}),
            ...(typeof data.linkedRehearsalId === "string" && data.linkedRehearsalId.trim()
              ? { linkedRehearsalId: data.linkedRehearsalId.trim() }
              : {}),
            ...(participants.length ? { participants } : {}),
            ...(Array.isArray(data.quotaParticipantEmails)
              ? {
                  quotaParticipantEmails: data.quotaParticipantEmails
                    .filter((entry): entry is string => typeof entry === "string")
                    .map((entry) => entry.trim().toLowerCase())
                    .filter(Boolean)
                }
              : {}),
            ...(kind ? { kind } : {})
          };
          if (!nextMap[reservation.date]) {
            nextMap[reservation.date] = [];
          }
          nextMap[reservation.date].push(reservation);
        });
        setReservationMap(nextMap);
        setReservationsError("");
        setReservationsReady(true);
      },
      () => {
        setReservationsError("Failed to load reservations from Firestore.");
        setReservationsReady(true);
      }
    );

    return () => unsubscribe();
  }, [window?.endDate, window?.startDate]);

  const addReservation = async (reservation: Reservation) => {
    if (!db) {
      setReservationsError("Firestore is not configured. Update your .env.");
      return false;
    }
    try {
      await setDoc(doc(db, "reservations", reservation.id), {
        ...stripUndefined(reservation as unknown as Record<string, unknown>),
        createdAt: serverTimestamp()
      });
      return true;
    } catch {
      setReservationsError("Failed to save reservation.");
      return false;
    }
  };

  const upsertReservation = async (reservation: Reservation) => {
    if (!db) {
      setReservationsError("Firestore is not configured. Update your .env.");
      return false;
    }
    try {
      await setDoc(
        doc(db, "reservations", reservation.id),
        {
          ...stripUndefined(reservation as unknown as Record<string, unknown>),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
      return true;
    } catch {
      setReservationsError("Failed to update reservation.");
      return false;
    }
  };

  const releaseReservation = async (_dateKey: string, reservationId: string) => {
    if (!db) {
      setReservationsError("Firestore is not configured. Update your .env.");
      return false;
    }
    try {
      await deleteDoc(doc(db, "reservations", reservationId));
      return true;
    } catch {
      setReservationsError("Failed to delete reservation.");
      return false;
    }
  };

  return {
    reservationMap,
    addReservation,
    upsertReservation,
    releaseReservation,
    reservationsReady,
    reservationsError
  };
}
