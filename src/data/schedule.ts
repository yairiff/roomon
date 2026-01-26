import csvText from "./rimon_schedule.csv?raw";
import { rimonScheduleConfig } from "./rimonScheduleConfig";
import { buildLessonsFromCsv, buildRoomsFromLessons, buildTimeSlots } from "../lib/scheduleBuilder";
import { roomLabels, roomOrder, roomShortLabels } from "./rooms";
import type { ScheduleData, WeekDay, TimeSlot } from "../types/schedule";
import type { SemesterKey } from "../types/ui";
import { parseDateKey } from "../lib/date";

export const weekDays: WeekDay[] = [
  { key: "sun", label: "ראשון", short: "א" },
  { key: "mon", label: "שני", short: "ב" },
  { key: "tue", label: "שלישי", short: "ג" },
  { key: "wed", label: "רביעי", short: "ד" },
  { key: "thu", label: "חמישי", short: "ה" }
];

export const timeSlots: TimeSlot[] = buildTimeSlots(rimonScheduleConfig);

export function buildSchedule(semesterKey: SemesterKey = "A"): ScheduleData {
  const lessons = buildLessonsFromCsv(csvText, rimonScheduleConfig, semesterKey);
  const rooms = buildRoomsFromLessons(
    lessons,
    { ...rimonScheduleConfig.roomLabelOverrides, ...roomLabels },
    roomOrder,
    roomShortLabels
  );
  return { lessons, rooms, config: rimonScheduleConfig };
}

export function getSemesterKeyFromDate(dateKey: string): SemesterKey {
  const date = parseDateKey(dateKey);
  const ranges = rimonScheduleConfig.semesterRanges || [];
  const match = ranges.find((range) => {
    const start = parseDateKey(range.start);
    const end = parseDateKey(range.end);
    return date >= start && date <= end;
  });

  return match?.key ?? "A";
}
