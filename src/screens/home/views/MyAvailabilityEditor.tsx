import { useEffect, useMemo, useRef, useState } from "react";
import { collaborationWeekdays, type UserAvailability } from "../../../types/collaboration";
import type { DayKey, WeekDay } from "../../../types/schedule";
import { formatMinutes } from "../../../lib/scheduleBuilder";

type MyAvailabilityEditorProps = {
  weekDays: WeekDay[];
  availability: UserAvailability;
  onDayUpdate: (
    dayKey: DayKey,
    updates: Partial<{ enabled: boolean; startMinutes: number; endMinutes: number }>
  ) => void;
  startHour: number;
  endHour: number;
};

type DragState = {
  dayKey: DayKey;
  handle: "start" | "end";
};

export default function MyAvailabilityEditor({
  weekDays,
  availability,
  onDayUpdate,
  startHour,
  endHour
}: MyAvailabilityEditorProps) {
  const [draft, setDraft] = useState<UserAvailability>(availability);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dayRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const draftRef = useRef<UserAvailability>(availability);
  const topMinutes = startHour * 60;
  const bottomMinutes = endHour * 60;
  const visibleDuration = Math.max(60, bottomMinutes - topMinutes);
  const hourMarks = useMemo(
    () => Array.from({ length: Math.max(1, endHour - startHour + 1) }, (_, index) => startHour + index),
    [endHour, startHour]
  );

  useEffect(() => {
    if (drag) return;
    setDraft(availability);
  }, [availability, drag]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const track = dayRefs.current[drag.dayKey];
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      const minutesFromTop = Math.round((y / Math.max(1, rect.height)) * visibleDuration);
      const absoluteMinutesRaw = topMinutes + minutesFromTop;
      const absoluteMinutes = Math.round(absoluteMinutesRaw / 30) * 30;
      setDraft((prev) => {
        const current = prev[drag.dayKey];
        if (!current) return prev;
        if (drag.handle === "start") {
          const startMinutes = Math.max(topMinutes, Math.min(absoluteMinutes, current.endMinutes - 30));
          return { ...prev, [drag.dayKey]: { ...current, startMinutes } };
        }
        const endMinutes = Math.min(bottomMinutes, Math.max(absoluteMinutes, current.startMinutes + 30));
        return { ...prev, [drag.dayKey]: { ...current, endMinutes } };
      });
    };
    const up = () => {
      setDrag((currentDrag) => {
        if (!currentDrag) return null;
        const day = draftRef.current[currentDrag.dayKey];
        if (day) {
          onDayUpdate(currentDrag.dayKey, {
            startMinutes: day.startMinutes,
            endMinutes: day.endMinutes
          });
        }
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, onDayUpdate, topMinutes, visibleDuration]);

  const dayLabels = useMemo(() => {
    const map = new Map<DayKey, string>();
    weekDays.forEach((day) => map.set(day.key, day.short || day.label));
    return map;
  }, [weekDays]);

  return (
    <div className="availability-editor schedule-like">
      <p className="field-label">עריכת זמינות על גבי הלוח</p>
      <div className="availability-board">
        <div className="availability-hours">
          {hourMarks.map((hour) => (
            <span key={hour}>{String(hour).padStart(2, "0")}:00</span>
          ))}
        </div>
        <div className="availability-days">
          {collaborationWeekdays.map((dayKey) => {
            const day = draft[dayKey];
            if (!day) return null;
            const start = ((day.startMinutes - topMinutes) / visibleDuration) * 100;
            const end = ((day.endMinutes - topMinutes) / visibleDuration) * 100;
            return (
              <div key={dayKey} className={`availability-day-col ${day.enabled ? "enabled" : "disabled"}`}>
                <button
                  type="button"
                  className={`chip small ${day.enabled ? "active" : ""}`}
                  onClick={() => {
                    const enabled = !day.enabled;
                    setDraft((prev) => ({ ...prev, [dayKey]: { ...day, enabled } }));
                    onDayUpdate(dayKey, { enabled });
                  }}
                >
                  {dayLabels.get(dayKey) || dayKey}
                </button>
                <button
                  type="button"
                  className={`chip small ${!day.enabled ? "active" : ""}`}
                  onClick={() => {
                    const enabled = false;
                    setDraft((prev) => ({ ...prev, [dayKey]: { ...day, enabled } }));
                    onDayUpdate(dayKey, { enabled });
                  }}
                >
                  יום חופשי
                </button>
                <div
                  ref={(node) => {
                    dayRefs.current[dayKey] = node;
                  }}
                  className="availability-day-track"
                >
                  {hourMarks.map((hour) => (
                    <div
                      key={`${dayKey}-${hour}`}
                      className="availability-grid-line"
                      style={{ top: `${((hour * 60 - topMinutes) / visibleDuration) * 100}%` }}
                    />
                  ))}
                  <div
                    className="availability-range"
                    style={{
                      top: `${Math.max(0, start)}%`,
                      height: `${Math.max(0, end - start)}%`
                    }}
                  />
                  <button
                    type="button"
                    className="availability-line-marker"
                    style={{ top: `${Math.max(0, start)}%` }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      if (!day.enabled) return;
                      setDrag({ dayKey, handle: "start" });
                    }}
                  />
                  <button
                    type="button"
                    className="availability-line-marker"
                    style={{ top: `${Math.max(0, end)}%` }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      if (!day.enabled) return;
                      setDrag({ dayKey, handle: "end" });
                    }}
                  />
                </div>
                <div className="availability-time">
                  <span>{day.enabled ? formatMinutes(day.startMinutes) : "כבוי"}</span>
                  <span>{day.enabled ? formatMinutes(day.endMinutes) : "כבוי"}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
