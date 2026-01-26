import { useMemo } from "react";
import { buildSchedule, getSemesterKeyFromDate, timeSlots, weekDays } from "../data/schedule";
import { buildLessonIndex } from "../lib/scheduleBuilder";

export function useSchedule(dateKey: string) {
  const semester = useMemo(() => getSemesterKeyFromDate(dateKey), [dateKey]);
  const schedule = useMemo(() => buildSchedule(semester), [semester]);
  const lessonIndex = useMemo(
    () => buildLessonIndex({ lessons: schedule.lessons, timeSlots }),
    [schedule.lessons]
  );

  return {
    ...schedule,
    weekDays,
    timeSlots,
    lessonIndex,
    semester
  };
}
