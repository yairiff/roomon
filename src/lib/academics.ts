import { rimonScheduleConfig } from "../config";
import { parseDateKey } from "./date";

export function getAcademicYearStartYear(date = new Date()) {
  const ranges = rimonScheduleConfig.semesterRanges || [];
  const match = ranges.find((range) => {
    const start = parseDateKey(range.start);
    const end = parseDateKey(range.end);
    return date >= start && date <= end;
  });
  if (match) {
    const start = parseDateKey(match.start);
    // Academic year starts in Tishrei season (around Sep/Oct). If a range starts in Jan-Jun,
    // it belongs to the academic year that started in the previous calendar year.
    return start.getMonth() >= 7 ? start.getFullYear() : start.getFullYear() - 1;
  }
  const month = date.getMonth();
  return month >= 7 ? date.getFullYear() : date.getFullYear() - 1;
}

export function cohortStartYearFromGrade(grade: "A" | "B" | "C", date = new Date()) {
  const startYear = getAcademicYearStartYear(date);
  const offset = grade === "A" ? 0 : grade === "B" ? 1 : 2;
  return startYear - offset;
}

export function gradeLabelFromCohort(cohortStartYear?: number, date = new Date()) {
  if (!cohortStartYear) return "";
  const startYear = getAcademicYearStartYear(date);
  const diff = startYear - cohortStartYear;
  if (diff <= 0) return "א";
  if (diff === 1) return "ב";
  if (diff === 2) return "ג";
  return "בוגר";
}

export function gradeOptions() {
  return [
    { value: "A", label: "א" },
    { value: "B", label: "ב" },
    { value: "C", label: "ג" }
  ] as const;
}

export function gradeValueFromCohort(cohortStartYear?: number, date = new Date()) {
  const label = gradeLabelFromCohort(cohortStartYear, date);
  if (label === "ב") return "B";
  if (label === "ג" || label === "בוגר") return "C";
  return "A";
}
