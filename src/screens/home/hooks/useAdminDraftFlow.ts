import { useCallback, useEffect, useState } from "react";
import { getDayKeyFromDateKey } from "../../../lib/date";
import type { RoomMeta } from "../../../types/admin";
import type { User } from "../../../types/auth";
import type { Reservation, ReservationMap, ReserveRequest } from "../../../types/reservations";
import type { DayKey, Lesson } from "../../../types/schedule";
import type { AdminClosedDraft, AdminDraft, AdminReservationDraft, AdminSpecialDraft } from "../adminDraft";

type UseAdminDraftFlowArgs = {
  enabled: boolean;
  currentUser: User | null;
  config: { startHour: number; endHour: number };
  roomMeta?: Record<string, RoomMeta>;
  reservationMap: ReservationMap;
  getLessonsForDate: (dateKey: string, dayKey: DayKey) => Lesson[];
  addOverride: (override: {
    date: string;
    action: "add" | "update" | "delete";
    lesson?: Lesson;
    targetLessonId?: string;
    createdBy?: string;
  }) => Promise<boolean>;
  addReservation: (reservation: Reservation) => Promise<boolean>;
  upsertReservation: (reservation: Reservation) => Promise<boolean>;
  releaseReservation: (dateKey: string, reservationId: string) => Promise<boolean>;
};

