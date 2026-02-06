import { useCallback, useEffect, useMemo, useState } from "react";
import { rimonScheduleConfig } from "../../config";
import { useDirectoryUsers } from "../../hooks/useDirectoryUsers";
import { useLessons } from "../../hooks/useLessons";
import { useReservations } from "../../hooks/useReservations";
import { useRooms } from "../../hooks/useRooms";
import { useScheduleSettings } from "../../hooks/useScheduleSettings";
import type { User } from "../../types/auth";
import type { LessonRecord, RoomRecord, DirectoryUser } from "../../types/admin";
import type { SemesterKey } from "../../types/ui";
import type { Reservation } from "../../types/reservations";
import { getAcademicYearStartYear } from "../../lib/academics";
import { parseTimeInput, toTimeInput } from "../../lib/timeInput";
import type { AdminSection } from "./types";
import type { BulkState } from "./bulk";
import BulkSelectAll from "./components/BulkSelectAll";
import { RoomIcon, MenuIcon, UserIcon, HomeIcon, LogoutIcon, CalendarIcon, CloseIcon, ImportExportIcon, SearchIcon, TuneIcon } from "../../components/Icons";
import CsvToolContent from "./tools/CsvToolContent";
import UsersSection from "./sections/UsersSection";
import RoomsSection from "./sections/RoomsSection";
import ScheduleSection from "./sections/ScheduleSection";

type AdminScreenProps = {
  currentUser: User | null;
  onSignOut?: () => void;
};

