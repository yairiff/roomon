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
  | "reservation_join_request"
  | "reservation_join_approved"
  | "reservation_join_declined"
  | "participant_response";

export type AppNotificationAction = "shared_reservation" | "rehearsal" | "group_invite" | "reservation_join_request";

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

export type NotificationResponseActions = {
  respondSharedReservation: (
    notification: AppNotification,
    status: "approved" | "declined"
  ) => void;
  respondRehearsal: (
    notification: AppNotification,
    status: "approved" | "declined"
  ) => void;
  respondGroupInvite: (notification: AppNotification, accept: boolean) => void;
  respondReservationJoinRequest: (notification: AppNotification, accept: boolean) => void;
};
