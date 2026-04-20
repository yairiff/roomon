import { useEffect, useMemo, useState } from "react";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import { formatDurationLabelHe } from "../../../lib/formatDurationHe";
import type { ReserveRequest } from "../../../types/reservations";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";

export type ReserveConfirmOverlayProps = {
  open: boolean;
  title: string;
  room: string;
  dateLine: string;
  request: ReserveRequest;
  limitEnd: number;
  startMinutes: number;
  windowStart: number;
  initialDuration: number;
  initialPrivateDescription?: string;
  userRemainingMinutes: number;
  limitHoursPerRoomPerDay: number;
  limitHoursPerRoomPerWeek: number;
  limitHoursPerDayTotal: number;
  limitHoursPerWeekTotal: number;
  limitMaxDaysForward: number;
  mode?: "create" | "edit";
  onRelease?: () => void;
  onConfirm: (startMinutes: number, durationMinutes: number, privateDescription?: string) => void;
  onClose: () => void;
};

export default function ReserveConfirmOverlay({
  open,
  title,
  room,
  dateLine,
  request,
  limitEnd,
  startMinutes: initialStart,
  windowStart,
  initialDuration,
  initialPrivateDescription = "",
  userRemainingMinutes,
  limitHoursPerRoomPerDay,
  limitHoursPerRoomPerWeek,
  limitHoursPerDayTotal,
  limitHoursPerWeekTotal,
  limitMaxDaysForward,
  mode = "create",
  onRelease,
  onConfirm,
  onClose
}: ReserveConfirmOverlayProps) {
  const formatHoursLimit = (hours: number) => (hours <= 0 ? "ללא הגבלה" : `${hours}`);
  const [startMinutes, setStartMinutes] = useState(initialStart);
  const [endMinutes, setEndMinutes] = useState(initialStart + initialDuration);
  const [privateDescription, setPrivateDescription] = useState(initialPrivateDescription);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setStartMinutes(initialStart);
      setEndMinutes(initialStart + initialDuration);
      setPrivateDescription(initialPrivateDescription);
      setInfoOpen(false);
    }
  }, [open, initialDuration, initialPrivateDescription, initialStart]);

  const startOptions = useMemo(() => {
    const STEP = 30;
    const MIN_DURATION = 30;
    const options: number[] = [];
    for (let value = windowStart; value + MIN_DURATION <= limitEnd; value += STEP) {
      options.push(value);
    }
    return options;
  }, [limitEnd, windowStart]);

  const STEP = 30;
  const MIN_DURATION = 30;
  const maxDurationForStart = Math.floor(Math.min(limitEnd - startMinutes, userRemainingMinutes) / STEP) * STEP;
  const endOptions = useMemo(() => {
    const options: { end: number; duration: number; label: string }[] = [];
    for (let duration = MIN_DURATION; duration <= maxDurationForStart; duration += STEP) {
      const end = startMinutes + duration;
      options.push({
        end,
        duration,
        label: `${formatMinutes(end)}`
      });
    }
    return options;
  }, [MIN_DURATION, STEP, maxDurationForStart, startMinutes]);

  useEffect(() => {
    const currentDuration = endMinutes - startMinutes;
    const hasMatch = endOptions.some((opt) => opt.duration === currentDuration);
    if (hasMatch) return;
    if (endOptions.length) {
      setEndMinutes(endOptions[0].end);
    } else {
      setEndMinutes(startMinutes);
    }
  }, [endMinutes, endOptions, startMinutes]);

  if (!open || !request) return null;

  const durationMinutes = Math.max(0, endMinutes - startMinutes);

  return (
    <div className="reserve-overlay" onClick={onClose}>
      <div
        className="reserve-menu"
        onClick={(event) => {
          event.stopPropagation();
          setInfoOpen(false);
        }}
      >
        <p className="reserve-title">{title}</p>
        <p className="reserve-room">{room}</p>
        <p className="reserve-date">{dateLine}</p>

        <div className="reserve-row" dir="rtl">
          <div className="reserve-field reserve-field-start">
            <div className="reserve-hint-row start">
              <span className="reserve-field-hint">מ</span>
            </div>
            <select
              value={startMinutes}
              onChange={(event) => {
                const nextStart = Number(event.target.value);
                const previousDuration = Math.max(MIN_DURATION, endMinutes - startMinutes);
                setStartMinutes(nextStart);
                const nextMaxRaw = Math.min(limitEnd - nextStart, userRemainingMinutes);
                const nextMax = Math.floor(nextMaxRaw / STEP) * STEP;
                const nextDurationRaw = Math.max(MIN_DURATION, Math.min(previousDuration, nextMax));
                const nextDuration = Math.max(MIN_DURATION, Math.floor(nextDurationRaw / STEP) * STEP);
                setEndMinutes(nextStart + nextDuration);
                setInfoOpen(false);
              }}
            >
              {startOptions.map((option) => (
                <option key={option} value={option}>
                  {formatMinutes(option)}
                </option>
              ))}
            </select>
          </div>

          <div className="reserve-field reserve-field-until">
            <div className="reserve-hint-row end">
              <span className="reserve-field-hint">עד</span>
              <button
                type="button"
                className="reserve-info"
                aria-label="מידע"
                onClick={(event) => {
                  event.stopPropagation();
                  setInfoOpen((value) => !value);
                }}
              >
                <InfoOutlinedIcon fontSize="small" />
              </button>
              <div className={`reserve-tooltip${infoOpen ? " open" : ""}`} role="tooltip">
                <div>חדר/יום: {formatHoursLimit(limitHoursPerRoomPerDay)}.</div>
                <div>חדר/שבוע: {formatHoursLimit(limitHoursPerRoomPerWeek)}.</div>
                <div>סה&quot;כ/יום: {formatHoursLimit(limitHoursPerDayTotal)}.</div>
                <div>סה&quot;כ/שבוע: {formatHoursLimit(limitHoursPerWeekTotal)}.</div>
                <div>קדימה: {limitMaxDaysForward <= 0 ? "ללא הגבלה" : `${limitMaxDaysForward} ימים`}.</div>
                <div>להחרגה יש לפנות למנהל מורשה.</div>
              </div>
            </div>
            <select
              value={endMinutes}
              onChange={(event) => {
                setEndMinutes(Number(event.target.value));
                setInfoOpen(false);
              }}
            >
              {endOptions.map((option) => (
                <option key={option.end} value={option.end}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="reserve-duration">משך: {formatDurationLabelHe(durationMinutes)}</p>
        <div className="reserve-field reserve-note-field">
          <label htmlFor="reserve-private-description" className="reserve-field-hint reserve-note-label">
            תיאור אישי (רק בשבילך)
          </label>
          <textarea
            id="reserve-private-description"
            className="reserve-note-input"
            rows={3}
            maxLength={180}
            placeholder="למשל: חזרה לשירימון"
            value={privateDescription}
            onChange={(event) => setPrivateDescription(event.target.value)}
          />
        </div>

        <div className="reserve-actions">
          {mode === "edit" ? (
            <>
              {onRelease ? (
                <button className="secondary" type="button" onClick={onRelease}>
                  שחרור
                </button>
              ) : null}
              <button
                className="primary"
                type="button"
                disabled={durationMinutes < MIN_DURATION}
                onClick={() => onConfirm(startMinutes, durationMinutes, privateDescription.trim())}
              >
                עדכון
              </button>
            </>
          ) : (
            <>
              <button className="secondary" type="button" onClick={onClose}>
                ביטול
              </button>
              <button
                className="primary"
                type="button"
                disabled={durationMinutes < MIN_DURATION}
                onClick={() => onConfirm(startMinutes, durationMinutes, privateDescription.trim())}
              >
                אישור
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
