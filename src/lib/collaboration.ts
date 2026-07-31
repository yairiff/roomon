import type { DayKey } from "../types/schedule";
import {
  collaborationWeekdays,
  type DayAvailability,
  type GroupInvite,
  type GroupRehearsal,
  type CollaborationGroup,
  type UserAvailability,
  type AvailabilityDateOffs
} from "../types/collaboration";

const ALL_DAY_KEYS: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const clampMinutes = (value: number) => Math.max(0, Math.min(24 * 60, Math.round(value)));

const normalizeDayAvailability = (raw: unknown, fallbackEnabled: boolean): DayAvailability => {
  const input = raw && typeof raw === "object" ? (raw as Partial<DayAvailability>) : {};
  const startMinutes = clampMinutes(Number(input.startMinutes ?? 9 * 60));
  const endMinutesRaw = clampMinutes(Number(input.endMinutes ?? 22 * 60));
  const endMinutes = Math.max(startMinutes + 30, endMinutesRaw);
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : fallbackEnabled,
    startMinutes,
    endMinutes
  };
};

export function defaultUserAvailability(): UserAvailability {
  return {
    sun: { enabled: true, startMinutes: 9 * 60, endMinutes: 22 * 60 },
    mon: { enabled: true, startMinutes: 9 * 60, endMinutes: 22 * 60 },
    tue: { enabled: true, startMinutes: 9 * 60, endMinutes: 22 * 60 },
    wed: { enabled: true, startMinutes: 9 * 60, endMinutes: 22 * 60 },
    thu: { enabled: true, startMinutes: 9 * 60, endMinutes: 22 * 60 },
    fri: { enabled: false, startMinutes: 9 * 60, endMinutes: 22 * 60 },
    sat: { enabled: false, startMinutes: 9 * 60, endMinutes: 22 * 60 }
  };
}

export function normalizeUserAvailability(raw: unknown): UserAvailability {
  const fallback = defaultUserAvailability();
  const input = raw && typeof raw === "object" ? (raw as Partial<Record<DayKey, DayAvailability>>) : {};
  const out = { ...fallback };
  ALL_DAY_KEYS.forEach((dayKey) => {
    const defaultEnabled = collaborationWeekdays.includes(dayKey);
    out[dayKey] = normalizeDayAvailability(input[dayKey], defaultEnabled);
  });
  return out;
}

const normalizeInvite = (raw: unknown): GroupInvite | null => {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Partial<GroupInvite>;
  const email = String(input.email || "").trim().toLowerCase();
  if (!email) return null;
  const invitedBy = String(input.invitedBy || "").trim().toLowerCase();
  const status = input.status === "accepted" || input.status === "declined" ? input.status : "pending";
  return {
    email,
    invitedBy,
    status,
    invitedAt: Number(input.invitedAt || 0) || 0,
    ...(Number(input.respondedAt || 0) ? { respondedAt: Number(input.respondedAt || 0) } : {})
  };
};

const normalizeRehearsal = (raw: unknown): GroupRehearsal | null => {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Partial<GroupRehearsal>;
  const id = String(input.id || "").trim();
  const title = String(input.title || "").trim() || "חזרה";
  const dateKey = String(input.dateKey || "").trim();
  const dayKey = input.dayKey;
  const startMinutes = Math.round(Number(input.startMinutes || 0));
  const durationMinutes = Math.max(30, Math.round(Number(input.durationMinutes || 60)));
  const createdBy = String(input.createdBy || "").trim().toLowerCase();
  if (!id || !dateKey || !dayKey || !createdBy) return null;
  if (!Number.isFinite(startMinutes)) return null;
  const roomId = typeof input.roomId === "string" ? input.roomId.trim() : "";
  const reservationId = typeof input.reservationId === "string" ? input.reservationId.trim() : "";
  const participants = Array.isArray(input.participants)
    ? input.participants
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const participant = entry as Partial<GroupRehearsal["participants"][number]>;
          const email = String(participant.email || "").trim().toLowerCase();
          if (!email) return null;
          const status = participant.status === "declined" ? "declined" : "approved";
          return {
            email,
            status,
            updatedAt: Number(participant.updatedAt || 0) || 0
          };
        })
        .filter((entry): entry is GroupRehearsal["participants"][number] => Boolean(entry))
    : [];
  const modeRaw = input.mode && typeof input.mode === "object" ? input.mode : {};
  const mode = {
    findCommonTime: (modeRaw as { findCommonTime?: boolean }).findCommonTime !== false,
    findRoom: Boolean((modeRaw as { findRoom?: boolean }).findRoom)
  };
  return {
    id,
    title,
    dateKey,
    dayKey,
    startMinutes,
    durationMinutes,
    ...(roomId ? { roomId } : {}),
    ...(reservationId ? { reservationId } : {}),
    mode,
    participants,
    createdBy,
    createdAt: Number(input.createdAt || 0) || 0
  };
};

