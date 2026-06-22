import { allDayKeys, defaultWeekDayKeys } from "../config";
import type { DayKey } from "../types/schedule";
import type { ReservationScopedPolicy } from "../types/settings";

export type ReservationPolicyWindow = {
  dayKey: DayKey;
  startMinutes: number;
  endMinutes: number;
  roomIds?: string[];
  dateStart?: string;
  dateEnd?: string;
};

type SlotLookup = {
  dateKey?: string;
  dayKey: DayKey;
  roomId?: string;
  startMinutes: number;
  endMinutes?: number;
};

type DayWindowOptions = {
  roomId?: string;
  includeRoomScoped?: boolean;
};

type ActiveHours = {
  startMinutes: number;
  endMinutes: number;
  startHour: number;
  endHour: number;
};

const dayOrder = new Map<DayKey, number>(allDayKeys.map((dayKey, index) => [dayKey, index]));
const dayKeySet = new Set<DayKey>(allDayKeys);

const isDayKey = (value: unknown): value is DayKey =>
  typeof value === "string" && dayKeySet.has(value as DayKey);

const normalizeDayKeys = (dayKeys: DayKey[] | undefined) =>
  Array.from(new Set((dayKeys || []).filter(isDayKey))).sort(
    (left, right) => (dayOrder.get(left) ?? 0) - (dayOrder.get(right) ?? 0)
  );

const normalizeRoomIds = (roomIds: string[] | undefined) =>
  Array.from(new Set((roomIds || []).map((roomId) => roomId.trim()).filter(Boolean))).sort();

const safeFallbackRange = (fallbackStartMinutes: number, fallbackEndMinutes: number) => {
  const start = Math.max(0, Math.min(24 * 60 - 30, Math.floor(fallbackStartMinutes)));
  const end = Math.max(start + 30, Math.min(24 * 60, Math.ceil(fallbackEndMinutes)));
  return { start, end };
};

const normalizeRange = (startMinutes: number, endMinutes: number) => {
  const start = Math.max(0, Math.min(24 * 60, Math.floor(startMinutes)));
  const end = Math.max(0, Math.min(24 * 60, Math.ceil(endMinutes)));
  if (end <= start) return null;
  return { start, end };
};

const scopeKey = (window: ReservationPolicyWindow) =>
  [
    window.dayKey,
    (window.roomIds || []).join(","),
    window.dateStart || "",
    window.dateEnd || ""
  ].join("|");

const sortWindows = (windows: ReservationPolicyWindow[]) =>
  [...windows].sort((left, right) => {
    const dayDiff = (dayOrder.get(left.dayKey) ?? 0) - (dayOrder.get(right.dayKey) ?? 0);
    if (dayDiff) return dayDiff;
    if (left.startMinutes !== right.startMinutes) return left.startMinutes - right.startMinutes;
    if (left.endMinutes !== right.endMinutes) return left.endMinutes - right.endMinutes;
    return scopeKey(left).localeCompare(scopeKey(right));
  });

const mergeWindows = (windows: ReservationPolicyWindow[]) => {
  const sorted = sortWindows(windows);
  const merged: ReservationPolicyWindow[] = [];

  sorted.forEach((window) => {
    const last = merged[merged.length - 1];
    if (last && scopeKey(last) === scopeKey(window) && window.startMinutes <= last.endMinutes) {
      last.endMinutes = Math.max(last.endMinutes, window.endMinutes);
      return;
    }
    merged.push({ ...window, roomIds: window.roomIds ? [...window.roomIds] : undefined });
  });

  return merged;
};

const subtractRecurringBlock = (
  windows: ReservationPolicyWindow[],
  dayKey: DayKey,
  blockStart: number,
  blockEnd: number
) =>
  windows.flatMap((window) => {
    if (window.dayKey !== dayKey) return [window];
    if (blockEnd <= window.startMinutes || blockStart >= window.endMinutes) return [window];
    const next: ReservationPolicyWindow[] = [];
    if (blockStart > window.startMinutes) {
      next.push({ ...window, endMinutes: Math.min(blockStart, window.endMinutes) });
    }
    if (blockEnd < window.endMinutes) {
      next.push({ ...window, startMinutes: Math.max(blockEnd, window.startMinutes) });
    }
    return next;
  });

export const buildReservationPolicyWindowsForDays = (
  dayKeys: DayKey[],
  startMinutes: number,
  endMinutes: number
): ReservationPolicyWindow[] => {
  const range = normalizeRange(startMinutes, endMinutes);
  if (!range) return [];
  return normalizeDayKeys(dayKeys).map((dayKey) => ({
    dayKey,
    startMinutes: range.start,
    endMinutes: range.end
  }));
};

