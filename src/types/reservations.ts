import type { DayKey } from "./schedule";

export type Reservation = {
  id: string;
  date: string;
  time: number;
  durationMinutes: number;
  roomId: string;
  reservedBy: string;
  reservedEmail: string;
  kind?: "special" | "closed";
};

export type ReservationMap = Record<string, Reservation[]>;

export type ReserveRequest = {
  date: string;
  day: DayKey;
  time: number;
  roomId: string;
  durationMinutes?: number;
};
