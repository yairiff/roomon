import { useCallback, useEffect, useMemo, useState } from "react";
import { rimonScheduleConfig, weekDays as scheduleWeekDays } from "../../config";
import { useDirectoryUsers } from "../../hooks/useDirectoryUsers";
import { useLessons } from "../../hooks/useLessons";
import { useReservations } from "../../hooks/useReservations";
import { useRooms } from "../../hooks/useRooms";
import { useScheduleSettings } from "../../hooks/useScheduleSettings";
import type { User } from "../../types/auth";
import type { LessonRecord, RoomRecord, DirectoryUser } from "../../types/admin";
import type { DayKey } from "../../types/schedule";
import type { Reservation } from "../../types/reservations";
import type { ReservationPolicy, ReservationScopedPolicy, SemesterEntity, SemesterHoliday } from "../../types/settings";
import { getAcademicYearStartYear } from "../../lib/academics";
import { formatMinutes } from "../../lib/scheduleBuilder";
import { buildYearlySemesterId } from "../../lib/semesterScope";
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

type ScopedPolicyDraft = {
  id: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  useConditionRooms: boolean;
  useConditionDays: boolean;
  useConditionDateRange: boolean;
  useConditionTimeRange: boolean;
  roomIds: string[];
  dayKeys: DayKey[];
  dateStart: string;
  dateEnd: string;
  startTime: string;
  endTime: string;
  useHourQuota: boolean;
  maxHoursPerRoomPerDay: string;
  maxHoursPerRoomPerWeek: string;
  maxHoursPerDayTotal: string;
  maxHoursPerWeekTotal: string;
  useMaxDaysForward: boolean;
  maxDaysForward: string;
  useMinLeadHours: boolean;
  useMinLeadDayBefore: boolean;
  minLeadHours: string;
  minLeadDayBeforeTime: string;
};

type SemesterLetterMode = "א" | "ב" | "other";

type SemesterDraft = {
  id: string;
  studyYearLabel: string;
  letterMode: SemesterLetterMode;
  letterOther: string;
  startDate: string;
  endDate: string;
  studyDayKeys: DayKey[];
  holidays: Array<{ id: string; date: string; name: string }>;
};

const DAY_KEYS_DEFAULT: DayKey[] = ["sun", "mon", "tue", "wed", "thu"];

const createSemesterId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `semester-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createHolidayId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `holiday-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const normalizeHolidayEntries = (entries: Array<{ date: string; name: string }>): SemesterHoliday[] => {
  const map = new Map<string, SemesterHoliday>();
  entries.forEach((entry) => {
    const date = entry.date.trim();
    const name = entry.name.trim();
    if (!DATE_KEY_PATTERN.test(date)) return;
    if (!name) return;
    map.set(date, { date, name });
  });
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
};

const formatAcademicYearLabel = (studyYear: number) => {
  const safeStart = Number.isFinite(studyYear) ? Math.floor(studyYear) : new Date().getFullYear();
  const nextYear = String((safeStart + 1) % 100).padStart(2, "0");
  return `${safeStart}/${nextYear}`;
};

const parseAcademicYearStart = (value: string): number | undefined => {
  const normalized = value.trim().replace(/\s+/g, "");
  if (!normalized) return undefined;
  const matched = normalized.match(/^(\d{4})\/(\d{2})$/);
  if (!matched) return undefined;
  const startYear = Number(matched[1]);
  const nextYear = Number(matched[2]);
  if (!Number.isFinite(startYear) || startYear < 2000 || startYear > 2100) return undefined;
  if (nextYear !== ((startYear + 1) % 100)) return undefined;
  return startYear;
};

const parseOptionalLimitDraft = (value: number | undefined) => {
  const numeric = Number(value || 0);
  return numeric > 0 ? String(numeric) : "";
};

const normalizeUnlimitedInput = (value: string) => {
  const normalized = value.trim();
  if (!normalized) return "";
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return normalized;
};

const toSemesterDraft = (semester: SemesterEntity): SemesterDraft => ({
  id: semester.id,
  studyYearLabel: formatAcademicYearLabel(semester.studyYear),
  letterMode: semester.letter === "א" || semester.letter === "ב" ? semester.letter : "other",
  letterOther: semester.letter === "א" || semester.letter === "ב" ? "" : semester.letter || "",
  startDate: semester.startDate || "",
  endDate: semester.endDate || "",
  studyDayKeys: semester.studyDayKeys.length ? semester.studyDayKeys : [...DAY_KEYS_DEFAULT],
  holidays: (semester.holidays || []).map((holiday) => ({
    id: createHolidayId(),
    date: holiday.date,
    name: holiday.name
  }))
});

const createEmptySemesterDraft = (studyYear?: number): SemesterDraft => ({
  id: createSemesterId(),
  studyYearLabel: formatAcademicYearLabel(studyYear || new Date().getFullYear()),
  letterMode: "א",
  letterOther: "",
  startDate: "",
  endDate: "",
  studyDayKeys: [...DAY_KEYS_DEFAULT],
  holidays: []
});

const toSemesterEntity = (draft: SemesterDraft): SemesterEntity => {
  const inferredYear = draft.startDate ? Number(draft.startDate.slice(0, 4)) : new Date().getFullYear();
  const studyYear = parseAcademicYearStart(draft.studyYearLabel) ?? inferredYear;
  const letter = draft.letterMode === "other" ? draft.letterOther.trim() : draft.letterMode;
  return {
    id: draft.id,
    studyYear,
    letter: letter || "אחר",
    startDate: draft.startDate,
    endDate: draft.endDate,
    studyDayKeys: draft.studyDayKeys.length ? Array.from(new Set(draft.studyDayKeys)) : [...DAY_KEYS_DEFAULT],
    holidays: normalizeHolidayEntries(draft.holidays.map((holiday) => ({ date: holiday.date, name: holiday.name })))
  };
};

