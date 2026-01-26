import type { DayKey, WeekDay } from "../types/schedule";

export type WeekDate = WeekDay & {
  dateKey: string;
  shortDate: string;
};

export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function getDayKeyFromDateKey(dateKey: string): DayKey {
  const date = parseDateKey(dateKey);
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  const day = map[date.getDay()] || "sun";
  if (day === "fri" || day === "sat") return "sun";
  return day;
}

export function formatShortDate(dateKey: string) {
  const date = parseDateKey(dateKey);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}`;
}

export function getWeekStart(dateKey: string) {
  const base = parseDateKey(dateKey);
  return addDays(base, -base.getDay());
}

export function buildWeekDates(dateKey: string, weekDays: WeekDay[]): WeekDate[] {
  if (!weekDays.length) return [];
  const startOfWeek = getWeekStart(dateKey);

  return weekDays.map((day, index) => {
    const date = addDays(startOfWeek, index);
    const key = formatDateKey(date);
    return {
      ...day,
      dateKey: key,
      shortDate: formatShortDate(key)
    };
  });
}

export function getWeekNumber(dateKey: string) {
  const date = parseDateKey(dateKey);
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);

  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);

  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
}

export function formatWeekRange(dateKey: string, weekDays: WeekDay[]) {
  if (!weekDays.length) return "";
  const start = formatShortDate(formatDateKey(getWeekStart(dateKey)));
  const endDate = addDays(getWeekStart(dateKey), weekDays.length - 1);
  const end = formatShortDate(formatDateKey(endDate));
  return `${start}–${end}`;
}
