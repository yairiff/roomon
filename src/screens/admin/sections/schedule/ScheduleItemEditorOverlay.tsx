import { useEffect, useMemo, useState } from "react";
import { weekDays as weekDayOptions } from "../../../../config";
import type { LessonOverride, LessonRecord, RoomRecord } from "../../../../types/admin";
import type { SemesterKey } from "../../../../types/ui";
import type { Reservation } from "../../../../types/reservations";
import { useLessonOverrides } from "../../../../hooks/useLessonOverrides";
import ConfirmDialog from "../../components/ConfirmDialog";
import PropsOverlay from "../../components/PropsOverlay";
import { CloseIcon, DuplicateIcon, EditIcon, ReleaseIcon, TuneIcon } from "../../../../components/Icons";

type ItemKey = `lesson:${string}` | `reservation:${string}`;
type Draft =
  | { kind: "lesson"; value: LessonRecord }
  | { kind: "reservation"; value: Reservation }
  | null;

type ScheduleItemEditorOverlayProps = {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  activeSemester: SemesterKey;
  setActiveSemester: (semester: SemesterKey) => void;
  roomsRaw: RoomRecord[];
  roomLookup: Record<string, string>;
  dayLabel: (day: LessonRecord["day"]) => string;
  toTimeInput: (minutes: number) => string;
  parseTimeInput: (value: string) => number;
  onUpsertLesson: (lesson: LessonRecord) => void;
  onUpdateReservation: (reservation: Reservation) => void;
  onDuplicateLesson: (lesson: LessonRecord) => void;
  onDuplicateReservation: (reservation: Reservation) => void;
  onRequestDeleteKeys: (keys: ItemKey[]) => void;
};

const kindLabel = (reservation: Reservation) => {
  if (reservation.kind === "special") return "אירוע";
  if (reservation.kind === "closed") return "סגירה";
  return "שריון";
};

const reservationKindValue = (reservation: Reservation) =>
  reservation.kind === "special" ? "special" : reservation.kind === "closed" ? "closed" : "regular";

