import type { ScheduleConfig } from "./types/schedule";
import type { WeekDay, TimeSlot } from "./types/schedule";
import type { SemesterKey } from "./types/ui";
import { buildTimeSlots } from "./lib/scheduleBuilder";
import { parseDateKey } from "./lib/date";

export const rimonScheduleConfig: ScheduleConfig = {
  columns: {
    course: "קורס",
    teacher: "מורה",
    semesterA: "סמסטר א",
    semesterB: "סמסטר ב",
    day: "יום",
    time: "שעה",
    room: "חדר"
  },
  semesterRanges: [
    { key: "A", start: "2025-10-01", end: "2026-02-15" },
    { key: "B", start: "2026-02-30", end: "2026-07-31" }
  ],
  dayMap: {
    "א": "sun",
    "ב": "mon",
    "ג": "tue",
    "ד": "wed",
    "ה": "thu"
  },
  startHour: 9,
  endHour: 22,
  slotMinutes: 60,
  academicHourMinutes: 45,
  roomLabelOverrides: {
    "רב_תכליתי_1": "רב תכליתי 1",
    "רב_תכליתי_2": "רב תכליתי 2"
  }
};

export const weekDays: WeekDay[] = [
  { key: "sun", label: "ראשון", short: "א" },
  { key: "mon", label: "שני", short: "ב" },
  { key: "tue", label: "שלישי", short: "ג" },
  { key: "wed", label: "רביעי", short: "ד" },
  { key: "thu", label: "חמישי", short: "ה" }
];

export const timeSlots: TimeSlot[] = buildTimeSlots(rimonScheduleConfig);

export function getSemesterKeyFromDate(
  dateKey: string,
  ranges: { key: SemesterKey; start: string; end: string }[] = rimonScheduleConfig.semesterRanges
): SemesterKey | null {
  if (!ranges || !ranges.length) return null;
  const date = parseDateKey(dateKey);
  const match = ranges.find((range) => {
    const start = parseDateKey(range.start);
    const end = parseDateKey(range.end);
    return date >= start && date <= end;
  });

  return match?.key ?? null;
}
