import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ScheduleGrid from "./views/ScheduleGrid";
import Legend from "./views/Legend";
import LiveView from "./views/LiveView";
import BottomNav from "../../components/BottomNav";
import BookingFinder from "./views/BookingFinder";
import ReserveConfirmOverlay from "./overlays/ReserveConfirmOverlay";
import ReservationDetailsOverlay from "./overlays/ReservationDetailsOverlay";
import ConfirmOverlay from "./overlays/ConfirmOverlay";
import { useSchedule } from "../../hooks/useSchedule";
import { useLessonOverrides } from "../../hooks/useLessonOverrides";
import { useDirectoryUsers } from "../../hooks/useDirectoryUsers";
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
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ReleaseIcon, LessonTypeIcon, ReservationIcon, SpecialIcon, ClosedIcon } from "../../components/Icons";
import type { User } from "../../types/auth";
import type { Reservation, ReservationMap, ReserveRequest } from "../../types/reservations";
import type { DayKey, Lesson } from "../../types/schedule";
import type { TopBarContext, ViewMode } from "../../types/ui";

const ALL_ROOMS_ID = "__all__";

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

export type HomeScreenProps = {
  currentUser: User | null;
  setAuthError: (message: string) => void;
  onContextChange?: (context: TopBarContext) => void;
  reservationMap: ReservationMap;
  addReservation: (reservation: Reservation) => void;
  upsertReservation: (reservation: Reservation) => void;
  releaseReservation: (dateKey: string, reservationId: string) => void;
  requestedView?: ViewMode | null;
  onRequestedViewHandled?: () => void;
  showNav?: boolean;
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
  reservationMap,
  addReservation,
  upsertReservation,
  releaseReservation,
  requestedView,
  onRequestedViewHandled,
  showNav = true,
  adminMode = false
}: HomeScreenProps) {
  const [view, setView] = useState<ViewMode>("live");
  const [selectedDate, setSelectedDate] = useState(() => formatDateKey(new Date()));
  const [selectedRoom, setSelectedRoom] = useState(ALL_ROOMS_ID);
  const [roomMode, setRoomMode] = useState<"day" | "week">("day");
  const [now, setNow] = useState(() => new Date());
  const [reserveDraft, setReserveDraft] = useState<ReserveRequest | null>(null);
  const [reserveOptions, setReserveOptions] = useState<{ durationMinutes: number; endMinutes: number }[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<{ request: ReserveRequest; durationMinutes: number } | null>(null);
  const [pendingRelease, setPendingRelease] = useState<{ dateKey: string; reservationId: string } | null>(null);
  const [reservationDetails, setReservationDetails] = useState<{ reservation: Reservation; dateKey: string } | null>(null);
  const [adminError, setAdminError] = useState("");
  const [adminDraft, setAdminDraft] = useState<AdminDraft | null>(null);
  const prevViewRef = useRef<ViewMode>("live");
  const lastMainViewRef = useRef<ViewMode>("live");
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const lastContextKeyRef = useRef<string>("");
  const [reservationUserQuery, setReservationUserQuery] = useState("");
  const [reservationUserOpen, setReservationUserOpen] = useState(false);
  const lastValidReservationUser = useRef<{ label: string; email: string; name: string } | null>(null);

  const openDatePicker = () => {
    if (!dateInputRef.current) return;
    const picker = dateInputRef.current as HTMLInputElement & { showPicker?: () => void };
    if (picker.showPicker) {
      picker.showPicker();
    } else {
      picker.click();
    }
  };


  const todayDateKey = formatDateKey(now);
  const scheduleDateKey = view === "live" ? todayDateKey : selectedDate;
  const isLocked = !currentUser?.allowed;
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "moderator";

  const { rooms, weekDays, timeSlots, lessons, config, roomMeta } = useSchedule(scheduleDateKey);
  const { overridesByDate, addOverride } = useLessonOverrides();
  const { users } = useDirectoryUsers();

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (view === "room" && prevViewRef.current !== "room") {
      setRoomMode("day");
    }
    prevViewRef.current = view;
    if (view !== "reservations") {
      lastMainViewRef.current = view;
    }
  }, [view]);

  const effectiveAdminMode = adminMode && isAdmin;

  useEffect(() => {
    const isDailyView = view === "room" && (selectedRoom === ALL_ROOMS_ID || roomMode === "day");
    if (isDailyView && isWeekend(selectedDate)) {
      setSelectedDate(shiftSchoolDay(selectedDate, 1));
    }
  }, [roomMode, selectedDate, view, selectedRoom]);

  useEffect(() => {
    if (isLocked && view !== "live") {
      setView("live");
    }
  }, [isLocked, view]);

  useEffect(() => {
    if (!adminMode) {
      setAdminDraft(null);
      setAdminError("");
    }
  }, [adminMode]);

  useEffect(() => {
    if (!requestedView) return;
    setView(requestedView);
    onRequestedViewHandled?.();
  }, [onRequestedViewHandled, requestedView]);

  useEffect(() => {
    if (!reserveDraft) return;
    const sameDate = reserveDraft.date === selectedDate;
    const sameRoom = selectedRoom === ALL_ROOMS_ID || reserveDraft.roomId === selectedRoom;
    const validView = view === "room" && (selectedRoom === ALL_ROOMS_ID || roomMode === "day");
    if (!sameDate || !sameRoom || !validView) {
      setReserveDraft(null);
      setReserveOptions([]);
    }
  }, [reserveDraft, selectedDate, selectedRoom, view, roomMode]);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayDayKey = getDayKeyFromDateKey(todayDateKey);

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
    const exact = users.find((user) => user.email.toLowerCase() === raw);
    if (exact) return exact;
    return users.find((user) => formatUserLabel(user.name || "", user.email).toLowerCase() === raw) || null;
  };
  const filteredUsers = useMemo(() => {
    const query = reservationUserQuery.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) => {
      const label = formatUserLabel(user.name || "", user.email).toLowerCase();
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
    if (!rooms.length) return;
    const exists = rooms.some((room) => room.id === selectedRoom);
    if (selectedRoom !== ALL_ROOMS_ID && !exists) {
      setSelectedRoom(ALL_ROOMS_ID);
    }
  }, [rooms, selectedRoom]);

  useEffect(() => {
    if (selectedRoom === ALL_ROOMS_ID && roomMode !== "day") {
      setRoomMode("day");
    }
  }, [selectedRoom, roomMode]);


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

  const getMaxDurationMinutes = (request: ReserveRequest) => {
    const intervals = buildIntervals(request.day, request.date, request.roomId);
    const policy = roomMeta?.[request.roomId];
    if (policy?.isClosed) return 0;
    const minStart = policy?.openMinutes ?? config.startHour * 60;
    const maxEnd = policy?.closeMinutes ?? config.endHour * 60;
    const start = request.time;
    if (start < minStart) return 0;

    const overlaps = intervals.some((interval) => interval.start < start && interval.end > start);
    if (overlaps) return 0;

    const nextStart = intervals
      .map((interval) => interval.start)
      .filter((value) => value >= start && value < maxEnd)
      .sort((a, b) => a - b)[0];

    const limit = nextStart ?? maxEnd;
    return Math.max(0, limit - start);
  };

  const handleReserve = (request: ReserveRequest) => {
    if (!currentUser?.allowed) {
      setAuthError("יש להתחבר עם חשבון סטודנט מאושר.");
      return;
    }

    const maxDuration = getMaxDurationMinutes(request);
    if (request.durationMinutes) {
      if (request.durationMinutes > maxDuration || request.durationMinutes < 60) return;
      setReserveDraft(null);
      setReserveOptions([]);
      setPendingConfirm({ request, durationMinutes: request.durationMinutes });
      if (view === "finder") {
        setSelectedRoom(request.roomId);
        setSelectedDate(request.date);
        setRoomMode("day");
        setView("room");
      }
      return;
    }
    const maxHours = Math.min(6, Math.floor(maxDuration / 60));
    if (maxHours < 1) return;

    if (maxHours === 1) {
      setReserveDraft(null);
      setReserveOptions([]);
      setPendingConfirm({ request, durationMinutes: 60 });
    } else {
      setReserveDraft(request);
      setPendingConfirm(null);
      setReserveOptions(
        Array.from({ length: maxHours }, (_, index) => {
          const durationMinutes = (index + 1) * 60;
          return { durationMinutes, endMinutes: request.time + durationMinutes };
        })
      );
    }

    if (view === "finder") {
      setSelectedRoom(request.roomId);
      setSelectedDate(request.date);
      setRoomMode("day");
      setView("room");
      return;
    }

    if (view === "room" && (selectedRoom === ALL_ROOMS_ID || roomMode === "week")) {
      setSelectedRoom(request.roomId);
      setSelectedDate(request.date);
      setRoomMode("day");
      setView("room");
    }
  };

  const handleSelectOption = (durationMinutes: number) => {
    if (!reserveDraft) return;
    setPendingConfirm({ request: reserveDraft, durationMinutes });
    setReserveOptions([]);
  };

  const handleCancelDraft = () => {
    setReserveDraft(null);
    setReserveOptions([]);
  };

  const handleConfirmReserve = (draft: ReserveRequest, durationMinutes: number) => {
    if (!currentUser?.allowed) return;
    const { date, day, time, roomId } = draft;

    const policy = roomMeta?.[roomId];
    if (policy?.isClosed) {
      setAuthError("החדר סגור זמנית.");
      return;
    }
    const roomOpen = policy?.openMinutes ?? config.startHour * 60;
    const roomClose = policy?.closeMinutes ?? config.endHour * 60;
    if (time < roomOpen || time + durationMinutes > roomClose) {
      setAuthError("השעה מחוץ לשעות הפעילות של החדר.");
      return;
    }

    const dayLessons = getLessonsForDate(date, day);
    const overlapsLesson = dayLessons.some((lesson) => {
      if (lesson.roomId !== roomId) return false;
      const lessonEnd = lesson.startMinutes + lesson.durationMinutes;
      return lesson.startMinutes < time + durationMinutes && lessonEnd > time;
    });

    if (overlapsLesson) return;

    const overlapsReservation = (reservationMap[date] || []).some((entry) => {
      if (entry.roomId !== roomId) return false;
      const entryEnd = entry.time + entry.durationMinutes;
      return entry.time < time + durationMinutes && entryEnd > time;
    });

    if (overlapsReservation) return;

    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `res-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    addReservation({
      id,
      date,
      time,
      durationMinutes,
      roomId,
      reservedBy: currentUser.name,
      reservedEmail: currentUser.email
    });
    setReserveDraft(null);
    setReserveOptions([]);
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
    if (!adminDraft || !effectiveAdminMode) return;
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
      await addOverride({
        date: adminDraft.dateKey,
        action,
        targetLessonId: adminDraft.targetLessonId,
        lesson,
        createdBy: currentUser?.email
      });
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
      kind: adminDraft.type === "special" ? "special" : adminDraft.type === "closed" ? "closed" : undefined
    };

    if (adminDraft.mode === "create") {
      addReservation(reservation);
    } else {
      upsertReservation(reservation);
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
    releaseReservation(adminDraft.dateKey, adminDraft.reservationId);
    setAdminDraft(null);
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
    setSelectedRoom(roomId);
    setSelectedDate(dateKey);
    setRoomMode("day");
    setView("room");
  };

  const handleDaySelect = (dateKey: string) => {
    setSelectedDate(dateKey);
    setRoomMode("day");
    setView("room");
  };

  const handlePrev = useCallback(() => {
    if (view === "room") {
      const isAllRooms = selectedRoom === ALL_ROOMS_ID;
      if (!isAllRooms && roomMode === "week") {
        const delta = -7;
        setSelectedDate(formatDateKey(addDays(parseDateKey(selectedDate), delta)));
        return;
      }
      setSelectedDate(shiftSchoolDay(selectedDate, -1));
      return;
    }
    setSelectedDate(shiftSchoolDay(selectedDate, -1));
  }, [roomMode, selectedDate, selectedRoom, view]);

  const handleNext = useCallback(() => {
    if (view === "room") {
      const isAllRooms = selectedRoom === ALL_ROOMS_ID;
      if (!isAllRooms && roomMode === "week") {
        const delta = 7;
        setSelectedDate(formatDateKey(addDays(parseDateKey(selectedDate), delta)));
        return;
      }
      setSelectedDate(shiftSchoolDay(selectedDate, 1));
      return;
    }
    setSelectedDate(shiftSchoolDay(selectedDate, 1));
  }, [roomMode, selectedDate, selectedRoom, view]);

  useEffect(() => {
    if (!onContextChange) return;
    const roomsKey = rooms
      .map((room) => `${room.id}:${room.shortName || room.name || ""}`)
      .join("|");
    const contextKey = [view, roomMode, selectedDate, selectedRoom, roomsKey].join("::");
    if (lastContextKeyRef.current === contextKey) {
      return;
    }
    lastContextKeyRef.current = contextKey;
    const titles: Record<ViewMode, string> = {
      live: "עכשיו",
      room: "לוח זמנים",
      finder: "איתור חדרים",
      reservations: "השעות שלי"
    };

    const dayLabel = weekDays.find((day) => day.key === selectedDayKey)?.label || "";
    const shortDate = formatShortDate(selectedDate);
    const navText = view === "room" && roomMode === "week" && selectedRoom !== ALL_ROOMS_ID
      ? `שבוע ${getWeekNumber(selectedDate)}`
      : `${dayLabel} · ${shortDate}`;

    const context: TopBarContext = {
      title: titles[view]
    };

    if (view === "room") {
      const roomOptions = [
        { id: ALL_ROOMS_ID, label: "כל החדרים" },
        ...rooms.map((room) => ({ id: room.id, label: room.shortName || room.name }))
      ];
      const roomSelect = (
        <label className="top-bar-select inline">
          <span className="sr-only">חדר</span>
          <select
            value={selectedRoom}
            onChange={(event) => {
              setSelectedRoom(event.target.value);
              setRoomMode("day");
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
      const isAllRooms = selectedRoom === ALL_ROOMS_ID;
      context.title = (
        <div className="top-bar-title-block">
          <div>לוח זמנים</div>
          <div className="mode-toggle-title">
            <div className={`mode-toggle small${isAllRooms ? " disabled" : ""}`}>
              <button
                type="button"
                className={roomMode === "day" ? "active" : ""}
                onClick={() => setRoomMode("day")}
                disabled={isAllRooms}
              >
                יומי
              </button>
              <button
                type="button"
                className={roomMode === "week" ? "active" : ""}
                onClick={() => setRoomMode("week")}
                disabled={isAllRooms}
              >
                שבועי
              </button>
            </div>
          </div>
        </div>
      );
      context.subtitle = (
        <div className="top-bar-subtitle-block">
          <div className="top-bar-subline inline-controls">
            {roomMode === "day" ? <span className="top-bar-inline-label">ליום</span> : null}
            <div className="top-bar-date-pill">
              <button type="button" className="icon-button inline" onClick={handlePrev} aria-label="הקודם">
                <ChevronRightIcon />
              </button>
              <button
                type="button"
                className={`top-bar-date-button${roomMode === "week" ? " narrow" : ""}`}
                onClick={openDatePicker}
              >
                {navText}
              </button>
              <button type="button" className="icon-button inline" onClick={handleNext} aria-label="הבא">
                <ChevronLeftIcon />
              </button>
            </div>
            <span className="top-bar-inline-label">לחדר</span>
            {roomSelect}
            <input
              ref={dateInputRef}
              className="top-bar-date-input"
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
          </div>
        </div>
      );
    } else if (view === "finder") {
      context.subtitle = "איתור חדר פנוי לפי יום, שעה ומשך.";
    } else if (view === "reservations") {
      context.subtitle = "השריונים שלי במקום אחד.";
      context.controls = (
        <button
          type="button"
          className="icon-button"
          aria-label="סגירה"
          onClick={() => setView(lastMainViewRef.current || "room")}
        >
          <CloseIcon />
        </button>
      );
    } else if (view === "live") {
      context.subtitle = "סטטוס חדרים בזמן אמת.";
    }

    onContextChange(context);
  }, [
    onContextChange,
    rooms,
    selectedRoom,
    view,
    roomMode,
    selectedDate,
    selectedDayKey,
    weekDays,
    handlePrev,
    handleNext
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
          nowLabel={now.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}
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
                  <li key={entry.id} className="finder-result reserved">
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
                      onClick={() => handleRelease(entry.dateKey, entry.id)}
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
          view={selectedRoom === ALL_ROOMS_ID ? "daily" : "room"}
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
          onAdminSlotClick={handleAdminSlotClick}
          onAdminLessonClick={handleAdminLessonClick}
          onAdminReservationClick={handleAdminReservationClick}
          onReservationClick={handleReservationDetails}
          adminMode={effectiveAdminMode}
          startHour={config.startHour}
          endHour={config.endHour}
          compact={selectedRoom === ALL_ROOMS_ID || roomMode === "week"}
          compactLabel={selectedRoom === ALL_ROOMS_ID ? "status" : "title"}
          onRoomSelect={selectedRoom === ALL_ROOMS_ID ? handleRoomSelect : undefined}
          onDateSelect={roomMode === "week" ? handleDaySelect : undefined}
          showHeaders={selectedRoom === ALL_ROOMS_ID || roomMode === "week"}
          reserveDraft={reserveDraft}
          reserveOptions={reserveOptions}
          onSelectOption={handleSelectOption}
          onCancelDraft={handleCancelDraft}
        />
        <Legend />
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
  const detailsUser = detailsReservation
    ? users.find((user) => user.email === detailsReservation.reservedEmail) || null
    : null;
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
  const detailsName = detailsReservation?.reservedBy || detailsUser?.name || "";
  const detailsEmail = detailsReservation?.reservedEmail || detailsUser?.email || "";
  const detailsPhone = detailsUser?.phone || "";

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
      <ReserveConfirmOverlay
        open={Boolean(pendingConfirm)}
        title="שמירת חדר"
        room={
          pendingConfirm
            ? rooms.find((room) => room.id === pendingConfirm.request.roomId)?.name || ""
            : ""
        }
        dateLine={
          pendingConfirm
            ? `יום ${weekDays.find((day) => day.key === pendingConfirm.request.day)?.label || ""} ` +
              `${formatShortDate(pendingConfirm.request.date)}`
            : ""
        }
        timeLine={
          pendingConfirm
            ? `בין ${formatMinutes(pendingConfirm.request.time)}-` +
              `${formatMinutes(pendingConfirm.request.time + pendingConfirm.durationMinutes)} · ` +
              `${formatDurationLabel(pendingConfirm.durationMinutes)}`
            : ""
        }
        onConfirm={() => {
          if (!pendingConfirm) return;
          handleConfirmReserve(pendingConfirm.request, pendingConfirm.durationMinutes);
        }}
        onClose={() => {
          setPendingConfirm(null);
          setReserveDraft(null);
          setReserveOptions([]);
        }}
      />
      <ReservationDetailsOverlay
        open={Boolean(reservationDetails)}
        title="פרטי שריון"
        room={detailsRoomName}
        dateLine={detailsDateLine}
        timeLine={detailsTimeLine}
        name={detailsName}
        email={detailsEmail}
        phone={detailsPhone}
        onClose={() => setReservationDetails(null)}
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
          releaseReservation(pendingRelease.dateKey, pendingRelease.reservationId);
          setPendingRelease(null);
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
                          {filteredUsers.map((user) => {
                            const label = formatUserLabel(user.name || "", user.email);
                            return (
                              <button
                                type="button"
                                key={user.email}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  lastValidReservationUser.current = {
                                    label,
                                    email: user.email,
                                    name: user.name || ""
                                  };
                                  setReservationUserQuery(label);
                                  setAdminDraft((prev) =>
                                    prev && prev.type === "reservation"
                                      ? { ...prev, reservedEmail: user.email, reservedBy: user.name || "" }
                                      : prev
                                  );
                                  setReservationUserOpen(false);
                                }}
                              >
                                <span className="admin-user-name">{user.name || "ללא שם"}</span>
                                <span className="admin-user-email">{user.email}</span>
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
              <button type="button" className="primary" onClick={handleAdminSave}>
                שמירה
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showNav ? <BottomNav view={view} onChange={setView} locked={isLocked} /> : null}
    </div>
  );
}
