import { useEffect, useMemo, useState } from "react";
import { rimonScheduleConfig, weekDays as weekDayOptions } from "../../../../config";
import type { LessonOverride, LessonRecord, RoomRecord } from "../../../../types/admin";
import type { Reservation } from "../../../../types/reservations";
import { useLessonOverrides } from "../../../../hooks/useLessonOverrides";
import { buildYearlySemesterId, parseYearlySemesterId } from "../../../../lib/semesterScope";
import ConfirmDialog from "../../components/ConfirmDialog";
import PropsOverlay from "../../components/PropsOverlay";
import {
  CloseIcon,
  ClosedIcon,
  DuplicateIcon,
  EditIcon,
  ExamTypeIcon,
  LessonTypeIcon,
  ReleaseIcon,
  ReservationIcon,
  SpecialIcon,
  TuneIcon
} from "../../../../components/Icons";

type ItemKey = `lesson:${string}` | `reservation:${string}`;
type Draft =
  | { kind: "choose"; value: { date: string; roomId: string; startMinutes: number; day: LessonRecord["day"] } }
  | { kind: "lesson"; value: LessonRecord }
  | { kind: "reservation"; value: Reservation }
  | null;

type ScheduleItemEditorOverlayProps = {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  activeSemester: string;
  setActiveSemester: (semester: string) => void;
  semesterOptions: { id: string; label: string; studyYear: number; letter: string }[];
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
  lessonsSyncEnabled?: boolean;
};

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

const formatAcademicYearLabel = (studyYear: number) => {
  const nextYear = String((studyYear + 1) % 100).padStart(2, "0");
  return `${studyYear}/${nextYear}`;
};

const isPrimarySemesterLetter = (letter: string) => {
  const normalized = letter.trim();
  return normalized === "א" || normalized === "ב" || normalized.toUpperCase() === "A" || normalized.toUpperCase() === "B";
};

