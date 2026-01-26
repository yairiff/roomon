import type { ScheduleConfig } from "../types/schedule";

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
