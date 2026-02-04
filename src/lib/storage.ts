import type { Reservation, ReservationMap } from "../types/reservations";
import type { User } from "../types/auth";
import type { MySchedulePin } from "../types/mySchedule";

const RESERVATION_KEY = "rimon_reservations_by_date_v1";
const USER_KEY = "rimon_user_v1";
const MY_SCHEDULE_PINS_KEY = "rimon_my_schedule_pins_v1";

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