export default function ScheduleItemEditorOverlay({
  draft,
  setDraft,
  activeSemester,
  setActiveSemester,
  semesterOptions,
  roomsRaw,
  roomLookup,
  dayLabel,
  toTimeInput,
  parseTimeInput,
  onUpsertLesson,
  onUpdateReservation,
  onDuplicateLesson,
  onDuplicateReservation,
  onRequestDeleteKeys,
  lessonsSyncEnabled = false
}: ScheduleItemEditorOverlayProps) {
  const closeDraft = () => setDraft(null);

  const overlayTitle = useMemo(() => {
    if (!draft) return "";
    if (draft.kind === "choose") return "הוספה";
    if (draft.kind === "lesson") return draft.value.id ? "עריכת שיעור" : "שיעור חדש";
    if (draft.value.kind === "special") return "עריכת אירוע";
    if (draft.value.kind === "exam") return "עריכת מבחן";
    if (draft.value.kind === "closed") return "עריכת סגירה";
    return draft.value.id ? "עריכת שריון" : "שריון חדש";
  }, [draft]);

  const overlayMeta = useMemo(() => {
    if (!draft) return null;
    if (draft.kind === "choose") {
      return `${draft.value.date} · ${toTimeInput(draft.value.startMinutes)} · ${roomLookup[draft.value.roomId] || draft.value.roomId}`;
    }
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
  const semesterOptionById = useMemo(
    () =>
      semesterOptions.reduce<Record<string, { id: string; label: string; studyYear: number; letter: string }>>(
        (acc, option) => {
          acc[option.id] = option;
          return acc;
        },
        {}
      ),
    [semesterOptions]
  );
  const lessonSemesterSelectOptions = useMemo(() => {
    const yearlyByYear = new Map<number, { id: string; label: string; studyYear: number; letter: string }>();
    semesterOptions.forEach((option) => {
      if (!isPrimarySemesterLetter(option.letter || "")) return;
      if (!yearlyByYear.has(option.studyYear)) {
        yearlyByYear.set(option.studyYear, {
          id: buildYearlySemesterId(option.studyYear),
          label: `שנתי · ${formatAcademicYearLabel(option.studyYear)}`,
          studyYear: option.studyYear,
          letter: "שנתי"
        });
      }
    });
    return [...semesterOptions, ...Array.from(yearlyByYear.values())];
  }, [semesterOptions]);

  const { overrides, upsertOverride, removeOverride } = useLessonOverrides();
  const [lessonOverridesOpen, setLessonOverridesOpen] = useState(false);
  const [overrideDraft, setOverrideDraft] = useState<LessonOverride | null>(null);
  const [confirmRemoveOverride, setConfirmRemoveOverride] = useState<LessonOverride | null>(null);
  const [draftError, setDraftError] = useState("");

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

  useEffect(() => {
    setDraftError("");
  }, [draft]);

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
    setDraftError("");
    if (draft.kind === "choose") {
      setDraftError("יש לבחור סוג רשומה.");
      return;
    }
    if (draft.kind === "lesson") {
      if (draft.value.syncSource === "api") {
        setDraftError("שיעור מסונכרן מנוהל דרך ה-API ואינו ניתן לעריכה ידנית.");
        return;
      }
      if (!draft.value.title.trim()) {
        setDraftError("יש להזין שם שיעור.");
        return;
      }
      const semesterId = draft.value.semester || activeSemester;
      if (!semesterId) {
        setDraftError("יש לבחור סמסטר לשיעור.");
        return;
      }
      const id = draft.value.id || `${semesterId}-${Date.now()}`;
      onUpsertLesson({ ...draft.value, id, semester: semesterId });
      setDraft({ kind: "lesson", value: { ...draft.value, id, semester: semesterId } });
      return;
    }
    const specialKind = draft.value.kind === "special" || draft.value.kind === "closed";
    if (specialKind) {
      if (!draft.value.reservedBy.trim()) {
        setDraftError(draft.value.kind === "special" ? "יש להזין תיאור אירוע." : "יש להזין תיאור סגירה.");
        return;
      }
    } else if (draft.value.kind === "exam") {
      if (!draft.value.reservedBy.trim()) {
        setDraftError("יש להזין תיאור מבחן.");
        return;
      }
    } else if (!draft.value.reservedEmail.trim()) {
      setDraftError("יש להזין אימייל.");
      return;
    }
    onUpdateReservation(draft.value);
  };

  const duplicateDraft = () => {
    if (!draft) return;
    if (draft.kind === "choose") return;
    if (draft.kind === "lesson") {
      if (draft.value.syncSource === "api") return;
      onDuplicateLesson(draft.value);
      return;
    }
    onDuplicateReservation(draft.value);
  };

  const deleteDraft = () => {
    if (!draft) return;
    if (draft.kind === "choose") return;
    if (draft.kind === "lesson" && draft.value.syncSource === "api") return;
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
            {draft.kind === "choose" ? (
              <div className="admin-card">
                <p className="admin-meta hint center" style={{ margin: "0 0 10px" }}>
                  בחר/י סוג רשומה להוספה:
                </p>
                <div className="admin-type-grid">
                  <button
                    type="button"
                    className="admin-type-card lesson"
                    onClick={() => {
                      const base: LessonRecord = {
                        id: "",
                        title: "",
                        teacher: "",
                        day: draft.value.day,
                        roomId: draft.value.roomId,
                        startMinutes: draft.value.startMinutes,
                        durationMinutes: rimonScheduleConfig.academicHourMinutes,
                        semester: activeSemester || semesterOptions[0]?.id || ""
                      };
                      setDraft({ kind: "lesson", value: base });
                    }}
                  >
                    <LessonTypeIcon />
                    <span>שיעור</span>
                  </button>
                  <button
                    type="button"
                    className="admin-type-card reservation"
                    onClick={() => {
                      const base: Reservation = {
                        id: newReservationId(),
                        date: draft.value.date,
                        time: draft.value.startMinutes,
                        durationMinutes: 60,
                        roomId: draft.value.roomId,
                        reservedBy: "",
                        reservedEmail: ""
                      };
                      setDraft({ kind: "reservation", value: base });
                    }}
                  >
                    <ReservationIcon />
                    <span>שריון</span>
                  </button>
                  <button
                    type="button"
                    className="admin-type-card special"
                    onClick={() => {
                      const base: Reservation = {
                        id: newReservationId(),
                        date: draft.value.date,
                        time: draft.value.startMinutes,
                        durationMinutes: 60,
                        roomId: draft.value.roomId,
                        reservedBy: "",
                        reservedEmail: "",
                        kind: "special"
                      };
                      setDraft({ kind: "reservation", value: base });
                    }}
                  >
                    <SpecialIcon />
                    <span>אירוע</span>
                  </button>
                  <button
                    type="button"
                    className="admin-type-card exam"
                    onClick={() => {
                      const base: Reservation = {
                        id: newReservationId(),
                        date: draft.value.date,
                        time: draft.value.startMinutes,
                        durationMinutes: 60,
                        roomId: draft.value.roomId,
                        reservedBy: "",
                        reservedEmail: "",
                        kind: "exam"
                      };
                      setDraft({ kind: "reservation", value: base });
                    }}
                  >
                    <ExamTypeIcon />
                    <span>מבחן</span>
                  </button>
                  <button
                    type="button"
                    className="admin-type-card closed"
                    onClick={() => {
                      const base: Reservation = {
                        id: newReservationId(),
                        date: draft.value.date,
                        time: draft.value.startMinutes,
                        durationMinutes: 60,
                        roomId: draft.value.roomId,
                        reservedBy: "",
                        reservedEmail: "",
                        kind: "closed"
                      };
                      setDraft({ kind: "reservation", value: base });
                    }}
                  >
                    <ClosedIcon />
                    <span>סגירה</span>
                  </button>
                </div>
              </div>
            ) : draft.kind === "lesson" ? (
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
                      value={draft.value.semester || activeSemester}
                      onChange={(event) => {
                        const next = event.target.value;
                        if (semesterOptionById[next]) {
                          setActiveSemester(next);
                        }
                        setDraft({ kind: "lesson", value: { ...draft.value, semester: next } });
                      }}
                      disabled={draft.value.syncSource === "api"}
                    >
                      {lessonSemesterSelectOptions.length ? (
                        lessonSemesterSelectOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))
                      ) : (
                        <option value="">אין סמסטרים</option>
                      )}
                      {!lessonSemesterSelectOptions.some(
                        (option) => option.id === (draft.value.semester || activeSemester)
                      ) &&
                      (() => {
                        const selectedId = draft.value.semester || activeSemester;
                        const selectedYearly = parseYearlySemesterId(selectedId);
                        if (selectedYearly === undefined) return false;
                        return true;
                      })() ? (
                        <option value={draft.value.semester || activeSemester}>
                          שנתי · {formatAcademicYearLabel(parseYearlySemesterId(draft.value.semester || activeSemester) || new Date().getFullYear())}
                        </option>
                      ) : null}
                    </select>
                  </label>
                </div>
                <p className="admin-meta hint center" style={{ margin: "-2px 0 10px" }}>
                  עריכה כאן משנה את הסדרה הקבועה (כל שבוע).
                  <br />
                  לשינוי חד-פעמי בתאריך מסוים: השתמש/י ב״הצג החרגות״.
                </p>
                {draft.value.syncSource === "api" ? (
                  <p className="admin-meta">שיעור מסונכרן: ניתן לצפות ולהחריג, אבל לא לערוך את הסדרה.</p>
                ) : lessonsSyncEnabled ? (
                  <p className="admin-meta">סנכרון שיעורים פעיל. שיעורים ידניים נשמרים בנפרד.</p>
                ) : null}
                <div className="admin-form-grid">
                  <label>
                    שם שיעור
                    <input
                      type="text"
                      value={draft.value.title}
                      placeholder="שם שיעור"
                      onChange={(event) => setDraft({ kind: "lesson", value: { ...draft.value, title: event.target.value } })}
                      disabled={draft.value.syncSource === "api"}
                      required
                    />
                  </label>
                  <label>
                    מרצה
                    <input
                      type="text"
                      value={draft.value.teacher}
                      placeholder="שם מרצה"
                      onChange={(event) =>
                        setDraft({ kind: "lesson", value: { ...draft.value, teacher: event.target.value } })
                      }
                      disabled={draft.value.syncSource === "api"}
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
                      disabled={draft.value.syncSource === "api"}
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
                      disabled={draft.value.syncSource === "api"}
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
                      disabled={draft.value.syncSource === "api"}
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
                      disabled={draft.value.syncSource === "api"}
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
                    {draft.value.kind === "special"
                      ? "תיאור אירוע"
                      : draft.value.kind === "exam"
                        ? "תיאור מבחן"
                        : draft.value.kind === "closed"
                          ? "תיאור סגירה"
                          : "שם"}
                    <input
                      type="text"
                      value={draft.value.reservedBy}
                      placeholder={
                        draft.value.kind === "special"
                          ? "תיאור אירוע"
                          : draft.value.kind === "exam"
                            ? "תיאור מבחן"
                          : draft.value.kind === "closed"
                            ? "תיאור סגירה"
                            : "שם"
                      }
                      onChange={(event) =>
                        setDraft({ kind: "reservation", value: { ...draft.value, reservedBy: event.target.value } })
                      }
                      required={draft.value.kind === "special" || draft.value.kind === "exam" || draft.value.kind === "closed"}
                    />
                  </label>
                  <label>
                    אימייל
                    <input
                      type="email"
                      value={draft.value.reservedEmail}
                      placeholder="email@example.com"
                      onChange={(event) =>
                        setDraft({
                          kind: "reservation",
                          value: { ...draft.value, reservedEmail: event.target.value }
                        })
                      }
                      required={draft.value.kind !== "special" && draft.value.kind !== "exam" && draft.value.kind !== "closed"}
                    />
                  </label>
                  <label>
                    סוג
                    <select
                      value={reservationKindValue(draft.value)}
                      onChange={(event) => {
                        const value = event.target.value as "regular" | "special" | "exam" | "closed";
                        setDraft({
                          kind: "reservation",
                          value: { ...draft.value, kind: value === "regular" ? undefined : value }
                        });
                      }}
                    >
                      <option value="regular">שריון</option>
                      <option value="special">אירוע</option>
                      <option value="exam">מבחן</option>
                      <option value="closed">סגירה</option>
                    </select>
                  </label>
                </div>
              </>
            )}

            {draftError ? <p className="admin-error">{draftError}</p> : null}

            {draft.kind !== "choose" ? (
              <div className="admin-actions">
                <button className="primary" type="button" onClick={updateDraft} disabled={draft.kind === "lesson" && draft.value.syncSource === "api"}>
                  שמירה
                </button>
                <button className="secondary" type="button" onClick={duplicateDraft} disabled={draft.kind === "lesson" && draft.value.syncSource === "api"}>
                  <DuplicateIcon />
                  שכפול
                </button>
                <button className="danger" type="button" onClick={deleteDraft} disabled={draft.kind === "lesson" && draft.value.syncSource === "api"}>
                  <ReleaseIcon />
                  מחיקה
                </button>
              </div>
            ) : null}
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