const createPolicyId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `policy-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createEmptyScopedPolicyDraft = (): ScopedPolicyDraft => ({
  id: createPolicyId(),
  name: "",
  enabled: true,
  isDefault: false,
  useConditionRooms: false,
  useConditionDays: false,
  useConditionDateRange: false,
  useConditionTimeRange: false,
  roomIds: [],
  dayKeys: [],
  dateStart: "",
  dateEnd: "",
  startTime: "",
  endTime: "",
  useHourQuota: false,
  maxHoursPerRoomPerDay: "",
  maxHoursPerRoomPerWeek: "",
  maxHoursPerDayTotal: "",
  maxHoursPerWeekTotal: "",
  useMaxDaysForward: false,
  maxDaysForward: "",
  useMinLeadHours: false,
  useMinLeadDayBefore: false,
  minLeadHours: "0",
  minLeadDayBeforeTime: "18:00"
});

const toScopedPolicyDraft = (policy: ReservationScopedPolicy): ScopedPolicyDraft => ({
  id: policy.id,
  name: policy.name,
  enabled: policy.enabled,
  isDefault: policy.isDefault,
  useConditionRooms: !policy.isDefault && policy.scope.roomIds.length > 0,
  useConditionDays: !policy.isDefault && policy.scope.dayKeys.length > 0,
  useConditionDateRange: !policy.isDefault && Boolean(policy.scope.dateStart || policy.scope.dateEnd),
  useConditionTimeRange: !policy.isDefault && (policy.scope.startMinutes !== undefined || policy.scope.endMinutes !== undefined),
  roomIds: policy.scope.roomIds || [],
  dayKeys: policy.scope.dayKeys || [],
  dateStart: policy.scope.dateStart || "",
  dateEnd: policy.scope.dateEnd || "",
  startTime: policy.scope.startMinutes !== undefined ? toTimeInput(policy.scope.startMinutes) : "",
  endTime: policy.scope.endMinutes !== undefined ? toTimeInput(policy.scope.endMinutes) : "",
  useHourQuota:
    Number(policy.rules.maxHoursPerRoomPerDay || 0) > 0 ||
    Number(policy.rules.maxHoursPerRoomPerWeek || 0) > 0 ||
    Number(policy.rules.maxHoursPerDayTotal || 0) > 0 ||
    Number(policy.rules.maxHoursPerWeekTotal || 0) > 0,
  maxHoursPerRoomPerDay: parseOptionalLimitDraft(policy.rules.maxHoursPerRoomPerDay),
  maxHoursPerRoomPerWeek: parseOptionalLimitDraft(policy.rules.maxHoursPerRoomPerWeek),
  maxHoursPerDayTotal: parseOptionalLimitDraft(policy.rules.maxHoursPerDayTotal),
  maxHoursPerWeekTotal: parseOptionalLimitDraft(policy.rules.maxHoursPerWeekTotal),
  useMaxDaysForward: Number(policy.rules.maxDaysForward || 0) > 0,
  maxDaysForward: parseOptionalLimitDraft(policy.rules.maxDaysForward),
  useMinLeadHours:
    policy.rules.minLeadMode === "hours_before" && Number(policy.rules.minLeadHours || 0) > 0,
  useMinLeadDayBefore: policy.rules.minLeadMode === "day_before_time",
  minLeadHours: policy.rules.minLeadHours !== undefined ? String(policy.rules.minLeadHours) : "0",
  minLeadDayBeforeTime:
    policy.rules.minLeadDayBeforeMinutes !== undefined
      ? toTimeInput(policy.rules.minLeadDayBeforeMinutes)
      : "18:00"
});

const parseOptionalNumber = (value: string) => {
  if (!value.trim()) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(0, numeric);
};

const parseLimitNumber = (value: string) => Math.max(0, parseOptionalNumber(value) || 0);

const toScopedPolicy = (draft: ScopedPolicyDraft): ReservationScopedPolicy => {
  const rules: Partial<ReservationPolicy> = {
    maxHoursPerRoomPerDay: draft.useHourQuota ? parseLimitNumber(draft.maxHoursPerRoomPerDay) : 0,
    maxHoursPerRoomPerWeek: draft.useHourQuota ? parseLimitNumber(draft.maxHoursPerRoomPerWeek) : 0,
    maxHoursPerDayTotal: draft.useHourQuota ? parseLimitNumber(draft.maxHoursPerDayTotal) : 0,
    maxHoursPerWeekTotal: draft.useHourQuota ? parseLimitNumber(draft.maxHoursPerWeekTotal) : 0,
    maxDaysForward: draft.useMaxDaysForward ? parseLimitNumber(draft.maxDaysForward) : 0
  };

  if (draft.useMinLeadDayBefore) {
    rules.minLeadMode = "day_before_time";
    rules.minLeadDayBeforeMinutes = parseTimeInput(draft.minLeadDayBeforeTime || "18:00");
  } else if (draft.useMinLeadHours) {
    rules.minLeadMode = "hours_before";
    rules.minLeadHours = parseLimitNumber(draft.minLeadHours);
  } else {
    rules.minLeadMode = "hours_before";
    rules.minLeadHours = 0;
  }

  return {
    id: draft.id || createPolicyId(),
    name: draft.isDefault ? "כל המקרים" : draft.name.trim() || "מדיניות חדשה",
    enabled: draft.isDefault ? true : draft.enabled,
    isDefault: draft.isDefault,
    scope: draft.isDefault
      ? { roomIds: [], dayKeys: [] }
      : {
          roomIds: draft.useConditionRooms ? Array.from(new Set(draft.roomIds.filter(Boolean))) : [],
          dayKeys: draft.useConditionDays ? Array.from(new Set(draft.dayKeys)) : [],
          ...(draft.useConditionDateRange && draft.dateStart ? { dateStart: draft.dateStart } : {}),
          ...(draft.useConditionDateRange && draft.dateEnd ? { dateEnd: draft.dateEnd } : {}),
          ...(draft.useConditionTimeRange && draft.startTime ? { startMinutes: parseTimeInput(draft.startTime) } : {}),
          ...(draft.useConditionTimeRange && draft.endTime ? { endMinutes: parseTimeInput(draft.endTime) } : {})
        },
    rules
  };
};

const summarizePolicyRulesParts = (policy: ReservationScopedPolicy) => {
  const parts: string[] = [];
  const pushLimit = (value: number | undefined, format: (numeric: number) => string) => {
    const numeric = Number(value || 0);
    if (numeric <= 0) return;
    parts.push(format(numeric));
  };

  pushLimit(policy.rules.maxHoursPerRoomPerDay, (numeric) => `עד ${numeric} שעות לחדר ביום`);
  pushLimit(policy.rules.maxHoursPerRoomPerWeek, (numeric) => `עד ${numeric} שעות לחדר בשבוע`);
  pushLimit(policy.rules.maxHoursPerDayTotal, (numeric) => `עד ${numeric} שעות ביום`);
  pushLimit(policy.rules.maxHoursPerWeekTotal, (numeric) => `עד ${numeric} שעות בשבוע`);
  pushLimit(policy.rules.maxDaysForward, (numeric) => `עד ${numeric} ימים קדימה`);

  if (policy.rules.minLeadMode === "hours_before" && (policy.rules.minLeadHours || 0) > 0) {
    parts.push(`לפחות ${policy.rules.minLeadHours} שעות מראש`);
  }
  if (policy.rules.minLeadMode === "day_before_time" && policy.rules.minLeadDayBeforeMinutes !== undefined) {
    parts.push(`עד ${formatMinutes(policy.rules.minLeadDayBeforeMinutes)} ביום שלפני`);
  }
  if (!parts.length) {
    parts.push("אין מגבלות פעילות");
  }
  return parts;
};

const summarizePolicyConditionsParts = (policy: ReservationScopedPolicy, roomNameById: Record<string, string>) => {
  if (policy.isDefault) return ["כל המקרים"];
  const parts: string[] = [];
  if (policy.scope.dayKeys.length) {
    const labels = policy.scope.dayKeys.map((dayKey) => scheduleWeekDays.find((day) => day.key === dayKey)?.label || dayKey);
    parts.push(`רק בימים ${labels.join(", ")}`);
  }
  if (policy.scope.roomIds.length) {
    const names = policy.scope.roomIds.map((roomId) => roomNameById[roomId] || roomId);
    parts.push(`רק בחדרים ${names.join(", ")}`);
  }
  if (policy.scope.dateStart || policy.scope.dateEnd) {
    parts.push(`בטווח תאריכים ${policy.scope.dateStart || "..."}–${policy.scope.dateEnd || "..."}`);
  }
  if (policy.scope.startMinutes !== undefined || policy.scope.endMinutes !== undefined) {
    parts.push(`בשעות ${policy.scope.startMinutes !== undefined ? formatMinutes(policy.scope.startMinutes) : "..."}–${policy.scope.endMinutes !== undefined ? formatMinutes(policy.scope.endMinutes) : "..."}`);
  }
  return parts.length ? parts : ["כל המקרים"];
};

const summarizePolicySentence = (policy: ReservationScopedPolicy, roomNameById: Record<string, string>) => {
  const conditions = summarizePolicyConditionsParts(policy, roomNameById).join(" ו־");
  const rules = summarizePolicyRulesParts(policy);
  if (policy.isDefault || conditions === "כל המקרים") {
    return `${rules.join(", ")}.`;
  }
  return `כאשר ${conditions}, ${rules.join(", ")}.`;
};

const summarizeStudyDaysCompact = (dayKeys: DayKey[]) => {
  const order = scheduleWeekDays.map((day) => day.key);
  const unique = Array.from(new Set(dayKeys)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (!unique.length) return "ללא";
  const labels = unique.map((key) => scheduleWeekDays.find((day) => day.key === key)?.short || key);
  const contiguous =
    unique.length > 1 &&
    unique.every((key, index) => {
      if (index === 0) return true;
      return order.indexOf(key) === order.indexOf(unique[index - 1]) + 1;
    });
  if (contiguous) {
    return `${labels[0]}-${labels[labels.length - 1]}`;
  }
  return labels.join(", ");
};

const isPrimarySemesterLetter = (letter: string) => {
  const normalized = letter.trim();
  return normalized === "א" || normalized === "ב" || normalized.toUpperCase() === "A" || normalized.toUpperCase() === "B";
};

export default function AdminScreen({ currentUser, onSignOut }: AdminScreenProps) {
  const isAdmin = currentUser?.role === "admin";
  const [activeSemester, setActiveSemester] = useState<string>("");
  const [activeSection, setActiveSection] = useState<AdminSection>("users");
  const [scheduleFilter, setScheduleFilter] = useState<"all" | "lessons" | "regular" | "special" | "exam" | "closed">("all");
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: "success" | "error" } | null>(null);
  const [bulkState, setBulkState] = useState<BulkState | null>(null);
  const [searchBySection, setSearchBySection] = useState<Record<AdminSection, string>>({
    users: "",
    schedule: "",
    rooms: "",
    settings: ""
  });
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<
    | null
    | {
        section: "users" | "schedule";
        kind: "csv";
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
    semesters,
    reservationPolicies,
    settingsError,
    saveSemesters,
    saveReservationPolicies
  } = useScheduleSettings();
  const activeSemesterScope = useMemo(() => {
    if (!activeSemester) return null;
    const selected = semesters.find((semester) => semester.id === activeSemester);
    if (!selected) return [activeSemester];
    if (!isPrimarySemesterLetter(selected.letter || "")) return [activeSemester];
    return [activeSemester, buildYearlySemesterId(selected.studyYear)];
  }, [activeSemester, semesters]);
  const {
    lessons,
    lessonsError,
    upsertLesson,
    removeLesson
  } = useLessons(activeSemesterScope);
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
  const [semestersDraft, setSemestersDraft] = useState<SemesterEntity[]>([]);
  const [semesterEditorDraft, setSemesterEditorDraft] = useState<SemesterDraft>(() =>
    createEmptySemesterDraft(getAcademicYearStartYear())
  );
  const [semesterEditorOpen, setSemesterEditorOpen] = useState(false);
  const [editingSemesterId, setEditingSemesterId] = useState("");
  const [semesterHolidayEditingId, setSemesterHolidayEditingId] = useState("");
  const [scopedPoliciesDraft, setScopedPoliciesDraft] = useState<ReservationScopedPolicy[]>([]);
  const [policyEditorDraft, setPolicyEditorDraft] = useState<ScopedPolicyDraft>(() => createEmptyScopedPolicyDraft());
  const [editingPolicyId, setEditingPolicyId] = useState<string>("");
  const [policyEditorOpen, setPolicyEditorOpen] = useState(false);
  const [draggingPolicyId, setDraggingPolicyId] = useState<string>("");
  const [roomDraft, setRoomDraft] = useState<RoomRecord>({
    id: "",
    name: "",
    shortName: "",
    openMinutes: rimonScheduleConfig.startHour * 60,
    closeMinutes: rimonScheduleConfig.endHour * 60,
    sortOrder: 0
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

  useEffect(() => {
    if (!policyEditorOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPolicyEditorOpen(false);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [policyEditorOpen]);

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
    setSemestersDraft(semesters);
    setEditingSemesterId("");
    setSemesterEditorDraft(createEmptySemesterDraft(currentAcademicYear));
    setSemesterHolidayEditingId("");
    setSemesterEditorOpen(false);
  }, [currentAcademicYear, semesters]);

  useEffect(() => {
    setActiveSemester((previous) => {
      if (previous && semesters.some((semester) => semester.id === previous)) return previous;
      return semesters[0]?.id || "";
    });
  }, [semesters]);

  useEffect(() => {
    setScopedPoliciesDraft(reservationPolicies);
    setEditingPolicyId("");
    setPolicyEditorDraft(createEmptyScopedPolicyDraft());
    setPolicyEditorOpen(false);
  }, [reservationPolicies]);

  const persistSemesters = async (nextSemesters: SemesterEntity[]) => {
    try {
      await saveSemesters(nextSemesters);
      return true;
    } catch {
      showToast("שמירת סמסטרים נכשלה.", "error");
      return false;
    }
  };

  const handleNewSemester = () => {
    setEditingSemesterId("");
    setSemesterEditorDraft(createEmptySemesterDraft(currentAcademicYear));
    setSemesterHolidayEditingId("");
    setSemesterEditorOpen(true);
  };

  const handleEditSemester = (semester: SemesterEntity) => {
    setEditingSemesterId(semester.id);
    setSemesterEditorDraft(toSemesterDraft(semester));
    setSemesterHolidayEditingId("");
    setSemesterEditorOpen(true);
  };

  const handleDeleteSemester = async (semesterId: string) => {
    const nextSemesters = semestersDraft.filter((semester) => semester.id !== semesterId);
    setSemestersDraft(nextSemesters);
    if (activeSemester === semesterId) {
      setActiveSemester(nextSemesters[0]?.id || "");
    }
    await persistSemesters(nextSemesters);
    if (editingSemesterId === semesterId) {
      setEditingSemesterId("");
      setSemesterEditorOpen(false);
      setSemesterHolidayEditingId("");
      setSemesterEditorDraft(createEmptySemesterDraft(currentAcademicYear));
    }
  };

  const handleApplySemesterEditor = async () => {
    if (!parseAcademicYearStart(semesterEditorDraft.studyYearLabel)) {
      showToast("שנת לימוד חייבת להיות בפורמט 20XX/XX (למשל 2025/26).", "error");
      return;
    }
    if (semesterEditorDraft.letterMode === "other" && !semesterEditorDraft.letterOther.trim()) {
      showToast("יש להזין ערך לסמסטר כאשר בוחרים \"אחר\".", "error");
      return;
    }
    const next = toSemesterEntity(semesterEditorDraft);
    if (!next.letter.trim()) {
      showToast("יש להזין סימון סמסטר (למשל א / ב / אחר).", "error");
      return;
    }
    if (!next.startDate || !next.endDate) {
      showToast("יש להזין תאריכי התחלה וסיום.", "error");
      return;
    }
    if (next.endDate < next.startDate) {
      showToast("תאריך הסיום חייב להיות אחרי תאריך ההתחלה.", "error");
      return;
    }
    const invalidHoliday = semesterEditorDraft.holidays.find(
      (holiday) => (holiday.date || holiday.name) && (!DATE_KEY_PATTERN.test(holiday.date.trim()) || !holiday.name.trim())
    );
    if (invalidHoliday) {
      showToast("יש למלא תאריך תקין ושם עבור כל חג.", "error");
      return;
    }
    const nextSemesters = (() => {
      const index = semestersDraft.findIndex((semester) => semester.id === next.id);
      if (index === -1) return [...semestersDraft, next];
      return semestersDraft.map((semester) => (semester.id === next.id ? next : semester));
    })();
    setSemestersDraft(nextSemesters);
    const ok = await persistSemesters(nextSemesters);
    if (!ok) return;
    setActiveSemester(next.id);
    setEditingSemesterId("");
    setSemesterEditorOpen(false);
    setSemesterHolidayEditingId("");
    setSemesterEditorDraft(createEmptySemesterDraft(currentAcademicYear));
    showToast(editingSemesterId ? "הסמסטר עודכן." : "הסמסטר נוסף.");
  };

  const persistScopedPolicies = async (nextPolicies: ReservationScopedPolicy[], withToast = false) => {
    try {
      await saveReservationPolicies(nextPolicies);
      if (withToast) showToast("המדיניות נשמרה.");
      return true;
    } catch {
      showToast("שמירת רשימת המדיניות נכשלה.", "error");
      return false;
    }
  };

  const handleApplyPolicyEditor = async () => {
    if (!policyEditorDraft.isDefault && !policyEditorDraft.name.trim()) {
      showToast("יש להזין שם למדיניות.", "error");
      return;
    }
    const next = toScopedPolicy(policyEditorDraft);
    const nextPolicies = (() => {
      const index = scopedPoliciesDraft.findIndex((entry) => entry.id === next.id);
      if (index === -1) {
        const defaultIndex = scopedPoliciesDraft.findIndex((entry) => entry.isDefault);
        if (defaultIndex === -1) return [...scopedPoliciesDraft, next];
        return [
          ...scopedPoliciesDraft.slice(0, defaultIndex),
          next,
          ...scopedPoliciesDraft.slice(defaultIndex)
        ];
      }
      return scopedPoliciesDraft.map((entry) => (entry.id === next.id ? next : entry));
    })();
    setScopedPoliciesDraft(nextPolicies);
    const ok = await persistScopedPolicies(nextPolicies, true);
    if (!ok) return;
    setEditingPolicyId("");
    setPolicyEditorDraft(createEmptyScopedPolicyDraft());
    setPolicyEditorOpen(false);
  };

  const handleNewScopedPolicy = () => {
    setEditingPolicyId("");
    setPolicyEditorDraft(createEmptyScopedPolicyDraft());
    setPolicyEditorOpen(true);
  };

  const handleEditScopedPolicy = (policy: ReservationScopedPolicy) => {
    setEditingPolicyId(policy.id);
    setPolicyEditorDraft(toScopedPolicyDraft(policy));
    setPolicyEditorOpen(true);
  };

  const handleDeleteScopedPolicy = async (policyId: string) => {
    const target = scopedPoliciesDraft.find((entry) => entry.id === policyId);
    if (!target || target.isDefault) return;
    const nextPolicies = scopedPoliciesDraft.filter((entry) => entry.id !== policyId);
    setScopedPoliciesDraft(nextPolicies);
    await persistScopedPolicies(nextPolicies, true);
    if (editingPolicyId === policyId) {
      setEditingPolicyId("");
      setPolicyEditorDraft(createEmptyScopedPolicyDraft());
      setPolicyEditorOpen(false);
    }
  };

  const handleSetPolicyEnabled = async (policyId: string, enabled: boolean) => {
    const nextPolicies = scopedPoliciesDraft.map((entry) =>
      entry.id === policyId ? { ...entry, enabled } : entry
    );
    setScopedPoliciesDraft(nextPolicies);
    await persistScopedPolicies(nextPolicies);
  };

  const handleMovePolicy = async (fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return;
    const fromIndex = scopedPoliciesDraft.findIndex((entry) => entry.id === fromId);
    const toIndex = scopedPoliciesDraft.findIndex((entry) => entry.id === toId);
    if (fromIndex === -1 || toIndex === -1) return;
    if (scopedPoliciesDraft[fromIndex]?.isDefault || scopedPoliciesDraft[toIndex]?.isDefault) return;
    const nextPolicies = [...scopedPoliciesDraft];
    const [moved] = nextPolicies.splice(fromIndex, 1);
    nextPolicies.splice(toIndex, 0, moved);
    setScopedPoliciesDraft(nextPolicies);
    await persistScopedPolicies(nextPolicies);
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
    if (!lesson.semester) {
      showToast("יש לבחור סמסטר לשיעור.", "error");
      return;
    }
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

  const handleReorderRooms = async (orderedRooms: RoomRecord[]) => {
    try {
      await Promise.all(
        orderedRooms.map((room, index) =>
          upsertRoom({
            ...room,
            sortOrder: index + 1
          })
        )
      );
      showToast("סדר החדרים נשמר.");
    } catch {
      showToast("שמירת סדר החדרים נכשלה.", "error");
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
    { key: "rooms", label: "חדרים", icon: <RoomIcon /> },
    { key: "settings", label: "הגדרות", icon: <TuneIcon /> }
  ];

  const toolbarTitle =
    activeSection === "users"
      ? "משתמשים"
      : activeSection === "schedule"
        ? "מערכת שעות"
        : activeSection === "rooms"
          ? "חדרים"
          : activeSection === "settings"
            ? "הגדרות"
            : "מערכת שעות";

  const roomNameById = useMemo(
    () =>
      roomsRaw.reduce<Record<string, string>>((acc, room) => {
        acc[room.id] = room.name || room.shortName || room.id;
        return acc;
      }, {}),
    [roomsRaw]
  );

  const semesterOptions = useMemo(
    () =>
      semestersDraft.map((semester) => ({
        id: semester.id,
        label: `${formatAcademicYearLabel(semester.studyYear)} · ${semester.letter}`,
        studyYear: semester.studyYear,
        letter: semester.letter
      })),
    [semestersDraft]
  );

  const settingsSectionContent = (
    <section className="admin-section">
      <div className="admin-section-body">
        <div className="admin-card">
          <div className="admin-card-header">
            <h3>סמסטרים</h3>
          </div>
          <p className="admin-meta">
            כל שיעור משויך לישות סמסטר. אפשר ליצור כמה סמסטרים לכל שנת לימוד (א / ב / אחר).
          </p>
          {settingsError ? <p className="admin-error">{settingsError}</p> : null}
          <div className="admin-actions">
            <button className="secondary" type="button" onClick={handleNewSemester}>
              סמסטר חדש
            </button>
          </div>
          <div className="admin-policy-list">
            {semestersDraft.length ? (
              semestersDraft.map((semester) => (
                <div key={semester.id} className="admin-policy-item">
                  <div className="admin-policy-item-main">
                    <p className="admin-policy-item-title">
                      {formatAcademicYearLabel(semester.studyYear)} · {semester.letter}
                      {activeSemester === semester.id ? <span className="admin-policy-pill">פעיל</span> : null}
                    </p>
                    <p className="admin-policy-item-summary">
                      טווח: {semester.startDate || "..."}–{semester.endDate || "..."} · ימי לימוד:{" "}
                      {summarizeStudyDaysCompact(semester.studyDayKeys)} ·
                      חגים: {semester.holidays.length}
                    </p>
                  </div>
                  <div className="admin-row-actions">
                    <button className="secondary" type="button" onClick={() => handleEditSemester(semester)}>
                      עריכה
                    </button>
                    <button
                      className="secondary danger"
                      type="button"
                      onClick={() => void handleDeleteSemester(semester.id)}
                      disabled={semestersDraft.length <= 1}
                    >
                      מחיקה
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p className="admin-meta">אין סמסטרים. הוסף/י לפחות אחד.</p>
            )}
          </div>
        </div>

        {semesterEditorOpen ? (
          <div
            className="admin-tool-overlay admin-policy-overlay"
            role="dialog"
            aria-modal="true"
            onClick={() => {
              setSemesterEditorOpen(false);
              setSemesterHolidayEditingId("");
            }}
          >
            <div className="admin-tool-overlay-card admin-policy-overlay-card" onClick={(event) => event.stopPropagation()}>
              <button
                className="admin-tool-overlay-close"
                type="button"
                aria-label="סגור"
                onClick={() => {
                  setSemesterEditorOpen(false);
                  setSemesterHolidayEditingId("");
                }}
              >
                <CloseIcon />
              </button>
              <div className="admin-tool-overlay-heading">
                <h3>{editingSemesterId ? "עריכת סמסטר" : "סמסטר חדש"}</h3>
              </div>

              <div className="admin-form">
                <div className="admin-form-row">
                  <label>
                    שנת לימוד (20XX/XX)
                    <input
                      type="text"
                      value={semesterEditorDraft.studyYearLabel}
                      placeholder="2025/26"
                      onChange={(event) =>
                        setSemesterEditorDraft((previous) => ({
                          ...previous,
                          studyYearLabel: event.target.value
                        }))
                      }
                    />
                  </label>
                  <label>
                    סמסטר
                    <select
                      value={semesterEditorDraft.letterMode}
                      onChange={(event) =>
                        setSemesterEditorDraft((previous) => ({
                          ...previous,
                          letterMode: event.target.value as SemesterLetterMode,
                          letterOther:
                            event.target.value === "other"
                              ? previous.letterOther
                              : ""
                        }))
                      }
                    >
                      <option value="א">א</option>
                      <option value="ב">ב</option>
                      <option value="other">אחר</option>
                    </select>
                  </label>
                </div>

                {semesterEditorDraft.letterMode === "other" ? (
                  <div className="admin-form-row single">
                    <label>
                      ערך לסמסטר
                      <input
                        type="text"
                        value={semesterEditorDraft.letterOther}
                        placeholder="קיץ / ג / מיוחד"
                        onChange={(event) =>
                          setSemesterEditorDraft((previous) => ({
                            ...previous,
                            letterOther: event.target.value
                          }))
                        }
                      />
                    </label>
                  </div>
                ) : null}

                <div className="admin-form-row">
                  <label>
                    מתאריך
                    <input
                      type="date"
                      value={semesterEditorDraft.startDate}
                      onChange={(event) =>
                        setSemesterEditorDraft((previous) => ({
                          ...previous,
                          startDate: event.target.value
                        }))
                      }
                    />
                  </label>
                  <label>
                    עד תאריך
                    <input
                      type="date"
                      value={semesterEditorDraft.endDate}
                      onChange={(event) =>
                        setSemesterEditorDraft((previous) => ({
                          ...previous,
                          endDate: event.target.value
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="admin-policy-editor-panel">
                  <h4>ימי לימוד</h4>
                  <div className="admin-policy-rooms">
                    {scheduleWeekDays.map((day) => {
                      const checked = semesterEditorDraft.studyDayKeys.includes(day.key);
                      return (
                        <label key={day.key} className="admin-policy-room-chip">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSemesterEditorDraft((previous) => ({
                                ...previous,
                                studyDayKeys: checked
                                  ? previous.studyDayKeys.filter((dayKey) => dayKey !== day.key)
                                  : [...previous.studyDayKeys, day.key]
                              }))
                            }
                          />
                          <span>{day.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="admin-policy-editor-panel">
                  <div className="admin-card-header">
                    <h4>חגים וסגירות</h4>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        const id = createHolidayId();
                        setSemesterEditorDraft((previous) => ({
                          ...previous,
                          holidays: [...previous.holidays, { id, date: "", name: "" }]
                        }));
                        setSemesterHolidayEditingId(id);
                      }}
                    >
                      הוספת חג
                    </button>
                  </div>
                  {semesterEditorDraft.holidays.length ? (
                    <div className="admin-table">
                      {semesterEditorDraft.holidays.map((holiday) => {
                        const isEditingHoliday = semesterHolidayEditingId === holiday.id;
                        return (
                          <div key={holiday.id} className="admin-row">
                            <div className="admin-row-main">
                              {isEditingHoliday ? (
                                <div className="admin-form-row">
                                  <label>
                                    תאריך
                                    <input
                                      type="date"
                                      value={holiday.date}
                                      onChange={(event) =>
                                        setSemesterEditorDraft((previous) => ({
                                          ...previous,
                                          holidays: previous.holidays.map((entry) =>
                                            entry.id === holiday.id
                                              ? { ...entry, date: event.target.value }
                                              : entry
                                          )
                                        }))
                                      }
                                    />
                                  </label>
                                  <label>
                                    שם חג
                                    <input
                                      type="text"
                                      value={holiday.name}
                                      onChange={(event) =>
                                        setSemesterEditorDraft((previous) => ({
                                          ...previous,
                                          holidays: previous.holidays.map((entry) =>
                                            entry.id === holiday.id
                                              ? { ...entry, name: event.target.value }
                                              : entry
                                          )
                                        }))
                                      }
                                      placeholder="פסח / יום הזיכרון"
                                    />
                                  </label>
                                </div>
                              ) : (
                                <>
                                  <p className="admin-row-title">{holiday.name || "ללא שם"}</p>
                                  <p className="admin-row-meta">{holiday.date || "ללא תאריך"}</p>
                                </>
                              )}
                            </div>
                            <div className="admin-row-actions">
                              <button
                                type="button"
                                className="secondary"
                                onClick={() =>
                                  setSemesterHolidayEditingId((previous) =>
                                    previous === holiday.id ? "" : holiday.id
                                  )
                                }
                              >
                                {isEditingHoliday ? "סיום עריכה" : "עריכה"}
                              </button>
                              <button
                                type="button"
                                className="secondary danger"
                                onClick={() =>
                                  setSemesterEditorDraft((previous) => ({
                                    ...previous,
                                    holidays: previous.holidays.filter((entry) => entry.id !== holiday.id)
                                  }))
                                }
                              >
                                הסרה
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="admin-meta">אין חגים מוגדרים.</p>
                  )}
                </div>

                <div className="admin-actions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      setSemesterEditorOpen(false);
                      setSemesterHolidayEditingId("");
                    }}
                  >
                    ביטול
                  </button>
                  <button className="primary" type="button" onClick={() => void handleApplySemesterEditor()}>
                    {editingSemesterId ? "עדכון סמסטר" : "הוספת סמסטר"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="admin-card">
          <div className="admin-card-header">
            <h3>מדיניות שריונים</h3>
          </div>
          <p className="admin-meta">
            עדיפות גבוהה למעלה. ברירת המחדל נשארת תמיד בשורה התחתונה.
          </p>
          <div className="admin-actions">
            <button className="secondary" type="button" onClick={handleNewScopedPolicy}>
              מדיניות חדשה
            </button>
          </div>
          <div className="admin-policy-list">
            {scopedPoliciesDraft.length === 0 ? (
              <p className="admin-meta">אין עדיין מדיניות. יש להשאיר לפחות שורת ברירת מחדל אחת.</p>
            ) : (
              scopedPoliciesDraft.map((policy) => (
                <div
                  className={`admin-policy-item${draggingPolicyId === policy.id ? " dragging" : ""}`}
                  key={policy.id}
                  draggable={!policy.isDefault}
                  onDragStart={() => setDraggingPolicyId(policy.id)}
                  onDragEnd={() => setDraggingPolicyId("")}
                  onDragOver={(event) => {
                    if (!draggingPolicyId || draggingPolicyId === policy.id) return;
                    event.preventDefault();
                  }}
                  onDrop={() => {
                    handleMovePolicy(draggingPolicyId, policy.id);
                    setDraggingPolicyId("");
                  }}
                >
                  <div className="admin-policy-item-main">
                    <p className="admin-policy-item-title">
                      {!policy.isDefault ? <span className="admin-policy-grip" aria-hidden="true">⋮⋮</span> : null}
                      {policy.name}
                      {policy.isDefault ? <span className="admin-policy-pill">ברירת מחדל</span> : null}
                      {!policy.enabled ? <span className="admin-policy-pill muted">מושבתת</span> : null}
                    </p>
                    <p className="admin-policy-item-summary">{summarizePolicySentence(policy, roomNameById)}</p>
                  </div>
                  <div className="admin-row-actions">
                    <label className="admin-policy-toggle admin-policy-row-switch">
                      <input
                        type="checkbox"
                        checked={policy.enabled}
                        disabled={policy.isDefault}
                        onChange={(event) => {
                          void handleSetPolicyEnabled(policy.id, event.target.checked);
                        }}
                      />
                      פעילה
                    </label>
                    <button className="secondary" type="button" onClick={() => handleEditScopedPolicy(policy)}>
                      עריכה
                    </button>
                    <button
                      className="secondary danger"
                      type="button"
                      onClick={() => handleDeleteScopedPolicy(policy.id)}
                      disabled={policy.isDefault}
                    >
                      מחיקה
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {policyEditorOpen ? (
          <div className="admin-tool-overlay admin-policy-overlay" role="dialog" aria-modal="true" onClick={() => setPolicyEditorOpen(false)}>
            <div className="admin-tool-overlay-card admin-policy-overlay-card" onClick={(event) => event.stopPropagation()}>
              <button
                className="admin-tool-overlay-close"
                type="button"
                aria-label="סגור"
                onClick={() => setPolicyEditorOpen(false)}
              >
                <CloseIcon />
              </button>
              <label className="admin-policy-toggle admin-policy-editor-switch">
                <input
                  type="checkbox"
                  checked={policyEditorDraft.enabled}
                  disabled={policyEditorDraft.isDefault}
                  onChange={(event) =>
                    setPolicyEditorDraft((prev) => ({
                      ...prev,
                      enabled: event.target.checked
                    }))
                  }
                />
                פעילה
              </label>
              <div className="admin-tool-overlay-heading">
                <h3>{editingPolicyId ? "עריכת מדיניות" : "מדיניות חדשה"}</h3>
              </div>

              <form
                className="admin-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleApplyPolicyEditor();
                }}
              >
                <div className="admin-form-row single">
                  <label>
                    שם מדיניות
                    <input
                      type="text"
                      value={policyEditorDraft.isDefault ? "כל המקרים" : policyEditorDraft.name}
                      readOnly={policyEditorDraft.isDefault}
                      onChange={(event) =>
                        setPolicyEditorDraft((prev) => ({
                          ...prev,
                          name: event.target.value
                        }))
                      }
                    />
                  </label>
                </div>

                <div className="admin-policy-editor-panel">
                  <h4>תנאים</h4>
                  {policyEditorDraft.isDefault ? (
                    <p className="admin-meta">ברירת המחדל חלה על כל המקרים.</p>
                  ) : (
                    <>
                      <label className="admin-policy-toggle">
                        <input
                          type="checkbox"
                          checked={policyEditorDraft.useConditionDays}
                          onChange={(event) =>
                            setPolicyEditorDraft((prev) => ({
                              ...prev,
                              useConditionDays: event.target.checked,
                              dayKeys: event.target.checked ? prev.dayKeys : []
                            }))
                          }
                        />
                        רק בימים מסוימים
                      </label>
                      {policyEditorDraft.useConditionDays ? (
                        <div className="admin-policy-rooms">
                          {scheduleWeekDays.map((day) => {
                            const checked = policyEditorDraft.dayKeys.includes(day.key);
                            return (
                              <label key={day.key} className="admin-policy-room-chip">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setPolicyEditorDraft((prev) => ({
                                      ...prev,
                                      dayKeys: checked
                                        ? prev.dayKeys.filter((key) => key !== day.key)
                                        : [...prev.dayKeys, day.key]
                                    }))
                                  }
                                />
                                <span>{day.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : null}

                      <label className="admin-policy-toggle">
                        <input
                          type="checkbox"
                          checked={policyEditorDraft.useConditionRooms}
                          onChange={(event) =>
                            setPolicyEditorDraft((prev) => ({
                              ...prev,
                              useConditionRooms: event.target.checked,
                              roomIds: event.target.checked ? prev.roomIds : []
                            }))
                          }
                        />
                        רק בחדרים מסוימים
                      </label>
                      {policyEditorDraft.useConditionRooms ? (
                        <div className="admin-policy-rooms">
                          {roomsRaw.map((room) => {
                            const checked = policyEditorDraft.roomIds.includes(room.id);
                            return (
                              <label key={room.id} className="admin-policy-room-chip">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setPolicyEditorDraft((prev) => ({
                                      ...prev,
                                      roomIds: checked
                                        ? prev.roomIds.filter((roomId) => roomId !== room.id)
                                        : [...prev.roomIds, room.id]
                                    }))
                                  }
                                />
                                <span>{room.name || room.shortName || room.id}</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : null}

                      <label className="admin-policy-toggle">
                        <input
                          type="checkbox"
                          checked={policyEditorDraft.useConditionDateRange}
                          onChange={(event) =>
                            setPolicyEditorDraft((prev) => ({
                              ...prev,
                              useConditionDateRange: event.target.checked,
                              dateStart: event.target.checked ? prev.dateStart : "",
                              dateEnd: event.target.checked ? prev.dateEnd : ""
                            }))
                          }
                        />
                        רק בטווח תאריכים
                      </label>
                      {policyEditorDraft.useConditionDateRange ? (
                        <div className="admin-form-row">
                          <label>
                            מתאריך
                            <input
                              type="date"
                              value={policyEditorDraft.dateStart}
                              onChange={(event) =>
                                setPolicyEditorDraft((prev) => ({
                                  ...prev,
                                  dateStart: event.target.value
                                }))
                              }
                            />
                          </label>
                          <label>
                            עד תאריך
                            <input
                              type="date"
                              value={policyEditorDraft.dateEnd}
                              onChange={(event) =>
                                setPolicyEditorDraft((prev) => ({
                                  ...prev,
                                  dateEnd: event.target.value
                                }))
                              }
                            />
                          </label>
                        </div>
                      ) : null}

                      <label className="admin-policy-toggle">
                        <input
                          type="checkbox"
                          checked={policyEditorDraft.useConditionTimeRange}
                          onChange={(event) =>
                            setPolicyEditorDraft((prev) => ({
                              ...prev,
                              useConditionTimeRange: event.target.checked,
                              startTime: event.target.checked ? prev.startTime : "",
                              endTime: event.target.checked ? prev.endTime : ""
                            }))
                          }
                        />
                        רק בטווח שעות
                      </label>
                      {policyEditorDraft.useConditionTimeRange ? (
                        <div className="admin-form-row">
                          <label>
                            משעה
                            <input
                              type="time"
                              value={policyEditorDraft.startTime}
                              onChange={(event) =>
                                setPolicyEditorDraft((prev) => ({
                                  ...prev,
                                  startTime: event.target.value
                                }))
                              }
                            />
                          </label>
                          <label>
                            עד שעה
                            <input
                              type="time"
                              value={policyEditorDraft.endTime}
                              onChange={(event) =>
                                setPolicyEditorDraft((prev) => ({
                                  ...prev,
                                  endTime: event.target.value
                                }))
                              }
                            />
                          </label>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="admin-policy-editor-panel">
                  <h4>כללים</h4>

                  <label className="admin-policy-toggle">
                    <input
                      type="checkbox"
                      checked={policyEditorDraft.useHourQuota}
                      onChange={(event) =>
                        setPolicyEditorDraft((prev) => ({
                          ...prev,
                          useHourQuota: event.target.checked,
                          maxHoursPerRoomPerDay: event.target.checked ? prev.maxHoursPerRoomPerDay : "",
                          maxHoursPerRoomPerWeek: event.target.checked ? prev.maxHoursPerRoomPerWeek : "",
                          maxHoursPerDayTotal: event.target.checked ? prev.maxHoursPerDayTotal : "",
                          maxHoursPerWeekTotal: event.target.checked ? prev.maxHoursPerWeekTotal : ""
                        }))
                      }
                    />
                    הקצבת שעות
                  </label>

                  <div className="admin-policy-matrix">
                    <div className="admin-policy-matrix-head" />
                    <div className="admin-policy-matrix-head">לחדר</div>
                    <div className="admin-policy-matrix-head">סה״כ</div>

                    <div className="admin-policy-matrix-rowlabel">ליום</div>
                    <div className="admin-policy-matrix-cell rich">
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        placeholder="ללא מגבלה"
                        disabled={!policyEditorDraft.useHourQuota}
                        value={policyEditorDraft.maxHoursPerRoomPerDay}
                        onChange={(event) =>
                          setPolicyEditorDraft((prev) => ({
                            ...prev,
                            maxHoursPerRoomPerDay: normalizeUnlimitedInput(event.target.value)
                          }))
                        }
                      />
                    </div>
                    <div className="admin-policy-matrix-cell rich">
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        placeholder="ללא מגבלה"
                        disabled={!policyEditorDraft.useHourQuota}
                        value={policyEditorDraft.maxHoursPerDayTotal}
                        onChange={(event) =>
                          setPolicyEditorDraft((prev) => ({
                            ...prev,
                            maxHoursPerDayTotal: normalizeUnlimitedInput(event.target.value)
                          }))
                        }
                      />
                    </div>

                    <div className="admin-policy-matrix-rowlabel">לשבוע</div>
                    <div className="admin-policy-matrix-cell rich">
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        placeholder="ללא מגבלה"
                        disabled={!policyEditorDraft.useHourQuota}
                        value={policyEditorDraft.maxHoursPerRoomPerWeek}
                        onChange={(event) =>
                          setPolicyEditorDraft((prev) => ({
                            ...prev,
                            maxHoursPerRoomPerWeek: normalizeUnlimitedInput(event.target.value)
                          }))
                        }
                      />
                    </div>
                    <div className="admin-policy-matrix-cell rich">
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        placeholder="ללא מגבלה"
                        disabled={!policyEditorDraft.useHourQuota}
                        value={policyEditorDraft.maxHoursPerWeekTotal}
                        onChange={(event) =>
                          setPolicyEditorDraft((prev) => ({
                            ...prev,
                            maxHoursPerWeekTotal: normalizeUnlimitedInput(event.target.value)
                          }))
                        }
                      />
                    </div>
                  </div>

                  <label className="admin-policy-toggle">
                    <input
                      type="checkbox"
                      checked={policyEditorDraft.useMaxDaysForward}
                      onChange={(event) =>
                        setPolicyEditorDraft((prev) => ({
                          ...prev,
                          useMaxDaysForward: event.target.checked,
                          maxDaysForward: event.target.checked ? prev.maxDaysForward : ""
                        }))
                      }
                    />
                    ימים קדימה
                  </label>
                  {policyEditorDraft.useMaxDaysForward ? (
                    <div className="admin-form-row single">
                      <label>
                        ימים קדימה
                        <input
                          type="number"
                          min={0}
                          step={1}
                          placeholder="ללא מגבלה"
                          value={policyEditorDraft.maxDaysForward}
                          onChange={(event) =>
                            setPolicyEditorDraft((prev) => ({
                              ...prev,
                              maxDaysForward: normalizeUnlimitedInput(event.target.value)
                            }))
                          }
                        />
                      </label>
                    </div>
                  ) : null}

                  <label className="admin-policy-toggle">
                    <input
                      type="checkbox"
                      checked={policyEditorDraft.useMinLeadHours}
                      onChange={(event) =>
                        setPolicyEditorDraft((prev) => ({
                          ...prev,
                          useMinLeadHours: event.target.checked,
                          useMinLeadDayBefore: event.target.checked ? false : prev.useMinLeadDayBefore,
                          minLeadHours: event.target.checked ? prev.minLeadHours || "1" : "0"
                        }))
                      }
                    />
                    זמן לפני תחילת הסלוט
                  </label>
                  {policyEditorDraft.useMinLeadHours ? (
                    <label>
                      שעות לפני תחילת סלוט
                      <input
                        type="number"
                        min={0}
                        step={0.5}
                        value={policyEditorDraft.minLeadHours}
                        onChange={(event) =>
                          setPolicyEditorDraft((prev) => ({
                            ...prev,
                            minLeadHours: event.target.value
                          }))
                        }
                      />
                    </label>
                  ) : null}

                  <label className="admin-policy-toggle">
                    <input
                      type="checkbox"
                      checked={policyEditorDraft.useMinLeadDayBefore}
                      onChange={(event) =>
                        setPolicyEditorDraft((prev) => ({
                          ...prev,
                          useMinLeadDayBefore: event.target.checked,
                          useMinLeadHours: event.target.checked ? false : prev.useMinLeadHours,
                          minLeadDayBeforeTime: event.target.checked ? prev.minLeadDayBeforeTime || "18:00" : "18:00"
                        }))
                      }
                    />
                    שעה ביום לפני
                  </label>
                  {policyEditorDraft.useMinLeadDayBefore ? (
                    <label>
                      שעה ביום שלפני
                      <input
                        type="time"
                        value={policyEditorDraft.minLeadDayBeforeTime}
                        onChange={(event) =>
                          setPolicyEditorDraft((prev) => ({
                            ...prev,
                            minLeadDayBeforeTime: event.target.value
                          }))
                        }
                      />
                    </label>
                  ) : null}
                </div>

                <div className="admin-actions">
                  <button className="secondary" type="button" onClick={() => setPolicyEditorOpen(false)}>
                    ביטול
                  </button>
                  <button className="primary" type="submit">
                    {editingPolicyId ? "עדכון מדיניות" : "הוספת מדיניות"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );

  const overlayTitle = !activeTool
    ? ""
    : activeTool.kind === "csv"
      ? `ייבוא וייצוא · ${activeTool.section === "users" ? "משתמשים" : "מערכת שעות"}`
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
                  <button
                    type="button"
                    className={`admin-toolbar-chip${activeTool?.section === "schedule" && activeTool.kind === "csv" ? " active" : ""}`}
                    onClick={() => toolToggle({ section: "schedule", kind: "csv" })}
                  >
                    <ImportExportIcon />
                    <span>ייבוא וייצוא</span>
                  </button>
                ) : null}
              </div>

              <div className="admin-toolbar-search">
                {activeSection !== "settings" ? (
                  isNarrow ? (
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
                  )
                ) : null}
              </div>
            </div>
          </div>
          {isNarrow && mobileSearchOpen && activeSection !== "settings" ? (
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
	            semesterOptions={semesterOptions}
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
            onReorder={handleReorderRooms}
            onRemove={handleRemoveRoom}
            onReset={() =>
              setRoomDraft({
                id: "",
                name: "",
                shortName: "",
                openMinutes: rimonScheduleConfig.startHour * 60,
                closeMinutes: rimonScheduleConfig.endHour * 60,
                sortOrder: 0
              })
            }
            onBulkStateChange={setBulkState}
          />
        ) : null}

        {activeSection === "settings" ? settingsSectionContent : null}
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
