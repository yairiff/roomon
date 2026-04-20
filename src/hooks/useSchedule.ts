import { useMemo } from "react";
import { timeSlots, weekDays, rimonScheduleConfig } from "../config";
import { parseDateKey } from "../lib/date";
import { buildLessonIndex, buildRoomsFromLessons } from "../lib/scheduleBuilder";
import { buildYearlySemesterId } from "../lib/semesterScope";
import { useLessons } from "./useLessons";
import { useRooms } from "./useRooms";
import { useScheduleSettings } from "./useScheduleSettings";

const weekDayByDate = (dateKey: string) => {
  const day = parseDateKey(dateKey).getDay();
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  return map[day] || "sun";
};

const isPrimarySemesterLetter = (letter: string) => {
  const normalized = letter.trim();
  return normalized === "א" || normalized === "ב" || normalized.toUpperCase() === "A" || normalized.toUpperCase() === "B";
};

export function useSchedule(dateKey: string) {
  const { semesters, reservationPolicy, reservationPolicies } = useScheduleSettings();
  const activeSemester = useMemo(() => {
    const selectedDate = parseDateKey(dateKey);
    return semesters.find((semester) => {
      const start = parseDateKey(semester.startDate);
      const end = parseDateKey(semester.endDate);
      return selectedDate >= start && selectedDate <= end;
    }) || null;
  }, [dateKey, semesters]);

  const isStudyDate = useMemo(() => {
    if (!activeSemester) return false;
    if (activeSemester.holidays.some((holiday) => holiday.date === dateKey)) return false;
    const dateDay = weekDayByDate(dateKey);
    if (dateDay === "fri" || dateDay === "sat") return false;
    return activeSemester.studyDayKeys.includes(dateDay);
  }, [activeSemester, dateKey]);

  const semesterScope = useMemo(() => {
    if (!activeSemester || !isStudyDate) return null;
    if (!isPrimarySemesterLetter(activeSemester.letter || "")) return [activeSemester.id];
    return [activeSemester.id, buildYearlySemesterId(activeSemester.studyYear)];
  }, [activeSemester, isStudyDate]);
  const { lessons: lessonRecords } = useLessons(semesterScope);
  const { rooms: roomsFromDb, roomMeta } = useRooms();

  const lessons = semesterScope ? lessonRecords : [];
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
    semester: semesterScope?.[0] || null,
    semesterRecord: activeSemester,
    semesters,
    roomMeta,
    reservationPolicy,
    reservationPolicies
  };
}
