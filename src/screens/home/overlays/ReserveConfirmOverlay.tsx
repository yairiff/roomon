import { useEffect, useMemo, useState } from "react";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import type { ReserveRequest } from "../../types/reservations";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";

export type ReserveConfirmOverlayProps = {
  open: boolean;
  title: string;
  room: string;
  dateLine: string;
  request: ReserveRequest;
  limitEnd: number;
  startMinutes: number;
  initialDuration: number;
  userRemainingMinutes: number;
  onConfirm: (startMinutes: number, durationMinutes: number) => void;
  onClose: () => void;
};

const formatDurationLabel = (minutes: number) => {
  if (minutes === 60) return "שעה";
  if (minutes === 120) return "שעתיים";
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
  initialDuration,
  userRemainingMinutes,
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
    const options: number[] = [];
    for (let value = initialStart; value + 60 <= limitEnd; value += 60) {
      options.push(value);
    }
    if (!options.includes(initialStart)) {
      options.unshift(initialStart);
    }
    return options;
  }, [initialStart, limitEnd]);

  const maxDurationForStart = Math.min(limitEnd - startMinutes, userRemainingMinutes, 180);
  const endOptions = useMemo(() => {
    const durations = [60, 120, 180].filter((value) => value <= maxDurationForStart);
    return durations.map((duration) => ({
      end: startMinutes + duration,
      duration,
      label: `${formatMinutes(startMinutes + duration)} (${formatDurationLabel(duration)})`
    }));
  }, [maxDurationForStart, startMinutes]);

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
                const previousDuration = Math.max(60, endMinutes - startMinutes);
                setStartMinutes(nextStart);
                const nextMax = Math.min(limitEnd - nextStart, userRemainingMinutes, 180);
                const nextDuration = Math.max(60, Math.min(previousDuration, nextMax));
                setEndMinutes(nextStart + Math.floor(nextDuration / 60) * 60);
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
            </div>
            <div className={`reserve-tooltip${infoOpen ? " open" : ""}`} role="tooltip">
              <div>שמירת חדרים מוגבלת ל-3 שעות לחדר ליום.</div>
              <div>להחרגה יש לפנות למנהל מורשה.</div>
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

        <div className="reserve-actions">
          <button className="secondary" type="button" onClick={onClose}>
            ביטול
          </button>
          <button
            className="primary"
            type="button"
            disabled={durationMinutes < 60}
            onClick={() => onConfirm(startMinutes, durationMinutes)}
          >
            אישור
          </button>
        </div>
      </div>
    </div>
  );
}
