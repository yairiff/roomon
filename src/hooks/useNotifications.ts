import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  writeBatch
} from "firebase/firestore";
import { db } from "../lib/firebase";
import type { AppNotification, AppNotificationAction, AppNotificationType, NotificationDraft } from "../types/notifications";

const timestampToMillis = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  return 0;
};

const notificationTypes = new Set<AppNotificationType>([
  "group_invite",
  "group_updated",
  "group_removed",
  "rehearsal_invite",
  "rehearsal_updated",
  "rehearsal_cancelled",
  "shared_reservation_invite",
  "reservation_updated",
  "reservation_cancelled",
  "participant_response"
]);

const notificationActions = new Set<AppNotificationAction>(["shared_reservation", "rehearsal", "group_invite"]);

const parseNotification = (id: string, raw: Record<string, unknown>): AppNotification | null => {
  const type = raw.type as AppNotificationType;
  const recipientEmail = String(raw.recipientEmail || "").trim().toLowerCase();
  if (!notificationTypes.has(type) || !recipientEmail) return null;
  const action = raw.action as AppNotificationAction;
  return {
    id,
    type,
    recipientEmail,
    actorEmail: String(raw.actorEmail || "").trim().toLowerCase(),
    title: String(raw.title || "התראה"),
    message: String(raw.message || ""),
    ...(notificationActions.has(action) ? { action } : {}),
    ...(typeof raw.reservationId === "string" && raw.reservationId ? { reservationId: raw.reservationId } : {}),
    ...(typeof raw.groupId === "string" && raw.groupId ? { groupId: raw.groupId } : {}),
    ...(typeof raw.rehearsalId === "string" && raw.rehearsalId ? { rehearsalId: raw.rehearsalId } : {}),
    ...(typeof raw.dateKey === "string" && raw.dateKey ? { dateKey: raw.dateKey } : {}),
    ...(typeof raw.roomId === "string" && raw.roomId ? { roomId: raw.roomId } : {}),
    ...(typeof raw.roomName === "string" && raw.roomName ? { roomName: raw.roomName } : {}),
    ...(typeof raw.startMinutes === "number" ? { startMinutes: raw.startMinutes } : {}),
    ...(typeof raw.durationMinutes === "number" ? { durationMinutes: raw.durationMinutes } : {}),
    ...(raw.responseStatus === "pending" || raw.responseStatus === "approved" || raw.responseStatus === "declined"
      ? { responseStatus: raw.responseStatus }
      : {}),
    createdAt: timestampToMillis(raw.createdAt) || Date.now(),
    ...(timestampToMillis(raw.readAt) ? { readAt: timestampToMillis(raw.readAt) } : {}),
    ...(timestampToMillis(raw.resolvedAt) ? { resolvedAt: timestampToMillis(raw.resolvedAt) } : {})
  };
};

export const notificationDocumentId = (...parts: Array<string | number | undefined>) =>
  parts
    .filter((part) => part !== undefined && String(part).trim())
    .map((part) => encodeURIComponent(String(part)).replace(/%/g, "_"))
    .join("--")
    .slice(0, 900);

export async function writeUserNotifications(drafts: NotificationDraft[]) {
  if (!db || !drafts.length) return;
  const unique = new Map<string, NotificationDraft>();
  drafts.forEach((draft) => {
    const email = draft.recipientEmail.trim().toLowerCase();
    if (!email || !draft.id) return;
    unique.set(`${email}:${draft.id}`, { ...draft, recipientEmail: email });
  });
  const values = Array.from(unique.values());
  for (let offset = 0; offset < values.length; offset += 400) {
    const batch = writeBatch(db);
    values.slice(offset, offset + 400).forEach(({ id, ...payload }) => {
      const cleanPayload = Object.fromEntries(
        Object.entries(payload).filter(([, value]) => value !== undefined)
      );
      batch.set(doc(db!, "users", payload.recipientEmail, "notifications", id), cleanPayload);
    });
    await batch.commit();
  }
}

export function useNotifications(email?: string | null) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [ready, setReady] = useState(!db || !normalizedEmail);

  useEffect(() => {
    if (!db || !normalizedEmail) {
      setNotifications([]);
      setReady(true);
      return;
    }
    setReady(false);
    const notificationsQuery = query(
      collection(db, "users", normalizedEmail, "notifications"),
      orderBy("createdAt", "desc"),
      limit(100)
    );
    return onSnapshot(
      notificationsQuery,
      (snapshot) => {
        const next = snapshot.docs
          .map((entry) => parseNotification(entry.id, entry.data() as Record<string, unknown>))
          .filter((entry): entry is AppNotification => Boolean(entry));
        setNotifications(next);
        setReady(true);
      },
      () => setReady(true)
    );
  }, [normalizedEmail]);

  const badgeCount = useMemo(
    () => notifications.filter(
      (entry) => !entry.readAt || (entry.action === "group_invite" && !entry.resolvedAt)
    ).length,
    [notifications]
  );

  const markRead = useCallback(
    async (notificationId: string) => {
      if (!db || !normalizedEmail || !notificationId) return;
      await updateDoc(doc(db, "users", normalizedEmail, "notifications", notificationId), { readAt: Date.now() });
    },
    [normalizedEmail]
  );

  const markAllRead = useCallback(async () => {
    if (!db || !normalizedEmail) return;
    const unread = notifications.filter((entry) => !entry.readAt);
    if (!unread.length) return;
    for (let offset = 0; offset < unread.length; offset += 400) {
      const batch = writeBatch(db);
      const readAt = Date.now();
      unread.slice(offset, offset + 400).forEach((entry) => {
        batch.update(doc(db!, "users", normalizedEmail, "notifications", entry.id), { readAt });
      });
      await batch.commit();
    }
  }, [normalizedEmail, notifications]);

  const resolve = useCallback(
    async (notificationId: string, responseStatus?: "approved" | "declined") => {
      if (!db || !normalizedEmail || !notificationId) return;
      const now = Date.now();
      await updateDoc(doc(db, "users", normalizedEmail, "notifications", notificationId), {
        readAt: now,
        resolvedAt: now,
        ...(responseStatus ? { responseStatus } : {})
      });
    },
    [normalizedEmail]
  );

  return { notifications, badgeCount, ready, markRead, markAllRead, resolve };
}
