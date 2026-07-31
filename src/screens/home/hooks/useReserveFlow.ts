import { useCallback, useMemo, useState } from "react";
import type { User } from "../../../types/auth";
import type { RoomMeta } from "../../../types/admin";
import type { DayKey, Lesson } from "../../../types/schedule";
import type { ViewMode } from "../../../types/ui";
import type { Reservation, ReservationMap, ReserveRequest } from "../../../types/reservations";
import type { ReservationPolicy, ReservationScopedPolicy } from "../../../types/settings";
import { addDays, formatDateKey, getDayKeyFromDateKey, getWeekStart, parseDateKey } from "../../../lib/date";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import { isFirebaseStorageDownloadUrl } from "../../../lib/profilePhoto";
import { getReservationUsageShareForEmail, normalizeEmailList } from "../../../lib/quotaUsage";
import { defaultWeekDayKeys } from "../../../config";
import {
  buildReservationPolicyWindowsForDays,
  getReservationPolicyDayKeys,
  getReservationPolicyWindowForSlot
} from "../../../lib/reservationPolicyWindows";
import type { ReservationPolicyWindow } from "../../../lib/reservationPolicyWindows";
import {
  buildPendingReservationParticipants,
  getApprovedParticipantEmails,
  resolveReservationParticipantStates,
  updateReservationParticipantSelection
} from "../../../lib/reservationParticipants";

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
  quotaUsage: {
    roomDayUsedMinutes: number;
    roomDayLimitMinutes: number;
    roomWeekUsedMinutes: number;
    roomWeekLimitMinutes: number;
    dayUsedMinutes: number;
    dayLimitMinutes: number;
    weekUsedMinutes: number;
    weekLimitMinutes: number;
  };
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
  showToast: (message: string, tone?: "info" | "error" | "success") => void;
  reservationMap: ReservationMap;
  roomMeta?: Record<string, RoomMeta>;
  reservationPolicy: ReservationPolicy;
  reservationPolicies: ReservationScopedPolicy[];
  allowedPolicyDayKeys?: DayKey[];
  allowedPolicyWindows?: ReservationPolicyWindow[];
  config: { startHour: number; endHour: number };
  getLessonsForDate: (dateKey: string, dayKey: DayKey) => Lesson[];
  addReservation: (reservation: Reservation) => Promise<boolean>;
  upsertReservation: (reservation: Reservation) => Promise<boolean>;
  onOptimisticCreate?: (reservation: Reservation) => void;
  onOptimisticPendingClear?: (reservationId: string) => void;
  onOptimisticRemove?: (reservationId: string) => void;
  checkExternalAvailability?: (input: {
    date: string;
    roomId: string;
    startMinutes: number;
    durationMinutes: number;
  }) => Promise<{ ok: boolean; message?: string }>;
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

const toWeekKey = (dateKey: string) => formatDateKey(getWeekStart(dateKey));

