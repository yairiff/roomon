import type {
  Reservation,
  ReservationParticipant,
  ReservationParticipantStatus
} from "../types/reservations";
import type { RehearsalParticipant } from "../types/collaboration";

export const normalizeParticipantEmail = (value: string) => value.trim().toLowerCase();

export const normalizeReservationParticipantList = (
  values: Array<Partial<ReservationParticipant>>,
  ownerEmail?: string
) => {
  const owner = normalizeParticipantEmail(ownerEmail || "");
  const byEmail = new Map<string, ReservationParticipant>();
  values.forEach((value) => {
    const email = normalizeParticipantEmail(value.email || "");
    if (!email) return;
    const status: ReservationParticipantStatus =
      email === owner || value.status !== "declined" ? "approved" : "declined";
    const updatedAt = Number(value.updatedAt);
    byEmail.set(email, {
      email,
      status,
      updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0
    });
  });
  if (owner) {
    const current = byEmail.get(owner);
    byEmail.set(owner, { email: owner, status: "approved", updatedAt: current?.updatedAt || 0 });
  }
  return Array.from(byEmail.values());
};

export const resolveReservationParticipantStates = (
  reservation: Pick<Reservation, "reservedEmail" | "participants" | "quotaParticipantEmails">,
  linkedParticipants?: RehearsalParticipant[] | null
) => {
  const owner = normalizeParticipantEmail(reservation.reservedEmail || "");
  if (linkedParticipants) {
    return normalizeReservationParticipantList(linkedParticipants, owner);
  }
  if (Array.isArray(reservation.participants) && reservation.participants.length) {
    return normalizeReservationParticipantList(reservation.participants, owner);
  }
  const legacy = (reservation.quotaParticipantEmails || []).map((email) => ({
    email,
    status: "approved" as const,
    updatedAt: 0
  }));
  return normalizeReservationParticipantList(legacy, owner);
};

export const getApprovedParticipantEmails = (participants: ReservationParticipant[], ownerEmail?: string) => {
  const owner = normalizeParticipantEmail(ownerEmail || "");
  const approved = participants
    .filter((participant) => participant.status !== "declined")
    .map((participant) => normalizeParticipantEmail(participant.email))
    .filter(Boolean);
  if (owner && !approved.includes(owner)) approved.unshift(owner);
  return Array.from(new Set(approved));
};

export const buildActiveReservationParticipants = (ownerEmail: string, selectedEmails: string[], now = Date.now()) => {
  const owner = normalizeParticipantEmail(ownerEmail);
  return normalizeReservationParticipantList(
    [
      ...(owner ? [{ email: owner, status: "approved" as const, updatedAt: now }] : []),
      ...selectedEmails.map((email) => ({ email, status: "approved" as const, updatedAt: now }))
    ],
    owner
  );
};

export const updateReservationParticipantSelection = (
  reservation: Pick<Reservation, "reservedEmail" | "participants" | "quotaParticipantEmails">,
  selectedEmails: string[],
  now = Date.now()
) => {
  const owner = normalizeParticipantEmail(reservation.reservedEmail || "");
  const selected = new Set(
    selectedEmails.map(normalizeParticipantEmail).filter((email) => Boolean(email) && email !== owner)
  );
  const existing = resolveReservationParticipantStates(reservation);
  const existingByEmail = new Map(existing.map((participant) => [participant.email, participant]));
  const next: ReservationParticipant[] = owner
    ? [{ email: owner, status: "approved", updatedAt: existingByEmail.get(owner)?.updatedAt || now }]
    : [];

  selected.forEach((email) => {
    const previous = existingByEmail.get(email);
    next.push({
      email,
      status: "approved",
      updatedAt: previous && previous.status !== "declined" ? previous.updatedAt : now
    });
  });
  existing.forEach((participant) => {
    if (participant.email === owner || selected.has(participant.email)) return;
    next.push({ ...participant, status: "declined", updatedAt: now });
  });
  return normalizeReservationParticipantList(next, owner);
};

export const visibleReservationParticipants = (participants: ReservationParticipant[]) =>
  participants.filter((participant) => participant.status !== "declined");
