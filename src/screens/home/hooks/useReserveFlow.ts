import { useCallback, useState } from "react";
import type { User } from "../../../types/auth";
import type { RoomMeta } from "../../../types/admin";
import type { DayKey, Lesson } from "../../../types/schedule";
import type { ViewMode } from "../../../types/ui";
import type { Reservation, ReservationMap, ReserveRequest } from "../../../types/reservations";
import { getDayKeyFromDateKey } from "../../../lib/date";

export type PendingConfirm = {
  mode: "create" | "edit";
  request: ReserveRequest;
  reservationId?: string;
  durationMinutes: number;
  limitEnd: number;
  startMinutes: number;
  windowStart: number;
  userRemainingMinutes: number;
};

type UseReserveFlowArgs = {
  currentUser: User | null;
  view: ViewMode;
  allRooms: boolean;
  onViewChange: (view: ViewMode) => void;
  setAllRooms: (value: boolean) => void;
  setSelectedRoom: (roomId: string) => void;
  setSelectedDate: (dateKey: string) => void;
  setRoomMode: (mode: "day" | "week") => void;
  setAuthError: (message: string) => void;
  showToast: (message: string, tone?: "info" | "error") => void;
  reservationMap: ReservationMap;
  roomMeta?: Record<string, RoomMeta>;
  config: { startHour: number; endHour: number };
  getLessonsForDate: (dateKey: string, dayKey: DayKey) => Lesson[];
  addReservation: (reservation: Reservation) => Promise<boolean>;
  upsertReservation: (reservation: Reservation) => Promise<boolean>;
};

