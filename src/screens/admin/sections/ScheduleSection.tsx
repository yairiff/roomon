import { useCallback, useEffect, useMemo, useState } from "react";
import { rimonScheduleConfig } from "../../../config";
import { weekDays } from "../../../config";
import type { LessonOverride, LessonRecord, RoomRecord } from "../../../types/admin";
import type { SemesterKey } from "../../../types/ui";
import type { Reservation } from "../../../types/reservations";
import type { BulkState } from "../bulk";
import { AddIcon, CloseIcon, DuplicateIcon, EditIcon, ReleaseIcon, TuneIcon } from "../../../components/Icons";
import ConfirmDialog from "../components/ConfirmDialog";
import PropsOverlay from "../components/PropsOverlay";
import { useLessonOverrides } from "../../../hooks/useLessonOverrides";

type ScheduleFilter = "all" | "lessons" | "regular" | "special" | "closed";

type ScheduleSectionProps = {
  scheduleFilter: ScheduleFilter;
  setScheduleFilter: (filter: ScheduleFilter) => void;
  activeSemester: SemesterKey;
  setActiveSemester: (semester: SemesterKey) => void;
  lessons: LessonRecord[];
  lessonsError: string;
  reservations: Reservation[];
  reservationsError: string;
  roomsRaw: RoomRecord[];
  toTimeInput: (minutes: number) => string;
  parseTimeInput: (value: string) => number;
  onUpsertLesson: (lesson: LessonRecord) => void;
  onRemoveLesson: (lessonId: string) => void;
  onUpdateReservation: (reservation: Reservation) => void;
  onRemoveReservation: (reservation: Reservation) => void;
  onBulkStateChange?: (state: BulkState | null) => void;
  onFilteredLessonsChange?: (lessons: LessonRecord[]) => void;
  onFilteredReservationsChange?: (reservations: Reservation[]) => void;
};

type ItemKey = `lesson:${string}` | `reservation:${string}`;
type ItemKind = "lesson" | "reservation";

type ScheduleItem =
  | { key: ItemKey; kind: "lesson"; lesson: LessonRecord }
  | { key: ItemKey; kind: "reservation"; reservation: Reservation };

const kindLabel = (reservation: Reservation) => {
  if (reservation.kind === "special") return "אירוע";
  if (reservation.kind === "closed") return "סגירה";
  return "שריון";
};

const reservationKindValue = (reservation: Reservation) =>
  reservation.kind === "special" ? "special" : reservation.kind === "closed" ? "closed" : "regular";

const newReservationId = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `res-${Date.now()}-${Math.random().toString(16).slice(2)}`);

