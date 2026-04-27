import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HomeViewRouter from "./HomeViewRouter";
import ReserveConfirmOverlay from "./overlays/ReserveConfirmOverlay";
import MyScheduleAddOverlay from "./overlays/MyScheduleAddOverlay";
import ReservationDetailsOverlay from "./overlays/ReservationDetailsOverlay";
import BlockDetailsOverlay from "./overlays/BlockDetailsOverlay";
import { isFirebaseStorageDownloadUrl, isGoogleUserContentUrl } from "../../lib/profilePhoto";
import ConfirmOverlay from "./overlays/ConfirmOverlay";
import AdminEditOverlay from "./overlays/AdminEditOverlay";
import ScheduleTopBarSubtitle from "./topBar/ScheduleTopBarSubtitle";
import MyScheduleTopBarSubtitle from "./topBar/MyScheduleTopBarSubtitle";
import { useSchedule } from "../../hooks/useSchedule";
import { useLessonOverrides } from "../../hooks/useLessonOverrides";
import { useDirectoryUsers } from "../../hooks/useDirectoryUsers";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import {
  addDays,
  buildWeekDates,
  formatDateKey,
  formatShortDate,
  getDayKeyFromDateKey,
  getWeekStart,
  getWeekNumber,
  parseDateKey
} from "../../lib/date";
import { formatMinutes } from "../../lib/scheduleBuilder";
import { formatDurationLabelHe } from "../../lib/formatDurationHe";
import { applyLessonOverrides } from "../../lib/lessonOverrides";
import type { User } from "../../types/auth";
import type { Reservation, ReservationMap, ReserveRequest } from "../../types/reservations";
import type { DayKey, Lesson, TimeSlot } from "../../types/schedule";
import type { TopBarContext, ViewMode } from "../../types/ui";
import type { MySchedulePin } from "../../types/mySchedule";
import type { ReservationScopedPolicy } from "../../types/settings";
import { useMySchedulePins } from "./hooks/useMySchedulePins";
import { useReserveFlow } from "./hooks/useReserveFlow";
import { useAdminDraftFlow } from "./hooks/useAdminDraftFlow";
import { PERSONAL_PIN_ROOM_ID } from "./views/MyScheduleView";

export type HomeScreenProps = {
  currentUser: User | null;
  setAuthError: (message: string) => void;
  onContextChange?: (context: TopBarContext) => void;
  onReservationWindowChange?: (window: { startDate: string; endDate: string }) => void;
  reservationMap: ReservationMap;
  addReservation: (reservation: Reservation) => Promise<boolean>;
  upsertReservation: (reservation: Reservation) => Promise<boolean>;
  releaseReservation: (dateKey: string, reservationId: string) => Promise<boolean>;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  requestedView?: ViewMode | null;
  onRequestedViewHandled?: () => void;
  adminMode?: boolean;
};

const DEFAULT_POLICY_DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu"];

const shiftSchoolDay = (dateKey: string, delta: number, allowedDayKeys: DayKey[]) => {
  const allowed = allowedDayKeys.length ? new Set<DayKey>(allowedDayKeys) : new Set<DayKey>(DEFAULT_POLICY_DAY_KEYS);
  let next = parseDateKey(dateKey);
  do {
    next = addDays(next, delta);
  } while (!allowed.has(getDayKeyFromDateKey(formatDateKey(next))));
  return formatDateKey(next);
};

const buildDateKeysBetween = (startDate: string, endDate: string) => {
  const keys: string[] = [];
  if (!startDate || !endDate) return keys;
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (start > end) return keys;
  for (let date = start; date <= end; date = addDays(date, 1)) {
    keys.push(formatDateKey(date));
  }
  return keys;
};

const buildTimeSlotsRange = (startMinutes: number, endMinutes: number, slotMinutes: number): TimeSlot[] => {
  const safeSlot = Math.max(15, slotMinutes || 60);
  const start = Math.max(0, Math.floor(startMinutes / safeSlot) * safeSlot);
  const end = Math.min(24 * 60, Math.ceil(endMinutes / safeSlot) * safeSlot);
  const slots: TimeSlot[] = [];
  for (let minutes = start; minutes < end; minutes += safeSlot) {
    slots.push({ startMinutes: minutes, endMinutes: Math.min(end, minutes + safeSlot) });
  }
  return slots;
};