export function normalizeCollaborationGroup(raw: unknown, fallbackId: string): CollaborationGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Partial<CollaborationGroup>;
  const id = String(input.id || fallbackId || "").trim();
  const ownerEmail = String(input.ownerEmail || "").trim().toLowerCase();
  const name = String(input.name || "").trim();
  if (!id || !ownerEmail || !name) return null;
  const invites = Array.isArray(input.invites)
    ? input.invites.map((invite) => normalizeInvite(invite)).filter((invite): invite is GroupInvite => Boolean(invite))
    : [];
  const rehearsals = Array.isArray(input.rehearsals)
    ? input.rehearsals.map((rehearsal) => normalizeRehearsal(rehearsal)).filter((entry): entry is GroupRehearsal => Boolean(entry))
    : [];
  const acceptedInviteEmails = invites.filter((invite) => invite.status === "accepted").map((invite) => invite.email);
  const memberEmailsRaw = Array.isArray(input.memberEmails) ? input.memberEmails : [];
  const participantEmailsRaw = Array.isArray(input.participantEmails) ? input.participantEmails : [];
  const memberSet = new Set<string>([ownerEmail]);
  memberEmailsRaw.forEach((email) => {
    const normalized = String(email || "").trim().toLowerCase();
    if (normalized) memberSet.add(normalized);
  });
  acceptedInviteEmails.forEach((email) => memberSet.add(email));
  const participantSet = new Set<string>(memberSet);
  participantEmailsRaw.forEach((email) => {
    const normalized = String(email || "").trim().toLowerCase();
    if (normalized) participantSet.add(normalized);
  });
  invites.forEach((invite) => participantSet.add(invite.email));
  return {
    id,
    ownerEmail,
    name,
    invites: invites.sort((a, b) => {
      if (a.status !== b.status) return a.status.localeCompare(b.status);
      return a.email.localeCompare(b.email);
    }),
    memberEmails: Array.from(memberSet).sort((a, b) => a.localeCompare(b)),
    participantEmails: Array.from(participantSet).sort((a, b) => a.localeCompare(b)),
    rehearsals: rehearsals.sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
      if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
      return a.id.localeCompare(b.id);
    }),
    createdAt: Number(input.createdAt || 0) || 0,
    updatedAt: Number(input.updatedAt || 0) || 0
  };
}

export const getAvailabilityWindow = (availability: UserAvailability, dayKey: DayKey) => {
  const day = availability[dayKey];
  if (!day || !day.enabled) return null;
  const start = clampMinutes(day.startMinutes);
  const end = clampMinutes(day.endMinutes);
  if (end <= start) return null;
  return { startMinutes: start, endMinutes: end };
};

export const isDayAvailableOnDate = (
  availability: UserAvailability,
  dayKey: DayKey,
  dateKey: string,
  dateOffs: AvailabilityDateOffs = {}
) => {
  const day = availability[dayKey];
  if (!day) return false;
  const hasDateException = Boolean(dateOffs[dateKey]);
  // Date-level exception flips the weekday default:
  // weekday on + exception => off, weekday off + exception => on.
  return day.enabled ? !hasDateException : hasDateException;
};

export const getAvailabilityWindowForDate = (
  availability: UserAvailability,
  dayKey: DayKey,
  dateKey: string,
  dateOffs: AvailabilityDateOffs = {}
) => {
  if (!isDayAvailableOnDate(availability, dayKey, dateKey, dateOffs)) return null;
  const day = availability[dayKey];
  if (!day) return null;
  const start = clampMinutes(day.startMinutes);
  const end = clampMinutes(day.endMinutes);
  if (end <= start) return null;
  return { startMinutes: start, endMinutes: end };
};

export const overlaps = (
  first: { startMinutes: number; endMinutes: number },
  second: { startMinutes: number; endMinutes: number }
) => first.startMinutes < second.endMinutes && second.startMinutes < first.endMinutes;
