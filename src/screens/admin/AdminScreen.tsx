import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { collection, doc, getDocs, writeBatch } from "firebase/firestore";
import { rimonScheduleConfig } from "../../config";
import { db } from "../../lib/firebase";
import { useDirectoryUsers } from "../../hooks/useDirectoryUsers";
import { useLessons } from "../../hooks/useLessons";
import { useReservations } from "../../hooks/useReservations";
import { useRooms } from "../../hooks/useRooms";
import { useScheduleSettings } from "../../hooks/useScheduleSettings";
import type { User } from "../../types/auth";
import type { LessonRecord, RoomRecord, DirectoryUser, UserRole } from "../../types/admin";
import type { SemesterKey } from "../../types/ui";
import type { Reservation } from "../../types/reservations";
import { cohortStartYearFromGrade, getAcademicYearStartYear, gradeValueFromCohort } from "../../lib/academics";
import type { AdminSection } from "./types";
import { BookmarkIcon, LessonIcon, RoomIcon, MenuIcon, UserIcon, HomeIcon, LogoutIcon, CalendarIcon, ReleaseIcon, CloseIcon, UploadIcon, DownloadIcon } from "../../components/Icons";
import { parseCsvAsObjects, stringifyCsv } from "../../lib/csv";
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
  const [activeSection, setActiveSection] = useState<AdminSection>("users");
  const [clearRange, setClearRange] = useState({ start: "", end: "" });
  const [clearMessage, setClearMessage] = useState("");
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: "success" | "error" } | null>(null);
  const [activeTool, setActiveTool] = useState<
    | null
    | {
        section: "users" | "lessons" | "reservations";
        kind: "csv_import" | "csv_export" | "semesters" | "clear_reservations";
      }
  >(null);
  const [importMode, setImportMode] = useState<"override" | "add">("add");
  const [importText, setImportText] = useState("");
  const [importMessage, setImportMessage] = useState("");
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
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const closeTools = useCallback(() => {
    setActiveTool(null);
    setImportText("");
    setImportMessage("");
    setImportMode("add");
  }, []);

  const overlayOpen = activeTool !== null;

  useEffect(() => {
    setActiveTool(null);
    setImportText("");
    setImportMessage("");
    setImportMode("add");
    setClearMessage("");
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

  const showToast = (message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
  };

  const toolToggle = (tool: NonNullable<typeof activeTool>) => {
    setActiveTool((prev) => {
      if (prev && prev.section === tool.section && prev.kind === tool.kind) return null;
      return tool;
    });
  };

  const parseTimeStrict = (value: string) => {
    const trimmed = value.trim();
    if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return null;
    const minutes = parseTimeInput(trimmed);
    if (!Number.isFinite(minutes) || minutes < 0) return null;
    const [h, m] = trimmed.split(":").map((part) => Number(part));
    if (h > 23 || m > 59) return null;
    return minutes;
  };

  const userCsvHeaders = ["email", "name", "role", "phone", "grade"];
  const lessonCsvHeaders = ["semester", "day", "startTime", "durationMinutes", "roomId", "title", "teacher"];
  const reservationCsvHeaders = ["date", "roomId", "time", "durationMinutes", "reservedBy", "reservedEmail", "kind"];

  const exportPayload = useMemo(() => {
    if (!activeTool || activeTool.kind !== "csv_export") return null;
    if (activeTool.section === "users") {
      const rows = users.map((u) => ({
        email: u.email,
        name: u.name || "",
        role: u.role || "student",
        phone: u.phone || "",
        grade: u.cohortStartYear ? gradeValueFromCohort(u.cohortStartYear) : ""
      }));
      return { filename: "users.csv", csv: stringifyCsv(userCsvHeaders, rows) };
    }
    if (activeTool.section === "lessons") {
      const rows = lessonsAll.map((l) => ({
        semester: l.semester,
        day: l.day,
        startTime: toTimeInput(l.startMinutes),
        durationMinutes: l.durationMinutes,
        roomId: l.roomId,
        title: l.title || "",
        teacher: l.teacher || ""
      }));
      return { filename: "lessons.csv", csv: stringifyCsv(lessonCsvHeaders, rows) };
    }
    const rows = reservationList.map((r) => ({
      date: r.date,
      roomId: r.roomId,
      time: toTimeInput(r.time),
      durationMinutes: r.durationMinutes || 60,
      reservedBy: r.reservedBy || "",
      reservedEmail: r.reservedEmail || "",
      kind: r.kind || "regular"
    }));
    return { filename: "reservations.csv", csv: stringifyCsv(reservationCsvHeaders, rows) };
  }, [activeTool, lessonsAll, reservationList, users]);

  const downloadTextFile = (filename: string, content: string, mime = "text/csv;charset=utf-8") => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      setImportText(text);
      setImportMessage("");
    });
  };

  const importUsersFromCsv = (text: string) => {
    const { rows } = parseCsvAsObjects(text);
    const errors: string[] = [];
    const next: DirectoryUser[] = [];
    const seen = new Set<string>();

    rows.forEach((row, idx) => {
      const email = (row.email || "").toLowerCase();
      if (!email) {
        errors.push(`שורה ${idx + 2}: חסר email`);
        return;
      }
      if (seen.has(email)) return;
      seen.add(email);

      const roleRaw = (row.role || "student").toLowerCase() as UserRole;
      const role: UserRole =
        roleRaw === "admin" || roleRaw === "moderator" || roleRaw === "student" || roleRaw === "pending"
          ? roleRaw
          : "student";

      const gradeRaw = (row.grade || "").trim().toUpperCase();
      const grade = gradeRaw === "A" || gradeRaw === "B" || gradeRaw === "C"
        ? (gradeRaw as "A" | "B" | "C")
        : gradeRaw === "א"
          ? "A"
          : gradeRaw === "ב"
            ? "B"
            : gradeRaw === "ג"
              ? "C"
              : null;

      next.push({
        email,
        name: row.name || "",
        role,
        phone: row.phone || "",
        cohortStartYear: grade ? cohortStartYearFromGrade(grade) : undefined
      });
    });

    return { users: next, errors };
  };

  const lessonIdFromRow = (semester: SemesterKey, day: LessonRecord["day"], roomId: string, startMinutes: number) =>
    `lesson_${semester}_${day}_${roomId}_${startMinutes}`;

  const importLessonsFromCsv = (text: string) => {
    const { rows } = parseCsvAsObjects(text);
    const errors: string[] = [];
    const next: LessonRecord[] = [];
    const seen = new Set<string>();

    rows.forEach((row, idx) => {
      const semesterRaw = (row.semester || activeSemester).trim().toUpperCase();
      const semester = semesterRaw === "A" || semesterRaw === "B" ? (semesterRaw as SemesterKey) : activeSemester;
      const day = (row.day || "").trim() as LessonRecord["day"];
      if (!day) {
        errors.push(`שורה ${idx + 2}: חסר day`);
        return;
      }
      const roomId = (row.roomId || "").trim();
      if (!roomId) {
        errors.push(`שורה ${idx + 2}: חסר roomId`);
        return;
      }
      const startMinutes = parseTimeStrict(row.startTime || "");
      if (startMinutes === null) {
        errors.push(`שורה ${idx + 2}: startTime לא תקין (HH:MM)`);
        return;
      }
      const durationMinutes = row.durationMinutes ? Number(row.durationMinutes) : rimonScheduleConfig.academicHourMinutes;
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        errors.push(`שורה ${idx + 2}: durationMinutes לא תקין`);
        return;
      }

      const id = lessonIdFromRow(semester, day, roomId, startMinutes);
      if (seen.has(id)) return;
      seen.add(id);
      next.push({
        id,
        semester,
        day,
        roomId,
        startMinutes,
        durationMinutes,
        title: row.title || "",
        teacher: row.teacher || ""
      });
    });

    return { lessons: next, errors };
  };

  const reservationIdFromRow = (date: string, roomId: string, timeMinutes: number) =>
    `res_${date}_${roomId}_${timeMinutes}`;

  const importReservationsFromCsv = (text: string) => {
    const { rows } = parseCsvAsObjects(text);
    const errors: string[] = [];
    const next: Reservation[] = [];
    const seen = new Set<string>();

    rows.forEach((row, idx) => {
      const date = (row.date || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        errors.push(`שורה ${idx + 2}: date לא תקין (YYYY-MM-DD)`);
        return;
      }
      const roomId = (row.roomId || "").trim();
      if (!roomId) {
        errors.push(`שורה ${idx + 2}: חסר roomId`);
        return;
      }
      const timeMinutes = parseTimeStrict(row.time || "");
      if (timeMinutes === null) {
        errors.push(`שורה ${idx + 2}: time לא תקין (HH:MM)`);
        return;
      }
      const durationMinutes = row.durationMinutes ? Number(row.durationMinutes) : 60;
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        errors.push(`שורה ${idx + 2}: durationMinutes לא תקין`);
        return;
      }
      const kindRaw = (row.kind || "").trim().toLowerCase();
      const kind = kindRaw === "special" || kindRaw === "closed" ? (kindRaw as "special" | "closed") : undefined;
      const id = reservationIdFromRow(date, roomId, timeMinutes);
      if (seen.has(id)) return;
      seen.add(id);
      next.push({
        id,
        date,
        time: timeMinutes,
        durationMinutes,
        roomId,
        reservedBy: row.reservedBy || "",
        reservedEmail: row.reservedEmail || "",
        kind
      });
    });

    return { reservations: next, errors };
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
    { key: "reservations", label: "שיעורים ואירועים", icon: <BookmarkIcon /> },
    { key: "rooms", label: "חדרים", icon: <RoomIcon /> }
  ];

  const toolbarTitle =
    activeSection === "users"
      ? "משתמשים"
      : activeSection === "lessons"
        ? "שיעורים"
        : activeSection === "rooms"
          ? "חדרים"
          : "שיעורים ואירועים";

  const semestersToolContent = (
    <div className="admin-tool-content">
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
  );

  const clearReservationsToolContent = (
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
  );

  const importPreview = useMemo(() => {
    if (!activeTool || activeTool.kind !== "csv_import") return null;
    if (!importText.trim()) return null;
    if (activeTool.section === "users") return importUsersFromCsv(importText);
    if (activeTool.section === "lessons") return importLessonsFromCsv(importText);
    return importReservationsFromCsv(importText);
  }, [activeSemester, activeTool, importText]);

  const handleRunCsvImport = async () => {
    if (!db) {
      showToast("Firestore לא מוגדר.", "error");
      return;
    }
    if (!activeTool || activeTool.kind !== "csv_import") return;
    if (!importText.trim()) {
      setImportMessage("בחר קובץ CSV כדי להמשיך.");
      return;
    }

    if (activeTool.section === "users") {
      const parsed = importUsersFromCsv(importText);
      if (parsed.errors.length) {
        setImportMessage(`נמצאו שגיאות: ${parsed.errors.slice(0, 5).join(" | ")}`);
        showToast("ייבוא נכשל: יש שגיאות בקובץ.", "error");
        return;
      }
      const existingEmails = new Set(users.map((u) => u.email.toLowerCase()));
      const toWrite = importMode === "add" ? parsed.users.filter((u) => !existingEmails.has(u.email)) : parsed.users;
      try {
        if (importMode === "override") {
          const snapshot = await getDocs(collection(db, "users"));
          const refs = snapshot.docs.map((d) => d.ref);
          for (let i = 0; i < refs.length; i += 450) {
            const batch = writeBatch(db);
            refs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
            await batch.commit();
          }
        }
        for (let i = 0; i < toWrite.length; i += 450) {
          const batch = writeBatch(db);
          toWrite.slice(i, i + 450).forEach((u) => {
            batch.set(doc(db, "users", u.email.toLowerCase()), {
              ...u,
              email: u.email.toLowerCase(),
              phone: u.phone || "",
              cohortStartYear: u.cohortStartYear ?? null
            });
          });
          await batch.commit();
        }
        setImportMessage(`יובאו ${toWrite.length} משתמשים.`);
        showToast("ייבוא משתמשים הושלם.");
      } catch {
        showToast("ייבוא משתמשים נכשל.", "error");
      }
      return;
    }

    if (activeTool.section === "lessons") {
      const parsed = importLessonsFromCsv(importText);
      if (parsed.errors.length) {
        setImportMessage(`נמצאו שגיאות: ${parsed.errors.slice(0, 5).join(" | ")}`);
        showToast("ייבוא נכשל: יש שגיאות בקובץ.", "error");
        return;
      }
      const existingIds = new Set(lessonsAll.map((l) => l.id));
      const toWrite = importMode === "add" ? parsed.lessons.filter((l) => !existingIds.has(l.id)) : parsed.lessons;
      try {
        if (importMode === "override") {
          const snapshot = await getDocs(collection(db, "lessons"));
          const refs = snapshot.docs.map((d) => d.ref);
          for (let i = 0; i < refs.length; i += 450) {
            const batch = writeBatch(db);
            refs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
            await batch.commit();
          }
        }
        for (let i = 0; i < toWrite.length; i += 450) {
          const batch = writeBatch(db);
          toWrite.slice(i, i + 450).forEach((l) => {
            batch.set(doc(db, "lessons", l.id), l);
          });
          await batch.commit();
        }
        setImportMessage(`יובאו ${toWrite.length} שיעורים.`);
        showToast("ייבוא שיעורים הושלם.");
      } catch {
        showToast("ייבוא שיעורים נכשל.", "error");
      }
      return;
    }

    const parsed = importReservationsFromCsv(importText);
    if (parsed.errors.length) {
      setImportMessage(`נמצאו שגיאות: ${parsed.errors.slice(0, 5).join(" | ")}`);
      showToast("ייבוא נכשל: יש שגיאות בקובץ.", "error");
      return;
    }
    const existingIds = new Set(reservationList.map((r) => r.id));
    const toWrite = importMode === "add" ? parsed.reservations.filter((r) => !existingIds.has(r.id)) : parsed.reservations;
    try {
      if (importMode === "override") {
        const snapshot = await getDocs(collection(db, "reservations"));
        const refs = snapshot.docs.map((d) => d.ref);
        for (let i = 0; i < refs.length; i += 450) {
          const batch = writeBatch(db);
          refs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
          await batch.commit();
        }
      }
      for (let i = 0; i < toWrite.length; i += 450) {
        const batch = writeBatch(db);
        toWrite.slice(i, i + 450).forEach((r) => {
          batch.set(doc(db, "reservations", r.id), r);
        });
        await batch.commit();
      }
      setImportMessage(`יובאו ${toWrite.length} שריונים.`);
      showToast("ייבוא שריונים הושלם.");
    } catch {
      showToast("ייבוא שריונים נכשל.", "error");
    }
  };

  const overlayTitle = !activeTool
    ? ""
    : activeTool.kind === "csv_export"
      ? "ייצוא CSV"
      : activeTool.kind === "csv_import"
        ? "ייבוא CSV"
        : activeTool.kind === "semesters"
          ? "טווחי סמסטר"
          : "ניקוי שריונים";

  const distinctHelp =
    !activeTool || activeTool.kind !== "csv_import"
      ? ""
      : activeTool.section === "users"
        ? "email"
        : activeTool.section === "lessons"
          ? "semester, day, roomId, startTime"
          : "date, roomId, time";

  const overlayContent = !activeTool ? null : activeTool.kind === "csv_export" ? (
    <div className="admin-tool-content">
      <p className="admin-meta">הורד קובץ CSV, ערוך אותו והעלה חזרה דרך ייבוא.</p>
      {activeTool.section === "lessons" && lessonsAllError ? <p className="admin-error">{lessonsAllError}</p> : null}
      <div className="admin-actions">
        <button
          className="primary"
          type="button"
          onClick={() => {
            if (!exportPayload) return;
            downloadTextFile(exportPayload.filename, exportPayload.csv);
          }}
          disabled={!exportPayload}
        >
          <DownloadIcon />
          הורדה
        </button>
      </div>
      {exportPayload ? (
        <textarea value={exportPayload.csv} readOnly className="admin-csv-preview" />
      ) : null}
    </div>
  ) : activeTool.kind === "csv_import" ? (
    <div className="admin-tool-content">
      <input type="file" accept=".csv" onChange={handleImportFile} />
      <div className="admin-import-modes">
        <label>
          <input type="radio" name="importMode" checked={importMode === "add"} onChange={() => setImportMode("add")} />
          הוספת חדשים בלבד
          <span className="admin-radio-help">- (בדיקה לפי השדות: {distinctHelp})</span>
        </label>
        <label>
          <input
            type="radio"
            name="importMode"
            checked={importMode === "override"}
            onChange={() => setImportMode("override")}
          />
          דריסה מלאה
          <span className="admin-radio-help">- החלפת כל המידע במערכת בנתונים מהקובץ</span>
        </label>
      </div>
      {importPreview ? (
        <p className="admin-meta">
          נמצאו{" "}
          {"users" in importPreview
            ? importPreview.users.length
            : "lessons" in importPreview
              ? importPreview.lessons.length
              : importPreview.reservations.length}{" "}
          רשומות{importPreview.errors.length ? ` · שגיאות: ${importPreview.errors.length}` : ""}
        </p>
      ) : null}
      {importMessage ? <p className="admin-meta">{importMessage}</p> : null}
      <div className="admin-actions">
        <button className="primary" type="button" onClick={handleRunCsvImport}>
          <UploadIcon />
          ייבוא
        </button>
      </div>
    </div>
  ) : activeTool.kind === "semesters" ? (
    semestersToolContent
  ) : (
    clearReservationsToolContent
  );

  return (
    <div className={`admin-shell${sideCollapsed ? " collapsed" : ""}`}>
      <div className="admin-main">
        <div className="admin-top-toolbar">
          <div className="admin-top-toolbar-row">
            <div className="admin-toolbar-title">{toolbarTitle}</div>
            <div className="admin-section-tools">
              {activeSection === "users" ? (
                <>
                  <button
                    type="button"
                    className={`admin-toolbar-chip${activeTool?.section === "users" && activeTool.kind === "csv_export" ? " active" : ""}`}
                    onClick={() => toolToggle({ section: "users", kind: "csv_export" })}
                  >
                    <DownloadIcon />
                    ייצוא
                  </button>
                  <button
                    type="button"
                    className={`admin-toolbar-chip${activeTool?.section === "users" && activeTool.kind === "csv_import" ? " active" : ""}`}
                    onClick={() => toolToggle({ section: "users", kind: "csv_import" })}
                  >
                    <UploadIcon />
                    ייבוא
                  </button>
                </>
              ) : null}
              {activeSection === "lessons" ? (
                <>
                  <button
                    type="button"
                    className={`admin-toolbar-chip${activeTool?.section === "lessons" && activeTool.kind === "csv_export" ? " active" : ""}`}
                    onClick={() => toolToggle({ section: "lessons", kind: "csv_export" })}
                  >
                    <DownloadIcon />
                    ייצוא
                  </button>
                  <button
                    type="button"
                    className={`admin-toolbar-chip${activeTool?.section === "lessons" && activeTool.kind === "csv_import" ? " active" : ""}`}
                    onClick={() => toolToggle({ section: "lessons", kind: "csv_import" })}
                  >
                    <UploadIcon />
                    ייבוא
                  </button>
                  <button
                    type="button"
                    className={`admin-toolbar-chip${activeTool?.section === "lessons" && activeTool.kind === "semesters" ? " active" : ""}`}
                    onClick={() => toolToggle({ section: "lessons", kind: "semesters" })}
                  >
                    <CalendarIcon />
                    סמסטרים
                  </button>
                </>
              ) : null}
              {activeSection === "reservations" ? (
                <>
                  <button
                    type="button"
                    className={`admin-toolbar-chip${activeTool?.section === "reservations" && activeTool.kind === "csv_export" ? " active" : ""}`}
                    onClick={() => toolToggle({ section: "reservations", kind: "csv_export" })}
                  >
                    <DownloadIcon />
                    ייצוא
                  </button>
                  <button
                    type="button"
                    className={`admin-toolbar-chip${activeTool?.section === "reservations" && activeTool.kind === "csv_import" ? " active" : ""}`}
                    onClick={() => toolToggle({ section: "reservations", kind: "csv_import" })}
                  >
                    <UploadIcon />
                    ייבוא
                  </button>
                  <button
                    type="button"
                    className={`admin-toolbar-chip${activeTool?.section === "reservations" && activeTool.kind === "clear_reservations" ? " active" : ""}`}
                    onClick={() => toolToggle({ section: "reservations", kind: "clear_reservations" })}
                  >
                    <ReleaseIcon />
                    ניקוי שריונים
                  </button>
                </>
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
            {overlayContent}
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
