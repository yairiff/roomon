import { formatMinutes } from "../lib/scheduleBuilder";
import { parseDateKey } from "../lib/date";
import type { Lesson, Room } from "../types/schedule";
import type { ReservationMap } from "../types/reservations";
import type { DayKey } from "../types/schedule";
import Legend from "./Legend";

export type LiveViewProps = {
  rooms: Room[];
  lessons: Lesson[];
  reservationMap: ReservationMap;
  dateKey: string;
  dayKey: DayKey;
  nowMinutes: number;
  startHour: number;
  endHour: number;
  onRoomSelect: (roomId: string) => void;
  nowLabel: string;
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
  onRoomSelect,
  nowLabel
}: LiveViewProps) {
  const todayReservations = reservationMap[dateKey] || [];
  const todayDate = parseDateKey(dateKey);
  const isWeekend = todayDate.getDay() === 5 || todayDate.getDay() === 6;
  const isClosedNow = isWeekend || nowMinutes < startHour * 60 || nowMinutes >= endHour * 60;
  const weekdayLabel = new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(todayDate);
  const dateLabel = new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit" }).format(todayDate);

  const getRoomStatus = (roomId: string) => {
    if (isClosedNow) {
      return {
        status: "closed" as const,
        title: "סגור",
        meta: "מחוץ לשעות הפעילות"
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
        title: activeLesson.title,
        meta: activeLesson.teacher || "ללא מרצה"
      };
    }

    const activeReservation = todayReservations.find(
      (entry) =>
        entry.roomId === roomId &&
        entry.time <= nowMinutes &&
        entry.time + entry.durationMinutes > nowMinutes
    );

    if (activeReservation) {
      return {
        status: "reserved" as const,
        title: "שמור",
        meta: activeReservation.reservedBy
      };
    }

    return {
      status: "empty" as const,
      title: "פנוי",
      meta: ""
    };
  };

  const getBusyUntil = (roomId: string) => {
    if (isClosedNow) return null;
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
    if (isClosedNow) return null;
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
        label: "שמור"
      }));

    const upcoming = [...lessonStarts, ...reservationStarts]
      .filter((event) => event.start > nowMinutes)
      .sort((a, b) => a.start - b.start)[0];

    if (!upcoming) return null;

    return upcoming;
  };

  const formatInHours = (targetMinutes: number) => {
    const diff = targetMinutes - nowMinutes;
    if (diff <= 0) return "";
    const hours = Math.floor(diff / 60);
    const minutes = diff % 60;
    if (hours === 0) return "פחות משעה";
    if (minutes === 0) return `${hours} שעות`;
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

  const availableCount = roomStates.filter((state) => state.status.status === "empty").length;

  return (
    <section className="live-view">
      <div className="live-header">
        <div className="live-clock-block">
          <p className="live-clock">{nowLabel}</p>
          <p className="live-date">{weekdayLabel} · {dateLabel}</p>
        </div>
        <p className="live-summary">
          {isClosedNow ? "סגור עכשיו" : `חדרים זמינים עכשיו: ${availableCount}/${rooms.length}`}
        </p>
      </div>
      <div className="live-grid">
        {roomStates.map(({ room, status, busyUntil, nextEvent }) => {
          const nextLabel = nextEvent ? formatInHours(nextEvent.start) : "";
          return (
            <button
              key={room.id}
              className={`live-card ${status.status}`}
              onClick={() => onRoomSelect(room.id)}
              type="button"
            >
              <div>
                <p className="live-room">
                  <span className={`status-dot ${status.status}`} />
                  {room.name}
                </p>
                <p className="live-title">{status.title}</p>
                {status.meta ? <p className="live-meta">{status.meta}</p> : null}
              </div>
              {busyUntil ? (
                <div className="live-next">
                  <p className="live-next-label">פנוי ב־{formatMinutes(busyUntil)}</p>
                </div>
              ) : nextEvent ? (
                <div className="live-next">
                  <p className="live-next-label">הבא בעוד {nextLabel}</p>
                  <p className="live-next-time">
                    {formatMinutes(nextEvent.start)} · {nextEvent.label}
                  </p>
                </div>
              ) : null}
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
