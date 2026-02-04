import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { DirectoryUser } from "../../../types/admin";
import {
  cohortStartYearFromGrade,
  gradeLabelFromCohort,
  gradeOptions,
  gradeValueFromCohort
} from "../../../lib/academics";
import { AddIcon, DuplicateIcon, EditIcon, ReleaseIcon } from "../../../components/Icons";
import ConfirmDialog from "../components/ConfirmDialog";
import type { BulkState } from "../bulk";
import PropsOverlay from "../components/PropsOverlay";

type UsersSectionProps = {
  users: DirectoryUser[];
  pendingUsers: DirectoryUser[];
  usersError: string;
  userDraft: DirectoryUser;
  setUserDraft: Dispatch<SetStateAction<DirectoryUser>>;
  currentAcademicYear: number;
  onUpsert: (user: DirectoryUser) => void;
  onRemove: (email: string) => void;
  onReset: () => void;
  onFilteredUsersChange?: (users: DirectoryUser[]) => void;
  onBulkStateChange?: (state: BulkState | null) => void;
};

type UserFilter = "all" | "pending" | "student" | "moderator" | "admin";
type GradeFilter = "all" | "A" | "B" | "C" | "STAFF";
type PhoneFilter = "all" | "has" | "missing";
type UserSort = "name" | "email" | "role" | "cohort";

const isStaffUser = (user: DirectoryUser) => user.role === "moderator" && !user.cohortStartYear;

