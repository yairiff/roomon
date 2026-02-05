import type { DayKey } from "../../types/schedule";

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
  reservationId?: string;
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
};

export type AdminDraft =
  | AdminChooseDraft
  | AdminLessonDraft
  | AdminReservationDraft
  | AdminSpecialDraft
  | AdminClosedDraft;

export type AdminDraftType = AdminDraft["type"];

