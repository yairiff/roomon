import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { collection, doc, getDocs, writeBatch } from "firebase/firestore";
import { buildLessonsFromCsv } from "../../lib/scheduleBuilder";
import { rimonScheduleConfig } from "../../config";
import { db } from "../../lib/firebase";
import { useDirectoryUsers } from "../../hooks/useDirectoryUsers";
import { useLessons } from "../../hooks/useLessons";
import { useReservations } from "../../hooks/useReservations";
import { useRooms } from "../../hooks/useRooms";
import { useScheduleSettings } from "../../hooks/useScheduleSettings";
import type { User } from "../../types/auth";
import type { LessonRecord, RoomRecord, DirectoryUser } from "../../types/admin";
import type { SemesterKey } from "../../types/ui";
import { getAcademicYearStartYear } from "../../lib/academics";
import type { AdminSection } from "./types";
import { BookmarkIcon, LessonIcon, RoomIcon, MenuIcon, UserIcon, HomeIcon, LogoutIcon, CalendarIcon, ReleaseIcon, CloseIcon, UploadIcon } from "../../components/Icons";
import UsersSection from "./sections/UsersSection";
import LessonsSection from "./sections/LessonsSection";
import RoomsSection from "./sections/RoomsSection";
import ReservationsSection from "./sections/ReservationsSection";

type AdminScreenProps = {
  currentUser: User | null;
  onSignOut?: () => void;
};

