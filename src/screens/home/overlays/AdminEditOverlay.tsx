import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { formatShortDate, getDayKeyFromDateKey } from "../../../lib/date";
import { formatDurationLabelHe } from "../../../lib/formatDurationHe";
import { parseTimeInput, toTimeInput } from "../../../lib/timeInput";
import { getPeopleCategoryLabel } from "../../../lib/peopleDirectory";
import { ChevronLeftIcon, CloseIcon, ClosedIcon, ExamTypeIcon, LessonTypeIcon, ReservationIcon, SpecialIcon, UserIcon } from "../../../components/Icons";
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
  collisionPending?: boolean;
  onClose: () => void;
  setDraft: Dispatch<SetStateAction<AdminDraft | null>>;
  onSwitchType: (nextType: "lesson" | "reservation" | "special" | "exam" | "closed") => void;
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
  collisionPending = false,
  onClose,
  setDraft,
  onSwitchType,
  onDeleteLesson,
  onDeleteReservation,
  onSave
}: AdminEditOverlayProps) {
  const [userQuery, setUserQuery] = useState("");
  const [userOpen, setUserOpen] = useState(false);
  const [participantEditorOpen, setParticipantEditorOpen] = useState(false);
  const [participantQuery, setParticipantQuery] = useState("");
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

  useEffect(() => {
    setParticipantEditorOpen(false);
    setParticipantQuery("");
  }, [draft?.mode, draft?.type, draft?.type === "reservation" ? draft.reservationId : undefined]);

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

  const participantOptions = useMemo(() => {
    if (!draft || draft.type !== "reservation") return [];
    const ownerEmail = draft.reservedEmail.trim().toLowerCase();
    const selected = new Set(draft.participantEmails.map((email) => email.trim().toLowerCase()));
    const query = participantQuery.trim().toLowerCase();
    return users
      .filter((user) => user.email.trim().toLowerCase() !== ownerEmail)
      .filter((user) => {
        if (!query) return true;
        const label = `${user.name || ""} ${user.email} ${user.phone || ""} ${getPeopleCategoryLabel(user)}`.toLowerCase();
        return label.includes(query);
      })
      .sort((a, b) => {
        const aSelected = selected.has(a.email.trim().toLowerCase());
        const bSelected = selected.has(b.email.trim().toLowerCase());
        if (aSelected !== bSelected) return aSelected ? -1 : 1;
        return (a.name || a.email).localeCompare(b.name || b.email, "he");
      });
  }, [draft, participantQuery, users]);

  if (!draft) return null;

  const typeLabel =
    draft.type === "lesson"
      ? "שיעור"
      : draft.type === "special"
        ? "אירוע"
        : draft.type === "exam"
          ? "מבחן"
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

        {draft.mode === "create" || draft.mode === "edit" ? (
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
              className={`admin-type-card exam${draft.type === "exam" ? " active" : ""}`}
              onClick={() => onSwitchType("exam")}
            >
              <ExamTypeIcon />
              <span>מבחן</span>
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
          {draft.mode === "edit" && draft.source?.kind === "lesson" && draft.type !== "lesson" ? (
            <p className="admin-meta hint center" style={{ margin: "-2px 0 4px" }}>
              שינוי סוג מחליף מופע בודד: השיעור יוסתר בתאריך הזה ותתווסף רשומה חדשה.
            </p>
          ) : null}
          {draft.mode === "edit" && draft.source?.kind === "reservation" && draft.type === "lesson" ? (
            <p className="admin-meta hint center" style={{ margin: "-2px 0 4px" }}>
              שינוי סוג מחליף מופע בודד: השריון יימחק ותתווסף החרגת שיעור לתאריך הזה.
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
          ) : draft.type === "special" || draft.type === "exam" || draft.type === "closed" ? (
            <label>
              תיאור
              <input
                type="text"
                value={draft.label}
                placeholder={draft.type === "special" ? "תיאור אירוע" : draft.type === "exam" ? "תיאור מבחן" : "תיאור סגירה"}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev && (prev.type === "special" || prev.type === "exam" || prev.type === "closed")
                      ? { ...prev, label: event.target.value }
                      : prev
                  )
                }
              />
            </label>
          ) : draft.type === "reservation" ? (
            <>
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

              {draft.mode === "edit" ? (
                <div className={`admin-participant-editor${participantEditorOpen ? " open" : ""}`}>
                  <button
                    type="button"
                    className="secondary admin-participant-editor-toggle"
                    onClick={() => setParticipantEditorOpen((value) => !value)}
                    aria-expanded={participantEditorOpen}
                  >
                    <span className="admin-participant-editor-label">
                      <UserIcon />
                      <span>עריכת משתתפים</span>
                    </span>
                    <span className="admin-participant-editor-meta">
                      <strong>{draft.participantEmails.length}</strong>
                      <ChevronLeftIcon />
                    </span>
                  </button>
                  {participantEditorOpen ? (
                    <div className="admin-participant-editor-panel">
                      <input
                        type="search"
                        value={participantQuery}
                        placeholder="חיפוש משתתפים"
                        onChange={(event) => setParticipantQuery(event.target.value)}
                      />
                      <div className="admin-participant-options">
                        {participantOptions.map((user) => {
                          const email = user.email.trim().toLowerCase();
                          const selected = draft.participantEmails.some(
                            (entry) => entry.trim().toLowerCase() === email
                          );
                          const label = (user.name || "").trim() || user.email;
                          return (
                            <button
                              type="button"
                              key={`admin-participant-${email}`}
                              className={selected ? "active" : ""}
                              onClick={() => {
                                setDraft((prev) => {
                                  if (!prev || prev.type !== "reservation") return prev;
                                  const current = prev.participantEmails
                                    .map((entry) => entry.trim().toLowerCase())
                                    .filter(Boolean);
                                  return {
                                    ...prev,
                                    participantEmails: selected
                                      ? current.filter((entry) => entry !== email)
                                      : [...current, email]
                                  };
                                });
                              }}
                            >
                              <span className={`admin-participant-check${selected ? " active" : ""}`} aria-hidden="true">
                                {selected ? "✓" : ""}
                              </span>
                              <span className="groups-chat-avatar admin-participant-avatar">
                                {(user.pictureUrl || "").trim() ? <img src={user.pictureUrl} alt="" loading="lazy" /> : label.slice(0, 1)}
                              </span>
                              <span className="groups-chat-text">
                                <span className="groups-chat-title">{label}</span>
                                <span className="groups-chat-subtitle">{getPeopleCategoryLabel(user)}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : draft.mode === "create" ? (
            <p className="admin-meta" style={{ textAlign: "center" }}>
              בחר סוג רשומה למעלה כדי להמשיך.
            </p>
          ) : null}

          {error ? <p className={collisionPending ? "admin-warning" : "admin-error"}>{error}</p> : null}
        </div>

        <div className="admin-actions">
          {draft.mode === "edit" && draft.type === "lesson" ? (
            <button type="button" className="secondary danger" onClick={onDeleteLesson}>
              מחיקה ליום זה
            </button>
          ) : null}
          {draft.mode === "edit" &&
          (draft.type === "reservation" || draft.type === "special" || draft.type === "exam" || draft.type === "closed") ? (
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
            {collisionPending ? "שמירה בכל זאת" : "שמירה"}
          </button>
        </div>
      </div>
    </div>
  );
}
