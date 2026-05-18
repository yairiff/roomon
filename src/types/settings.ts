import type { DayKey } from "./schedule";

export type SemesterHoliday = {
  date: string;
  name: string;
  displayName?: string;
  sortOrder?: number;
  syncSource?: "manual" | "api";
};

export type SemesterEntity = {
  id: string;
  studyYear: number;
  letter: string;
  displayName?: string;
  sortOrder?: number;
  syncSource?: "manual" | "api";
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
  blockReservations: boolean;
  maxHoursPerRoomPerDay: number;
  maxHoursPerRoomPerWeek: number;
  maxHoursPerDayTotal: number;
  maxHoursPerWeekTotal: number;
  maxDaysForward: number;
  maxConcurrentReservations: number;
  minLeadMode: ReservationCutoffMode; // legacy
  minLeadHours: number;
  minLeadDayBeforeEnabled: boolean;
  minLeadDayBeforeMinutes: number;
};

export type ReservationPolicyScope = {
  roomIds: string[];
  dayKeys: DayKey[];
  semesterIds?: string[];
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

export type ApiSyncEntityKey = "rooms" | "lessons" | "semesters" | "holidays";

export type ApiSyncEntityConfig = {
  enabled: boolean;
  lastSuccessAt?: number;
  lastAttemptAt?: number;
  lastError?: string;
};

export type ApiSyncSettings = {
  primaryEndpoint: string;
  intervalMinutes: number;
  entities: Record<ApiSyncEntityKey, ApiSyncEntityConfig>;
  roomIdMap: Record<string, string>;
};

export const DEFAULT_RESERVATION_POLICY: ReservationPolicy = {
  blockReservations: false,
  maxHoursPerRoomPerDay: 3,
  maxHoursPerRoomPerWeek: 0,
  maxHoursPerDayTotal: 6,
  maxHoursPerWeekTotal: 12,
  maxDaysForward: 30,
  maxConcurrentReservations: 1,
  minLeadMode: "hours_before",
  minLeadHours: 0,
  minLeadDayBeforeEnabled: false,
  minLeadDayBeforeMinutes: 18 * 60
};

export const DEFAULT_API_SYNC_SETTINGS: ApiSyncSettings = {
  primaryEndpoint: "https://rimon-school-plan.base44.app/functions/scheduleApi",
  intervalMinutes: 60,
  entities: {
    rooms: { enabled: false },
    lessons: { enabled: false },
    semesters: { enabled: false },
    holidays: { enabled: false }
  },
  roomIdMap: {}
};
