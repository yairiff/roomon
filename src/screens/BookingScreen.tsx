import { useEffect, useMemo, useRef, useState } from "react";
import ScheduleGrid from "../components/ScheduleGrid";
import Legend from "../components/Legend";
import LiveView from "../components/LiveView";
import BottomNav from "../components/BottomNav";
import BookingFinder from "../components/BookingFinder";
import ReserveConfirmOverlay from "../components/ReserveConfirmOverlay";
import ConfirmOverlay from "../components/ConfirmOverlay";
import { useSchedule } from "../hooks/useSchedule";
import {
  addDays,
  buildWeekDates,
  formatDateKey,
  formatShortDate,
  getDayKeyFromDateKey,
  getWeekNumber,
  parseDateKey
} from "../lib/date";
import { formatMinutes } from "../lib/scheduleBuilder";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ReleaseIcon } from "../components/Icons";
import type { User } from "../types/auth";
import type { Reservation, ReservationMap, ReserveRequest } from "../types/reservations";
import type { TopBarContext, ViewMode } from "../types/ui";

const ALL_ROOMS_ID = "__all__";

export type BookingScreenProps = {
  currentUser: User | null;
  setAuthError: (message: string) => void;
  onContextChange?: (context: TopBarContext) => void;
  reservationMap: ReservationMap;
  addReservation: (reservation: Reservation) => void;
  releaseReservation: (dateKey: string, reservationId: string) => void;
  requestedView?: ViewMode | null;
  onRequestedViewHandled?: () => void;
  showNav?: boolean;
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

export default function BookingScreen({
  currentUser,
  setAuthError,
  onContextChange,
  reservationMap,
  addReservation,
  releaseReservation,
  requestedView,
  onRequestedViewHandled,
  showNav = true
}: BookingScreenProps) {
  const [view, setView] = useState<ViewMode>("live");
  const [selectedDate, setSelectedDate] = useState(() => formatDateKey(new Date()));
  const [selectedRoom, setSelectedRoom] = useState(ALL_ROOMS_ID);
  const [roomMode, setRoomMode] = useState<"day" | "week">("day");
  const [now, setNow] = useState(() => new Date());
  const [reserveDraft, setReserveDraft] = useState<ReserveRequest | null>(null);
  const [reserveOptions, setReserveOptions] = useState<{ durationMinutes: number; endMinutes: number }[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<{ request: ReserveRequest; durationMinutes: number } | null>(null);
  const [pendingRelease, setPendingRelease] = useState<{ dateKey: string; reservationId: string } | null>(null);
  const prevViewRef = useRef<ViewMode>("live");
  const lastMainViewRef = useRef<ViewMode>("live");
  const dateInputRef = useRef<HTMLInputElement | null>(null);

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

  const { rooms, weekDays, timeSlots, lessons, config } = useSchedule(scheduleDateKey);

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
    const lessonIntervals = lessons
      .filter((lesson) => lesson.day === dayKey && lesson.roomId === roomId)
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
    const maxEnd = config.endHour * 60;
    const start = request.time;

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

    const overlapsLesson = lessons.some((lesson) => {
      if (lesson.day !== day || lesson.roomId !== roomId) return false;
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

  const handlePrev = () => {
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
  };

  const handleNext = () => {
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
  };

  useEffect(() => {
    if (!onContextChange) return;
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
          lessons={lessons}
          reservationMap={reservationMap}
          dateKey={todayDateKey}
          dayKey={todayDayKey}
          nowMinutes={nowMinutes}
          startHour={config.startHour}
          endHour={config.endHour}
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
          reservationMap={reservationMap}
          currentUser={currentUser}
          onReserve={handleReserve}
          onRelease={handleRelease}
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
    const hours = minutes / 60;
    if (hours === 1) return "שעה";
    if (hours === 2) return "שעתיים";
    return `${hours} שעות`;
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
      {showNav ? <BottomNav view={view} onChange={setView} locked={isLocked} /> : null}
    </div>
  );
}
