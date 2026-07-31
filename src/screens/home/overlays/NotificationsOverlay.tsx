import { useEffect } from "react";
import NotificationsRoundedIcon from "@mui/icons-material/NotificationsRounded";
import GroupsRoundedIcon from "@mui/icons-material/GroupsRounded";
import EventRoundedIcon from "@mui/icons-material/EventRounded";
import MeetingRoomRoundedIcon from "@mui/icons-material/MeetingRoomRounded";
import { formatShortDate } from "../../../lib/date";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import type { AppNotification } from "../../../types/notifications";

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

export default function NotificationsOverlay({
  open,
  notifications,
  ready,
  onClose,
  onOpened,
  onRespondSharedReservation,
  onRespondRehearsal,
  onRespondGroupInvite
}: {
  open: boolean;
  notifications: AppNotification[];
  ready: boolean;
  onClose: () => void;
  onOpened: () => void;
  onRespondSharedReservation: (notification: AppNotification, status: "approved" | "declined") => void;
  onRespondRehearsal: (notification: AppNotification, status: "approved" | "declined") => void;
  onRespondGroupInvite: (notification: AppNotification, accept: boolean) => void;
}) {
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
        <div className="notifications-list">
          {!ready ? <p className="notifications-empty">טוען התראות...</p> : null}
          {ready && !notifications.length ? <p className="notifications-empty">אין התראות חדשות.</p> : null}
          {notifications.map((notification) => {
            const actionable = Boolean(notification.action && !notification.resolvedAt);
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
                          if (notification.action === "shared_reservation") onRespondSharedReservation(notification, "declined");
                          if (notification.action === "rehearsal") onRespondRehearsal(notification, "declined");
                          if (notification.action === "group_invite") onRespondGroupInvite(notification, false);
                        }}
                      >
                        דחייה
                      </button>
                      <button
                        type="button"
                        className="primary"
                        onClick={() => {
                          if (notification.action === "shared_reservation") onRespondSharedReservation(notification, "approved");
                          if (notification.action === "rehearsal") onRespondRehearsal(notification, "approved");
                          if (notification.action === "group_invite") onRespondGroupInvite(notification, true);
                        }}
                      >
                        אישור
                      </button>
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
        <div className="groups-overlay-actions">
          <button type="button" className="chip active" onClick={onClose}>סגור</button>
        </div>
      </section>
    </div>
  );
}
