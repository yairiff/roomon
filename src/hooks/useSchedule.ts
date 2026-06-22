import { useMemo } from "react";
import { allWeekDays, defaultWeekDayKeys, timeSlots, weekDays, rimonScheduleConfig } from "../config";
import { parseDateKey } from "../lib/date";
import { buildReservationPolicyWindows, getReservationPolicyDayKeys } from "../lib/reservationPolicyWindows";
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
  const { semesters, reservationPolicy, reservationPolicies, apiSync } = useScheduleSettings();
  const policyWindows = useMemo(
    () =>
      buildReservationPolicyWindows(
        reservationPolicies,
        rimonScheduleConfig.startHour * 60,
        rimonScheduleConfig.endHour * 60
      ),
    [reservationPolicies]
  );
  const policyDayKeys = useMemo(() => {
    const next = getReservationPolicyDayKeys(policyWindows);
    return next.length ? next : defaultWeekDayKeys;
  }, [policyWindows]);
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
    return policyDayKeys.includes(dateDay);
  }, [activeSemester, dateKey, policyDayKeys]);
  const visibleWeekDays = useMemo(() => {
    const allowed = new Set(policyDayKeys);
    const filtered = allWeekDays.filter((day) => allowed.has(day.key));
    return filtered.length ? filtered : weekDays;
  }, [policyDayKeys]);

  const semesterScope = useMemo(() => {
    if (!activeSemester || !isStudyDate) return null;
    if (!isPrimarySemesterLetter(activeSemester.letter || "")) return [activeSemester.id];
    return [activeSemester.id, buildYearlySemesterId(activeSemester.studyYear)];
  }, [activeSemester, isStudyDate]);
  const { lessons: lessonRecords } = useLessons(semesterScope);
  const { rooms: roomsFromDb, roomMeta } = useRooms();

  const manualLessons = lessonRecords.filter((lesson) => lesson.syncSource !== "api");
  const lessons = semesterScope
    ? apiSync.entities.lessons.enabled
      ? manualLessons
      : lessonRecords
    : [];
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
    weekDays: visibleWeekDays,
    timeSlots,
    lessonIndex,
    semester: semesterScope?.[0] || null,
    semesterRecord: activeSemester,
    semesters,
    apiSync,
    roomMeta,
    reservationPolicy,
    reservationPolicies,
    policyWindows
  };
}
