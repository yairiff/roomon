import type { WeekDate } from "../../../lib/date";
import type { ReservationMap } from "../../../types/reservations";
import type { User } from "../../../types/auth";
import type { Room } from "../../../types/schedule";
import type { MySchedulePin } from "../../../types/mySchedule";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import { formatShortDate, getDayKeyFromDateKey } from "../../../lib/date";
import { weekDays } from "../../../config";

type MyScheduleViewProps = {
  weekDates: WeekDate[];
  rooms: Room[];
  reservationMap: ReservationMap;
  currentUser: User | null;
  pins: MySchedulePin[];
  onEditReservation: (dateKey: string, reservationId: string) => void;
  onOpenPinned: (pin: MySchedulePin) => void;
};

type MyScheduleEntry =
  | {
      type: "reservation";
      id: string;
      dateKey: string;
      startMinutes: number;
      durationMinutes: number;
      roomId: string;
    }
  | {
      type: "pin";
      pin: MySchedulePin;
    };

export default function MyScheduleView({
  weekDates,
  rooms,
  reservationMap,
  currentUser,
  pins,
  onEditReservation,
  onOpenPinned
}: MyScheduleViewProps) {
  const email = currentUser?.email || "";

  const roomName = (roomId: string) => rooms.find((r) => r.id === roomId)?.name || roomId;

  const entriesForDate = (dateKey: string): MyScheduleEntry[] => {
    const mine =
      email
        ? (reservationMap[dateKey] || [])
            .filter((entry) => entry.reservedEmail === email)
            .map((entry) => ({
              type: "reservation" as const,
              id: entry.id,
              dateKey,
              startMinutes: entry.time,
              durationMinutes: entry.durationMinutes,
              roomId: entry.roomId
            }))
        : [];

    const pinned = pins
      .filter((pin) => pin.dateKey === dateKey)
      .map((pin) => ({
        type: "pin" as const,
        pin
      }));

    return [...mine, ...pinned].sort((a, b) => {
      const aStart = a.type === "pin" ? a.pin.startMinutes : a.startMinutes;
      const bStart = b.type === "pin" ? b.pin.startMinutes : b.startMinutes;
      return aStart - bStart;
    });
  };

  return (
    <section className="finder reservations my-schedule">
      <ul className="my-schedule-week">
        {weekDates.map((day) => {
          const dayEntries = entriesForDate(day.dateKey);
          const weekdayLabel =
            weekDays.find((d) => d.key === getDayKeyFromDateKey(day.dateKey))?.label || day.label || "";
          return (
            <li key={day.dateKey} className="my-schedule-day">
              <div className="my-schedule-day-header">
                <span className="my-schedule-day-name">{weekdayLabel}</span>
                <span className="my-schedule-day-date">{formatShortDate(day.dateKey)}</span>
              </div>
              {dayEntries.length ? (
                <ul className="finder-result-list">
                  {dayEntries.map((entry) => {
                    if (entry.type === "reservation") {
                      const end = entry.startMinutes + entry.durationMinutes;
                      return (
                        <li
                          key={`r:${entry.id}`}
                          className="finder-result reserved clickable"
                          role="button"
                          tabIndex={0}
                          onClick={() => onEditReservation(entry.dateKey, entry.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onEditReservation(entry.dateKey, entry.id);
                            }
                          }}
                        >
                          <div>
                            <p className="finder-result-title">
                              <span className="dot reserved" /> {roomName(entry.roomId)}
                            </p>
                            <p className="finder-result-meta">
                              {formatMinutes(entry.startMinutes)}–{formatMinutes(end)}
                            </p>
                          </div>
                        </li>
                      );
                    }

                    const dotClass =
                      entry.pin.kind === "lesson" ? "lesson" : entry.pin.kind === "special" ? "special" : "closed";
                    const blockClass =
                      entry.pin.kind === "lesson" ? "lesson" : entry.pin.kind === "special" ? "special" : "closed";
                    const pinEnd = entry.pin.startMinutes + entry.pin.durationMinutes;
                    return (
                      <li
                        key={`p:${entry.pin.id}`}
                        className={`finder-result ${blockClass} clickable`}
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenPinned(entry.pin)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onOpenPinned(entry.pin);
                          }
                        }}
                      >
                        <div>
                          <p className="finder-result-title">
                            <span className={`dot ${dotClass}`} /> {entry.pin.title}
                          </p>
                          <p className="finder-result-meta">
                            {roomName(entry.pin.roomId)} · {formatMinutes(entry.pin.startMinutes)}–{formatMinutes(pinEnd)}
                            {entry.pin.meta ? ` · ${entry.pin.meta}` : ""}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="my-schedule-empty">אין רשומות.</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
