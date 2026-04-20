import { useCallback, useState } from "react";
import type { User } from "../../../types/auth";
import type { RoomMeta } from "../../../types/admin";
import type { DayKey, Lesson } from "../../../types/schedule";
import type { ViewMode } from "../../../types/ui";
import type { Reservation, ReservationMap, ReserveRequest } from "../../../types/reservations";
import type { ReservationPolicy, ReservationScopedPolicy } from "../../../types/settings";
import { addDays, formatDateKey, getDayKeyFromDateKey, getWeekStart, parseDateKey } from "../../../lib/date";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import { isFirebaseStorageDownloadUrl } from "../../../lib/profilePhoto";

const STEP = 30;
const MIN_DURATION = 30;

export type PendingConfirm = {
  mode: "create" | "edit";
  request: ReserveRequest;
  reservationId?: string;
  durationMinutes: number;
  limitEnd: number;
  startMinutes: number;
  windowStart: number;
  userRemainingMinutes: number;
  privateDescription?: string;
  limitHoursPerRoomPerDay: number;
  limitHoursPerRoomPerWeek: number;
  limitHoursPerDayTotal: number;
  limitHoursPerWeekTotal: number;
  limitMaxDaysForward: number;
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
  reservationPolicy: ReservationPolicy;
  reservationPolicies: ReservationScopedPolicy[];
  config: { startHour: number; endHour: number };
  getLessonsForDate: (dateKey: string, dayKey: DayKey) => Lesson[];
  addReservation: (reservation: Reservation) => Promise<boolean>;
  upsertReservation: (reservation: Reservation) => Promise<boolean>;
};

const toPolicyLimitMinutes = (hours: number) => {
  const numeric = Number(hours);
  if (!Number.isFinite(numeric) || numeric <= 0) return Number.POSITIVE_INFINITY;
  const raw = Math.floor(numeric * 60);
  return Math.max(0, Math.floor(raw / STEP) * STEP);
};

