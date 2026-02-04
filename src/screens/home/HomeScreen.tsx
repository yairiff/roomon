import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ScheduleGrid from "./views/ScheduleGrid";
import Legend from "./views/Legend";
import LiveView from "./views/LiveView";
import BookingFinder from "./views/BookingFinder";
import MyScheduleView from "./views/MyScheduleView";
import ReserveConfirmOverlay from "./overlays/ReserveConfirmOverlay";
import ReservationDetailsOverlay from "./overlays/ReservationDetailsOverlay";
import BlockDetailsOverlay from "./overlays/BlockDetailsOverlay";
import ConfirmOverlay from "./overlays/ConfirmOverlay";
import { useSchedule } from "../../hooks/useSchedule";
import { useLessonOverrides } from "../../hooks/useLessonOverrides";
import { useDirectoryUsers } from "../../hooks/useDirectoryUsers";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import {
  addDays,
  buildWeekDates,
  formatDateKey,
  formatShortDate,
  getDayKeyFromDateKey,
  getWeekNumber,
  parseDateKey
} from "../../lib/date";
import { formatMinutes } from "../../lib/scheduleBuilder";
import { applyLessonOverrides } from "../../lib/lessonOverrides";
import { loadMySchedulePins, saveMySchedulePins } from "../../lib/storage";
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  ClosedIcon,
  LessonTypeIcon,
  ReleaseIcon,
  ReservationIcon,
  RoomIcon,
  SpecialIcon
} from "../../components/Icons";
import type { User } from "../../types/auth";
import type { Reservation, ReservationMap, ReserveRequest } from "../../types/reservations";
import type { DayKey, Lesson } from "../../types/schedule";
import type { TopBarContext, ViewMode } from "../../types/ui";
import type { MySchedulePin } from "../../types/mySchedule";

type AdminLessonDraft = {
  type: "lesson";
  mode: "create" | "edit";
  dateKey: string;
  dayKey: DayKey;
  roomId: string;
  startMinutes: number;
  durationMinutes: number;
  title: string;
  teacher: string;
  targetLessonId?: string;
};

type AdminReservationDraft = {
  type: "reservation";
  mode: "create" | "edit";
  dateKey: string;
  dayKey: DayKey;
  roomId: string;
  startMinutes: number;
  durationMinutes: number;
  reservedBy: string;
  reservedEmail: string;
  reservationId?: string;
};

type AdminSpecialDraft = {
  type: "special";
  mode: "create" | "edit";
  dateKey: string;
  dayKey: DayKey;
  roomId: string;
  startMinutes: number;
  durationMinutes: number;
  label: string;
  reservationId?: string;
};

type AdminClosedDraft = {
  type: "closed";
  mode: "create" | "edit";
  dateKey: string;
  dayKey: DayKey;
  roomId: string;
  startMinutes: number;
  durationMinutes: number;
  label: string;
  reservationId?: string;
};

type AdminDraft = AdminLessonDraft | AdminReservationDraft | AdminSpecialDraft | AdminClosedDraft;

type PendingConfirm = {
  mode: "create" | "edit";
  request: ReserveRequest;
  reservationId?: string;
  durationMinutes: number;
  limitEnd: number;
  startMinutes: number;
  windowStart: number;
  userRemainingMinutes: number;
};

export type HomeScreenProps = {
  currentUser: User | null;
  setAuthError: (message: string) => void;
  onContextChange?: (context: TopBarContext) => void;
  onReservationWindowChange?: (window: { startDate: string; endDate: string }) => void;
  reservationMap: ReservationMap;
  addReservation: (reservation: Reservation) => void;
  upsertReservation: (reservation: Reservation) => void;
  releaseReservation: (dateKey: string, reservationId: string) => void;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  requestedView?: ViewMode | null;
  onRequestedViewHandled?: () => void;
  adminMode?: boolean;
};

const isWeekend = (dateKey: string) => {
  const day = parseDateKey(dateKey).getDay();
  return day === 5 || day === 6;
};

