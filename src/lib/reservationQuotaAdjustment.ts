import { formatDateKey, getDayKeyFromDateKey, getWeekStart } from "./date";
import { getReservationUsageShareForEmail, normalizeEmailList } from "./quotaUsage";
import type { Reservation } from "../types/reservations";
import type { ReservationPolicy, ReservationScopedPolicy } from "../types/settings";

const STEP_MINUTES = 30;

const policyMatchesReservation = (
  policy: ReservationScopedPolicy,
  reservation: Pick<Reservation, "date" | "roomId" | "time">,
  includeRoomScope: boolean
) => {
  const scope = policy.scope;
  if (!includeRoomScope && scope.roomIds.length) return false;
  if (scope.roomIds.length && !scope.roomIds.includes(reservation.roomId)) return false;
  const dayKey = getDayKeyFromDateKey(reservation.date);
  if (scope.dayKeys.length && !scope.dayKeys.includes(dayKey)) return false;
  if (scope.dateStart && reservation.date < scope.dateStart) return false;
  if (scope.dateEnd && reservation.date > scope.dateEnd) return false;
  if (scope.startMinutes !== undefined && reservation.time < scope.startMinutes) return false;
  if (scope.endMinutes !== undefined && reservation.time >= scope.endMinutes) return false;
  return true;
};

const resolvePolicy = (
  reservation: Pick<Reservation, "date" | "roomId" | "time">,
  basePolicy: ReservationPolicy,
  scopedPolicies: ReservationScopedPolicy[],
  includeRoomScope: boolean
) => {
  let effective = { ...basePolicy };
  let firstMatch: ReservationScopedPolicy | null = null;
  for (const policy of scopedPolicies.filter((entry) => entry.enabled)) {
    if (policy.isDefault) {
      effective = { ...effective, ...policy.rules };
      continue;
    }
    if (!firstMatch && policyMatchesReservation(policy, reservation, includeRoomScope)) {
      firstMatch = policy;
    }
  }
  return firstMatch ? { ...effective, ...firstMatch.rules } : effective;
};

const toLimitMinutes = (hours: number) => {
  const numeric = Number(hours);
  if (!Number.isFinite(numeric) || numeric <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((numeric * 60) / STEP_MINUTES) * STEP_MINUTES);
};

export type ReservationQuotaAdjustment = {
  durationMinutes: number;
  participantEmails: string[];
  released: boolean;
  shortened: boolean;
};

export const calculateReservationQuotaAdjustment = ({
  reservation,
  participantEmails,
  reservations,
  basePolicy,
  scopedPolicies
}: {
  reservation: Reservation;
  participantEmails: string[];
  reservations: Reservation[];
  basePolicy: ReservationPolicy;
  scopedPolicies: ReservationScopedPolicy[];
}): ReservationQuotaAdjustment => {
  const ownerEmail = reservation.reservedEmail.trim().toLowerCase();
  const activeEmails = normalizeEmailList([ownerEmail, ...participantEmails]);
  const participantCount = Math.max(1, activeEmails.length);
  const targetWeek = formatDateKey(getWeekStart(reservation.date));
  const roomPolicy = resolvePolicy(reservation, basePolicy, scopedPolicies, true);
  const globalPolicy = resolvePolicy(reservation, basePolicy, scopedPolicies, false);
  const remainingShareMinutes = activeEmails.reduce((commonRemaining, email) => {
    let roomDayUsed = 0;
    let roomWeekUsed = 0;
    let dayUsed = 0;
    let weekUsed = 0;
    reservations.forEach((entry) => {
      if (entry.id === reservation.id || entry.kind) return;
      const share = getReservationUsageShareForEmail(entry, email);
      if (share <= 0) return;
      const sameDay = entry.date === reservation.date;
      const sameWeek = formatDateKey(getWeekStart(entry.date)) === targetWeek;
      if (sameDay) dayUsed += share;
      if (sameWeek) weekUsed += share;
      if (entry.roomId === reservation.roomId && sameDay) roomDayUsed += share;
      if (entry.roomId === reservation.roomId && sameWeek) roomWeekUsed += share;
    });
    const participantRemaining = Math.min(
      Math.max(0, toLimitMinutes(roomPolicy.maxHoursPerRoomPerDay) - roomDayUsed),
      Math.max(0, toLimitMinutes(roomPolicy.maxHoursPerRoomPerWeek) - roomWeekUsed),
      Math.max(0, toLimitMinutes(globalPolicy.maxHoursPerDayTotal) - dayUsed),
      Math.max(0, toLimitMinutes(globalPolicy.maxHoursPerWeekTotal) - weekUsed)
    );
    return Math.min(commonRemaining, participantRemaining);
  }, Number.POSITIVE_INFINITY);
  const quotaDuration = Number.isFinite(remainingShareMinutes)
    ? Math.floor((remainingShareMinutes * participantCount) / STEP_MINUTES) * STEP_MINUTES
    : reservation.durationMinutes;
  const durationMinutes = Math.min(reservation.durationMinutes, Math.max(0, quotaDuration));

  return {
    durationMinutes,
    participantEmails: activeEmails,
    released: durationMinutes < STEP_MINUTES,
    shortened: durationMinutes >= STEP_MINUTES && durationMinutes < reservation.durationMinutes
  };
};
