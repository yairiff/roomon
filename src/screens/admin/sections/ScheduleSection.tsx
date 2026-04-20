import { useCallback, useEffect, useMemo, useState } from "react";
import { rimonScheduleConfig } from "../../../config";
import { weekDays } from "../../../config";
import type { LessonRecord, RoomRecord } from "../../../types/admin";
import type { Reservation } from "../../../types/reservations";
import type { BulkState } from "../bulk";
import { AddIcon, DuplicateIcon, EditIcon, ReleaseIcon } from "../../../components/Icons";
import ConfirmDialog from "../components/ConfirmDialog";
import FilterChip, { closeFilterChip } from "../components/FilterChip";
import ScheduleItemEditorOverlay from "./schedule/ScheduleItemEditorOverlay";
import RowSelectButton from "../components/RowSelectButton";
import SortSelect from "../components/SortSelect";

type ScheduleFilter = "all" | "lessons" | "regular" | "special" | "exam" | "closed";
type ScheduleSort = "time" | "room" | "title";

type ScheduleSectionProps = {
  scheduleFilter: ScheduleFilter;
  setScheduleFilter: (filter: ScheduleFilter) => void;
  query: string;
  activeSemester: string;
  setActiveSemester: (semester: string) => void;
  semesterOptions: { id: string; label: string; studyYear: number; letter: string }[];
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
  lessonsSyncEnabled?: boolean;
  isSyncedLesson?: (lesson: LessonRecord) => boolean;
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
  if (reservation.kind === "exam") return "מבחן";
  if (reservation.kind === "closed") return "סגירה";
  return "שריון";
};

const reservationKindValue = (reservation: Reservation) =>
  reservation.kind === "special"
    ? "special"
    : reservation.kind === "exam"
      ? "exam"
      : reservation.kind === "closed"
        ? "closed"
        : "regular";

const newReservationId = () =>
  (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `res-${Date.now()}-${Math.random().toString(16).slice(2)}`);