export default function UsersSection({
  users,
  pendingUsers,
  usersError,
  userDraft,
  setUserDraft,
  currentAcademicYear,
  onUpsert,
  onRemove,
  onReset,
  onFilteredUsersChange,
  onBulkStateChange
}: UsersSectionProps) {
  const [filter, setFilter] = useState<UserFilter>("all");
  const [gradeFilter, setGradeFilter] = useState<GradeFilter>("all");
  const [phoneFilter, setPhoneFilter] = useState<PhoneFilter>("all");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<UserSort>("name");
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(() => new Set());
  const [confirmDeleteEmails, setConfirmDeleteEmails] = useState<string[] | null>(null);
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

  const roleFilteredUsers = useMemo(() => {
    if (filter === "all") return users;
    if (filter === "pending") return users.filter((user) => user.role === "pending");
    return users.filter((user) => user.role === filter);
  }, [filter, users]);

  const gradeCounts = useMemo(() => {
    const base = { all: roleFilteredUsers.length, A: 0, B: 0, C: 0, STAFF: 0 };
    roleFilteredUsers.forEach((user) => {
      if (isStaffUser(user)) {
        base.STAFF += 1;
        return;
      }
      if (!user.cohortStartYear) return;
      const grade = gradeValueFromCohort(user.cohortStartYear);
      if (grade === "A") base.A += 1;
      if (grade === "B") base.B += 1;
      if (grade === "C") base.C += 1;
    });
    return base;
  }, [roleFilteredUsers]);

  const filteredUsers = useMemo(() => {
    let list = roleFilteredUsers;
    if (gradeFilter === "STAFF") {
      list = list.filter((user) => isStaffUser(user));
    } else if (gradeFilter !== "all") {
      list = list.filter((user) => {
        if (!user.cohortStartYear) return false;
        return gradeValueFromCohort(user.cohortStartYear) === gradeFilter;
      });
    }
    if (phoneFilter !== "all") {
      list = list.filter((user) => {
        const hasPhone = Boolean(user.phone && user.phone.trim());
        return phoneFilter === "has" ? hasPhone : !hasPhone;
      });
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((user) => {
        const haystack = [
          user.name || "",
          user.email || "",
          user.phone || "",
          isStaffUser(user) ? "צוות" : (user.cohortStartYear ? gradeLabelFromCohort(user.cohortStartYear) : "")
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    const sorted = [...list].sort((a, b) => {
      const aName = (a.name || a.email || "").trim();
      const bName = (b.name || b.email || "").trim();
      const aEmail = (a.email || "").trim();
      const bEmail = (b.email || "").trim();
      const aRole = (a.role || "").trim();
      const bRole = (b.role || "").trim();
      const aCohort = a.cohortStartYear ?? -1;
      const bCohort = b.cohortStartYear ?? -1;
      if (sortBy === "email") return aEmail.localeCompare(bEmail, "he");
      if (sortBy === "role") return aRole.localeCompare(bRole, "he") || aName.localeCompare(bName, "he");
      if (sortBy === "cohort") return bCohort - aCohort || aName.localeCompare(bName, "he");
      return aName.localeCompare(bName, "he");
    });

    return sorted;
  }, [gradeFilter, phoneFilter, query, roleFilteredUsers, sortBy]);

  const filteredUsersCount = filteredUsers.length;

  const filteredByEmail = useMemo(() => {
    const map = new Map<string, DirectoryUser>();
    filteredUsers.forEach((user) => map.set(user.email, user));
    return map;
  }, [filteredUsers]);

  const selectedInView = useMemo(
    () => Array.from(selectedEmails).filter((email) => filteredByEmail.has(email)),
    [filteredByEmail, selectedEmails]
  );

  const phoneCounts = useMemo(() => {
    const base = { all: roleFilteredUsers.length, has: 0, missing: 0 };
    roleFilteredUsers.forEach((user) => {
      const hasPhone = Boolean(user.phone && user.phone.trim());
      if (hasPhone) base.has += 1;
      else base.missing += 1;
    });
    return base;
  }, [roleFilteredUsers]);

  const selectedUser = useMemo(() =>
    (selectedEmail ? users.find((user) => user.email === selectedEmail) || null : null),
  [selectedEmail, users]);

  useEffect(() => {
    onFilteredUsersChange?.(filteredUsers);
  }, [filteredUsers, onFilteredUsersChange]);

  const handleSelect = (user: DirectoryUser) => {
    setSelectedEmail(user.email);
    setUserDraft({
      ...user,
      role: user.role === "pending" ? "student" : user.role,
      phone: user.phone || "",
      cohortStartYear: user.cohortStartYear ?? (user.role === "moderator" ? undefined : currentAcademicYear)
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
    setConfirmDeleteEmails([email]);
  };

  const userStatus = isEditing ? (selectedEmail || "חדש") : "";

  const duplicateUser = (user: DirectoryUser) => {
    setSelectedEmail(null);
    setUserDraft({
      ...user,
      email: "",
      name: user.name ? `${user.name} (עותק)` : "",
      role: user.role === "pending" ? "student" : user.role,
      phone: user.phone || "",
      cohortStartYear: user.cohortStartYear
    });
    setIsEditing(true);
    setIsNewEntry(true);
  };

  const bulkToggleAll = () => {
    if (selectedInView.length && selectedInView.length === filteredUsers.length) {
      setSelectedEmails(new Set());
      return;
    }
    setSelectedEmails(new Set(filteredUsers.map((u) => u.email)));
  };

  const bulkEdit = () => {
    if (selectedInView.length !== 1) return;
    const user = filteredByEmail.get(selectedInView[0]);
    if (user) handleSelect(user);
  };

  const bulkDuplicate = () => {
    if (!selectedInView.length) return;
    selectedInView.forEach((email) => {
      const user = filteredByEmail.get(email);
      if (user) duplicateUser(user);
    });
  };

  const bulkDelete = () => {
    if (!selectedInView.length) return;
    setConfirmDeleteEmails(selectedInView);
  };

  const bulkState = useMemo<BulkState>(() => {
    const total = filteredUsers.length;
    const selectedCount = selectedInView.length;
    return {
      selectAll: {
        checked: total > 0 && selectedCount === total,
        indeterminate: selectedCount > 0 && selectedCount < total,
        onToggle: bulkToggleAll
      },
      selectedCount,
      totalCount: total,
      actions: [
        { id: "new", label: "הוספה", icon: <AddIcon />, onClick: handleNew },
        { id: "edit", label: "עריכה", icon: <EditIcon />, disabled: selectedCount !== 1, onClick: bulkEdit },
        { id: "duplicate", label: "שכפול", icon: <DuplicateIcon />, disabled: selectedCount === 0, onClick: bulkDuplicate },
        { id: "delete", label: "מחיקה", icon: <ReleaseIcon />, tone: "danger", disabled: selectedCount === 0, onClick: bulkDelete }
      ]
    };
  }, [bulkDelete, bulkDuplicate, bulkEdit, bulkToggleAll, filteredUsers.length, handleNew, selectedInView.length]);

  useEffect(() => {
    onBulkStateChange?.(bulkState);
    return () => onBulkStateChange?.(null);
  }, [bulkState, onBulkStateChange]);

  const confirmDelete = () => {
    if (!confirmDeleteEmails?.length) return;
    confirmDeleteEmails.forEach((email) => onRemove(email));
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      confirmDeleteEmails.forEach((email) => next.delete(email));
      return next;
    });
    if (selectedEmail && confirmDeleteEmails.includes(selectedEmail)) {
      setSelectedEmail(null);
      onReset();
      setIsEditing(false);
      setIsNewEntry(false);
    }
    setConfirmDeleteEmails(null);
  };

  const closeEditor = () => {
    setSelectedEmail(null);
    setIsEditing(false);
    setIsNewEntry(false);
    onReset();
  };

  return (
    <section className="admin-section">
      <ConfirmDialog
        open={Boolean(confirmDeleteEmails?.length)}
        title="מחיקת משתמשים"
        description={`למחוק ${confirmDeleteEmails?.length || 0} משתמשים?`}
        confirmLabel="מחיקה"
        cancelLabel="ביטול"
        tone="danger"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteEmails(null)}
      />
      <PropsOverlay open={isEditing} title="פרטי משתמש" meta={userStatus || null} onClose={closeEditor}>
        <div className="admin-card">
          <div className="admin-card-header">
            <h3>פרטי משתמש</h3>
            {userStatus ? <span className="admin-meta">{userStatus}</span> : null}
          </div>
          <fieldset className="admin-fieldset">
            <div className="admin-form-grid">
              <label>
                אימייל
                <input
                  type="email"
                  value={userDraft.email}
                  onChange={(event) =>
                    setUserDraft((prev) => ({ ...prev, email: event.target.value.toLowerCase() }))
                  }
                  disabled={!isNewEntry}
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
                  value={
                    userDraft.role === "moderator" && !userDraft.cohortStartYear
                      ? "STAFF"
                      : gradeValueFromCohort(userDraft.cohortStartYear)
                  }
                  onChange={(event) => {
                    const value = event.target.value as "A" | "B" | "C" | "STAFF";
                    if (value === "STAFF") {
                      setUserDraft((prev) => ({
                        ...prev,
                        cohortStartYear: undefined,
                        role: prev.role === "student" || prev.role === "pending" ? "moderator" : prev.role
                      }));
                      return;
                    }
                    setUserDraft((prev) => ({
                      ...prev,
                      cohortStartYear: cohortStartYearFromGrade(value),
                      role: prev.role === "pending" ? "student" : prev.role
                    }));
                  }}
                >
                  <option value="STAFF">צוות</option>
                  {gradeOptions().map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {userDraft.cohortStartYear || (userDraft.role === "moderator" && !userDraft.cohortStartYear) ? (
              <p className="admin-meta">
                סטטוס נוכחי:{" "}
                {userDraft.role === "moderator" && !userDraft.cohortStartYear
                  ? "צוות"
                  : gradeLabelFromCohort(userDraft.cohortStartYear)}
                {userDraft.cohortStartYear
                  ? ` · התחלת מחזור ${userDraft.cohortStartYear}-${userDraft.cohortStartYear + 1}`
                  : ""}
              </p>
            ) : null}
            <div className="admin-actions">
              <button className="primary" type="button" onClick={() => onUpsert(userDraft)} disabled={!userDraft.email}>
                {isNewEntry ? "הוספה" : "עדכון"}
              </button>
              <button
                className="secondary danger"
                type="button"
                onClick={handleDelete}
                disabled={!selectedEmail}
              >
                <ReleaseIcon />
                מחיקה
              </button>
            </div>
          </fieldset>
        </div>
      </PropsOverlay>
      <div className="admin-section-toolbar">
        <div className="admin-filters-stack">
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
          <div className="admin-filters">
            <button
              type="button"
              className={`chip small${gradeFilter === "all" ? " active" : ""}`}
              onClick={() => setGradeFilter("all")}
            >
              שנתון: הכל ({gradeCounts.all})
            </button>
            <button
              type="button"
              className={`chip small${gradeFilter === "A" ? " active" : ""}`}
              onClick={() => setGradeFilter("A")}
            >
              א׳ ({gradeCounts.A})
            </button>
            <button
              type="button"
              className={`chip small${gradeFilter === "B" ? " active" : ""}`}
              onClick={() => setGradeFilter("B")}
            >
              ב׳ ({gradeCounts.B})
            </button>
            <button
              type="button"
              className={`chip small${gradeFilter === "C" ? " active" : ""}`}
              onClick={() => setGradeFilter("C")}
            >
              ג׳ ({gradeCounts.C})
            </button>
            <button
              type="button"
              className={`chip small${gradeFilter === "STAFF" ? " active" : ""}`}
              onClick={() => setGradeFilter("STAFF")}
            >
              צוות ({gradeCounts.STAFF})
            </button>
          </div>
          <div className="admin-filters">
            <button
              type="button"
              className={`chip small${phoneFilter === "all" ? " active" : ""}`}
              onClick={() => setPhoneFilter("all")}
            >
              טלפון: הכל ({phoneCounts.all})
            </button>
            <button
              type="button"
              className={`chip small${phoneFilter === "has" ? " active" : ""}`}
              onClick={() => setPhoneFilter("has")}
            >
              קיים ({phoneCounts.has})
            </button>
            <button
              type="button"
              className={`chip small${phoneFilter === "missing" ? " active" : ""}`}
              onClick={() => setPhoneFilter("missing")}
            >
              חסר ({phoneCounts.missing})
            </button>
          </div>
          <div className="admin-filter-controls">
            <label>
              חיפוש
              <input
                type="search"
                value={query}
                placeholder="שם / אימייל / טלפון"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              מיון
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as UserSort)}>
                <option value="name">שם</option>
                <option value="email">אימייל</option>
                <option value="role">הרשאה</option>
                <option value="cohort">שנתון</option>
              </select>
            </label>
            <div className="admin-filter-meta" aria-label="כמות תוצאות">
              {filteredUsersCount} תוצאות
            </div>
          </div>
        </div>
        {usersError ? <span className="admin-error">{usersError}</span> : null}
      </div>
      <div className="admin-section-body">
        <div className="admin-list">
          <div className="admin-card list-card">
            <div className="admin-card-header">
              <h3>רשימת משתמשים</h3>
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
                    <input
                      type="checkbox"
                      className="admin-row-check"
                      checked={selectedEmails.has(user.email)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() =>
                        setSelectedEmails((prev) => {
                          const next = new Set(prev);
                          if (next.has(user.email)) next.delete(user.email);
                          else next.add(user.email);
                          return next;
                        })
                      }
                      aria-label="בחר משתמש"
                    />
                    <div className="admin-row-main">
                      <p className="admin-row-title">{user.name || user.email}</p>
                      <p className="admin-row-meta">
                        {user.phone ? user.phone : "טלפון לא צויין"} ·{" "}
                        {isStaffUser(user)
                          ? "צוות"
                          : user.cohortStartYear
                            ? `שנתון ${gradeLabelFromCohort(user.cohortStartYear)}`
                            : "שנתון לא הוגדר"}
                      </p>
                      <p className="admin-row-meta">{user.email}</p>
                    </div>
                    <div className="admin-row-actions">
                      <div className="admin-row-buttons">
                        <button
                          type="button"
                          className="admin-mini-action"
                          aria-label="עריכה"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelect(user);
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
                            duplicateUser(user);
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
                            setConfirmDeleteEmails([user.email]);
                          }}
                        >
                          <ReleaseIcon />
                        </button>
                      </div>
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
