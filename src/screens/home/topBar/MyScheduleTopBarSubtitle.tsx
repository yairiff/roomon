import type { Dispatch, RefObject, SetStateAction } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "../../../components/Icons";
import { formatShortDate, getWeekNumber } from "../../../lib/date";
import type { WeekDate } from "../../../lib/date";

type MyScheduleTopBarSubtitleProps = {
  myScheduleMode: "day" | "week" | "agenda";
  setMyScheduleMode: Dispatch<SetStateAction<"day" | "week" | "agenda">>;
  selectedDate: string;
  navText: string;
  weekDates: WeekDate[];
  onPrev: () => void;
  onNext: () => void;
  onOpenDatePicker: () => void;
  dateInputRef: RefObject<HTMLInputElement>;
  setSelectedDate: Dispatch<SetStateAction<string>>;
};

export default function MyScheduleTopBarSubtitle({
  myScheduleMode,
  setMyScheduleMode,
  selectedDate,
  navText,
  weekDates,
  onPrev,
  onNext,
  onOpenDatePicker,
  dateInputRef,
  setSelectedDate
}: MyScheduleTopBarSubtitleProps) {
  const weekStart = weekDates[0]?.dateKey;
  const weekEnd = weekDates[weekDates.length - 1]?.dateKey;
  const label =
    myScheduleMode === "agenda"
      ? "מהיום"
      : myScheduleMode === "week"
        ? `שבוע ${getWeekNumber(selectedDate)}`
        : navText;
  const hint =
    myScheduleMode === "week" && weekStart && weekEnd ? `${formatShortDate(weekStart)}–${formatShortDate(weekEnd)}` : "";

  return (
    <div className="top-bar-schedule">
      <div className="top-bar-schedule-row one-col">
        <div className="top-bar-field schedule-date">
          <div className="top-bar-field-hints">
            <span className="top-bar-field-hint">תאריך</span>
            <div className="top-bar-mode-group" role="tablist" aria-label="תצוגת מערכת">
              <button
                type="button"
                className="top-bar-mode-mini"
                aria-pressed={myScheduleMode === "day"}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setMyScheduleMode("day")}
              >
                יומי
              </button>
              <button
                type="button"
                className="top-bar-mode-mini"
                aria-pressed={myScheduleMode === "week"}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setMyScheduleMode("week")}
              >
                שבועי
              </button>
              <button
                type="button"
                className="top-bar-mode-mini"
                aria-pressed={myScheduleMode === "agenda"}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setMyScheduleMode("agenda")}
              >
                אג׳נדה
              </button>
            </div>
          </div>

          <div className="top-bar-date-pill schedule">
            <button
              type="button"
              className="icon-button inline"
              onClick={onPrev}
              aria-label="הקודם"
              disabled={myScheduleMode === "agenda"}
            >
              <ChevronRightIcon />
            </button>
            <button
              type="button"
              className="top-bar-date-button"
              onClick={myScheduleMode === "agenda" ? undefined : onOpenDatePicker}
            >
              {label}
              {hint ? <span className="sr-only"> {hint}</span> : null}
            </button>
            <button
              type="button"
              className="icon-button inline"
              onClick={onNext}
              aria-label="הבא"
              disabled={myScheduleMode === "agenda"}
            >
              <ChevronLeftIcon />
            </button>
          </div>

          <input
            ref={dateInputRef}
            className="top-bar-date-input"
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