const parseTimeToMinutes = (value: string): number | null => {
  const trimmed = value.trim();
  const matched = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return null;
  const hours = Number(matched[1]);
  const minutes = Number(matched[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const normalizeSeriesText = (value: string) => value.trim().replace(/\s+/g, " ");

const lessonSeriesToken = (lesson: Pick<Lesson, "title" | "teacher" | "roomId" | "startMinutes" | "durationMinutes">) =>
  [
    normalizeSeriesText(lesson.title || ""),
    normalizeSeriesText(lesson.teacher || ""),
    lesson.roomId,
    String(lesson.startMinutes),
    String(lesson.durationMinutes)
  ].join("|");

const deriveActiveHoursFromPolicies = (
  reservationPolicies: ReservationScopedPolicy[],
  fallbackStartHour: number,
  fallbackEndHour: number
) => {
  const fallbackStart = Math.max(0, fallbackStartHour * 60);
  const fallbackEnd = Math.min(24 * 60, Math.max(fallbackStart + 60, fallbackEndHour * 60));
  const enabled = reservationPolicies.filter((policy) => policy.enabled && policy.rules.blockReservations !== true);
  if (!enabled.length) {
    return {
      startMinutes: fallbackStart,
      endMinutes: fallbackEnd,
      startHour: Math.floor(fallbackStart / 60),
      endHour: Math.ceil(fallbackEnd / 60)
    };
  }

  const ranges = enabled
    .map((policy) => {
      const scopeStart = typeof policy.scope.startMinutes === "number" ? policy.scope.startMinutes : fallbackStart;
      const scopeEnd = typeof policy.scope.endMinutes === "number" ? policy.scope.endMinutes : fallbackEnd;
      const start = Math.max(0, Math.min(24 * 60, scopeStart));
      const end = Math.max(0, Math.min(24 * 60, scopeEnd));
      if (end <= start) return null;
      return { start, end };
    })
    .filter((entry): entry is { start: number; end: number } => Boolean(entry));

  if (!ranges.length) {
    return {
      startMinutes: fallbackStart,
      endMinutes: fallbackEnd,
      startHour: Math.floor(fallbackStart / 60),
      endHour: Math.ceil(fallbackEnd / 60)
    };
  }
  const startMinutes = Math.max(0, Math.min(...ranges.map((entry) => entry.start)));
  const endMinutes = Math.min(24 * 60, Math.max(...ranges.map((entry) => entry.end)));
  return {
    startMinutes,
    endMinutes: Math.max(startMinutes + 60, endMinutes),
    startHour: Math.floor(startMinutes / 60),
    endHour: Math.max(Math.floor(startMinutes / 60) + 1, Math.ceil(endMinutes / 60))
  };
};

export default function HomeScreen({
  currentUser,
  setAuthError,
  onContextChange,
  onReservationWindowChange,
  reservationMap,
  addReservation,
  upsertReservation,
  releaseReservation,
  view,
  onViewChange,
  requestedView,
  onRequestedViewHandled,
  adminMode = false
}: HomeScreenProps) {
  const [selectedDate, setSelectedDate] = useState(() => formatDateKey(new Date()));
  const [selectedRoom, setSelectedRoom] = useState<string>("");
  const [allRooms, setAllRooms] = useState(true);
  const [roomMode, setRoomMode] = useState<"day" | "week">("day");
  const [myScheduleMode, setMyScheduleMode] = useState<"day" | "week" | "agenda">("week");
  const [myScheduleAgendaDays, setMyScheduleAgendaDays] = useState(14);
  const [now, setNow] = useState(() => new Date());
  const [pendingRelease, setPendingRelease] = useState<{ dateKey: string; reservationId: string } | null>(null);
  const [reservationDetails, setReservationDetails] = useState<{ reservation: Reservation; dateKey: string } | null>(null);
  const [blockDetails, setBlockDetails] = useState<{
    kind: "lesson" | "special" | "exam" | "closed";
    dateKey: string;
    lessonId?: string;
    roomId: string;
    startMinutes: number;
    durationMinutes: number;
    title: string;
    meta: string;
  } | null>(null);
  const [myScheduleAddDraft, setMyScheduleAddDraft] = useState<{
    request: ReserveRequest;
    roomOptions: { id: string; name: string }[];
  } | null>(null);
  const [dayTransition, setDayTransition] = useState<"" | "prev" | "next">("");
  const [toast, setToast] = useState<{ message: string; tone?: "info" | "error" | "success" } | null>(null);
  const [optimisticReservationsById, setOptimisticReservationsById] = useState<Record<string, Reservation>>({});
  const [pendingReservationIdsMap, setPendingReservationIdsMap] = useState<Record<string, true>>({});
  const prevViewRef = useRef<ViewMode>("live");
  const lastMainViewRef = useRef<ViewMode>("live");
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const lastContextKeyRef = useRef<string>("");
  const dayTransitionRafRef = useRef<number | null>(null);
  const contactCacheRef = useRef<Map<string, { name: string; phone: string; pictureUrl?: string }>>(new Map());
  const externalAvailabilityCacheRef = useRef<
    Map<string, { checkedAt: number; available: boolean; message: string }>
  >(new Map());
  const [detailsContact, setDetailsContact] = useState<{ name: string; phone: string; pictureUrl?: string } | null>(null);
  const lastWindowKeyRef = useRef<string>("");
  const [finderWindow, setFinderWindow] = useState<{ startDate: string; endDate: string }>(() => {
    const today = new Date();
    const start = formatDateKey(today);
    const end = formatDateKey(addDays(today, 6));
    return { startDate: start, endDate: end };
  });

  const openDatePicker = () => {
    if (!dateInputRef.current) return;
    const picker = dateInputRef.current as HTMLInputElement & { showPicker?: () => void };
    if (picker.showPicker) {
      picker.showPicker();
    } else {
      picker.click();
    }
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(
    () => () => {
      if (dayTransitionRafRef.current !== null) {
        window.cancelAnimationFrame(dayTransitionRafRef.current);
      }
    },
    []
  );

  const showToast = useCallback((message: string, tone: "info" | "error" | "success" = "info") => {
    setToast({ message, tone });
  }, []);

  const addOptimisticReservation = useCallback((reservation: Reservation) => {
    setOptimisticReservationsById((prev) => ({ ...prev, [reservation.id]: reservation }));
    setPendingReservationIdsMap((prev) => ({ ...prev, [reservation.id]: true }));
  }, []);

  const clearOptimisticReservationPending = useCallback((reservationId: string) => {
    setPendingReservationIdsMap((prev) => {
      if (!prev[reservationId]) return prev;
      const next = { ...prev };
      delete next[reservationId];
      return next;
    });
  }, []);

  const removeOptimisticReservation = useCallback((reservationId: string) => {
    setOptimisticReservationsById((prev) => {
      if (!prev[reservationId]) return prev;
      const next = { ...prev };
      delete next[reservationId];
      return next;
    });
    setPendingReservationIdsMap((prev) => {
      if (!prev[reservationId]) return prev;
      const next = { ...prev };
      delete next[reservationId];
      return next;
    });
  }, []);

  useEffect(() => {
    const optimisticIds = Object.keys(optimisticReservationsById);
    const pendingIds = Object.keys(pendingReservationIdsMap);
    if (!optimisticIds.length && !pendingIds.length) return;

    const persistedIds = new Set<string>();
    Object.values(reservationMap).forEach((entries) => {
      entries.forEach((entry) => persistedIds.add(entry.id));
    });
    if (!persistedIds.size) return;

    setOptimisticReservationsById((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(prev).forEach((id) => {
        if (!persistedIds.has(id)) return;
        delete next[id];
        changed = true;
      });
      return changed ? next : prev;
    });

    setPendingReservationIdsMap((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(prev).forEach((id) => {
        if (!persistedIds.has(id)) return;
        delete next[id];
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [optimisticReservationsById, pendingReservationIdsMap, reservationMap]);

  const triggerDayTransition = useCallback((direction: "prev" | "next") => {
    setDayTransition("");
    if (dayTransitionRafRef.current !== null) {
      window.cancelAnimationFrame(dayTransitionRafRef.current);
    }
    dayTransitionRafRef.current = window.requestAnimationFrame(() => {
      setDayTransition(direction);
      dayTransitionRafRef.current = null;
    });
  }, []);

  const todayDateKey = formatDateKey(now);
  const scheduleDateKey = view === "live" ? todayDateKey : selectedDate;
  const isLocked = !currentUser?.allowed;
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "moderator";
  const hasNav = Boolean(currentUser);

  const pinIdFor = useCallback(
    (pin: Pick<MySchedulePin, "kind" | "dateKey" | "roomId" | "startMinutes" | "durationMinutes" | "lessonId">) => {
      if (pin.kind === "lesson" && pin.lessonId) return `lesson:${pin.lessonId}`;
      return `${pin.kind}:${pin.dateKey}:${pin.roomId}:${pin.startMinutes}:${pin.durationMinutes}`;
    },
    []
  );

  const {
    pins: myPins,
    setPins: setMyPins,
    togglePin,
    isPinned,
    persistPins
  } = useMySchedulePins({
    email: currentUser?.email,
    pinIdFor,
    showToast: (message) => showToast(message)
  });

  const { rooms, weekDays, lessons, config, roomMeta, reservationPolicy, reservationPolicies, semesters, apiSync } = useSchedule(scheduleDateKey);
  const policyDayKeys = useMemo(() => {
    const next = weekDays.map((day) => day.key);
    if (!next.length) return DEFAULT_POLICY_DAY_KEYS;
    return Array.from(new Set(next));
  }, [weekDays]);
  const policyDayKeySet = useMemo(() => new Set<DayKey>(policyDayKeys), [policyDayKeys]);
  const activeHours = useMemo(
    () => deriveActiveHoursFromPolicies(reservationPolicies, config.startHour, config.endHour),
    [config.endHour, config.startHour, reservationPolicies]
  );
  const policyTimeSlots = useMemo(
    () => buildTimeSlotsRange(activeHours.startMinutes, activeHours.endMinutes, config.slotMinutes),
    [activeHours.endMinutes, activeHours.startMinutes, config.slotMinutes]
  );
  const overridesWeekDates = buildWeekDates(selectedDate, weekDays);
  const overridesWeekRange = {
    startDate: overridesWeekDates[0]?.dateKey || selectedDate,
    endDate: overridesWeekDates[overridesWeekDates.length - 1]?.dateKey || selectedDate
  };
  const overridesAgendaEnd = formatDateKey(addDays(parseDateKey(todayDateKey), Math.max(0, myScheduleAgendaDays - 1)));
  const overridesWindow =
    view === "live"
      ? { startDate: todayDateKey, endDate: todayDateKey }
      : view === "finder"
        ? finderWindow
        : view === "mySchedule"
          ? (myScheduleMode === "agenda"
            ? { startDate: todayDateKey, endDate: overridesAgendaEnd }
            : myScheduleMode === "day"
              ? { startDate: selectedDate, endDate: selectedDate }
              : overridesWeekRange)
          : overridesWeekRange;
  const { overridesByDate, addOverride, upsertOverride } = useLessonOverrides(overridesWindow);
  const { users } = useDirectoryUsers(adminMode && isAdmin);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const checkExternalAvailability = useCallback(
    async ({
      date,
      roomId,
      startMinutes,
      durationMinutes
    }: {
      date: string;
      roomId: string;
      startMinutes: number;
      durationMinutes: number;
    }) => {
      const endpoint = apiSync.primaryEndpoint.trim();
      if (!endpoint) return { ok: true };

      const room = rooms.find((entry) => entry.id === roomId);
      const mappedExternalId =
        room?.externalId ||
        Object.entries(apiSync.roomIdMap).find(([, localRoomId]) => localRoomId === roomId)?.[0] ||
        roomId;

      const startTime = `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`;
      const cacheKey = `${mappedExternalId}|${date}|${startTime}|${durationMinutes}`;
      const cached = externalAvailabilityCacheRef.current.get(cacheKey);
      const nowMs = Date.now();
      if (cached && nowMs - cached.checkedAt < 5 * 60 * 1000) {
        return cached.available ? { ok: true } : { ok: false, message: cached.message };
      }

      try {
        const url = new URL(endpoint);
        url.searchParams.set("resource", "availability");
        url.searchParams.set("room_id", mappedExternalId);
        url.searchParams.set("date", date);
        url.searchParams.set("start_time", startTime);
        url.searchParams.set("duration_minutes", String(durationMinutes));
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timeoutId = controller ? window.setTimeout(() => controller.abort(), 3500) : null;
        const response = await fetch(url.toString(), { method: "GET", ...(controller ? { signal: controller.signal } : {}) });
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        const payload = (await response.json().catch(() => ({}))) as {
          available?: boolean;
          message?: string;
          reason?: string | null;
          conflicts?: Array<{
            id?: string;
            subject?: string;
            teacher?: string;
            start_time?: string;
            duration_minutes?: number;
            room?: { id?: string };
          }>;
        };

        if (payload.reason === "conflict" && Array.isArray(payload.conflicts) && payload.conflicts.length) {
          await Promise.all(
            payload.conflicts.map(async (conflict, index) => {
              const conflictStart = parseTimeToMinutes(typeof conflict.start_time === "string" ? conflict.start_time : "");
              if (conflictStart === null) return;
              const conflictDurationRaw = Number(conflict.duration_minutes);
              const conflictDuration = Number.isFinite(conflictDurationRaw) && conflictDurationRaw > 0 ? Math.round(conflictDurationRaw) : 60;
              const conflictRoomExternalId = typeof conflict.room?.id === "string" ? conflict.room.id.trim() : "";
              const conflictRoomId =
                (conflictRoomExternalId && apiSync.roomIdMap[conflictRoomExternalId]) ||
                rooms.find((entry) => entry.externalId === conflictRoomExternalId)?.id ||
                roomId;
              const conflictExternalId = typeof conflict.id === "string" ? conflict.id.trim() : "";
              const overrideId = `availability-${date}-${conflictExternalId || `${conflictRoomId}-${conflictStart}-${index}`}`
                .replace(/[^\w-]+/g, "_")
                .slice(0, 220);
              await upsertOverride({
                id: overrideId,
                date,
                action: "add",
                lesson: {
                  id: `availability-${conflictExternalId || `${conflictRoomId}-${conflictStart}`}`.replace(/[^\w-]+/g, "_"),
                  title: (typeof conflict.subject === "string" && conflict.subject.trim()) || "שיעור מסונכרן",
                  teacher: (typeof conflict.teacher === "string" && conflict.teacher.trim()) || "",
                  day: getDayKeyFromDateKey(date),
                  roomId: conflictRoomId,
                  startMinutes: conflictStart,
                  durationMinutes: conflictDuration
                },
                syncSource: "api",
                externalId: conflictExternalId || undefined
              });
            })
          );
          const message = payload.message || "החדר אינו זמין לפי המערכת החיצונית.";
          externalAvailabilityCacheRef.current.set(cacheKey, {
            checkedAt: nowMs,
            available: false,
            message
          });
          const count = payload.conflicts.length;
          const conflictsLabel = count === 1 ? "נמצאה התנגשות אחת" : `נמצאו ${count} התנגשויות`;
          return { ok: false, message: `${conflictsLabel} בזמן שביקשת. היומן עודכן אוטומטית עם ההתנגשויות.` };
        }

        // Third-party availability service is temporarily unavailable.
        // Do not block or notify the user for infrastructure failures.
        if (!response.ok) {
          return { ok: true };
        }

        if (payload.available === true) {
          externalAvailabilityCacheRef.current.set(cacheKey, {
            checkedAt: nowMs,
            available: true,
            message: ""
          });
          return { ok: true };
        }

        const message = payload.message || "החדר אינו זמין לפי המערכת החיצונית.";
        externalAvailabilityCacheRef.current.set(cacheKey, {
          checkedAt: nowMs,
          available: false,
          message
        });
        return { ok: false, message };
      } catch {
        // Network/timeout/downstream outage should not block user reservations.
        return { ok: true };
      }
    },
    [apiSync, rooms, upsertOverride]
  );

  useEffect(() => {
    if (view === "room" && prevViewRef.current !== "room") {
      setRoomMode("day");
    }
    if (view === "mySchedule" && prevViewRef.current !== "mySchedule") {
      setSelectedDate(formatDateKey(new Date()));
      setMyScheduleMode("week");
      setMyScheduleAgendaDays(14);
    }
    if (view !== "mySchedule") {
      setMyScheduleAddDraft(null);
    }
    prevViewRef.current = view;
    if (view !== "mySchedule") {
      lastMainViewRef.current = view;
    }
  }, [view]);

  const effectiveAdminMode = adminMode && isAdmin;

  useEffect(() => {
    const isDailyView = view === "room" && (allRooms || roomMode === "day");
    if (isDailyView && !policyDayKeySet.has(getDayKeyFromDateKey(selectedDate))) {
      setSelectedDate(shiftSchoolDay(selectedDate, 1, policyDayKeys));
    }
  }, [allRooms, policyDayKeySet, policyDayKeys, roomMode, selectedDate, view]);

  useEffect(() => {
    if (isLocked && view !== "live") {
      onViewChange("live");
    }
  }, [isLocked, onViewChange, view]);

  useEffect(() => {
    if (!requestedView) return;
    onViewChange(requestedView);
    onRequestedViewHandled?.();
  }, [onRequestedViewHandled, onViewChange, requestedView]);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayDayKey = getDayKeyFromDateKey(todayDateKey);
  const roomsKey = useMemo(
    () => rooms.map((room) => `${room.id}:${room.shortName || room.name || ""}`).join("|"),
    [rooms]
  );

  const getSemesterForDate = useCallback(
    (dateKey: string) =>
      semesters.find((semester) => {
        if (!semester.startDate || !semester.endDate) return false;
        return dateKey >= semester.startDate && dateKey <= semester.endDate;
      }) || null,
    [semesters]
  );

  const holidayNameByDate = useMemo(() => {
    const map: Record<string, string> = {};
    semesters.forEach((semester) => {
      semester.holidays.forEach((holiday) => {
        if (!holiday?.date) return;
        const holidayName = (holiday.displayName || "").trim() || (holiday.name || "").trim();
        if (!holidayName) return;
        if (!map[holiday.date]) {
          map[holiday.date] = holidayName;
        }
      });
    });
    return map;
  }, [semesters]);

  const isStudyDateForLessons = useCallback(
    (dateKey: string, dayKey: DayKey) => {
      if (!policyDayKeySet.has(dayKey)) return false;
      const semester = getSemesterForDate(dateKey);
      if (!semester) return false;
      if (semester.holidays.some((holiday) => holiday.date === dateKey)) return false;
      return true;
    },
    [getSemesterForDate, policyDayKeySet]
  );

  const getLessonsForDate = useCallback(
    (dateKey: string, dayKey: DayKey) => {
      if (!isStudyDateForLessons(dateKey, dayKey)) return [];
      const baseLessons = lessons.filter((lesson) => lesson.day === dayKey);
      const overrides = overridesByDate[dateKey] || [];
      return applyLessonOverrides(baseLessons, overrides, dayKey);
    },
    [isStudyDateForLessons, lessons, overridesByDate]
  );

  // Best-effort migration: older "lesson" pins were date-specific; upgrade them to recurring pins
  // by matching them to a lesson id for that date (when possible).
  useEffect(() => {
    if (!myPins.length) return;
    let changed = false;
    const seen = new Set<string>();
    const nextPins: MySchedulePin[] = [];

    myPins.forEach((pin) => {
      if (pin.kind !== "lesson" || pin.lessonId) {
        const id = pin.id || pinIdFor(pin);
        if (!seen.has(id)) {
          seen.add(id);
          nextPins.push({ ...pin, id });
        }
        return;
      }
      const dayKey = getDayKeyFromDateKey(pin.dateKey);
      const match = getLessonsForDate(pin.dateKey, dayKey).find((lesson) => {
        if (lesson.roomId !== pin.roomId) return false;
        if (lesson.startMinutes !== pin.startMinutes) return false;
        if (lesson.durationMinutes !== pin.durationMinutes) return false;
        if ((lesson.title || "").trim() && (pin.title || "").trim()) {
          return lesson.title.trim() === pin.title.trim();
        }
        return true;
      });

      if (!match) {
        const id = pin.id || pinIdFor(pin);
        if (!seen.has(id)) {
          seen.add(id);
          nextPins.push({ ...pin, id });
        }
        return;
      }

      const upgraded: MySchedulePin = { ...pin, lessonId: match.id };
      const id = pinIdFor(upgraded);
      if (!seen.has(id)) {
        seen.add(id);
        nextPins.push({ ...upgraded, id });
      }
      if (id !== pin.id) changed = true;
    });

    if (!changed) return;
    setMyPins(nextPins);
  }, [getLessonsForDate, myPins, pinIdFor]);

  const selectedDayKey = useMemo(() => getDayKeyFromDateKey(selectedDate), [selectedDate]);
  const weekDates = useMemo(() => buildWeekDates(selectedDate, weekDays), [selectedDate, weekDays]);
  const weekRange = useMemo(() => {
    const first = weekDates[0]?.dateKey || selectedDate;
    const last = weekDates[weekDates.length - 1]?.dateKey || selectedDate;
    return { startDate: first, endDate: last };
  }, [selectedDate, weekDates]);
  const roomDates = useMemo(() => {
    if (roomMode === "week") return weekDates;
    const match = weekDates.filter((day) => day.key === selectedDayKey);
    if (match.length) return match;
    return [{
      key: selectedDayKey,
      label: "",
      shortDate: formatShortDate(selectedDate),
      dateKey: selectedDate
    }];
  }, [roomMode, weekDates, selectedDayKey, selectedDate]);

  const displayReservationMap = useMemo(() => {
    const optimisticReservations = Object.values(optimisticReservationsById);
    if (effectiveAdminMode && !optimisticReservations.length) return reservationMap;

    const holidayDates = Object.keys(holidayNameByDate);
    if (!holidayDates.length && !optimisticReservations.length) return reservationMap;

    const next: ReservationMap = {};
    Object.entries(reservationMap).forEach(([key, value]) => {
      next[key] = [...value];
    });

    optimisticReservations.forEach((entry) => {
      const existing = next[entry.date] ? [...next[entry.date]] : [];
      if (existing.some((item) => item.id === entry.id)) return;
      existing.push(entry);
      next[entry.date] = existing.sort((a, b) => a.time - b.time);
    });

    if (effectiveAdminMode) {
      return next;
    }

    if (holidayDates.length && rooms.length) {
      const visibleDates = new Set<string>([
        ...Object.keys(next),
        ...weekDates.map((day) => day.dateKey),
        ...roomDates.map((day) => day.dateKey),
        ...buildDateKeysBetween(finderWindow.startDate, finderWindow.endDate),
        ...buildDateKeysBetween(todayDateKey, overridesAgendaEnd),
        selectedDate,
        todayDateKey
      ]);
      visibleDates.forEach((dateKey) => {
        const holidayName = holidayNameByDate[dateKey];
        if (!holidayName) return;
        const existing = next[dateKey] ? [...next[dateKey]] : [];
        rooms.forEach((room) => {
          const id = `holiday:${dateKey}:${room.id}`;
          if (existing.some((entry) => entry.id === id)) return;
          existing.push({
            id,
            date: dateKey,
            roomId: room.id,
            time: activeHours.startMinutes,
            durationMinutes: activeHours.endMinutes - activeHours.startMinutes,
            reservedBy: holidayName,
            reservedEmail: "",
            kind: "closed"
          });
        });
        next[dateKey] = existing.sort((a, b) => a.time - b.time);
      });
    }

    return next;
  }, [
    activeHours.endMinutes,
    activeHours.startMinutes,
    effectiveAdminMode,
    finderWindow.endDate,
    finderWindow.startDate,
    holidayNameByDate,
    overridesAgendaEnd,
    optimisticReservationsById,
    reservationMap,
    roomDates,
    rooms,
    selectedDate,
    todayDateKey,
    weekDates
  ]);

  const scheduleTimeSlots = useMemo(() => {
    if (view !== "room") return policyTimeSlots;

    const relevantDates = allRooms
      ? [selectedDate]
      : roomMode === "week"
        ? roomDates.map((entry) => entry.dateKey)
        : [selectedDate];
    const relevantRoomIds = allRooms
      ? rooms.map((room) => room.id)
      : selectedRoom
        ? [selectedRoom]
        : [];

    if (!relevantDates.length || !relevantRoomIds.length) return policyTimeSlots;

    let minStart = Number.POSITIVE_INFINITY;
    let maxEnd = Number.NEGATIVE_INFINITY;

    relevantDates.forEach((dateKey) => {
      const dayKey = getDayKeyFromDateKey(dateKey);
      getLessonsForDate(dateKey, dayKey).forEach((lesson) => {
        if (!relevantRoomIds.includes(lesson.roomId)) return;
        minStart = Math.min(minStart, lesson.startMinutes);
        maxEnd = Math.max(maxEnd, lesson.startMinutes + lesson.durationMinutes);
      });
      (displayReservationMap[dateKey] || []).forEach((entry) => {
        if (!relevantRoomIds.includes(entry.roomId)) return;
        minStart = Math.min(minStart, entry.time);
        maxEnd = Math.max(maxEnd, entry.time + Math.max(30, entry.durationMinutes || 60));
      });
    });

    if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) {
      return policyTimeSlots;
    }

    const baseStart = activeHours.startMinutes;
    const baseEnd = activeHours.endMinutes;
    const start = Math.min(baseStart, minStart);
    const end = Math.max(baseEnd, maxEnd);
    const next = buildTimeSlotsRange(start, end, config.slotMinutes);
    return next.length ? next : policyTimeSlots;
  }, [
    allRooms,
    activeHours.endMinutes,
    config.slotMinutes,
    activeHours.startMinutes,
    displayReservationMap,
    getLessonsForDate,
    roomDates,
    roomMode,
    rooms,
    selectedDate,
    selectedRoom,
    policyTimeSlots,
    view
  ]);

  useEffect(() => {
    if (!onReservationWindowChange) return;
    const liveWeekStart = getWeekStart(todayDateKey);
    const liveWeekRange = {
      startDate: formatDateKey(liveWeekStart),
      endDate: formatDateKey(addDays(liveWeekStart, weekDays.length - 1))
    };
    const selectedWeekStart = getWeekStart(selectedDate);
    const selectedWeekRange = {
      startDate: formatDateKey(selectedWeekStart),
      endDate: formatDateKey(addDays(selectedWeekStart, weekDays.length - 1))
    };
    const agendaEnd = formatDateKey(addDays(parseDateKey(todayDateKey), Math.max(0, myScheduleAgendaDays - 1)));
    const desired =
      view === "live"
        ? liveWeekRange
        : view === "finder"
          ? finderWindow
          : view === "mySchedule"
            ? (myScheduleMode === "agenda"
              ? { startDate: todayDateKey, endDate: agendaEnd }
              : selectedWeekRange)
          : weekRange;

    const key = `${desired.startDate}|${desired.endDate}`;
    if (key === lastWindowKeyRef.current) return;
    lastWindowKeyRef.current = key;
    onReservationWindowChange(desired);
  }, [
    finderWindow,
    myScheduleAgendaDays,
    myScheduleMode,
    onReservationWindowChange,
    selectedDate,
    todayDateKey,
    view,
    weekDays.length,
    weekRange
  ]);

  useEffect(() => {
    if (!rooms.length) return;
    if (!selectedRoom) {
      setSelectedRoom(rooms[0].id);
      return;
    }
    const exists = rooms.some((room) => room.id === selectedRoom);
    if (!exists) {
      setSelectedRoom(rooms[0].id);
    }
  }, [rooms, selectedRoom]);

  useEffect(() => {
    if (allRooms && roomMode !== "day") {
      setRoomMode("day");
    }
  }, [allRooms, roomMode]);


  const {
    pendingConfirm,
    setPendingConfirm,
    getAvailability,
    handleReserve,
    handleConfirmReserve,
    handleEditReservation,
    handleConfirmEdit
  } = useReserveFlow({
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
    reservationMap: displayReservationMap,
    roomMeta,
    reservationPolicy,
    reservationPolicies,
    config: { startHour: activeHours.startHour, endHour: activeHours.endHour },
    getLessonsForDate,
    addReservation,
    upsertReservation,
    onOptimisticCreate: addOptimisticReservation,
    onOptimisticPendingClear: clearOptimisticReservationPending,
    onOptimisticRemove: removeOptimisticReservation,
    checkExternalAvailability
  });

  const pendingReservationIds = useMemo(
    () => Object.keys(pendingReservationIdsMap),
    [pendingReservationIdsMap]
  );

  const {
    adminDraft,
    setAdminDraft,
    adminError,
    collisionConfirm,
    handleAdminSlotClick,
    handleAdminLessonClick,
    handleAdminReservationClick,
    handleAdminSave,
    handleAdminDeleteLesson,
    handleAdminDeleteReservation,
    switchAdminType
  } = useAdminDraftFlow({
    enabled: effectiveAdminMode,
    currentUser,
    config,
    roomMeta,
    reservationMap,
    getLessonsForDate,
    addOverride,
    addReservation,
    upsertReservation,
    releaseReservation
  });

  const handleReservationDetails = (reservationId: string, dateKey: string) => {
    const reservation = (displayReservationMap[dateKey] || []).find((entry) => entry.id === reservationId);
    if (!reservation) return;
    setReservationDetails({ reservation, dateKey });
  };

  const handleLessonDetails = (lessonId: string, dateKey: string) => {
    const dayKey = getDayKeyFromDateKey(dateKey);
    const lesson = getLessonsForDate(dateKey, dayKey).find((entry) => entry.id === lessonId);
    if (!lesson) return;
    setBlockDetails({
      kind: "lesson",
      dateKey,
      lessonId: lesson.id,
      roomId: lesson.roomId,
      startMinutes: lesson.startMinutes,
      durationMinutes: lesson.durationMinutes,
      title: lesson.title,
      meta: lesson.teacher || "ללא מרצה"
    });
  };

  const handleSpecialDetails = (reservationId: string, dateKey: string) => {
    const reservation = (displayReservationMap[dateKey] || []).find((entry) => entry.id === reservationId);
    if (!reservation) return;
    setBlockDetails({
      kind: "special",
      dateKey,
      roomId: reservation.roomId,
      startMinutes: reservation.time,
      durationMinutes: reservation.durationMinutes,
      title: reservation.reservedBy || "אירוע",
      meta: ""
    });
  };

  const handleExamDetails = (reservationId: string, dateKey: string) => {
    const reservation = (displayReservationMap[dateKey] || []).find((entry) => entry.id === reservationId);
    if (!reservation) return;
    setBlockDetails({
      kind: "exam",
      dateKey,
      roomId: reservation.roomId,
      startMinutes: reservation.time,
      durationMinutes: reservation.durationMinutes,
      title: reservation.reservedBy || "מבחן",
      meta: ""
    });
  };

  const handleClosedDetails = (reservationId: string, dateKey: string) => {
    const reservation = (displayReservationMap[dateKey] || []).find((entry) => entry.id === reservationId);
    if (!reservation) return;
    setBlockDetails({
      kind: "closed",
      dateKey,
      roomId: reservation.roomId,
      startMinutes: reservation.time,
      durationMinutes: reservation.durationMinutes,
      title: reservation.reservedBy || "סגור",
      meta: ""
    });
  };


  const handleRelease = (dateKey: string, reservationId: string) => {
    setPendingRelease({ dateKey, reservationId });
  };

  const handleRoomSelect = (roomId: string, dateKey = selectedDate) => {
    setAllRooms(false);
    setSelectedRoom(roomId);
    setSelectedDate(dateKey);
    setRoomMode("day");
    onViewChange("room");
  };

  const handleDaySelect = (dateKey: string) => {
    setSelectedDate(dateKey);
    setRoomMode("day");
    onViewChange("room");
  };

  const handlePrev = useCallback(() => {
    if (view === "mySchedule") {
      if (myScheduleMode === "agenda") return;
      triggerDayTransition("prev");
      if (myScheduleMode === "week") {
        setSelectedDate(formatDateKey(addDays(parseDateKey(selectedDate), -7)));
        return;
      }
      setSelectedDate(shiftSchoolDay(selectedDate, -1, policyDayKeys));
      return;
    }
    if (view === "room") {
      triggerDayTransition("prev");
      const isAllRooms = allRooms;
      if (!isAllRooms && roomMode === "week") {
        const delta = -7;
        setSelectedDate(formatDateKey(addDays(parseDateKey(selectedDate), delta)));
        return;
      }
      setSelectedDate(shiftSchoolDay(selectedDate, -1, policyDayKeys));
      return;
    }
    triggerDayTransition("prev");
    setSelectedDate(shiftSchoolDay(selectedDate, -1, policyDayKeys));
  }, [allRooms, myScheduleMode, policyDayKeys, roomMode, selectedDate, triggerDayTransition, view]);

  const handleNext = useCallback(() => {
    if (view === "mySchedule") {
      if (myScheduleMode === "agenda") return;
      triggerDayTransition("next");
      if (myScheduleMode === "week") {
        setSelectedDate(formatDateKey(addDays(parseDateKey(selectedDate), 7)));
        return;
      }
      setSelectedDate(shiftSchoolDay(selectedDate, 1, policyDayKeys));
      return;
    }
    if (view === "room") {
      triggerDayTransition("next");
      const isAllRooms = allRooms;
      if (!isAllRooms && roomMode === "week") {
        const delta = 7;
        setSelectedDate(formatDateKey(addDays(parseDateKey(selectedDate), delta)));
        return;
      }
      setSelectedDate(shiftSchoolDay(selectedDate, 1, policyDayKeys));
      return;
    }
    triggerDayTransition("next");
    setSelectedDate(shiftSchoolDay(selectedDate, 1, policyDayKeys));
  }, [allRooms, myScheduleMode, policyDayKeys, roomMode, selectedDate, triggerDayTransition, view]);

  useEffect(() => {
    if (!onContextChange) return;
    const liveClockKey = view === "live"
      ? now.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
      : "";
    const contextKey = [
      view,
      roomMode,
      myScheduleMode,
      allRooms ? "all" : "single",
      selectedDate,
      selectedRoom,
      roomsKey,
      liveClockKey
    ].join("::");
    if (lastContextKeyRef.current === contextKey) {
      return;
    }
    lastContextKeyRef.current = contextKey;
    const titles: Record<ViewMode, string> = {
      live: "עכשיו",
      room: "לוח זמנים",
      finder: "איתור חדרים",
      mySchedule: "המערכת שלי"
    };

    const dayLabel = weekDays.find((day) => day.key === selectedDayKey)?.label || "";
    const shortDate = formatShortDate(selectedDate);
    const tomorrowDateKey = formatDateKey(addDays(parseDateKey(todayDateKey), 1));
    const relativeDayLabel =
      selectedDate === todayDateKey
        ? "היום"
        : selectedDate === tomorrowDateKey
          ? "מחר"
          : dayLabel;
    const navText = view === "room" && roomMode === "week" && !allRooms
      ? `שבוע ${getWeekNumber(selectedDate)}`
      : `${relativeDayLabel} · ${shortDate}`;

    const context: TopBarContext = {
      title: titles[view]
    };

    if (view === "room") {
      context.subtitle = (
        <ScheduleTopBarSubtitle
          rooms={rooms}
          selectedRoom={selectedRoom}
          allRooms={allRooms}
          roomMode={roomMode}
          selectedDate={selectedDate}
          navText={navText}
          onPrev={handlePrev}
          onNext={handleNext}
          onOpenDatePicker={openDatePicker}
          dateInputRef={dateInputRef}
          setAllRooms={setAllRooms}
          setRoomMode={setRoomMode}
          setSelectedRoom={setSelectedRoom}
          setSelectedDate={setSelectedDate}
        />
      );
    } else if (view === "finder") {
      context.subtitle = "איתור חדרים פנויים לפי ההעדפות שלי";
    } else if (view === "mySchedule") {
      context.subtitle = (
        <MyScheduleTopBarSubtitle
          myScheduleMode={myScheduleMode}
          setMyScheduleMode={setMyScheduleMode}
          selectedDate={selectedDate}
          navText={navText}
          weekDates={weekDates}
          onPrev={handlePrev}
          onNext={handleNext}
          onOpenDatePicker={openDatePicker}
          dateInputRef={dateInputRef}
          setSelectedDate={setSelectedDate}
        />
      );
    } else if (view === "live") {
      const today = parseDateKey(todayDateKey);
      const weekdayLabel = new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(today);
      const dateLabel = new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit" }).format(today);
      const todayReservations = displayReservationMap[todayDateKey] || [];
      const isWeekend = today.getDay() === 5 || today.getDay() === 6;
      const isClosedNow = isWeekend || nowMinutes < activeHours.startMinutes || nowMinutes >= activeHours.endMinutes;
      const todayLessons = getLessonsForDate(todayDateKey, todayDayKey);
      const reservationDuration = (durationMinutes: number | undefined) => {
        const numeric = Number(durationMinutes);
        return Number.isFinite(numeric) && numeric > 0 ? numeric : 60;
      };

      const availableCount = rooms.filter((room) => {
        if (isClosedNow || nowMinutes < activeHours.startMinutes || nowMinutes >= activeHours.endMinutes) return false;
        const activeLesson = todayLessons.some((lesson) => {
          if (lesson.roomId !== room.id) return false;
          return lesson.startMinutes <= nowMinutes && lesson.startMinutes + lesson.durationMinutes > nowMinutes;
        });
        if (activeLesson) return false;
        const activeReservation = todayReservations.some((entry) => {
          if (entry.roomId !== room.id) return false;
          return entry.time <= nowMinutes && entry.time + reservationDuration(entry.durationMinutes) > nowMinutes;
        });
        return !activeReservation;
      }).length;

      context.subtitle = (
        <div className="top-bar-live">
          <div className="top-bar-live-clock">{liveClockKey}</div>
          <div className="top-bar-live-date">{weekdayLabel} · {dateLabel}</div>
          <div className="top-bar-live-summary">
            {isClosedNow ? "סגור עכשיו" : `חדרים זמינים עכשיו: ${availableCount}/${rooms.length}`}
          </div>
        </div>
      );
    }

    onContextChange(context);
  }, [
    onContextChange,
    rooms,
    selectedRoom,
    allRooms,
    view,
    roomMode,
    myScheduleMode,
    selectedDate,
    selectedDayKey,
    weekDays,
    weekDates,
    roomsKey,
    handlePrev,
    handleNext,
    onViewChange,
    now,
    nowMinutes,
    todayDateKey,
    todayDayKey,
    displayReservationMap,
    getLessonsForDate,
    activeHours.startMinutes,
    activeHours.endMinutes,
    roomMeta
  ]);

  const handleOpenPinned = useCallback((pin: MySchedulePin) => {
    if (pin.kind === "reservation") {
      const reservedBy = pin.title === "שמור" ? (pin.meta || "שמור") : (pin.title || pin.meta || "שמור");
      setReservationDetails({
        dateKey: pin.dateKey,
        reservation: {
          id: pin.id,
          date: pin.dateKey,
          time: pin.startMinutes,
          durationMinutes: pin.durationMinutes,
          roomId: pin.roomId,
          reservedBy,
          reservedEmail: pin.reservedEmail || ""
        }
      });
      return;
    }
    setBlockDetails({
      kind: pin.kind,
      dateKey: pin.dateKey,
      lessonId: pin.kind === "lesson" ? pin.lessonId : undefined,
      roomId: pin.roomId,
      startMinutes: pin.startMinutes,
      durationMinutes: pin.durationMinutes,
      title: pin.title,
      meta: pin.meta
    });
  }, []);

  const handleMyScheduleAddSlot = useCallback(
    (request: ReserveRequest) => {
      const availableRooms = rooms
        .filter((room) => Boolean(getAvailability({ ...request, roomId: room.id, durationMinutes: 60 })))
        .map((room) => ({ id: room.id, name: room.name || room.shortName || room.id }));
      setMyScheduleAddDraft({ request, roomOptions: availableRooms });
    },
    [getAvailability, rooms]
  );

  const toggleAssociatedLessonPins = useCallback(
    async (lessonDetails: {
      lessonId?: string;
      dateKey: string;
      roomId: string;
      startMinutes: number;
      durationMinutes: number;
      title: string;
      meta: string;
    }) => {
      if (!lessonDetails.lessonId) {
        await togglePin({
          kind: "lesson",
          dateKey: lessonDetails.dateKey,
          lessonId: lessonDetails.lessonId,
          roomId: lessonDetails.roomId,
          startMinutes: lessonDetails.startMinutes,
          durationMinutes: lessonDetails.durationMinutes,
          title: lessonDetails.title,
          meta: lessonDetails.meta
        });
        return;
      }

      if (!apiSync.entities.lessons.enabled || !db) {
        await togglePin({
          kind: "lesson",
          dateKey: lessonDetails.dateKey,
          lessonId: lessonDetails.lessonId,
          roomId: lessonDetails.roomId,
          startMinutes: lessonDetails.startMinutes,
          durationMinutes: lessonDetails.durationMinutes,
          title: lessonDetails.title,
          meta: lessonDetails.meta
        });
        return;
      }

      const semester = getSemesterForDate(lessonDetails.dateKey);
      if (!semester?.startDate || !semester?.endDate) {
        await togglePin({
          kind: "lesson",
          dateKey: lessonDetails.dateKey,
          lessonId: lessonDetails.lessonId,
          roomId: lessonDetails.roomId,
          startMinutes: lessonDetails.startMinutes,
          durationMinutes: lessonDetails.durationMinutes,
          title: lessonDetails.title,
          meta: lessonDetails.meta
        });
        return;
      }

      const seriesToken = lessonSeriesToken({
        title: lessonDetails.title,
        teacher: lessonDetails.meta,
        roomId: lessonDetails.roomId,
        startMinutes: lessonDetails.startMinutes,
        durationMinutes: lessonDetails.durationMinutes
      });
      const nextById = new Map<string, MySchedulePin>();
      const pushPin = (
        dateKey: string,
        lesson: Pick<Lesson, "id" | "roomId" | "startMinutes" | "durationMinutes" | "title" | "teacher">
      ) => {
        const base = {
          kind: "lesson" as const,
          dateKey,
          lessonId: lesson.id,
          roomId: lesson.roomId,
          startMinutes: lesson.startMinutes,
          durationMinutes: lesson.durationMinutes
        };
        const id = pinIdFor(base);
        nextById.set(id, {
          id,
          ...base,
          title: lesson.title,
          meta: lesson.teacher || "ללא מרצה",
          createdAt: Date.now()
        });
      };
      pushPin(lessonDetails.dateKey, {
        id: lessonDetails.lessonId,
        roomId: lessonDetails.roomId,
        startMinutes: lessonDetails.startMinutes,
        durationMinutes: lessonDetails.durationMinutes,
        title: lessonDetails.title,
        teacher: lessonDetails.meta
      });

      try {
        const overridesRef = collection(db, "lessonOverrides");
        const parseCandidate = (
          data: Record<string, unknown>
        ): { date: string; externalId: string; lesson: Lesson } | null => {
          if (data.syncSource !== "api") return null;
          if (data.action !== "add") return null;
          const lessonRaw = data.lesson;
          if (!lessonRaw || typeof lessonRaw !== "object") return null;
          const lesson = lessonRaw as Record<string, unknown>;
          const date = typeof data.date === "string" ? data.date : "";
          const id = typeof lesson.id === "string" ? lesson.id : "";
          const roomId = typeof lesson.roomId === "string" ? lesson.roomId : "";
          const title = typeof lesson.title === "string" ? lesson.title : "";
          const teacher = typeof lesson.teacher === "string" ? lesson.teacher : "";
          const startMinutes = Number(lesson.startMinutes);
          const durationMinutes = Number(lesson.durationMinutes);
          if (!date || !id || !roomId) return null;
          if (!Number.isFinite(startMinutes) || !Number.isFinite(durationMinutes)) return null;
          return {
            date,
            externalId: typeof data.externalId === "string" ? data.externalId.trim() : "",
            lesson: {
              id,
              title,
              teacher,
              day: getDayKeyFromDateKey(date),
              roomId,
              startMinutes: Math.round(startMinutes),
              durationMinutes: Math.round(durationMinutes)
            }
          };
        };

        let externalSeriesId = "";
        const currentLessonSnapshot = await getDocs(query(overridesRef, where("lesson.id", "==", lessonDetails.lessonId)));
        currentLessonSnapshot.forEach((docSnap) => {
          if (externalSeriesId) return;
          const parsed = parseCandidate(docSnap.data() as Record<string, unknown>);
          if (!parsed) return;
          if (parsed.date !== lessonDetails.dateKey) return;
          if (!parsed.externalId) return;
          externalSeriesId = parsed.externalId;
        });

        if (externalSeriesId) {
          const seriesSnapshot = await getDocs(query(overridesRef, where("externalId", "==", externalSeriesId)));
          seriesSnapshot.forEach((docSnap) => {
            const parsed = parseCandidate(docSnap.data() as Record<string, unknown>);
            if (!parsed) return;
            if (parsed.date < semester.startDate || parsed.date > semester.endDate) return;
            pushPin(parsed.date, parsed.lesson);
          });
        }

        if (nextById.size <= 1) {
          const snapshot = await getDocs(
            query(overridesRef, where("date", ">=", semester.startDate), where("date", "<=", semester.endDate))
          );
          snapshot.forEach((docSnap) => {
            const parsed = parseCandidate(docSnap.data() as Record<string, unknown>);
            if (!parsed) return;
            if (lessonSeriesToken(parsed.lesson) !== seriesToken) return;
            pushPin(parsed.date, parsed.lesson);
          });
        }
      } catch {
        await togglePin({
          kind: "lesson",
          dateKey: lessonDetails.dateKey,
          lessonId: lessonDetails.lessonId,
          roomId: lessonDetails.roomId,
          startMinutes: lessonDetails.startMinutes,
          durationMinutes: lessonDetails.durationMinutes,
          title: lessonDetails.title,
          meta: lessonDetails.meta
        });
        return;
      }

      const candidatePins = Array.from(nextById.values());
      if (candidatePins.length <= 1) {
        await togglePin({
          kind: "lesson",
          dateKey: lessonDetails.dateKey,
          lessonId: lessonDetails.lessonId,
          roomId: lessonDetails.roomId,
          startMinutes: lessonDetails.startMinutes,
          durationMinutes: lessonDetails.durationMinutes,
          title: lessonDetails.title,
          meta: lessonDetails.meta
        });
        return;
      }

      const currentIds = new Set(myPins.map((pin) => pin.id));
      const candidateIds = new Set(candidatePins.map((pin) => pin.id));
      const allPinned = candidatePins.every((pin) => currentIds.has(pin.id));
      const nextPins = allPinned
        ? myPins.filter((pin) => !candidateIds.has(pin.id))
        : [
            ...myPins,
            ...candidatePins.filter((pin) => !currentIds.has(pin.id))
          ];
      await persistPins(nextPins);
      showToast(allPinned ? "כל המופעים הוסרו מהמערכת שלי." : "כל המופעים המשויכים נוספו למערכת שלי.");
    },
    [apiSync.entities.lessons.enabled, db, getSemesterForDate, myPins, persistPins, pinIdFor, showToast, togglePin]
  );

  const viewNode = (
    <HomeViewRouter
      view={view}
      rooms={rooms}
      lessons={lessons}
      reservationMap={displayReservationMap}
      roomMeta={roomMeta}
      getLessonsForDate={getLessonsForDate}
      startHour={activeHours.startHour}
      endHour={activeHours.endHour}
      nowMinutes={nowMinutes}
      todayDateKey={todayDateKey}
      todayDayKey={todayDayKey}
      onFinderDateWindowChange={(startDate, endDate) => setFinderWindow({ startDate, endDate })}
      myScheduleMode={myScheduleMode}
      onMyScheduleModeChange={setMyScheduleMode}
      myScheduleAgendaDays={myScheduleAgendaDays}
      onMyScheduleAgendaLoadMore={() => setMyScheduleAgendaDays((prev) => prev + 14)}
      pins={myPins}
      onOpenPinned={handleOpenPinned}
      onMyScheduleAddSlot={handleMyScheduleAddSlot}
      onSelectedDateChange={setSelectedDate}
      allRooms={allRooms}
      roomMode={roomMode}
      weekDates={weekDates}
      roomDates={roomDates}
      timeSlots={view === "room" ? scheduleTimeSlots : policyTimeSlots}
      selectedDate={selectedDate}
      selectedDayKey={selectedDayKey}
      selectedRoom={selectedRoom}
      currentUser={currentUser}
      adminMode={effectiveAdminMode}
      onRoomSelect={handleRoomSelect}
      onDateSelect={handleDaySelect}
      onReserve={handleReserve}
      onRelease={handleRelease}
      onEditReservation={handleEditReservation}
      onLessonDetails={handleLessonDetails}
      onSpecialDetails={handleSpecialDetails}
      onExamDetails={handleExamDetails}
      onClosedDetails={handleClosedDetails}
      pendingReservationIds={pendingReservationIds}
      onAdminSlotClick={handleAdminSlotClick}
      onAdminLessonClick={handleAdminLessonClick}
      onAdminReservationClick={handleAdminReservationClick}
      onReservationClick={handleReservationDetails}
      onNavigatePrev={handlePrev}
      onNavigateNext={handleNext}
    />
  );

  const scheduleView = view === "room";

  const pendingReleaseEntry = pendingRelease
    ? (reservationMap[pendingRelease.dateKey] || []).find((entry) => entry.id === pendingRelease.reservationId)
    : null;
  const releaseRoomName = pendingReleaseEntry
    ? rooms.find((room) => room.id === pendingReleaseEntry.roomId)?.name || pendingReleaseEntry.roomId
    : "";
  const releaseDayLabel = pendingRelease
    ? weekDays.find((day) => day.key === getDayKeyFromDateKey(pendingRelease.dateKey))?.label || ""
    : "";
  const releaseDateLine = pendingRelease
    ? `יום ${releaseDayLabel} ${formatShortDate(pendingRelease.dateKey)}`
    : "";
  const releaseTimeLine = pendingReleaseEntry
    ? `בין ${formatMinutes(pendingReleaseEntry.time)}-` +
      `${formatMinutes(pendingReleaseEntry.time + pendingReleaseEntry.durationMinutes)} · ` +
      `${formatDurationLabelHe(pendingReleaseEntry.durationMinutes)}`
    : "";

  const detailsReservation = reservationDetails?.reservation || null;
  useEffect(() => {
    const email = (detailsReservation?.reservedEmail || "").trim().toLowerCase();
    if (!email) {
      setDetailsContact(null);
      return;
    }
    const nameFromReservation = (detailsReservation?.reservedBy || "").trim();
    const phoneFromReservation = (detailsReservation?.reservedPhone || "").trim();
    const pictureFromReservation = (detailsReservation?.reservedPicture || "").trim();

    const cached = contactCacheRef.current.get(email);
    if (cached) {
      const merged = {
        ...cached,
        ...(nameFromReservation ? { name: nameFromReservation } : {}),
        ...(phoneFromReservation ? { phone: phoneFromReservation } : {}),
        ...(pictureFromReservation ? { pictureUrl: pictureFromReservation } : {})
      };
      setDetailsContact(merged);
      return;
    }

    // Prefer contact info stored on the reservation itself (no extra reads), but still
    // allow a single user-doc read to backfill a missing picture URL.
    if (phoneFromReservation && pictureFromReservation) {
      const contact = {
        name: nameFromReservation,
        phone: phoneFromReservation,
        pictureUrl: pictureFromReservation
      };
      contactCacheRef.current.set(email, contact);
      setDetailsContact(contact);
      return;
    }
    if (phoneFromReservation) {
      // Show the phone immediately, then try to backfill the picture from the users directory.
      setDetailsContact({ name: nameFromReservation, phone: phoneFromReservation });
    }
    if (!db) {
      setDetailsContact(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, "users", email))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setDetailsContact(phoneFromReservation ? { name: nameFromReservation, phone: phoneFromReservation } : null);
          return;
        }
        const data = snap.data() as Record<string, unknown>;
        const phone =
          typeof data.phone === "string"
            ? data.phone
            : typeof data.phoneNumber === "string"
              ? data.phoneNumber
              : typeof data.phone_number === "string"
                ? data.phone_number
                : typeof data.mobile === "string"
                  ? data.mobile
                  : typeof data.tel === "string"
                    ? data.tel
                    : "";
        const pictureUrl =
          typeof data.pictureUrl === "string"
            ? data.pictureUrl
            : typeof data.picture === "string"
              ? data.picture
              : typeof data.photoURL === "string"
                ? data.photoURL
                : typeof data.photoUrl === "string"
                  ? data.photoUrl
                  : "";
        const contact = {
          name: typeof data.name === "string" ? data.name : nameFromReservation,
          phone: phoneFromReservation || phone,
          ...(pictureUrl ? { pictureUrl } : {})
        };
        contactCacheRef.current.set(email, contact);
        setDetailsContact(contact);
      })
      .catch(() => {
        if (cancelled) return;
        setDetailsContact(phoneFromReservation ? { name: nameFromReservation, phone: phoneFromReservation } : null);
      });
    return () => {
      cancelled = true;
    };
  }, [detailsReservation?.reservedEmail]);

  const detailsRoomName = detailsReservation
    ? rooms.find((room) => room.id === detailsReservation.roomId)?.name || detailsReservation.roomId
    : "";
  const detailsDayLabel = reservationDetails
    ? weekDays.find((day) => day.key === getDayKeyFromDateKey(reservationDetails.dateKey))?.label || ""
    : "";
  const detailsDateLine = reservationDetails
    ? `יום ${detailsDayLabel} ${formatShortDate(reservationDetails.dateKey)}`
    : "";
  const detailsDuration = detailsReservation?.durationMinutes || 60;
  const detailsTimeLine = detailsReservation
    ? `בין ${formatMinutes(detailsReservation.time)}-` +
      `${formatMinutes(detailsReservation.time + detailsDuration)} · ` +
      `${formatDurationLabelHe(detailsDuration)}`
    : "";
  const detailsIsMine = Boolean(
    currentUser &&
      detailsReservation &&
      detailsReservation.reservedEmail &&
      currentUser.email.toLowerCase() === detailsReservation.reservedEmail.toLowerCase()
  );
  const detailsPrivateDescription = detailsIsMine ? (detailsReservation?.privateDescription || "").trim() : "";
  const detailsName = detailsReservation?.reservedBy || detailsContact?.name || "";
  const detailsEmail = detailsReservation?.reservedEmail || "";
  const detailsPhone = detailsReservation?.reservedPhone || detailsContact?.phone || "";
  const detailsPictureUrl = (() => {
    const directoryUrl = (detailsContact?.pictureUrl || "").trim();
    const reservedUrl = (detailsReservation?.reservedPicture || "").trim();
    if (directoryUrl && isFirebaseStorageDownloadUrl(directoryUrl)) return directoryUrl;
    if (reservedUrl && isFirebaseStorageDownloadUrl(reservedUrl)) return reservedUrl;

    // Avoid hotlinking Google profile images for other users; it frequently 429s under even light usage.
    // We'll show initials until the user's Storage-cached photo is available.
    if (directoryUrl && isGoogleUserContentUrl(directoryUrl)) return "";
    if (reservedUrl && isGoogleUserContentUrl(reservedUrl)) return "";

    return (
      directoryUrl ||
      reservedUrl ||
      (currentUser && detailsEmail && currentUser.email.toLowerCase() === detailsEmail.toLowerCase()
        ? (currentUser.picture || "")
        : "")
    );
  })();
  const reservationPinned = detailsReservation
    ? isPinned({
        kind: "reservation",
        dateKey: detailsReservation.date,
        roomId: detailsReservation.roomId,
        startMinutes: detailsReservation.time,
        durationMinutes: detailsDuration
      })
    : false;

  return (
    <div className={`booking-shell${scheduleView ? " schedule-view" : ""}`}>
      <div
        className={`view-shell${dayTransition ? ` day-transition-${dayTransition}` : ""}`}
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget) return;
          if (!dayTransition) return;
          setDayTransition("");
        }}
      >
        {viewNode}
      </div>
      {toast ? (
        <div
          className={`home-toast${toast.tone === "error" ? " error" : toast.tone === "success" ? " success" : ""}`}
          style={{ bottom: hasNav ? "calc(18px + env(safe-area-inset-bottom) + 74px)" : "calc(18px + env(safe-area-inset-bottom))" }}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      ) : null}
      {pendingConfirm ? (
        <ReserveConfirmOverlay
          open
          title={pendingConfirm.mode === "edit" ? "עריכת שריון" : "שריון חדר"}
          room={rooms.find((room) => room.id === pendingConfirm.request.roomId)?.name || ""}
          dateLine={`יום ${weekDays.find((day) => day.key === pendingConfirm.request.day)?.label || ""} ` +
            `${formatShortDate(pendingConfirm.request.date)}`}
          request={pendingConfirm.request}
          limitEnd={pendingConfirm.limitEnd}
          startMinutes={pendingConfirm.startMinutes}
          windowStart={pendingConfirm.windowStart}
          initialDuration={pendingConfirm.durationMinutes}
          initialPrivateDescription={pendingConfirm.privateDescription}
          userRemainingMinutes={pendingConfirm.userRemainingMinutes}
          limitHoursPerRoomPerDay={pendingConfirm.limitHoursPerRoomPerDay}
          limitHoursPerRoomPerWeek={pendingConfirm.limitHoursPerRoomPerWeek}
          limitHoursPerDayTotal={pendingConfirm.limitHoursPerDayTotal}
          limitHoursPerWeekTotal={pendingConfirm.limitHoursPerWeekTotal}
          limitMaxDaysForward={pendingConfirm.limitMaxDaysForward}
          mode={pendingConfirm.mode}
          onRelease={
            pendingConfirm.mode === "edit" && pendingConfirm.reservationId
              ? () => {
                  handleRelease(pendingConfirm.request.date, pendingConfirm.reservationId!);
                  setPendingConfirm(null);
                }
              : undefined
          }
          onConfirm={(startMinutes, durationMinutes, privateDescription) => {
            if (pendingConfirm.mode === "edit") {
              void handleConfirmEdit(pendingConfirm, startMinutes, durationMinutes, privateDescription);
              return;
            }
            handleConfirmReserve(pendingConfirm.request, startMinutes, durationMinutes, privateDescription);
          }}
          onClose={() => setPendingConfirm(null)}
        />
      ) : null}
      {myScheduleAddDraft ? (
        <MyScheduleAddOverlay
          open
          dateLine={`יום ${weekDays.find((day) => day.key === myScheduleAddDraft.request.day)?.label || ""} ` +
            `${formatShortDate(myScheduleAddDraft.request.date)}`}
          timeLine={`החל מ-${formatMinutes(myScheduleAddDraft.request.time)}`}
          roomOptions={myScheduleAddDraft.roomOptions}
          onContinueReservation={(roomId) => {
            const request: ReserveRequest = {
              ...myScheduleAddDraft.request,
              roomId,
              durationMinutes: 60
            };
            setMyScheduleAddDraft(null);
            handleReserve(request);
          }}
          onAddPersonalBlock={(note) => {
            if (!currentUser?.email) {
              setAuthError("יש להתחבר כדי להוסיף בלוק אישי.");
              return;
            }
            togglePin({
              kind: "closed",
              dateKey: myScheduleAddDraft.request.date,
              roomId: PERSONAL_PIN_ROOM_ID,
              startMinutes: myScheduleAddDraft.request.time,
              durationMinutes: 60,
              title: note || "חסום אישי",
              meta: ""
            });
            setMyScheduleAddDraft(null);
          }}
          onClose={() => setMyScheduleAddDraft(null)}
        />
      ) : null}
      <ReservationDetailsOverlay
        open={Boolean(reservationDetails)}
        title="פרטי שריון"
        room={detailsRoomName}
        dateLine={detailsDateLine}
        timeLine={detailsTimeLine}
        name={detailsName}
        email={detailsEmail}
        phone={detailsPhone}
        pictureUrl={detailsPictureUrl || undefined}
        privateDescription={detailsPrivateDescription || undefined}
        pinned={reservationPinned}
        onTogglePin={
          detailsReservation && currentUser?.email
            ? () => togglePin({
                kind: "reservation",
                dateKey: reservationDetails?.dateKey || detailsReservation.date,
                roomId: detailsReservation.roomId,
                startMinutes: detailsReservation.time,
                durationMinutes: detailsDuration,
                title: "שמור",
                meta: detailsName,
                reservedEmail: detailsEmail
              })
            : undefined
        }
        onClose={() => setReservationDetails(null)}
      />
      <BlockDetailsOverlay
        open={Boolean(blockDetails)}
        title={
          blockDetails?.kind === "lesson"
            ? "פרטי שיעור"
            : blockDetails?.kind === "special"
              ? "פרטי אירוע"
              : "פרטי סגירה"
        }
        room={
          blockDetails
            ? blockDetails.roomId === PERSONAL_PIN_ROOM_ID
              ? "אישי"
              : rooms.find((room) => room.id === blockDetails.roomId)?.name || blockDetails.roomId
            : ""
        }
        dateLine={
          blockDetails
            ? `יום ${weekDays.find((day) => day.key === getDayKeyFromDateKey(blockDetails.dateKey))?.label || ""} ${formatShortDate(blockDetails.dateKey)}`
            : ""
        }
        timeLine={
          blockDetails
            ? `בין ${formatMinutes(blockDetails.startMinutes)}-${formatMinutes(blockDetails.startMinutes + blockDetails.durationMinutes)} · ` +
              `${formatDurationLabelHe(blockDetails.durationMinutes)}`
            : ""
        }
        lines={
          blockDetails?.kind === "lesson"
            ? [
                { label: "שיעור", value: blockDetails.title },
                { label: "מרצה", value: blockDetails.meta }
              ]
            : [
                { label: blockDetails?.kind === "special" ? "אירוע" : "סגירה", value: blockDetails?.title || "" }
              ]
        }
        pinned={
          Boolean(
            blockDetails &&
              isPinned({
                kind: blockDetails.kind,
                dateKey: blockDetails.dateKey,
                lessonId: blockDetails.kind === "lesson" ? blockDetails.lessonId : undefined,
                roomId: blockDetails.roomId,
                startMinutes: blockDetails.startMinutes,
                durationMinutes: blockDetails.durationMinutes
              })
          )
        }
        onTogglePin={
          blockDetails && currentUser?.email
            ? () => {
                if (blockDetails.kind === "lesson") {
                  void toggleAssociatedLessonPins({
                    lessonId: blockDetails.lessonId,
                    dateKey: blockDetails.dateKey,
                    roomId: blockDetails.roomId,
                    startMinutes: blockDetails.startMinutes,
                    durationMinutes: blockDetails.durationMinutes,
                    title: blockDetails.title,
                    meta: blockDetails.meta
                  });
                  return;
                }
                void togglePin({
                  kind: blockDetails.kind,
                  dateKey: blockDetails.dateKey,
                  roomId: blockDetails.roomId,
                  startMinutes: blockDetails.startMinutes,
                  durationMinutes: blockDetails.durationMinutes,
                  title: blockDetails.title,
                  meta: blockDetails.meta
                });
              }
            : undefined
        }
        onClose={() => setBlockDetails(null)}
      />
      <ConfirmOverlay
        open={Boolean(pendingRelease)}
        title="שחרור חדר"
        room={releaseRoomName}
        dateLine={releaseDateLine}
        timeLine={releaseTimeLine}
        confirmLabel="שחרור"
        cancelLabel="חזרה"
        onConfirm={() => {
          if (!pendingRelease) return;
          void (async () => {
            const ok = await releaseReservation(pendingRelease.dateKey, pendingRelease.reservationId);
            if (!ok) {
              showToast("שחרור נכשל (בדוק הגדרות Firestore).", "error");
              return;
            }
            setPendingRelease(null);
          })();
        }}
        onClose={() => setPendingRelease(null)}
      />
      <AdminEditOverlay
        draft={adminDraft}
        rooms={rooms}
        weekDays={weekDays}
        users={users}
        canSave={effectiveAdminMode}
        error={adminError}
        collisionPending={Boolean(collisionConfirm)}
        onClose={() => setAdminDraft(null)}
        setDraft={setAdminDraft}
        onSwitchType={switchAdminType}
        onDeleteLesson={() => { void handleAdminDeleteLesson(); }}
        onDeleteReservation={handleAdminDeleteReservation}
        onSave={handleAdminSave}
      />
    </div>
  );
}
