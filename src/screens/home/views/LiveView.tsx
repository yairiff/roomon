import { formatMinutes } from "../../../lib/scheduleBuilder";
import { defaultWeekDayKeys } from "../../../config";
import {
  buildReservationPolicyWindowsForDays,
  getReservationPolicyWindowForSlot
} from "../../../lib/reservationPolicyWindows";
import type { Lesson, Room } from "../../../types/schedule";
import type { ReservationMap } from "../../../types/reservations";
import type { DayKey } from "../../../types/schedule";
import Legend from "./Legend";
import type { RoomMeta } from "../../../types/admin";
import type { ReservationPolicyWindow } from "../../../lib/reservationPolicyWindows";

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
  policyDayKeys?: DayKey[];
  policyWindows?: ReservationPolicyWindow[];
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
  policyDayKeys = defaultWeekDayKeys,
  policyWindows = [],
  onRoomSelect
}: LiveViewProps) {
  const todayReservations = reservationMap[dateKey] || [];
  const openDayKeys = policyDayKeys.length ? policyDayKeys : defaultWeekDayKeys;
  const effectivePolicyWindows = policyWindows.length
    ? policyWindows
    : buildReservationPolicyWindowsForDays(openDayKeys, startHour * 60, endHour * 60);
  const isClosedDay = !openDayKeys.includes(dayKey);
  const isClosedByDayOrTime = isClosedDay || nowMinutes < startHour * 60 || nowMinutes >= endHour * 60;
  const isRoomClosedNow = (roomId: string) =>
    isClosedByDayOrTime ||
    !getReservationPolicyWindowForSlot(effectivePolicyWindows, {
      dateKey,
      dayKey,
      roomId,
      startMinutes: nowMinutes,
      endMinutes: nowMinutes + 1
    });
  const reservationDuration = (durationMinutes: number | undefined) => {
    const numeric = Number(durationMinutes);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 60;
  };

  const getRoomStatus = (roomId: string) => {
    if (isRoomClosedNow(roomId)) {
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
        entry.time + reservationDuration(entry.durationMinutes) > nowMinutes
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
      if (activeReservation.kind === "special") {
        return {
          status: "special" as const,
          label: "אירוע",
          detailPrimary: activeReservation.reservedBy || "אירוע",
          detailSecondary: ""
        };
      }
      if (activeReservation.kind === "exam") {
        return {
          status: "exam" as const,
          label: "מבחן",
          detailPrimary: activeReservation.reservedBy || "מבחן",
          detailSecondary: ""
        };
      }
      return {
        status: "reserved" as const,
        label: "שמור",
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
    if (isRoomClosedNow(roomId)) return null;
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
          end: entry.time + reservationDuration(entry.durationMinutes)
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
    if (isRoomClosedNow(roomId)) return null;
    const lessonStarts = lessons
      .filter((lesson) => lesson.day === dayKey && lesson.roomId === roomId)
      .map((lesson) => ({
        start: lesson.startMinutes,
        label: (lesson.title || "").trim() || "שיעור",
        secondary: (lesson.teacher || "").trim()
      }));

    const reservationStarts = todayReservations
      .filter((entry) => entry.roomId === roomId)
      .map((entry) => ({
        start: entry.time,
        label:
          entry.kind === "special"
            ? (entry.reservedBy || "אירוע")
            : entry.kind === "exam"
              ? (entry.reservedBy || "מבחן")
              : entry.kind === "closed"
                ? (entry.reservedBy || "סגור")
                : (entry.reservedBy || "שריון"),
        secondary: ""
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
            ? `מתפנה ב־${formatMinutes(busyUntil)}`
            : nextEvent
              ? `פנוי עד ${formatMinutes(nextEvent.start)}`
              : "";
          const nextLine2 = busyUntil
            ? (nextBusyMinutes ? `בעוד ${nextBusyMinutes}` : "")
            : nextEvent
              ? (nextEventMinutes ? `עוד ${nextEventMinutes}` : "")
              : "";
          const nextInlineSep = !busyUntil && nextEvent ? " - " : " · ";
          const nextEventDetails = "";
          const detailsPrimary = status.detailPrimary.trim();
          const detailsSecondary = status.detailSecondary.trim();
          const hasDetails = Boolean(detailsPrimary || detailsSecondary);

          return (
            <button
              key={room.id}
              className={`live-card ${status.status}`}
              onClick={() => onRoomSelect(room.id)}
              type="button"
            >
              {room.imageUrl ? (
                <div className="live-room-banner" aria-hidden="true">
                  <img src={room.imageUrl} alt="" loading="lazy" />
                </div>
              ) : null}
              <p className="live-room">{room.name}</p>

              <div className="live-subline">
                <span className="live-status">
                  <span className={`status-dot ${status.status}`} />
                  {status.label}
                </span>
              </div>
              {hasDetails ? (
                <p className="live-details">
                  {detailsPrimary ? <span>{detailsPrimary}</span> : null}
                  {detailsPrimary && detailsSecondary ? <span className="live-details-sep"> · </span> : null}
                  {detailsSecondary ? <span className="live-details-secondary">{detailsSecondary}</span> : null}
                </p>
              ) : null}
              {nextLine1 ? (
                <p className="live-next">
                  <span className={`live-next-line${busyUntil ? " live-next-release" : ""}`}>
                    {nextLine1}
                    {nextLine2 ? (
                      <>
                        <span className="live-next-sep">{nextInlineSep}</span>
                        <span className="live-next-eta">{nextLine2}</span>
                      </>
                    ) : null}
                  </span>
                  {nextLine2 ? (
                    nextEventDetails ? (
                      <span className="live-next-line sub">{nextEventDetails}</span>
                    ) : null
                  ) : null}
                </p>
              ) : <span className="live-next empty" />}
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
