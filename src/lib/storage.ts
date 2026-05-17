import type { Reservation, ReservationMap } from "../types/reservations";
import type { User } from "../types/auth";
import type { MySchedulePin } from "../types/mySchedule";
import { defaultUserAvailability } from "./collaboration";
import type { AvailabilityDateOffs, UserAvailability } from "../types/collaboration";

const RESERVATION_KEY = "rimon_reservations_by_date_v1";
const USER_KEY = "rimon_user_v1";
const MY_SCHEDULE_PINS_KEY = "rimon_my_schedule_pins_v1";
const AVAILABILITY_KEY = "rimon_availability_v1";
const AVAILABILITY_DATE_OFFS_KEY = "rimon_availability_date_offs_v1";
const ACTIVE_GROUP_KEY = "rimon_active_group_v1";

export function loadReservationMap(): ReservationMap {
  try {
    const raw = localStorage.getItem(RESERVATION_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const normalized: ReservationMap = {};
    Object.entries(parsed as ReservationMap).forEach(([dateKey, entries]) => {
      if (!Array.isArray(entries)) return;
      normalized[dateKey] = entries.map((entry) => ({
        ...entry,
        durationMinutes: entry.durationMinutes ?? 60
      }));
    });
    return normalized;
  } catch {
    return {};
  }
}

export function saveReservationMap(map: ReservationMap) {
  localStorage.setItem(RESERVATION_KEY, JSON.stringify(map));
}

export function loadUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as User;
  } catch {
    return null;
  }
}

export function saveUser(user: User) {
  if (!user) return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearUser() {
  localStorage.removeItem(USER_KEY);
}

export function loadMySchedulePins(email: string): MySchedulePin[] {
  try {
    const key = `${MY_SCHEDULE_PINS_KEY}:${email.toLowerCase()}`;
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed as MySchedulePin[];
  } catch {
    return [];
  }
}

export function saveMySchedulePins(email: string, pins: MySchedulePin[]) {
  const key = `${MY_SCHEDULE_PINS_KEY}:${email.toLowerCase()}`;
  localStorage.setItem(key, JSON.stringify(pins));
}

export function loadUserAvailability(email: string): UserAvailability {
  try {
    const key = `${AVAILABILITY_KEY}:${email.toLowerCase()}`;
    const raw = localStorage.getItem(key);
    if (!raw) return defaultUserAvailability();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultUserAvailability();
    return parsed as UserAvailability;
  } catch {
    return defaultUserAvailability();
  }
}

export function saveUserAvailability(email: string, availability: UserAvailability) {
  const key = `${AVAILABILITY_KEY}:${email.toLowerCase()}`;
  localStorage.setItem(key, JSON.stringify(availability));
}

export function loadUserAvailabilityDateOffs(email: string): AvailabilityDateOffs {
  try {
    const key = `${AVAILABILITY_DATE_OFFS_KEY}:${email.toLowerCase()}`;
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    const out: AvailabilityDateOffs = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([dateKey, value]) => {
      if (!dateKey) return;
      if (value) out[dateKey] = true;
    });
    return out;
  } catch {
    return {};
  }
}

export function saveUserAvailabilityDateOffs(email: string, dateOffs: AvailabilityDateOffs) {
  const key = `${AVAILABILITY_DATE_OFFS_KEY}:${email.toLowerCase()}`;
  localStorage.setItem(key, JSON.stringify(dateOffs));
}

export function loadActiveGroupId(email: string): string {
  try {
    const key = `${ACTIVE_GROUP_KEY}:${email.toLowerCase()}`;
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export function saveActiveGroupId(email: string, groupId: string) {
  const key = `${ACTIVE_GROUP_KEY}:${email.toLowerCase()}`;
  localStorage.setItem(key, groupId || "");
}
