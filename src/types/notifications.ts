import type { ReservationParticipantStatus } from "./reservations";

export type AppNotificationType =
  | "group_invite"
  | "group_updated"
  | "group_removed"
  | "rehearsal_invite"
  | "rehearsal_updated"
  | "rehearsal_cancelled"
  | "shared_reservation_invite"
  | "reservation_updated"
  | "reservation_cancelled"
  | "participant_response";

export type AppNotificationAction = "shared_reservation" | "rehearsal" | "group_invite";

export type AppNotification = {
  id: string;
  type: AppNotificationType;
  recipientEmail: string;
  actorEmail: string;
  title: string;
  message: string;
  action?: AppNotificationAction;
  reservationId?: string;
  groupId?: string;
  rehearsalId?: string;
  dateKey?: string;
  roomId?: string;
  roomName?: string;
  startMinutes?: number;
  durationMinutes?: number;
  responseStatus?: ReservationParticipantStatus;
  createdAt: number;
  readAt?: number;
  resolvedAt?: number;
};

export type NotificationDraft = Omit<AppNotification, "id" | "readAt" | "resolvedAt"> & {
  id: string;
  readAt?: number | null;
  resolvedAt?: number | null;
};
