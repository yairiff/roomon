import { formatMinutes } from "../../../lib/scheduleBuilder";
import { parseDateKey } from "../../../lib/date";
import type { Lesson, Room } from "../../../types/schedule";
import type { ReservationMap } from "../../../types/reservations";
import type { DayKey } from "../../../types/schedule";
import Legend from "./Legend";
import type { RoomMeta } from "../../../types/admin";

export type LiveViewProps = {
  rooms: Room[];
  lessons: Lesson[];
  reservationMap: ReservationMap;
  dateKey: string;
  dayKey: DayKey;
  nowMinutes: number;
  startHour: number;
  endHour: number;
  roomMeta?: Record<string, RoomMeta>;
  onRoomSelect: (roomId: string) => void;
};

export default function LiveView({
  rooms,
  lessons,
  reservationMap,
  dateKey,
  dayKey,
  nowMinutes,
  startHour,
  endHour,
  roomMeta,
  onRoomSelect
}: LiveViewProps) {
  const todayReservations = reservationMap[dateKey] || [];
  const todayDate = parseDateKey(dateKey);
  const isWeekend = todayDate.getDay() === 5 || todayDate.getDay() === 6;
  const isClosedNow = isWeekend || nowMinutes < startHour * 60 || nowMinutes >= endHour * 60;

  const getRoomStatus = (roomId: string) => {
    const policy = roomMeta?.[roomId];
    const roomOpen = policy?.openMinutes ?? startHour * 60;
    const roomClose = policy?.closeMinutes ?? endHour * 60;
    const isRoomClosed = Boolean(policy?.isClosed);

    if (isRoomClosed) {
      return {
        status: "closed" as const,
        label: "סגור",
        detailPrimary: policy?.note || "סגור זמנית",
        detailSecondary: ""
      };
    }
    if (isClosedNow || nowMinutes < roomOpen || nowMinutes >= roomClose) {
      return {
        status: "closed" as const,
        label: "סגור",
        detailPrimary: "מחוץ לשעות הפעילות",
        detailSecondary: ""
      };
    }
    const activeLesson = lessons.find(
      (lesson) =>
        lesson.day === dayKey &&
        lesson.roomId === roomId &&
        lesson.startMinutes <= nowMinutes &&
        lesson.startMinutes + lesson.durationMinutes > nowMinutes
    );

    if (activeLesson) {
      return {
        status: "lesson" as const,
        label: "שיעור",
        detailPrimary: activeLesson.title,
        detailSecondary: activeLesson.teacher || ""
      };
    }

    const activeReservation = todayReservations.find(
      (entry) =>
        entry.roomId === roomId &&
        entry.time <= nowMinutes &&
        entry.time + entry.durationMinutes > nowMinutes
    );

    if (activeReservation) {
      if (activeReservation.kind === "closed") {
        return {
          status: "closed" as const,
          label: "סגור",
          detailPrimary: activeReservation.reservedBy || "סגור זמנית",
          detailSecondary: ""
        };
      }
      return {
        status: "reserved" as const,
        label: activeReservation.kind === "special" ? "אירוע" : "שמור",
        detailPrimary: activeReservation.reservedBy || "",
        detailSecondary: ""
      };
    }

    return {
      status: "empty" as const,
      label: "פנוי",
      detailPrimary: "",
      detailSecondary: ""
    };
  };

  const getBusyUntil = (roomId: string) => {
    const policy = roomMeta?.[roomId];
    const roomOpen = policy?.openMinutes ?? startHour * 60;
    const roomClose = policy?.closeMinutes ?? endHour * 60;
    const isRoomClosed = Boolean(policy?.isClosed);
    if (isRoomClosed || isClosedNow || nowMinutes < roomOpen || nowMinutes >= roomClose) return null;
    const intervals = [
      ...lessons
        .filter((lesson) => lesson.day === dayKey && lesson.roomId === roomId)
        .map((lesson) => ({
          start: lesson.startMinutes,
          end: lesson.startMinutes + lesson.durationMinutes
        })),
      ...todayReservations
        .filter((entry) => entry.roomId === roomId)
        .map((entry) => ({
          start: entry.time,
          end: entry.time + entry.durationMinutes
        }))
    ].sort((a, b) => a.start - b.start);

    const activeIndex = intervals.findIndex(
      (interval) => interval.start <= nowMinutes && interval.end > nowMinutes
    );
    if (activeIndex === -1) return null;

    let end = intervals[activeIndex].end;
    for (let i = activeIndex + 1; i < intervals.length; i += 1) {
      if (intervals[i].start <= end) {
        end = Math.max(end, intervals[i].end);
      } else {
        break;
      }
    }
    return end;
  };

  const getNextEvent = (roomId: string) => {
    const policy = roomMeta?.[roomId];
    const roomOpen = policy?.openMinutes ?? startHour * 60;
    const roomClose = policy?.closeMinutes ?? endHour * 60;
    const isRoomClosed = Boolean(policy?.isClosed);
    if (isRoomClosed || isClosedNow || nowMinutes < roomOpen || nowMinutes >= roomClose) return null;
    const lessonStarts = lessons
      .filter((lesson) => lesson.day === dayKey && lesson.roomId === roomId)
      .map((lesson) => ({
        start: lesson.startMinutes,
        label: lesson.title
      }));

    const reservationStarts = todayReservations
      .filter((entry) => entry.roomId === roomId)
      .map((entry) => ({
        start: entry.time,
        label: entry.kind === "special" ? "אירוע" : entry.kind === "exam" ? "מבחן" : entry.kind === "closed" ? "סגור" : "שמור"
      }));

    const upcoming = [...lessonStarts, ...reservationStarts]
      .filter((event) => event.start > nowMinutes)
      .sort((a, b) => a.start - b.start)[0];

    if (!upcoming) return null;

    return upcoming;
  };

  const formatDiffMinutes = (targetMinutes: number) => {
    const diff = Math.max(0, Math.round(targetMinutes - nowMinutes));
    if (diff <= 0) return "";
    const hours = Math.floor(diff / 60);
    const minutes = diff % 60;
    if (hours <= 0) {
      if (minutes === 1) return "דקה";
      return `${minutes} דקות`;
    }
    if (minutes === 0) {
      return hours === 1 ? "שעה" : `${hours} שעות`;
    }
    return `${hours}ש׳ ${minutes}ד׳`;
  };

  const roomStates = rooms.map((room) => {
    const status = getRoomStatus(room.id);
    const busyUntil = getBusyUntil(room.id);
    const nextEvent = getNextEvent(room.id);
    return {
      room,
      status,
      busyUntil,
      nextEvent
    };
  });

  return (
    <section className="live-view">
      <div className="live-grid">
        {roomStates.map(({ room, status, busyUntil, nextEvent }) => {
          const nextBusyMinutes = busyUntil ? formatDiffMinutes(busyUntil) : "";
          const nextEventMinutes = nextEvent ? formatDiffMinutes(nextEvent.start) : "";
          const nextLine1 = busyUntil
            ? `פנוי ב־${formatMinutes(busyUntil)}`
            : nextEvent
              ? `הבא ב־${formatMinutes(nextEvent.start)}`
              : "";
          const nextLine2 = busyUntil
            ? (nextBusyMinutes ? `בעוד ${nextBusyMinutes}` : "")
            : nextEvent
              ? (nextEventMinutes ? `בעוד ${nextEventMinutes}` : "")
              : "";
          const detailsBase = [status.detailPrimary, status.detailSecondary].filter(Boolean).join(" · ");
          const details = detailsBase || (status.status === "empty" ? nextEvent?.label || "" : "");

          return (
            <button
              key={room.id}
              className={`live-card ${status.status}`}
              onClick={() => onRoomSelect(room.id)}
              type="button"
            >
              <p className="live-room">{room.name}</p>

              <div className="live-subline">
                <span className="live-status">
                  <span className={`status-dot ${status.status}`} />
                  {status.label}
                </span>
              </div>
              {nextLine1 ? (
                <p className="live-next">
                  <span className="live-next-line">{nextLine1}</span>
                  {nextLine2 ? <span className="live-next-line sub">{nextLine2}</span> : null}
                </p>
              ) : null}

              {details ? <p className="live-details">{details}</p> : <span className="live-details empty" />}
            </button>
          );
        })}
      </div>
      <div className="live-legend">
        <Legend />
      </div>
    </section>
  );
}