export const buildReservationPolicyWindows = (
  reservationPolicies: ReservationScopedPolicy[],
  fallbackStartMinutes: number,
  fallbackEndMinutes: number
): ReservationPolicyWindow[] => {
  const fallback = safeFallbackRange(fallbackStartMinutes, fallbackEndMinutes);
  const defaultPolicy = reservationPolicies.find((policy) => policy.enabled && policy.isDefault);
  const defaultDays = normalizeDayKeys(defaultPolicy?.scope.dayKeys);
  const defaultStart =
    typeof defaultPolicy?.scope.startMinutes === "number" ? defaultPolicy.scope.startMinutes : fallback.start;
  const defaultEnd =
    typeof defaultPolicy?.scope.endMinutes === "number" ? defaultPolicy.scope.endMinutes : fallback.end;
  const defaultRange = normalizeRange(defaultStart, defaultEnd) || fallback;

  let windows =
    defaultPolicy?.rules.blockReservations === true
      ? []
      : buildReservationPolicyWindowsForDays(
          defaultDays.length ? defaultDays : defaultWeekDayKeys,
          defaultRange.start,
          defaultRange.end
        );

  const recurringBlocks: Array<{ dayKeys: DayKey[]; startMinutes: number; endMinutes: number }> = [];

  reservationPolicies.forEach((policy) => {
    if (!policy.enabled || policy.isDefault) return;
    const policyDays = normalizeDayKeys(policy.scope.dayKeys);
    if (!policyDays.length) return;

    const scopedStart = typeof policy.scope.startMinutes === "number" ? policy.scope.startMinutes : defaultRange.start;
    const scopedEnd = typeof policy.scope.endMinutes === "number" ? policy.scope.endMinutes : defaultRange.end;
    const range = normalizeRange(scopedStart, scopedEnd);
    if (!range) return;

    if (policy.rules.blockReservations === true) {
      const isGlobalRecurringBlock =
        !policy.scope.roomIds.length && !policy.scope.dateStart && !policy.scope.dateEnd;
      if (!isGlobalRecurringBlock) return;
      recurringBlocks.push({ dayKeys: policyDays, startMinutes: range.start, endMinutes: range.end });
      return;
    }

    const roomIds = normalizeRoomIds(policy.scope.roomIds);
    policyDays.forEach((dayKey) => {
      windows.push({
        dayKey,
        startMinutes: range.start,
        endMinutes: range.end,
        ...(roomIds.length ? { roomIds } : {}),
        ...(policy.scope.dateStart ? { dateStart: policy.scope.dateStart } : {}),
        ...(policy.scope.dateEnd ? { dateEnd: policy.scope.dateEnd } : {})
      });
    });
  });

  recurringBlocks.forEach((block) => {
    block.dayKeys.forEach((dayKey) => {
      windows = subtractRecurringBlock(windows, dayKey, block.startMinutes, block.endMinutes);
    });
  });

  return mergeWindows(windows);
};

export const getReservationPolicyDayKeys = (windows: ReservationPolicyWindow[]) =>
  normalizeDayKeys(windows.map((window) => window.dayKey));

const matchesDate = (window: ReservationPolicyWindow, dateKey?: string) => {
  if (!dateKey) return true;
  if (window.dateStart && dateKey < window.dateStart) return false;
  if (window.dateEnd && dateKey > window.dateEnd) return false;
  return true;
};

const matchesRoom = (window: ReservationPolicyWindow, roomId?: string, includeRoomScoped = false) => {
  const roomIds = window.roomIds || [];
  if (!roomIds.length) return true;
  if (roomId) return roomIds.includes(roomId);
  return includeRoomScoped;
};

export const getReservationPolicyWindowsForDay = (
  windows: ReservationPolicyWindow[],
  dayKey: DayKey,
  dateKey?: string,
  options: DayWindowOptions = {}
) =>
  mergeWindows(
    windows.filter(
      (window) =>
        window.dayKey === dayKey &&
        matchesDate(window, dateKey) &&
        matchesRoom(window, options.roomId, options.includeRoomScoped)
    )
  );

export const getReservationPolicyWindowForSlot = (
  windows: ReservationPolicyWindow[],
  lookup: SlotLookup
): ReservationPolicyWindow | null => {
  const endMinutes = lookup.endMinutes ?? lookup.startMinutes + 1;
  const matches = windows.filter(
    (window) =>
      window.dayKey === lookup.dayKey &&
      matchesDate(window, lookup.dateKey) &&
      matchesRoom(window, lookup.roomId) &&
      window.startMinutes <= lookup.startMinutes &&
      window.endMinutes >= endMinutes
  );
  if (!matches.length) return null;
  return matches.sort((left, right) => right.endMinutes - left.endMinutes)[0];
};

export const isReservationPolicySlotAllowed = (
  windows: ReservationPolicyWindow[],
  lookup: SlotLookup
) => Boolean(getReservationPolicyWindowForSlot(windows, lookup));

export const deriveActiveHoursFromReservationPolicyWindows = (
  windows: ReservationPolicyWindow[],
  fallbackStartHour: number,
  fallbackEndHour: number
): ActiveHours => {
  const fallbackStart = Math.max(0, fallbackStartHour * 60);
  const fallbackEnd = Math.min(24 * 60, Math.max(fallbackStart + 60, fallbackEndHour * 60));
  if (!windows.length) {
    return {
      startMinutes: fallbackStart,
      endMinutes: fallbackEnd,
      startHour: Math.floor(fallbackStart / 60),
      endHour: Math.ceil(fallbackEnd / 60)
    };
  }

  const startMinutes = Math.max(0, Math.min(...windows.map((window) => window.startMinutes)));
  const endMinutes = Math.min(24 * 60, Math.max(...windows.map((window) => window.endMinutes)));
  return {
    startMinutes,
    endMinutes: Math.max(startMinutes + 60, endMinutes),
    startHour: Math.floor(startMinutes / 60),
    endHour: Math.max(Math.floor(startMinutes / 60) + 1, Math.ceil(endMinutes / 60))
  };
};