export default function AdminScreen({ currentUser, onSignOut }: AdminScreenProps) {
  const isAdmin = currentUser?.role === "admin";
  const [activeSemester, setActiveSemester] = useState<SemesterKey>("A");
  const [activeSection, setActiveSection] = useState<AdminSection>("users");
  const [scheduleFilter, setScheduleFilter] = useState<"all" | "lessons" | "regular" | "special" | "closed">("all");
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: "success" | "error" } | null>(null);
  const [bulkState, setBulkState] = useState<BulkState | null>(null);
  const [searchBySection, setSearchBySection] = useState<Record<AdminSection, string>>({
    users: "",
    schedule: "",
    rooms: ""
  });
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<
    | null
    | {
        section: "users" | "schedule";
        kind: "csv" | "semesters";
      }
  >(null);
  const userInitials = currentUser
    ? currentUser.name
        .split(" ")
        .filter(Boolean)
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase() || currentUser.email.charAt(0).toUpperCase()
    : "";

  const {
    users,
    usersError,
    upsertUser,
    removeUser
  } = useDirectoryUsers();
  const {
    lessons,
    lessonsError,
    upsertLesson,
    removeLesson
  } = useLessons(activeSemester);
  const { lessons: lessonsAll, lessonsError: lessonsAllError } = useLessons();
  const {
    roomsRaw,
    roomsError,
    upsertRoom,
    removeRoom
  } = useRooms();
  const {
    reservationMap,
    reservationsError,
    releaseReservation,
    upsertReservation
  } = useReservations();
  const { semesterRanges, settingsError, saveSemesterRanges } = useScheduleSettings();

  const reservationList = useMemo(() => {
    const all: Reservation[] = [];
    Object.values(reservationMap).forEach((reservations) => reservations.forEach((reservation) => all.push(reservation)));
    return all.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.time !== b.time) return a.time - b.time;
      return a.roomId.localeCompare(b.roomId);
    });
  }, [reservationMap]);

  const [userDraft, setUserDraft] = useState<DirectoryUser>({
    email: "",
    name: "",
    role: "student",
    phone: "",
    cohortStartYear: getAcademicYearStartYear()
  });
  const [rangeDraft, setRangeDraft] = useState({
    A: { start: "", end: "" },
    B: { start: "", end: "" }
  });
  const [roomDraft, setRoomDraft] = useState<RoomRecord>({
    id: "",
    name: "",
    shortName: "",
    openMinutes: rimonScheduleConfig.startHour * 60,
    closeMinutes: rimonScheduleConfig.endHour * 60,
    isClosed: false,
    sortOrder: 0
  });
  const [lessonDraft, setLessonDraft] = useState<LessonRecord>({
    id: "",
    title: "",
    teacher: "",
    day: "sun",
    roomId: roomsRaw[0]?.id || "",
    startMinutes: rimonScheduleConfig.startHour * 60,
    durationMinutes: rimonScheduleConfig.academicHourMinutes,
    semester: activeSemester
  });

  useEffect(() => {
    const stored = window.localStorage.getItem("adminSideCollapsed");
    if (stored) {
      setSideCollapsed(stored === "1");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("adminSideCollapsed", sideCollapsed ? "1" : "0");
  }, [sideCollapsed]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const handle = () => setIsNarrow(media.matches);
    handle();
    media.addEventListener("change", handle);
    return () => media.removeEventListener("change", handle);
  }, []);

  useEffect(() => {
    if (!isNarrow) {
      setMobileMenuOpen(false);
    }
  }, [isNarrow]);

  useEffect(() => {
    if (!isNarrow) {
      setMobileSearchOpen(false);
    }
  }, [isNarrow]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const closeTools = useCallback(() => {
    setActiveTool(null);
  }, []);

  const overlayOpen = activeTool !== null;
  const menuCollapsed = sideCollapsed && !isNarrow;

  useEffect(() => {
    setActiveTool(null);
    setScheduleFilter("all");
    setBulkState(null);
    setMobileSearchOpen(false);
  }, [activeSection]);

  const searchQuery = searchBySection[activeSection] || "";
  const setSearchQuery = (value: string) => {
    setSearchBySection((prev) => ({ ...prev, [activeSection]: value }));
  };

  useEffect(() => {
    if (!overlayOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTools();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [closeTools, overlayOpen]);

  const showToast = (message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
  };

  const toolToggle = (tool: NonNullable<typeof activeTool>) => {
    setActiveTool((prev) => {
      if (prev && prev.section === tool.section && prev.kind === tool.kind) return null;
      return tool;
    });
  };

  if (!isAdmin) {
    return (
      <div className="admin-page">
        <header className="admin-top">
          <div>
            <h1>לוח ניהול</h1>
            <p>אין לך הרשאות מנהל.</p>
          </div>
          <button className="secondary" type="button" onClick={() => (window.location.href = "/")}>
            חזרה ללוח
          </button>
        </header>
      </div>
    );
  }

  const currentAcademicYear = getAcademicYearStartYear();
  const pendingUsers = users.filter((entry) => entry.role === "pending");

  useEffect(() => {
    const rangeA = semesterRanges.find((range) => range.key === "A");
    const rangeB = semesterRanges.find((range) => range.key === "B");
    setRangeDraft({
      A: { start: rangeA?.start || "", end: rangeA?.end || "" },
      B: { start: rangeB?.start || "", end: rangeB?.end || "" }
    });
  }, [semesterRanges]);

  const handleSaveRanges = async () => {
    const next = [
      ...(rangeDraft.A.start && rangeDraft.A.end
        ? [{ key: "A" as const, start: rangeDraft.A.start, end: rangeDraft.A.end }]
        : []),
      ...(rangeDraft.B.start && rangeDraft.B.end
        ? [{ key: "B" as const, start: rangeDraft.B.start, end: rangeDraft.B.end }]
        : [])
    ];
    try {
      await saveSemesterRanges(next);
      showToast("טווחי הסמסטר נשמרו.");
    } catch {
      showToast("שמירת טווחים נכשלה.", "error");
    }
  };

  const handleUpsertUser = async (user: DirectoryUser) => {
    try {
      await upsertUser(user);
      showToast("המשתמש נשמר.");
    } catch {
      showToast("שמירת משתמש נכשלה.", "error");
    }
  };

  const handleRemoveUser = async (email: string) => {
    try {
      await removeUser(email);
      showToast("המשתמש נמחק.");
    } catch {
      showToast("מחיקת משתמש נכשלה.", "error");
    }
  };

  const handleUpsertLesson = async (lesson: LessonRecord) => {
    try {
      await upsertLesson(lesson);
      showToast("השיעור נשמר.");
    } catch {
      showToast("שמירת שיעור נכשלה.", "error");
    }
  };

  const handleRemoveLesson = async (lessonId: string) => {
    try {
      await removeLesson(lessonId);
      showToast("השיעור נמחק.");
    } catch {
      showToast("מחיקת שיעור נכשלה.", "error");
    }
  };

  const handleUpsertRoom = async (room: RoomRecord) => {
    try {
      await upsertRoom(room);
      showToast("החדר נשמר.");
    } catch {
      showToast("שמירת חדר נכשלה.", "error");
    }
  };

  const handleRemoveRoom = async (roomId: string) => {
    try {
      await removeRoom(roomId);
      showToast("החדר נמחק.");
    } catch {
      showToast("מחיקת חדר נכשלה.", "error");
    }
  };

  // Reservation cleanup tool removed; admins can bulk-delete filtered results.

  const menuItems: { key: AdminSection; label: string; icon: JSX.Element }[] = [
    { key: "users", label: "משתמשים", icon: <UserIcon /> },
    { key: "schedule", label: "מערכת שעות", icon: <CalendarIcon /> },
    { key: "rooms", label: "חדרים", icon: <RoomIcon /> }
  ];

  const toolbarTitle =
    activeSection === "users"
      ? "משתמשים"
      : activeSection === "schedule"
        ? "מערכת שעות"
        : activeSection === "rooms"
          ? "חדרים"
          : "מערכת שעות";

  const semestersToolContent = (
    <div className="admin-tool-content">
      {settingsError ? <p className="admin-error">{settingsError}</p> : null}
      <p className="admin-meta">
        אם אין טווחים מוגדרים, המערכת מציגה זמינות חדרים ללא שיעורים (בין סמסטרים).
      </p>
      <div className="admin-form">
        <div className="admin-form-row">
          <label>
            סמסטר א׳ התחלה
            <input
              type="date"
              value={rangeDraft.A.start}
              onChange={(event) =>
                setRangeDraft((prev) => ({
                  ...prev,
                  A: { ...prev.A, start: event.target.value }
                }))
              }
            />
          </label>
          <label>
            סמסטר א׳ סיום
            <input
              type="date"
              value={rangeDraft.A.end}
              onChange={(event) =>
                setRangeDraft((prev) => ({
                  ...prev,
                  A: { ...prev.A, end: event.target.value }
                }))
              }
            />
          </label>
        </div>

        <div className="admin-form-row">
          <label>
            סמסטר ב׳ התחלה
            <input
              type="date"
              value={rangeDraft.B.start}
              onChange={(event) =>
                setRangeDraft((prev) => ({
                  ...prev,
                  B: { ...prev.B, start: event.target.value }
                }))
              }
            />
          </label>
          <label>
            סמסטר ב׳ סיום
            <input
              type="date"
              value={rangeDraft.B.end}
              onChange={(event) =>
                setRangeDraft((prev) => ({
                  ...prev,
                  B: { ...prev.B, end: event.target.value }
                }))
              }
            />
          </label>
        </div>
      </div>
      <div className="admin-actions">
        <button
          className="secondary"
          type="button"
          onClick={() => setRangeDraft({ A: { start: "", end: "" }, B: { start: "", end: "" } })}
        >
          איפוס
        </button>
        <button className="primary" type="button" onClick={handleSaveRanges}>
          שמירה
        </button>
      </div>
    </div>
  );

  const overlayTitle = !activeTool
    ? ""
    : activeTool.kind === "csv"
      ? `ייבוא וייצוא · ${activeTool.section === "users" ? "משתמשים" : "מערכת שעות"}`
      : activeTool.kind === "semesters"
        ? "מאפיינים · מערכת שעות"
        : "";
  const overlayContent = !activeTool ? null : activeTool.kind === "csv" ? (
    <CsvToolContent
      key={`${activeTool.section}:${scheduleFilter}`}
      section={activeTool.section}
      scheduleFilter={scheduleFilter}
      activeSemester={activeSemester}
      users={users}
      lessons={lessonsAll}
      lessonsError={lessonsAllError}
      reservations={reservationList}
      reservationsError={reservationsError}
      showToast={showToast}
    />
  ) : activeTool.kind === "semesters" ? (
    semestersToolContent
  ) : null;

  const mobileMenu = isNarrow && mobileMenuOpen ? (
    <div
      className="admin-mobile-menu-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="תפריט ניהול"
      onClick={() => setMobileMenuOpen(false)}
    >
      <div className="admin-mobile-menu" onClick={(e) => e.stopPropagation()}>
        <div className="admin-mobile-menu-header">
          <div className="admin-mobile-menu-title">תפריט ניהול</div>
          <button
            type="button"
            className="admin-mobile-menu-close"
            aria-label="סגור"
            onClick={() => setMobileMenuOpen(false)}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="admin-mobile-menu-items">
          {menuItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`admin-mobile-menu-item${activeSection === item.key ? " active" : ""}`}
              onClick={() => {
                setActiveSection(item.key);
                setMobileMenuOpen(false);
              }}
            >
              <span className="admin-mobile-menu-icon">{item.icon}</span>
              <span className="admin-mobile-menu-label">{item.label}</span>
            </button>
          ))}
        </div>
        <div className="admin-mobile-menu-footer">
          {onSignOut ? (
            <button
              type="button"
              className="admin-mobile-menu-action"
              onClick={() => {
                setMobileMenuOpen(false);
                onSignOut();
              }}
            >
              <LogoutIcon />
              התנתק
            </button>
          ) : null}
          <button
            type="button"
            className="admin-mobile-menu-action"
            onClick={() => {
              setMobileMenuOpen(false);
              window.location.href = "/";
            }}
          >
            <HomeIcon />
            לדף הבית
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className={`admin-shell${menuCollapsed ? " collapsed" : ""}`}>
      <div className="admin-main">
        <div className="admin-top-toolbar">
          <div className="admin-top-toolbar-row">
            {isNarrow ? (
              <button
                type="button"
                className="admin-mobile-menu-trigger"
                aria-label="פתח תפריט"
                onClick={() => setMobileMenuOpen(true)}
              >
                <MenuIcon />
              </button>
            ) : null}
            <div className="admin-toolbar-title">{toolbarTitle}</div>
            <div className="admin-toolbar-controls">
              <div className="admin-section-tools">
                {bulkState ? (
                  <>
                    {bulkState.actions
                      .filter((action) => {
                        if (bulkState.selectedCount === 0) return action.id === "new";
                        return action.id !== "new";
                      })
                      .sort((a, b) => {
                        const rank = (id: string) => {
                          if (id === "new") return 0;
                          if (id === "edit") return 1;
                          if (id === "delete") return 2;
                          if (id === "duplicate") return 3;
                          return 99;
                        };
                        return rank(a.id) - rank(b.id);
                      })
                      .map((action) => (
                        <button
                          key={action.id}
                          type="button"
                          className={`admin-toolbar-chip admin-bulk-action${action.tone === "danger" ? " danger" : ""}`}
                          onClick={action.onClick}
                          disabled={action.disabled}
                        >
                          {action.icon ? action.icon : null}
                          <span>{action.label}</span>
                        </button>
                      ))}

                    {bulkState.selectAll ? (
                      <BulkSelectAll
                        checked={bulkState.selectAll.checked}
                        indeterminate={bulkState.selectAll.indeterminate}
                        onToggle={bulkState.selectAll.onToggle}
                      />
                    ) : null}
                  </>
                ) : null}

                {bulkState && (activeSection === "users" || activeSection === "schedule") ? (
                  <span className="admin-toolbar-divider" aria-hidden="true" />
                ) : null}

                {activeSection === "users" ? (
                  <button
                    type="button"
                    className={`admin-toolbar-chip${activeTool?.section === "users" && activeTool.kind === "csv" ? " active" : ""}`}
                    onClick={() => toolToggle({ section: "users", kind: "csv" })}
                  >
                    <ImportExportIcon />
                    <span>ייבוא וייצוא</span>
                  </button>
                ) : null}

                {activeSection === "schedule" ? (
                  <>
                    <button
                      type="button"
                      className={`admin-toolbar-chip${activeTool?.section === "schedule" && activeTool.kind === "csv" ? " active" : ""}`}
                      onClick={() => toolToggle({ section: "schedule", kind: "csv" })}
                    >
                      <ImportExportIcon />
                      <span>ייבוא וייצוא</span>
                    </button>
                    <button
                      type="button"
                      className={`admin-toolbar-chip${activeTool?.section === "schedule" && activeTool.kind === "semesters" ? " active" : ""}`}
                      onClick={() => toolToggle({ section: "schedule", kind: "semesters" })}
                    >
                      <TuneIcon />
                      <span>מאפיינים</span>
                    </button>
                  </>
                ) : null}
              </div>

              <div className="admin-toolbar-search">
                {isNarrow ? (
                  <button
                    type="button"
                    className={`admin-toolbar-chip admin-toolbar-search-chip${mobileSearchOpen ? " active" : ""}`}
                    aria-label="חיפוש"
                    onClick={() => setMobileSearchOpen((prev) => !prev)}
                  >
                    <SearchIcon />
                    <span>חיפוש</span>
                  </button>
                ) : (
                  <input
                    className="admin-toolbar-search-input"
                    type="search"
                    value={searchQuery}
                    placeholder={
                      activeSection === "users"
                        ? "חיפוש משתמשים"
                        : activeSection === "schedule"
                          ? "חיפוש מערכת שעות"
                          : "חיפוש חדרים"
                    }
                    onChange={(event) => setSearchQuery(event.target.value)}
                  />
                )}
              </div>
            </div>
          </div>
          {isNarrow && mobileSearchOpen ? (
            <div className="admin-top-toolbar-row admin-top-toolbar-search-row">
              <input
                className="admin-toolbar-search-input mobile"
                type="search"
                value={searchQuery}
                placeholder={
                  activeSection === "users"
                    ? "חיפוש משתמשים"
                    : activeSection === "schedule"
                      ? "חיפוש מערכת שעות"
                      : "חיפוש חדרים"
                }
                onChange={(event) => setSearchQuery(event.target.value)}
                autoFocus
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="icon-button admin-toolbar-search-clear"
                  aria-label="נקה חיפוש"
                  onClick={() => setSearchQuery("")}
                >
                  <CloseIcon />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {toast ? (
          <div className={`admin-toast${toast.tone === "error" ? " error" : ""}`}>
            {toast.message}
          </div>
        ) : null}

        <div className="admin-main-scroll">
	        {activeSection === "users" ? (
	          <UsersSection
	            users={users}
	            pendingUsers={pendingUsers}
	            usersError={usersError}
	            query={searchQuery}
	            userDraft={userDraft}
	            setUserDraft={setUserDraft}
	            currentAcademicYear={currentAcademicYear}
	            onUpsert={handleUpsertUser}
	            onRemove={handleRemoveUser}
            onReset={() =>
              setUserDraft({
                email: "",
                name: "",
                role: "student",
                phone: "",
                cohortStartYear: currentAcademicYear
              })
            }
            onBulkStateChange={setBulkState}
          />
        ) : null}

	        {activeSection === "schedule" ? (
	          <ScheduleSection
	            scheduleFilter={scheduleFilter}
	            setScheduleFilter={setScheduleFilter}
	            query={searchQuery}
	            activeSemester={activeSemester}
	            setActiveSemester={setActiveSemester}
	            lessons={lessons}
	            lessonsError={lessonsError || lessonsAllError}
	            reservations={reservationList}
            reservationsError={reservationsError}
            roomsRaw={roomsRaw}
            toTimeInput={toTimeInput}
            parseTimeInput={parseTimeInput}
            onUpsertLesson={handleUpsertLesson}
            onRemoveLesson={handleRemoveLesson}
            onUpdateReservation={upsertReservation}
            onRemoveReservation={(reservation) => { void releaseReservation(reservation.date, reservation.id); }}
            onBulkStateChange={setBulkState}
          />
        ) : null}

	        {activeSection === "rooms" ? (
	          <RoomsSection
	            roomsRaw={roomsRaw}
	            roomsError={roomsError}
	            query={searchQuery}
	            roomDraft={roomDraft}
	            setRoomDraft={setRoomDraft}
	            toTimeInput={toTimeInput}
	            parseTimeInput={parseTimeInput}
            onUpsert={handleUpsertRoom}
            onRemove={handleRemoveRoom}
            onReset={() =>
              setRoomDraft({
                id: "",
                name: "",
                shortName: "",
                openMinutes: rimonScheduleConfig.startHour * 60,
                closeMinutes: rimonScheduleConfig.endHour * 60,
                isClosed: false,
                sortOrder: 0
              })
            }
            onBulkStateChange={setBulkState}
          />
        ) : null}
        </div>
      </div>

      {overlayOpen ? (
        <div className="admin-tool-overlay" role="dialog" aria-modal="true" onClick={closeTools}>
          <div className="admin-tool-overlay-card" onClick={(event) => event.stopPropagation()}>
            <button
              className="admin-tool-overlay-close"
              type="button"
              aria-label="סגור כלים"
              onClick={closeTools}
            >
              <CloseIcon />
            </button>
            <div className="admin-tool-overlay-heading">
              <h3>{overlayTitle}</h3>
            </div>
            {overlayContent}
          </div>
        </div>
      ) : null}

      {mobileMenu}

      {!isNarrow ? (
      <aside className={`admin-side${menuCollapsed ? " collapsed" : ""}`}>
        <div className="admin-side-header">
          {!isNarrow ? (
            <button
              type="button"
              className="admin-side-toggle"
              onClick={() => setSideCollapsed((prev) => !prev)}
              aria-label="תפריט"
            >
              <MenuIcon />
            </button>
          ) : null}
          {!menuCollapsed ? <span>תפריט ניהול</span> : null}
        </div>
        <nav className="admin-side-menu">
          {menuItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`admin-side-item${activeSection === item.key ? " active" : ""}`}
              onClick={() => setActiveSection(item.key)}
              aria-current={activeSection === item.key ? "page" : undefined}
            >
              <span className="admin-side-icon">{item.icon}</span>
              {!menuCollapsed ? <span className="admin-side-label">{item.label}</span> : null}
            </button>
          ))}
        </nav>
        {isNarrow ? (
          <div className="admin-side-mobile-actions" aria-label="פעולות">
            {onSignOut ? (
              <button className="admin-side-mobile-action" type="button" onClick={onSignOut} aria-label="התנתק">
                <LogoutIcon />
              </button>
            ) : null}
            <button
              type="button"
              className="admin-side-mobile-action"
              onClick={() => (window.location.href = "/")}
              aria-label="לדף הבית"
            >
              <HomeIcon />
            </button>
          </div>
        ) : null}
        {currentUser ? (
          <div className="admin-side-submenu admin-side-user">
            <div className="admin-side-user-row">
              <div className="admin-side-avatar">
                {currentUser.picture ? (
                  <img src={currentUser.picture} alt={currentUser.name || currentUser.email} loading="lazy" />
                ) : (
                  <span>{userInitials}</span>
                )}
              </div>
              {!menuCollapsed ? (
                <div className="admin-side-user-text">
                  <p className="admin-user-name">{currentUser.name || currentUser.email}</p>
                  <p className="admin-user-email">{currentUser.email}</p>
                </div>
              ) : null}
            </div>
            <div className="admin-side-user-actions">
              {!menuCollapsed && onSignOut ? (
                <button className="admin-side-subitem admin-side-logout" type="button" onClick={onSignOut}>
                  <LogoutIcon />
                  <span>התנתק</span>
                </button>
              ) : null}
              <button
                type="button"
                className="admin-side-subitem admin-side-home"
                onClick={() => (window.location.href = "/")}
                aria-label="לדף הבית"
              >
                <HomeIcon />
                {!menuCollapsed ? <span>לדף הבית</span> : null}
              </button>
            </div>
          </div>
        ) : null}
      </aside>
      ) : null}
    </div>
  );
}