export default function ScheduleItemEditorOverlay({
  draft,
  setDraft,
  activeSemester,
  setActiveSemester,
  roomsRaw,
  roomLookup,
  dayLabel,
  toTimeInput,
  parseTimeInput,
  onUpsertLesson,
  onUpdateReservation,
  onDuplicateLesson,
  onDuplicateReservation,
  onRequestDeleteKeys
}: ScheduleItemEditorOverlayProps) {
  const closeDraft = () => setDraft(null);

  const overlayTitle = useMemo(() => {
    if (!draft) return "";
    if (draft.kind === "lesson") return draft.value.id ? "עריכת שיעור" : "שיעור חדש";
    if (draft.value.kind === "special") return "עריכת אירוע";
    if (draft.value.kind === "closed") return "עריכת סגירה";
    return draft.value.id ? "עריכת שריון" : "שריון חדש";
  }, [draft]);

  const overlayMeta = useMemo(() => {
    if (!draft) return null;
    if (draft.kind === "lesson") {
      return `${dayLabel(draft.value.day)} · ${toTimeInput(draft.value.startMinutes)} · ${roomLookup[draft.value.roomId] || draft.value.roomId}`;
    }
    return `${kindLabel(draft.value)} · ${draft.value.date} · ${toTimeInput(draft.value.time)} · ${roomLookup[draft.value.roomId] || draft.value.roomId}`;
  }, [dayLabel, draft, roomLookup, toTimeInput]);

  const parseTimeValue = (value: string) => {
    const trimmed = value.trim();
    if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return null;
    const minutes = parseTimeInput(trimmed);
    if (!Number.isFinite(minutes) || minutes < 0) return null;
    const [h, m] = trimmed.split(":").map((part) => Number(part));
    if (h > 23 || m > 59) return null;
    return minutes;
  };

  const { overrides, upsertOverride, removeOverride } = useLessonOverrides();
  const [lessonOverridesOpen, setLessonOverridesOpen] = useState(false);
  const [overrideDraft, setOverrideDraft] = useState<LessonOverride | null>(null);
  const [confirmRemoveOverride, setConfirmRemoveOverride] = useState<LessonOverride | null>(null);

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
      onDuplicateLesson(draft.value);
      return;
    }
    onDuplicateReservation(draft.value);
  };

  const deleteDraft = () => {
    if (!draft) return;
    const key: ItemKey = draft.kind === "lesson" ? `lesson:${draft.value.id}` : `reservation:${draft.value.id}`;
    onRequestDeleteKeys([key]);
  };

  return (
    <>
      <ConfirmDialog
        open={Boolean(confirmRemoveOverride)}
        title="ביטול החרגה"
        description="לבטל את ההחרגה הזו?"
        confirmLabel="ביטול החרגה"
        cancelLabel="חזרה"
        tone="danger"
        onConfirm={() => {
          void removeOverrideConfirmed();
        }}
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
                <p className="admin-meta" style={{ margin: "-2px 0 10px" }}>
                  עריכה כאן משנה את הסדרה הקבועה (כל שבוע).
                  <br />
                  לשינוי חד-פעמי בתאריך מסוים: השתמש/י ב״הצג החרגות״.
                </p>
                <div className="admin-form-grid">
                  <label>
                    שם שיעור
                    <input
                      type="text"
                      value={draft.value.title}
                      onChange={(event) => setDraft({ kind: "lesson", value: { ...draft.value, title: event.target.value } })}
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
                      {weekDayOptions.map((day) => (
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
                      onChange={(event) => setDraft({ kind: "lesson", value: { ...draft.value, roomId: event.target.value } })}
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
                      onChange={(event) => {
                        const nextStart = parseTimeValue(event.target.value);
                        if (nextStart === null) return;
                        setDraft({ kind: "lesson", value: { ...draft.value, startMinutes: nextStart } });
                      }}
                    />
                  </label>
                  <label>
                    משך (דקות)
                    <input
                      type="number"
                      min={1}
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
                      onChange={(event) => setDraft({ kind: "reservation", value: { ...draft.value, date: event.target.value } })}
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
                      onChange={(event) => setDraft({ kind: "reservation", value: { ...draft.value, roomId: event.target.value } })}
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
            <p className="admin-meta" style={{ marginTop: -4 }}>
              החרגה חלה על תאריך ספציפי בלבד, ולא משנה את הסדרה הקבועה. אפשר לעדכן, למחוק ליום הזה, או להוסיף מופע חד-פעמי.
            </p>

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
                <p className="admin-meta" style={{ margin: "0 0 8px" }}>
                  עדכון: משנה את השיעור בתאריך הזה · מחיקה: מסתיר את השיעור בתאריך הזה · הוספה: מוסיף שיעור חדש בתאריך הזה.
                </p>
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
                            prev ? { ...prev, lesson: { ...(prev.lesson || draft.value), title: event.target.value } } : prev
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
                            prev ? { ...prev, lesson: { ...(prev.lesson || draft.value), teacher: event.target.value } } : prev
                          )
                        }
                      />
                    </label>
                    <label>
                      חדר
                      <select
                        value={overrideDraft.lesson?.roomId || draft.value.roomId}
                        onChange={(event) =>
                          setOverrideDraft((prev) =>
                            prev ? { ...prev, lesson: { ...(prev.lesson || draft.value), roomId: event.target.value } } : prev
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
                        onChange={(event) => {
                          const minutes = parseTimeValue(event.target.value);
                          if (minutes === null) return;
                          setOverrideDraft((prev) =>
                            prev ? { ...prev, lesson: { ...(prev.lesson || draft.value), startMinutes: minutes } } : prev
                          );
                        }}
                      />
                    </label>
                    <label>
                      משך (דקות)
                      <input
                        type="number"
                        min={1}
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
                  <button className="primary" type="button" onClick={() => void saveOverrideDraft()}>
                    שמירה
                  </button>
                  <button className="secondary" type="button" onClick={() => setOverrideDraft(null)}>
                    סגירה
                  </button>
                </div>
              </div>
            ) : (
              <div className="admin-actions" style={{ marginTop: 12 }}>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    const baseLesson = draft.value;
                    const id = `override_${baseLesson.id || Date.now()}`;
                    setOverrideDraft({
                      id,
                      date: new Date().toISOString().slice(0, 10),
                      action: "update",
                      targetLessonId: baseLesson.id,
                      lesson: { ...baseLesson }
                    });
                  }}
                  disabled={!draft.value.id}
                >
                  הוספת החרגה
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

