import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { formatShortDate, getDayKeyFromDateKey } from "../../../lib/date";
import { formatDurationLabelHe } from "../../../lib/formatDurationHe";
import { parseTimeInput, toTimeInput } from "../../../lib/timeInput";
import { CloseIcon, ClosedIcon, LessonTypeIcon, ReservationIcon, SpecialIcon } from "../../../components/Icons";
import type { DirectoryUser } from "../../../types/admin";
import type { Room, WeekDay } from "../../../types/schedule";
import type { AdminDraft } from "../adminDraft";

type AdminEditOverlayProps = {
  draft: AdminDraft | null;
  rooms: Room[];
  weekDays: WeekDay[];
  users: DirectoryUser[];
  canSave: boolean;
  error?: string;
  onClose: () => void;
  setDraft: Dispatch<SetStateAction<AdminDraft | null>>;
  onSwitchType: (nextType: "lesson" | "reservation" | "special" | "closed") => void;
  onDeleteLesson: () => void;
  onDeleteReservation: () => void;
  onSave: () => void;
};

const formatUserLabel = (name: string, email: string) => {
  if (name && email) return `${name} · ${email}`;
  return email || name || "";
};

export default function AdminEditOverlay({
  draft,
  rooms,
  weekDays,
  users,
  canSave,
  error,
  onClose,
  setDraft,
  onSwitchType,
  onDeleteLesson,
  onDeleteReservation,
  onSave
}: AdminEditOverlayProps) {
  const [userQuery, setUserQuery] = useState("");
  const [userOpen, setUserOpen] = useState(false);
  const lastValidUser = useRef<{ label: string; email: string; name: string } | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!draft || draft.type !== "reservation") {
      setUserOpen(false);
      return;
    }
    const label = formatUserLabel(draft.reservedBy, draft.reservedEmail);
    setUserQuery(label);
    if (draft.reservedEmail) {
      lastValidUser.current = {
        label,
        email: draft.reservedEmail,
        name: draft.reservedBy
      };
    }
  }, [draft]);

  const findUserMatch = (value: string) => {
    const raw = value.trim().toLowerCase();
    if (!raw) return null;
    const exact = users.find((u) => u.email.toLowerCase() === raw);
    if (exact) return exact;
    return users.find((u) => formatUserLabel(u.name || "", u.email).toLowerCase() === raw) || null;
  };

  const filteredUsers = useMemo(() => {
    const query = userQuery.trim().toLowerCase();
    if (!query) return users;
    return users.filter((u) => formatUserLabel(u.name || "", u.email).toLowerCase().includes(query));
  }, [userQuery, users]);

  if (!draft) return null;

  const typeLabel =
    draft.type === "lesson"
      ? "שיעור"
      : draft.type === "special"
        ? "אירוע"
        : draft.type === "closed"
          ? "סגור"
          : draft.type === "reservation"
            ? "שריון"
            : "בחר סוג";

  const dateLabel = `יום ${weekDays.find((day) => day.key === draft.dayKey)?.label || ""} · ${formatShortDate(draft.dateKey)}`;

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div
        className={`admin-modal type-${draft.type}${draft.mode === "edit" ? " edit" : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="admin-modal-header">
          <div style={{ flex: 1 }}>
            <p className="admin-title">
              {typeLabel} · {draft.mode === "create" ? "חדש" : "עריכה"}
            </p>
          </div>
          <button className="icon-button" type="button" aria-label="סגירה" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {draft.mode === "create" ? (
          <div className="admin-type-grid">
            <button
              type="button"
              className={`admin-type-card lesson${draft.type === "lesson" ? " active" : ""}`}
              onClick={() => onSwitchType("lesson")}
            >
              <LessonTypeIcon />
              <span>שיעור</span>
            </button>
            <button
              type="button"
              className={`admin-type-card reservation${draft.type === "reservation" ? " active" : ""}`}
              onClick={() => onSwitchType("reservation")}
            >
              <ReservationIcon />
              <span>שריון</span>
            </button>
            <button
              type="button"
              className={`admin-type-card special${draft.type === "special" ? " active" : ""}`}
              onClick={() => onSwitchType("special")}
            >
              <SpecialIcon />
              <span>אירוע</span>
            </button>
            <button
              type="button"
              className={`admin-type-card closed${draft.type === "closed" ? " active" : ""}`}
              onClick={() => onSwitchType("closed")}
            >
              <ClosedIcon />
              <span>סגור</span>
            </button>
          </div>
        ) : null}

        <div className="admin-form">
          {draft.type === "lesson" && draft.mode === "edit" && draft.targetLessonId ? (
            <p className="admin-meta hint center" style={{ margin: "-2px 0 4px" }}>
              העריכה כאן יוצרת החרגה לתאריך הזה בלבד (לא משנה את הסדרה הקבועה).
              <br />
              כדי לשנות את כל הסדרה: ניהול → מערכת שעות → שיעורים.
            </p>
          ) : null}

          <label className="admin-date-row">
            תאריך
            <button
              type="button"
              className="admin-date-pill"
              onClick={() => {
                const picker = dateInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
                if (!picker) return;
                if (picker.showPicker) picker.showPicker();
                else picker.click();
              }}
            >
              {dateLabel}
            </button>
            <input
              ref={dateInputRef}
              className="admin-date-input-hidden"
              type="date"
              value={draft.dateKey}
              onChange={(event) => {
                const nextDate = event.target.value;
                if (!nextDate) return;
                setDraft((prev) =>
                  prev
                    ? ({
                        ...prev,
                        dateKey: nextDate,
                        dayKey: getDayKeyFromDateKey(nextDate)
                      } as AdminDraft)
                    : prev
                );
              }}
            />
          </label>

          <label>
            חדר
            <select
              value={draft.roomId}
              onChange={(event) =>
                setDraft((prev) => (prev ? ({ ...prev, roomId: event.target.value } as AdminDraft) : prev))
              }
            >
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>

          <div className="admin-form-row">
            <label>
              שעת התחלה
              <input
                type="time"
                value={toTimeInput(draft.startMinutes)}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? ({
                          ...prev,
                          startMinutes: parseTimeInput(event.target.value)
                        } as AdminDraft)
                      : prev
                  )
                }
              />
            </label>
            <label>
              שעת סיום
              <input
                type="time"
                value={toTimeInput(draft.startMinutes + draft.durationMinutes)}
                onChange={(event) =>
                  setDraft((prev) => {
                    if (!prev) return prev;
                    const endMinutes = parseTimeInput(event.target.value);
                    return {
                      ...prev,
                      durationMinutes: Math.max(15, endMinutes - prev.startMinutes)
                    } as AdminDraft;
                  })
                }
              />
            </label>
          </div>

          <p className="admin-meta" style={{ margin: "-4px 0 4px", textAlign: "center" }}>
            משך: {formatDurationLabelHe(draft.durationMinutes)}
          </p>

          {draft.type === "lesson" ? (
            <>
              <label>
                שם שיעור
                <input
                  type="text"
                  value={draft.title}
                  placeholder="לדוגמה: תרגול הרמוניה"
                  onChange={(event) =>
                    setDraft((prev) => (prev && prev.type === "lesson" ? { ...prev, title: event.target.value } : prev))
                  }
                />
              </label>
              <label>
                מרצה
                <input
                  type="text"
                  value={draft.teacher}
                  placeholder="שם המרצה"
                  onChange={(event) =>
                    setDraft((prev) =>
                      prev && prev.type === "lesson" ? { ...prev, teacher: event.target.value } : prev
                    )
                  }
                />
              </label>
            </>
          ) : draft.type === "special" || draft.type === "closed" ? (
            <label>
              תיאור
              <input
                type="text"
                value={draft.label}
                placeholder={draft.type === "special" ? "תיאור אירוע" : "תיאור סגירה"}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev && (prev.type === "special" || prev.type === "closed")
                      ? { ...prev, label: event.target.value }
                      : prev
                  )
                }
              />
            </label>
          ) : draft.type === "reservation" ? (
            <label>
              משתמש
              <div className="admin-user-select">
                <input
                  type="text"
                  placeholder="חיפוש לפי שם או אימייל"
                  value={userQuery}
                  onFocus={() => setUserOpen(true)}
                  onChange={(event) => {
                    const next = event.target.value;
                    setUserQuery(next);
                    const match = findUserMatch(next);
                    if (match) {
                      const label = formatUserLabel(match.name || "", match.email);
                      lastValidUser.current = { label, email: match.email, name: match.name || "" };
                      setDraft((prev) =>
                        prev && prev.type === "reservation"
                          ? { ...prev, reservedEmail: match.email, reservedBy: match.name || "" }
                          : prev
                      );
                    }
                  }}
                  onBlur={() => {
                    const match = findUserMatch(userQuery);
                    if (match) {
                      const label = formatUserLabel(match.name || "", match.email);
                      lastValidUser.current = { label, email: match.email, name: match.name || "" };
                      setUserQuery(label);
                      setDraft((prev) =>
                        prev && prev.type === "reservation"
                          ? { ...prev, reservedEmail: match.email, reservedBy: match.name || "" }
                          : prev
                      );
                    } else if (lastValidUser.current) {
                      setUserQuery(lastValidUser.current.label);
                      setDraft((prev) =>
                        prev && prev.type === "reservation"
                          ? { ...prev, reservedEmail: lastValidUser.current!.email, reservedBy: lastValidUser.current!.name }
                          : prev
                      );
                    } else {
                      setUserQuery("");
                    }
                    setUserOpen(false);
                  }}
                />
                {userOpen && filteredUsers.length ? (
                  <div className="admin-user-options">
                    {filteredUsers.map((u) => {
                      const label = formatUserLabel(u.name || "", u.email);
                      return (
                        <button
                          type="button"
                          key={u.email}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            lastValidUser.current = { label, email: u.email, name: u.name || "" };
                            setUserQuery(label);
                            setDraft((prev) =>
                              prev && prev.type === "reservation"
                                ? { ...prev, reservedEmail: u.email, reservedBy: u.name || "" }
                                : prev
                            );
                            setUserOpen(false);
                          }}
                        >
                          <span className="admin-user-name">{u.name || "ללא שם"}</span>
                          <span className="admin-user-email">{u.email}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </label>
          ) : draft.mode === "create" ? (
            <p className="admin-meta" style={{ textAlign: "center" }}>
              בחר סוג רשומה למעלה כדי להמשיך.
            </p>
          ) : null}

          {error ? <p className="admin-error">{error}</p> : null}
        </div>

        <div className="admin-actions">
          {draft.mode === "edit" && draft.type === "lesson" ? (
            <button type="button" className="secondary danger" onClick={onDeleteLesson}>
              מחיקה ליום זה
            </button>
          ) : null}
          {draft.mode === "edit" && (draft.type === "reservation" || draft.type === "special" || draft.type === "closed") ? (
            <button type="button" className="secondary danger" onClick={onDeleteReservation}>
              מחיקת שריון
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="primary"
            onClick={onSave}
            disabled={!canSave || draft.type === "choose"}
          >
            שמירה
          </button>
        </div>
      </div>
    </div>
  );
}