export default function ScheduleSection({
  scheduleFilter,
  setScheduleFilter,
  activeSemester,
  setActiveSemester,
  lessons,
  lessonsError,
  reservations,
  reservationsError,
  roomsRaw,
  toTimeInput,
  parseTimeInput,
  onUpsertLesson,
  onRemoveLesson,
  onUpdateReservation,
  onRemoveReservation,
  onBulkStateChange,
  onFilteredLessonsChange,
  onFilteredReservationsChange
}: ScheduleSectionProps) {
  const [query, setQuery] = useState("");
  const [roomFilter, setRoomFilter] = useState<string>("all");
  const [dayFilter, setDayFilter] = useState<LessonRecord["day"] | "all">("all");
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");
  const [selectedKeys, setSelectedKeys] = useState<Set<ItemKey>>(() => new Set());
  const [confirmDeleteKeys, setConfirmDeleteKeys] = useState<ItemKey[] | null>(null);
  const [lessonOverridesOpen, setLessonOverridesOpen] = useState(false);
  const [overrideDraft, setOverrideDraft] = useState<LessonOverride | null>(null);
  const [confirmRemoveOverride, setConfirmRemoveOverride] = useState<LessonOverride | null>(null);

  const [draft, setDraft] = useState<
    | { kind: "lesson"; value: LessonRecord }
    | { kind: "reservation"; value: Reservation }
    | null
  >(null);

  const { overrides, upsertOverride, removeOverride } = useLessonOverrides();

  const roomLookup = useMemo(() => {
    const lookup: Record<string, string> = {};
    roomsRaw.forEach((room) => {
      lookup[room.id] = room.name;
    });
    return lookup;
  }, [roomsRaw]);

  const dayLabel = useCallback((day: LessonRecord["day"]) => {
    return weekDays.find((d) => d.key === day)?.label || day;
  }, []);

  const includesLessons = scheduleFilter === "all" || scheduleFilter === "lessons";
  const includesReservations =
    scheduleFilter === "all" || scheduleFilter === "regular" || scheduleFilter === "special" || scheduleFilter === "closed";

  const filteredLessons = useMemo(() => {
    if (!includesLessons) return [];
    let list = lessons;
    if (dayFilter !== "all") list = list.filter((l) => l.day === dayFilter);
    if (roomFilter !== "all") list = list.filter((l) => l.roomId === roomFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((l) => {
        const roomName = roomLookup[l.roomId] || l.roomId;
        const haystack = [l.title, l.teacher || "", dayLabel(l.day), roomName].join(" ").toLowerCase();
        return haystack.includes(q);
      });
    }
    const dayIndex = (dayKey: LessonRecord["day"]) => weekDays.findIndex((day) => day.key === dayKey);
    return [...list].sort((a, b) =>
      dayIndex(a.day) - dayIndex(b.day) || a.startMinutes - b.startMinutes || a.title.localeCompare(b.title, "he")
    );
  }, [dayFilter, dayLabel, includesLessons, lessons, query, roomFilter, roomLookup]);

  const filteredReservations = useMemo(() => {
    if (!includesReservations) return [];
    let list = reservations;
    if (scheduleFilter === "regular") list = list.filter((r) => !r.kind);
    if (scheduleFilter === "special") list = list.filter((r) => r.kind === "special");
    if (scheduleFilter === "closed") list = list.filter((r) => r.kind === "closed");

    if (roomFilter !== "all") {
      list = list.filter((reservation) => reservation.roomId === roomFilter);
    }
    if (dateStart) {
      list = list.filter((reservation) => reservation.date >= dateStart);
    }
    if (dateEnd) {
      list = list.filter((reservation) => reservation.date <= dateEnd);
    }

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((reservation) => {
        const roomName = roomLookup[reservation.roomId] || reservation.roomId;
        const haystack = [
          reservation.reservedBy || "",
          reservation.reservedEmail || "",
          kindLabel(reservation),
          reservation.date,
          roomName
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    return [...list].sort((a, b) => a.date.localeCompare(b.date) || a.time - b.time || a.roomId.localeCompare(b.roomId));
  }, [dateEnd, dateStart, includesReservations, query, reservations, roomFilter, roomLookup, scheduleFilter]);

  useEffect(() => {
    onFilteredLessonsChange?.(filteredLessons);
  }, [filteredLessons, onFilteredLessonsChange]);

  useEffect(() => {
    onFilteredReservationsChange?.(filteredReservations);
  }, [filteredReservations, onFilteredReservationsChange]);

  const items = useMemo<ScheduleItem[]>(() => {
    const next: ScheduleItem[] = [];
    filteredLessons.forEach((lesson) => next.push({ key: `lesson:${lesson.id}`, kind: "lesson", lesson }));
    filteredReservations.forEach((reservation) => next.push({ key: `reservation:${reservation.id}`, kind: "reservation", reservation }));

    if (includesLessons && includesReservations) {
      const dayIndex = (dayKey: LessonRecord["day"]) => weekDays.findIndex((day) => day.key === dayKey);
      next.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "lesson" ? -1 : 1;
        if (a.kind === "lesson" && b.kind === "lesson") {
          return (
            dayIndex(a.lesson.day) - dayIndex(b.lesson.day) ||
            a.lesson.startMinutes - b.lesson.startMinutes ||
            a.lesson.title.localeCompare(b.lesson.title, "he")
          );
        }
        if (a.kind === "reservation" && b.kind === "reservation") {
          return (
            a.reservation.date.localeCompare(b.reservation.date) ||
            a.reservation.time - b.reservation.time ||
            (roomLookup[a.reservation.roomId] || a.reservation.roomId).localeCompare(
              roomLookup[b.reservation.roomId] || b.reservation.roomId,
              "he"
            )
          );
        }
        return 0;
      });
    }
    return next;
  }, [filteredLessons, filteredReservations, includesLessons, includesReservations, roomLookup]);

  const itemsByKey = useMemo(() => {
    const map = new Map<ItemKey, ScheduleItem>();
    items.forEach((item) => map.set(item.key, item));
    return map;
  }, [items]);

  const selectedInView = useMemo(
    () => Array.from(selectedKeys).filter((key) => itemsByKey.has(key)),
    [itemsByKey, selectedKeys]
  );

  const toggleAll = useCallback(() => {
    setSelectedKeys((prev) => {
      const allSelected = items.length > 0 && selectedInView.length === items.length;
      if (allSelected) return new Set();
      return new Set(items.map((item) => item.key));
    });
  }, [items, selectedInView.length]);

  const selectOne = useCallback((item: ScheduleItem) => {
    if (item.kind === "lesson") {
      setDraft({ kind: "lesson", value: { ...item.lesson, semester: activeSemester } });
      return;
    }
    setDraft({
      kind: "reservation",
      value: { ...item.reservation, durationMinutes: item.reservation.durationMinutes || 60 }
    });
  }, [activeSemester]);

  const handleNew = useCallback(() => {
    if (scheduleFilter === "lessons") {
      const firstRoom = roomsRaw[0]?.id || "";
      const base: LessonRecord = {
        id: "",
        title: "",
        teacher: "",
        day: "sun",
        roomId: roomFilter !== "all" ? roomFilter : firstRoom,
        startMinutes: rimonScheduleConfig.startHour * 60,
        durationMinutes: rimonScheduleConfig.academicHourMinutes,
        semester: activeSemester
      };
      setDraft({ kind: "lesson", value: base });
      return;
    }

    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const firstRoom = roomsRaw[0]?.id || "";
    const kindFromFilter = scheduleFilter === "special" ? "special" : scheduleFilter === "closed" ? "closed" : undefined;
    const base: Reservation = {
      id: newReservationId(),
      date,
      time: rimonScheduleConfig.startHour * 60,
      durationMinutes: 60,
      roomId: roomFilter !== "all" ? roomFilter : firstRoom,
      reservedBy: kindFromFilter === "special" ? "אירוע חדש" : kindFromFilter === "closed" ? "סגור זמנית" : "אדמין",
      reservedEmail: "",
      ...(kindFromFilter ? { kind: kindFromFilter } : {})
    };
    setDraft({ kind: "reservation", value: base });
  }, [activeSemester, roomFilter, roomsRaw, scheduleFilter]);

  const bulkEdit = useCallback(() => {
    if (selectedInView.length !== 1) return;
    const item = itemsByKey.get(selectedInView[0]);
    if (item) selectOne(item);
  }, [itemsByKey, selectOne, selectedInView]);

  const duplicateLesson = useCallback((lesson: LessonRecord) => {
    const newId = `${activeSemester}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const copy: LessonRecord = {
      ...lesson,
      id: newId,
      semester: activeSemester,
      title: lesson.title ? `${lesson.title} (עותק)` : "שיעור (עותק)"
    };
    onUpsertLesson(copy);
    setDraft({ kind: "lesson", value: copy });
  }, [activeSemester, onUpsertLesson]);

  const duplicateReservation = useCallback((reservation: Reservation) => {
    const kind = reservation.kind === "special" || reservation.kind === "closed" ? reservation.kind : undefined;
    const copy: Reservation = {
      ...reservation,
      id: newReservationId(),
      reservedBy: reservation.reservedBy ? `${reservation.reservedBy} (עותק)` : "עותק",
      ...(kind ? { kind } : {})
    };
    onUpdateReservation(copy);
    setDraft({ kind: "reservation", value: copy });
  }, [onUpdateReservation]);

  const bulkDuplicate = useCallback(() => {
    if (!selectedInView.length) return;
    selectedInView.forEach((key) => {
      const item = itemsByKey.get(key);
      if (!item) return;
      if (item.kind === "lesson") duplicateLesson(item.lesson);
      else duplicateReservation(item.reservation);
    });
  }, [duplicateLesson, duplicateReservation, itemsByKey, selectedInView]);

  const bulkDelete = useCallback(() => {
    if (!selectedInView.length) return;
    setConfirmDeleteKeys(selectedInView);
  }, [selectedInView]);

  const confirmDelete = useCallback(() => {
    if (!confirmDeleteKeys?.length) return;
    confirmDeleteKeys.forEach((key) => {
      const item = itemsByKey.get(key);
      if (!item) return;
      if (item.kind === "lesson") onRemoveLesson(item.lesson.id);
      else onRemoveReservation(item.reservation);
    });
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      confirmDeleteKeys.forEach((key) => next.delete(key));
      return next;
    });
    if (draft) {
      const draftKey: ItemKey | null =
        draft.kind === "lesson" ? `lesson:${draft.value.id}` : draft.kind === "reservation" ? `reservation:${draft.value.id}` : null;
      if (draftKey && confirmDeleteKeys.includes(draftKey)) setDraft(null);
    }
    setConfirmDeleteKeys(null);
  }, [confirmDeleteKeys, draft, itemsByKey, onRemoveLesson, onRemoveReservation]);

  const selectionState = useMemo(() => {
    const total = items.length;
    const selectedCount = selectedInView.length;
    return {
      total,
      selectedCount,
      checked: total > 0 && selectedCount === total,
      indeterminate: selectedCount > 0 && selectedCount < total
    };
  }, [items.length, selectedInView.length]);

  const bulkState = useMemo<BulkState>(() => {
    return {
      selectAll: {
        checked: selectionState.checked,
        indeterminate: selectionState.indeterminate,
        onToggle: toggleAll
      },
      selectedCount: selectionState.selectedCount,
      totalCount: selectionState.total,
      actions: [
        { id: "new", label: "הוספה", icon: <AddIcon />, onClick: handleNew },
        {
          id: "edit",
          label: "עריכה",
          icon: <EditIcon />,
          disabled: selectionState.selectedCount !== 1,
          onClick: bulkEdit
        },
        {
          id: "duplicate",
          label: "שכפול",
          icon: <DuplicateIcon />,
          disabled: selectionState.selectedCount === 0,
          onClick: bulkDuplicate
        },
        {
          id: "delete",
          label: "מחיקה",
          icon: <ReleaseIcon />,
          tone: "danger",
          disabled: selectionState.selectedCount === 0,
          onClick: bulkDelete
        }
      ]
    };
  }, [bulkDelete, bulkDuplicate, bulkEdit, handleNew, selectionState.checked, selectionState.indeterminate, selectionState.selectedCount, selectionState.total, toggleAll]);

  useEffect(() => {
    onBulkStateChange?.(bulkState);
    return () => onBulkStateChange?.(null);
  }, [bulkState, onBulkStateChange]);

  const closeDraft = () => setDraft(null);

  const parseTimeValue = (value: string) => {
    const trimmed = value.trim();
    if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return null;
    const [hoursText, minutesText] = trimmed.split(":");
    const hours = Number(hoursText);
    const mins = Number(minutesText);
    if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
    if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
    return hours * 60 + mins;
  };

  const overlayTitle = useMemo(() => {
    if (!draft) return "";
    if (draft.kind === "lesson") return "פרטי שיעור";
    return reservationKindValue(draft.value) === "special"
      ? "פרטי אירוע"
      : reservationKindValue(draft.value) === "closed"
        ? "פרטי סגירה"
        : "פרטי שריון";
  }, [draft]);

  const overlayMeta = useMemo(() => {
    if (!draft) return null;
    if (draft.kind === "lesson") {
      return `${dayLabel(draft.value.day)} · ${toTimeInput(draft.value.startMinutes)} · ${roomLookup[draft.value.roomId] || draft.value.roomId}`;
    }
    return `${kindLabel(draft.value)} · ${draft.value.date} · ${toTimeInput(draft.value.time)} · ${roomLookup[draft.value.roomId] || draft.value.roomId}`;
  }, [dayLabel, draft, roomLookup, toTimeInput]);

  const lessonOverrides = useMemo(() => {
    if (!draft || draft.kind !== "lesson") return [];
    const lessonId = draft.value.id;
    if (!lessonId) return [];
    return overrides
      .filter((override) => {
        if (!override) return false;
        if (override.targetLessonId && override.targetLessonId === lessonId) return true;
        if (override.lesson?.id && override.lesson.id === lessonId) return true;
        return false;
      })
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [draft, overrides]);

  useEffect(() => {
    if (!draft || draft.kind !== "lesson") {
      setLessonOverridesOpen(false);
      setOverrideDraft(null);
      setConfirmRemoveOverride(null);
      return;
    }
    // Reset when switching lessons.
    setLessonOverridesOpen(false);
    setOverrideDraft(null);
    setConfirmRemoveOverride(null);
  }, [draft?.kind, draft && draft.kind === "lesson" ? draft.value.id : ""]);

  const overrideActionLabel = (action: LessonOverride["action"]) => {
    if (action === "add") return "הוספה";
    if (action === "update") return "עדכון";
    return "מחיקה";
  };

  const overrideSummary = (override: LessonOverride) => {
    const action = overrideActionLabel(override.action);
    if (override.action === "delete") {
      return `${action} · יעד: ${override.targetLessonId || "-"}`;
    }
    const lesson = override.lesson;
    if (!lesson) return `${action}`;
    const day = dayLabel(lesson.day);
    const room = roomLookup[lesson.roomId] || lesson.roomId;
    const start = toTimeInput(lesson.startMinutes);
    return `${action} · ${day} · ${room} · ${start} · ${lesson.durationMinutes} דק׳`;
  };

  const saveOverrideDraft = async () => {
    if (!overrideDraft) return;
    await upsertOverride(overrideDraft);
    setOverrideDraft(null);
  };

  const removeOverrideConfirmed = async () => {
    if (!confirmRemoveOverride) return;
    await removeOverride(confirmRemoveOverride.id);
    setConfirmRemoveOverride(null);
    if (overrideDraft?.id === confirmRemoveOverride.id) {
      setOverrideDraft(null);
    }
  };

  const updateDraft = () => {
    if (!draft) return;
    if (draft.kind === "lesson") {
      const id = draft.value.id || `${activeSemester}-${Date.now()}`;
      onUpsertLesson({ ...draft.value, id, semester: activeSemester });
      setDraft({ kind: "lesson", value: { ...draft.value, id, semester: activeSemester } });
      return;
    }
    onUpdateReservation(draft.value);
  };

  const duplicateDraft = () => {
    if (!draft) return;
    if (draft.kind === "lesson") {
      duplicateLesson(draft.value);
      return;
    }
    duplicateReservation(draft.value);
  };

  const deleteDraft = () => {
    if (!draft) return;
    const key: ItemKey = draft.kind === "lesson" ? `lesson:${draft.value.id}` : `reservation:${draft.value.id}`;
    setConfirmDeleteKeys([key]);
  };

  const headerTitle = "מערכת שעות";

  return (
    <section className="admin-section">
      <ConfirmDialog
        open={Boolean(confirmDeleteKeys?.length)}
        title="מחיקה"
        description={`למחוק ${confirmDeleteKeys?.length || 0} רשומות?`}
        confirmLabel="מחיקה"
        cancelLabel="ביטול"
        tone="danger"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteKeys(null)}
      />
      <ConfirmDialog
        open={Boolean(confirmRemoveOverride)}
        title="ביטול החרגה"
        description="לבטל את ההחרגה הזו?"
        confirmLabel="ביטול החרגה"
        cancelLabel="חזרה"
        tone="danger"
        onConfirm={() => { void removeOverrideConfirmed(); }}
        onCancel={() => setConfirmRemoveOverride(null)}
      />

      <PropsOverlay open={Boolean(draft)} title={overlayTitle} meta={overlayMeta} onClose={closeDraft}>
        {draft ? (
          <>
            {draft.kind === "lesson" ? (
              <>
                <div className="admin-inline" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <button
                    type="button"
                    className="admin-card-action"
                    onClick={() => setLessonOverridesOpen(true)}
                    disabled={!draft.value.id}
                    title={!draft.value.id ? "שמור/י את השיעור כדי לנהל החרגות" : "הצג החרגות"}
                  >
                    <TuneIcon />
                    הצג החרגות
                  </button>
                  <label>
                    סמסטר
                    <select
                      value={activeSemester}
                      onChange={(event) => {
                        const next = event.target.value as SemesterKey;
                        setActiveSemester(next);
                        setDraft({ kind: "lesson", value: { ...draft.value, semester: next } });
                      }}
                    >
                      <option value="A">סמסטר א׳</option>
                      <option value="B">סמסטר ב׳</option>
                    </select>
                  </label>
                </div>
                <div className="admin-form-grid">
                  <label>
                    שם שיעור
                    <input
                      type="text"
                      value={draft.value.title}
                      onChange={(event) =>
                        setDraft({ kind: "lesson", value: { ...draft.value, title: event.target.value } })
                      }
                    />
                  </label>
                  <label>
                    מרצה
                    <input
                      type="text"
                      value={draft.value.teacher}
                      onChange={(event) =>
                        setDraft({ kind: "lesson", value: { ...draft.value, teacher: event.target.value } })
                      }
                    />
                  </label>
                  <label>
                    יום
                    <select
                      value={draft.value.day}
                      onChange={(event) =>
                        setDraft({
                          kind: "lesson",
                          value: { ...draft.value, day: event.target.value as LessonRecord["day"] }
                        })
                      }
                    >
                      {weekDays.map((day) => (
                        <option key={day.key} value={day.key}>
                          {day.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    חדר
                    <select
                      value={draft.value.roomId}
                      onChange={(event) =>
                        setDraft({ kind: "lesson", value: { ...draft.value, roomId: event.target.value } })
                      }
                    >
                      {roomsRaw.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    התחלה
                    <input
                      type="time"
                      value={toTimeInput(draft.value.startMinutes)}
                      onChange={(event) =>
                        setDraft({
                          kind: "lesson",
                          value: { ...draft.value, startMinutes: parseTimeInput(event.target.value) }
                        })
                      }
                    />
                  </label>
                  <label>
                    משך (דקות)
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={draft.value.durationMinutes}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (!Number.isFinite(next)) return;
                        setDraft({
                          kind: "lesson",
                          value: { ...draft.value, durationMinutes: Math.max(1, Math.floor(next)) }
                        });
                      }}
                    />
                  </label>
                </div>
              </>
            ) : (
              <>
                <div className="admin-form-grid">
                  <label>
                    תאריך
                    <input
                      type="date"
                      value={draft.value.date}
                      onChange={(event) =>
                        setDraft({ kind: "reservation", value: { ...draft.value, date: event.target.value } })
                      }
                    />
                  </label>
                  <label>
                    התחלה
                    <input
                      type="time"
                      value={toTimeInput(draft.value.time)}
                      onChange={(event) => {
                        const nextStart = parseTimeValue(event.target.value);
                        if (nextStart === null) return;
                        setDraft({ kind: "reservation", value: { ...draft.value, time: nextStart } });
                      }}
                    />
                  </label>
                  <label>
                    סיום
                    <input
                      type="time"
                      value={toTimeInput(draft.value.time + (draft.value.durationMinutes || 60))}
                      onChange={(event) => {
                        const nextEnd = parseTimeValue(event.target.value);
                        if (nextEnd === null) return;
                        if (nextEnd < draft.value.time) return;
                        setDraft({
                          kind: "reservation",
                          value: { ...draft.value, durationMinutes: Math.max(1, nextEnd - draft.value.time) }
                        });
                      }}
                    />
                  </label>
                  <label>
                    חדר
                    <select
                      value={draft.value.roomId}
                      onChange={(event) =>
                        setDraft({ kind: "reservation", value: { ...draft.value, roomId: event.target.value } })
                      }
                    >
                      {roomsRaw.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    שם
                    <input
                      type="text"
                      value={draft.value.reservedBy}
                      onChange={(event) =>
                        setDraft({ kind: "reservation", value: { ...draft.value, reservedBy: event.target.value } })
                      }
                    />
                  </label>
                  <label>
                    אימייל
                    <input
                      type="email"
                      value={draft.value.reservedEmail}
                      onChange={(event) =>
                        setDraft({
                          kind: "reservation",
                          value: { ...draft.value, reservedEmail: event.target.value }
                        })
                      }
                    />
                  </label>
                  <label>
                    סוג
                    <select
                      value={reservationKindValue(draft.value)}
                      onChange={(event) => {
                        const value = event.target.value as "regular" | "special" | "closed";
                        setDraft({
                          kind: "reservation",
                          value: { ...draft.value, kind: value === "regular" ? undefined : value }
                        });
                      }}
                    >
                      <option value="regular">שריון</option>
                      <option value="special">אירוע</option>
                      <option value="closed">סגירה</option>
                    </select>
                  </label>
                </div>
              </>
            )}

            <div className="admin-actions">
              <button className="primary" type="button" onClick={updateDraft}>
                שמירה
              </button>
              <button className="secondary" type="button" onClick={duplicateDraft}>
                <DuplicateIcon />
                שכפול
              </button>
              <button className="danger" type="button" onClick={deleteDraft}>
                <ReleaseIcon />
                מחיקה
              </button>
            </div>
          </>
        ) : null}
      </PropsOverlay>

      {lessonOverridesOpen && draft?.kind === "lesson" ? (
        <div
          className="admin-tool-overlay admin-props-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            setLessonOverridesOpen(false);
            setOverrideDraft(null);
            setConfirmRemoveOverride(null);
          }}
        >
          <div className="admin-tool-overlay-card" onClick={(event) => event.stopPropagation()}>
            <button
              className="admin-tool-overlay-close"
              type="button"
              aria-label="סגור"
              onClick={() => {
                setLessonOverridesOpen(false);
                setOverrideDraft(null);
                setConfirmRemoveOverride(null);
              }}
            >
              <CloseIcon />
            </button>
            <div className="admin-tool-overlay-heading admin-props-overlay-heading">
              <div className="admin-props-overlay-titles">
                <h3>החרגות לשיעור</h3>
                <div className="admin-meta">
                  {draft.value.title || "שיעור"} · {draft.value.id}
                </div>
              </div>
            </div>

            {lessonOverrides.length ? (
              <div className="admin-table">
                {lessonOverrides.map((override) => (
                  <div key={override.id} className="admin-row">
                    <div className="admin-row-main">
                      <p className="admin-row-title">{override.date}</p>
                      <p className="admin-row-meta">{overrideSummary(override)}</p>
                    </div>
                    <div className="admin-row-actions">
                      <div className="admin-row-buttons">
                        <button
                          type="button"
                          className="admin-mini-action"
                          aria-label="עריכה"
                          onClick={() => setOverrideDraft(override)}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          className="admin-mini-action danger"
                          aria-label="ביטול החרגה"
                          onClick={() => setConfirmRemoveOverride(override)}
                        >
                          <ReleaseIcon />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="admin-meta">אין החרגות לשיעור הזה.</p>
            )}

            {overrideDraft ? (
              <div className="admin-card" style={{ marginTop: 14 }}>
                <div className="admin-card-header">
                  <h3>עריכת החרגה</h3>
                  <span className="admin-meta">{overrideDraft.id}</span>
                </div>
                <div className="admin-form-grid">
                  <label>
                    תאריך
                    <input
                      type="date"
                      value={overrideDraft.date}
                      onChange={(event) => setOverrideDraft({ ...overrideDraft, date: event.target.value })}
                    />
                  </label>
                  <label>
                    פעולה
                    <select
                      value={overrideDraft.action}
                      onChange={(event) => {
                        const action = event.target.value as LessonOverride["action"];
                        setOverrideDraft((prev) => (prev ? { ...prev, action } : prev));
                      }}
                    >
                      <option value="update">עדכון</option>
                      <option value="delete">מחיקה</option>
                      <option value="add">הוספה</option>
                    </select>
                  </label>
                  <label>
                    יעד (lesson id)
                    <input type="text" value={overrideDraft.targetLessonId || ""} disabled />
                  </label>
                </div>
                {overrideDraft.action === "delete" ? null : (
                  <div className="admin-form-grid">
                    <label>
                      שם שיעור
                      <input
                        type="text"
                        value={overrideDraft.lesson?.title || ""}
                        onChange={(event) =>
                          setOverrideDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  lesson: { ...(prev.lesson || draft.value), title: event.target.value }
                                }
                              : prev
                          )
                        }
                      />
                    </label>
                    <label>
                      מרצה
                      <input
                        type="text"
                        value={overrideDraft.lesson?.teacher || ""}
                        onChange={(event) =>
                          setOverrideDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  lesson: { ...(prev.lesson || draft.value), teacher: event.target.value }
                                }
                              : prev
                          )
                        }
                      />
                    </label>
                    <label>
                      יום
                      <select
                        value={overrideDraft.lesson?.day || draft.value.day}
                        onChange={(event) =>
                          setOverrideDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  lesson: { ...(prev.lesson || draft.value), day: event.target.value as LessonRecord["day"] }
                                }
                              : prev
                          )
                        }
                      >
                        {weekDays.map((day) => (
                          <option key={day.key} value={day.key}>
                            {day.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      חדר
                      <select
                        value={overrideDraft.lesson?.roomId || draft.value.roomId}
                        onChange={(event) =>
                          setOverrideDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  lesson: { ...(prev.lesson || draft.value), roomId: event.target.value }
                                }
                              : prev
                          )
                        }
                      >
                        {roomsRaw.map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      התחלה
                      <input
                        type="time"
                        value={toTimeInput(overrideDraft.lesson?.startMinutes ?? draft.value.startMinutes)}
                        onChange={(event) =>
                          setOverrideDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  lesson: { ...(prev.lesson || draft.value), startMinutes: parseTimeInput(event.target.value) }
                                }
                              : prev
                          )
                        }
                      />
                    </label>
                    <label>
                      משך (דקות)
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={overrideDraft.lesson?.durationMinutes ?? draft.value.durationMinutes}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (!Number.isFinite(next)) return;
                          setOverrideDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  lesson: { ...(prev.lesson || draft.value), durationMinutes: Math.max(1, Math.floor(next)) }
                                }
                              : prev
                          );
                        }}
                      />
                    </label>
                  </div>
                )}
                <div className="admin-actions">
                  <button className="primary" type="button" onClick={() => { void saveOverrideDraft(); }}>
                    שמירה
                  </button>
                  <button className="secondary" type="button" onClick={() => setOverrideDraft(null)}>
                    ביטול
                  </button>
                  <button className="danger" type="button" onClick={() => setConfirmRemoveOverride(overrideDraft)}>
                    ביטול החרגה
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="admin-section-toolbar">
        <div className="admin-filters-stack">
          <div className="admin-filters">
            <button
              type="button"
              className={`chip small${scheduleFilter === "all" ? " active" : ""}`}
              onClick={() => setScheduleFilter("all")}
            >
              הכל
            </button>
            <button
              type="button"
              className={`chip small${scheduleFilter === "lessons" ? " active" : ""}`}
              onClick={() => setScheduleFilter("lessons")}
            >
              שיעורים
            </button>
            <button
              type="button"
              className={`chip small${scheduleFilter === "regular" ? " active" : ""}`}
              onClick={() => setScheduleFilter("regular")}
            >
              שריונים
            </button>
            <button
              type="button"
              className={`chip small${scheduleFilter === "special" ? " active" : ""}`}
              onClick={() => setScheduleFilter("special")}
            >
              אירועים
            </button>
            <button
              type="button"
              className={`chip small${scheduleFilter === "closed" ? " active" : ""}`}
              onClick={() => setScheduleFilter("closed")}
            >
              סגירות
            </button>
          </div>
          {includesLessons ? (
            <div className="admin-filters">
              <button
                type="button"
                className={`chip small${activeSemester === "A" ? " active" : ""}`}
                onClick={() => setActiveSemester("A")}
              >
                סמסטר א׳
              </button>
              <button
                type="button"
                className={`chip small${activeSemester === "B" ? " active" : ""}`}
                onClick={() => setActiveSemester("B")}
              >
                סמסטר ב׳
              </button>
            </div>
          ) : null}
          <div className="admin-filter-controls">
            <label>
              חיפוש
              <input
                type="search"
                value={query}
                placeholder="כותרת / שם / אימייל / חדר"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {includesLessons ? (
              <label>
                יום
                <select value={dayFilter} onChange={(event) => setDayFilter(event.target.value as typeof dayFilter)}>
                  <option value="all">כל הימים</option>
                  {weekDays.map((day) => (
                    <option key={day.key} value={day.key}>
                      {day.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              חדר
              <select value={roomFilter} onChange={(event) => setRoomFilter(event.target.value)}>
                <option value="all">כל החדרים</option>
                {roomsRaw.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
            {includesReservations ? (
              <>
                <label>
                  מתאריך
                  <input type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} />
                </label>
                <label>
                  עד תאריך
                  <input type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} />
                </label>
              </>
            ) : null}
            <div className="admin-filter-meta" aria-label="כמות תוצאות">
              {items.length} תוצאות
            </div>
          </div>
        </div>
        {lessonsError || reservationsError ? <span className="admin-error">{lessonsError || reservationsError}</span> : null}
      </div>

      <div className="admin-section-body">
        <div className="admin-list">
          <div className="admin-card list-card">
            <div className="admin-card-header">
              <h3>{headerTitle}</h3>
            </div>

            {items.length ? (
              <div className="admin-table scroll tall">
                {items.map((item) => {
                  const checked = selectedKeys.has(item.key);
                  const title =
                    item.kind === "lesson"
                      ? item.lesson.title || "שיעור"
                      : item.reservation.reservedBy || item.reservation.reservedEmail || "ללא שם";
                  const meta =
                    item.kind === "lesson"
                      ? `שיעור · ${dayLabel(item.lesson.day)} · ${toTimeInput(item.lesson.startMinutes)} · ${item.lesson.durationMinutes} דק׳ · ${roomLookup[item.lesson.roomId] || item.lesson.roomId} · ${(item.lesson.teacher || "").trim() || "ללא מרצה"}`
                      : `${kindLabel(item.reservation)} · ${item.reservation.date} · ${toTimeInput(item.reservation.time)} · ${(item.reservation.durationMinutes || 60)} דק׳ · ${roomLookup[item.reservation.roomId] || item.reservation.roomId}`;

                  return (
                    <div
                      key={item.key}
                      className="admin-row clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => selectOne(item)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectOne(item);
                        }
                      }}
                    >
                      <input
                        type="checkbox"
                        className="admin-row-check"
                        checked={checked}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() =>
                          setSelectedKeys((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.key)) next.delete(item.key);
                            else next.add(item.key);
                            return next;
                          })
                        }
                        aria-label="בחר רשומה"
                      />
                      <div className="admin-row-main">
                        <p className="admin-row-title">{title}</p>
                        <p className="admin-row-meta">{meta}</p>
                        {item.kind === "reservation" && item.reservation.reservedEmail ? (
                          <p className="admin-row-meta">{item.reservation.reservedEmail}</p>
                        ) : null}
                      </div>
                      <div className="admin-row-actions">
                        <div className="admin-row-buttons">
                          <button
                            type="button"
                            className="admin-mini-action"
                            aria-label="עריכה"
                            onClick={(e) => {
                              e.stopPropagation();
                              selectOne(item);
                            }}
                          >
                            <EditIcon />
                          </button>
                          <button
                            type="button"
                            className="admin-mini-action"
                            aria-label="שכפול"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (item.kind === "lesson") duplicateLesson(item.lesson);
                              else duplicateReservation(item.reservation);
                            }}
                          >
                            <DuplicateIcon />
                          </button>
                          <button
                            type="button"
                            className="admin-mini-action danger"
                            aria-label="מחיקה"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteKeys([item.key]);
                            }}
                          >
                            <ReleaseIcon />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="admin-meta">אין רשומות להצגה.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
