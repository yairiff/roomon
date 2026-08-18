import type { Reservation, ReservationMap } from "../types/reservations";
import { parseDateKey } from "./date";

export type ReservationGapViolation = {
  scope: "same-room" | "any-room";
  minMinutes: number;
  conflictingReservation: Reservation;
};

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const toAbsoluteMinutes = (dateKey: string, minutes: number) =>
  Math.floor(parseDateKey(dateKey).getTime() / 60000) + minutes;

const intervalsViolateGap = (
  start: number,
  end: number,
  otherStart: number,
  otherEnd: number,
  gapMinutes: number
) => otherStart < end + gapMinutes && otherEnd + gapMinutes > start;

export const findReservationGapViolation = ({
  reservationMap,
  dateKey,
  roomId,
  startMinutes,
  durationMinutes,
  reserverEmail,
  minMinutesSameRoom,
  minMinutesAnyRoom,
  excludeReservationId
}: {
  reservationMap: ReservationMap;
  dateKey: string;
  roomId: string;
  startMinutes: number;
  durationMinutes: number;
  reserverEmail: string;
  minMinutesSameRoom: number;
  minMinutesAnyRoom: number;
  excludeReservationId?: string;
}): ReservationGapViolation | null => {
  const sameRoomGap = Math.max(0, Math.round(Number(minMinutesSameRoom) || 0));
  const anyRoomGap = Math.max(0, Math.round(Number(minMinutesAnyRoom) || 0));
  const normalizedReserverEmail = normalizeEmail(reserverEmail || "");
  if ((!sameRoomGap && !anyRoomGap) || !normalizedReserverEmail) return null;

  const start = toAbsoluteMinutes(dateKey, startMinutes);
  const end = start + durationMinutes;
  const ownReservations = Object.values(reservationMap)
    .flat()
    .filter(
      (entry) =>
        entry.id !== excludeReservationId &&
        !entry.kind &&
        normalizeEmail(entry.reservedEmail || "") === normalizedReserverEmail
    );

  if (sameRoomGap) {
    const conflictingReservation = ownReservations.find((entry) => {
      if (entry.roomId !== roomId) return false;
      const otherStart = toAbsoluteMinutes(entry.date, entry.time);
      const otherEnd = otherStart + entry.durationMinutes;
      return intervalsViolateGap(start, end, otherStart, otherEnd, sameRoomGap);
    });
    if (conflictingReservation) {
      return { scope: "same-room", minMinutes: sameRoomGap, conflictingReservation };
    }
  }

  if (anyRoomGap) {
    const conflictingReservation = ownReservations.find((entry) => {
      const otherStart = toAbsoluteMinutes(entry.date, entry.time);
      const otherEnd = otherStart + entry.durationMinutes;
      return intervalsViolateGap(start, end, otherStart, otherEnd, anyRoomGap);
    });
    if (conflictingReservation) {
      return { scope: "any-room", minMinutes: anyRoomGap, conflictingReservation };
    }
  }

  return null;
};