const policyMatchesSlot = (
  policy: ReservationScopedPolicy,
  input: { dateKey: string; dayKey: DayKey; startMinutes: number; roomId?: string }
) => {
  const scope = policy.scope;
  if (scope.roomIds.length) {
    if (!input.roomId || !scope.roomIds.includes(input.roomId)) return false;
  }
  if (scope.dayKeys.length && !scope.dayKeys.includes(input.dayKey)) return false;
  if (scope.dateStart && input.dateKey < scope.dateStart) return false;
  if (scope.dateEnd && input.dateKey > scope.dateEnd) return false;
  if (scope.startMinutes !== undefined && input.startMinutes < scope.startMinutes) return false;
  if (scope.endMinutes !== undefined && input.startMinutes >= scope.endMinutes) return false;
  return true;
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
  allowedPolicyDayKeys = [],
  allowedPolicyWindows,
  config,
  getLessonsForDate,
  addReservation,
  upsertReservation,
  onOptimisticCreate,
  onOptimisticPendingClear,
  onOptimisticRemove,
  checkExternalAvailability
}: UseReserveFlowArgs) {
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const currentUserEmail = useMemo(() => (currentUser?.email || "").trim().toLowerCase(), [currentUser?.email]);
  const getDraftParticipantEmails = useCallback(
    (participantEmails?: string[]) => {
      const normalized = normalizeEmailList([
        currentUserEmail,
        ...(participantEmails || [])
      ]);
      return normalized.length ? normalized : currentUserEmail ? [currentUserEmail] : [];
    },
    [currentUserEmail]
  );
  const getQuotaRequiredMinutes = useCallback(
    (durationMinutes: number, participantEmails?: string[]) => {
      const participantCount = Math.max(1, getDraftParticipantEmails(participantEmails).length);
      return durationMinutes / participantCount;
    },
    [getDraftParticipantEmails]
  );
  const policyWindows = useMemo(() => {
    if (allowedPolicyWindows?.length) return allowedPolicyWindows;
    const fallbackDays = allowedPolicyDayKeys.length ? allowedPolicyDayKeys : defaultWeekDayKeys;
    return buildReservationPolicyWindowsForDays(fallbackDays, config.startHour * 60, config.endHour * 60);
  }, [allowedPolicyDayKeys, allowedPolicyWindows, config.endHour, config.startHour]);
  const policyDayKeySet = useMemo(() => {
    const windowDayKeys = getReservationPolicyDayKeys(policyWindows);
    if (windowDayKeys.length) return new Set<DayKey>(windowDayKeys);
    const validFallbackDayKeys = allowedPolicyDayKeys.filter(
      (dayKey): dayKey is DayKey =>
        dayKey === "sun" ||
        dayKey === "mon" ||
        dayKey === "tue" ||
        dayKey === "wed" ||
        dayKey === "thu" ||
        dayKey === "fri" ||
        dayKey === "sat"
    );
    const fallback: DayKey[] = [...defaultWeekDayKeys];
    return new Set<DayKey>(validFallbackDayKeys.length ? validFallbackDayKeys : fallback);
  }, [allowedPolicyDayKeys, policyWindows]);
  const usageIndex = useMemo(() => {
    const dayTotals = new Map<string, number>();
    const weekTotals = new Map<string, number>();
    const roomDayTotals = new Map<string, number>();
    const roomWeekTotals = new Map<string, number>();
    const byReservationId = new Map<
      string,
      { dateKey: string; weekKey: string; roomId: string; usageShare: number }
    >();
    if (!currentUserEmail) {
      return { dayTotals, weekTotals, roomDayTotals, roomWeekTotals, byReservationId };
    }

    Object.entries(reservationMap).forEach(([dateKey, entries]) => {
      const weekKey = toWeekKey(dateKey);
      entries.forEach((entry) => {
        const usageShare = getReservationUsageShareForEmail(entry, currentUserEmail);
        if (usageShare <= 0) return;
        const roomDayKey = `${dateKey}::${entry.roomId}`;
        const roomWeekKey = `${weekKey}::${entry.roomId}`;
        dayTotals.set(dateKey, (dayTotals.get(dateKey) || 0) + usageShare);
        weekTotals.set(weekKey, (weekTotals.get(weekKey) || 0) + usageShare);
        roomDayTotals.set(roomDayKey, (roomDayTotals.get(roomDayKey) || 0) + usageShare);
        roomWeekTotals.set(roomWeekKey, (roomWeekTotals.get(roomWeekKey) || 0) + usageShare);
        byReservationId.set(entry.id, {
          dateKey,
          weekKey,
          roomId: entry.roomId,
          usageShare
        });
      });
    });

    return { dayTotals, weekTotals, roomDayTotals, roomWeekTotals, byReservationId };
  }, [currentUserEmail, reservationMap]);

  const getPolicyContext = useCallback(
    (dateKey: string, roomId: string, startMinutes: number) => {
      const orderedPolicies = reservationPolicies.filter((policy) => policy.enabled);
      let effectivePolicy: ReservationPolicy = { ...reservationPolicy };
      const matchedPolicies: { id: string; name: string; rules: Partial<ReservationPolicy> }[] = [];
      const dayKey = getDayKeyFromDateKey(dateKey);

      orderedPolicies.forEach((policy) => {
        if (policy.isDefault) {
          effectivePolicy = {
            ...effectivePolicy,
            ...(policy.rules as ReservationPolicy)
          };
        } else {
          if (!policyMatchesSlot(policy, { dateKey, dayKey, roomId, startMinutes })) return;
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
  const getGlobalQuotaPolicyForSlot = useCallback(
    (dateKey: string, startMinutes: number) => {
      const orderedPolicies = reservationPolicies.filter((policy) => policy.enabled);
      const dayKey = getDayKeyFromDateKey(dateKey);
      let effectivePolicy: ReservationPolicy = { ...reservationPolicy };
      let firstMatched: ReservationScopedPolicy | null = null;

      orderedPolicies.forEach((policy) => {
        if (policy.isDefault) {
          effectivePolicy = {
            ...effectivePolicy,
            ...(policy.rules as ReservationPolicy)
          };
          return;
        }
        // Progress bars represent only global personal day/week quotas.
        if (policy.scope.roomIds.length) return;
        if (!policyMatchesSlot(policy, { dateKey, dayKey, startMinutes })) return;
        if (!firstMatched) firstMatched = policy;
      });

      if (firstMatched) {
        const matchedPolicy = firstMatched as ReservationScopedPolicy;
        effectivePolicy = {
          ...effectivePolicy,
          ...(matchedPolicy.rules as Partial<ReservationPolicy>)
        };
      }

      return effectivePolicy;
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
      if (!currentUserEmail) return 0;
      const key = `${dateKey}::${roomId}`;
      let total = usageIndex.roomDayTotals.get(key) || 0;
      if (excludeReservationId) {
        const excluded = usageIndex.byReservationId.get(excludeReservationId);
        if (excluded && excluded.dateKey === dateKey && excluded.roomId === roomId) {
          total -= excluded.usageShare;
        }
      }
      return Math.max(0, total);
    },
    [currentUserEmail, usageIndex.byReservationId, usageIndex.roomDayTotals]
  );

  const getUserReservedMinutesForDate = useCallback(
    (dateKey: string, excludeReservationId?: string) => {
      if (!currentUserEmail) return 0;
      let total = usageIndex.dayTotals.get(dateKey) || 0;
      if (excludeReservationId) {
        const excluded = usageIndex.byReservationId.get(excludeReservationId);
        if (excluded && excluded.dateKey === dateKey) {
          total -= excluded.usageShare;
        }
      }
      return Math.max(0, total);
    },
    [currentUserEmail, usageIndex.byReservationId, usageIndex.dayTotals]
  );

  const getUserReservedMinutesForRoomWeek = useCallback(
    (dateKey: string, roomId: string, excludeReservationId?: string) => {
      if (!currentUserEmail) return 0;
      const weekKey = toWeekKey(dateKey);
      const key = `${weekKey}::${roomId}`;
      let total = usageIndex.roomWeekTotals.get(key) || 0;
      if (excludeReservationId) {
        const excluded = usageIndex.byReservationId.get(excludeReservationId);
        if (excluded && excluded.weekKey === weekKey && excluded.roomId === roomId) {
          total -= excluded.usageShare;
        }
      }
      return Math.max(0, total);
    },
    [currentUserEmail, usageIndex.byReservationId, usageIndex.roomWeekTotals]
  );

  const getUserReservedMinutesForWeek = useCallback(
    (dateKey: string, excludeReservationId?: string) => {
      if (!currentUserEmail) return 0;
      const weekKey = toWeekKey(dateKey);
      let total = usageIndex.weekTotals.get(weekKey) || 0;
      if (excludeReservationId) {
        const excluded = usageIndex.byReservationId.get(excludeReservationId);
        if (excluded && excluded.weekKey === weekKey) {
          total -= excluded.usageShare;
        }
      }
      return Math.max(0, total);
    },
    [currentUserEmail, usageIndex.byReservationId, usageIndex.weekTotals]
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

  const getPolicyDayViolationMessage = useCallback(
    (dateKey: string, dayKey?: DayKey) => {
      const resolvedDayKey = dayKey || getDayKeyFromDateKey(dateKey);
      if (policyDayKeySet.has(resolvedDayKey)) return null;
      return "לא ניתן לשריין ביום הזה לפי מדיניות המערכת.";
    },
    [policyDayKeySet]
  );

  const getPolicyWindowViolationMessage = useCallback(
    (
      dateKey: string,
      dayKey: DayKey,
      roomId: string,
      startMinutes: number,
      durationMinutes: number
    ) => {
      const dayMessage = getPolicyDayViolationMessage(dateKey, dayKey);
      if (dayMessage) return dayMessage;
      const endMinutes = startMinutes + Math.max(MIN_DURATION, durationMinutes);
      const matchingWindow = getReservationPolicyWindowForSlot(policyWindows, {
        dateKey,
        dayKey,
        roomId,
        startMinutes,
        endMinutes
      });
      if (matchingWindow) return null;
      return "השעה מחוץ לשעות הפעילות לפי מדיניות המערכת.";
    },
    [getPolicyDayViolationMessage, policyWindows]
  );

  const getBlockReservationMessage = useCallback(
    (dateKey: string, roomId: string, startMinutes: number) => {
      const { effectivePolicy, appliedPolicyName } = getPolicyContext(dateKey, roomId, startMinutes);
      if (!effectivePolicy.blockReservations) return null;
      return appliedPolicyName
        ? `שריון חסום לפי מדיניות "${appliedPolicyName}".`
        : "השריון חסום לפי מדיניות המערכת.";
    },
    [getPolicyContext]
  );

  const getRemainingMinutes = useCallback(
    (dateKey: string, roomId: string, startMinutes: number, excludeReservationId?: string) => {
      const { effectivePolicy } = getPolicyContext(dateKey, roomId, startMinutes);
      const globalQuotaPolicy = getGlobalQuotaPolicyForSlot(dateKey, startMinutes);
      const roomUsed = getUserReservedMinutesForRoomDate(dateKey, roomId, excludeReservationId);
      const roomWeekUsed = getUserReservedMinutesForRoomWeek(dateKey, roomId, excludeReservationId);
      const dayUsed = getUserReservedMinutesForDate(dateKey, excludeReservationId);
      const weekUsed = getUserReservedMinutesForWeek(dateKey, excludeReservationId);
      const roomDayLimitMinutes = toPolicyLimitMinutes(effectivePolicy.maxHoursPerRoomPerDay);
      const roomWeekLimitMinutes = toPolicyLimitMinutes(effectivePolicy.maxHoursPerRoomPerWeek);
      const dayTotalLimitMinutes = toPolicyLimitMinutes(globalQuotaPolicy.maxHoursPerDayTotal);
      const weekTotalLimitMinutes = toPolicyLimitMinutes(globalQuotaPolicy.maxHoursPerWeekTotal);

      const roomRemaining = Math.max(0, roomDayLimitMinutes - roomUsed);
      const roomWeekRemaining = Math.max(0, roomWeekLimitMinutes - roomWeekUsed);
      const dayRemaining = Math.max(0, dayTotalLimitMinutes - dayUsed);
      const weekRemaining = Math.max(0, weekTotalLimitMinutes - weekUsed);

      return {
        effectivePolicy,
        roomUsed,
        roomWeekUsed,
        dayUsed,
        weekUsed,
        globalQuotaPolicy,
        roomDayLimitMinutes,
        roomWeekLimitMinutes,
        dayTotalLimitMinutes,
        weekTotalLimitMinutes,
        roomRemaining,
        roomWeekRemaining,
        dayRemaining,
        weekRemaining,
        effectiveRemaining: Math.max(0, Math.min(roomRemaining, roomWeekRemaining, dayRemaining, weekRemaining))
      };
    },
    [
      getPolicyContext,
      getGlobalQuotaPolicyForSlot,
      getUserReservedMinutesForDate,
      getUserReservedMinutesForRoomDate,
      getUserReservedMinutesForRoomWeek,
      getUserReservedMinutesForWeek
    ]
  );

  const getLimitViolationMessage = useCallback(
    (
      dateKey: string,
      roomId: string,
      startMinutes: number,
      requiredMinutes: number,
      excludeReservationId?: string,
      participantEmails?: string[]
    ) => {
      const remaining = getRemainingMinutes(dateKey, roomId, startMinutes, excludeReservationId);
      const quotaRequiredMinutes = getQuotaRequiredMinutes(requiredMinutes, participantEmails);
      if (remaining.roomRemaining < quotaRequiredMinutes) {
        return `מקסימום ${formatHoursLabel(remaining.effectivePolicy.maxHoursPerRoomPerDay)} שעות לחדר ביום.\nלהחרגה יש לפנות למנהל מורשה.`;
      }
      if (remaining.roomWeekRemaining < quotaRequiredMinutes) {
        return `מקסימום ${formatHoursLabel(remaining.effectivePolicy.maxHoursPerRoomPerWeek)} שעות לחדר בשבוע.\nלהחרגה יש לפנות למנהל מורשה.`;
      }
      if (remaining.dayRemaining < quotaRequiredMinutes) {
        return `מקסימום ${formatHoursLabel(remaining.globalQuotaPolicy.maxHoursPerDayTotal)} שעות ליום לכל הסטודנט.\nלהחרגה יש לפנות למנהל מורשה.`;
      }
      if (remaining.weekRemaining < quotaRequiredMinutes) {
        return `מקסימום ${formatHoursLabel(remaining.globalQuotaPolicy.maxHoursPerWeekTotal)} שעות לשבוע לכל הסטודנט.\nלהחרגה יש לפנות למנהל מורשה.`;
      }
      return null;
    },
    [getQuotaRequiredMinutes, getRemainingMinutes]
  );

  const getConcurrentReservationCount = useCallback(
    (dateKey: string, startMinutes: number, durationMinutes: number, excludeReservationId?: string) => {
      const email = (currentUser?.email || "").trim().toLowerCase();
      if (!email) return 0;
      const endMinutes = startMinutes + durationMinutes;
      return (reservationMap[dateKey] || []).filter((entry) => {
        if (entry.id === excludeReservationId) return false;
        if (getReservationUsageShareForEmail(entry, email) <= 0) return false;
        const entryEnd = entry.time + entry.durationMinutes;
        return entry.time < endMinutes && entryEnd > startMinutes;
      }).length;
    },
    [currentUser?.email, reservationMap]
  );

  const getConcurrencyViolationMessage = useCallback(
    (
      dateKey: string,
      roomId: string,
      startMinutes: number,
      durationMinutes: number,
      excludeReservationId?: string
    ) => {
      const { effectivePolicy, appliedPolicyName } = getPolicyContext(dateKey, roomId, startMinutes);
      const maxConcurrent = Math.max(1, Math.round(Number(effectivePolicy.maxConcurrentReservations) || 1));
      const overlapCount = getConcurrentReservationCount(dateKey, startMinutes, durationMinutes, excludeReservationId);
      if (overlapCount + 1 <= maxConcurrent) return null;
      return appliedPolicyName
        ? `מותר עד ${maxConcurrent} שריונים במקביל לפי מדיניות "${appliedPolicyName}".`
        : `מותר עד ${maxConcurrent} שריונים במקביל בזמן נתון.`;
    },
    [getConcurrentReservationCount, getPolicyContext]
  );

  const getCutoffViolationMessage = useCallback(
    (dateKey: string, roomId: string, startMinutes: number) => {
      const now = new Date();
      const startDate = parseDateKey(dateKey);
      startDate.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
      if (now.getTime() >= startDate.getTime()) {
        return "לא ניתן לשריין או לעדכן שריון בזמן עבר.";
      }
      const { effectivePolicy, appliedPolicyName } = getPolicyContext(dateKey, roomId, startMinutes);
      if (effectivePolicy.minLeadMode === "day_before_time" || effectivePolicy.minLeadDayBeforeEnabled) {
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
      const minStart = config.startHour * 60;
      const scheduleMaxEnd = config.endHour * 60;
      const requestStart = Math.max(request.time, minStart);
      if (requestStart >= scheduleMaxEnd) return null;

      const alignedStart = Math.ceil(requestStart / STEP) * STEP;
      const matchingWindow = getReservationPolicyWindowForSlot(policyWindows, {
        dateKey: request.date,
        dayKey: request.day,
        roomId: request.roomId,
        startMinutes: alignedStart,
        endMinutes: alignedStart + MIN_DURATION
      });
      if (!matchingWindow) return null;
      const windowStart = Math.max(minStart, matchingWindow.startMinutes);
      const maxEnd = Math.min(scheduleMaxEnd, matchingWindow.endMinutes);
      if (alignedStart < windowStart || alignedStart + MIN_DURATION > maxEnd) return null;

      const { effectivePolicy } = getPolicyContext(request.date, request.roomId, alignedStart);
      if (effectivePolicy.blockReservations) return null;
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
      const participantCount = excludeReservationId
        ? Math.max(1, getDraftParticipantEmails(request.participantEmails).length)
        : 1;
      const effectiveRemainingDuration = remaining.effectiveRemaining * participantCount;
      if (windowDuration < MIN_DURATION || effectiveRemainingDuration < MIN_DURATION) return null;
      const currentDayUsed = getUserReservedMinutesForDate(request.date, excludeReservationId);
      const currentWeekUsed = getUserReservedMinutesForWeek(request.date, excludeReservationId);
      const globalQuotaPolicy = getGlobalQuotaPolicyForSlot(request.date, alignedStart);

      let availableWindowStart = windowStart;
      for (const interval of intervals) {
        if (interval.end <= alignedStart && interval.end > availableWindowStart) {
          availableWindowStart = interval.end;
        }
      }
      const alignedWindowStart = Math.ceil(availableWindowStart / STEP) * STEP;
      if (alignedWindowStart >= alignedLimitEnd) return null;

      return {
        limitEnd: alignedLimitEnd,
        startMinutes: alignedStart,
        windowStart: alignedWindowStart,
        userRemainingMinutes: effectiveRemainingDuration,
        effectivePolicy: remaining.effectivePolicy,
        globalQuotaPolicy,
        quotaUsage: {
          roomDayUsedMinutes: Math.max(0, remaining.roomUsed),
          roomDayLimitMinutes: remaining.roomDayLimitMinutes,
          roomWeekUsedMinutes: Math.max(0, remaining.roomWeekUsed),
          roomWeekLimitMinutes: remaining.roomWeekLimitMinutes,
          dayUsedMinutes: Math.max(0, currentDayUsed),
          dayLimitMinutes: toPolicyLimitMinutes(globalQuotaPolicy.maxHoursPerDayTotal),
          weekUsedMinutes: Math.max(0, currentWeekUsed),
          weekLimitMinutes: toPolicyLimitMinutes(globalQuotaPolicy.maxHoursPerWeekTotal)
        }
      };
    },
    [
      buildIntervals,
      config.endHour,
      config.startHour,
      getGlobalQuotaPolicyForSlot,
      getPolicyContext,
      getDraftParticipantEmails,
      getRemainingMinutes,
      getUserReservedMinutesForDate,
      getUserReservedMinutesForWeek,
      policyWindows
    ]
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
    (request: ReserveRequest, options?: { keepCurrentView?: boolean }) => {
      if (!currentUser?.allowed) {
        setAuthError("יש להתחבר עם חשבון סטודנט מאושר.");
        return;
      }

      const requestedDuration = Math.max(
        MIN_DURATION,
        Math.floor((request.durationMinutes || MIN_DURATION) / STEP) * STEP || MIN_DURATION
      );
      const policyWindowMessage = getPolicyWindowViolationMessage(
        request.date,
        request.day,
        request.roomId,
        request.time,
        requestedDuration
      );
      if (policyWindowMessage) {
        showToast(policyWindowMessage);
        return;
      }

      const blockedMessage = getBlockReservationMessage(request.date, request.roomId, request.time);
      if (blockedMessage) {
        showToast(blockedMessage);
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

      const requestedLimitMessage = getLimitViolationMessage(
        request.date,
        request.roomId,
        request.time,
        requestedDuration,
        undefined,
        undefined
      );
      if (requestedLimitMessage) {
        showToast(requestedLimitMessage);
      }

      const availability = getAvailability(request);
      if (!availability) {
        const minimumLimitMessage = getLimitViolationMessage(
          request.date,
          request.roomId,
          request.time,
          MIN_DURATION,
          undefined,
          undefined
        );
        if (minimumLimitMessage) {
          showToast(minimumLimitMessage);
        }
        return;
      }

      const { limitEnd, startMinutes, windowStart, userRemainingMinutes, effectivePolicy, globalQuotaPolicy, quotaUsage } = availability;
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
        limitHoursPerDayTotal: globalQuotaPolicy.maxHoursPerDayTotal,
        limitHoursPerWeekTotal: globalQuotaPolicy.maxHoursPerWeekTotal,
        limitMaxDaysForward: effectivePolicy.maxDaysForward,
        quotaUsage
      });

      if (view === "finder" && !options?.keepCurrentView) {
        openRoomDay(request.roomId, request.date);
      }
    },
    [
      currentUser?.allowed,
      getBlockReservationMessage,
      getAvailability,
      getCutoffViolationMessage,
      getForwardLimitViolationMessage,
      getLimitViolationMessage,
      getPolicyWindowViolationMessage,
      openRoomDay,
      setAuthError,
      showToast,
      view
    ]
  );

  const handleConfirmReserve = useCallback(
    async (draft: ReserveRequest, startMinutes: number, durationMinutes: number, privateDescription?: string) => {
      if (!currentUser?.allowed) return null;
      const { date, day, roomId } = draft;
      const normalizedDescription = (privateDescription || "").trim();

      if (startMinutes % STEP !== 0 || durationMinutes % STEP !== 0) {
        showToast("יש לבחור שעות במרווחים של חצי שעה.");
        return null;
      }
      if (durationMinutes < MIN_DURATION) {
        showToast("משך מינימלי הוא חצי שעה.");
        return null;
      }

      const policyWindowMessage = getPolicyWindowViolationMessage(date, day, roomId, startMinutes, durationMinutes);
      if (policyWindowMessage) {
        showToast(policyWindowMessage);
        return null;
      }

      const blockedMessage = getBlockReservationMessage(date, roomId, startMinutes);
      if (blockedMessage) {
        showToast(blockedMessage);
        return null;
      }

      const forwardMessage = getForwardLimitViolationMessage(date, roomId, startMinutes);
      if (forwardMessage) {
        showToast(forwardMessage);
        return null;
      }

      const cutoffMessage = getCutoffViolationMessage(date, roomId, startMinutes);
      if (cutoffMessage) {
        showToast(cutoffMessage);
        return null;
      }

      const roomOpen = config.startHour * 60;
      const roomClose = config.endHour * 60;
      if (startMinutes < roomOpen || startMinutes + durationMinutes > roomClose) {
        setAuthError("השעה מחוץ לשעות הפעילות של החדר.");
        return null;
      }

      const dayLessons = getLessonsForDate(date, day);
      const overlapsLesson = dayLessons.some((lesson) => {
        if (lesson.roomId !== roomId) return false;
        const lessonEnd = lesson.startMinutes + lesson.durationMinutes;
        return lesson.startMinutes < startMinutes + durationMinutes && lessonEnd > startMinutes;
      });
      if (overlapsLesson) {
        showToast("קיים שיעור חופף.");
        return null;
      }

      const overlapsReservation = (reservationMap[date] || []).some((entry) => {
        if (entry.roomId !== roomId) return false;
        const entryEnd = entry.time + entry.durationMinutes;
        return entry.time < startMinutes + durationMinutes && entryEnd > startMinutes;
      });
      if (overlapsReservation) {
        showToast("קיים שריון חופף.");
        return null;
      }

      const participants = buildPendingReservationParticipants(currentUser.email, draft.participantEmails || []);
      const quotaParticipantEmails = getApprovedParticipantEmails(participants, currentUser.email);
      const limitMessage = getLimitViolationMessage(
        date,
        roomId,
        startMinutes,
        durationMinutes,
        undefined,
        quotaParticipantEmails
      );
      if (limitMessage) {
        showToast(limitMessage);
        return null;
      }

      const concurrencyMessage = getConcurrencyViolationMessage(date, roomId, startMinutes, durationMinutes);
      if (concurrencyMessage) {
        showToast(concurrencyMessage);
        return null;
      }

      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `res-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const nextReservedPicture =
        isFirebaseStorageDownloadUrl((currentUser.picture || "").trim())
          ? (currentUser.picture || "").trim()
          : undefined;
      const nextReservation: Reservation = {
        id,
        date,
        time: startMinutes,
        durationMinutes,
        roomId,
        reservedBy: currentUser.name,
        reservedEmail: currentUser.email,
        reservedPhone: currentUser.phone || undefined,
        reservedPicture: nextReservedPicture,
        privateDescription: normalizedDescription,
        participants,
        quotaParticipantEmails
      };

      onOptimisticCreate?.(nextReservation);
      setPendingConfirm(null);
      if (view === "room" && allRooms) {
        openRoomDay(roomId, date);
      }

      if (checkExternalAvailability) {
        const external = await checkExternalAvailability({ date, roomId, startMinutes, durationMinutes });
        if (!external.ok) {
          onOptimisticRemove?.(id);
          showToast(external.message || "החדר אינו זמין במערכת החיצונית.", "error");
          return null;
        }
      }

      const ok = await addReservation(nextReservation);
      if (!ok) {
        onOptimisticRemove?.(id);
        showToast("שמירה נכשלה (בדוק הגדרות Firestore).", "error");
        return null;
      }
      onOptimisticPendingClear?.(id);
      showToast("השריון אושר ונשמר.", "success");
      return nextReservation;
    },
    [
      allRooms,
      addReservation,
      config.endHour,
      config.startHour,
      currentUser,
      getBlockReservationMessage,
      getConcurrencyViolationMessage,
      getCutoffViolationMessage,
      getForwardLimitViolationMessage,
      getDraftParticipantEmails,
      getLessonsForDate,
      getLimitViolationMessage,
      getPolicyWindowViolationMessage,
      checkExternalAvailability,
      onOptimisticCreate,
      onOptimisticPendingClear,
      onOptimisticRemove,
      openRoomDay,
      reservationMap,
      roomMeta,
      setAuthError,
      showToast,
      view
    ]
  );

  const handleEditReservation = useCallback(
    (dateKey: string, reservationId: string) => {
      if (!currentUser?.allowed) return;
      const entry = (reservationMap[dateKey] || []).find((item) => item.id === reservationId);
      if (!entry || entry.kind) return;
      if (entry.reservedEmail !== currentUser.email) return;

      const dayKey = getDayKeyFromDateKey(dateKey);
      const roomId = entry.roomId;
      const entryDurationMinutes = Math.max(MIN_DURATION, entry.durationMinutes || MIN_DURATION);
      const policyWindowMessage = getPolicyWindowViolationMessage(
        dateKey,
        dayKey,
        roomId,
        entry.time,
        entryDurationMinutes
      );
      if (policyWindowMessage) {
        showToast(policyWindowMessage);
        return;
      }

      const blockedMessage = getBlockReservationMessage(dateKey, roomId, entry.time);
      if (blockedMessage) {
        showToast(blockedMessage);
        return;
      }

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

      const matchingWindow = getReservationPolicyWindowForSlot(policyWindows, {
        dateKey,
        dayKey,
        roomId,
        startMinutes: entry.time,
        endMinutes: entry.time + entryDurationMinutes
      });
      if (!matchingWindow) return;

      const minStart = Math.max(config.startHour * 60, matchingWindow.startMinutes);
      const maxEnd = Math.min(config.endHour * 60, matchingWindow.endMinutes);

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
      const participantCount = Math.max(1, getDraftParticipantEmails(entry.quotaParticipantEmails).length);
      const effectiveRemainingDuration = remaining.effectiveRemaining * participantCount;
      if (effectiveRemainingDuration < MIN_DURATION) {
        const limitMessage = getLimitViolationMessage(
          dateKey,
          roomId,
          alignedStart,
          MIN_DURATION,
          reservationId,
          entry.quotaParticipantEmails
        );
        if (limitMessage) showToast(limitMessage);
        return;
      }
      const currentDayUsed = getUserReservedMinutesForDate(dateKey, reservationId);
      const currentWeekUsed = getUserReservedMinutesForWeek(dateKey, reservationId);
      const globalQuotaPolicy = getGlobalQuotaPolicyForSlot(dateKey, alignedStart);

      const request: ReserveRequest = {
        date: dateKey,
        day: dayKey,
        time: alignedStart,
        roomId,
        durationMinutes: entry.durationMinutes,
        privateDescription: entry.privateDescription || "",
        participantEmails: resolveReservationParticipantStates(entry)
          .filter((participant) =>
            participant.status !== "declined" && participant.email !== currentUser.email.trim().toLowerCase()
          )
          .map((participant) => participant.email)
      };

      setPendingConfirm({
        mode: "edit",
        reservationId,
        request,
        durationMinutes: Math.max(MIN_DURATION, Math.min(entry.durationMinutes, effectiveRemainingDuration)),
        limitEnd: alignedLimitEnd,
        startMinutes: alignedStart,
        windowStart: alignedWindowStart,
        userRemainingMinutes: effectiveRemainingDuration,
        privateDescription: entry.privateDescription || "",
        limitHoursPerRoomPerDay: remaining.effectivePolicy.maxHoursPerRoomPerDay,
        limitHoursPerRoomPerWeek: remaining.effectivePolicy.maxHoursPerRoomPerWeek,
        limitHoursPerDayTotal: remaining.globalQuotaPolicy.maxHoursPerDayTotal,
        limitHoursPerWeekTotal: remaining.globalQuotaPolicy.maxHoursPerWeekTotal,
        limitMaxDaysForward: remaining.effectivePolicy.maxDaysForward,
        quotaUsage: {
          roomDayUsedMinutes: Math.max(0, remaining.roomUsed),
          roomDayLimitMinutes: remaining.roomDayLimitMinutes,
          roomWeekUsedMinutes: Math.max(0, remaining.roomWeekUsed),
          roomWeekLimitMinutes: remaining.roomWeekLimitMinutes,
          dayUsedMinutes: Math.max(0, currentDayUsed),
          dayLimitMinutes: toPolicyLimitMinutes(globalQuotaPolicy.maxHoursPerDayTotal),
          weekUsedMinutes: Math.max(0, currentWeekUsed),
          weekLimitMinutes: toPolicyLimitMinutes(globalQuotaPolicy.maxHoursPerWeekTotal)
        }
      });
    },
    [
      buildIntervals,
      config.endHour,
      config.startHour,
      currentUser?.allowed,
      currentUser?.email,
      getBlockReservationMessage,
      getCutoffViolationMessage,
      getForwardLimitViolationMessage,
      getDraftParticipantEmails,
      getGlobalQuotaPolicyForSlot,
      getLimitViolationMessage,
      getPolicyWindowViolationMessage,
      getRemainingMinutes,
      getUserReservedMinutesForDate,
      getUserReservedMinutesForWeek,
      policyWindows,
      reservationMap,
      showToast
    ]
  );

  const handleConfirmEdit = useCallback(
    async (pending: PendingConfirm, startMinutes: number, durationMinutes: number, privateDescription?: string) => {
      if (!currentUser?.allowed || !pending.reservationId) return false;
      const { date, day, roomId } = pending.request;
      const reservationId = pending.reservationId;
      const normalizedDescription = (privateDescription || "").trim();

      if (startMinutes % STEP !== 0 || durationMinutes % STEP !== 0) {
        showToast("יש לבחור שעות במרווחים של חצי שעה.");
        return false;
      }
      if (durationMinutes < MIN_DURATION) {
        showToast("משך מינימלי הוא חצי שעה.");
        return false;
      }

      const policyWindowMessage = getPolicyWindowViolationMessage(date, day, roomId, startMinutes, durationMinutes);
      if (policyWindowMessage) {
        showToast(policyWindowMessage);
        return false;
      }

      const blockedMessage = getBlockReservationMessage(date, roomId, startMinutes);
      if (blockedMessage) {
        showToast(blockedMessage);
        return false;
      }

      const forwardMessage = getForwardLimitViolationMessage(date, roomId, startMinutes);
      if (forwardMessage) {
        showToast(forwardMessage);
        return false;
      }

      const cutoffMessage = getCutoffViolationMessage(date, roomId, startMinutes);
      if (cutoffMessage) {
        showToast(cutoffMessage);
        return false;
      }

      const currentEntry = (reservationMap[date] || []).find((item) => item.id === reservationId);
      if (!currentEntry || currentEntry.kind) return false;
      if (currentEntry.reservedEmail !== currentUser.email) return false;

      const roomOpen = config.startHour * 60;
      const roomClose = config.endHour * 60;
      if (startMinutes < roomOpen || startMinutes + durationMinutes > roomClose) {
        showToast("השעה מחוץ לשעות הפעילות של החדר.");
        return false;
      }

      const dayLessons = getLessonsForDate(date, day);
      const overlapsLesson = dayLessons.some((lesson) => {
        if (lesson.roomId !== roomId) return false;
        const lessonEnd = lesson.startMinutes + lesson.durationMinutes;
        return lesson.startMinutes < startMinutes + durationMinutes && lessonEnd > startMinutes;
      });
      if (overlapsLesson) {
        showToast("קיים שיעור חופף.");
        return false;
      }

      const overlapsReservation = (reservationMap[date] || []).some((entry) => {
        if (entry.id === reservationId) return false;
        if (entry.roomId !== roomId) return false;
        const entryEnd = entry.time + entry.durationMinutes;
        return entry.time < startMinutes + durationMinutes && entryEnd > startMinutes;
      });
      if (overlapsReservation) {
        showToast("קיים שמור חופף.");
        return false;
      }

      const participants = updateReservationParticipantSelection(
        currentEntry,
        pending.request.participantEmails || []
      );
      const quotaParticipantEmails = getApprovedParticipantEmails(participants, currentUser.email);
      const limitMessage = getLimitViolationMessage(
        date,
        roomId,
        startMinutes,
        durationMinutes,
        reservationId,
        quotaParticipantEmails
      );
      if (limitMessage) {
        showToast(limitMessage);
        return false;
      }

      const concurrencyMessage = getConcurrencyViolationMessage(
        date,
        roomId,
        startMinutes,
        durationMinutes,
        reservationId
      );
      if (concurrencyMessage) {
        showToast(concurrencyMessage);
        return false;
      }

      if (checkExternalAvailability) {
        const external = await checkExternalAvailability({ date, roomId, startMinutes, durationMinutes });
        if (!external.ok) {
          showToast(external.message || "החדר אינו זמין במערכת החיצונית.", "error");
          return false;
        }
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
        privateDescription: normalizedDescription,
        participants,
        quotaParticipantEmails
      });
      if (!ok) {
        showToast("שמירה נכשלה (בדוק הגדרות Firestore).", "error");
        return false;
      }
      setPendingConfirm(null);
      return true;
    },
    [
      config.endHour,
      config.startHour,
      currentUser,
      getBlockReservationMessage,
      getConcurrencyViolationMessage,
      getCutoffViolationMessage,
      getForwardLimitViolationMessage,
      getDraftParticipantEmails,
      getLessonsForDate,
      getLimitViolationMessage,
      getPolicyWindowViolationMessage,
      reservationMap,
      roomMeta,
      checkExternalAvailability,
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