export default function ScheduleSection({
  scheduleFilter,
  setScheduleFilter,
  query,
  activeSemester,
  setActiveSemester,
  semesterOptions,
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
  lessonsSyncEnabled = false,
  isSyncedLesson = (lesson) => lesson.syncSource === "api",
  onBulkStateChange,
  onFilteredLessonsChange,
  onFilteredReservationsChange
}: ScheduleSectionProps) {
  const [roomFilter, setRoomFilter] = useState<string>("all");
  const [dayFilter, setDayFilter] = useState<LessonRecord["day"] | "all">("all");
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");
  const [sortBy, setSortBy] = useState<ScheduleSort>("time");
  const [selectedKeys, setSelectedKeys] = useState<Set<ItemKey>>(() => new Set());
  const [confirmDeleteKeys, setConfirmDeleteKeys] = useState<ItemKey[] | null>(null);

  const [draft, setDraft] = useState<
    | { kind: "choose"; value: { date: string; roomId: string; startMinutes: number; day: LessonRecord["day"] } }
    | { kind: "lesson"; value: LessonRecord }
    | { kind: "reservation"; value: Reservation }
    | null
  >(null);

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
    scheduleFilter === "all" ||
    scheduleFilter === "regular" ||
    scheduleFilter === "special" ||
    scheduleFilter === "exam" ||
    scheduleFilter === "closed";

  const sortLabel: Record<ScheduleSort, string> = {
    time: "זמן",
    room: "חדר",
    title: "כותרת"
  };
  const typeFilterOptions = useMemo(
    () => [
      { key: "all" as const, label: `הכל (${lessons.length + reservations.length})` },
      { key: "lessons" as const, label: `שיעורים (${lessons.length})` },
      {
        key: "regular" as const,
        label: `שריונים (${reservations.filter((entry) => !entry.kind).length})`
      },
      {
        key: "special" as const,
        label: `אירועים (${reservations.filter((entry) => entry.kind === "special").length})`
      },
      {
        key: "exam" as const,
        label: `מבחנים (${reservations.filter((entry) => entry.kind === "exam").length})`
      },
      {
        key: "closed" as const,
        label: `סגירות (${reservations.filter((entry) => entry.kind === "closed").length})`
      }
    ],
    [lessons.length, reservations]
  );

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
    const roomName = (lesson: LessonRecord) => (roomLookup[lesson.roomId] || lesson.roomId).trim();
    const byTime = (a: LessonRecord, b: LessonRecord) =>
      dayIndex(a.day) - dayIndex(b.day) || a.startMinutes - b.startMinutes;
    const byTitle = (a: LessonRecord, b: LessonRecord) => a.title.localeCompare(b.title, "he");
    const byRoom = (a: LessonRecord, b: LessonRecord) => roomName(a).localeCompare(roomName(b), "he");

    return [...list].sort((a, b) => {
      if (sortBy === "room") return byRoom(a, b) || byTime(a, b) || byTitle(a, b);
      if (sortBy === "title") return byTitle(a, b) || byTime(a, b) || byRoom(a, b);
      return byTime(a, b) || byRoom(a, b) || byTitle(a, b);
    });
  }, [dayFilter, dayLabel, includesLessons, lessons, query, roomFilter, roomLookup, sortBy]);

  const filteredReservations = useMemo(() => {
    if (!includesReservations) return [];
    let list = reservations;
    if (scheduleFilter === "regular") list = list.filter((r) => !r.kind);
    if (scheduleFilter === "special") list = list.filter((r) => r.kind === "special");
    if (scheduleFilter === "exam") list = list.filter((r) => r.kind === "exam");
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

    const roomName = (reservation: Reservation) => (roomLookup[reservation.roomId] || reservation.roomId).trim();
    const byTime = (a: Reservation, b: Reservation) => a.date.localeCompare(b.date) || a.time - b.time;
    const byTitle = (a: Reservation, b: Reservation) =>
      (a.reservedBy || "").localeCompare(b.reservedBy || "", "he") || kindLabel(a).localeCompare(kindLabel(b), "he");
    const byRoom = (a: Reservation, b: Reservation) => roomName(a).localeCompare(roomName(b), "he");

    return [...list].sort((a, b) => {
      if (sortBy === "room") return byRoom(a, b) || byTime(a, b) || byTitle(a, b);
      if (sortBy === "title") return byTitle(a, b) || byTime(a, b) || byRoom(a, b);
      return byTime(a, b) || byRoom(a, b) || byTitle(a, b);
    });
  }, [dateEnd, dateStart, includesReservations, query, reservations, roomFilter, roomLookup, scheduleFilter, sortBy]);

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
    return next;
  }, [filteredLessons, filteredReservations]);

  const itemsByKey = useMemo(() => {
    const map = new Map<ItemKey, ScheduleItem>();
    items.forEach((item) => map.set(item.key, item));
    return map;
  }, [items]);

  const selectedInView = useMemo(
    () => Array.from(selectedKeys).filter((key) => itemsByKey.has(key)),
    [itemsByKey, selectedKeys]
  );

  const selectionIncludesLockedLesson = useMemo(
    () =>
      selectedInView.some((key) => {
        const item = itemsByKey.get(key);
        return item?.kind === "lesson" && isSyncedLesson(item.lesson);
      }),
    [isSyncedLesson, itemsByKey, selectedInView]
  );

  const toggleAll = useCallback(() => {
    setSelectedKeys((prev) => {
      const keysInView = items.map((item) => item.key);
      if (!keysInView.length) return prev;
      const allSelected = keysInView.every((key) => prev.has(key));
      const next = new Set(prev);
      if (allSelected) {
        keysInView.forEach((key) => next.delete(key));
      } else {
        keysInView.forEach((key) => next.add(key));
      }
      return next;
    });
  }, [items]);

  const selectOne = useCallback((item: ScheduleItem) => {
    if (item.kind === "lesson") {
      setDraft({ kind: "lesson", value: { ...item.lesson, semester: item.lesson.semester || activeSemester } });
      return;
    }
    setDraft({
      kind: "reservation",
      value: { ...item.reservation, durationMinutes: item.reservation.durationMinutes || 60 }
    });
  }, [activeSemester]);

  const handleNew = useCallback(() => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const firstRoom = roomsRaw[0]?.id || "";
    const day = dayFilter !== "all" ? dayFilter : "sun";
    const base = {
      date,
      roomId: roomFilter !== "all" ? roomFilter : firstRoom,
      startMinutes: rimonScheduleConfig.startHour * 60,
      day
    };
    setDraft({ kind: "choose", value: base });
  }, [dayFilter, roomFilter, roomsRaw]);

  const bulkEdit = useCallback(() => {
    if (selectedInView.length !== 1) return;
    const item = itemsByKey.get(selectedInView[0]);
    if (item) selectOne(item);
  }, [itemsByKey, selectOne, selectedInView]);

  const duplicateLesson = useCallback((lesson: LessonRecord) => {
    if (isSyncedLesson(lesson)) return;
    const semesterId = lesson.semester || activeSemester || "semester";
    const newId = `${semesterId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const copy: LessonRecord = {
      ...lesson,
      id: newId,
      semester: semesterId,
      syncSource: "manual",
      title: lesson.title ? `${lesson.title} (עותק)` : "שיעור (עותק)"
    };
    onUpsertLesson(copy);
    setDraft({ kind: "lesson", value: copy });
  }, [activeSemester, isSyncedLesson, onUpsertLesson]);

  const duplicateReservation = useCallback((reservation: Reservation) => {
    const kind =
      reservation.kind === "special" || reservation.kind === "exam" || reservation.kind === "closed"
        ? reservation.kind
        : undefined;
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
    if (selectionIncludesLockedLesson) return;
    if (!selectedInView.length) return;
    setConfirmDeleteKeys(selectedInView);
  }, [selectedInView, selectionIncludesLockedLesson]);

  const confirmDelete = useCallback(() => {
    if (!confirmDeleteKeys?.length) return;
    confirmDeleteKeys.forEach((key) => {
      const item = itemsByKey.get(key);
      if (!item) return;
      if (item.kind === "lesson" && isSyncedLesson(item.lesson)) return;
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
  }, [confirmDeleteKeys, draft, isSyncedLesson, itemsByKey, onRemoveLesson, onRemoveReservation]);

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
          disabled: selectionState.selectedCount !== 1 || selectionIncludesLockedLesson,
          onClick: bulkEdit
        },
        {
          id: "duplicate",
          label: "שכפול",
          icon: <DuplicateIcon />,
          disabled: selectionState.selectedCount === 0 || selectionIncludesLockedLesson,
          onClick: bulkDuplicate
        },
        {
          id: "delete",
          label: "מחיקה",
          icon: <ReleaseIcon />,
          tone: "danger",
          disabled: selectionState.selectedCount === 0 || selectionIncludesLockedLesson,
          onClick: bulkDelete
        }
      ]
    };
  }, [bulkDelete, bulkDuplicate, bulkEdit, handleNew, selectionIncludesLockedLesson, selectionState.checked, selectionState.indeterminate, selectionState.selectedCount, selectionState.total, toggleAll]);

  useEffect(() => {
    onBulkStateChange?.(bulkState);
    return () => onBulkStateChange?.(null);
  }, [bulkState, onBulkStateChange]);

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
      <ScheduleItemEditorOverlay
        draft={draft}
        setDraft={setDraft}
        activeSemester={activeSemester}
        setActiveSemester={setActiveSemester}
        semesterOptions={semesterOptions}
        roomsRaw={roomsRaw}
        roomLookup={roomLookup}
        dayLabel={dayLabel}
        toTimeInput={toTimeInput}
        parseTimeInput={parseTimeInput}
        onUpsertLesson={onUpsertLesson}
        onUpdateReservation={onUpdateReservation}
        onDuplicateLesson={duplicateLesson}
        onDuplicateReservation={duplicateReservation}
        onRequestDeleteKeys={(keys) => setConfirmDeleteKeys(keys)}
        lessonsSyncEnabled={lessonsSyncEnabled}
      />

      <div className="admin-section-toolbar">
        <div className="admin-type-filter-row" aria-label="סוג רשומה">
          {typeFilterOptions.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`chip small${scheduleFilter === opt.key ? " active" : ""}`}
              onClick={() => setScheduleFilter(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="admin-filter-bar" aria-label="סינון ומיון">
          <div className="admin-filter-group scroll" aria-label="סינונים">
            {includesLessons ? (
              <FilterChip
                label="סמסטר"
                value={semesterOptions.find((option) => option.id === activeSemester)?.label || "בחר סמסטר"}
              >
                <div className="admin-filter-options">
                  {semesterOptions.length ? (
                    semesterOptions.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`admin-filter-option${activeSemester === option.id ? " active" : ""}`}
                        onClick={(event) => {
                          setActiveSemester(option.id);
                          closeFilterChip(event);
                        }}
                      >
                        {option.label}
                      </button>
                    ))
                  ) : (
                    <p className="admin-meta">אין סמסטרים מוגדרים.</p>
                  )}
                </div>
              </FilterChip>
            ) : null}

            {includesLessons ? (
              <FilterChip label="יום" value={dayFilter === "all" ? "כל הימים" : dayLabel(dayFilter)}>
                <div className="admin-filter-options">
                  <button
                    type="button"
                    className={`admin-filter-option${dayFilter === "all" ? " active" : ""}`}
                    onClick={(event) => {
                      setDayFilter("all");
                      closeFilterChip(event);
                    }}
                  >
                    כל הימים
                  </button>
                  {weekDays.map((day) => (
                    <button
                      key={day.key}
                      type="button"
                      className={`admin-filter-option${dayFilter === day.key ? " active" : ""}`}
                      onClick={(event) => {
                        setDayFilter(day.key);
                        closeFilterChip(event);
                      }}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </FilterChip>
            ) : null}

            <FilterChip label="חדר" value={roomFilter === "all" ? "כל החדרים" : (roomLookup[roomFilter] || roomFilter)}>
              <div className="admin-filter-options">
                <button
                  type="button"
                  className={`admin-filter-option${roomFilter === "all" ? " active" : ""}`}
                  onClick={(event) => {
                    setRoomFilter("all");
                    closeFilterChip(event);
                  }}
                >
                  כל החדרים
                </button>
                {roomsRaw.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    className={`admin-filter-option${roomFilter === room.id ? " active" : ""}`}
                    onClick={(event) => {
                      setRoomFilter(room.id);
                      closeFilterChip(event);
                    }}
                  >
                    {room.name}
                  </button>
                ))}
              </div>
            </FilterChip>

            {includesReservations ? (
              <FilterChip
                label="תאריכים"
                value={
                  dateStart || dateEnd
                    ? `${dateStart ? dateStart : "..."}–${dateEnd ? dateEnd : "..."}`
                    : "הכל"
                }
              >
                <div className="admin-filter-pop-grid">
                  <label className="admin-filter-field">
                    מתאריך
                    <input
                      className="admin-filter-input"
                      type="date"
                      value={dateStart}
                      onChange={(event) => setDateStart(event.target.value)}
                    />
                  </label>
                  <label className="admin-filter-field">
                    עד תאריך
                    <input
                      className="admin-filter-input"
                      type="date"
                      value={dateEnd}
                      onChange={(event) => setDateEnd(event.target.value)}
                    />
                  </label>
                  <div className="admin-filter-pop-actions">
                    <button
                      type="button"
                      className="admin-filter-option subtle"
                      onClick={(event) => {
                        setDateStart("");
                        setDateEnd("");
                        closeFilterChip(event);
                      }}
                    >
                      נקה
                    </button>
                  </div>
                </div>
              </FilterChip>
            ) : null}
          </div>

          <div className="admin-filter-group" aria-label="מיון">
            <SortSelect
              label="מיון"
              value={sortBy}
              options={(Object.keys(sortLabel) as ScheduleSort[]).map((key) => ({ value: key, label: sortLabel[key] }))}
              onChange={(value) => setSortBy(value as ScheduleSort)}
            />
          </div>
        </div>
        <div className="admin-filter-summary" aria-label="סיכום">
          <span className="admin-filter-summary-count">
            {selectedInView.length ? `${selectedInView.length} מתוך ${items.length} תוצאות` : `${items.length} תוצאות`}
          </span>
        </div>
        {lessonsSyncEnabled ? <span className="admin-meta">סנכרון שיעורים פעיל. אפשר לערוך שיעורים ידניים בלבד.</span> : null}
        {lessonsError || reservationsError ? <span className="admin-error">{lessonsError || reservationsError}</span> : null}
      </div>

      <div className="admin-section-body">
        <div className="admin-list">
          {items.length ? (
            <div className="admin-table scroll tall">
              {items.map((item) => {
                const checked = selectedKeys.has(item.key);
                const stripeClass =
                  item.kind === "lesson"
                    ? "lesson"
                    : item.reservation.kind === "special"
                      ? "special"
                      : item.reservation.kind === "exam"
                        ? "exam"
                      : item.reservation.kind === "closed"
                        ? "closed"
                        : "reservation";
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
                    <span className={`admin-row-stripe ${stripeClass}`} aria-hidden="true" />
                    <RowSelectButton
                      selected={checked}
                      label="בחר רשומה"
                      onToggle={() =>
                        setSelectedKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(item.key)) next.delete(item.key);
                          else next.add(item.key);
                          return next;
                        })
                      }
                    />
                    <div className="admin-row-main">
                      <p className="admin-row-title">
                        {title}
                        {item.kind === "lesson" ? (
                          <span className="admin-policy-pill">{isSyncedLesson(item.lesson) ? "מסונכרן" : "ידני"}</span>
                        ) : null}
                      </p>
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
                          disabled={item.kind === "lesson" && isSyncedLesson(item.lesson)}
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
                          disabled={item.kind === "lesson" && isSyncedLesson(item.lesson)}
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
                          disabled={item.kind === "lesson" && isSyncedLesson(item.lesson)}
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
    </section>
  );
}
