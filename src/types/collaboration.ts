import type { DayKey } from "./schedule";

export const collaborationWeekdays: DayKey[] = ["sun", "mon", "tue", "wed", "thu"];

export type DayAvailability = {
  enabled: boolean;
  startMinutes: number;
  endMinutes: number;
};

export type UserAvailability = Record<DayKey, DayAvailability>;
export type AvailabilityDateOffs = Record<string, true>;

export type GroupInviteStatus = "pending" | "accepted" | "declined";

export type GroupInvite = {
  email: string;
  invitedBy: string;
  invitedAt: number;
  status: GroupInviteStatus;
  respondedAt?: number;
};

export type CollaborationGroup = {
  id: string;
  name: string;
  ownerEmail: string;
  memberEmails: string[];
  invites: GroupInvite[];
  participantEmails: string[];
  rehearsals: GroupRehearsal[];
  createdAt: number;
  updatedAt: number;
};

export type CollaboratorEvent = {
  id: string;
  dateKey: string;
  startMinutes: number;
  endMinutes: number;
  title: string;
};

export type RehearsalMode = {
  findCommonTime: boolean;
  findRoom: boolean;
};

export type RehearsalParticipant = {
  email: string;
  status: "pending" | "approved" | "declined";
  updatedAt: number;
};

export type GroupRehearsal = {
  id: string;
  title: string;
  dateKey: string;
  dayKey: DayKey;
  startMinutes: number;
  durationMinutes: number;
  roomId?: string;
  reservationId?: string;
  mode: RehearsalMode;
  participants: RehearsalParticipant[];
  createdBy: string;
  createdAt: number;
};