const shiftSchoolDay = (dateKey: string, delta: number) => {
  let next = parseDateKey(dateKey);
  do {
    next = addDays(next, delta);
  } while (next.getDay() === 5 || next.getDay() === 6);
  return formatDateKey(next);
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
  const [now, setNow] = useState(() => new Date());
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [pendingRelease, setPendingRelease] = useState<{ dateKey: string; reservationId: string } | null>(null);
  const [reservationDetails, setReservationDetails] = useState<{ reservation: Reservation; dateKey: string } | null>(null);
  const [blockDetails, setBlockDetails] = useState<{
    kind: "lesson" | "special" | "closed";
    dateKey: string;
    roomId: string;
    startMinutes: number;
    durationMinutes: number;
    title: string;
    meta: string;
  } | null>(null);
  const [myPins, setMyPins] = useState<MySchedulePin[]>([]);
  const [adminError, setAdminError] = useState("");
  const [adminDraft, setAdminDraft] = useState<AdminDraft | null>(null);
  const [toast, setToast] = useState<{ message: string; tone?: "info" | "error" } | null>(null);
  const prevViewRef = useRef<ViewMode>("live");
  const lastMainViewRef = useRef<ViewMode>("live");
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const lastContextKeyRef = useRef<string>("");
  const [reservationUserQuery, setReservationUserQuery] = useState("");
  const [reservationUserOpen, setReservationUserOpen] = useState(false);
  const lastValidReservationUser = useRef<{ label: string; email: string; name: string } | null>(null);
  const contactCacheRef = useRef<Map<string, { name: string; phone: string }>>(new Map());
  const [detailsContact, setDetailsContact] = useState<{ name: string; phone: string } | null>(null);
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

  const showToast = useCallback((message: string, tone: "info" | "error" = "info") => {
    setToast({ message, tone });
  }, []);

  const todayDateKey = formatDateKey(now);
  const scheduleDateKey = view === "live" ? todayDateKey : selectedDate;
  const isLocked = !currentUser?.allowed;
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "moderator";
  const hasNav = Boolean(currentUser);

  const pinIdFor = useCallback(
    (pin: Pick<MySchedulePin, "kind" | "dateKey" | "roomId" | "startMinutes" | "durationMinutes">) =>
      `${pin.kind}:${pin.dateKey}:${pin.roomId}:${pin.startMinutes}:${pin.durationMinutes}`,
    []
  );

  useEffect(() => {
    const email = currentUser?.email;
    if (!email) {
      setMyPins([]);
      return;
    }
    setMyPins(loadMySchedulePins(email));
  }, [currentUser?.email]);

  useEffect(() => {
    const email = currentUser?.email;
    if (!email) return;
    saveMySchedulePins(email, myPins);
  }, [currentUser?.email, myPins]);

  const togglePin = useCallback((details: NonNullable<typeof blockDetails>) => {
    const email = currentUser?.email;
    if (!email) return;
    setMyPins((prev) => {
      const base = {
        kind: details.kind,
        dateKey: details.dateKey,
        roomId: details.roomId,
        startMinutes: details.startMinutes,
        durationMinutes: details.durationMinutes
      };
      const id = pinIdFor(base);
      const exists = prev.some((pin) => pin.id === id);
      const next = exists
        ? prev.filter((pin) => pin.id !== id)
        : [
            ...prev,
            {
              id,
              ...base,
              title: details.title,
              meta: details.meta,
              createdAt: Date.now()
            }
          ];
      showToast(exists ? "הוסר מהמערכת שלי" : "נוסף למערכת שלי");
      return next;
    });
  }, [currentUser?.email, pinIdFor, showToast]);

  const { rooms, weekDays, timeSlots, lessons, config, roomMeta } = useSchedule(scheduleDateKey);
  const { overridesByDate, addOverride } = useLessonOverrides();
  const { users } = useDirectoryUsers(adminMode && isAdmin);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (view === "room" && prevViewRef.current !== "room") {
      setRoomMode("day");
    }
    if (view === "mySchedule") {
      setSelectedDate(formatDateKey(new Date()));
    }
    prevViewRef.current = view;
    if (view !== "reservations" && view !== "mySchedule") {
      lastMainViewRef.current = view;
    }
  }, [view]);

  const effectiveAdminMode = adminMode && isAdmin;

  useEffect(() => {
    // If permissions (or admin mode) are revoked while an overlay is open, close it instead of silently no-oping.
    if (effectiveAdminMode) return;
    setAdminDraft(null);
    setAdminError("");
  }, [effectiveAdminMode]);

  useEffect(() => {
    const isDailyView = view === "room" && (allRooms || roomMode === "day");
    if (isDailyView && isWeekend(selectedDate)) {
      setSelectedDate(shiftSchoolDay(selectedDate, 1));
    }
  }, [allRooms, roomMode, selectedDate, view]);

  useEffect(() => {
    if (isLocked && view !== "live") {
      onViewChange("live");
    }
  }, [isLocked, onViewChange, view]);

  useEffect(() => {
    if (!adminMode) {
      setAdminDraft(null);
      setAdminError("");
    }
  }, [adminMode]);

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

  const getLessonsForDate = useCallback(
    (dateKey: string, dayKey: DayKey) => {
      const baseLessons = lessons.filter((lesson) => lesson.day === dayKey);
      const overrides = overridesByDate[dateKey] || [];
      return applyLessonOverrides(baseLessons, overrides, dayKey);
    },
    [lessons, overridesByDate]
  );

  const toTimeInput = (minutes: number) => formatMinutes(minutes);
  const parseTimeInput = (value: string) => {
    if (!value) return 0;
    const [hoursText, minutesText = "0"] = value.split(":");
    const hours = Number(hoursText);
    const mins = Number(minutesText);
    if (!Number.isFinite(hours) || !Number.isFinite(mins)) return 0;
    return hours * 60 + mins;
  };
  const formatUserLabel = (name: string, email: string) => {
    if (name && email) return `${name} · ${email}`;
    return email || name || "";
  };
  const findUserMatch = (value: string) => {
    const raw = value.trim().toLowerCase();
    if (!raw) return null;
    const exact = users.find((u) => u.email.toLowerCase() === raw);
    if (exact) return exact;
    return users.find((u) => formatUserLabel(u.name || "", u.email).toLowerCase() === raw) || null;
  };
  const filteredUsers = useMemo(() => {
    const query = reservationUserQuery.trim().toLowerCase();
    if (!query) return users;
    return users.filter((u) => {
      const label = formatUserLabel(u.name || "", u.email).toLowerCase();
      return label.includes(query);
    });
  }, [reservationUserQuery, users]);

  useEffect(() => {
    if (adminDraft?.type !== "reservation") {
      setReservationUserOpen(false);
      return;
    }
    const label = formatUserLabel(adminDraft.reservedBy, adminDraft.reservedEmail);
    setReservationUserQuery(label);
    if (adminDraft.reservedEmail) {
      lastValidReservationUser.current = {
        label,
        email: adminDraft.reservedEmail,
        name: adminDraft.reservedBy
      };
    }
  }, [adminDraft]);

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

  useEffect(() => {
    if (!onReservationWindowChange) return;
    const desired =
      view === "live"
        ? { startDate: todayDateKey, endDate: todayDateKey }
        : view === "finder"
          ? finderWindow
          : view === "reservations"
            ? { startDate: todayDateKey, endDate: formatDateKey(addDays(parseDateKey(todayDateKey), 21)) }
            : weekRange;

    const key = `${desired.startDate}|${desired.endDate}`;
    if (key === lastWindowKeyRef.current) return;
    lastWindowKeyRef.current = key;
    onReservationWindowChange(desired);
  }, [finderWindow, onReservationWindowChange, todayDateKey, view, weekRange]);

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


  const buildIntervals = (dayKey: string, dateKey: string, roomId: string) => {
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
  };

  const getUserReservedMinutes = (dateKey: string, roomId: string) => {
    if (!currentUser?.email) return 0;
    return (reservationMap[dateKey] || [])
      .filter((entry) => entry.roomId === roomId && entry.reservedEmail === currentUser.email)
      .reduce((sum, entry) => sum + entry.durationMinutes, 0);
  };

  const getAvailability = (request: ReserveRequest) => {
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
    const overlaps = intervals.some(
      (interval) => interval.start < alignedStart + 0.1 && interval.end > alignedStart
    );
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
  };

  const handleReserve = (request: ReserveRequest) => {
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
      setAllRooms(false);
      setSelectedRoom(request.roomId);
      setSelectedDate(request.date);
      setRoomMode("day");
      onViewChange("room");
      return;
    }
    if (view === "room" && allRooms) {
      setAllRooms(false);
      setSelectedRoom(request.roomId);
      setSelectedDate(request.date);
      setRoomMode("day");
      onViewChange("room");
      return;
    }
  };

  const handleConfirmReserve = (draft: ReserveRequest, startMinutes: number, durationMinutes: number) => {
    const STEP = 30;
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

    const id = typeof crypto !== "undefined" && crypto.randomUUID
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
  };

  const handleEditReservation = (dateKey: string, reservationId: string) => {
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

    const request: ReserveRequest = { date: dateKey, day: dayKey, time: alignedStart, roomId, durationMinutes: entry.durationMinutes };
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
  };

  const handleConfirmEdit = async (pending: PendingConfirm, startMinutes: number, durationMinutes: number) => {
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
  };

  const handleAdminSlotClick = (request: ReserveRequest) => {
    if (!isAdmin || !effectiveAdminMode) return;
    setAdminError("");
    setAdminDraft({
      type: "reservation",
      mode: "create",
      dateKey: request.date,
      dayKey: request.day,
      roomId: request.roomId,
      startMinutes: request.time,
      durationMinutes: 60,
      reservedBy: currentUser?.name || "",
      reservedEmail: currentUser?.email || ""
    });
  };

  const handleAdminLessonClick = (lessonId: string, dateKey: string) => {
    if (!isAdmin || !effectiveAdminMode) return;
    const dayKey = getDayKeyFromDateKey(dateKey);
    const lesson = getLessonsForDate(dateKey, dayKey).find((entry) => entry.id === lessonId);
    if (!lesson) return;
    setAdminError("");
    setAdminDraft({
      type: "lesson",
      mode: "edit",
      dateKey,
      dayKey,
      roomId: lesson.roomId,
      startMinutes: lesson.startMinutes,
      durationMinutes: lesson.durationMinutes,
      title: lesson.title,
      teacher: lesson.teacher,
      targetLessonId: lesson.id
    });
  };

  const handleAdminReservationClick = (reservationId: string, dateKey: string) => {
    if (!isAdmin || !effectiveAdminMode) return;
    const reservation = (reservationMap[dateKey] || []).find((entry) => entry.id === reservationId);
    if (!reservation) return;
    const dayKey = getDayKeyFromDateKey(dateKey);
    setAdminError("");
    if (reservation.kind === "special") {
      setAdminDraft({
        type: "special",
        mode: "edit",
        dateKey,
        dayKey,
        roomId: reservation.roomId,
        startMinutes: reservation.time,
        durationMinutes: reservation.durationMinutes,
        label: reservation.reservedBy || "אירוע מיוחד",
        reservationId: reservation.id
      });
      return;
    }
    if (reservation.kind === "closed") {
      setAdminDraft({
        type: "closed",
        mode: "edit",
        dateKey,
        dayKey,
        roomId: reservation.roomId,
        startMinutes: reservation.time,
        durationMinutes: reservation.durationMinutes,
        label: reservation.reservedBy || "סגור זמנית",
        reservationId: reservation.id
      });
      return;
    }
    setAdminDraft({
      type: "reservation",
      mode: "edit",
      dateKey,
      dayKey,
      roomId: reservation.roomId,
      startMinutes: reservation.time,
      durationMinutes: reservation.durationMinutes,
      reservedBy: reservation.reservedBy,
      reservedEmail: reservation.reservedEmail,
      reservationId: reservation.id
    });
  };

  const handleReservationDetails = (reservationId: string, dateKey: string) => {
    const reservation = (reservationMap[dateKey] || []).find((entry) => entry.id === reservationId);
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
      roomId: lesson.roomId,
      startMinutes: lesson.startMinutes,
      durationMinutes: lesson.durationMinutes,
      title: lesson.title,
      meta: lesson.teacher || "ללא מרצה"
    });
  };

  const handleSpecialDetails = (reservationId: string, dateKey: string) => {
    const reservation = (reservationMap[dateKey] || []).find((entry) => entry.id === reservationId);
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

  const handleClosedDetails = (reservationId: string, dateKey: string) => {
    const reservation = (reservationMap[dateKey] || []).find((entry) => entry.id === reservationId);
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

  const checkReservationConflict = (draft: AdminReservationDraft | AdminSpecialDraft | AdminClosedDraft) => {
    const { dateKey, dayKey, roomId, startMinutes, durationMinutes, reservationId } = draft;
    const endMinutes = startMinutes + durationMinutes;
    const dayLessons = getLessonsForDate(dateKey, dayKey);
    const lessonOverlap = dayLessons.some((lesson) => {
      if (lesson.roomId !== roomId) return false;
      const lessonEnd = lesson.startMinutes + lesson.durationMinutes;
      return lesson.startMinutes < endMinutes && lessonEnd > startMinutes;
    });
    if (lessonOverlap) return "קיים שיעור חופף.";

    const reservations = reservationMap[dateKey] || [];
    const reservationOverlap = reservations.some((reservation) => {
      if (reservation.roomId !== roomId) return false;
      if (reservationId && reservation.id === reservationId) return false;
      const reservationEnd = reservation.time + reservation.durationMinutes;
      return reservation.time < endMinutes && reservationEnd > startMinutes;
    });
    if (reservationOverlap) return "קיים שריון חופף.";

    const policy = roomMeta?.[roomId];
    if (policy?.isClosed) return "החדר סגור זמנית.";
    const roomOpen = policy?.openMinutes ?? config.startHour * 60;
    const roomClose = policy?.closeMinutes ?? config.endHour * 60;
    if (startMinutes < roomOpen || endMinutes > roomClose) {
      return "השעה מחוץ לשעות הפעילות של החדר.";
    }

    return "";
  };

  const handleAdminSave = async () => {
    if (!adminDraft) return;
    if (!effectiveAdminMode) {
      setAdminError("אין הרשאת ניהול.");
      return;
    }
    setAdminError("");

    if (adminDraft.type === "lesson") {
      const action = adminDraft.mode === "edit" ? "update" : "add";
      const lesson: Lesson = {
        id: adminDraft.targetLessonId || `override-${Date.now()}`,
        title: adminDraft.title,
        teacher: adminDraft.teacher,
        day: adminDraft.dayKey,
        roomId: adminDraft.roomId,
        startMinutes: adminDraft.startMinutes,
        durationMinutes: adminDraft.durationMinutes
      };
      const ok = await addOverride({
        date: adminDraft.dateKey,
        action,
        lesson,
        ...(adminDraft.targetLessonId ? { targetLessonId: adminDraft.targetLessonId } : {}),
        ...(currentUser?.email ? { createdBy: currentUser.email } : {})
      });
      if (!ok) {
        setAdminError("שמירה נכשלה (בדוק הגדרות Firestore).");
        return;
      }
      setAdminDraft(null);
      return;
    }

    const conflictMessage = checkReservationConflict(adminDraft);
    if (conflictMessage) {
      setAdminError(conflictMessage);
      return;
    }

    const reservation: Reservation = {
      id: adminDraft.reservationId || (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `res-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      date: adminDraft.dateKey,
      time: adminDraft.startMinutes,
      durationMinutes: adminDraft.durationMinutes,
      roomId: adminDraft.roomId,
      reservedBy: adminDraft.type === "special"
        ? (adminDraft.label || "אירוע מיוחד")
        : adminDraft.type === "closed"
          ? (adminDraft.label || "סגור זמנית")
          : (adminDraft.reservedBy || "אדמין"),
      reservedEmail: adminDraft.type === "reservation" ? (adminDraft.reservedEmail || "") : "",
      ...(adminDraft.type === "special"
        ? { kind: "special" as const }
        : adminDraft.type === "closed"
          ? { kind: "closed" as const }
          : {})
    };

    if (adminDraft.mode === "create") {
      const ok = await addReservation(reservation);
      if (!ok) {
        setAdminError("שמירה נכשלה (בדוק הגדרות Firestore).");
        return;
      }
    } else {
      const ok = await upsertReservation(reservation);
      if (!ok) {
        setAdminError("שמירה נכשלה (בדוק הגדרות Firestore).");
        return;
      }
    }
    setAdminDraft(null);
  };

  const handleAdminDeleteLesson = async () => {
    if (!adminDraft || !effectiveAdminMode || adminDraft.type !== "lesson" || !adminDraft.targetLessonId) return;
    await addOverride({
      date: adminDraft.dateKey,
      action: "delete",
      targetLessonId: adminDraft.targetLessonId,
      createdBy: currentUser?.email
    });
    setAdminDraft(null);
  };

  const handleAdminDeleteReservation = () => {
    if (!adminDraft || !effectiveAdminMode || (adminDraft.type !== "reservation" && adminDraft.type !== "special" && adminDraft.type !== "closed") || !adminDraft.reservationId) return;
    void (async () => {
      const ok = await releaseReservation(adminDraft.dateKey, adminDraft.reservationId);
      if (!ok) {
        setAdminError("מחיקה נכשלה (בדוק הגדרות Firestore).");
        return;
      }
      setAdminDraft(null);
    })();
  };

  const switchAdminType = (nextType: "lesson" | "reservation" | "special" | "closed") => {
    if (!adminDraft || adminDraft.mode !== "create") return;
    if (adminDraft.type === nextType) return;
    if (nextType === "lesson") {
      setAdminDraft({
        type: "lesson",
        mode: "create",
        dateKey: adminDraft.dateKey,
        dayKey: adminDraft.dayKey,
        roomId: adminDraft.roomId,
        startMinutes: adminDraft.startMinutes,
        durationMinutes: 90,
        title: "",
        teacher: ""
      });
      return;
    }
    if (nextType === "special") {
      setAdminDraft({
        type: "special",
        mode: "create",
        dateKey: adminDraft.dateKey,
        dayKey: adminDraft.dayKey,
        roomId: adminDraft.roomId,
        startMinutes: adminDraft.startMinutes,
        durationMinutes: adminDraft.durationMinutes,
        label: "אירוע מיוחד"
      });
      return;
    }
    if (nextType === "closed") {
      setAdminDraft({
        type: "closed",
        mode: "create",
        dateKey: adminDraft.dateKey,
        dayKey: adminDraft.dayKey,
        roomId: adminDraft.roomId,
        startMinutes: adminDraft.startMinutes,
        durationMinutes: adminDraft.durationMinutes,
        label: "סגור זמנית"
      });
      return;
    }
    setAdminDraft({
      type: "reservation",
      mode: "create",
      dateKey: adminDraft.dateKey,
      dayKey: adminDraft.dayKey,
      roomId: adminDraft.roomId,
      startMinutes: adminDraft.startMinutes,
      durationMinutes: adminDraft.durationMinutes,
      reservedBy: currentUser?.name || "",
      reservedEmail: currentUser?.email || ""
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
      setSelectedDate(formatDateKey(addDays(parseDateKey(selectedDate), -7)));
      return;
    }
    if (view === "room") {
      const isAllRooms = allRooms;
      if (!isAllRooms && roomMode === "week") {
        const delta = -7;
        setSelectedDate(formatDateKey(addDays(parseDateKey(selectedDate), delta)));
        return;
      }
      setSelectedDate(shiftSchoolDay(selectedDate, -1));
      return;
    }
    setSelectedDate(shiftSchoolDay(selectedDate, -1));
  }, [allRooms, roomMode, selectedDate, view]);

  const handleNext = useCallback(() => {
    if (view === "mySchedule") {
      setSelectedDate(formatDateKey(addDays(parseDateKey(selectedDate), 7)));
      return;
    }
    if (view === "room") {
      const isAllRooms = allRooms;
      if (!isAllRooms && roomMode === "week") {
        const delta = 7;
        setSelectedDate(formatDateKey(addDays(parseDateKey(selectedDate), delta)));
        return;
      }
      setSelectedDate(shiftSchoolDay(selectedDate, 1));
      return;
    }
    setSelectedDate(shiftSchoolDay(selectedDate, 1));
  }, [allRooms, roomMode, selectedDate, view]);

  useEffect(() => {
    if (!onContextChange) return;
    const liveClockKey = view === "live"
      ? now.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
      : "";
    const contextKey = [view, roomMode, allRooms ? "all" : "single", selectedDate, selectedRoom, roomsKey, liveClockKey].join("::");
    if (lastContextKeyRef.current === contextKey) {
      return;
    }
    lastContextKeyRef.current = contextKey;
    const titles: Record<ViewMode, string> = {
      live: "עכשיו",
      room: "לוח זמנים",
      finder: "איתור חדרים",
      reservations: "השעות שלי",
      mySchedule: "המערכת שלי"
    };

    const dayLabel = weekDays.find((day) => day.key === selectedDayKey)?.label || "";
    const shortDate = formatShortDate(selectedDate);
    const navText = view === "room" && roomMode === "week" && !allRooms
      ? `שבוע ${getWeekNumber(selectedDate)}`
      : `${dayLabel} · ${shortDate}`;

    const context: TopBarContext = {
      title: titles[view]
    };

    if (view === "room") {
      const roomOptions = rooms.map((room) => ({ id: room.id, label: room.name || room.shortName || room.id }));
      const roomSelect = (
        <label className="top-bar-select inline no-caret">
          <span className="sr-only">חדר</span>
          <select
            value={selectedRoom}
            onChange={(event) => {
              setAllRooms(false);
              setSelectedRoom(event.target.value);
            }}
          >
            {roomOptions.map((room) => (
              <option key={room.id} value={room.id}>
                {room.label}
              </option>
            ))}
          </select>
        </label>
      );
      const roomControl = allRooms ? (
        <button
          type="button"
          className="top-bar-room-all"
          onClick={() => setAllRooms(false)}
          aria-label="בחירת חדר"
        >
          כל החדרים
        </button>
      ) : (
        roomSelect
      );
      const roomIdList = roomOptions.map((opt) => opt.id);
      const roomIndex = Math.max(0, roomIdList.indexOf(selectedRoom));
      const shiftRoom = (delta: number) => {
        if (!roomIdList.length) return;
        const next = (roomIndex + delta + roomIdList.length) % roomIdList.length;
        setAllRooms(false);
        setSelectedRoom(roomIdList[next]);
      };
      context.subtitle = (
        <div className="top-bar-schedule">
          <div className="top-bar-schedule-row">
            <div className="top-bar-field schedule-date">
              <div className="top-bar-field-hints">
                <span className="top-bar-field-hint">תאריך</span>
                <button
                  type="button"
                  className="top-bar-mode-mini"
                  onClick={() => {
                    setAllRooms(false);
                    setRoomMode((prev) => (prev === "day" ? "week" : "day"));
                  }}
                  aria-pressed={roomMode === "week"}
                  aria-label="החלפת תצוגה"
                >
                  <CalendarIcon />
                  <span>תצוגה שבועית</span>
                </button>
              </div>
              <div className="top-bar-date-pill schedule">
                <button type="button" className="icon-button inline" onClick={handlePrev} aria-label="הקודם">
                  <ChevronRightIcon />
                </button>
                <button
                  type="button"
                  className="top-bar-date-button"
                  onClick={openDatePicker}
                >
                  {navText}
                </button>
                <button type="button" className="icon-button inline" onClick={handleNext} aria-label="הבא">
                  <ChevronLeftIcon />
                </button>
              </div>
              <input
                ref={dateInputRef}
                className="top-bar-date-input"
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
              />
            </div>
            <div className="top-bar-field schedule-room">
              <div className="top-bar-field-hints">
                <span className="top-bar-field-hint">חדר</span>
                <button
                  type="button"
                  className="top-bar-mode-mini"
                  onClick={() => {
                    setAllRooms((prev) => {
                      const next = !prev;
                      if (next) setRoomMode("day");
                      return next;
                    });
                  }}
                  aria-pressed={allRooms}
                  aria-label="תצוגת כל החדרים"
                >
                  <RoomIcon />
                  <span>כל החדרים</span>
                </button>
              </div>
              <div className="top-bar-room-pill">
                <button
                  type="button"
                  className="icon-button inline"
                  onClick={() => shiftRoom(-1)}
                  aria-label="חדר קודם"
                >
                  <ChevronRightIcon />
                </button>
                {roomControl}
                <button
                  type="button"
                  className="icon-button inline"
                  onClick={() => shiftRoom(1)}
                  aria-label="חדר הבא"
                >
                  <ChevronLeftIcon />
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    } else if (view === "finder") {
      context.subtitle = "איתור חדרים פנויים לפי ההעדפות שלי";
    } else if (view === "reservations") {
      context.subtitle = "כל החדרים ששריינתי";
      context.controls = (
        <button
          type="button"
          className="icon-button"
          aria-label="סגירה"
          onClick={() => onViewChange(lastMainViewRef.current || "room")}
        >
          <CloseIcon />
        </button>
      );
    } else if (view === "mySchedule") {
      const weekStart = weekDates[0]?.dateKey;
      const weekEnd = weekDates[weekDates.length - 1]?.dateKey;
      context.navLabel = `שבוע ${getWeekNumber(selectedDate)}`;
      context.onPrev = handlePrev;
      context.onNext = handleNext;
      context.subtitle = weekStart && weekEnd ? `${formatShortDate(weekStart)}–${formatShortDate(weekEnd)}` : "";
      context.controls = (
        <button
          type="button"
          className="icon-button"
          aria-label="סגירה"
          onClick={() => onViewChange(lastMainViewRef.current || "room")}
        >
          <CloseIcon />
        </button>
      );
    } else if (view === "live") {
      const today = parseDateKey(todayDateKey);
      const weekdayLabel = new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(today);
      const dateLabel = new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit" }).format(today);
      const todayReservations = reservationMap[todayDateKey] || [];
      const isWeekend = today.getDay() === 5 || today.getDay() === 6;
      const isClosedNow = isWeekend || nowMinutes < config.startHour * 60 || nowMinutes >= config.endHour * 60;
      const todayLessons = getLessonsForDate(todayDateKey, todayDayKey);

      const availableCount = rooms.filter((room) => {
        const policy = roomMeta?.[room.id];
        const roomOpen = policy?.openMinutes ?? config.startHour * 60;
        const roomClose = policy?.closeMinutes ?? config.endHour * 60;
        if (policy?.isClosed) return false;
        if (isClosedNow || nowMinutes < roomOpen || nowMinutes >= roomClose) return false;
        const activeLesson = todayLessons.some((lesson) => {
          if (lesson.roomId !== room.id) return false;
          return lesson.startMinutes <= nowMinutes && lesson.startMinutes + lesson.durationMinutes > nowMinutes;
        });
        if (activeLesson) return false;
        const activeReservation = todayReservations.some((entry) => {
          if (entry.roomId !== room.id) return false;
          return entry.time <= nowMinutes && entry.time + entry.durationMinutes > nowMinutes;
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
    reservationMap,
    getLessonsForDate,
    config.startHour,
    config.endHour,
    roomMeta
  ]);

  const renderView = () => {
    if (view === "live") {
      return (
        <LiveView
          rooms={rooms}
          lessons={getLessonsForDate(todayDateKey, todayDayKey)}
          reservationMap={reservationMap}
          dateKey={todayDateKey}
          dayKey={todayDayKey}
          nowMinutes={nowMinutes}
          startHour={config.startHour}
          endHour={config.endHour}
          roomMeta={roomMeta}
          onRoomSelect={(roomId) => handleRoomSelect(roomId, todayDateKey)}
        />
      );
    }

    if (view === "finder") {
      return (
        <BookingFinder
          rooms={rooms}
          lessons={lessons}
          reservationMap={reservationMap}
          startHour={config.startHour}
          endHour={config.endHour}
          roomMeta={roomMeta}
          getLessonsForDate={getLessonsForDate}
          onReserve={handleReserve}
          onOpenSchedule={(roomId, dateKey) => handleRoomSelect(roomId, dateKey)}
          onDateWindowChange={(startDate, endDate) => setFinderWindow({ startDate, endDate })}
        />
      );
    }

    if (view === "mySchedule") {
      return (
        <MyScheduleView
          weekDates={weekDates}
          rooms={rooms}
          reservationMap={reservationMap}
          currentUser={currentUser}
          pins={myPins}
          onEditReservation={handleEditReservation}
          onOpenPinned={(pin) =>
            setBlockDetails({
              kind: pin.kind,
              dateKey: pin.dateKey,
              roomId: pin.roomId,
              startMinutes: pin.startMinutes,
              durationMinutes: pin.durationMinutes,
              title: pin.title,
              meta: pin.meta
            })
          }
        />
      );
    }

    if (view === "reservations") {
      const reservations = Object.entries(reservationMap)
        .flatMap(([dateKey, entries]) =>
          entries
            .filter((entry) => entry.reservedEmail === currentUser?.email)
            .map((entry) => ({ ...entry, dateKey }))
        )
        .sort((a, b) => {
          if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
          return a.time - b.time;
        });

      return (
        <section className="finder reservations">
          {reservations.length ? (
            <ul className="finder-result-list">
              {reservations.map((entry) => {
                const endMinutes = entry.time + entry.durationMinutes;
                const roomName = rooms.find((room) => room.id === entry.roomId)?.name || entry.roomId;
                const dayLabel =
                  weekDays.find((day) => day.key === getDayKeyFromDateKey(entry.dateKey))?.label || "";
                return (
                  <li
                    key={entry.id}
                    className="finder-result reserved clickable"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleEditReservation(entry.dateKey, entry.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleEditReservation(entry.dateKey, entry.id);
                      }
                    }}
                  >
                    <div>
                      <p className="finder-result-title">
                        <span className="dot reserved" /> {roomName}
                      </p>
                      <p className="finder-result-meta">
                        יום {dayLabel} · {formatShortDate(entry.dateKey)} ·{" "}
                        {formatMinutes(entry.time)}–{formatMinutes(endMinutes)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Release"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRelease(entry.dateKey, entry.id);
                      }}
                    >
                      <ReleaseIcon />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>אין לך שריונים פעילים.</p>
          )}
        </section>
      );
    }

    return (
      <>
        {/** schedule view */}
        <ScheduleGrid
          view={allRooms ? "daily" : "room"}
          rooms={rooms}
          weekDates={view === "room" ? roomDates : weekDates}
          timeSlots={timeSlots}
          selectedDate={selectedDate}
          selectedDayKey={selectedDayKey}
          selectedRoom={selectedRoom}
          lessons={lessons}
          roomMeta={roomMeta}
          getLessonsForDate={getLessonsForDate}
          reservationMap={reservationMap}
          currentUser={currentUser}
          onReserve={handleReserve}
          onRelease={handleRelease}
          onEditReservation={handleEditReservation}
          onLessonDetails={handleLessonDetails}
          onSpecialDetails={handleSpecialDetails}
          onClosedDetails={handleClosedDetails}
          onAdminSlotClick={handleAdminSlotClick}
          onAdminLessonClick={handleAdminLessonClick}
          onAdminReservationClick={handleAdminReservationClick}
          onReservationClick={handleReservationDetails}
          adminMode={effectiveAdminMode}
          startHour={config.startHour}
          endHour={config.endHour}
          compact={allRooms || roomMode === "week"}
          compactLabel={allRooms ? "status" : "title"}
          onRoomSelect={allRooms ? handleRoomSelect : undefined}
          onDateSelect={roomMode === "week" ? handleDaySelect : undefined}
          showHeaders={allRooms || roomMode === "week"}
          footer={<Legend />}
          nowMinutes={nowMinutes}
          todayDateKey={todayDateKey}
        />
      </>
    );
  };

  const scheduleView = view === "room";

  const formatDurationLabel = (minutes: number) => {
    if (minutes === 30) return "חצי שעה";
    if (minutes === 45) return "45 דקות";
    if (minutes === 60) return "שעה";
    if (minutes === 75) return "שעה ורבע";
    if (minutes === 90) return "שעה וחצי";
    if (minutes === 105) return "שעה ו-45 דקות";
    if (minutes === 120) return "שעתיים";
    if (minutes >= 150 && minutes % 30 === 0) {
      const hours = minutes / 60;
      return Number.isInteger(hours) ? `${hours} שעות` : `${hours.toFixed(1)} שעות`;
    }
    const hours = minutes / 60;
    if (Number.isInteger(hours)) return `${hours} שעות`;
    return `${hours.toFixed(2)} שעות`;
  };

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
      `${formatDurationLabel(pendingReleaseEntry.durationMinutes)}`
    : "";

  const detailsReservation = reservationDetails?.reservation || null;
  useEffect(() => {
    const email = (detailsReservation?.reservedEmail || "").trim().toLowerCase();
    if (!email) {
      setDetailsContact(null);
      return;
    }
    const cached = contactCacheRef.current.get(email);
    if (cached) {
      setDetailsContact(cached);
      return;
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
          setDetailsContact(null);
          return;
        }
        const data = snap.data() as { name?: unknown; phone?: unknown };
        const contact = {
          name: typeof data.name === "string" ? data.name : "",
          phone: typeof data.phone === "string" ? data.phone : ""
        };
        contactCacheRef.current.set(email, contact);
        setDetailsContact(contact);
      })
      .catch(() => {
        if (cancelled) return;
        setDetailsContact(null);
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
      `${formatDurationLabel(detailsDuration)}`
    : "";
  const detailsName = detailsReservation?.reservedBy || detailsContact?.name || "";
  const detailsEmail = detailsReservation?.reservedEmail || "";
  const detailsPhone = detailsContact?.phone || "";

  const adminDateLabel = adminDraft
    ? `יום ${weekDays.find((day) => day.key === adminDraft.dayKey)?.label || ""} ${formatShortDate(adminDraft.dateKey)}`
    : "";
  const adminTypeLabel = adminDraft
    ? (adminDraft.type === "lesson"
      ? "שיעור"
      : adminDraft.type === "special"
        ? "אירוע"
        : adminDraft.type === "closed"
          ? "סגור"
          : "שריון")
    : "";
  const adminTimeLabel = adminDraft
    ? `בין ${formatMinutes(adminDraft.startMinutes)}-` +
      `${formatMinutes(adminDraft.startMinutes + adminDraft.durationMinutes)}`
    : "";
  const adminEndMinutes = adminDraft ? adminDraft.startMinutes + adminDraft.durationMinutes : 0;

  const buildEndOptions = (draft: AdminDraft) => {
    const policy = roomMeta?.[draft.roomId];
    const maxEnd = policy?.closeMinutes ?? config.endHour * 60;
    const minEnd = draft.startMinutes + 30;
    const options: { value: number; label: string }[] = [];
    for (let duration = 30; draft.startMinutes + duration <= maxEnd; ) {
      const end = draft.startMinutes + duration;
      if (end >= minEnd) {
        options.push({
          value: end,
          label: `${formatMinutes(end)} (${formatDurationLabel(duration)})`
        });
      }
      duration += duration < 120 ? 15 : 30;
    }
    const currentEnd = draft.startMinutes + draft.durationMinutes;
    if (currentEnd > draft.startMinutes && currentEnd <= maxEnd && !options.find((opt) => opt.value === currentEnd)) {
      options.push({
        value: currentEnd,
        label: `${formatMinutes(currentEnd)} (${formatDurationLabel(currentEnd - draft.startMinutes)})`
      });
    }
    options.sort((a, b) => a.value - b.value);
    return options;
  };

  return (
    <div className={`booking-shell${scheduleView ? " schedule-view" : ""}`}>
      <div className="view-shell">{renderView()}</div>
      {toast ? (
        <div
          className={`home-toast${toast.tone === "error" ? " error" : ""}`}
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
          userRemainingMinutes={pendingConfirm.userRemainingMinutes}
          mode={pendingConfirm.mode}
          onRelease={
            pendingConfirm.mode === "edit" && pendingConfirm.reservationId
              ? () => {
                  handleRelease(pendingConfirm.request.date, pendingConfirm.reservationId!);
                  setPendingConfirm(null);
                }
              : undefined
          }
          onConfirm={(startMinutes, durationMinutes) => {
            if (pendingConfirm.mode === "edit") {
              void handleConfirmEdit(pendingConfirm, startMinutes, durationMinutes);
              return;
            }
            handleConfirmReserve(pendingConfirm.request, startMinutes, durationMinutes);
          }}
          onClose={() => setPendingConfirm(null)}
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
        pictureUrl={currentUser && detailsEmail && currentUser.email.toLowerCase() === detailsEmail.toLowerCase() ? (currentUser.picture || "") : undefined}
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
            ? rooms.find((room) => room.id === blockDetails.roomId)?.name || blockDetails.roomId
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
              `${formatDurationLabel(blockDetails.durationMinutes)}`
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
              currentUser?.email &&
              myPins.some(
                (pin) =>
                  pin.id ===
                  pinIdFor({
                    kind: blockDetails.kind,
                    dateKey: blockDetails.dateKey,
                    roomId: blockDetails.roomId,
                    startMinutes: blockDetails.startMinutes,
                    durationMinutes: blockDetails.durationMinutes
                  })
              )
          )
        }
        onTogglePin={blockDetails && currentUser?.email ? () => togglePin(blockDetails) : undefined}
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
      {adminDraft ? (
        <div className="admin-overlay" onClick={() => setAdminDraft(null)}>
          <div className="admin-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-modal-header">
              <div>
                <p className="admin-title">
                  {adminTypeLabel} ·{" "}
                  {adminDraft.mode === "create" ? "חדש" : "עריכה"}
                </p>
                <p className="admin-subtitle">{adminDateLabel} · {adminTimeLabel}</p>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="סגירה"
                onClick={() => setAdminDraft(null)}
              >
                <CloseIcon />
              </button>
            </div>
            {adminDraft.mode === "create" ? (
              <div className="admin-type-grid">
                <button
                  type="button"
                  className={`admin-type-card lesson${adminDraft.type === "lesson" ? " active" : ""}`}
                  onClick={() => switchAdminType("lesson")}
                >
                  <LessonTypeIcon />
                  <span>שיעור</span>
                </button>
                <button
                  type="button"
                  className={`admin-type-card reservation${adminDraft.type === "reservation" ? " active" : ""}`}
                  onClick={() => switchAdminType("reservation")}
                >
                  <ReservationIcon />
                  <span>שריון</span>
                </button>
                <button
                  type="button"
                  className={`admin-type-card special${adminDraft.type === "special" ? " active" : ""}`}
                  onClick={() => switchAdminType("special")}
                >
                  <SpecialIcon />
                  <span>אירוע</span>
                </button>
                <button
                  type="button"
                  className={`admin-type-card closed${adminDraft.type === "closed" ? " active" : ""}`}
                  onClick={() => switchAdminType("closed")}
                >
                  <ClosedIcon />
                  <span>סגור</span>
                </button>
              </div>
            ) : null}
            <div className="admin-form">
              <label>
                חדר
                <select
                  value={adminDraft.roomId}
                  onChange={(event) =>
                    setAdminDraft((prev) =>
                      prev ? { ...prev, roomId: event.target.value } as AdminDraft : prev
                    )
                  }
                >
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>{room.name}</option>
                  ))}
                </select>
              </label>
              <div className="admin-form-row">
                <label>
                  שעת התחלה
                  <input
                    type="time"
                    value={toTimeInput(adminDraft.startMinutes)}
                    onChange={(event) =>
                      setAdminDraft((prev) =>
                        prev ? { ...prev, startMinutes: parseTimeInput(event.target.value) } as AdminDraft : prev
                      )
                    }
                  />
                </label>
                <label>
                  שעת סיום
                  <select
                    value={adminEndMinutes}
                    onChange={(event) => {
                      const endMinutes = Number(event.target.value);
                      setAdminDraft((prev) =>
                        prev ? { ...prev, durationMinutes: Math.max(15, endMinutes - prev.startMinutes) } as AdminDraft : prev
                      );
                    }}
                  >
                    {adminDraft ? buildEndOptions(adminDraft).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    )) : null}
                  </select>
                </label>
              </div>
              {adminDraft.type === "lesson" ? (
                <>
                  <label>
                    שם שיעור
                    <input
                      type="text"
                      value={adminDraft.title}
                      onChange={(event) =>
                        setAdminDraft((prev) =>
                          prev && prev.type === "lesson"
                            ? { ...prev, title: event.target.value }
                            : prev
                        )
                      }
                    />
                  </label>
                  <label>
                    מרצה
                    <input
                      type="text"
                      value={adminDraft.teacher}
                      onChange={(event) =>
                        setAdminDraft((prev) =>
                          prev && prev.type === "lesson"
                            ? { ...prev, teacher: event.target.value }
                            : prev
                        )
                      }
                    />
                  </label>
                </>
              ) : adminDraft.type === "special" || adminDraft.type === "closed" ? (
                <label>
                  תיאור
                  <input
                    type="text"
                    value={adminDraft.label}
                    onChange={(event) =>
                      setAdminDraft((prev) =>
                        prev && (prev.type === "special" || prev.type === "closed")
                          ? { ...prev, label: event.target.value }
                          : prev
                      )
                    }
                  />
                </label>
              ) : (
                <>
                  <label>
                    משתמש
                    <div className="admin-user-select">
                      <input
                        type="text"
                        placeholder="חיפוש לפי שם או אימייל"
                        value={reservationUserQuery}
                        onFocus={() => setReservationUserOpen(true)}
                        onChange={(event) => {
                          const next = event.target.value;
                          setReservationUserQuery(next);
                          const match = findUserMatch(next);
                          if (match) {
                            const label = formatUserLabel(match.name || "", match.email);
                            lastValidReservationUser.current = {
                              label,
                              email: match.email,
                              name: match.name || ""
                            };
                            setAdminDraft((prev) =>
                              prev && prev.type === "reservation"
                                ? { ...prev, reservedEmail: match.email, reservedBy: match.name || "" }
                                : prev
                            );
                          }
                        }}
                        onBlur={() => {
                          const match = findUserMatch(reservationUserQuery);
                          if (match) {
                            const label = formatUserLabel(match.name || "", match.email);
                            lastValidReservationUser.current = {
                              label,
                              email: match.email,
                              name: match.name || ""
                            };
                            setReservationUserQuery(label);
                            setAdminDraft((prev) =>
                              prev && prev.type === "reservation"
                                ? { ...prev, reservedEmail: match.email, reservedBy: match.name || "" }
                                : prev
                            );
                          } else if (lastValidReservationUser.current) {
                            setReservationUserQuery(lastValidReservationUser.current.label);
                            setAdminDraft((prev) =>
                              prev && prev.type === "reservation"
                                ? {
                                  ...prev,
                                  reservedEmail: lastValidReservationUser.current!.email,
                                  reservedBy: lastValidReservationUser.current!.name
                                }
                                : prev
                            );
                          } else {
                            setReservationUserQuery("");
                          }
                          setReservationUserOpen(false);
                        }}
                      />
                      {reservationUserOpen && filteredUsers.length ? (
                        <div className="admin-user-options">
                          {filteredUsers.map((u) => {
                            const label = formatUserLabel(u.name || "", u.email);
                            return (
                              <button
                                type="button"
                                key={u.email}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  lastValidReservationUser.current = {
                                    label,
                                    email: u.email,
                                    name: u.name || ""
                                  };
                                  setReservationUserQuery(label);
                                  setAdminDraft((prev) =>
                                    prev && prev.type === "reservation"
                                      ? { ...prev, reservedEmail: u.email, reservedBy: u.name || "" }
                                      : prev
                                  );
                                  setReservationUserOpen(false);
                                }}
                              >
                                <span className="admin-user-name">{u.name || "ללא שם"}</span>
                                <span className="admin-user-email">{u.email}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  </label>
                </>
              )}
              {adminError ? <p className="admin-error">{adminError}</p> : null}
            </div>
            <div className="admin-actions">
              {adminDraft.mode === "edit" && adminDraft.type === "lesson" ? (
                <button type="button" className="secondary danger" onClick={handleAdminDeleteLesson}>
                  מחיקה ליום זה
                </button>
              ) : null}
              {adminDraft.mode === "edit" && (adminDraft.type === "reservation" || adminDraft.type === "special" || adminDraft.type === "closed") ? (
                <button type="button" className="secondary danger" onClick={handleAdminDeleteReservation}>
                  מחיקת שריון
                </button>
              ) : null}
              <button type="button" className="secondary" onClick={() => setAdminDraft(null)}>
                ביטול
              </button>
              <button type="button" className="primary" onClick={handleAdminSave} disabled={!effectiveAdminMode}>
                שמירה
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
