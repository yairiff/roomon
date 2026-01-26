import type { Lesson, Room, TimeSlot, ScheduleConfig } from "../types/schedule";
import { parseCsv } from "./csv";

const REQUIRED_COLUMNS = ["course", "day", "time", "room"] as const;

type RequiredColumn = typeof REQUIRED_COLUMNS[number];

type ColumnIndex = ScheduleConfig["columns"] & Record<string, string>;

type ColumnMap = Record<RequiredColumn | string, number>;

export function buildTimeSlots({ startHour, endHour, slotMinutes }: ScheduleConfig): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const startMinutes = startHour * 60;
  const endMinutes = endHour * 60;
  for (let minutes = startMinutes; minutes < endMinutes; minutes += slotMinutes) {
    const end = Math.min(minutes + slotMinutes, endMinutes);
    slots.push({ startMinutes: minutes, endMinutes: end });
  }
  return slots;
}

export function formatMinutes(minutes: number): string {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

export function buildLessonsFromCsv(
  csvText: string,
  config: ScheduleConfig,
  semesterKey: "A" | "B"
): Lesson[] {
  const rows = parseCsv(csvText);
  if (!rows.length) return [];

  const [header, ...dataRows] = rows;
  const columnIndex = buildColumnIndex(header, config.columns);

  if (!hasRequiredColumns(columnIndex)) {
    console.warn("CSV header missing required columns.", columnIndex);
    return [];
  }

  const normalizedRows = expandRows(dataRows, header.length, Object.keys(config.dayMap));
  const lessons: Lesson[] = [];

  normalizedRows.forEach((row, index) => {
    const normalizedRow = normalizeRow(row, header.length);
    if (!normalizedRow.length) return;

    const course = getCell(normalizedRow, columnIndex.course)?.trim();
    if (!course) return;

    const dayRaw = getCell(normalizedRow, columnIndex.day)?.trim();
    const day = config.dayMap[dayRaw];
    if (!day) return;

    const roomId = (getCell(normalizedRow, columnIndex.room) || "").trim();
    if (!roomId) return;

    const timeValue = getCell(normalizedRow, columnIndex.time);
    const startMinutes = parseTimeToMinutes(timeValue);

    if (Number.isNaN(startMinutes)) return;

    const durationAcademic = pickSemesterHours(normalizedRow, columnIndex, semesterKey);
    if (!durationAcademic || durationAcademic <= 0) return;
    const durationMinutes = Math.round(durationAcademic * config.academicHourMinutes);
    if (durationMinutes <= 0) return;

    lessons.push({
      id: `lesson-${index}`,
      title: course,
      teacher: getCell(normalizedRow, columnIndex.teacher)?.trim() || "",
      day,
      roomId,
      startMinutes,
      durationMinutes
    });
  });

  return lessons;
}

export function buildRoomsFromLessons(
  lessons: Lesson[],
  overrides: Record<string, string> = {},
  order: string[] = [],
  shortOverrides: Record<string, string> = {}
): Room[] {
  const ids = new Set<string>();
  lessons.forEach((lesson) => ids.add(lesson.roomId));
  const unique = Array.from(ids);

  const ordered = order.length
    ? [...order, ...unique.filter((id) => !order.includes(id))]
    : unique.sort((a, b) => a.localeCompare(b, "he"));

  return ordered.map((id) => {
    const name = overrides[id] || id.replace(/_/g, " ");
    return {
      id,
      name,
      shortName: shortOverrides[id] || name
    };
  });
}

export function buildLessonIndex({
  lessons,
  timeSlots
}: {
  lessons: Lesson[];
  timeSlots: TimeSlot[];
}): Map<string, Lesson[]> {
  const bySlot = new Map<string, Lesson[]>();

  lessons.forEach((lesson) => {
    const lessonStart = lesson.startMinutes;
    const lessonEnd = lesson.startMinutes + lesson.durationMinutes;

    timeSlots.forEach((slot) => {
      const overlaps = lessonStart < slot.endMinutes && lessonEnd > slot.startMinutes;
      if (!overlaps) return;
      const key = `${lesson.day}-${slot.startMinutes}-${lesson.roomId}`;
      const entry = bySlot.get(key) || [];
      entry.push(lesson);
      bySlot.set(key, entry);
    });
  });

  return bySlot;
}

function buildColumnIndex(headerRow: string[], columns: ColumnIndex): ColumnMap {
  const map: ColumnMap = {};
  Object.entries(columns).forEach(([key, label]) => {
    const index = headerRow.findIndex((cell) => normalizeCell(cell) === normalizeCell(label));
    map[key] = index;
  });
  return map;
}

function hasRequiredColumns(columnIndex: ColumnMap) {
  return REQUIRED_COLUMNS.every((column) => columnIndex[column] !== -1);
}

function normalizeCell(value: string) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
}

function normalizeRow(row: string[], targetLength: number) {
  if (!targetLength || row.length >= targetLength) return row;
  return [...row, ...Array.from({ length: targetLength - row.length }, () => "")];
}

function expandRows(rows: string[][], columnCount: number, dayTokens: string[]) {
  const expanded: string[][] = [];
  rows.forEach((row) => {
    if (!row || row.length === 0) return;
    if (row.length <= columnCount) {
      expanded.push(row);
      return;
    }

    const dayIndexes = row
      .map((cell, index) => ({
        index,
        value: String(cell || "").trim()
      }))
      .filter((entry) => dayTokens.includes(entry.value))
      .map((entry) => entry.index);

    if (dayIndexes.length) {
      dayIndexes.forEach((dayIndex) => {
        const start = dayIndex - 4;
        const end = dayIndex + 3;
        if (start < 0 || end > row.length) return;
        const slice = row.slice(start, end);
        if (slice.length === columnCount) {
          expanded.push(slice);
        }
      });
      return;
    }

    const fullChunks = Math.floor(row.length / columnCount);
    for (let i = 0; i < fullChunks; i += 1) {
      const slice = row.slice(i * columnCount, (i + 1) * columnCount);
      expanded.push(slice);
    }
  });

  return expanded;
}

function getCell(row: string[], index?: number) {
  if (index === -1 || typeof index !== "number") return "";
  return row[index] ?? "";
}

function pickSemesterHours(
  row: string[],
  columnIndex: ColumnMap,
  semesterKey: "A" | "B"
) {
  const key = semesterKey === "B" ? "semesterB" : "semesterA";
  const raw = getCell(row, columnIndex[key]);
  if (raw === "" || raw === null || raw === undefined) return 0;
  const num = Number(String(raw).replace(/,/g, "."));
  return Number.isFinite(num) ? num : 0;
}

function parseTimeToMinutes(raw: string) {
  if (raw === "" || raw === null || raw === undefined) return Number.NaN;
  const text = String(raw).trim();
  if (text.includes(":")) {
    const [hoursText, minutesText = "0"] = text.split(":");
    const hours = Number(hoursText);
    const minutes = Number(minutesText);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.NaN;
    return hours * 60 + minutes;
  }

  const value = Number(text.replace(/,/g, "."));
  if (!Number.isFinite(value)) return Number.NaN;
  const hours = Math.floor(value);
  const fraction = value - hours;
  const minutes = Math.round(fraction * 60);
  return hours * 60 + minutes;
}
