import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
  const [clearRange, setClearRange] = useState({ start: "", end: "" });
  const [clearMessage, setClearMessage] = useState("");
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: "success" | "error" } | null>(null);
  const [bulkState, setBulkState] = useState<BulkState | null>(null);
  const [exportScope, setExportScope] = useState<"filtered" | "all">("filtered");
  const [exportUsersView, setExportUsersView] = useState<DirectoryUser[] | null>(null);
  const [exportLessonsView, setExportLessonsView] = useState<LessonRecord[] | null>(null);
  const [exportReservationsView, setExportReservationsView] = useState<Reservation[] | null>(null);
  const [activeTool, setActiveTool] = useState<
    | null
    | {
        section: "users" | "schedule";
        kind: "csv" | "semesters" | "clear_reservations";
      }
  >(null);
  const [csvStep, setCsvStep] = useState<1 | 2 | 3 | 4>(2);
  const [csvTable, setCsvTable] = useState<
    "users" | "schedule_all" | "lessons" | "reservations" | "special" | "closed"
  >("users");
  const [importMode, setImportMode] = useState<"add" | "diff" | "override">("add");
  const [importText, setImportText] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [scheduleCsvTypes, setScheduleCsvTypes] = useState({
    lessons: true,
    reservations: true,
    special: true,
    closed: true
  });
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
    setImportMessage("");
    setImportMode("add");
    setScheduleCsvTypes({ lessons: true, reservations: true, special: true, closed: true });
  }, []);

  const overlayOpen = activeTool !== null;
  const menuCollapsed = sideCollapsed && !isNarrow;
  const prevToolRef = useRef<typeof activeTool>(null);

  useEffect(() => {
    if (!activeTool) return;
    if (activeTool.kind === "csv") setExportScope("filtered");
  }, [activeTool]);

  useEffect(() => {
    const prev = prevToolRef.current;
    prevToolRef.current = activeTool;
    if (!activeTool || activeTool.kind !== "csv") return;
    const isNewOpen = !prev || prev.kind !== "csv" || prev.section !== activeTool.section;
    if (!isNewOpen) return;

    setImportText("");
    setImportMessage("");
    setImportMode("add");
    setCsvStep(activeTool.section === "schedule" && scheduleFilter === "all" ? 1 : 2);
    if (activeTool.section === "users") {
      setCsvTable("users");
    } else if (scheduleFilter === "all") {
      setCsvTable("schedule_all");
    } else {
      const table =
        scheduleFilter === "lessons"
          ? "lessons"
          : scheduleFilter === "regular"
            ? "reservations"
            : scheduleFilter === "special"
              ? "special"
              : "closed";
      setCsvTable(table);
    }
  }, [activeTool, scheduleFilter]);

  useEffect(() => {
    if (!activeTool) return;
    if (activeTool.section !== "schedule") return;
    if (activeTool.kind !== "csv") return;
    // When opening the CSV wizard from a filtered schedule view, preselect the table.
    if (scheduleFilter === "all") return;
    const table =
      scheduleFilter === "lessons"
        ? "lessons"
        : scheduleFilter === "regular"
          ? "reservations"
          : scheduleFilter === "special"
            ? "special"
            : "closed";
    setCsvTable(table);
    setCsvStep(2);
    setScheduleCsvTypes({
      lessons: table === "lessons",
      reservations: table === "reservations",
      special: table === "special",
      closed: table === "closed"
    });
  }, [activeTool, scheduleFilter]);

  useEffect(() => {
    if (!activeTool) return;
    if (activeTool.section !== "schedule") return;
    if (activeTool.kind !== "csv") return;
    if (scheduleFilter !== "all") return; // handled by the filtered-view effect above

    const table = csvTable === "users" ? "schedule_all" : csvTable;
    setScheduleCsvTypes({
      lessons: table === "schedule_all" || table === "lessons",
      reservations: table === "schedule_all" || table === "reservations",
      special: table === "schedule_all" || table === "special",
      closed: table === "schedule_all" || table === "closed"
    });
  }, [activeTool, csvTable, scheduleFilter]);

  useEffect(() => {
    setActiveTool(null);
    setImportText("");
    setImportMessage("");
    setImportMode("add");
    setClearMessage("");
    setScheduleFilter("all");
    setScheduleCsvTypes({ lessons: true, reservations: true, special: true, closed: true });
    setBulkState(null);
    setCsvStep(2);
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
  const scheduleCsvHeaders = [
    "type",
    "semester",
    "day",
    "date",
    "roomId",
    "startTime",
    "durationMinutes",
    "title",
    "teacher",
    "reservedBy",
    "reservedEmail",
    "kind"
  ];

  const usersCsvHelp = (
    <details>
      <summary className="admin-meta" style={{ cursor: "pointer" }}>הסבר שדות CSV</summary>
      <div className="admin-csv-help">
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">email</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">אימייל (מזהה ייחודי)</span>
        </div>
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">name</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">שם תצוגה</span>
        </div>
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">role</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">student / moderator / admin / pending</span>
        </div>
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">phone</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">טלפון (אופציונלי)</span>
        </div>
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">grade</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">A / B / C (אפשר גם א/ב/ג)</span>
        </div>
      </div>
    </details>
  );

  const scheduleCsvHelp = (
    <details>
      <summary className="admin-meta" style={{ cursor: "pointer" }}>הסבר שדות CSV</summary>
      <div className="admin-csv-help">
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">type</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">lesson / reservation / special / closed</span>
        </div>
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">semester</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">A / B (רק ל-type=lesson)</span>
        </div>
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">day</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">sun / mon / tue / wed / thu / fri (רק ל-type=lesson)</span>
        </div>
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">date</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">YYYY-MM-DD (רק ל-type=reservation/special/closed)</span>
        </div>
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">roomId</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">מזהה חדר</span>
        </div>
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">startTime</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">HH:MM (למשל: 09:00)</span>
        </div>
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">durationMinutes</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">מספר דקות (למשל: 60)</span>
        </div>
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">title</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">שם שיעור (רק ל-type=lesson)</span>
        </div>
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">teacher</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">מרצה (רק ל-type=lesson)</span>
        </div>
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">reservedBy</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">שם/תיאור (לשריון/אירוע/סגירה)</span>
        </div>
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">reservedEmail</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">אימייל (רק ל-type=reservation)</span>
        </div>
        <div className="admin-csv-help-row">
          <span className="admin-csv-help-key">kind</span>
          <span className="admin-csv-help-dash">-</span>
          <span className="admin-csv-help-value">regular / special / closed (לתאימות)</span>
        </div>
      </div>
    </details>
  );

  const exportPayload = useMemo(() => {
    if (!activeTool || activeTool.kind !== "csv") return null;
    if (activeTool.section === "users") {
      const list = exportScope === "filtered" && exportUsersView ? exportUsersView : users;
      const rows = list.map((u) => ({
        email: u.email,
        name: u.name || "",
        role: u.role || "student",
        phone: u.phone || "",
        grade: u.role === "moderator" && !u.cohortStartYear
          ? "צוות"
          : u.cohortStartYear
            ? gradeValueFromCohort(u.cohortStartYear)
            : ""
      }));
      return { filename: "users.csv", csv: stringifyCsv(userCsvHeaders, rows) };
    }
    const lessonsBase = exportScope === "filtered" && exportLessonsView ? exportLessonsView : lessonsAll;
    const reservationsBase = exportScope === "filtered" && exportReservationsView ? exportReservationsView : reservationList;

    const lessonRows = scheduleCsvTypes.lessons
      ? lessonsBase.map((l) => ({
        type: "lesson",
        semester: l.semester || activeSemester,
        day: l.day,
        date: "",
        roomId: l.roomId,
        startTime: toTimeInput(l.startMinutes),
        durationMinutes: l.durationMinutes,
        title: l.title || "",
        teacher: l.teacher || "",
        reservedBy: "",
        reservedEmail: "",
        kind: ""
      }))
      : [];

    const reservationRows = reservationsBase
      .filter((r) => {
        const kind = r.kind || "regular";
        if (kind === "regular") return scheduleCsvTypes.reservations;
        if (kind === "special") return scheduleCsvTypes.special;
        return scheduleCsvTypes.closed;
      })
      .map((r) => {
        const kind = r.kind || "regular";
        return {
          type: kind === "regular" ? "reservation" : kind,
          semester: "",
          day: "",
          date: r.date,
          roomId: r.roomId,
          startTime: toTimeInput(r.time),
          durationMinutes: r.durationMinutes || 60,
          title: "",
          teacher: "",
          reservedBy: r.reservedBy || "",
          reservedEmail: kind === "regular" ? (r.reservedEmail || "") : "",
          kind
        };
      });

    const rows = [...lessonRows, ...reservationRows];
    return { filename: "schedule.csv", csv: stringifyCsv(scheduleCsvHeaders, rows) };
  }, [activeSemester, activeTool, exportLessonsView, exportReservationsView, exportScope, exportUsersView, lessonsAll, reservationList, scheduleCsvTypes, users]);

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

  const copyToClipboard = async (text: string) => {
    try {
      if (!navigator.clipboard?.writeText) {
        showToast("העתקה לא נתמכת בדפדפן הזה.", "error");
        return;
      }
      await navigator.clipboard.writeText(text);
      showToast("הועתק ללוח.");
    } catch {
      showToast("העתקה נכשלה.", "error");
    }
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

      const roleCell = String(row.role || "").trim();
      const roleRaw = (roleCell || "student").toLowerCase() as UserRole;
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

  const importScheduleFromCsv = (text: string) => {
    const { rows } = parseCsvAsObjects(text);
    const errors: string[] = [];
    const lessonsNext: LessonRecord[] = [];
    const reservationsNext: Reservation[] = [];
    const seenLessons = new Set<string>();
    const seenReservations = new Set<string>();

    const reservationIdFromRow = (date: string, roomId: string, timeMinutes: number) =>
      `res_${date}_${roomId}_${timeMinutes}`;

    rows.forEach((row, idx) => {
      const typeRaw = (row.type || "").trim().toLowerCase();
      const hasLessonFields = Boolean(row.semester || row.day || row.title || row.teacher);
      const hasReservationFields = Boolean(row.date || row.reservedBy || row.reservedEmail || row.kind);
      const type =
        typeRaw === "lesson" || typeRaw === "reservation" || typeRaw === "special" || typeRaw === "closed"
          ? typeRaw
          : hasLessonFields
            ? "lesson"
            : hasReservationFields
              ? "reservation"
              : "";

      if (type === "lesson") {
        const semesterRaw = (row.semester || "").trim().toUpperCase();
        const semester = semesterRaw === "A" || semesterRaw === "B" ? (semesterRaw as SemesterKey) : null;
        if (!semester) {
          errors.push(`שורה ${idx + 2}: semester לא תקין (A/B)`);
          return;
        }
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
        if (seenLessons.has(id)) return;
        seenLessons.add(id);
        lessonsNext.push({
          id,
          semester,
          day,
          roomId,
          startMinutes,
          durationMinutes,
          title: row.title || "",
          teacher: row.teacher || ""
        });
        return;
      }

      if (type === "reservation" || type === "special" || type === "closed") {
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
        const timeMinutes = parseTimeStrict(row.startTime || "");
        if (timeMinutes === null) {
          errors.push(`שורה ${idx + 2}: startTime לא תקין (HH:MM)`);
          return;
        }
        const durationMinutes = row.durationMinutes ? Number(row.durationMinutes) : 60;
        if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
          errors.push(`שורה ${idx + 2}: durationMinutes לא תקין`);
          return;
        }
        const kindRaw = (row.kind || "").trim().toLowerCase();
        const kindFromKind = kindRaw === "special" || kindRaw === "closed" ? (kindRaw as "special" | "closed") : undefined;
        const kind = type === "special" ? "special" : type === "closed" ? "closed" : kindFromKind;
        const id = reservationIdFromRow(date, roomId, timeMinutes);
        if (seenReservations.has(id)) return;
        seenReservations.add(id);
        reservationsNext.push({
          id,
          date,
          time: timeMinutes,
          durationMinutes,
          roomId,
          reservedBy: row.reservedBy || "",
          reservedEmail: type === "reservation" ? (row.reservedEmail || "") : "",
          kind
        });
        return;
      }

      if (typeRaw) {
        errors.push(`שורה ${idx + 2}: type לא מוכר (${row.type})`);
      } else {
        errors.push(`שורה ${idx + 2}: חסר type`);
      }
    });

    return { lessons: lessonsNext, reservations: reservationsNext, errors };
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
    if (!activeTool || activeTool.kind !== "csv") return null;
    if (!importText.trim()) return null;
    if (activeTool.section === "users") return importUsersFromCsv(importText);
    const parsed = importScheduleFromCsv(importText);
    const lessons = scheduleCsvTypes.lessons ? parsed.lessons : [];
    const reservations = parsed.reservations.filter((r) => {
      const kind = r.kind || "regular";
      if (kind === "regular") return scheduleCsvTypes.reservations;
      if (kind === "special") return scheduleCsvTypes.special;
      return scheduleCsvTypes.closed;
    });
    return { lessons, reservations, errors: parsed.errors };
  }, [activeTool, importText, scheduleCsvTypes]);

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
        section: "schedule";
        mode: typeof importMode;
        addsLessons: number;
        updatesLessons: number;
        deletesLessons: number;
        addsReservations: number;
        updatesReservations: number;
        deletesReservations: number;
        toWriteLessons: LessonRecord[];
        toWriteReservations: Reservation[];
      };

  const canonicalUser = (u: DirectoryUser) => ({
    email: u.email.toLowerCase(),
    name: u.name || "",
    role: u.role || "student",
    phone: u.phone || "",
    cohortStartYear: u.cohortStartYear ?? null
  });

  const canonicalLesson = (l: LessonRecord) => ({
    id: l.id,
    semester: l.semester,
    day: l.day,
    roomId: l.roomId,
    startMinutes: l.startMinutes,
    durationMinutes: l.durationMinutes,
    title: l.title || "",
    teacher: l.teacher || ""
  });

  const canonicalReservation = (r: Reservation) => ({
    id: r.id,
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

    const existingLessonsById = new Map(lessonsAll.map((l) => [l.id, canonicalLesson(l)]));
    const existingReservations = reservationList.filter((r) => {
      const kind = r.kind === "special" || r.kind === "closed" ? r.kind : "regular";
      if (kind === "regular") return scheduleCsvTypes.reservations;
      if (kind === "special") return scheduleCsvTypes.special;
      return scheduleCsvTypes.closed;
    });
    const existingReservationsById = new Map(existingReservations.map((r) => [r.id, canonicalReservation(r)]));

    let addsLessons = 0;
    let updatesLessons = 0;
    const toWriteLessons: LessonRecord[] = [];
    preview.lessons.forEach((l) => {
      const existing = existingLessonsById.get(l.id);
      if (!existing) {
        if (importMode === "add" || importMode === "diff") {
          addsLessons += 1;
          toWriteLessons.push(l);
        }
        return;
      }
      if (importMode === "add") return;
      const next = canonicalLesson(l);
      const changed =
        existing.semester !== next.semester
        || existing.day !== next.day
        || existing.roomId !== next.roomId
        || existing.startMinutes !== next.startMinutes
        || existing.durationMinutes !== next.durationMinutes
        || existing.title !== next.title
        || existing.teacher !== next.teacher;
      if (!changed) return;
      updatesLessons += 1;
      toWriteLessons.push(l);
    });

    let addsReservations = 0;
    let updatesReservations = 0;
    const toWriteReservations: Reservation[] = [];
    preview.reservations.forEach((r) => {
      const existing = existingReservationsById.get(r.id);
      if (!existing) {
        if (importMode === "add" || importMode === "diff") {
          addsReservations += 1;
          toWriteReservations.push(r);
        }
        return;
      }
      if (importMode === "add") return;
      const next = canonicalReservation(r);
      const changed =
        existing.date !== next.date
        || existing.time !== next.time
        || existing.durationMinutes !== next.durationMinutes
        || existing.roomId !== next.roomId
        || existing.reservedBy !== next.reservedBy
        || existing.reservedEmail !== next.reservedEmail
        || existing.kind !== next.kind;
      if (!changed) return;
      updatesReservations += 1;
      toWriteReservations.push(r);
    });

    if (importMode === "override") {
      return {
        section: "schedule",
        mode: importMode,
        addsLessons: preview.lessons.length,
        updatesLessons: 0,
        deletesLessons: scheduleCsvTypes.lessons ? lessonsAll.length : 0,
        addsReservations: preview.reservations.length,
        updatesReservations: 0,
        deletesReservations: existingReservations.length,
        toWriteLessons: preview.lessons,
        toWriteReservations: preview.reservations
      };
    }

    return {
      section: "schedule",
      mode: importMode,
      addsLessons,
      updatesLessons,
      deletesLessons: 0,
      addsReservations,
      updatesReservations,
      deletesReservations: 0,
      toWriteLessons,
      toWriteReservations
    };
  };

  const importPlan = useMemo(() => {
    if (!activeTool || activeTool.kind !== "csv") return null;
    if (!importPreview) return null;
    if (importPreview.errors.length) return null;
    return buildCsvImportPlan(importPreview);
  }, [activeTool, importMode, importPreview, lessonsAll, reservationList, scheduleCsvTypes, users]);

  const handleRunCsvImport = async () => {
    if (!db) {
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
          const refs = users.map((u) => doc(db, "users", u.email.toLowerCase()));
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
        setImportMessage(`עודכנו/נוספו ${toWrite.length} משתמשים.`);
        showToast("ייבוא משתמשים הושלם.");
      } catch {
        showToast("ייבוא משתמשים נכשל.", "error");
      }
      return;
    }
    if (importPlan.section !== "schedule") return;
    const lessonsToWrite = importPlan.toWriteLessons;
    const reservationsToWrite = importPlan.toWriteReservations;

    try {
      if (importMode === "override") {
        if (scheduleCsvTypes.lessons) {
          // Avoid a full collection scan: we already have the list in state.
          const lessonsRefs = lessonsAll.map((l) => doc(db, "lessons", l.id));
          for (let i = 0; i < lessonsRefs.length; i += 450) {
            const batch = writeBatch(db);
            lessonsRefs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
            await batch.commit();
          }
        }

        if (scheduleCsvTypes.reservations || scheduleCsvTypes.special || scheduleCsvTypes.closed) {
          // Avoid a full collection scan: we already have the list in state.
          const reservationsRefs = reservationList
            .filter((r) => {
              const kind = r.kind === "special" || r.kind === "closed" ? r.kind : "regular";
              if (kind === "regular") return scheduleCsvTypes.reservations;
              if (kind === "special") return scheduleCsvTypes.special;
              return scheduleCsvTypes.closed;
            })
            .map((r) => doc(db, "reservations", r.id));
          for (let i = 0; i < reservationsRefs.length; i += 450) {
            const batch = writeBatch(db);
            reservationsRefs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
            await batch.commit();
          }
        }
      }

      for (let i = 0; i < lessonsToWrite.length; i += 450) {
        const batch = writeBatch(db);
        lessonsToWrite
          .slice(i, i + 450)
          .forEach((l) => batch.set(doc(db, "lessons", l.id), stripUndefined(l as unknown as Record<string, unknown>)));
        await batch.commit();
      }
      for (let i = 0; i < reservationsToWrite.length; i += 450) {
        const batch = writeBatch(db);
        reservationsToWrite
          .slice(i, i + 450)
          .forEach((r) => batch.set(doc(db, "reservations", r.id), stripUndefined(r as unknown as Record<string, unknown>)));
        await batch.commit();
      }

      setImportMessage(`עודכנו/נוספו ${lessonsToWrite.length} שיעורים ו-${reservationsToWrite.length} שריונים/אירועים/סגירות.`);
      showToast("ייבוא מערכת שעות הושלם.");
    } catch {
      showToast("ייבוא מערכת שעות נכשל.", "error");
    }
  };

  const overlayTitle = !activeTool
    ? ""
    : activeTool.kind === "csv"
      ? `ייבוא וייצוא · ${activeTool.section === "users" ? "משתמשים" : "מערכת שעות"}`
      : activeTool.kind === "semesters"
        ? "טווחי סמסטר"
        : "ניקוי שריונים";

  const scheduleFilterLabel =
    scheduleFilter === "all"
      ? "הכל"
      : scheduleFilter === "lessons"
        ? "שיעורים"
        : scheduleFilter === "regular"
          ? "שריונים"
          : scheduleFilter === "special"
            ? "אירועים"
            : "סגירות";

  const csvHasTableStep = Boolean(
    activeTool && activeTool.kind === "csv" && activeTool.section === "schedule" && scheduleFilter === "all"
  );

  const csvStepTotal = csvHasTableStep ? 4 : 3;
  const csvStepNumber = !activeTool || activeTool.kind !== "csv"
    ? 1
    : csvHasTableStep
      ? csvStep
      : Math.max(2, csvStep) - 1;

  const csvTableLabel = !activeTool || activeTool.kind !== "csv"
    ? ""
    : activeTool.section === "users"
      ? "משתמשים"
      : scheduleFilter !== "all"
        ? scheduleFilterLabel
        : csvTable === "schedule_all"
          ? "מערכת שעות (הכל)"
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
    const parts: string[] = [];
    if (scheduleCsvTypes.lessons) parts.push("שיעורים: semester + day + roomId + startTime");
    if (scheduleCsvTypes.reservations || scheduleCsvTypes.special || scheduleCsvTypes.closed) {
      parts.push("שריונים/אירועים/סגירות: date + roomId + startTime");
    }
    return parts.join(" · ");
  }, [activeTool, scheduleCsvTypes]);

  const exportUsersCount = exportScope === "filtered" && exportUsersView ? exportUsersView.length : users.length;
  const exportLessonsBase = exportScope === "filtered" && exportLessonsView ? exportLessonsView : lessonsAll;
  const exportReservationsBase = exportScope === "filtered" && exportReservationsView ? exportReservationsView : reservationList;
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
    const parts: string[] = [];
    if (scheduleCsvTypes.lessons) parts.push(`שיעורים: ${exportLessonsBase.length}`);
    if (scheduleCsvTypes.reservations) parts.push(`שריונים: ${exportReservationCounts.regular}`);
    if (scheduleCsvTypes.special) parts.push(`אירועים: ${exportReservationCounts.special}`);
    if (scheduleCsvTypes.closed) parts.push(`סגירות: ${exportReservationCounts.closed}`);
    return parts.join(" · ");
  }, [activeTool, exportLessonsBase.length, exportReservationCounts, scheduleCsvTypes]);

  const scheduleSelectionEmpty = !scheduleCsvTypes.lessons
    && !scheduleCsvTypes.reservations
    && !scheduleCsvTypes.special
    && !scheduleCsvTypes.closed;

  const overlayContent = !activeTool ? null : activeTool.kind === "csv" ? (
    <div className="admin-tool-content">
      <div className="admin-csv-wizard">
        <p className="admin-meta">
          שלב {csvStepNumber}/{csvStepTotal} · טבלה: {csvTableLabel}
          {activeTool.section === "schedule" ? ` · מסנן במסך: ${scheduleFilterLabel}` : ""}
        </p>

        {csvHasTableStep && csvStep === 1 ? (
          <>
            <p className="admin-meta">בחר טבלה לעבודה:</p>
            <div className="admin-inline" style={{ flexWrap: "wrap", gap: 10 }}>
              {(
                [
                  { key: "schedule_all", label: "מערכת שעות (הכל)" },
                  { key: "lessons", label: "שיעורים" },
                  { key: "reservations", label: "שריונים" },
                  { key: "special", label: "אירועים" },
                  { key: "closed", label: "סגירות" }
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`chip${csvTable === opt.key ? " active" : ""}`}
                  onClick={() => {
                    setCsvTable(opt.key);
                    setCsvStep(2);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {csvStep === 2 ? (
          <>
            <p className="admin-meta">ייצוא (הורדה):</p>
            <div className="admin-filters">
              <button
                type="button"
                className={`chip small${exportScope === "filtered" ? " active" : ""}`}
                onClick={() => setExportScope("filtered")}
              >
                לפי המסנן הנוכחי
              </button>
              <button
                type="button"
                className={`chip small${exportScope === "all" ? " active" : ""}`}
                onClick={() => setExportScope("all")}
              >
                כל הנתונים
              </button>
                <span className="chip small ghost">
                  {activeTool.section === "users"
                    ? `${exportUsersCount} משתמשים`
                  : exportScheduleCountLabel}
                </span>
              {csvHasTableStep ? (
                <button type="button" className="chip small" onClick={() => setCsvStep(1)}>
                  שינוי טבלה
                </button>
              ) : null}
            </div>

            {activeTool.section === "users" ? usersCsvHelp : null}
            {activeTool.section === "schedule" && (lessonsAllError || reservationsError) ? (
              <p className="admin-error">{lessonsAllError || reservationsError}</p>
            ) : null}
            {activeTool.section === "schedule" ? scheduleCsvHelp : null}

            {exportPayload ? (
              <details>
                <summary className="admin-meta" style={{ cursor: "pointer" }}>תצוגה מקדימה</summary>
                <textarea
                  className="admin-csv-preview"
                  readOnly
                  value={
                    exportPayload.csv.length > 9000
                      ? `${exportPayload.csv.slice(0, 9000)}\n...\n`
                      : exportPayload.csv
                  }
                />
              </details>
            ) : null}

            <div className="admin-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => exportPayload && void copyToClipboard(exportPayload.csv)}
                disabled={!exportPayload || (activeTool.section === "schedule" && scheduleSelectionEmpty)}
              >
                העתקה
              </button>
              <button
                className="primary"
                type="button"
                onClick={() => {
                  if (!exportPayload) return;
                  downloadTextFile(exportPayload.filename, exportPayload.csv);
                }}
                disabled={!exportPayload || (activeTool.section === "schedule" && scheduleSelectionEmpty)}
              >
                <DownloadIcon />
                הורדה
              </button>
              <span style={{ flex: 1 }} />
              <button className="primary" type="button" onClick={() => setCsvStep(3)}>
                המשך לייבוא
              </button>
            </div>
          </>
        ) : null}

        {csvStep === 3 ? (
          <>
            <p className="admin-meta">ייבוא:</p>
            <div className="admin-import-modes">
              <label>
                <input type="radio" name="importMode" checked={importMode === "add"} onChange={() => setImportMode("add")} />
                הוספת חדשים בלבד
                <span className="admin-radio-help">- לא משנה רשומות קיימות</span>
              </label>
              <label>
                <input type="radio" name="importMode" checked={importMode === "diff"} onChange={() => setImportMode("diff")} />
                הוספה + עדכון לפי diff
                <span className="admin-radio-help">- מוסיף חדשים ומעדכן קיימים רק אם השתנו</span>
              </label>
              <label>
                <input type="radio" name="importMode" checked={importMode === "override"} onChange={() => setImportMode("override")} />
                דריסה מלאה (כולל מחיקות)
                <span className="admin-radio-help">- מוחק את הטבלה הנבחרת ומייבא מחדש</span>
              </label>
            </div>
            <p className="admin-meta">זיהוי רשומות לפי: {csvDistinctHelp}</p>

            <div className="admin-form-grid">
              <label>
                קובץ CSV
                <input type="file" accept=".csv" onChange={handleImportFile} />
              </label>
            </div>
            <label>
              תוכן CSV (אפשר להדביק/לערוך)
              <textarea
                className="admin-csv-preview"
                value={importText}
                placeholder="הדבק כאן CSV או בחר קובץ…"
                onChange={(event) => {
                  setImportText(event.target.value);
                  setImportMessage("");
                }}
              />
            </label>

            {importPreview ? (
              <p className="admin-meta">
                נמצאו{" "}
                {"users" in importPreview
                  ? importPreview.users.length
                  : `${importPreview.lessons.length} שיעורים ו-${importPreview.reservations.length} שריונים/אירועים/סגירות`}
                {importPreview.errors.length ? ` · שגיאות: ${importPreview.errors.length}` : ""}
              </p>
            ) : null}
            {importPreview?.errors?.length ? (
              <details>
                <summary className="admin-error" style={{ cursor: "pointer" }}>הצג שגיאות</summary>
                <div className="admin-csv-preview" style={{ whiteSpace: "pre-wrap" }}>
                  {importPreview.errors.slice(0, 30).join("\n")}
                </div>
              </details>
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
                disabled={!importText.trim() || !importPreview || Boolean(importPreview.errors.length) || (activeTool.section === "schedule" && scheduleSelectionEmpty)}
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
              <div className="admin-csv-confirm">
                {importPlan.section === "users" ? (
                  <p className="admin-meta">
                    {importPlan.mode === "override"
                      ? `מחיקה: ${importPlan.deletes} · ייבוא: ${importPlan.adds}`
                      : `חדשים: ${importPlan.adds} · עדכונים: ${importPlan.updates}`}
                  </p>
                ) : (
                  <p className="admin-meta">
                    {importPlan.mode === "override"
                      ? `מחיקת שיעורים: ${importPlan.deletesLessons} · מחיקת שריונים/אירועים/סגירות: ${importPlan.deletesReservations}`
                      : `שיעורים: +${importPlan.addsLessons} / ~${importPlan.updatesLessons} · שריונים/אירועים/סגירות: +${importPlan.addsReservations} / ~${importPlan.updatesReservations}`}
                  </p>
                )}
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
              <button
                className="primary"
                type="button"
                onClick={handleRunCsvImport}
                disabled={!importPlan || (activeTool.section === "schedule" && scheduleSelectionEmpty)}
              >
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
  ) : (
    clearReservationsToolContent
  );

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
                    <UploadIcon />
                    <DownloadIcon />
                    ייבוא וייצוא
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
                    <UploadIcon />
                    <DownloadIcon />
                    ייבוא וייצוא
                  </button>
                  <button
                    type="button"
                    className={`admin-toolbar-chip${activeTool?.section === "schedule" && activeTool.kind === "semesters" ? " active" : ""}`}
                    onClick={() => toolToggle({ section: "schedule", kind: "semesters" })}
                  >
                    <CalendarIcon />
                    סמסטרים
                  </button>
                  <button
                    type="button"
                    className={`admin-toolbar-chip${activeTool?.section === "schedule" && activeTool.kind === "clear_reservations" ? " active" : ""}`}
                    onClick={() => toolToggle({ section: "schedule", kind: "clear_reservations" })}
                  >
                    <ReleaseIcon />
                    ניקוי שריונים
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
                  {bulkState.actions.map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      className={`admin-toolbar-chip admin-bulk-action${action.tone === "danger" ? " danger" : ""}`}
                      onClick={action.onClick}
                      disabled={action.disabled}
                    >
                      {action.icon ? action.icon : null}
                      {action.label}
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
            onFilteredUsersChange={setExportUsersView}
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
            onFilteredLessonsChange={setExportLessonsView}
            onFilteredReservationsChange={setExportReservationsView}
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
