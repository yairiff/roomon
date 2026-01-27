import { useEffect, useMemo, useState } from "react";
import { addDays, formatDateKey, formatShortDate, parseDateKey, getDayKeyFromDateKey } from "../../../lib/date";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import type { DayKey, Lesson, Room } from "../../../types/schedule";
import type { ReservationMap, ReserveRequest } from "../../../types/reservations";
import type { RoomMeta } from "../../../types/admin";
import { AddIcon, TuneIcon } from "../../../components/Icons";

export type BookingFinderProps = {
  rooms: Room[];
  lessons: Lesson[];
  reservationMap: ReservationMap;
  startHour: number;
  endHour: number;
  roomMeta?: Record<string, RoomMeta>;
  getLessonsForDate?: (dateKey: string, dayKey: DayKey) => Lesson[];
  onReserve: (request: ReserveRequest) => void;
};

export default function BookingFinder({
  rooms,
  lessons,
  reservationMap,
  startHour,
  endHour,
  roomMeta,
  getLessonsForDate,
  onReserve
}: BookingFinderProps) {
  const [advancedMode, setAdvancedMode] = useState(false);
  const [startDate, setStartDate] = useState(() => formatDateKey(new Date()));
  const [endDate, setEndDate] = useState(() => formatDateKey(addDays(new Date(), 7)));
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);
  const [fromHour, setFromHour] = useState(startHour);
  const [toHour, setToHour] = useState(endHour);
  const [duration, setDuration] = useState(1);
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(20);

  const availableRooms = selectedRooms.length ? rooms.filter((room) => selectedRooms.includes(room.id)) : rooms;
  const todayKey = formatDateKey(new Date());
  const effectiveStartDate = advancedMode ? startDate : todayKey;
  const effectiveEndDate = advancedMode ? endDate : formatDateKey(addDays(new Date(), 6));
  const weekdayLabels = [
    { value: 0, label: "א׳" },
    { value: 1, label: "ב׳" },
    { value: 2, label: "ג׳" },
    { value: 3, label: "ד׳" },
    { value: 4, label: "ה׳" }
  ];
  const weekDayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const formatDayDate = (dateKey: string) => {
    const dayLabel = weekDayNames[parseDateKey(dateKey).getDay()] || "";
    return `יום ${dayLabel} · ${formatShortDate(dateKey)}`;
  };

  const hours = useMemo(
    () => Array.from({ length: endHour - startHour + 1 }, (_, i) => i + startHour),
    [startHour, endHour]
  );

  const results = useMemo(() => {
    const start = parseDateKey(effectiveStartDate);
    const end = parseDateKey(effectiveEndDate);
    if (start > end) return [];

    const dates: string[] = [];
    for (let date = start; date <= end; date = addDays(date, 1)) {
      const day = date.getDay();
      if (day === 5 || day === 6) continue;
      if (!advancedMode && selectedWeekdays.length && !selectedWeekdays.includes(day)) continue;
      dates.push(formatDateKey(date));
    }

    const items: { date: string; room: Room; start: number; end: number }[] = [];

    dates.forEach((dateKey) => {
      const dayKey = getDayKeyFromDateKey(dateKey);
      const dayLessons = getLessonsForDate
        ? getLessonsForDate(dateKey, dayKey)
        : lessons.filter((lesson) => lesson.day === dayKey);
      const reservations = reservationMap[dateKey] || [];

      availableRooms.forEach((room) => {
        const policy = roomMeta?.[room.id];
        if (policy?.isClosed) return;
        const roomOpen = policy?.openMinutes ?? startHour * 60;
        const roomClose = policy?.closeMinutes ?? endHour * 60;

        for (let hour = fromHour; hour <= toHour - duration; hour += 1) {
          const startMinutes = hour * 60;
          const endMinutes = startMinutes + duration * 60;

          if (startMinutes < roomOpen || endMinutes > roomClose) continue;

          const overlapsLesson = dayLessons.some((lesson) => {
            if (lesson.roomId !== room.id) return false;
            const lessonEnd = lesson.startMinutes + lesson.durationMinutes;
            return lesson.startMinutes < endMinutes && lessonEnd > startMinutes;
          });

          if (overlapsLesson) continue;

          const overlapsReservation = reservations.some((reservation) => {
            if (reservation.roomId !== room.id) return false;
            const reservationEnd = reservation.time + reservation.durationMinutes;
            return reservation.time < endMinutes && reservationEnd > startMinutes;
          });

          if (overlapsReservation) continue;

          items.push({ date: dateKey, room, start: startMinutes, end: endMinutes });
        }
      });
    });

    return items
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.start !== b.start) return a.start - b.start;
        return a.room.name.localeCompare(b.room.name);
      });
  }, [
    advancedMode,
    effectiveStartDate,
    effectiveEndDate,
    fromHour,
    toHour,
    duration,
    availableRooms,
    lessons,
    reservationMap,
    selectedWeekdays
  ]);

  useEffect(() => {
    setVisibleCount(20);
  }, [advancedMode, effectiveStartDate, effectiveEndDate, fromHour, toHour, duration, selectedRooms]);

  const visibleResults = results.slice(0, visibleCount);

  return (
    <section className="finder">
      <div className="finder-form">
        <div className="finder-toggle-line">
          <p className="field-label">
            {advancedMode ? "בחר טווח תאריכים" : "בחר ימים בשבוע"}
          </p>
          <button
            type="button"
            className="chip ghost small"
            onClick={() => {
              if (advancedMode) {
                setAdvancedMode(false);
                return;
              }
              setAdvancedMode(true);
              setStartDate(todayKey);
              setEndDate(formatDateKey(addDays(new Date(), 7)));
            }}
          >
            <TuneIcon />
            {advancedMode ? "בחר ימים בשבוע" : "בחר טווח תאריכים"}
          </button>
        </div>
        {advancedMode ? (
          <div className="finder-row">
            <label>
              מתאריך
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label>
              עד תאריך
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </label>
          </div>
        ) : (
          <div className="finder-weekdays">
            <div className="finder-weekdays-grid">
              {weekdayLabels.map((day) => {
                const selected = selectedWeekdays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    className={`chip ${selected ? "active" : ""}`}
                    aria-pressed={selected}
                    onClick={() => {
                      setSelectedWeekdays((prev) =>
                        selected ? prev.filter((value) => value !== day.value) : [...prev, day.value]
                      );
                    }}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="finder-row">
          <label>
            משעה
            <select value={fromHour} onChange={(event) => setFromHour(Number(event.target.value))}>
              {hours.map((hour) => (
                <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>
              ))}
            </select>
          </label>
          <label>
            עד שעה
            <select value={toHour} onChange={(event) => setToHour(Number(event.target.value))}>
              {hours.map((hour) => (
                <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          משך
          <select value={duration} onChange={(event) => setDuration(Number(event.target.value))}>
            {Array.from({ length: Math.min(6, endHour - startHour) }, (_, index) => index + 1).map((h) => (
              <option key={h} value={h}>{h} שעות</option>
            ))}
          </select>
        </label>
        <div className="finder-rooms">
          <p className="field-label">חדרים</p>
          <div className="finder-room-list">
            {rooms.map((room) => {
              const selected = selectedRooms.includes(room.id);
              return (
                <button
                  key={room.id}
                  type="button"
                  className={`chip ${selected ? "active" : ""}`}
                  aria-pressed={selected}
                  title={room.name}
                  onClick={() => {
                    setSelectedRooms((prev) =>
                      selected ? prev.filter((id) => id !== room.id) : [...prev, room.id]
                    );
                  }}
                >
                  {room.shortName || room.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="finder-results">
        {visibleResults.length ? (
          <ul className="finder-result-list">
            {visibleResults.map((item, index) => (
              <li key={`${item.date}-${item.room.id}-${index}`} className="finder-result">
                <div>
                  <p className="finder-result-title">
                    <span className="dot empty" /> {item.room.name}
                  </p>
                  <p className="finder-result-meta">
                    {formatDayDate(item.date)} · {formatMinutes(item.start)}–{formatMinutes(item.end)}
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Reserve"
                  onClick={() =>
                    onReserve({
                      date: item.date,
                      day: getDayKeyFromDateKey(item.date),
                      time: item.start,
                      roomId: item.room.id,
                      durationMinutes: duration * 60
                    })
                  }
                >
                  <AddIcon />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>אין התאמות בטווח שבחרת.</p>
        )}
        {results.length > visibleCount ? (
          <button
            type="button"
            className="chip ghost small"
            onClick={() => setVisibleCount((count) => count + 20)}
          >
            עוד תוצאות
          </button>
        ) : null}
      </div>
    </section>
  );
}