const formatHoursLabel = (hours: number) => {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

const toDayDelta = (fromDateKey: string, toDateKey: string) => {
  const start = parseDateKey(fromDateKey);
  const target = parseDateKey(toDateKey);
  const ms = target.getTime() - start.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
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
  reservationPolicy,
  reservationPolicies,
  config,
  getLessonsForDate,
  addReservation,
  upsertReservation
}: UseReserveFlowArgs) {
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  const getPolicyContext = useCallback(
    (dateKey: string, roomId: string, startMinutes: number) => {
      const orderedPolicies = reservationPolicies.filter((policy) => policy.enabled);
      let effectivePolicy: ReservationPolicy = { ...reservationPolicy };
      const matchedPolicies: { id: string; name: string; rules: Partial<ReservationPolicy> }[] = [];

      orderedPolicies.forEach((policy) => {
        if (policy.isDefault) {
          effectivePolicy = {
            ...effectivePolicy,
            ...(policy.rules as ReservationPolicy)
          };
        } else {
          const scope = policy.scope;
          if (scope.roomIds.length && !scope.roomIds.includes(roomId)) return;
          const dayKey = getDayKeyFromDateKey(dateKey);
          if (scope.dayKeys.length && !scope.dayKeys.includes(dayKey)) return;
          if (scope.dateStart && dateKey < scope.dateStart) return;
          if (scope.dateEnd && dateKey > scope.dateEnd) return;
          if (scope.startMinutes !== undefined && startMinutes < scope.startMinutes) return;
          if (scope.endMinutes !== undefined && startMinutes >= scope.endMinutes) return;
          matchedPolicies.push({
            id: policy.id,
            name: policy.name,
            rules: policy.rules
          });
        }
      });

      const firstMatched = matchedPolicies[0];
      if (firstMatched) {
        effectivePolicy = {
          ...effectivePolicy,
          ...firstMatched.rules
        };
      }

      return { effectivePolicy, matchedPolicies, appliedPolicyName: firstMatched?.name || "" };
    },
    [reservationPolicies, reservationPolicy]
  );

  const buildIntervals = useCallback(
    (dayKey: DayKey, dateKey: string, roomId: string, excludeReservationId?: string) => {
      const lessonIntervals = getLessonsForDate(dateKey, dayKey)
        .filter((lesson) => lesson.roomId === roomId)
        .map((lesson) => ({
          start: lesson.startMinutes,
          end: lesson.startMinutes + lesson.durationMinutes
        }));

      const reservationIntervals = (reservationMap[dateKey] || [])
        .filter((entry) => entry.roomId === roomId && entry.id !== excludeReservationId)
        .map((entry) => ({
          start: entry.time,
          end: entry.time + entry.durationMinutes
        }));

      return [...lessonIntervals, ...reservationIntervals];
    },
    [getLessonsForDate, reservationMap]
  );

  const getUserReservedMinutesForRoomDate = useCallback(
    (dateKey: string, roomId: string, excludeReservationId?: string) => {
      if (!currentUser?.email) return 0;
      return (reservationMap[dateKey] || [])
        .filter(
          (entry) =>
            entry.id !== excludeReservationId &&
            entry.roomId === roomId &&
            entry.reservedEmail === currentUser.email
        )
        .reduce((sum, entry) => sum + entry.durationMinutes, 0);
    },
    [currentUser?.email, reservationMap]
  );

  const getUserReservedMinutesForDate = useCallback(
    (dateKey: string, excludeReservationId?: string) => {
      if (!currentUser?.email) return 0;
      return (reservationMap[dateKey] || [])
        .filter((entry) => entry.id !== excludeReservationId && entry.reservedEmail === currentUser.email)
        .reduce((sum, entry) => sum + entry.durationMinutes, 0);
    },
    [currentUser?.email, reservationMap]
  );

  const getUserReservedMinutesForRoomWeek = useCallback(
    (dateKey: string, roomId: string, excludeReservationId?: string) => {
      if (!currentUser?.email) return 0;
      const weekStart = getWeekStart(dateKey);
      const weekStartKey = formatDateKey(weekStart);
      const weekEndKey = formatDateKey(addDays(weekStart, 6));
      let total = 0;
      Object.entries(reservationMap).forEach(([key, entries]) => {
        if (key < weekStartKey || key > weekEndKey) return;
        entries.forEach((entry) => {
          if (entry.id === excludeReservationId) return;
          if (entry.roomId !== roomId) return;
          if (entry.reservedEmail !== currentUser.email) return;
          total += entry.durationMinutes;
        });
      });
      return total;
    },
    [currentUser?.email, reservationMap]
  );

  const getUserReservedMinutesForWeek = useCallback(
    (dateKey: string, excludeReservationId?: string) => {
      if (!currentUser?.email) return 0;
      const weekStart = getWeekStart(dateKey);
      const weekStartKey = formatDateKey(weekStart);
      const weekEndKey = formatDateKey(addDays(weekStart, 6));
      let total = 0;
      Object.entries(reservationMap).forEach(([key, entries]) => {
        if (key < weekStartKey || key > weekEndKey) return;
        entries.forEach((entry) => {
          if (entry.id === excludeReservationId) return;
          if (entry.reservedEmail !== currentUser.email) return;
          total += entry.durationMinutes;
        });
      });
      return total;
    },
    [currentUser?.email, reservationMap]
  );

  const getForwardLimitViolationMessage = useCallback(
    (dateKey: string, roomId: string, startMinutes: number) => {
      const { effectivePolicy } = getPolicyContext(dateKey, roomId, startMinutes);
      const maxDaysForward = Math.max(0, Math.round(effectivePolicy.maxDaysForward));
      if (maxDaysForward <= 0) return null;
      const todayKey = formatDateKey(new Date());
      const delta = toDayDelta(todayKey, dateKey);
      if (delta <= maxDaysForward) return null;
      return `אפשר לשריין עד ${maxDaysForward} ימים קדימה.`;
    },
    [getPolicyContext]
  );

  const getRemainingMinutes = useCallback(
    (dateKey: string, roomId: string, startMinutes: number, excludeReservationId?: string) => {
      const { effectivePolicy } = getPolicyContext(dateKey, roomId, startMinutes);
      const roomUsed = getUserReservedMinutesForRoomDate(dateKey, roomId, excludeReservationId);
      const roomWeekUsed = getUserReservedMinutesForRoomWeek(dateKey, roomId, excludeReservationId);
      const dayUsed = getUserReservedMinutesForDate(dateKey, excludeReservationId);
      const weekUsed = getUserReservedMinutesForWeek(dateKey, excludeReservationId);
      const roomDayLimitMinutes = toPolicyLimitMinutes(effectivePolicy.maxHoursPerRoomPerDay);
      const roomWeekLimitMinutes = toPolicyLimitMinutes(effectivePolicy.maxHoursPerRoomPerWeek);
      const dayTotalLimitMinutes = toPolicyLimitMinutes(effectivePolicy.maxHoursPerDayTotal);
      const weekTotalLimitMinutes = toPolicyLimitMinutes(effectivePolicy.maxHoursPerWeekTotal);

      const roomRemaining = Math.max(0, roomDayLimitMinutes - roomUsed);
      const roomWeekRemaining = Math.max(0, roomWeekLimitMinutes - roomWeekUsed);
      const dayRemaining = Math.max(0, dayTotalLimitMinutes - dayUsed);
      const weekRemaining = Math.max(0, weekTotalLimitMinutes - weekUsed);

      return {
        effectivePolicy,
        roomRemaining,
        roomWeekRemaining,
        dayRemaining,
        weekRemaining,
        effectiveRemaining: Math.max(0, Math.min(roomRemaining, roomWeekRemaining, dayRemaining, weekRemaining))
      };
    },
    [
      getPolicyContext,
      getUserReservedMinutesForDate,
      getUserReservedMinutesForRoomDate,
      getUserReservedMinutesForRoomWeek,
      getUserReservedMinutesForWeek
    ]
  );

  const getLimitViolationMessage = useCallback(
    (dateKey: string, roomId: string, startMinutes: number, requiredMinutes: number, excludeReservationId?: string) => {
      const remaining = getRemainingMinutes(dateKey, roomId, startMinutes, excludeReservationId);
      if (remaining.roomRemaining < requiredMinutes) {
        return `מקסימום ${formatHoursLabel(remaining.effectivePolicy.maxHoursPerRoomPerDay)} שעות לחדר ביום.\nלהחרגה יש לפנות למנהל מורשה.`;
      }
      if (remaining.roomWeekRemaining < requiredMinutes) {
        return `מקסימום ${formatHoursLabel(remaining.effectivePolicy.maxHoursPerRoomPerWeek)} שעות לחדר בשבוע.\nלהחרגה יש לפנות למנהל מורשה.`;
      }
      if (remaining.dayRemaining < requiredMinutes) {
        return `מקסימום ${formatHoursLabel(remaining.effectivePolicy.maxHoursPerDayTotal)} שעות ליום לכל הסטודנט.\nלהחרגה יש לפנות למנהל מורשה.`;
      }
      if (remaining.weekRemaining < requiredMinutes) {
        return `מקסימום ${formatHoursLabel(remaining.effectivePolicy.maxHoursPerWeekTotal)} שעות לשבוע לכל הסטודנט.\nלהחרגה יש לפנות למנהל מורשה.`;
      }
      return null;
    },
    [getRemainingMinutes]
  );

  const getCutoffViolationMessage = useCallback(
    (dateKey: string, roomId: string, startMinutes: number) => {
      const now = new Date();
      const startDate = parseDateKey(dateKey);
      startDate.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
      const { effectivePolicy, appliedPolicyName } = getPolicyContext(dateKey, roomId, startMinutes);
      if (effectivePolicy.minLeadMode === "day_before_time") {
        const deadline = addDays(parseDateKey(dateKey), -1);
        const minutes = Math.max(0, Math.min(23 * 60 + 59, effectivePolicy.minLeadDayBeforeMinutes));
        deadline.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
        if (now.getTime() <= deadline.getTime()) return null;
        return appliedPolicyName
          ? `שריון לסלוט הזה נסגר ביום שלפני בשעה ${formatMinutes(minutes)} לפי מדיניות "${appliedPolicyName}".`
          : `שריון לסלוט הזה נסגר ביום שלפני בשעה ${formatMinutes(minutes)}.`;
      }

      const leadHours = Math.max(0, effectivePolicy.minLeadHours);
      if (leadHours <= 0) return null;
      const deadline = new Date(startDate.getTime() - leadHours * 60 * 60 * 1000);
      if (now.getTime() <= deadline.getTime()) return null;
      return appliedPolicyName
        ? `שריון לסלוט הזה נסגר ${formatHoursLabel(leadHours)} שעות לפני תחילתו לפי מדיניות "${appliedPolicyName}".`
        : `שריון לסלוט הזה נסגר ${formatHoursLabel(leadHours)} שעות לפני תחילתו.`;
    },
    [getPolicyContext]
  );

  const getAvailability = useCallback(
    (request: ReserveRequest, excludeReservationId?: string) => {
      const intervals = buildIntervals(request.day, request.date, request.roomId, excludeReservationId);
      const roomPolicy = roomMeta?.[request.roomId];

      const minStart = roomPolicy?.openMinutes ?? config.startHour * 60;
      const maxEnd = roomPolicy?.closeMinutes ?? config.endHour * 60;
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
      const remaining = getRemainingMinutes(request.date, request.roomId, alignedStart, excludeReservationId);
      if (windowDuration < MIN_DURATION || remaining.effectiveRemaining < MIN_DURATION) return null;

      let windowStart = minStart;
      for (const interval of intervals) {
        if (interval.end <= alignedStart && interval.end > windowStart) {
          windowStart = interval.end;
        }
      }
      const alignedWindowStart = Math.ceil(windowStart / STEP) * STEP;
      if (alignedWindowStart >= alignedLimitEnd) return null;

      return {
        limitEnd: alignedLimitEnd,
        startMinutes: alignedStart,
        windowStart: alignedWindowStart,
        userRemainingMinutes: remaining.effectiveRemaining,
        effectivePolicy: remaining.effectivePolicy
      };
    },
    [buildIntervals, config.endHour, config.startHour, getRemainingMinutes, roomMeta]
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
      if (!currentUser?.allowed) {
        setAuthError("יש להתחבר עם חשבון סטודנט מאושר.");
        return;
      }

      const forwardMessage = getForwardLimitViolationMessage(request.date, request.roomId, request.time);
      if (forwardMessage) {
        showToast(forwardMessage);
        return;
      }

      const cutoffMessage = getCutoffViolationMessage(request.date, request.roomId, request.time);
      if (cutoffMessage) {
        showToast(cutoffMessage);
        return;
      }

      const limitMessage = getLimitViolationMessage(request.date, request.roomId, request.time, MIN_DURATION);
      if (limitMessage) {
        showToast(limitMessage);
        return;
      }

      const availability = getAvailability(request);
      if (!availability) return;

      const { limitEnd, startMinutes, windowStart, userRemainingMinutes, effectivePolicy } = availability;
      const windowDuration = limitEnd - startMinutes;
      const maxDuration = Math.min(windowDuration, userRemainingMinutes);
      if (maxDuration < MIN_DURATION) return;

      const baseDuration = request.durationMinutes
        ? Math.min(Math.floor(request.durationMinutes / STEP) * STEP || 60, maxDuration)
        : Math.min(60, maxDuration);
      const desiredDuration = Math.max(MIN_DURATION, Math.min(baseDuration, maxDuration));

      setPendingConfirm({
        mode: "create",
        request,
        durationMinutes: desiredDuration,
        limitEnd,
        startMinutes,
        windowStart,
        userRemainingMinutes,
        privateDescription: request.privateDescription || "",
        limitHoursPerRoomPerDay: effectivePolicy.maxHoursPerRoomPerDay,
        limitHoursPerRoomPerWeek: effectivePolicy.maxHoursPerRoomPerWeek,
        limitHoursPerDayTotal: effectivePolicy.maxHoursPerDayTotal,
        limitHoursPerWeekTotal: effectivePolicy.maxHoursPerWeekTotal,
        limitMaxDaysForward: effectivePolicy.maxDaysForward
      });

      if (view === "finder") {
        openRoomDay(request.roomId, request.date);
        return;
      }
      if (view === "room" && allRooms) {
        openRoomDay(request.roomId, request.date);
      }
    },
    [
      allRooms,
      currentUser?.allowed,
      getAvailability,
      getCutoffViolationMessage,
      getForwardLimitViolationMessage,
      getLimitViolationMessage,
      openRoomDay,
      setAuthError,
      showToast,
      view
    ]
  );

  const handleConfirmReserve = useCallback(
    (draft: ReserveRequest, startMinutes: number, durationMinutes: number, privateDescription?: string) => {
      if (!currentUser?.allowed) return;
      const { date, day, roomId } = draft;
      const normalizedDescription = (privateDescription || "").trim();

      if (startMinutes % STEP !== 0 || durationMinutes % STEP !== 0) {
        showToast("יש לבחור שעות במרווחים של חצי שעה.");
        return;
      }
      if (durationMinutes < MIN_DURATION) {
        showToast("משך מינימלי הוא חצי שעה.");
        return;
      }

      const forwardMessage = getForwardLimitViolationMessage(date, roomId, startMinutes);
      if (forwardMessage) {
        showToast(forwardMessage);
        return;
      }

      const cutoffMessage = getCutoffViolationMessage(date, roomId, startMinutes);
      if (cutoffMessage) {
        showToast(cutoffMessage);
        return;
      }

      const roomPolicy = roomMeta?.[roomId];
      const roomOpen = roomPolicy?.openMinutes ?? config.startHour * 60;
      const roomClose = roomPolicy?.closeMinutes ?? config.endHour * 60;
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

      const limitMessage = getLimitViolationMessage(date, roomId, startMinutes, durationMinutes);
      if (limitMessage) {
        showToast(limitMessage);
        return;
      }

      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `res-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const nextReservedPicture =
        isFirebaseStorageDownloadUrl((currentUser.picture || "").trim())
          ? (currentUser.picture || "").trim()
          : undefined;

      void (async () => {
        const ok = await addReservation({
          id,
          date,
          time: startMinutes,
          durationMinutes,
          roomId,
          reservedBy: currentUser.name,
          reservedEmail: currentUser.email,
          reservedPhone: currentUser.phone || undefined,
          reservedPicture: nextReservedPicture,
          privateDescription: normalizedDescription
        });
        if (!ok) {
          showToast("שמירה נכשלה (בדוק הגדרות Firestore).", "error");
          return;
        }
        setPendingConfirm(null);
      })();
    },
    [
      addReservation,
      config.endHour,
      config.startHour,
      currentUser,
      getCutoffViolationMessage,
      getForwardLimitViolationMessage,
      getLessonsForDate,
      getLimitViolationMessage,
      reservationMap,
      roomMeta,
      setAuthError,
      showToast
    ]
  );

  const handleEditReservation = useCallback(
    (dateKey: string, reservationId: string) => {
      if (!currentUser?.allowed) return;
      const entry = (reservationMap[dateKey] || []).find((item) => item.id === reservationId);
      if (!entry || entry.kind) return;
      if (entry.reservedEmail !== currentUser.email) return;

      const roomId = entry.roomId;
      const forwardMessage = getForwardLimitViolationMessage(dateKey, roomId, entry.time);
      if (forwardMessage) {
        showToast(forwardMessage);
        return;
      }

      const cutoffMessage = getCutoffViolationMessage(dateKey, roomId, entry.time);
      if (cutoffMessage) {
        showToast(cutoffMessage);
        return;
      }

      const dayKey = getDayKeyFromDateKey(dateKey);
      const roomPolicy = roomMeta?.[roomId];
      const minStart = roomPolicy?.openMinutes ?? config.startHour * 60;
      const maxEnd = roomPolicy?.closeMinutes ?? config.endHour * 60;

      const intervals = buildIntervals(dayKey, dateKey, roomId, reservationId);
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

      const remaining = getRemainingMinutes(dateKey, roomId, alignedStart, reservationId);
      if (remaining.effectiveRemaining < MIN_DURATION) {
        const limitMessage = getLimitViolationMessage(dateKey, roomId, alignedStart, MIN_DURATION, reservationId);
        if (limitMessage) showToast(limitMessage);
        return;
      }

      const request: ReserveRequest = {
        date: dateKey,
        day: dayKey,
        time: alignedStart,
        roomId,
        durationMinutes: entry.durationMinutes,
        privateDescription: entry.privateDescription || ""
      };

      setPendingConfirm({
        mode: "edit",
        reservationId,
        request,
        durationMinutes: Math.max(MIN_DURATION, Math.min(entry.durationMinutes, remaining.effectiveRemaining)),
        limitEnd: alignedLimitEnd,
        startMinutes: alignedStart,
        windowStart: alignedWindowStart,
        userRemainingMinutes: remaining.effectiveRemaining,
        privateDescription: entry.privateDescription || "",
        limitHoursPerRoomPerDay: remaining.effectivePolicy.maxHoursPerRoomPerDay,
        limitHoursPerRoomPerWeek: remaining.effectivePolicy.maxHoursPerRoomPerWeek,
        limitHoursPerDayTotal: remaining.effectivePolicy.maxHoursPerDayTotal,
        limitHoursPerWeekTotal: remaining.effectivePolicy.maxHoursPerWeekTotal,
        limitMaxDaysForward: remaining.effectivePolicy.maxDaysForward
      });
    },
    [
      buildIntervals,
      config.endHour,
      config.startHour,
      currentUser?.allowed,
      currentUser?.email,
      getCutoffViolationMessage,
      getForwardLimitViolationMessage,
      getLimitViolationMessage,
      getRemainingMinutes,
      reservationMap,
      roomMeta,
      showToast
    ]
  );

  const handleConfirmEdit = useCallback(
    async (pending: PendingConfirm, startMinutes: number, durationMinutes: number, privateDescription?: string) => {
      if (!currentUser?.allowed || !pending.reservationId) return;
      const { date, day, roomId } = pending.request;
      const reservationId = pending.reservationId;
      const normalizedDescription = (privateDescription || "").trim();

      if (startMinutes % STEP !== 0 || durationMinutes % STEP !== 0) {
        showToast("יש לבחור שעות במרווחים של חצי שעה.");
        return;
      }
      if (durationMinutes < MIN_DURATION) {
        showToast("משך מינימלי הוא חצי שעה.");
        return;
      }

      const forwardMessage = getForwardLimitViolationMessage(date, roomId, startMinutes);
      if (forwardMessage) {
        showToast(forwardMessage);
        return;
      }

      const cutoffMessage = getCutoffViolationMessage(date, roomId, startMinutes);
      if (cutoffMessage) {
        showToast(cutoffMessage);
        return;
      }

      const currentEntry = (reservationMap[date] || []).find((item) => item.id === reservationId);
      if (!currentEntry || currentEntry.kind) return;
      if (currentEntry.reservedEmail !== currentUser.email) return;

      const roomPolicy = roomMeta?.[roomId];
      const roomOpen = roomPolicy?.openMinutes ?? config.startHour * 60;
      const roomClose = roomPolicy?.closeMinutes ?? config.endHour * 60;
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

      const limitMessage = getLimitViolationMessage(date, roomId, startMinutes, durationMinutes, reservationId);
      if (limitMessage) {
        showToast(limitMessage);
        return;
      }

      const ok = await upsertReservation({
        ...currentEntry,
        time: startMinutes,
        durationMinutes,
        reservedBy: currentUser.name,
        reservedEmail: currentUser.email,
        reservedPhone: currentUser.phone || currentEntry.reservedPhone || undefined,
        reservedPicture: (() => {
          const latest = (currentUser.picture || "").trim();
          if (isFirebaseStorageDownloadUrl(latest)) return latest;
          const existing = (currentEntry.reservedPicture || "").trim();
          return isFirebaseStorageDownloadUrl(existing) ? existing : undefined;
        })(),
        privateDescription: normalizedDescription
      });
      if (!ok) {
        showToast("שמירה נכשלה (בדוק הגדרות Firestore).", "error");
        return;
      }
      setPendingConfirm(null);
    },
    [
      config.endHour,
      config.startHour,
      currentUser,
      getCutoffViolationMessage,
      getForwardLimitViolationMessage,
      getLessonsForDate,
      getLimitViolationMessage,
      reservationMap,
      roomMeta,
      showToast,
      upsertReservation
    ]
  );

  const getUserReservedMinutes = useCallback(
    (dateKey: string, roomId: string) => getUserReservedMinutesForRoomDate(dateKey, roomId),
    [getUserReservedMinutesForRoomDate]
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
