import { useMemo } from "react";
import type { WeekDate } from "../../../lib/date";
import { addDays, formatDateKey, formatShortDate, getDayKeyFromDateKey, parseDateKey } from "../../../lib/date";
import type { ReservationMap, Reservation, ReserveRequest } from "../../../types/reservations";
import type { User } from "../../../types/auth";
import type { DayKey, Lesson, Room, TimeSlot } from "../../../types/schedule";
import type { MySchedulePin } from "../../../types/mySchedule";
import ScheduleGrid from "./ScheduleGrid";
import Legend from "./Legend";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import { allWeekDays } from "../../../config";
import type { DirectoryUser } from "../../../types/admin";
import type { AvailabilityDateOffs, CollaborationGroup, RehearsalParticipant, UserAvailability } from "../../../types/collaboration";

type MyScheduleMode = "day" | "week" | "agenda";

type MyScheduleViewProps = {
  mode: MyScheduleMode;
  onModeChange: (mode: MyScheduleMode) => void;
  selectedDate: string;
  onSelectedDateChange: (dateKey: string) => void;
  agendaDays: number;
  onAgendaLoadMore: () => void;
  todayDateKey: string;
  nowMinutes: number;
  weekDates: WeekDate[];
  rooms: Room[];
  groups: CollaborationGroup[];
  directoryUsers: DirectoryUser[];
  reservationMap: ReservationMap;
  currentUser: User | null;
  pins: MySchedulePin[];
  onEditReservation: (dateKey: string, reservationId: string) => void;
  onOpenPinned: (pin: MySchedulePin) => void;
  onAddSlot: (request: ReserveRequest) => void;
  getScheduleLessonsForDate?: (dateKey: string, dayKey: DayKey) => Lesson[];
  timeSlots: TimeSlot[];
  startHour: number;
  endHour: number;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  zoomResetToken?: number;
  pendingReservationIds?: string[];
  availability: UserAvailability;
  onAvailabilityDayUpdate: (
    dayKey: DayKey,
    updates: Partial<{ enabled: boolean; startMinutes: number; endMinutes: number }>
  ) => void;
  availabilityDateOffs: AvailabilityDateOffs;
  onAvailabilityDateOffToggle: (dateKey: string, off: boolean) => void;
  availabilityEditMode: boolean;
  onLinkedRehearsalRespond?: (
    groupId: string,
    rehearsalId: string,
    status: RehearsalParticipant["status"]
  ) => void;
};

const MY_ROOM_ID = "__my_schedule__";
export const PERSONAL_PIN_ROOM_ID = "__my_schedule_personal__";

type AgendaEntry =
  | {
      kind: "reservation";
      id: string;
      dateKey: string;
      roomId: string;
      startMinutes: number;
      durationMinutes: number;
      title: string;
      meta: string;
      clickable: true;
      onClick: () => void;
    }
  | {
      kind: "pin";
      id: string;
      dateKey: string;
      roomId: string;
      startMinutes: number;
      durationMinutes: number;
      title: string;
      meta: string;
      type: MySchedulePin["kind"];
      clickable: true;
      onClick: () => void;
    };

