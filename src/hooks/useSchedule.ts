import { useMemo } from "react";
import { getSemesterKeyFromDate, timeSlots, weekDays, rimonScheduleConfig } from "../config";
import { buildLessonIndex, buildRoomsFromLessons } from "../lib/scheduleBuilder";
import { useLessons } from "./useLessons";
import { useRooms } from "./useRooms";
import { useScheduleSettings } from "./useScheduleSettings";

export function useSchedule(dateKey: string) {
  const { semesterRanges } = useScheduleSettings();
  const semester = useMemo(
    () => getSemesterKeyFromDate(dateKey, semesterRanges.length ? semesterRanges : rimonScheduleConfig.semesterRanges),
    [dateKey, semesterRanges]
  );
  const { lessons: lessonRecords } = useLessons(semester);
  const { rooms: roomsFromDb, roomMeta } = useRooms();

  const lessons = semester ? lessonRecords : [];
  const rooms = roomsFromDb.length
    ? roomsFromDb
    : buildRoomsFromLessons(lessons, { ...rimonScheduleConfig.roomLabelOverrides });

  const lessonIndex = useMemo(
    () => buildLessonIndex({ lessons, timeSlots }),
    [lessons]
  );

  return {
    lessons,
    rooms,
    config: rimonScheduleConfig,
    weekDays,
    timeSlots,
    lessonIndex,
    semester,
    roomMeta
  };
}
