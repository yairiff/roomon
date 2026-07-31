import type { DayKey } from "./schedule";

export type ReservationParticipantStatus = "pending" | "approved" | "declined";

export type ReservationParticipant = {
  email: string;
  status: ReservationParticipantStatus;
  updatedAt: number;
};

export type Reservation = {
  id: string;
  date: string;
  time: number;
  durationMinutes: number;
  roomId: string;
  reservedBy: string;
  reservedEmail: string;
  reservedPhone?: string;
  reservedPicture?: string;
  privateDescription?: string;
  sharedDescription?: string;
  linkedGroupId?: string;
  linkedRehearsalId?: string;
  participants?: ReservationParticipant[];
  quotaParticipantEmails?: string[];
  pending?: boolean;
  kind?: "special" | "exam" | "closed";
};

export type ReservationMap = Record<string, Reservation[]>;

export type ReserveRequest = {
  date: string;
  day: DayKey;
  time: number;
  roomId: string;
  durationMinutes?: number;
  privateDescription?: string;
  sharedDescription?: string;
  participantEmails?: string[];
};