export default function MyScheduleView({
  mode,
  onModeChange,
  selectedDate,
  onSelectedDateChange,
  agendaDays,
  onAgendaLoadMore,
  todayDateKey,
  nowMinutes,
  weekDates,
  rooms,
  groups,
  directoryUsers,
  reservationMap,
  currentUser,
  pins,
  onEditReservation,
  onOpenPinned,
  onAddSlot,
  getScheduleLessonsForDate,
  timeSlots,
  startHour,
  endHour,
  onNavigatePrev,
  onNavigateNext,
  zoomResetToken = 0,
  pendingReservationIds,
  availability,
  onAvailabilityDayUpdate,
  availabilityDateOffs,
  onAvailabilityDateOffToggle,
  availabilityEditMode,
  onLinkedRehearsalRespond
}: MyScheduleViewProps) {
  const effectiveAvailabilityEditMode = mode === "week" && availabilityEditMode;
  const email = (currentUser?.email || "").trim().toLowerCase();

  const roomName = (roomId: string) => {
    if (roomId === PERSONAL_PIN_ROOM_ID) return "אישי";
    return rooms.find((r) => r.id === roomId)?.name || roomId;
  };
  const whoLabel = (reservedEmail?: string, fallback?: string) => {
    const normalized = (reservedEmail || "").trim().toLowerCase();
    if (email && normalized && normalized === email) return "אני";
    return (fallback || "").trim();
  };

  const pinBySyntheticId = useMemo(() => {
    const map = new Map<string, MySchedulePin>();
    pins.forEach((pin) => map.set(`pin:${pin.id}`, pin));
    return map;
  }, [pins]);

  const myScheduleRoom = useMemo<Room>(() => ({ id: MY_ROOM_ID, name: "המערכת שלי", shortName: "שלי" }), []);

  const syntheticReservations = useMemo<ReservationMap>(() => {
    const out: ReservationMap = {};

    const add = (entry: Reservation) => {
      if (!out[entry.date]) out[entry.date] = [];
      out[entry.date].push(entry);
    };

    // Pinned blocks (all types except "lesson") become reservations in the synthetic view.
    pins.forEach((pin) => {
      if (pin.kind === "lesson") return;
      const id = `pin:${pin.id}`;
      const roomLine = roomName(pin.roomId);
      if (pin.kind === "special") {
        add({
          id,
          date: pin.dateKey,
          time: pin.startMinutes,
          durationMinutes: pin.durationMinutes,
          roomId: MY_ROOM_ID,
          reservedBy: `${pin.title}${pin.meta ? ` · ${pin.meta}` : ""}\n${roomLine}`,
          reservedEmail: "",
          kind: "special"
        });
        return;
      }
      if (pin.kind === "exam") {
        add({
          id,
          date: pin.dateKey,
          time: pin.startMinutes,
          durationMinutes: pin.durationMinutes,
          roomId: MY_ROOM_ID,
          reservedBy: `${pin.title}${pin.meta ? ` · ${pin.meta}` : ""}\n${roomLine}`,
          reservedEmail: "",
          kind: "exam"
        });
        return;
      }
      if (pin.kind === "closed") {
        const linkedPending = pin.rehearsalStatus === "pending";
        add({
          id,
          date: pin.dateKey,
          time: pin.startMinutes,
          durationMinutes: pin.durationMinutes,
          roomId: MY_ROOM_ID,
          reservedBy: `${pin.title}${pin.meta ? ` · ${pin.meta}` : ""}\n${roomLine}`,
          reservedEmail: "",
          kind: "closed",
          pending: linkedPending
        });
        return;
      }
      if (
        email &&
        (reservationMap[pin.dateKey] || []).some(
          (entry) =>
            !entry.kind &&
            entry.roomId === pin.roomId &&
            entry.time === pin.startMinutes &&
            entry.durationMinutes === pin.durationMinutes &&
            (entry.reservedEmail || "").trim().toLowerCase() === email
        )
      ) {
        // Avoid duplicating a pinned copy of my own reservation; it already shows up from Firestore.
        return;
      }
      const reservedBy = whoLabel(pin.reservedEmail, pin.title === "שמור" ? pin.meta : pin.meta || pin.title);
      add({
        id,
        date: pin.dateKey,
        time: pin.startMinutes,
        durationMinutes: pin.durationMinutes,
        roomId: MY_ROOM_ID,
        reservedBy: `${reservedBy || "ללא שם"}\n${roomLine}`,
        reservedEmail: pin.reservedEmail || "",
        pending: pin.rehearsalStatus === "pending",
        linkedGroupId: pin.linkedGroupId,
        linkedRehearsalId: pin.linkedRehearsalId
      });
    });

    // My real reservations (merged into the synthetic column).
    if (email) {
      Object.entries(reservationMap).forEach(([dateKey, entries]) => {
        entries.forEach((entry) => {
          if (entry.kind) return;
          if ((entry.reservedEmail || "").trim().toLowerCase() !== email) return;
          const roomLine = roomName(entry.roomId);
          add({
            ...entry,
            date: dateKey,
            roomId: MY_ROOM_ID,
            reservedBy: `אני${entry.privateDescription ? ` · ${entry.privateDescription}` : ""}\n${roomLine}`
          });
        });
      });
    }

    Object.values(out).forEach((list) => list.sort((a, b) => a.time - b.time));
    return out;
  }, [email, pins, reservationMap, roomName]);

  const getPinnedLessonsForDate = useMemo(() => {
    const byDate = new Map<string, MySchedulePin[]>();
    const recurringIds = new Set<string>();
    pins.forEach((pin) => {
      if (pin.kind !== "lesson") return;
      if (pin.lessonId) {
        recurringIds.add(pin.lessonId);
        return;
      }
      const list = byDate.get(pin.dateKey) || [];
      list.push(pin);
      byDate.set(pin.dateKey, list);
    });
    byDate.forEach((list) => list.sort((a, b) => a.startMinutes - b.startMinutes));

    return (dateKey: string, dayKey: DayKey): Lesson[] => {
      const out: Lesson[] = [];

      // Legacy (date-specific) pins.
      (byDate.get(dateKey) || []).forEach((pin) => {
        out.push({
          id: `pin:${pin.id}`,
          title: pin.title,
          teacher: `${(pin.meta || "ללא מרצה").trim()}\n${roomName(pin.roomId)}`.trim(),
          day: dayKey,
          roomId: MY_ROOM_ID,
          startMinutes: pin.startMinutes,
          durationMinutes: pin.durationMinutes
        });
      });

      // Recurring lesson pins, resolved from the schedule (with overrides applied upstream).
      if (recurringIds.size && getScheduleLessonsForDate) {
        getScheduleLessonsForDate(dateKey, dayKey).forEach((lesson) => {
          if (!recurringIds.has(lesson.id)) return;
          const teacherLine = `${(lesson.teacher || "ללא מרצה").trim()}\n${roomName(lesson.roomId)}`.trim();
          out.push({
            id: `lesson:${lesson.id}`,
            title: lesson.title,
            teacher: teacherLine,
            day: dayKey,
            roomId: MY_ROOM_ID,
            startMinutes: lesson.startMinutes,
            durationMinutes: lesson.durationMinutes
          });
        });
      }

      out.sort((a, b) => a.startMinutes - b.startMinutes);
      return out;
    };
  }, [getScheduleLessonsForDate, pins, roomName]);

  const agendaDateKeys = useMemo(() => {
    const start = parseDateKey(todayDateKey);
    const count = Math.max(1, Math.min(agendaDays, 120));
    return Array.from({ length: count }, (_, i) => formatDateKey(addDays(start, i)));
  }, [agendaDays, todayDateKey]);

  const agendaDateSet = useMemo(() => new Set(agendaDateKeys), [agendaDateKeys]);

  const agendaEntriesByDate = useMemo(() => {
    const byDate = new Map<string, AgendaEntry[]>();
    const add = (entry: AgendaEntry) => {
      const list = byDate.get(entry.dateKey) || [];
      list.push(entry);
      byDate.set(entry.dateKey, list);
    };

    if (email) {
      agendaDateKeys.forEach((dateKey) => {
        (reservationMap[dateKey] || []).forEach((entry) => {
          if (entry.kind) return;
          if ((entry.reservedEmail || "").trim().toLowerCase() !== email) return;
          const start = entry.time;
          const end = entry.time + entry.durationMinutes;
          add({
            kind: "reservation",
            id: `r:${entry.id}`,
            dateKey,
            roomId: entry.roomId,
            startMinutes: start,
            durationMinutes: entry.durationMinutes,
            title: "שמור",
            meta: `${formatMinutes(start)}–${formatMinutes(end)} · ${roomName(entry.roomId)}`,
            clickable: true,
            onClick: () => onEditReservation(dateKey, entry.id)
          });
        });
      });
    }

    pins.forEach((pin) => {
      // Recurring lesson pins are expanded per-date below (so they don't show as a single one-off pin).
      if (pin.kind === "lesson" && pin.lessonId) return;
      if (!agendaDateSet.has(pin.dateKey)) return;
      if (
        pin.kind === "reservation" &&
        email &&
        (reservationMap[pin.dateKey] || []).some(
          (entry) =>
            !entry.kind &&
            entry.roomId === pin.roomId &&
            entry.time === pin.startMinutes &&
            entry.durationMinutes === pin.durationMinutes &&
            (entry.reservedEmail || "").trim().toLowerCase() === email
        )
      ) {
        return;
      }
      const start = pin.startMinutes;
      const end = pin.startMinutes + pin.durationMinutes;
      const meta =
        `${formatMinutes(start)}–${formatMinutes(end)} · ${roomName(pin.roomId)}` +
        (pin.meta ? ` · ${pin.meta}` : "");
      add({
        kind: "pin",
        id: `p:${pin.id}`,
        dateKey: pin.dateKey,
        roomId: pin.roomId,
        startMinutes: pin.startMinutes,
        durationMinutes: pin.durationMinutes,
        title: pin.title,
        meta,
        type: pin.kind,
        clickable: true,
        onClick: () => onOpenPinned(pin)
      });
    });

    // Recurring lesson pins: expand into each date in the agenda window.
    const recurringLessonIds = new Set(
      pins.filter((pin) => pin.kind === "lesson" && pin.lessonId).map((pin) => pin.lessonId as string)
    );
    if (recurringLessonIds.size && getScheduleLessonsForDate) {
      agendaDateKeys.forEach((dateKey) => {
        const dayKey = getDayKeyFromDateKey(dateKey);
        getScheduleLessonsForDate(dateKey, dayKey).forEach((lesson) => {
          if (!recurringLessonIds.has(lesson.id)) return;
          const start = lesson.startMinutes;
          const end = lesson.startMinutes + lesson.durationMinutes;
          const meta = `${formatMinutes(start)}–${formatMinutes(end)} · ${roomName(lesson.roomId)}` +
            (lesson.teacher ? ` · ${lesson.teacher}` : "");
          add({
            kind: "pin",
            id: `l:${dateKey}:${lesson.id}`,
            dateKey,
            roomId: lesson.roomId,
            startMinutes: start,
            durationMinutes: lesson.durationMinutes,
            title: lesson.title,
            meta,
            type: "lesson",
            clickable: true,
            onClick: () =>
              onOpenPinned({
                id: `lesson:${lesson.id}`,
                kind: "lesson",
                lessonId: lesson.id,
                dateKey,
                roomId: lesson.roomId,
                startMinutes: lesson.startMinutes,
                durationMinutes: lesson.durationMinutes,
                title: lesson.title,
                meta: lesson.teacher || "ללא מרצה",
                createdAt: 0
              })
          });
        });
      });
    }

    byDate.forEach((list, key) => {
      list.sort((a, b) => a.startMinutes - b.startMinutes);
      // Stable sort for same start time.
      byDate.set(key, list);
    });
    return byDate;
  }, [agendaDateKeys, agendaDateSet, email, onEditReservation, onOpenPinned, pins, reservationMap, roomName]);

  if (mode === "agenda") {
    const nonEmptyDates = agendaDateKeys.filter((dateKey) => (agendaEntriesByDate.get(dateKey) || []).length > 0);

    return (
      <section className="finder my-schedule my-schedule-agenda">
        <ul className="my-schedule-week">
          {nonEmptyDates.map((dateKey) => {
            const entries = agendaEntriesByDate.get(dateKey) || [];
            const weekday =
              allWeekDays.find((d) => d.key === getDayKeyFromDateKey(dateKey))?.label || "";
          return (
            <li key={dateKey} className="my-schedule-day">
              <div
                className="my-schedule-day-header clickable"
                role="button"
                tabIndex={0}
                onClick={() => {
                  onSelectedDateChange(dateKey);
                  onModeChange("day");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectedDateChange(dateKey);
                    onModeChange("day");
                  }
                }}
              >
                <span className="my-schedule-day-name">{weekday}</span>
                <span className="my-schedule-day-date">{formatShortDate(dateKey)}</span>
              </div>
              {entries.length ? (
                <ul className="finder-result-list">
                    {entries.map((entry) => (
                      <li
                        key={entry.id}
                        className={`finder-result ${
                          entry.kind === "reservation"
                            ? "reserved"
                            : entry.type === "reservation"
                              ? "reserved"
                              : entry.type
                        } clickable`}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          onSelectedDateChange(entry.dateKey);
                          entry.onClick();
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelectedDateChange(entry.dateKey);
                            entry.onClick();
                          }
                        }}
                      >
                        <div>
                          <p className="finder-result-title">
                            <span
                              className={`dot ${
                                entry.kind === "reservation"
                                  ? "reserved"
                                  : entry.type === "reservation"
                                    ? "reserved"
                                    : entry.type
                              }`}
                            />{" "}
                            {entry.title}
                          </p>
                          <p className="finder-result-meta">{entry.meta}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
        {!nonEmptyDates.length ? <div className="my-schedule-empty">אין רשומות לתצוגה.</div> : null}
        <div className="my-schedule-load">
          <button type="button" className="primary" onClick={onAgendaLoadMore}>
            טען עוד
          </button>
        </div>
      </section>
    );
  }

  const selectedDayKey = getDayKeyFromDateKey(selectedDate);
  const gridProps = {
    rooms: [myScheduleRoom],
    groups,
    directoryUsers,
    reservationMap: syntheticReservations,
    currentUser,
    onReserve: () => {},
    onSlotAction: onAddSlot,
    onRelease: () => {},
    interactive: false as const,
    showSlotActions: true as const,
    startHour,
    endHour,
    timeSlots,
    roomMeta: undefined,
    lessons: [] as Lesson[],
    getLessonsForDate: getPinnedLessonsForDate,
    onEditReservation,
    onLessonDetails: (lessonId: string, dateKey: string) => {
      if (lessonId.startsWith("pin:")) {
        const pin = pinBySyntheticId.get(lessonId);
        if (!pin) return;
        onOpenPinned(pin);
        onSelectedDateChange(dateKey);
        return;
      }
      if (!lessonId.startsWith("lesson:")) return;
      if (!getScheduleLessonsForDate) return;
      const baseId = lessonId.slice("lesson:".length);
      const dayKey = getDayKeyFromDateKey(dateKey);
      const lesson = getScheduleLessonsForDate(dateKey, dayKey).find((entry) => entry.id === baseId);
      if (!lesson) return;
      onOpenPinned({
        id: `lesson:${lesson.id}`,
        kind: "lesson",
        lessonId: lesson.id,
        dateKey,
        roomId: lesson.roomId,
        startMinutes: lesson.startMinutes,
        durationMinutes: lesson.durationMinutes,
        title: lesson.title,
        meta: lesson.teacher || "ללא מרצה",
        createdAt: 0
      });
      onSelectedDateChange(dateKey);
    },
    onSpecialDetails: (reservationId: string, dateKey: string) => {
      const pin = pinBySyntheticId.get(reservationId);
      if (!pin) return;
      onOpenPinned(pin);
      onSelectedDateChange(dateKey);
    },
    onClosedDetails: (reservationId: string, dateKey: string) => {
      const pin = pinBySyntheticId.get(reservationId);
      if (!pin) return;
      onOpenPinned(pin);
      onSelectedDateChange(dateKey);
    },
    onReservationClick: (reservationId: string, dateKey: string) => {
      const pin = pinBySyntheticId.get(reservationId);
      if (!pin) return;
      onOpenPinned(pin);
      onSelectedDateChange(dateKey);
    },
    onLinkedRehearsalRespond,
    nowMinutes,
    todayDateKey,
    pendingReservationIds
  };

  return (
    <section className="my-schedule-grid">
      {mode === "day" ? (
        <ScheduleGrid
          {...gridProps}
          view="daily"
          weekDates={weekDates}
          selectedDate={selectedDate}
          selectedDayKey={selectedDayKey}
          selectedRoom={MY_ROOM_ID}
          showHeaders={false}
          footer={<Legend />}
          onNavigatePrev={onNavigatePrev}
          onNavigateNext={onNavigateNext}
          zoomResetToken={zoomResetToken}
          availability={availability}
          availabilityDateOffs={availabilityDateOffs}
          availabilityEditMode={effectiveAvailabilityEditMode}
          onAvailabilityDayUpdate={onAvailabilityDayUpdate}
          onAvailabilityDateOffToggle={onAvailabilityDateOffToggle}
        />
      ) : (
        <ScheduleGrid
          {...gridProps}
          view="room"
          weekDates={weekDates}
          selectedDate={selectedDate}
          selectedDayKey={selectedDayKey}
          selectedRoom={MY_ROOM_ID}
          showHeaders
          compact
          onDateSelect={(dateKey) => {
            onSelectedDateChange(dateKey);
            onModeChange("day");
          }}
          footer={<Legend />}
          onNavigatePrev={onNavigatePrev}
          onNavigateNext={onNavigateNext}
          zoomResetToken={zoomResetToken}
          availability={availability}
          availabilityDateOffs={availabilityDateOffs}
          availabilityEditMode={effectiveAvailabilityEditMode}
          onAvailabilityDayUpdate={onAvailabilityDayUpdate}
          onAvailabilityDateOffToggle={onAvailabilityDateOffToggle}
        />
      )}
    </section>
  );
}
