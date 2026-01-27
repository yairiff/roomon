import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { LessonRecord, RoomRecord } from "../../../types/admin";
import type { SemesterKey } from "../../../types/ui";
import { weekDays } from "../../../config";
import { AddIcon, ApproveIcon, ReleaseIcon } from "../../../components/Icons";

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
};

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
  onReset
}: LessonsSectionProps) {
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isNewEntry, setIsNewEntry] = useState(false);

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
    onRemove(selectedLessonId);
    setSelectedLessonId(null);
    onReset();
    setIsEditing(false);
    setIsNewEntry(false);
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

  return (
    <section className="admin-section">
      <div className="admin-section-toolbar">
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
                    {weekDays.map((day) => (
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
              <button className="admin-card-action" type="button" onClick={handleNew}>
                <AddIcon />
                הוספה
              </button>
            </div>
            {lessons.length ? (
              <div className="admin-table scroll tall">
                {lessons.map((lesson) => (
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
                    <div>
                      <p className="admin-row-title">{lesson.title}</p>
                      <p className="admin-row-meta">
                        {lesson.teacher || "ללא מרצה"} · {weekDays.find((day) => day.key === lesson.day)?.label} · {toTimeInput(lesson.startMinutes)}
                      </p>
                    </div>
                    <div className="admin-row-actions">
                      <span className="chip small ghost">{roomLookup[lesson.roomId] || lesson.roomId}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="admin-meta">אין שיעורים בסמסטר הזה.</p>
            )}
          </div>
        </div>
      </div>

    </section>
  );
}
