import { useEffect } from "react";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import MeetingRoomRoundedIcon from "@mui/icons-material/MeetingRoomRounded";
import { formatShortDate } from "../../../lib/date";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import type { AppNotification, NotificationResponseActions } from "../../../types/notifications";

const notificationIcon = (type: AppNotification["type"]) => {
  if (type.startsWith("group")) return <GroupsRoundedIcon fontSize="small" />;
  if (type.startsWith("rehearsal")) return <EventRoundedIcon fontSize="small" />;
  if (type.startsWith("reservation") || type.startsWith("shared")) return <MeetingRoomRoundedIcon fontSize="small" />;
  return <NotificationsRoundedIcon fontSize="small" />;
};

const timeAgo = (createdAt: number) => {
  const diffMinutes = Math.max(0, Math.floor((Date.now() - createdAt) / 60000));
  if (diffMinutes < 1) return "עכשיו";
  if (diffMinutes < 60) return `לפני ${diffMinutes} דקות`;
  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
};

export type NotificationsListProps = NotificationResponseActions & {
  notifications: AppNotification[];
  ready: boolean;
  className?: string;
};

export function NotificationsList({
  notifications,
  ready,
  className = "",
  respondSharedReservation,
  respondRehearsal,
  respondGroupInvite,
  respondReservationJoinRequest
}: NotificationsListProps) {
  return (
    <div className={`notifications-list${className ? ` ${className}` : ""}`}>
      {!ready ? <p className="notifications-empty">טוען התראות...</p> : null}
      {ready && !notifications.length ? <p className="notifications-empty">אין התראות חדשות.</p> : null}
      {notifications.map((notification) => {
        const actionable = Boolean(notification.action && !notification.resolvedAt);
        const rejectOnly = notification.action === "shared_reservation" || notification.action === "rehearsal";
        const dateLine = notification.dateKey
          ? `${formatShortDate(notification.dateKey)}${typeof notification.startMinutes === "number" ? ` · ${formatMinutes(notification.startMinutes)}` : ""}`
          : "";
        return (
          <article key={notification.id} className={`notification-row${notification.readAt ? "" : " unread"}${actionable ? " actionable" : ""}`}>
            <span className="notification-type-icon" aria-hidden="true">{notificationIcon(notification.type)}</span>
            <div className="notification-content">
              <div className="notification-title-row">
                <h3>{notification.title}</h3>
                {!notification.readAt ? <span className="notification-unread-dot" /> : null}
              </div>
              {notification.message ? <p>{notification.message}</p> : null}
              {dateLine || notification.roomName ? (
                <span className="notification-meta">{[dateLine, notification.roomName].filter(Boolean).join(" · ")}</span>
              ) : null}
              <span className="notification-time">{timeAgo(notification.createdAt)}</span>
              {actionable ? (
                <div className="notification-actions">
                  <button
                    type="button"
                    className="secondary danger"
                    onClick={() => {
                      if (notification.action === "shared_reservation") respondSharedReservation(notification, "declined");
                      if (notification.action === "rehearsal") respondRehearsal(notification, "declined");
                      if (notification.action === "group_invite") respondGroupInvite(notification, false);
                      if (notification.action === "reservation_join_request") respondReservationJoinRequest(notification, false);
                    }}
                  >
                    דחייה
                  </button>
                  {!rejectOnly ? (
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        if (notification.action === "group_invite") respondGroupInvite(notification, true);
                        if (notification.action === "reservation_join_request") respondReservationJoinRequest(notification, true);
                      }}
                    >
                      אישור
                    </button>
                  ) : null}
                </div>
              ) : notification.responseStatus ? (
                <span className={`notification-resolution ${notification.responseStatus}`}>
                  {notification.responseStatus === "approved" ? "אושר" : "נדחה"}
                </span>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default function NotificationsOverlay({
  open,
  notifications,
  ready,
  onClose,
  onOpened,
  ...actions
}: {
  open: boolean;
  notifications: AppNotification[];
  ready: boolean;
  onClose: () => void;
  onOpened: () => void;
} & NotificationResponseActions) {
  useEffect(() => {
    if (open) onOpened();
  }, [onOpened, open]);

  if (!open) return null;
  return (
    <div className="groups-overlay-backdrop notifications-layer" role="presentation" onClick={onClose}>
      <section className="groups-overlay notifications-overlay" role="dialog" aria-modal="true" aria-label="התראות" onClick={(event) => event.stopPropagation()}>
        <header className="notifications-header">
          <span className="notifications-header-icon" aria-hidden="true"><NotificationsRoundedIcon /></span>
          <div>
            <h2>התראות</h2>
            <p>הזמנות ועדכונים אחרונים</p>
          </div>
        </header>
        <NotificationsList notifications={notifications} ready={ready} {...actions} />
        <div className="groups-overlay-actions">
          <button type="button" className="chip active" onClick={onClose}>סגור</button>
        </div>
      </section>
    </div>
  );
}