export function useAdminDraftFlow({
  enabled,
  currentUser,
  config,
  roomMeta,
  reservationMap,
  getLessonsForDate,
  addOverride,
  addReservation,
  upsertReservation,
  releaseReservation
}: UseAdminDraftFlowArgs) {
  const [adminDraft, setAdminDraft] = useState<AdminDraft | null>(null);
  const [adminError, setAdminError] = useState("");

  useEffect(() => {
    if (enabled) return;
    setAdminDraft(null);
    setAdminError("");
  }, [enabled]);

  const checkReservationConflict = useCallback(
    (draft: AdminReservationDraft | AdminSpecialDraft | AdminClosedDraft) => {
      const { dateKey, dayKey, roomId, startMinutes, durationMinutes, reservationId } = draft;
      const endMinutes = startMinutes + durationMinutes;
      const dayLessons = getLessonsForDate(dateKey, dayKey);
      const lessonOverlap = dayLessons.some((lesson) => {
        if (lesson.roomId !== roomId) return false;
        const lessonEnd = lesson.startMinutes + lesson.durationMinutes;
        return lesson.startMinutes < endMinutes && lessonEnd > startMinutes;
      });
      if (lessonOverlap) return "קיים שיעור חופף.";

      const reservations = reservationMap[dateKey] || [];
      const reservationOverlap = reservations.some((reservation) => {
        if (reservation.roomId !== roomId) return false;
        if (reservationId && reservation.id === reservationId) return false;
        const reservationEnd = reservation.time + reservation.durationMinutes;
        return reservation.time < endMinutes && reservationEnd > startMinutes;
      });
      if (reservationOverlap) return "קיים שריון חופף.";

      const policy = roomMeta?.[roomId];
      if (policy?.isClosed) return "החדר סגור זמנית.";
      const roomOpen = policy?.openMinutes ?? config.startHour * 60;
      const roomClose = policy?.closeMinutes ?? config.endHour * 60;
      if (startMinutes < roomOpen || endMinutes > roomClose) {
        return "השעה מחוץ לשעות הפעילות של החדר.";
      }

      return "";
    },
    [config.endHour, config.startHour, getLessonsForDate, reservationMap, roomMeta]
  );

  const handleAdminSave = useCallback(async () => {
    if (!adminDraft) return;
    if (!enabled) {
      setAdminError("אין הרשאת ניהול.");
      return;
    }
    if (adminDraft.type === "choose") {
      setAdminError("יש לבחור סוג רשומה (שיעור/שריון/אירוע/סגור).");
      return;
    }
    setAdminError("");

    if (adminDraft.type === "lesson") {
      const action = adminDraft.mode === "edit" ? "update" : "add";
      const lesson: Lesson = {
        id: adminDraft.targetLessonId || `override-${Date.now()}`,
        title: adminDraft.title,
        teacher: adminDraft.teacher,
        day: adminDraft.dayKey,
        roomId: adminDraft.roomId,
        startMinutes: adminDraft.startMinutes,
        durationMinutes: adminDraft.durationMinutes
      };
      const ok = await addOverride({
        date: adminDraft.dateKey,
        action,
        lesson,
        ...(adminDraft.targetLessonId ? { targetLessonId: adminDraft.targetLessonId } : {}),
        ...(currentUser?.email ? { createdBy: currentUser.email } : {})
      });
      if (!ok) {
        setAdminError("שמירה נכשלה (בדוק הגדרות Firestore).");
        return;
      }
      setAdminDraft(null);
      return;
    }

    const conflictMessage = checkReservationConflict(adminDraft);
    if (conflictMessage) {
      setAdminError(conflictMessage);
      return;
    }

    const reservation: Reservation = {
      id:
        adminDraft.reservationId ||
        (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `res-${Date.now()}-${Math.random().toString(16).slice(2)}`),
      date: adminDraft.dateKey,
      time: adminDraft.startMinutes,
      durationMinutes: adminDraft.durationMinutes,
      roomId: adminDraft.roomId,
      reservedBy:
        adminDraft.type === "special"
          ? adminDraft.label || "אירוע מיוחד"
          : adminDraft.type === "closed"
            ? adminDraft.label || "סגור זמנית"
            : adminDraft.reservedBy || "אדמין",
      reservedEmail: adminDraft.type === "reservation" ? adminDraft.reservedEmail || "" : "",
      ...(adminDraft.type === "special"
        ? { kind: "special" as const }
        : adminDraft.type === "closed"
          ? { kind: "closed" as const }
          : {})
    };

    if (adminDraft.mode === "create") {
      const ok = await addReservation(reservation);
      if (!ok) {
        setAdminError("שמירה נכשלה (בדוק הגדרות Firestore).");
        return;
      }
    } else {
      const ok = await upsertReservation(reservation);
      if (!ok) {
        setAdminError("שמירה נכשלה (בדוק הגדרות Firestore).");
        return;
      }
    }
    setAdminDraft(null);
  }, [addOverride, addReservation, adminDraft, checkReservationConflict, currentUser?.email, enabled, upsertReservation]);

  const handleAdminDeleteLesson = useCallback(async () => {
    if (!adminDraft || !enabled || adminDraft.type !== "lesson" || !adminDraft.targetLessonId) return;
    await addOverride({
      date: adminDraft.dateKey,
      action: "delete",
      targetLessonId: adminDraft.targetLessonId,
      createdBy: currentUser?.email
    });
    setAdminDraft(null);
  }, [addOverride, adminDraft, currentUser?.email, enabled]);

  const handleAdminDeleteReservation = useCallback(() => {
    if (
      !adminDraft ||
      !enabled ||
      (adminDraft.type !== "reservation" && adminDraft.type !== "special" && adminDraft.type !== "closed") ||
      !adminDraft.reservationId
    ) {
      return;
    }
    const { dateKey, reservationId } = adminDraft;
    void (async () => {
      const ok = await releaseReservation(dateKey, reservationId);
      if (!ok) {
        setAdminError("מחיקה נכשלה (בדוק הגדרות Firestore).");
        return;
      }
      setAdminDraft(null);
    })();
  }, [adminDraft, enabled, releaseReservation]);

  const switchAdminType = useCallback((nextType: "lesson" | "reservation" | "special" | "closed") => {
    if (!adminDraft || adminDraft.mode !== "create") return;
    if (adminDraft.type === nextType) return;
    if (nextType === "lesson") {
      setAdminDraft({
        type: "lesson",
        mode: "create",
        dateKey: adminDraft.dateKey,
        dayKey: adminDraft.dayKey,
        roomId: adminDraft.roomId,
        startMinutes: adminDraft.startMinutes,
        durationMinutes: 90,
        title: "",
        teacher: ""
      });
      return;
    }
    if (nextType === "special") {
      setAdminDraft({
        type: "special",
        mode: "create",
        dateKey: adminDraft.dateKey,
        dayKey: adminDraft.dayKey,
        roomId: adminDraft.roomId,
        startMinutes: adminDraft.startMinutes,
        durationMinutes: adminDraft.durationMinutes,
        label: ""
      });
      return;
    }
    if (nextType === "closed") {
      setAdminDraft({
        type: "closed",
        mode: "create",
        dateKey: adminDraft.dateKey,
        dayKey: adminDraft.dayKey,
        roomId: adminDraft.roomId,
        startMinutes: adminDraft.startMinutes,
        durationMinutes: adminDraft.durationMinutes,
        label: ""
      });
      return;
    }
    setAdminDraft({
      type: "reservation",
      mode: "create",
      dateKey: adminDraft.dateKey,
      dayKey: adminDraft.dayKey,
      roomId: adminDraft.roomId,
      startMinutes: adminDraft.startMinutes,
      durationMinutes: adminDraft.durationMinutes,
      reservedBy: "",
      reservedEmail: ""
    });
  }, [adminDraft]);

  const handleAdminSlotClick = useCallback(
    (request: ReserveRequest) => {
      if (!enabled) return;
      setAdminError("");
      setAdminDraft({
        type: "choose",
        mode: "create",
        dateKey: request.date,
        dayKey: request.day,
        roomId: request.roomId,
        startMinutes: request.time,
        durationMinutes: 60,
        reservedBy: "",
        reservedEmail: ""
      });
    },
    [enabled]
  );

  const handleAdminLessonClick = useCallback(
    (lessonId: string, dateKey: string) => {
      if (!enabled) return;
      const dayKey = getDayKeyFromDateKey(dateKey);
      const lesson = getLessonsForDate(dateKey, dayKey).find((entry) => entry.id === lessonId);
      if (!lesson) return;
      setAdminError("");
      setAdminDraft({
        type: "lesson",
        mode: "edit",
        dateKey,
        dayKey,
        roomId: lesson.roomId,
        startMinutes: lesson.startMinutes,
        durationMinutes: lesson.durationMinutes,
        title: lesson.title,
        teacher: lesson.teacher,
        targetLessonId: lesson.id
      });
    },
    [enabled, getLessonsForDate]
  );

  const handleAdminReservationClick = useCallback(
    (reservationId: string, dateKey: string) => {
      if (!enabled) return;
      const reservation = (reservationMap[dateKey] || []).find((entry) => entry.id === reservationId);
      if (!reservation) return;
      const dayKey = getDayKeyFromDateKey(dateKey);
      setAdminError("");
      if (reservation.kind === "special") {
        setAdminDraft({
          type: "special",
          mode: "edit",
          dateKey,
          dayKey,
          roomId: reservation.roomId,
          startMinutes: reservation.time,
          durationMinutes: reservation.durationMinutes,
          label: reservation.reservedBy || "אירוע מיוחד",
          reservationId: reservation.id
        });
        return;
      }
      if (reservation.kind === "closed") {
        setAdminDraft({
          type: "closed",
          mode: "edit",
          dateKey,
          dayKey,
          roomId: reservation.roomId,
          startMinutes: reservation.time,
          durationMinutes: reservation.durationMinutes,
          label: reservation.reservedBy || "סגור זמנית",
          reservationId: reservation.id
        });
        return;
      }
      setAdminDraft({
        type: "reservation",
        mode: "edit",
        dateKey,
        dayKey,
        roomId: reservation.roomId,
        startMinutes: reservation.time,
        durationMinutes: reservation.durationMinutes,
        reservedBy: reservation.reservedBy,
        reservedEmail: reservation.reservedEmail,
        reservationId: reservation.id
      });
    },
    [enabled, reservationMap]
  );

  return {
    adminDraft,
    setAdminDraft,
    adminError,
    setAdminError,
    handleAdminSlotClick,
    handleAdminLessonClick,
    handleAdminReservationClick,
    handleAdminSave,
    handleAdminDeleteLesson,
    handleAdminDeleteReservation,
    switchAdminType
  };
}

