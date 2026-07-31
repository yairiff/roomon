import type { RehearsalParticipant } from "../types/collaboration";
import type { Reservation } from "../types/reservations";

const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const normalizeEmailList = (values: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const normalized = normalizeEmail(value || "");
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
};

export const buildApprovedQuotaParticipantEmails = (
  participants: RehearsalParticipant[],
  fallbackEmail?: string
) => {
  const approved = normalizeEmailList(
    (participants || [])
      .filter((participant) => participant.status !== "declined")
      .map((participant) => participant.email || "")
  );
  if (approved.length) return approved;
  const fallback = normalizeEmail(fallbackEmail || "");
  return fallback ? [fallback] : [];
};

export const resolveQuotaParticipantEmails = (
  reservation: Pick<Reservation, "reservedEmail" | "linkedGroupId" | "participants" | "quotaParticipantEmails">
) => {
  const explicit = Array.isArray(reservation.quotaParticipantEmails)
    ? normalizeEmailList(reservation.quotaParticipantEmails)
    : [];
  if (reservation.linkedGroupId && explicit.length) return explicit;
  const activeParticipants = Array.isArray(reservation.participants)
    ? normalizeEmailList(
        reservation.participants
          .filter((participant) => participant.status !== "declined")
          .map((participant) => participant.email)
      )
    : [];
  if (activeParticipants.length) {
    const owner = normalizeEmail(reservation.reservedEmail || "");
    return normalizeEmailList([owner, ...activeParticipants]);
  }
  if (explicit.length) return explicit;
  const fallback = normalizeEmail(reservation.reservedEmail || "");
  return fallback ? [fallback] : [];
};

export const getReservationUsageShareForEmail = (
  reservation: Pick<Reservation, "reservedEmail" | "durationMinutes" | "linkedGroupId" | "participants" | "quotaParticipantEmails">,
  email: string
) => {
  const normalizedEmail = normalizeEmail(email || "");
  if (!normalizedEmail) return 0;
  const durationMinutes = Number(reservation.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return 0;
  const participantEmails = resolveQuotaParticipantEmails(reservation);
  if (!participantEmails.length || !participantEmails.includes(normalizedEmail)) return 0;
  return durationMinutes / participantEmails.length;
};
