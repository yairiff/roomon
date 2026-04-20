import { useCallback, useEffect, useState } from "react";
import { getDayKeyFromDateKey } from "../../../lib/date";
import type { RoomMeta } from "../../../types/admin";
import type { User } from "../../../types/auth";
import type { Reservation, ReservationMap, ReserveRequest } from "../../../types/reservations";
import type { DayKey, Lesson } from "../../../types/schedule";
import type {
  AdminClosedDraft,
  AdminDraft,
  AdminDraftSource,
  AdminExamDraft,
  AdminReservationDraft,
  AdminSpecialDraft
} from "../adminDraft";

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
  const [collisionConfirm, setCollisionConfirm] = useState<{ signature: string; message: string } | null>(null);

  useEffect(() => {
    if (enabled) return;
    setAdminDraft(null);
    setAdminError("");
    setCollisionConfirm(null);
  }, [enabled]);

  useEffect(() => {
    // Any edit clears the collision confirmation.
    setCollisionConfirm(null);
  }, [adminDraft]);

  const checkReservationConflict = useCallback(
    (
      draft: AdminReservationDraft | AdminSpecialDraft | AdminExamDraft | AdminClosedDraft,
      { ignoreLessonId }: { ignoreLessonId?: string } = {}
    ) => {
      const { dateKey, dayKey, roomId, startMinutes, durationMinutes, reservationId } = draft;
      const endMinutes = startMinutes + durationMinutes;
      const dayLessons = getLessonsForDate(dateKey, dayKey);
      const lessonOverlap = dayLessons.some((lesson) => {
        if (lesson.roomId !== roomId) return false;
        if (ignoreLessonId && lesson.id === ignoreLessonId) return false;
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
      const roomOpen = policy?.openMinutes ?? config.startHour * 60;
      const roomClose = policy?.closeMinutes ?? config.endHour * 60;
      if (startMinutes < roomOpen || endMinutes > roomClose) {
        return "השעה מחוץ לשעות הפעילות של החדר.";
      }

      return "";
    },
    [config.endHour, config.startHour, getLessonsForDate, reservationMap, roomMeta]
  );

  const draftSignature = (draft: AdminDraft) => {
    if (!draft) return "";
    const source = (draft as any).source as AdminDraftSource | undefined;
    return [
      draft.type,
      draft.mode,
      draft.dateKey,
      draft.roomId,
      String(draft.startMinutes),
      String(draft.durationMinutes),
      (draft as any).reservationId || "",
      (draft as any).targetLessonId || "",
      source?.kind || "",
      (source as any)?.lessonId || "",
      (source as any)?.reservationId || ""
    ].join("|");
  };

  const handleAdminSave = useCallback(async () => {
    if (!adminDraft) return;
    if (!enabled) {
      setAdminError("אין הרשאת ניהול.");
      return;
    }
    if (adminDraft.type === "choose") {
      setAdminError("יש לבחור סוג רשומה (שיעור/שריון/אירוע/מבחן/סגור).");
      return;
    }
    setAdminError("");

    const source: AdminDraftSource | undefined =
      adminDraft.source ||
      (adminDraft.mode === "edit"
        ? adminDraft.type === "lesson"
          ? (adminDraft.targetLessonId ? { kind: "lesson", lessonId: adminDraft.targetLessonId } : undefined)
          : (adminDraft as any).reservationId
            ? { kind: "reservation", reservationId: String((adminDraft as any).reservationId) }
            : undefined
        : undefined);

    if (adminDraft.type === "lesson") {
      if (!adminDraft.title.trim()) {
        setAdminError("יש להזין שם שיעור.");
        return;
      }
      if (adminDraft.mode === "edit" && source?.kind === "reservation") {
        // Convert a reservation instance into a one-off lesson:
        // delete the reservation, then add a lesson override for this date.
        const ok = await releaseReservation(adminDraft.dateKey, source.reservationId);
        if (!ok) {
          setAdminError("מחיקה נכשלה (בדוק הגדרות Firestore).");
          return;
        }
        const lesson: Lesson = {
          id: `override-${Date.now()}`,
          title: adminDraft.title,
          teacher: adminDraft.teacher,
          day: adminDraft.dayKey,
          roomId: adminDraft.roomId,
          startMinutes: adminDraft.startMinutes,
          durationMinutes: adminDraft.durationMinutes
        };
        const ok2 = await addOverride({
          date: adminDraft.dateKey,
          action: "add",
          lesson,
          ...(currentUser?.email ? { createdBy: currentUser.email } : {})
        });
        if (!ok2) {
          setAdminError("שמירה נכשלה (בדוק הגדרות Firestore).");
          return;
        }
        setAdminDraft(null);
        return;
      }

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

    if ((adminDraft.type === "special" || adminDraft.type === "exam" || adminDraft.type === "closed") && !adminDraft.label.trim()) {
      setAdminError(
        adminDraft.type === "special" ? "יש להזין תיאור אירוע." : adminDraft.type === "exam" ? "יש להזין תיאור מבחן." : "יש להזין תיאור סגירה."
      );
      return;
    }
    if (adminDraft.type === "reservation" && !adminDraft.reservedEmail.trim()) {
      setAdminError("יש להזין אימייל.");
      return;
    }

    const ignoreLessonId = source?.kind === "lesson" ? source.lessonId : undefined;
    const conflictMessage = checkReservationConflict(adminDraft, { ignoreLessonId });
    if (conflictMessage) {
      const signature = draftSignature(adminDraft);
      if (!collisionConfirm || collisionConfirm.signature !== signature) {
        setCollisionConfirm({ signature, message: conflictMessage });
        setAdminError(`${conflictMessage} כדי להמשיך, לחץ/י שוב על שמירה.`);
        return;
      }
    }

    const reservationIdFromSource = source?.kind === "reservation" ? source.reservationId : "";
    const isConversionFromLesson = adminDraft.mode === "edit" && source?.kind === "lesson";
    const id =
      (!isConversionFromLesson && adminDraft.reservationId) ||
      (!isConversionFromLesson && reservationIdFromSource) ||
      (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `res-${Date.now()}-${Math.random().toString(16).slice(2)}`);

    const reservation: Reservation = {
      id,
      date: adminDraft.dateKey,
      time: adminDraft.startMinutes,
      durationMinutes: adminDraft.durationMinutes,
      roomId: adminDraft.roomId,
      reservedBy:
        adminDraft.type === "special"
          ? adminDraft.label || "אירוע מיוחד"
          : adminDraft.type === "exam"
            ? adminDraft.label || "מבחן"
            : adminDraft.type === "closed"
              ? adminDraft.label || "סגור זמנית"
              : adminDraft.reservedBy || "אדמין",
      reservedEmail: adminDraft.type === "reservation" ? adminDraft.reservedEmail || "" : "",
      ...(adminDraft.type === "special"
        ? { kind: "special" as const }
        : adminDraft.type === "exam"
          ? { kind: "exam" as const }
          : adminDraft.type === "closed"
            ? { kind: "closed" as const }
            : {})
    };

    if (isConversionFromLesson && source?.kind === "lesson") {
      // Replace a single recurring lesson instance:
      // hide it via a delete override, then add the new block as a one-off reservation.
      const okDelete = await addOverride({
        date: adminDraft.dateKey,
        action: "delete",
        targetLessonId: source.lessonId,
        createdBy: currentUser?.email
      });
      if (!okDelete) {
        setAdminError("שמירה נכשלה (בדוק הגדרות Firestore).");
        return;
      }
      const okAdd = await addReservation(reservation);
      if (!okAdd) {
        setAdminError("שמירה נכשלה (בדוק הגדרות Firestore).");
        return;
      }
      setAdminDraft(null);
      return;
    }

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
  }, [
    addOverride,
    addReservation,
    adminDraft,
    checkReservationConflict,
    collisionConfirm,
    currentUser?.email,
    enabled,
    releaseReservation,
    upsertReservation
  ]);

  const handleAdminDeleteLesson = useCallback(async () => {
    if (!adminDraft || !enabled || adminDraft.type !== "lesson") return;
    const source = adminDraft.source;
    if (adminDraft.mode === "edit" && source?.kind === "reservation") {
      await releaseReservation(adminDraft.dateKey, source.reservationId);
      setAdminDraft(null);
      return;
    }
    if (!adminDraft.targetLessonId) return;
    await addOverride({ date: adminDraft.dateKey, action: "delete", targetLessonId: adminDraft.targetLessonId, createdBy: currentUser?.email });
    setAdminDraft(null);
  }, [addOverride, adminDraft, currentUser?.email, enabled, releaseReservation]);

  const handleAdminDeleteReservation = useCallback(() => {
    if (
      !adminDraft ||
      !enabled ||
      (adminDraft.type !== "reservation" &&
        adminDraft.type !== "special" &&
        adminDraft.type !== "exam" &&
        adminDraft.type !== "closed") ||
      !adminDraft.reservationId
    ) {
      // For conversions-from-lesson, `reservationId` is empty; treat delete as "remove the source lesson instance".
      if (adminDraft && enabled) {
        const source = (adminDraft as any).source as AdminDraftSource | undefined;
        if (source?.kind === "lesson") {
          void addOverride({
            date: adminDraft.dateKey,
            action: "delete",
            targetLessonId: source.lessonId,
            createdBy: currentUser?.email
          }).then(() => setAdminDraft(null));
        }
      }
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
  }, [addOverride, adminDraft, currentUser?.email, enabled, releaseReservation]);

  const switchAdminType = useCallback((nextType: "lesson" | "reservation" | "special" | "exam" | "closed") => {
    if (!adminDraft) return;
    if (adminDraft.type === nextType) return;
    setAdminError("");
    setCollisionConfirm(null);

    const source: AdminDraftSource | undefined =
      adminDraft.source ||
      (adminDraft.mode === "edit"
        ? adminDraft.type === "lesson"
          ? (adminDraft.targetLessonId ? { kind: "lesson", lessonId: adminDraft.targetLessonId } : undefined)
          : (adminDraft as any).reservationId
            ? { kind: "reservation", reservationId: String((adminDraft as any).reservationId) }
            : undefined
        : undefined);

    if (nextType === "lesson") {
      setAdminDraft({
        type: "lesson",
        mode: adminDraft.mode,
        dateKey: adminDraft.dateKey,
        dayKey: adminDraft.dayKey,
        roomId: adminDraft.roomId,
        startMinutes: adminDraft.startMinutes,
        durationMinutes: adminDraft.durationMinutes,
        title: "",
        teacher: "",
        ...(source?.kind === "lesson" ? { targetLessonId: source.lessonId } : {}),
        source
      });
      return;
    }
    if (nextType === "special") {
      setAdminDraft({
        type: "special",
        mode: adminDraft.mode,
        dateKey: adminDraft.dateKey,
        dayKey: adminDraft.dayKey,
        roomId: adminDraft.roomId,
        startMinutes: adminDraft.startMinutes,
        durationMinutes: adminDraft.durationMinutes,
        label: (adminDraft as any).label || (adminDraft as any).reservedBy || "",
        ...(source?.kind === "reservation" ? { reservationId: source.reservationId } : {}),
        source
      });
      return;
    }
    if (nextType === "exam") {
      setAdminDraft({
        type: "exam",
        mode: adminDraft.mode,
        dateKey: adminDraft.dateKey,
        dayKey: adminDraft.dayKey,
        roomId: adminDraft.roomId,
        startMinutes: adminDraft.startMinutes,
        durationMinutes: adminDraft.durationMinutes,
        label: (adminDraft as any).label || (adminDraft as any).reservedBy || "",
        ...(source?.kind === "reservation" ? { reservationId: source.reservationId } : {}),
        source
      });
      return;
    }
    if (nextType === "closed") {
      setAdminDraft({
        type: "closed",
        mode: adminDraft.mode,
        dateKey: adminDraft.dateKey,
        dayKey: adminDraft.dayKey,
        roomId: adminDraft.roomId,
        startMinutes: adminDraft.startMinutes,
        durationMinutes: adminDraft.durationMinutes,
        label: (adminDraft as any).label || (adminDraft as any).reservedBy || "",
        ...(source?.kind === "reservation" ? { reservationId: source.reservationId } : {}),
        source
      });
      return;
    }
    setAdminDraft({
      type: "reservation",
      mode: adminDraft.mode,
      dateKey: adminDraft.dateKey,
      dayKey: adminDraft.dayKey,
      roomId: adminDraft.roomId,
      startMinutes: adminDraft.startMinutes,
      durationMinutes: adminDraft.durationMinutes,
      reservedBy: (adminDraft as any).reservedBy || (adminDraft as any).label || "",
      reservedEmail: (adminDraft as any).reservedEmail || "",
      ...(source?.kind === "reservation" ? { reservationId: source.reservationId } : {}),
      source
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
        reservedEmail: "",
        source: undefined
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
        targetLessonId: lesson.id,
        source: { kind: "lesson", lessonId: lesson.id }
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
          reservationId: reservation.id,
          source: { kind: "reservation", reservationId: reservation.id }
        });
        return;
      }
      if (reservation.kind === "exam") {
        setAdminDraft({
          type: "exam",
          mode: "edit",
          dateKey,
          dayKey,
          roomId: reservation.roomId,
          startMinutes: reservation.time,
          durationMinutes: reservation.durationMinutes,
          label: reservation.reservedBy || "מבחן",
          reservationId: reservation.id,
          source: { kind: "reservation", reservationId: reservation.id }
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
          reservationId: reservation.id,
          source: { kind: "reservation", reservationId: reservation.id }
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
        reservationId: reservation.id,
        source: { kind: "reservation", reservationId: reservation.id }
      });
    },
    [enabled, reservationMap]
  );

  return {
    adminDraft,
    setAdminDraft,
    adminError,
    setAdminError,
    collisionConfirm,
    handleAdminSlotClick,
    handleAdminLessonClick,
    handleAdminReservationClick,
    handleAdminSave,
    handleAdminDeleteLesson,
    handleAdminDeleteReservation,
    switchAdminType
  };
}
