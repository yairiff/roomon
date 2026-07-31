import type { DayKey } from "../../types/schedule";

export type AdminDraftSource =
  | { kind: "lesson"; lessonId: string }
  | { kind: "reservation"; reservationId: string };

export type AdminLessonDraft = {
  type: "lesson";
  mode: "create" | "edit";
  dateKey: string;
  dayKey: DayKey;
  roomId: string;
  startMinutes: number;
  durationMinutes: number;
  title: string;
  teacher: string;
  targetLessonId?: string;
  source?: AdminDraftSource;
};

export type AdminReservationDraft = {
  type: "reservation";
  mode: "create" | "edit";
  dateKey: string;
  dayKey: DayKey;
  roomId: string;
  startMinutes: number;
  durationMinutes: number;
  reservedBy: string;
  reservedEmail: string;
  participantEmails: string[];
  reservationId?: string;
  source?: AdminDraftSource;
};

export type AdminChooseDraft = {
  type: "choose";
  mode: "create";
  dateKey: string;
  dayKey: DayKey;
  roomId: string;
  startMinutes: number;
  durationMinutes: number;
  reservedBy: string;
  reservedEmail: string;
  source?: AdminDraftSource;
};

export type AdminSpecialDraft = {
  type: "special";
  mode: "create" | "edit";
  dateKey: string;
  dayKey: DayKey;
  roomId: string;
  startMinutes: number;
  durationMinutes: number;
  label: string;
  reservationId?: string;
  source?: AdminDraftSource;
};

export type AdminExamDraft = {
  type: "exam";
  mode: "create" | "edit";
  dateKey: string;
  dayKey: DayKey;
  roomId: string;
  startMinutes: number;
  durationMinutes: number;
  label: string;
  reservationId?: string;
  source?: AdminDraftSource;
};

export type AdminClosedDraft = {
  type: "closed";
  mode: "create" | "edit";
  dateKey: string;
  dayKey: DayKey;
  roomId: string;
  startMinutes: number;
  durationMinutes: number;
  label: string;
  reservationId?: string;
  source?: AdminDraftSource;
};

export type AdminDraft =
  | AdminChooseDraft
  | AdminLessonDraft
  | AdminReservationDraft
  | AdminSpecialDraft
  | AdminExamDraft
  | AdminClosedDraft;

export type AdminDraftType = AdminDraft["type"];
