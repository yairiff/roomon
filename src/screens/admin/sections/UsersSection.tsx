import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { DirectoryUser } from "../../../types/admin";
import {
  cohortStartYearFromGrade,
  gradeLabelFromCohort,
  gradeOptions,
  gradeValueFromCohort
} from "../../../lib/academics";
import { AddIcon, ApproveIcon, ReleaseIcon } from "../../../components/Icons";

type UsersSectionProps = {
  users: DirectoryUser[];
  pendingUsers: DirectoryUser[];
  usersError: string;
  userDraft: DirectoryUser;
  setUserDraft: Dispatch<SetStateAction<DirectoryUser>>;
  currentAcademicYear: number;
  onApprove: (user: DirectoryUser) => void;
  onUpsert: (user: DirectoryUser) => void;
  onRemove: (email: string) => void;
  onReset: () => void;
};

type UserFilter = "all" | "pending" | "student" | "moderator" | "admin";

export default function UsersSection({
  users,
  pendingUsers,
  usersError,
  userDraft,
  setUserDraft,
  currentAcademicYear,
  onApprove,
  onUpsert,
  onRemove,
  onReset
}: UsersSectionProps) {
  const [filter, setFilter] = useState<UserFilter>("all");
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isNewEntry, setIsNewEntry] = useState(false);

  const counts = useMemo(() => {
    const base = {
      all: users.length,
      pending: pendingUsers.length,
      student: 0,
      moderator: 0,
      admin: 0
    };
    users.forEach((user) => {
      if (user.role === "student") base.student += 1;
      if (user.role === "moderator") base.moderator += 1;
      if (user.role === "admin") base.admin += 1;
    });
    return base;
  }, [users, pendingUsers]);

  const filteredUsers = useMemo(() => {
    if (filter === "all") return users;
    if (filter === "pending") return users.filter((user) => user.role === "pending");
    return users.filter((user) => user.role === filter);
  }, [filter, users]);

  const selectedUser = useMemo(() =>
    (selectedEmail ? users.find((user) => user.email === selectedEmail) || null : null),
  [selectedEmail, users]);

  const handleSelect = (user: DirectoryUser) => {
    setSelectedEmail(user.email);
    setUserDraft({
      ...user,
      role: user.role === "pending" ? "student" : user.role,
      phone: user.phone || "",
      cohortStartYear: user.cohortStartYear ?? currentAcademicYear
    });
    setIsEditing(true);
    setIsNewEntry(false);
  };

  const handleNew = () => {
    setSelectedEmail(null);
    onReset();
    setIsEditing(true);
    setIsNewEntry(true);
  };

  const handleDelete = () => {
    const email = selectedEmail || userDraft.email;
    if (!email) return;
    onRemove(email);
    setSelectedEmail(null);
    onReset();
    setIsEditing(false);
    setIsNewEntry(false);
  };

  const userStatus = isEditing ? (selectedEmail || "חדש") : "";

  return (
    <section className="admin-section">
      <div className="admin-section-toolbar">
        <div className="admin-filters">
          <button
            type="button"
            className={`chip small${filter === "all" ? " active" : ""}`}
            onClick={() => setFilter("all")}
          >
            הכל ({counts.all})
          </button>
          <button
            type="button"
            className={`chip small${filter === "pending" ? " active" : ""}`}
            onClick={() => setFilter("pending")}
          >
            ממתינים ({counts.pending})
          </button>
          <button
            type="button"
            className={`chip small${filter === "student" ? " active" : ""}`}
            onClick={() => setFilter("student")}
          >
            סטודנטים ({counts.student})
          </button>
          <button
            type="button"
            className={`chip small${filter === "moderator" ? " active" : ""}`}
            onClick={() => setFilter("moderator")}
          >
            מתאמים ({counts.moderator})
          </button>
          <button
            type="button"
            className={`chip small${filter === "admin" ? " active" : ""}`}
            onClick={() => setFilter("admin")}
          >
            מנהלים ({counts.admin})
          </button>
        </div>
        {usersError ? <span className="admin-error">{usersError}</span> : null}
      </div>
      <div className="admin-section-body">
        <aside className="admin-properties">
          <div className="admin-card">
              <div className="admin-card-header">
                <h3>פרטי משתמש</h3>
                {userStatus ? <span className="admin-meta">{userStatus}</span> : null}
              </div>
            {selectedUser?.role === "pending" ? (
              <div className="admin-inline">
                <button className="primary" type="button" onClick={() => onApprove(selectedUser)}>
                  אישור משתמש
                </button>
              </div>
            ) : null}
            <fieldset className="admin-fieldset" disabled={!isEditing}>
              <div className="admin-form-grid">
                <label>
                  אימייל
                  <input
                    type="email"
                    value={userDraft.email}
                    onChange={(event) =>
                      setUserDraft((prev) => ({ ...prev, email: event.target.value.toLowerCase() }))
                    }
                  />
                </label>
                <label>
                  שם
                  <input
                    type="text"
                    value={userDraft.name}
                    onChange={(event) => setUserDraft((prev) => ({ ...prev, name: event.target.value }))}
                  />
                </label>
                <label>
                  טלפון
                  <input
                    type="tel"
                    value={userDraft.phone || ""}
                    onChange={(event) => setUserDraft((prev) => ({ ...prev, phone: event.target.value }))}
                  />
                </label>
                <label>
                  הרשאה
                  <select
                    value={userDraft.role}
                    onChange={(event) =>
                      setUserDraft((prev) => ({ ...prev, role: event.target.value as DirectoryUser["role"] }))
                    }
                  >
                    <option value="student">סטודנט</option>
                    <option value="moderator">מתאם</option>
                    <option value="admin">מנהל</option>
                  </select>
                </label>
                <label>
                  שנתון
                  <select
                    value={gradeValueFromCohort(userDraft.cohortStartYear)}
                    onChange={(event) => {
                      const grade = event.target.value as "A" | "B" | "C";
                      setUserDraft((prev) => ({
                        ...prev,
                        cohortStartYear: cohortStartYearFromGrade(grade)
                      }));
                    }}
                  >
                    {gradeOptions().map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              {isEditing && userDraft.cohortStartYear ? (
                <p className="admin-meta">
                  סטטוס נוכחי: {gradeLabelFromCohort(userDraft.cohortStartYear)} ·
                  התחלת מחזור {userDraft.cohortStartYear}-{userDraft.cohortStartYear + 1}
                </p>
              ) : null}
              <div className="admin-actions">
                <button
                  className="primary"
                  type="button"
                  onClick={() => onUpsert(userDraft)}
                  disabled={!isEditing || !userDraft.email}
                >
                  <ApproveIcon />
                  {isNewEntry ? "הוספה" : "עדכון"}
                </button>
                <button
                  className="secondary danger"
                  type="button"
                  onClick={handleDelete}
                  disabled={!isEditing || !selectedEmail}
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
              <h3>רשימת משתמשים</h3>
              <button className="admin-card-action" type="button" onClick={handleNew}>
                <AddIcon />
                הוספה
              </button>
            </div>
            {filteredUsers.length ? (
              <div className="admin-table scroll tall">
                {filteredUsers.map((user) => (
                  <div
                    key={user.email}
                    className={`admin-row clickable${selectedEmail === user.email ? " selected" : ""}${user.role === "pending" ? " pending" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelect(user)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleSelect(user);
                      }
                    }}
                  >
                    <div>
                      <p className="admin-row-title">{user.name || user.email}</p>
                      <p className="admin-row-meta">
                        {user.phone ? user.phone : "טלפון לא צויין"} ·{" "}
                        {user.cohortStartYear
                          ? `שנתון ${gradeLabelFromCohort(user.cohortStartYear)}`
                          : "שנתון לא הוגדר"}
                      </p>
                      <p className="admin-row-meta">{user.email}</p>
                    </div>
                    <div className="admin-row-actions">
                      <span className={`chip small${user.role === "pending" ? " active" : " ghost"}`}>
                        {user.role === "pending" ? "ממתין" : user.role}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="admin-meta">אין משתמשים במסנן הזה.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