export function useReserveFlow({
  currentUser,
  view,
  allRooms,
  onViewChange,
  setAllRooms,
  setSelectedRoom,
  setSelectedDate,
  setRoomMode,
  setAuthError,
  showToast,
  reservationMap,
  roomMeta,
  config,
  getLessonsForDate,
  addReservation,
  upsertReservation
}: UseReserveFlowArgs) {
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const buildIntervals = useCallback(
    (dayKey: DayKey, dateKey: string, roomId: string) => {
      const lessonIntervals = getLessonsForDate(dateKey, dayKey)
        .filter((lesson) => lesson.roomId === roomId)
        .map((lesson) => ({
          start: lesson.startMinutes,
          end: lesson.startMinutes + lesson.durationMinutes
        }));

      const reservationIntervals = (reservationMap[dateKey] || [])
        .filter((entry) => entry.roomId === roomId)
        .map((entry) => ({
          start: entry.time,
          end: entry.time + entry.durationMinutes
        }));

      return [...lessonIntervals, ...reservationIntervals];
    },
    [getLessonsForDate, reservationMap]
  );

  const getUserReservedMinutes = useCallback(
    (dateKey: string, roomId: string) => {
      if (!currentUser?.email) return 0;
      return (reservationMap[dateKey] || [])
        .filter((entry) => entry.roomId === roomId && entry.reservedEmail === currentUser.email)
        .reduce((sum, entry) => sum + entry.durationMinutes, 0);
    },
    [currentUser?.email, reservationMap]
  );

  const getAvailability = useCallback(
    (request: ReserveRequest) => {
      const STEP = 30;
      const MIN_DURATION = 30;
      const intervals = buildIntervals(request.day, request.date, request.roomId);
      const policy = roomMeta?.[request.roomId];
      if (policy?.isClosed) return null;
      const minStart = policy?.openMinutes ?? config.startHour * 60;
      const maxEnd = policy?.closeMinutes ?? config.endHour * 60;
      const requestStart = Math.max(request.time, minStart);
      if (requestStart >= maxEnd) return null;

      const alignedStart = Math.ceil(requestStart / STEP) * STEP;
      const overlaps = intervals.some((interval) => interval.start < alignedStart + 0.1 && interval.end > alignedStart);
      if (overlaps || alignedStart >= maxEnd) return null;

      const nextStart = intervals
        .map((interval) => interval.start)
        .filter((value) => value >= alignedStart && value < maxEnd)
        .sort((a, b) => a - b)[0];

      const limit = Math.min(nextStart ?? maxEnd, maxEnd);
      const alignedLimitEnd = Math.floor(limit / STEP) * STEP;
      if (alignedLimitEnd <= alignedStart) return null;
      const windowDuration = Math.max(0, alignedLimitEnd - alignedStart);
      const usedMinutes = getUserReservedMinutes(request.date, request.roomId);
      const userRemainingMinutes = Math.max(0, 180 - usedMinutes);
      if (windowDuration < MIN_DURATION || userRemainingMinutes < MIN_DURATION) return null;

      // Allow picking earlier starts within the same idle window.
      let windowStart = minStart;
      for (const interval of intervals) {
        if (interval.end <= alignedStart && interval.end > windowStart) {
          windowStart = interval.end;
        }
      }
      const alignedWindowStart = Math.ceil(windowStart / STEP) * STEP;
      if (alignedWindowStart >= alignedLimitEnd) return null;
      return { limitEnd: alignedLimitEnd, startMinutes: alignedStart, windowStart: alignedWindowStart, userRemainingMinutes };
    },
    [buildIntervals, config.endHour, config.startHour, getUserReservedMinutes, roomMeta]
  );

  const openRoomDay = useCallback(
    (roomId: string, dateKey: string) => {
      setAllRooms(false);
      setSelectedRoom(roomId);
      setSelectedDate(dateKey);
      setRoomMode("day");
      onViewChange("room");
    },
    [onViewChange, setAllRooms, setRoomMode, setSelectedDate, setSelectedRoom]
  );

  const handleReserve = useCallback(
    (request: ReserveRequest) => {
      const MIN_DURATION = 30;
      if (!currentUser?.allowed) {
        setAuthError("יש להתחבר עם חשבון סטודנט מאושר.");
        return;
      }

      const usedMinutes = getUserReservedMinutes(request.date, request.roomId);
      if (usedMinutes >= 180) {
        showToast("מקסימום 3 שעות לחדר ליום.\nלהחרגה יש לפנות למנהל מורשה.");
        return;
      }

      const availability = getAvailability(request);
      if (!availability) return;
      const { limitEnd, startMinutes, windowStart, userRemainingMinutes } = availability;
      const windowDuration = limitEnd - startMinutes;
      const maxDuration = Math.min(windowDuration, userRemainingMinutes, 180);
      if (maxDuration < MIN_DURATION) return;
      const baseDuration = request.durationMinutes
        ? Math.min(Math.floor(request.durationMinutes / 30) * 30 || 60, maxDuration)
        : Math.min(60, maxDuration);
      const desiredDuration = Math.max(MIN_DURATION, Math.min(baseDuration, maxDuration));
      setPendingConfirm({
        mode: "create",
        request,
        durationMinutes: desiredDuration,
        limitEnd,
        startMinutes,
        windowStart,
        userRemainingMinutes
      });
      if (view === "finder") {
        openRoomDay(request.roomId, request.date);
        return;
      }
      if (view === "room" && allRooms) {
        openRoomDay(request.roomId, request.date);
        return;
      }
    },
    [allRooms, currentUser?.allowed, getAvailability, getUserReservedMinutes, openRoomDay, setAuthError, showToast, view]
  );

  const handleConfirmReserve = useCallback(
    (draft: ReserveRequest, startMinutes: number, durationMinutes: number) => {
      const MIN_DURATION = 30;
      if (!currentUser?.allowed) return;
      const { date, day, roomId } = draft;
      if (startMinutes % 30 !== 0 || durationMinutes % 30 !== 0) {
        showToast("יש לבחור שעות במרווחים של חצי שעה.");
        return;
      }
      if (durationMinutes < MIN_DURATION) {
        showToast("משך מינימלי הוא חצי שעה.");
        return;
      }
      if (durationMinutes > 180) {
        showToast("מקסימום 3 שעות לחדר ליום.\nלהחרגה יש לפנות למנהל מורשה.");
        return;
      }

      const policy = roomMeta?.[roomId];
      if (policy?.isClosed) {
        setAuthError("החדר סגור זמנית.");
        return;
      }
      const roomOpen = policy?.openMinutes ?? config.startHour * 60;
      const roomClose = policy?.closeMinutes ?? config.endHour * 60;
      if (startMinutes < roomOpen || startMinutes + durationMinutes > roomClose) {
        setAuthError("השעה מחוץ לשעות הפעילות של החדר.");
        return;
      }

      const dayLessons = getLessonsForDate(date, day);
      const overlapsLesson = dayLessons.some((lesson) => {
        if (lesson.roomId !== roomId) return false;
        const lessonEnd = lesson.startMinutes + lesson.durationMinutes;
        return lesson.startMinutes < startMinutes + durationMinutes && lessonEnd > startMinutes;
      });

      if (overlapsLesson) {
        showToast("קיים שיעור חופף.");
        return;
      }

      const overlapsReservation = (reservationMap[date] || []).some((entry) => {
        if (entry.roomId !== roomId) return false;
        const entryEnd = entry.time + entry.durationMinutes;
        return entry.time < startMinutes + durationMinutes && entryEnd > startMinutes;
      });

      if (overlapsReservation) {
        showToast("קיים שריון חופף.");
        return;
      }

      const remainingMinutes = Math.max(0, 180 - getUserReservedMinutes(date, roomId));
      if (durationMinutes > remainingMinutes) {
        showToast("מקסימום 3 שעות לחדר ליום.\nלהחרגה יש לפנות למנהל מורשה.");
        return;
      }

      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `res-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      void (async () => {
        const ok = await addReservation({
          id,
          date,
          time: startMinutes,
          durationMinutes,
          roomId,
          reservedBy: currentUser.name,
          reservedEmail: currentUser.email
        });
        if (!ok) {
          showToast("שמירה נכשלה (בדוק הגדרות Firestore).", "error");
          return;
        }
        setPendingConfirm(null);
      })();
    },
    [addReservation, config.endHour, config.startHour, currentUser, getLessonsForDate, getUserReservedMinutes, reservationMap, roomMeta, setAuthError, showToast]
  );

  const handleEditReservation = useCallback(
    (dateKey: string, reservationId: string) => {
      if (!currentUser?.allowed) return;
      const entry = (reservationMap[dateKey] || []).find((item) => item.id === reservationId);
      if (!entry) return;
      if (entry.kind) return;
      if (entry.reservedEmail !== currentUser.email) return;

      const dayKey = getDayKeyFromDateKey(dateKey);
      const STEP = 30;
      const MIN_DURATION = 30;
      const roomId = entry.roomId;
      const policy = roomMeta?.[roomId];
      if (policy?.isClosed) {
        showToast("החדר סגור זמנית.");
        return;
      }
      const minStart = policy?.openMinutes ?? config.startHour * 60;
      const maxEnd = policy?.closeMinutes ?? config.endHour * 60;

      const lessonIntervals = getLessonsForDate(dateKey, dayKey)
        .filter((lesson) => lesson.roomId === roomId)
        .map((lesson) => ({ start: lesson.startMinutes, end: lesson.startMinutes + lesson.durationMinutes }));
      const reservationIntervals = (reservationMap[dateKey] || [])
        .filter((item) => item.roomId === roomId && item.id !== reservationId)
        .map((item) => ({ start: item.time, end: item.time + item.durationMinutes }));
      const intervals = [...lessonIntervals, ...reservationIntervals];

      const alignedStart = Math.ceil(Math.max(entry.time, minStart) / STEP) * STEP;
      const overlaps = intervals.some((interval) => interval.start < alignedStart + 0.1 && interval.end > alignedStart);
      if (overlaps || alignedStart >= maxEnd) return;

      const nextStart = intervals
        .map((interval) => interval.start)
        .filter((value) => value >= alignedStart && value < maxEnd)
        .sort((a, b) => a - b)[0];
      const limit = Math.min(nextStart ?? maxEnd, maxEnd);
      const alignedLimitEnd = Math.floor(limit / STEP) * STEP;
      if (alignedLimitEnd - alignedStart < MIN_DURATION) return;

      let windowStart = minStart;
      for (const interval of intervals) {
        if (interval.end <= alignedStart && interval.end > windowStart) {
          windowStart = interval.end;
        }
      }
      const alignedWindowStart = Math.ceil(windowStart / STEP) * STEP;

      const usedMinutes = getUserReservedMinutes(dateKey, roomId);
      const usedWithoutThis = Math.max(0, usedMinutes - entry.durationMinutes);
      const userRemainingMinutes = Math.max(0, 180 - usedWithoutThis);
      if (userRemainingMinutes < MIN_DURATION) {
        showToast("מקסימום 3 שעות לחדר ליום.\nלהחרגה יש לפנות למנהל מורשה.");
        return;
      }

      const request: ReserveRequest = {
        date: dateKey,
        day: dayKey,
        time: alignedStart,
        roomId,
        durationMinutes: entry.durationMinutes
      };
      setPendingConfirm({
        mode: "edit",
        reservationId,
        request,
        durationMinutes: Math.max(MIN_DURATION, Math.min(entry.durationMinutes, userRemainingMinutes)),
        limitEnd: alignedLimitEnd,
        startMinutes: alignedStart,
        windowStart: alignedWindowStart,
        userRemainingMinutes
      });
    },
    [config.endHour, config.startHour, currentUser?.allowed, currentUser?.email, getLessonsForDate, getUserReservedMinutes, reservationMap, roomMeta, showToast]
  );

  const handleConfirmEdit = useCallback(
    async (pending: PendingConfirm, startMinutes: number, durationMinutes: number) => {
      if (!currentUser?.allowed) return;
      if (!pending.reservationId) return;
      const { date, day, roomId } = pending.request;
      const reservationId = pending.reservationId;
      const STEP = 30;
      const MIN_DURATION = 30;
      if (startMinutes % STEP !== 0 || durationMinutes % STEP !== 0) {
        showToast("יש לבחור שעות במרווחים של חצי שעה.");
        return;
      }
      if (durationMinutes < MIN_DURATION) {
        showToast("משך מינימלי הוא חצי שעה.");
        return;
      }

      const currentEntry = (reservationMap[date] || []).find((item) => item.id === reservationId);
      if (!currentEntry) return;
      if (currentEntry.kind) return;
      if (currentEntry.reservedEmail !== currentUser.email) return;

      const policy = roomMeta?.[roomId];
      if (policy?.isClosed) {
        showToast("החדר סגור זמנית.");
        return;
      }
      const roomOpen = policy?.openMinutes ?? config.startHour * 60;
      const roomClose = policy?.closeMinutes ?? config.endHour * 60;
      if (startMinutes < roomOpen || startMinutes + durationMinutes > roomClose) {
        showToast("השעה מחוץ לשעות הפעילות של החדר.");
        return;
      }

      const dayLessons = getLessonsForDate(date, day);
      const overlapsLesson = dayLessons.some((lesson) => {
        if (lesson.roomId !== roomId) return false;
        const lessonEnd = lesson.startMinutes + lesson.durationMinutes;
        return lesson.startMinutes < startMinutes + durationMinutes && lessonEnd > startMinutes;
      });
      if (overlapsLesson) {
        showToast("קיים שיעור חופף.");
        return;
      }

      const overlapsReservation = (reservationMap[date] || []).some((entry) => {
        if (entry.id === reservationId) return false;
        if (entry.roomId !== roomId) return false;
        const entryEnd = entry.time + entry.durationMinutes;
        return entry.time < startMinutes + durationMinutes && entryEnd > startMinutes;
      });
      if (overlapsReservation) {
        showToast("קיים שמור חופף.");
        return;
      }

      const usedMinutes = getUserReservedMinutes(date, roomId);
      const usedWithoutThis = Math.max(0, usedMinutes - currentEntry.durationMinutes);
      const remainingMinutes = Math.max(0, 180 - usedWithoutThis);
      if (durationMinutes > remainingMinutes) {
        showToast("מקסימום 3 שעות לחדר ליום.\nלהחרגה יש לפנות למנהל מורשה.");
        return;
      }

      const ok = await upsertReservation({
        ...currentEntry,
        time: startMinutes,
        durationMinutes
      });
      if (!ok) {
        showToast("שמירה נכשלה (בדוק הגדרות Firestore).", "error");
        return;
      }
      setPendingConfirm(null);
    },
    [config.endHour, config.startHour, currentUser, getLessonsForDate, getUserReservedMinutes, reservationMap, roomMeta, showToast, upsertReservation]
  );

  return {
    pendingConfirm,
    setPendingConfirm,
    getUserReservedMinutes,
    getAvailability,
    handleReserve,
    handleConfirmReserve,
    handleEditReservation,
    handleConfirmEdit
  };
}
