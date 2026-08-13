import type { Reservation, ReservationMap } from "../types/reservations";
import { parseDateKey } from "./date";
import { getReservationUsageShareForEmail, normalizeEmailList } from "./quotaUsage";

export type ReservationGapViolation = {
  scope: "room" | "total";
  minMinutes: number;
  conflictingReservation: Reservation;
};

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
  participantEmails,
  minMinutesPerRoom,
  minMinutesTotal,
  excludeReservationId
}: {
  reservationMap: ReservationMap;
  dateKey: string;
  roomId: string;
  startMinutes: number;
  durationMinutes: number;
  participantEmails: string[];
  minMinutesPerRoom: number;
  minMinutesTotal: number;
  excludeReservationId?: string;
}): ReservationGapViolation | null => {
  const roomGap = Math.max(0, Math.round(Number(minMinutesPerRoom) || 0));
  const totalGap = Math.max(0, Math.round(Number(minMinutesTotal) || 0));
  if (!roomGap && !totalGap) return null;

  const activeEmails = normalizeEmailList(participantEmails);
  const start = toAbsoluteMinutes(dateKey, startMinutes);
  const end = start + durationMinutes;
  const reservations = Object.values(reservationMap).flat();

  if (roomGap) {
    const conflictingReservation = reservations.find((entry) => {
      if (entry.id === excludeReservationId || entry.roomId !== roomId) return false;
      const otherStart = toAbsoluteMinutes(entry.date, entry.time);
      const otherEnd = otherStart + entry.durationMinutes;
      return intervalsViolateGap(start, end, otherStart, otherEnd, roomGap);
    });
    if (conflictingReservation) {
      return { scope: "room", minMinutes: roomGap, conflictingReservation };
    }
  }

  if (totalGap && activeEmails.length) {
    const conflictingReservation = reservations.find((entry) => {
      if (entry.id === excludeReservationId || entry.kind) return false;
      if (!activeEmails.some((email) => getReservationUsageShareForEmail(entry, email) > 0)) return false;
      const otherStart = toAbsoluteMinutes(entry.date, entry.time);
      const otherEnd = otherStart + entry.durationMinutes;
      return intervalsViolateGap(start, end, otherStart, otherEnd, totalGap);
    });
    if (conflictingReservation) {
      return { scope: "total", minMinutes: totalGap, conflictingReservation };
    }
  }

  return null;
};
