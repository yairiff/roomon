import { useEffect, useMemo, useState } from "react";
import { addDays, formatDateKey, formatShortDate, parseDateKey, getDayKeyFromDateKey } from "../../../lib/date";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import { formatDurationLabelHe } from "../../../lib/formatDurationHe";
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
  onOpenSchedule: (roomId: string, dateKey: string) => void;
  onDateWindowChange?: (startDate: string, endDate: string) => void;
};

export default function BookingFinder({
  rooms,
  lessons,
  reservationMap,
  startHour,
  endHour,
  roomMeta,
  getLessonsForDate,
  onReserve,
  onOpenSchedule,
  onDateWindowChange
}: BookingFinderProps) {
  const [advancedMode, setAdvancedMode] = useState(false);
  const [startDate, setStartDate] = useState(() => formatDateKey(new Date()));
  const [endDate, setEndDate] = useState(() => formatDateKey(addDays(new Date(), 7)));
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);
  const [fromHour, setFromHour] = useState(startHour);
  const [toHour, setToHour] = useState(endHour);
  const [duration, setDuration] = useState("");
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

  const durationFilterMinutes = duration ? Number(duration) * 60 : 0;

  useEffect(() => {
    onDateWindowChange?.(effectiveStartDate, effectiveEndDate);
  }, [effectiveEndDate, effectiveStartDate, onDateWindowChange]);

  const results = useMemo(() => {
    const start = parseDateKey(effectiveStartDate);
    const end = parseDateKey(effectiveEndDate);
    if (start > end) return [];

    const minGap = durationFilterMinutes || 0;
    const dates: string[] = [];
    for (let date = start; date <= end; date = addDays(date, 1)) {
      const day = date.getDay();
      if (day === 5 || day === 6) continue;
      if (!advancedMode && selectedWeekdays.length && !selectedWeekdays.includes(day)) continue;
      dates.push(formatDateKey(date));
    }

    const items: { date: string; day: DayKey; room: Room; start: number; end: number }[] = [];

    dates.forEach((dateKey) => {
      const dayKey = getDayKeyFromDateKey(dateKey);
      const dayLessons = getLessonsForDate
        ? getLessonsForDate(dateKey, dayKey)
        : lessons.filter((lesson) => lesson.day === dayKey);
      const reservations = reservationMap[dateKey] || [];

      availableRooms.forEach((room) => {
        const policy = roomMeta?.[room.id];
        const roomOpen = Math.max(policy?.openMinutes ?? startHour * 60, fromHour * 60);
        const roomClose = Math.min(policy?.closeMinutes ?? endHour * 60, toHour * 60);
        if (roomOpen >= roomClose) return;

        const busyIntervals = [
          ...dayLessons
            .filter((lesson) => lesson.roomId === room.id)
            .map((lesson) => ({
              start: lesson.startMinutes,
              end: lesson.startMinutes + lesson.durationMinutes
            })),
          ...reservations
            .filter((entry) => entry.roomId === room.id)
            .map((entry) => ({
              start: entry.time,
              end: entry.time + entry.durationMinutes
            }))
        ]
          .sort((a, b) => a.start - b.start);

        let cursor = roomOpen;
        busyIntervals.forEach((interval) => {
          if (interval.end <= cursor) {
            cursor = Math.max(cursor, interval.end);
            return;
          }
          const gapStart = cursor;
          const gapEnd = Math.min(Math.max(interval.start, cursor), roomClose);
          const alignedStart = Math.ceil(gapStart / 60) * 60;
          const alignedEnd = Math.floor(gapEnd / 60) * 60;
          if (alignedEnd - alignedStart >= minGap && alignedEnd > alignedStart) {
            items.push({ date: dateKey, day: dayKey, room, start: alignedStart, end: alignedEnd });
          }
          cursor = Math.max(cursor, interval.end);
          if (cursor >= roomClose) return;
        });

        if (cursor < roomClose) {
          const gapStart = cursor;
          const gapEnd = roomClose;
          const alignedStart = Math.ceil(gapStart / 60) * 60;
          const alignedEnd = Math.floor(gapEnd / 60) * 60;
          if (alignedEnd - alignedStart >= minGap && alignedEnd > alignedStart) {
            items.push({ date: dateKey, day: dayKey, room, start: alignedStart, end: alignedEnd });
          }
        }
      });
    });

    return items.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.start !== b.start) return a.start - b.start;
      return a.room.name.localeCompare(b.room.name);
    });
  }, [
    advancedMode,
    availableRooms,
    durationFilterMinutes,
    effectiveEndDate,
    effectiveStartDate,
    endHour,
    fromHour,
    getLessonsForDate,
    lessons,
    reservationMap,
    roomMeta,
    selectedWeekdays,
    startHour,
    toHour
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
            {advancedMode ? "" : "בימים"}
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
          משך מינימלי
          <select value={duration} onChange={(event) => setDuration(event.target.value)}>
            <option value="">בחר...</option>
            {Array.from({ length: Math.min(3, endHour - startHour) }, (_, index) => index + 1).map((h) => (
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
                  {room.name}
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
              <li
                key={`${item.date}-${item.room.id}-${index}`}
                className="finder-result clickable"
                role="button"
                tabIndex={0}
                onClick={() => onOpenSchedule(item.room.id, item.date)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onOpenSchedule(item.room.id, item.date);
                  }
                }}
              >
                <div>
                  <p className="finder-result-title">
                    <span className="dot empty" /> {item.room.name}
                  </p>
                  <p className="finder-result-meta">
                    {formatDayDate(item.date)} · {formatMinutes(item.start)}–{formatMinutes(item.end)} ·{" "}
                    {formatDurationLabelHe(item.end - item.start)}
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Reserve"
                  onClick={(event) => {
                    event.stopPropagation();
                    onReserve({
                      date: item.date,
                      day: item.day,
                      time: item.start,
                      roomId: item.room.id,
                      durationMinutes: duration ? durationFilterMinutes : undefined
                    });
                  }}
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
