import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { LessonRecord, RoomRecord } from "../../../types/admin";
import type { SemesterKey } from "../../../types/ui";
import { allWeekDays } from "../../../config";
import { AddIcon, ApproveIcon, DuplicateIcon, EditIcon, ReleaseIcon } from "../../../components/Icons";
import ConfirmDialog from "../components/ConfirmDialog";

type LessonsSectionProps = {
  lessons: LessonRecord[];
  lessonsError: string;
  activeSemester: SemesterKey;
  setActiveSemester: Dispatch<SetStateAction<SemesterKey>>;
  lessonDraft: LessonRecord;
  setLessonDraft: Dispatch<SetStateAction<LessonRecord>>;
  roomsRaw: RoomRecord[];
  toTimeInput: (minutes: number) => string;
  parseTimeInput: (value: string) => number;
  onUpsert: (lesson: LessonRecord) => void;
  onRemove: (lessonId: string) => void;
  onReset: () => void;
  onFilteredLessonsChange?: (lessons: LessonRecord[]) => void;
};

type LessonSort = "day_time" | "title" | "teacher" | "room";

export default function LessonsSection({
  lessons,
  lessonsError,
  activeSemester,
  setActiveSemester,
  lessonDraft,
  setLessonDraft,
  roomsRaw,
  toTimeInput,
  parseTimeInput,
  onUpsert,
  onRemove,
  onReset,
  onFilteredLessonsChange
}: LessonsSectionProps) {
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isNewEntry, setIsNewEntry] = useState(false);
  const [query, setQuery] = useState("");
  const [dayFilter, setDayFilter] = useState<LessonRecord["day"] | "all">("all");
  const [roomFilter, setRoomFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<LessonSort>("day_time");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const roomLookup = useMemo(() => {
    const lookup: Record<string, string> = {};
    roomsRaw.forEach((room) => {
      lookup[room.id] = room.name;
    });
    return lookup;
  }, [roomsRaw]);

  const selectedLesson = useMemo(() =>
    (selectedLessonId ? lessons.find((lesson) => lesson.id === selectedLessonId) || null : null),
  [lessons, selectedLessonId]);

  const filteredLessons = useMemo(() => {
    let list = lessons;
    if (dayFilter !== "all") list = list.filter((lesson) => lesson.day === dayFilter);
    if (roomFilter !== "all") list = list.filter((lesson) => lesson.roomId === roomFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((lesson) => {
        const roomName = roomLookup[lesson.roomId] || lesson.roomId;
        const dayLabel = allWeekDays.find((day) => day.key === lesson.day)?.label || lesson.day;
        const haystack = [lesson.title, lesson.teacher || "", roomName, dayLabel].join(" ").toLowerCase();
        return haystack.includes(q);
      });
    }

    const dayIndex = (dayKey: LessonRecord["day"]) => allWeekDays.findIndex((day) => day.key === dayKey);

    return [...list].sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title, "he");
      if (sortBy === "teacher") return (a.teacher || "").localeCompare(b.teacher || "", "he") || a.title.localeCompare(b.title, "he");
      if (sortBy === "room") {
        const aRoom = roomLookup[a.roomId] || a.roomId;
        const bRoom = roomLookup[b.roomId] || b.roomId;
        return aRoom.localeCompare(bRoom, "he") || dayIndex(a.day) - dayIndex(b.day) || a.startMinutes - b.startMinutes;
      }
      // day_time
      return dayIndex(a.day) - dayIndex(b.day) || a.startMinutes - b.startMinutes || a.title.localeCompare(b.title, "he");
    });
  }, [dayFilter, lessons, query, roomFilter, roomLookup, sortBy]);

  const filteredById = useMemo(() => {
    const map = new Map<string, LessonRecord>();
    filteredLessons.forEach((lesson) => map.set(lesson.id, lesson));
    return map;
  }, [filteredLessons]);

  const selectedInView = useMemo(() => {
    const ids = Array.from(selectedIds).filter((id) => filteredById.has(id));
    return ids;
  }, [filteredById, selectedIds]);

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    const total = filteredLessons.length;
    const selectedCount = selectedInView.length;
    el.indeterminate = selectedCount > 0 && selectedCount < total;
  }, [filteredLessons.length, selectedInView.length]);

  useEffect(() => {
    onFilteredLessonsChange?.(filteredLessons);
  }, [filteredLessons, onFilteredLessonsChange]);

  const handleSelect = (lesson: LessonRecord) => {
    setSelectedLessonId(lesson.id);
    setLessonDraft({ ...lesson, semester: activeSemester });
    setIsEditing(true);
    setIsNewEntry(false);
  };

  const handleNew = () => {
    setSelectedLessonId(null);
    onReset();
    setIsEditing(true);
    setIsNewEntry(true);
  };

  const handleUpdate = () => {
    const id = lessonDraft.id || `${activeSemester}-${Date.now()}`;
    onUpsert({ ...lessonDraft, id, semester: activeSemester });
    setSelectedLessonId(id);
  };

  const handleDelete = () => {
    if (!selectedLessonId) return;
    setConfirmDeleteIds([selectedLessonId]);
  };

  const handleDuplicate = () => {
    if (!selectedLessonId) return;
    const newId = `${activeSemester}-${Date.now()}`;
    const copy = { ...lessonDraft, id: newId, semester: activeSemester };
    onUpsert(copy);
    setLessonDraft(copy);
    setSelectedLessonId(newId);
    setIsEditing(true);
    setIsNewEntry(false);
  };

  const lessonStatus = isEditing ? (selectedLesson?.title || "חדש") : "";

  const duplicateLesson = (lesson: LessonRecord) => {
    const newId = `${activeSemester}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const copy = {
      ...lesson,
      id: newId,
      semester: activeSemester,
      title: lesson.title ? `${lesson.title} (עותק)` : "שיעור (עותק)"
    };
    onUpsert(copy);
    setSelectedLessonId(newId);
    setLessonDraft(copy);
    setIsEditing(true);
    setIsNewEntry(false);
  };

  const bulkSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredLessons.forEach((lesson) => next.add(lesson.id));
      return next;
    });
  };

  const bulkClear = () => setSelectedIds(new Set());

  const bulkToggleAll = () => {
    if (selectedInView.length && selectedInView.length === filteredLessons.length) {
      bulkClear();
      return;
    }
    bulkSelectAll();
  };

  const bulkEdit = () => {
    if (selectedInView.length !== 1) return;
    const lesson = filteredById.get(selectedInView[0]);
    if (!lesson) return;
    handleSelect(lesson);
  };

  const bulkDuplicate = () => {
    if (!selectedInView.length) return;
    selectedInView.forEach((id) => {
      const lesson = filteredById.get(id);
      if (lesson) duplicateLesson(lesson);
    });
  };

  const bulkDelete = () => {
    if (!selectedInView.length) return;
    setConfirmDeleteIds(selectedInView);
  };

  const confirmDelete = () => {
    if (!confirmDeleteIds?.length) return;
    confirmDeleteIds.forEach((id) => onRemove(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      confirmDeleteIds.forEach((id) => next.delete(id));
      return next;
    });
    if (selectedLessonId && confirmDeleteIds.includes(selectedLessonId)) {
      setSelectedLessonId(null);
      onReset();
      setIsEditing(false);
      setIsNewEntry(false);
    }
    setConfirmDeleteIds(null);
  };

  return (
    <section className="admin-section">
      <ConfirmDialog
        open={Boolean(confirmDeleteIds?.length)}
        title="מחיקת שיעורים"
        description={`למחוק ${confirmDeleteIds?.length || 0} שיעורים?`}
        confirmLabel="מחיקה"
        cancelLabel="ביטול"
        tone="danger"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteIds(null)}
      />
      <div className="admin-section-toolbar">
        <div className="admin-filters-stack">
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
          <div className="admin-filter-controls">
            <label>
              חיפוש
              <input
                type="search"
                value={query}
                placeholder="שם שיעור / מרצה / חדר"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              יום
              <select value={dayFilter} onChange={(event) => setDayFilter(event.target.value as typeof dayFilter)}>
                <option value="all">כל הימים</option>
                {allWeekDays.map((day) => (
                  <option key={day.key} value={day.key}>{day.label}</option>
                ))}
              </select>
            </label>
            <label>
              חדר
              <select value={roomFilter} onChange={(event) => setRoomFilter(event.target.value)}>
                <option value="all">כל החדרים</option>
                {roomsRaw.map((room) => (
                  <option key={room.id} value={room.id}>{room.name}</option>
                ))}
              </select>
            </label>
            <label>
              מיון
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as LessonSort)}>
                <option value="day_time">יום + שעה</option>
                <option value="title">שם שיעור</option>
                <option value="teacher">מרצה</option>
                <option value="room">חדר</option>
              </select>
            </label>
            <div className="admin-filter-meta" aria-label="כמות תוצאות">
              {filteredLessons.length} תוצאות
            </div>
          </div>
        </div>
        {lessonsError ? <span className="admin-error">{lessonsError}</span> : null}
      </div>
      <div className="admin-section-body">
        <aside className="admin-properties">
          <div className="admin-card">
            <div className="admin-card-header">
              <h3>פרטי שיעור</h3>
              {lessonStatus ? <span className="admin-meta">{lessonStatus}</span> : null}
            </div>
            <fieldset className="admin-fieldset" disabled={!isEditing}>
              <div className="admin-inline">
                <label>
                  סמסטר
                  <select
                    value={activeSemester}
                    onChange={(event) => {
                      const next = event.target.value as SemesterKey;
                      setActiveSemester(next);
                      setLessonDraft((prev) => ({ ...prev, semester: next }));
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
                    value={lessonDraft.title}
                    onChange={(event) => setLessonDraft((prev) => ({ ...prev, title: event.target.value }))}
                  />
                </label>
                <label>
                  מרצה
                  <input
                    type="text"
                    value={lessonDraft.teacher}
                    onChange={(event) => setLessonDraft((prev) => ({ ...prev, teacher: event.target.value }))}
                  />
                </label>
                <label>
                  יום
                  <select
                    value={lessonDraft.day}
                    onChange={(event) =>
                      setLessonDraft((prev) => ({ ...prev, day: event.target.value as LessonRecord["day"] }))
                    }
                  >
                    {allWeekDays.map((day) => (
                      <option key={day.key} value={day.key}>{day.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  חדר
                  <select
                    value={lessonDraft.roomId}
                    onChange={(event) => setLessonDraft((prev) => ({ ...prev, roomId: event.target.value }))}
                  >
                    {roomsRaw.map((room) => (
                      <option key={room.id} value={room.id}>{room.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  שעת התחלה
                  <input
                    type="time"
                    value={toTimeInput(lessonDraft.startMinutes)}
                    onChange={(event) =>
                      setLessonDraft((prev) => ({ ...prev, startMinutes: parseTimeInput(event.target.value) }))
                    }
                  />
                </label>
                <label>
                  משך (דקות)
                  <input
                    type="number"
                    min={15}
                    step={15}
                    value={lessonDraft.durationMinutes}
                    onChange={(event) => setLessonDraft((prev) => ({ ...prev, durationMinutes: Number(event.target.value) }))}
                  />
                </label>
              </div>
              <div className="admin-actions">
                <button className="primary" type="button" onClick={handleUpdate} disabled={!isEditing}>
                  <ApproveIcon />
                  {isNewEntry ? "הוספה" : "עדכון"}
                </button>
                <button
                  className="secondary"
                  type="button"
                  onClick={handleDuplicate}
                  disabled={!selectedLessonId}
                >
                  <AddIcon />
                  שכפול
                </button>
                <button
                  className="secondary danger"
                  type="button"
                  onClick={handleDelete}
                  disabled={!selectedLessonId}
                >
                  <ReleaseIcon />
                  מחיקה
                </button>
              </div>
            </fieldset>
          </div>
        </aside>
        <div className="admin-list">
          <div className="admin-card list-card">
            <div className="admin-card-header">
              <h3>רשימת שיעורים</h3>
            </div>
            <div className="admin-list-toolbar">
              <div className="admin-list-toolbar-left">
                <label className="admin-select-all">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="admin-row-check"
                    checked={filteredLessons.length > 0 && selectedInView.length === filteredLessons.length}
                    onChange={bulkToggleAll}
                  />
                  <span>בחירה</span>
                </label>
                <span className="admin-meta">
                  {selectedInView.length ? `${selectedInView.length} נבחרו` : `${filteredLessons.length} תוצאות`}
                </span>
              </div>
              <div className="admin-list-toolbar-right">
                <button className="admin-card-action" type="button" onClick={handleNew}>
                  <AddIcon />
                  הוספה
                </button>
                <button className="admin-card-action" type="button" onClick={bulkEdit} disabled={selectedInView.length !== 1}>
                  <EditIcon />
                  עריכה
                </button>
                <button className="admin-card-action" type="button" onClick={bulkDuplicate} disabled={!selectedInView.length}>
                  <DuplicateIcon />
                  שכפול
                </button>
                <button className="admin-card-action" type="button" onClick={bulkDelete} disabled={!selectedInView.length}>
                  <ReleaseIcon />
                  מחיקה
                </button>
              </div>
            </div>
            {filteredLessons.length ? (
              <div className="admin-table scroll tall">
                {filteredLessons.map((lesson) => (
                  <div
                    key={lesson.id}
                    className={`admin-row clickable${selectedLessonId === lesson.id ? " selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelect(lesson)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleSelect(lesson);
                      }
                    }}
                  >
                    <input
                      type="checkbox"
                      className="admin-row-check"
                      checked={selectedIds.has(lesson.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() =>
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(lesson.id)) next.delete(lesson.id);
                          else next.add(lesson.id);
                          return next;
                        })
                      }
                      aria-label="בחר שיעור"
                    />
                    <div className="admin-row-main">
                      <p className="admin-row-title">{lesson.title}</p>
                      <p className="admin-row-meta">
                        {lesson.teacher || "ללא מרצה"} · {allWeekDays.find((day) => day.key === lesson.day)?.label} · {toTimeInput(lesson.startMinutes)}
                      </p>
                    </div>
                    <div className="admin-row-actions">
                      <div className="admin-row-buttons">
                        <button
                          type="button"
                          className="admin-mini-action"
                          aria-label="עריכה"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelect(lesson);
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
                            duplicateLesson(lesson);
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
                            setConfirmDeleteIds([lesson.id]);
                          }}
                        >
                          <ReleaseIcon />
                        </button>
                      </div>
                      <span className="chip small ghost">{roomLookup[lesson.roomId] || lesson.roomId}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="admin-meta">אין שיעורים במסנן הזה.</p>
            )}
          </div>
        </div>
      </div>

    </section>
  );
}