const toTimeInput = (minutes: number) => {
  const hrs = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

const parseTimeInput = (value: string) => {
  if (!value) return 0;
  const [hoursText, minutesText = "0"] = value.split(":");
  const hours = Number(hoursText);
  const mins = Number(minutesText);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return 0;
  return hours * 60 + mins;
};

export default function AdminScreen({ currentUser, onSignOut }: AdminScreenProps) {
  const isAdmin = currentUser?.role === "admin";
  const [activeSemester, setActiveSemester] = useState<SemesterKey>("A");
  const [csvText, setCsvText] = useState("");
  const [csvMessage, setCsvMessage] = useState("");
  const [activeSection, setActiveSection] = useState<AdminSection>("users");
  const [clearRange, setClearRange] = useState({ start: "", end: "" });
  const [clearMessage, setClearMessage] = useState("");
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: "success" | "error" } | null>(null);
  const [lessonsTool, setLessonsTool] = useState<"csv" | "semesters" | null>(null);
  const [reservationsToolOpen, setReservationsToolOpen] = useState(false);
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
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const closeTools = useCallback(() => {
    setLessonsTool(null);
    setReservationsToolOpen(false);
  }, []);

  const overlayOpen = lessonsTool !== null || reservationsToolOpen;

  useEffect(() => {
    setLessonsTool(null);
    setReservationsToolOpen(false);
  }, [activeSection]);

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

  const parsedCsv = useMemo(() => {
    if (!csvText.trim()) return null;
    const lessonsA = buildLessonsFromCsv(csvText, rimonScheduleConfig, "A").map((lesson, index) => ({
      ...lesson,
      id: `A-${index}`,
      semester: "A" as const
    }));
    const lessonsB = buildLessonsFromCsv(csvText, rimonScheduleConfig, "B").map((lesson, index) => ({
      ...lesson,
      id: `B-${index}`,
      semester: "B" as const
    }));
    return { lessonsA, lessonsB };
  }, [csvText]);

  const reservationList = useMemo(() => {
    const list = Object.values(reservationMap).flat();
    return list.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.time - b.time;
    });
  }, [reservationMap]);

  const showToast = (message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
  };

  const handleCsvFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      setCsvText(text);
      setCsvMessage("");
    });
  };

  const handleReplaceSchedule = async () => {
    if (!db || !parsedCsv) return;
    try {
      const allLessons = [...parsedCsv.lessonsA, ...parsedCsv.lessonsB];
      const batch = writeBatch(db);
      const existing = await getDocs(collection(db, "lessons"));
      existing.forEach((docSnap) => batch.delete(docSnap.ref));
      allLessons.forEach((lesson) => {
        batch.set(doc(db, "lessons", lesson.id), lesson);
      });
      await batch.commit();
      setCsvMessage(`עודכן: ${allLessons.length} שיעורים נטענו.`);
      showToast("לוח השיעורים עודכן.");
    } catch {
      showToast("החלפת לוח נכשלה.", "error");
    }
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
  const handleApprove = async (user: DirectoryUser) => {
    try {
      await upsertUser({ ...user, role: "student" });
      showToast("משתמש אושר.");
    } catch {
      showToast("אישור נכשל.", "error");
    }
  };

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

  const handleClearReservations = async () => {
    if (!db) {
      setClearMessage("Firestore לא מוגדר.");
      showToast("Firestore לא מוגדר.", "error");
      return;
    }
    if (!clearRange.start || !clearRange.end) {
      setClearMessage("יש לבחור טווח תאריכים מלא.");
      showToast("יש לבחור טווח תאריכים מלא.", "error");
      return;
    }
    if (clearRange.start > clearRange.end) {
      setClearMessage("תאריך ההתחלה מאוחר מתאריך הסיום.");
      showToast("תאריך ההתחלה מאוחר מתאריך הסיום.", "error");
      return;
    }
    try {
      const snapshot = await getDocs(collection(db, "reservations"));
      const refs = snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data() as { date?: string };
          return data.date ? { ref: docSnap.ref, date: data.date } : null;
        })
        .filter((entry): entry is { ref: typeof snapshot.docs[number]["ref"]; date: string } => Boolean(entry))
        .filter((entry) => entry.date >= clearRange.start && entry.date <= clearRange.end)
        .map((entry) => entry.ref);
      if (!refs.length) {
        setClearMessage("לא נמצאו שריונים בטווח הזה.");
        showToast("לא נמצאו שריונים בטווח הזה.");
        return;
      }
      let deleted = 0;
      for (let i = 0; i < refs.length; i += 450) {
        const batch = writeBatch(db);
        const chunk = refs.slice(i, i + 450);
        chunk.forEach((ref) => batch.delete(ref));
        await batch.commit();
        deleted += chunk.length;
      }
      setClearMessage(`נמחקו ${deleted} שריונים.`);
      showToast(`נמחקו ${deleted} שריונים.`);
    } catch {
      showToast("מחיקת שריונים נכשלה.", "error");
    }
  };

  const menuItems: { key: AdminSection; label: string; icon: JSX.Element }[] = [
    { key: "users", label: "משתמשים", icon: <UserIcon /> },
    { key: "lessons", label: "שיעורים", icon: <LessonIcon /> },
    { key: "rooms", label: "חדרים", icon: <RoomIcon /> },
    { key: "reservations", label: "שריונים", icon: <BookmarkIcon /> }
  ];

  const toolbarTitle =
    activeSection === "users"
      ? "משתמשים"
      : activeSection === "lessons"
        ? "שיעורים"
        : activeSection === "rooms"
          ? "חדרים"
          : "שריונים";

  const lessonsToolContent = lessonsTool ? (
    <div className="admin-tool-content">
      {lessonsTool === "csv" ? (
        <div className="admin-csv">
          <p className="admin-meta">ייבוא CSV מחליף את כל השיעורים בלוח הקבוע.</p>
          <input type="file" accept=".csv" onChange={handleCsvFile} />
          <textarea
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
            placeholder="הדבק כאן CSV מלא..."
          />
          {parsedCsv ? (
            <p className="admin-meta">
              נמצאו {parsedCsv.lessonsA.length} שיעורים בסמסטר א׳ ו־{parsedCsv.lessonsB.length} בסמסטר ב׳.
            </p>
          ) : null}
          {csvMessage ? <p className="admin-success">{csvMessage}</p> : null}
          <button className="primary" type="button" onClick={handleReplaceSchedule}>
            החלפת לוח קבוע
          </button>
        </div>
      ) : (
        <div className="admin-csv">
          {settingsError ? <p className="admin-error">{settingsError}</p> : null}
          <p className="admin-meta">
            אם אין טווחים מוגדרים, המערכת מציגה זמינות חדרים ללא שיעורים (בין סמסטרים).
          </p>
          <div className="admin-form-grid">
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
      )}
    </div>
  ) : null;

  const reservationsToolContent = reservationsToolOpen ? (
    <div className="admin-tool-content">
      <p className="admin-meta">פעולה זו מוחקת שריונים קיימים בין התאריכים שנבחרו (כולל).</p>
      <div className="admin-form-grid">
        <label>
          מתאריך
          <input
            type="date"
            value={clearRange.start}
            onChange={(event) => setClearRange((prev) => ({ ...prev, start: event.target.value }))}
          />
        </label>
        <label>
          עד תאריך
          <input
            type="date"
            value={clearRange.end}
            onChange={(event) => setClearRange((prev) => ({ ...prev, end: event.target.value }))}
          />
        </label>
      </div>
      {clearMessage ? <p className="admin-meta">{clearMessage}</p> : null}
      <div className="admin-actions">
        <button
          className="secondary"
          type="button"
          onClick={() => {
            setClearRange({ start: "", end: "" });
            setClearMessage("");
          }}
        >
          איפוס
        </button>
        <button className="primary" type="button" onClick={handleClearReservations}>
          מחיקת שריונים
        </button>
      </div>
    </div>
  ) : null;

  const overlayTitle = lessonsTool
    ? lessonsTool === "csv"
      ? "ייבוא CSV"
      : "טווחי סמסטר"
    : "ניקוי שריונים";

  return (
    <div className={`admin-shell${sideCollapsed ? " collapsed" : ""}`}>
      <div className="admin-main">
        <div className="admin-top-toolbar">
          <div className="admin-top-toolbar-row">
            <div className="admin-toolbar-title">{toolbarTitle}</div>
            <div className="admin-section-tools">
              {activeSection === "lessons" ? (
                <>
                  <button
                    type="button"
                    className={`admin-toolbar-chip${lessonsTool === "csv" ? " active" : ""}`}
                    onClick={() => setLessonsTool((prev) => (prev === "csv" ? null : "csv"))}
                  >
                    <UploadIcon />
                    Import
                  </button>
                  <button
                    type="button"
                    className={`admin-toolbar-chip${lessonsTool === "semesters" ? " active" : ""}`}
                    onClick={() => setLessonsTool((prev) => (prev === "semesters" ? null : "semesters"))}
                  >
                    <CalendarIcon />
                    סמסטרים
                  </button>
                </>
              ) : null}
              {activeSection === "reservations" ? (
                <button
                  type="button"
                  className={`admin-toolbar-chip${reservationsToolOpen ? " active" : ""}`}
                  onClick={() => setReservationsToolOpen((prev) => !prev)}
                >
                  <ReleaseIcon />
                  ניקוי שריונים
                </button>
              ) : null}
            </div>
          </div>
        </div>
        {toast ? (
          <div className={`admin-toast${toast.tone === "error" ? " error" : ""}`}>
            {toast.message}
          </div>
        ) : null}

        {activeSection === "users" ? (
          <UsersSection
            users={users}
            pendingUsers={pendingUsers}
            usersError={usersError}
            userDraft={userDraft}
            setUserDraft={setUserDraft}
            currentAcademicYear={currentAcademicYear}
            onApprove={handleApprove}
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
          />
        ) : null}

        {activeSection === "lessons" ? (
          <LessonsSection
            lessons={lessons}
            lessonsError={lessonsError}
            activeSemester={activeSemester}
            setActiveSemester={setActiveSemester}
            lessonDraft={lessonDraft}
            setLessonDraft={setLessonDraft}
            roomsRaw={roomsRaw}
            toTimeInput={toTimeInput}
            parseTimeInput={parseTimeInput}
            onUpsert={handleUpsertLesson}
            onRemove={handleRemoveLesson}
            onReset={() =>
              setLessonDraft({
                id: "",
                title: "",
                teacher: "",
                day: "sun",
                roomId: roomsRaw[0]?.id || "",
                startMinutes: rimonScheduleConfig.startHour * 60,
                durationMinutes: rimonScheduleConfig.academicHourMinutes,
                semester: activeSemester
              })
            }
          />
        ) : null}

        {activeSection === "rooms" ? (
          <RoomsSection
            roomsRaw={roomsRaw}
            roomsError={roomsError}
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
          />
        ) : null}

        {activeSection === "reservations" ? (
          <ReservationsSection
            reservations={reservationList}
            reservationsError={reservationsError}
            roomsRaw={roomsRaw}
            toTimeInput={toTimeInput}
            onRemoveReservation={(reservation) => releaseReservation(reservation.date, reservation.id)}
            onUpdateReservation={upsertReservation}
          />
        ) : null}
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
            {lessonsTool ? lessonsToolContent : reservationsToolContent}
          </div>
        </div>
      ) : null}

      <aside className={`admin-side${sideCollapsed ? " collapsed" : ""}`}>
        <div className="admin-side-header">
          <button
            type="button"
            className="admin-side-toggle"
            onClick={() => setSideCollapsed((prev) => !prev)}
            aria-label="תפריט"
          >
            <MenuIcon />
          </button>
          {!sideCollapsed ? <span>תפריט ניהול</span> : null}
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
              {!sideCollapsed ? <span className="admin-side-label">{item.label}</span> : null}
            </button>
          ))}
        </nav>
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
              {!sideCollapsed ? (
                <div className="admin-side-user-text">
                  <p className="admin-user-name">{currentUser.name || currentUser.email}</p>
                  <p className="admin-user-email">{currentUser.email}</p>
                </div>
              ) : null}
            </div>
            <div className="admin-side-user-actions">
              {!sideCollapsed && onSignOut ? (
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
                {!sideCollapsed ? <span>לדף הבית</span> : null}
              </button>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
