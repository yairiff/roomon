import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { collection, doc, writeBatch } from "firebase/firestore";
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
import type { BulkState } from "./bulk";
import { LessonIcon, RoomIcon, MenuIcon, UserIcon, HomeIcon, LogoutIcon, CalendarIcon, ReleaseIcon, CloseIcon, UploadIcon, DownloadIcon } from "../../components/Icons";
import { parseCsvAsObjects, stringifyCsv } from "../../lib/csv";
import { stripUndefined } from "../../lib/stripUndefined";
import UsersSection from "./sections/UsersSection";
import RoomsSection from "./sections/RoomsSection";
import ScheduleSection from "./sections/ScheduleSection";

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
  const [scheduleFilter, setScheduleFilter] = useState<"all" | "lessons" | "regular" | "special" | "closed">("all");
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: "success" | "error" } | null>(null);
  const [bulkState, setBulkState] = useState<BulkState | null>(null);
  const [activeTool, setActiveTool] = useState<
    | null
    | {
        section: "users" | "schedule";
        kind: "csv" | "semesters";
      }
  >(null);
  const [csvStep, setCsvStep] = useState<1 | 2 | 3 | 4>(1);
  const [csvTable, setCsvTable] = useState<
    "users" | "lessons" | "reservations" | "special" | "closed"
  >("users");
  const [importMode, setImportMode] = useState<"add" | "diff" | "override">("add");
  const [importText, setImportText] = useState("");
  const [importFileName, setImportFileName] = useState("");
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

  const BulkSelectAll = ({
    checked,
    indeterminate,
    onToggle
  }: NonNullable<BulkState["selectAll"]>) => {
    const ref = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
      if (!ref.current) return;
      ref.current.indeterminate = indeterminate;
    }, [indeterminate]);

    return (
      <label className="admin-toolbar-chip admin-bulk-select">
        <input
          ref={ref}
          type="checkbox"
          className="admin-row-check"
          checked={checked}
          onChange={onToggle}
          aria-label="בחר הכל"
        />
        <span>בחירה</span>
        <span className="admin-bulk-count">
          {bulkState ? `${bulkState.selectedCount}/${bulkState.totalCount}` : ""}
        </span>
      </label>
    );
  };

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
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const closeTools = useCallback(() => {
    setActiveTool(null);
    setImportText("");
    setImportFileName("");
    setImportMessage("");
    setImportMode("add");
  }, []);

  const overlayOpen = activeTool !== null;
  const menuCollapsed = sideCollapsed && !isNarrow;
  const prevToolRef = useRef<typeof activeTool>(null);

  useEffect(() => {
    const prev = prevToolRef.current;
    prevToolRef.current = activeTool;
    if (!activeTool || activeTool.kind !== "csv") return;
    const isNewOpen = !prev || prev.kind !== "csv" || prev.section !== activeTool.section;
    if (!isNewOpen) return;

    setImportText("");
    setImportFileName("");
    setImportMessage("");
    setImportMode("add");
    setCsvStep(1);
    if (activeTool.section === "users") {
      setCsvTable("users");
      return;
    }
    const table =
      scheduleFilter === "lessons"
        ? "lessons"
        : scheduleFilter === "regular"
          ? "reservations"
          : scheduleFilter === "special"
            ? "special"
            : scheduleFilter === "closed"
              ? "closed"
              : "lessons";
    setCsvTable(table);
  }, [activeTool, scheduleFilter]);

  useEffect(() => {
    setActiveTool(null);
    setImportText("");
    setImportFileName("");
    setImportMessage("");
    setImportMode("add");
    setScheduleFilter("all");
    setBulkState(null);
    setCsvStep(1);
    setCsvTable("users");
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
  const lessonsCsvHeaders = ["semester", "day", "roomId", "startTime", "endTime", "title", "teacher"];
  const reservationsCsvHeaders = ["date", "roomId", "startTime", "endTime", "reservedBy", "reservedEmail"];
  const specialCsvHeaders = ["date", "roomId", "startTime", "endTime", "label"];
  const closedCsvHeaders = ["date", "roomId", "startTime", "endTime", "label"];

  type CsvHelpRow = { key: string; value: string };

  const renderCsvHelp = (rows: CsvHelpRow[]) => (
    <div className="admin-csv-help-card" aria-label="שדות CSV">
      <div className="admin-csv-help-title">שדות בקובץ</div>
      <div className="admin-csv-help">
        {rows.map((row) => (
          <div key={row.key} className="admin-csv-help-row">
            <div className="admin-csv-help-key">{row.key}</div>
            <div className="admin-csv-help-value">{row.value}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const usersCsvHelp = renderCsvHelp([
    { key: "email", value: "אימייל (מזהה ייחודי)" },
    { key: "name", value: "שם תצוגה" },
    { key: "role", value: "student (משתמש) / moderator (מתאם) / admin (מנהל) / pending (ממתין)" },
    { key: "phone", value: "טלפון (אופציונלי)" },
    { key: "grade", value: "A / B / C / STAFF (אפשר גם א/ב/ג/צוות). אם grade=צוות ו-role ריק → ברירת מחדל moderator" }
  ]);

  const scheduleCsvHelp = (table: "lessons" | "reservations" | "special" | "closed") => {
    const rows =
      table === "lessons"
        ? [
            { key: "semester", value: "A / B (אופציונלי, ברירת מחדל: הסמסטר הפעיל)" },
            { key: "day", value: "sun / mon / tue / wed / thu" },
            { key: "roomId", value: "מזהה חדר" },
            { key: "startTime", value: "HH:MM (למשל 09:00)" },
            { key: "endTime", value: "HH:MM (למשל 10:30)" },
            { key: "title", value: "שם שיעור" },
            { key: "teacher", value: "מרצה" }
          ]
        : table === "reservations"
          ? [
              { key: "date", value: "YYYY-MM-DD" },
              { key: "roomId", value: "מזהה חדר" },
              { key: "startTime", value: "HH:MM" },
              { key: "endTime", value: "HH:MM" },
              { key: "reservedBy", value: "שם" },
              { key: "reservedEmail", value: "אימייל" }
            ]
          : [
              { key: "date", value: "YYYY-MM-DD" },
              { key: "roomId", value: "מזהה חדר" },
              { key: "startTime", value: "HH:MM" },
              { key: "endTime", value: "HH:MM" },
              { key: "label", value: table === "special" ? "תיאור אירוע" : "תיאור סגירה" }
            ];

    return renderCsvHelp(rows);
  };

  const exportPayload = useMemo(() => {
    if (!activeTool || activeTool.kind !== "csv") return null;
    if (activeTool.section === "users") {
      const rows = users.map((u) => ({
        email: u.email,
        name: u.name || "",
        role: u.role || "student",
        phone: u.phone || "",
        grade: u.cohortStartYear ? gradeValueFromCohort(u.cohortStartYear) : "צוות"
      }));
      return { filename: "users.csv", csv: stringifyCsv(userCsvHeaders, rows) };
    }
    if (csvTable === "lessons") {
      const rows = lessonsAll.map((l) => ({
        semester: l.semester || activeSemester,
        day: l.day,
        roomId: l.roomId,
        startTime: toTimeInput(l.startMinutes),
        endTime: toTimeInput(l.startMinutes + l.durationMinutes),
        title: l.title || "",
        teacher: l.teacher || ""
      }));
      return { filename: "lessons.csv", csv: stringifyCsv(lessonsCsvHeaders, rows) };
    }

    if (csvTable === "reservations") {
      const rows = reservationList
        .filter((r) => !r.kind)
        .map((r) => ({
          date: r.date,
          roomId: r.roomId,
          startTime: toTimeInput(r.time),
          endTime: toTimeInput(r.time + (r.durationMinutes || 60)),
          reservedBy: r.reservedBy || "",
          reservedEmail: r.reservedEmail || ""
        }));
      return { filename: "reservations.csv", csv: stringifyCsv(reservationsCsvHeaders, rows) };
    }

    if (csvTable === "special") {
      const rows = reservationList
        .filter((r) => r.kind === "special")
        .map((r) => ({
          date: r.date,
          roomId: r.roomId,
          startTime: toTimeInput(r.time),
          endTime: toTimeInput(r.time + (r.durationMinutes || 60)),
          label: r.reservedBy || ""
        }));
      return { filename: "special.csv", csv: stringifyCsv(specialCsvHeaders, rows) };
    }

    const rows = reservationList
      .filter((r) => r.kind === "closed")
      .map((r) => ({
        date: r.date,
        roomId: r.roomId,
        startTime: toTimeInput(r.time),
        endTime: toTimeInput(r.time + (r.durationMinutes || 60)),
        label: r.reservedBy || ""
      }));
    return { filename: "closed.csv", csv: stringifyCsv(closedCsvHeaders, rows) };
  }, [
    activeSemester,
    activeTool,
    csvTable,
    lessonsAll,
    reservationList,
    users
  ]);

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
    setImportFileName(file.name || "");
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

      const roleCell = String(row.role || "").trim();
      const roleNormalized = roleCell.toLowerCase();
      const roleAlias = roleNormalized === "משתמש" || roleNormalized === "user"
        ? "student"
        : roleNormalized === "מנהל"
          ? "admin"
          : roleNormalized === "מתאם"
            ? "moderator"
            : roleNormalized === "ממתין"
              ? "pending"
              : roleNormalized;

      const roleRaw = (roleAlias || "student").toLowerCase() as UserRole;
      const role: UserRole =
        roleRaw === "admin" || roleRaw === "moderator" || roleRaw === "student" || roleRaw === "pending"
          ? roleRaw
          : "student";

      const gradeRaw = (row.grade || "").trim().toUpperCase();
      const isStaffGrade = gradeRaw === "STAFF" || gradeRaw === "TEAM" || gradeRaw === "צוות";
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
        role: !roleCell && isStaffGrade ? "moderator" : role,
        phone: row.phone || "",
        cohortStartYear: isStaffGrade ? undefined : (grade ? cohortStartYearFromGrade(grade) : undefined)
      });
    });

    return { users: next, errors };
  };

  const lessonIdFromRow = (semester: SemesterKey, day: LessonRecord["day"], roomId: string, startMinutes: number) =>
    `lesson_${semester}_${day}_${roomId}_${startMinutes}`;

  const parseEndMinutesFromRow = (
    row: Record<string, string>,
    idx: number,
    startMinutes: number,
    defaultDuration: number
  ) => {
    const endText = (row.endTime || "").trim();
    if (endText) {
      const endMinutes = parseTimeStrict(endText);
      if (endMinutes === null) {
        return { endMinutes: null, error: `שורה ${idx + 2}: endTime לא תקין (HH:MM)` };
      }
      if (endMinutes <= startMinutes) {
        return { endMinutes: null, error: `שורה ${idx + 2}: endTime חייב להיות אחרי startTime` };
      }
      return { endMinutes, error: "" };
    }

    // Backward compatible: durationMinutes (optional).
    const durationMinutes = row.durationMinutes ? Number(row.durationMinutes) : defaultDuration;
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return { endMinutes: null, error: `שורה ${idx + 2}: durationMinutes לא תקין` };
    }
    return { endMinutes: startMinutes + durationMinutes, error: "" };
  };

  const importLessonsFromCsv = (text: string) => {
    const { rows } = parseCsvAsObjects(text);
    const errors: string[] = [];
    const lessonsNext: LessonRecord[] = [];
    const seenLessons = new Set<string>();
    const semesters = new Set<SemesterKey>();

    rows.forEach((row, idx) => {
      const semesterRaw = (row.semester || "").trim().toUpperCase();
      const semester = semesterRaw
        ? (semesterRaw === "A" || semesterRaw === "B" ? (semesterRaw as SemesterKey) : null)
        : activeSemester;
      if (!semester) {
        errors.push(`שורה ${idx + 2}: semester לא תקין (A/B)`);
        return;
      }
      const day = (row.day || "").trim() as LessonRecord["day"];
      if (!day) {
        errors.push(`שורה ${idx + 2}: חסר day`);
        return;
      }
      if (day !== "sun" && day !== "mon" && day !== "tue" && day !== "wed" && day !== "thu") {
        errors.push(`שורה ${idx + 2}: day לא תקין (sun/mon/tue/wed/thu)`);
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
      const endRes = parseEndMinutesFromRow(row, idx, startMinutes, rimonScheduleConfig.academicHourMinutes);
      if (endRes.error) {
        errors.push(endRes.error);
        return;
      }
      const durationMinutes = (endRes.endMinutes as number) - startMinutes;
      const key = `${semester}|${day}|${roomId}|${startMinutes}`;
      if (seenLessons.has(key)) return;
      seenLessons.add(key);
      semesters.add(semester);
      lessonsNext.push({
        id: lessonIdFromRow(semester, day, roomId, startMinutes),
        semester,
        day,
        roomId,
        startMinutes,
        durationMinutes,
        title: row.title || "",
        teacher: row.teacher || ""
      });
    });

    return { table: "lessons" as const, lessons: lessonsNext, errors, semesters };
  };

  const reservationIdFromRow = (date: string, roomId: string, timeMinutes: number) =>
    `res_${date}_${roomId}_${timeMinutes}`;

  const importReservationsFromCsv = (text: string, kind: "regular" | "special" | "closed") => {
    const { rows } = parseCsvAsObjects(text);
    const errors: string[] = [];
    const next: Reservation[] = [];
    const seen = new Set<string>();
    const dates = new Set<string>();

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
      const startMinutes = parseTimeStrict(row.startTime || "");
      if (startMinutes === null) {
        errors.push(`שורה ${idx + 2}: startTime לא תקין (HH:MM)`);
        return;
      }
      const endRes = parseEndMinutesFromRow(row, idx, startMinutes, 60);
      if (endRes.error) {
        errors.push(endRes.error);
        return;
      }
      const durationMinutes = (endRes.endMinutes as number) - startMinutes;

      const key = `${date}|${roomId}|${startMinutes}|${kind}`;
      if (seen.has(key)) return;
      seen.add(key);
      dates.add(date);

      if (kind === "regular") {
        next.push({
          id: reservationIdFromRow(date, roomId, startMinutes),
          date,
          time: startMinutes,
          durationMinutes,
          roomId,
          reservedBy: row.reservedBy || "",
          reservedEmail: row.reservedEmail || ""
        });
        return;
      }

      const label = (row.label || row.reservedBy || "").trim();
      next.push({
        id: reservationIdFromRow(date, roomId, startMinutes),
        date,
        time: startMinutes,
        durationMinutes,
        roomId,
        reservedBy: label,
        reservedEmail: "",
        kind: kind === "special" ? "special" : "closed"
      });
    });

    const table = kind === "regular" ? "reservations" : kind;
    return { table: table as "reservations" | "special" | "closed", kind, reservations: next, errors, dates };
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

  const importPreview = useMemo(() => {
    if (!activeTool || activeTool.kind !== "csv") return null;
    if (!importText.trim()) return null;
    if (activeTool.section === "users") return importUsersFromCsv(importText);
    if (csvTable === "lessons") return importLessonsFromCsv(importText);
    if (csvTable === "reservations") return importReservationsFromCsv(importText, "regular");
    if (csvTable === "special") return importReservationsFromCsv(importText, "special");
    return importReservationsFromCsv(importText, "closed");
  }, [activeTool, csvTable, importText]);

  type CsvImportPlan =
    | {
        section: "users";
        mode: typeof importMode;
        adds: number;
        updates: number;
        deletes: number;
        toWrite: DirectoryUser[];
      }
    | {
        section: "lessons";
        mode: typeof importMode;
        adds: number;
        updates: number;
        deletes: number;
        toWrite: LessonRecord[];
        deleteIds: string[];
      }
    | {
        section: "reservations";
        kind: "regular" | "special" | "closed";
        mode: typeof importMode;
        adds: number;
        updates: number;
        deletes: number;
        toWrite: Reservation[];
        deleteIds: string[];
      };

  const canonicalUser = (u: DirectoryUser) => ({
    email: u.email.toLowerCase(),
    name: u.name || "",
    role: u.role || "student",
    phone: u.phone || "",
    cohortStartYear: u.cohortStartYear ?? null
  });

  const canonicalLesson = (l: LessonRecord) => ({
    semester: l.semester,
    day: l.day,
    roomId: l.roomId,
    startMinutes: l.startMinutes,
    durationMinutes: l.durationMinutes,
    title: l.title || "",
    teacher: l.teacher || ""
  });

  const canonicalReservation = (r: Reservation) => ({
    date: r.date,
    time: r.time,
    durationMinutes: r.durationMinutes || 60,
    roomId: r.roomId,
    reservedBy: r.reservedBy || "",
    reservedEmail: r.reservedEmail || "",
    kind: r.kind || "regular"
  });

  const buildCsvImportPlan = (preview: NonNullable<typeof importPreview>): CsvImportPlan => {
    if ("users" in preview) {
      const existingByEmail = new Map(users.map((u) => [u.email.toLowerCase(), canonicalUser(u)]));
      let adds = 0;
      let updates = 0;
      const toWrite: DirectoryUser[] = [];

      preview.users.forEach((u) => {
        const next = canonicalUser(u);
        const existing = existingByEmail.get(next.email);
        if (!existing) {
          if (importMode === "add" || importMode === "diff" || importMode === "override") {
            adds += 1;
            toWrite.push(u);
          }
          return;
        }
        if (importMode === "add") return;
        const changed =
          existing.name !== next.name
          || existing.role !== next.role
          || existing.phone !== next.phone
          || existing.cohortStartYear !== next.cohortStartYear;
        if (!changed) return;
        updates += 1;
        toWrite.push(u);
      });

      if (importMode === "override") {
        adds = preview.users.length;
        updates = 0;
        return {
          section: "users",
          mode: importMode,
          adds,
          updates,
          deletes: users.length,
          toWrite: preview.users
        };
      }

      return { section: "users", mode: importMode, adds, updates, deletes: 0, toWrite };
    }

    if (preview.table === "lessons") {
      const lessonKey = (l: LessonRecord) => `${l.semester}|${l.day}|${l.roomId}|${l.startMinutes}`;
      const existingByKey = new Map(
        lessonsAll.map((l) => [lessonKey(l), { id: l.id, canonical: canonicalLesson(l), semester: l.semester }])
      );

      let adds = 0;
      let updates = 0;
      const toWrite: LessonRecord[] = [];
      const seen = new Set<string>();

      preview.lessons.forEach((l) => {
        const key = lessonKey(l);
        if (seen.has(key)) return;
        seen.add(key);
        const existing = existingByKey.get(key);
        const next: LessonRecord = { ...l, id: existing?.id || l.id };
        if (!existing) {
          if (importMode !== "add" && importMode !== "diff" && importMode !== "override") return;
          adds += 1;
          toWrite.push(next);
          return;
        }
        if (importMode === "add") return;
        const changed = JSON.stringify(existing.canonical) !== JSON.stringify(canonicalLesson(next));
        if (!changed) return;
        updates += 1;
        toWrite.push(next);
      });

      if (importMode === "override") {
        const deleteIds = lessonsAll
          .filter((l) => preview.semesters.has(l.semester))
          .map((l) => l.id);
        return {
          section: "lessons",
          mode: importMode,
          adds: preview.lessons.length,
          updates: 0,
          deletes: deleteIds.length,
          toWrite: preview.lessons,
          deleteIds
        };
      }

      return { section: "lessons", mode: importMode, adds, updates, deletes: 0, toWrite, deleteIds: [] };
    }

    const kind = preview.kind;
    const relevantExisting = reservationList.filter((r) => {
      const k = r.kind === "special" || r.kind === "closed" ? r.kind : "regular";
      return k === kind;
    });
    const resKey = (r: Reservation) => `${r.date}|${r.roomId}|${r.time}|${kind}`;
    const existingByKey = new Map(
      relevantExisting.map((r) => [resKey(r), { id: r.id, canonical: canonicalReservation(r) }])
    );

    let adds = 0;
    let updates = 0;
    const toWrite: Reservation[] = [];
    const seen = new Set<string>();
    preview.reservations.forEach((r) => {
      const key = resKey(r);
      if (seen.has(key)) return;
      seen.add(key);
      const existing = existingByKey.get(key);
      const next: Reservation = { ...r, id: existing?.id || r.id };
      if (!existing) {
        if (importMode === "add" || importMode === "diff") {
          adds += 1;
          toWrite.push(next);
        }
        return;
      }
      if (importMode === "add") return;
      const changed = JSON.stringify(existing.canonical) !== JSON.stringify(canonicalReservation(next));
      if (!changed) return;
      updates += 1;
      toWrite.push(next);
    });

    if (importMode === "override") {
      const deleteIds = relevantExisting
        .filter((r) => preview.dates.has(r.date))
        .map((r) => r.id);
      return {
        section: "reservations",
        kind,
        mode: importMode,
        adds: preview.reservations.length,
        updates: 0,
        deletes: deleteIds.length,
        toWrite: preview.reservations,
        deleteIds
      };
    }

    return { section: "reservations", kind, mode: importMode, adds, updates, deletes: 0, toWrite, deleteIds: [] };
  };

  const importPlan = useMemo(() => {
    if (!activeTool || activeTool.kind !== "csv") return null;
    if (!importPreview) return null;
    if (importPreview.errors.length) return null;
    return buildCsvImportPlan(importPreview);
  }, [activeTool, importMode, importPreview, lessonsAll, reservationList, users]);

  const handleRunCsvImport = async () => {
    const firestore = db;
    if (!firestore) {
      showToast("Firestore לא מוגדר.", "error");
      return;
    }
    if (!activeTool || activeTool.kind !== "csv") return;
    if (!importText.trim()) {
      setImportMessage("בחר קובץ CSV כדי להמשיך.");
      return;
    }
    if (!importPlan) {
      setImportMessage("לא ניתן לבצע ייבוא: בדוק שיש קובץ תקין ושאין שגיאות.");
      showToast("ייבוא נכשל: יש שגיאות בקובץ.", "error");
      return;
    }

    if (activeTool.section === "users") {
      if (importPlan.section !== "users") return;
      const toWrite = importPlan.toWrite;
      try {
        if (importMode === "override") {
          // Avoid a full collection scan: we already have the list in state.
          const refs = users.map((u) => doc(firestore, "users", u.email.toLowerCase()));
          for (let i = 0; i < refs.length; i += 450) {
            const batch = writeBatch(firestore);
            refs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
            await batch.commit();
          }
        }
        for (let i = 0; i < toWrite.length; i += 450) {
          const batch = writeBatch(firestore);
          toWrite.slice(i, i + 450).forEach((u) => {
            batch.set(
              doc(firestore, "users", u.email.toLowerCase()),
              {
                ...u,
                email: u.email.toLowerCase(),
                phone: u.phone || "",
                cohortStartYear: u.cohortStartYear ?? null
              },
              { merge: importMode !== "override" }
            );
          });
          await batch.commit();
        }
        setImportMessage(`עודכנו/נוספו ${toWrite.length} משתמשים.`);
        showToast("ייבוא משתמשים הושלם.");
      } catch {
        showToast("ייבוא משתמשים נכשל.", "error");
      }
      return;
    }
    try {
      if (importPlan.section === "lessons") {
        if (importMode === "override" && importPlan.deleteIds.length) {
          const refs = importPlan.deleteIds.map((id) => doc(firestore, "lessons", id));
          for (let i = 0; i < refs.length; i += 450) {
            const batch = writeBatch(firestore);
            refs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
            await batch.commit();
          }
        }
        const toWrite = importPlan.toWrite;
        for (let i = 0; i < toWrite.length; i += 450) {
          const batch = writeBatch(firestore);
          toWrite
            .slice(i, i + 450)
            .forEach((l) => batch.set(doc(firestore, "lessons", l.id), stripUndefined(l as unknown as Record<string, unknown>)));
          await batch.commit();
        }
        setImportMessage(`עודכנו/נוספו ${toWrite.length} שיעורים.`);
        showToast("ייבוא שיעורים הושלם.");
        return;
      }

      if (importPlan.section === "reservations") {
        if (importMode === "override" && importPlan.deleteIds.length) {
          const refs = importPlan.deleteIds.map((id) => doc(firestore, "reservations", id));
          for (let i = 0; i < refs.length; i += 450) {
            const batch = writeBatch(firestore);
            refs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
            await batch.commit();
          }
        }
        const toWrite = importPlan.toWrite;
        for (let i = 0; i < toWrite.length; i += 450) {
          const batch = writeBatch(firestore);
          toWrite
            .slice(i, i + 450)
            .forEach((r) => batch.set(doc(firestore, "reservations", r.id), stripUndefined(r as unknown as Record<string, unknown>)));
          await batch.commit();
        }
        const label =
          importPlan.kind === "regular"
            ? "שריונים"
            : importPlan.kind === "special"
              ? "אירועים"
              : "סגירות";
        setImportMessage(`עודכנו/נוספו ${toWrite.length} ${label}.`);
        showToast(`ייבוא ${label} הושלם.`);
        return;
      }
    } catch {
      showToast("ייבוא נכשל.", "error");
    }
  };

  const overlayTitle = !activeTool
    ? ""
    : activeTool.kind === "csv"
      ? `ייבוא וייצוא · ${activeTool.section === "users" ? "משתמשים" : "מערכת שעות"}`
      : activeTool.kind === "semesters"
        ? "טווחי סמסטר"
        : "";

  const csvStepTotal = 4;
  const csvStepNumber = csvStep;

  const csvTableLabel = !activeTool || activeTool.kind !== "csv"
    ? ""
    : activeTool.section === "users"
      ? "משתמשים"
      : csvTable === "lessons"
        ? "שיעורים"
        : csvTable === "reservations"
          ? "שריונים"
          : csvTable === "special"
            ? "אירועים"
            : "סגירות";

  const csvDistinctHelp = useMemo(() => {
    if (!activeTool || activeTool.kind !== "csv") return "";
    if (activeTool.section === "users") return "email";
    if (csvTable === "lessons") return "semester + day + roomId + startTime";
    return "date + roomId + startTime";
  }, [activeTool, csvTable]);

  const exportUsersCount = users.length;
  const exportLessonsBase = lessonsAll;
  const exportReservationsBase = reservationList;
  const exportReservationCounts = useMemo(() => {
    const base = { regular: 0, special: 0, closed: 0, all: exportReservationsBase.length };
    exportReservationsBase.forEach((r) => {
      if (r.kind === "special") base.special += 1;
      else if (r.kind === "closed") base.closed += 1;
      else base.regular += 1;
    });
    return base;
  }, [exportReservationsBase]);

  const exportScheduleCountLabel = useMemo(() => {
    if (!activeTool || activeTool.kind !== "csv") return "";
    if (activeTool.section !== "schedule") return "";
    if (csvTable === "lessons") return `שיעורים: ${exportLessonsBase.length}`;
    if (csvTable === "reservations") return `שריונים: ${exportReservationCounts.regular}`;
    if (csvTable === "special") return `אירועים: ${exportReservationCounts.special}`;
    return `סגירות: ${exportReservationCounts.closed}`;
  }, [activeTool, csvTable, exportLessonsBase.length, exportReservationCounts]);

  const overlayContent = !activeTool ? null : activeTool.kind === "csv" ? (
    <div className="admin-tool-content">
      <div className="admin-csv-wizard">
        <p className="admin-meta">שלב {csvStepNumber}/{csvStepTotal} · טבלה: {csvTableLabel}</p>

        {csvStep === 1 ? (
          <>
            <p className="admin-meta">בחר טבלה לעבודה:</p>
            <div className="admin-inline" style={{ flexWrap: "wrap", gap: 10 }}>
              {(
                activeTool.section === "users"
                  ? ([{ key: "users", label: "משתמשים" }] as const)
                  : ([
                      { key: "lessons", label: "שיעורים" },
                      { key: "reservations", label: "שריונים" },
                      { key: "special", label: "אירועים" },
                      { key: "closed", label: "סגירות" }
                    ] as const)
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`chip${csvTable === opt.key ? " active" : ""}`}
                  onClick={() => setCsvTable(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="admin-actions">
              <span style={{ flex: 1 }} />
              <button className="primary" type="button" onClick={() => setCsvStep(2)}>
                המשך
              </button>
            </div>
          </>
        ) : null}

        {csvStep === 2 ? (
          <>
            <p className="admin-meta">ייצוא (הורדה):</p>
            <div className="admin-filters">
              <span className="chip small ghost">
                {activeTool.section === "users" ? `${exportUsersCount} משתמשים` : exportScheduleCountLabel}
              </span>
            </div>

            {activeTool.section === "users" ? usersCsvHelp : null}
            {activeTool.section === "schedule" && (lessonsAllError || reservationsError) ? (
              <p className="admin-error">{lessonsAllError || reservationsError}</p>
            ) : null}
            {activeTool.section === "schedule"
              ? scheduleCsvHelp(csvTable as "lessons" | "reservations" | "special" | "closed")
              : null}

            <div className="admin-actions">
              <button className="secondary" type="button" onClick={() => setCsvStep(1)}>
                חזרה
              </button>
              <span style={{ flex: 1 }} />
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
              <button className="primary" type="button" onClick={() => setCsvStep(3)}>
                המשך לייבוא
              </button>
            </div>
          </>
        ) : null}

        {csvStep === 3 ? (
          <>
            <p className="admin-meta">ייבוא:</p>

            <div className="admin-import-options">
              <label>
                <input type="checkbox" checked disabled />
                הוספת רשומות חדשות
                <span className="admin-radio-help">· מוסיף רשומות שלא קיימות במערכת</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={importMode !== "add"}
                  onChange={(event) => setImportMode(event.target.checked ? "diff" : "add")}
                />
                עדכון רשומות קיימות
                <span className="admin-radio-help">· מעדכן רק אם הנתונים השתנו</span>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={importMode === "override"}
                  onChange={(event) => setImportMode(event.target.checked ? "override" : "diff")}
                />
                דריסה מלאה (כולל מחיקות)
                <span className="admin-radio-help">· מוחק רשומות קיימות בתחום הקובץ (סמסטרים/תאריכים), ואז מייבא מחדש</span>
              </label>
            </div>

            <p className="admin-meta">זיהוי רשומות לפי: {csvDistinctHelp}</p>

            <div className="admin-form-grid">
              <label>
                קובץ CSV
                <input type="file" accept=".csv" onChange={handleImportFile} />
              </label>
            </div>
            {importFileName ? <p className="admin-meta">קובץ נבחר: {importFileName}</p> : null}

            {importPreview ? (
              <p className="admin-meta">
                נמצאו{" "}
                {"users" in importPreview
                  ? importPreview.users.length
                  : importPreview.table === "lessons"
                    ? `${importPreview.lessons.length} שיעורים`
                    : `${importPreview.reservations.length} רשומות`}
                {importPreview.errors.length ? ` · שגיאות: ${importPreview.errors.length}` : ""}
              </p>
            ) : null}
            {importPreview?.errors?.length ? (
              <div className="admin-csv-preview" style={{ whiteSpace: "pre-wrap" }}>
                {importPreview.errors.slice(0, 30).join("\n")}
              </div>
            ) : null}

            <div className="admin-actions">
              <button className="secondary" type="button" onClick={() => setCsvStep(2)}>
                חזרה
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setImportText("");
                  setImportFileName("");
                  setImportMessage("");
                }}
                disabled={!importText.trim()}
              >
                ניקוי
              </button>
              <span style={{ flex: 1 }} />
              <button
                className="primary"
                type="button"
                onClick={() => setCsvStep(4)}
                disabled={!importText.trim() || !importPreview || Boolean(importPreview.errors.length)}
              >
                המשך לאישור
              </button>
            </div>
          </>
        ) : null}

        {csvStep === 4 ? (
          <>
            <p className="admin-meta">אישור פעולות:</p>
            {importPlan ? (
              <div className="admin-csv-confirm-card">
                <div className="admin-csv-confirm-title">תצוגה מקדימה</div>
                <div className="admin-csv-confirm-grid">
                  <div className="admin-csv-confirm-stat">
                    <div className="label">חדשים</div>
                    <div className="value">{importPlan.adds}</div>
                  </div>
                  <div className="admin-csv-confirm-stat">
                    <div className="label">עדכונים</div>
                    <div className="value">{importPlan.updates}</div>
                  </div>
                  <div className="admin-csv-confirm-stat">
                    <div className="label">מחיקות</div>
                    <div className="value">{importPlan.deletes}</div>
                  </div>
                </div>
                {importMode === "override" ? (
                  <p className="admin-meta" style={{ margin: 0 }}>
                    שים לב: דריסה מלאה מבצעת גם מחיקות בתחום הקובץ.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="admin-error">אין תצוגת ייבוא תקינה (בדוק שאין שגיאות וחזור לשלב הקודם).</p>
            )}

            {importMessage ? <p className="admin-meta">{importMessage}</p> : null}

            <div className="admin-actions">
              <button className="secondary" type="button" onClick={() => setCsvStep(3)}>
                חזרה
              </button>
              <span style={{ flex: 1 }} />
              <button className="primary" type="button" onClick={handleRunCsvImport} disabled={!importPlan}>
                <UploadIcon />
                ביצוע ייבוא
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
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
            <div className="admin-section-tools">
              {activeSection === "users" ? (
                <>
                  <button
                    type="button"
                    className={`admin-toolbar-chip${activeTool?.section === "users" && activeTool.kind === "csv" ? " active" : ""}`}
                    onClick={() => toolToggle({ section: "users", kind: "csv" })}
                  >
                    <span className="admin-toolbar-icon-row" aria-hidden="true">
                      <UploadIcon />
                      <DownloadIcon />
                    </span>
                    <span>ייבוא וייצוא</span>
                  </button>
                </>
              ) : null}
              {activeSection === "schedule" ? (
                <>
                  <button
                    type="button"
                    className={`admin-toolbar-chip${activeTool?.section === "schedule" && activeTool.kind === "csv" ? " active" : ""}`}
                    onClick={() => toolToggle({ section: "schedule", kind: "csv" })}
                  >
                    <span className="admin-toolbar-icon-row" aria-hidden="true">
                      <UploadIcon />
                      <DownloadIcon />
                    </span>
                    <span>ייבוא וייצוא</span>
                  </button>
                  <button
                    type="button"
                    className={`admin-toolbar-chip${activeTool?.section === "schedule" && activeTool.kind === "semesters" ? " active" : ""}`}
                    onClick={() => toolToggle({ section: "schedule", kind: "semesters" })}
                  >
                    <CalendarIcon />
                    <span>סמסטרים</span>
                  </button>
                </>
              ) : null}
              {bulkState ? (
                <>
                  <span className="admin-toolbar-divider" aria-hidden="true" />
                  {bulkState.selectAll ? (
                    <BulkSelectAll
                      checked={bulkState.selectAll.checked}
                      indeterminate={bulkState.selectAll.indeterminate}
                      onToggle={bulkState.selectAll.onToggle}
                    />
                  ) : null}
                  {bulkState.actions
                    .filter((action) => {
                      if (bulkState.selectedCount === 0) return action.id === "new";
                      return action.id !== "new";
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

        <div className="admin-main-scroll">
        {activeSection === "users" ? (
          <UsersSection
            users={users}
            pendingUsers={pendingUsers}
            usersError={usersError}
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
