import type { DayKey } from "./schedule";

export type SemesterHoliday = {
  date: string;
  name: string;
};

export type SemesterEntity = {
  id: string;
  studyYear: number;
  letter: string;
  startDate: string;
  endDate: string;
  studyDayKeys: DayKey[];
  holidays: SemesterHoliday[];
};

export type SemesterRange = {
  key: string;
  start: string;
  end: string;
};

export type ReservationCutoffMode = "hours_before" | "day_before_time";

export type ReservationPolicy = {
  maxHoursPerRoomPerDay: number;
  maxHoursPerRoomPerWeek: number;
  maxHoursPerDayTotal: number;
  maxHoursPerWeekTotal: number;
  maxDaysForward: number;
  minLeadMode: ReservationCutoffMode;
  minLeadHours: number;
  minLeadDayBeforeMinutes: number;
};

export type ReservationPolicyScope = {
  roomIds: string[];
  dayKeys: DayKey[];
  dateStart?: string;
  dateEnd?: string;
  startMinutes?: number;
  endMinutes?: number;
};

export type ReservationPolicyRules = Partial<ReservationPolicy>;

export type ReservationScopedPolicy = {
  id: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  scope: ReservationPolicyScope;
  rules: ReservationPolicyRules;
};

export const DEFAULT_RESERVATION_POLICY: ReservationPolicy = {
  maxHoursPerRoomPerDay: 3,
  maxHoursPerRoomPerWeek: 0,
  maxHoursPerDayTotal: 6,
  maxHoursPerWeekTotal: 12,
  maxDaysForward: 30,
  minLeadMode: "hours_before",
  minLeadHours: 0,
  minLeadDayBeforeMinutes: 18 * 60
};
