import { useEffect, useMemo, useState } from "react";
import { formatMinutes } from "../../../lib/scheduleBuilder";
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
  userRemainingMinutes: number;
  mode?: "create" | "edit";
  onRelease?: () => void;
  onConfirm: (startMinutes: number, durationMinutes: number) => void;
  onClose: () => void;
};

const formatDurationLabel = (minutes: number) => {
  if (minutes === 30) return "חצי שעה";
  if (minutes === 60) return "שעה";
  if (minutes === 90) return "שעה וחצי";
  if (minutes === 120) return "שעתיים";
  if (minutes === 150) return "שעתיים וחצי";
  if (minutes === 180) return "3 שעות";
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours} שעות`;
  return `${hours.toFixed(2)} שעות`;
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
  userRemainingMinutes,
  mode = "create",
  onRelease,
  onConfirm,
  onClose
}: ReserveConfirmOverlayProps) {
  const [startMinutes, setStartMinutes] = useState(initialStart);
  const [endMinutes, setEndMinutes] = useState(initialStart + initialDuration);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setStartMinutes(initialStart);
      setEndMinutes(initialStart + initialDuration);
      setInfoOpen(false);
    }
  }, [open, initialStart, initialDuration]);

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
  const maxDurationForStart = Math.floor(Math.min(limitEnd - startMinutes, userRemainingMinutes, 180) / STEP) * STEP;
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
                const nextMaxRaw = Math.min(limitEnd - nextStart, userRemainingMinutes, 180);
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
                <div>שמירת חדרים מוגבלת ל-3 שעות לחדר ליום.</div>
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

        <p className="reserve-duration">משך: {formatDurationLabel(durationMinutes)}</p>

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
                onClick={() => onConfirm(startMinutes, durationMinutes)}
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
                onClick={() => onConfirm(startMinutes, durationMinutes)}
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
