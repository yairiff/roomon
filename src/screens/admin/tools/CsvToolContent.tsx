import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { doc, writeBatch } from "firebase/firestore";
import { rimonScheduleConfig } from "../../../config";
import { db } from "../../../lib/firebase";
import { parseCsvAsObjects, stringifyCsv } from "../../../lib/csv";
import { stripUndefined } from "../../../lib/stripUndefined";
import { parseTimeInput, toTimeInput } from "../../../lib/timeInput";
import { cohortStartYearFromGrade, gradeValueFromCohort } from "../../../lib/academics";
import type { DirectoryUser, LessonRecord, UserRole } from "../../../types/admin";
import type { Reservation } from "../../../types/reservations";
import { DownloadIcon, UploadIcon } from "../../../components/Icons";
import { usersCsvHelp, scheduleCsvHelp } from "./csvTool/CsvHelp";
import {
  type CsvTable,
  userCsvHeaders,
  lessonsCsvHeaders,
  reservationsCsvHeaders,
  specialCsvHeaders,
  examCsvHeaders,
  closedCsvHeaders
} from "./csvTool/csvSchema";

type CsvToolContentProps = {
  section: "users" | "schedule";
  scheduleFilter: "all" | "lessons" | "regular" | "special" | "exam" | "closed";
  activeSemester: string;
  users: DirectoryUser[];
  lessons: LessonRecord[];
  lessonsError?: string;
  reservations: Reservation[];
  reservationsError?: string;
  showToast: (message: string, tone?: "success" | "error") => void;
};

const downloadTextFile = (
  filename: string,
  content: string,
  mime = "text/csv;charset=utf-8",
  { bom = mime.includes("csv") }: { bom?: boolean } = {}
) => {
  // Excel often mis-detects UTF-8 CSV unless it has a BOM (especially on Windows).
  const payload = bom ? `\uFEFF${content}` : content;
  const blob = new Blob([payload], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export default function CsvToolContent({
  section,
  scheduleFilter,
  activeSemester,
  users,
  lessons,
  lessonsError,
  reservations,
  reservationsError,
  showToast
}: CsvToolContentProps) {
  const dayToHe = (day: LessonRecord["day"]) => {
    switch (day) {
      case "sun":
        return "א";
      case "mon":
        return "ב";
      case "tue":
        return "ג";
      case "wed":
        return "ד";
      case "thu":
        return "ה";
      default:
        return day;
    }
  };

  const parseDayCell = (raw: string): LessonRecord["day"] | null => {
    const trimmed = String(raw || "").trim().toLowerCase();
    if (!trimmed) return null;
    if (trimmed === "sun" || trimmed === "mon" || trimmed === "tue" || trimmed === "wed" || trimmed === "thu") {
      return trimmed as LessonRecord["day"];
    }
    const cleaned = trimmed.replace(/['״׳]/g, "").trim(); // accept א׳ / א" etc
    switch (cleaned) {
      case "א":
        return "sun";
      case "ב":
        return "mon";
      case "ג":
        return "tue";
      case "ד":
        return "wed";
      case "ה":
        return "thu";
      default:
        return null;
    }
  };

  const scheduleDefaultTable: CsvTable =
    scheduleFilter === "lessons"
      ? "lessons"
      : scheduleFilter === "regular"
        ? "reservations"
        : scheduleFilter === "special"
          ? "special"
          : scheduleFilter === "exam"
            ? "exam"
          : scheduleFilter === "closed"
            ? "closed"
            : "lessons";

  const [csvStep, setCsvStep] = useState<1 | 2 | 3 | 4>(1);
  const [csvTable, setCsvTable] = useState<CsvTable>(section === "users" ? "users" : scheduleDefaultTable);
  const [importMode, setImportMode] = useState<"add" | "diff" | "override">("add");
  const [importText, setImportText] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importMessage, setImportMessage] = useState("");

  useEffect(() => {
    if (section !== "users") return;
    setCsvTable("users");
  }, [section]);

  const parseTimeStrict = (value: string) => {
    const trimmed = value.trim();
    if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return null;
    const minutes = parseTimeInput(trimmed);
    if (!Number.isFinite(minutes) || minutes < 0) return null;
    const [h, m] = trimmed.split(":").map((part) => Number(part));
    if (h > 23 || m > 59) return null;
    return minutes;
  };

  const exportPayload = useMemo(() => {
    if (section === "users") {
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
      const rows = lessons.map((l) => ({
        semester: l.semester || activeSemester,
        day: dayToHe(l.day),
        roomId: l.roomId,
        startTime: toTimeInput(l.startMinutes),
        endTime: toTimeInput(l.startMinutes + l.durationMinutes),
        title: l.title || "",
        teacher: l.teacher || ""
      }));
      return { filename: "lessons.csv", csv: stringifyCsv(lessonsCsvHeaders, rows) };
    }

    if (csvTable === "reservations") {
      const rows = reservations
        .filter((r) => !r.kind)
        .map((r) => ({
          date: r.date,
          roomId: r.roomId,
          startTime: toTimeInput(r.time),
          endTime: toTimeInput(r.time + (r.durationMinutes || 60)),
          reservedEmail: r.reservedEmail || ""
        }));
      return { filename: "reservations.csv", csv: stringifyCsv(reservationsCsvHeaders, rows) };
    }

    if (csvTable === "special") {
      const rows = reservations
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

    if (csvTable === "exam") {
      const rows = reservations
        .filter((r) => r.kind === "exam")
        .map((r) => ({
          date: r.date,
          roomId: r.roomId,
          startTime: toTimeInput(r.time),
          endTime: toTimeInput(r.time + (r.durationMinutes || 60)),
          label: r.reservedBy || ""
        }));
      return { filename: "exam.csv", csv: stringifyCsv(examCsvHeaders, rows) };
    }

    const rows = reservations
      .filter((r) => r.kind === "closed")
      .map((r) => ({
        date: r.date,
        roomId: r.roomId,
        startTime: toTimeInput(r.time),
        endTime: toTimeInput(r.time + (r.durationMinutes || 60)),
        label: r.reservedBy || ""
      }));
    return { filename: "closed.csv", csv: stringifyCsv(closedCsvHeaders, rows) };
  }, [activeSemester, csvTable, lessons, reservations, section, users]);

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
      const roleAlias =
        roleNormalized === "משתמש" || roleNormalized === "user"
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
        roleRaw === "admin" || roleRaw === "moderator" || roleRaw === "student" || roleRaw === "pending" ? roleRaw : "student";

      const gradeRaw = (row.grade || "").trim().toUpperCase();
      const isStaffGrade = gradeRaw === "STAFF" || gradeRaw === "TEAM" || gradeRaw === "צוות";
      const grade =
        gradeRaw === "A" || gradeRaw === "B" || gradeRaw === "C"
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
        cohortStartYear: isStaffGrade ? undefined : grade ? cohortStartYearFromGrade(grade) : undefined
      });
    });

    return { users: next, errors };
  };

  const lessonIdFromRow = (semester: string, day: LessonRecord["day"], roomId: string, startMinutes: number) =>
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
    const semesters = new Set<string>();

    rows.forEach((row, idx) => {
      const semesterRaw = (row.semester || "").trim();
      const semester = semesterRaw || activeSemester;
      if (!semester) {
        errors.push(`שורה ${idx + 2}: semester חסר`);
        return;
      }
      const day = parseDayCell(row.day || "");
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

  const reservationIdFromRow = (date: string, roomId: string, timeMinutes: number) => `res_${date}_${roomId}_${timeMinutes}`;

  const importReservationsFromCsv = (text: string, kind: "regular" | "special" | "exam" | "closed") => {
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
        const reservedEmail = String(row.reservedEmail || "").trim().toLowerCase();
        if (!reservedEmail) {
          errors.push(`שורה ${idx + 2}: חסר reservedEmail`);
          return;
        }
        const reservedBy = users.find((u) => u.email.toLowerCase() === reservedEmail)?.name || "";
        next.push({
          id: reservationIdFromRow(date, roomId, startMinutes),
          date,
          time: startMinutes,
          durationMinutes,
          roomId,
          reservedBy,
          reservedEmail
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
        kind: kind === "special" ? "special" : kind === "exam" ? "exam" : "closed"
      });
    });

    const table = kind === "regular" ? "reservations" : kind;
    return { table: table as "reservations" | "special" | "exam" | "closed", kind, reservations: next, errors, dates };
  };

  const importPreview = useMemo(() => {
    if (!importText.trim()) return null;
    if (section === "users") return importUsersFromCsv(importText);
    if (csvTable === "lessons") return importLessonsFromCsv(importText);
    if (csvTable === "reservations") return importReservationsFromCsv(importText, "regular");
    if (csvTable === "special") return importReservationsFromCsv(importText, "special");
    if (csvTable === "exam") return importReservationsFromCsv(importText, "exam");
    return importReservationsFromCsv(importText, "closed");
  }, [activeSemester, csvTable, importText, section]);

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
        kind: "regular" | "special" | "exam" | "closed";
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

  const canonicalReservation = (r: Reservation) => {
    const kind = r.kind || "regular";
    return {
      date: r.date,
      time: r.time,
      durationMinutes: r.durationMinutes || 60,
      roomId: r.roomId,
      reservedEmail: r.reservedEmail || "",
      ...(kind === "regular" ? {} : { reservedBy: r.reservedBy || "" }),
      kind
    };
  };

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
          existing.name !== next.name ||
          existing.role !== next.role ||
          existing.phone !== next.phone ||
          existing.cohortStartYear !== next.cohortStartYear;
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
      const existingByKey = new Map(lessons.map((l) => [lessonKey(l), { id: l.id, canonical: canonicalLesson(l), semester: l.semester }]));

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
        // Override means "replace the entire lessons table" (both semesters), regardless of the current filter.
        const deleteIds = lessons.map((l) => l.id);
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
    const relevantExisting = reservations.filter((r) => {
      const k = r.kind === "special" || r.kind === "exam" || r.kind === "closed" ? r.kind : "regular";
      return k === kind;
    });
    const resKey = (r: Reservation) => `${r.date}|${r.roomId}|${r.time}|${kind}`;
    const existingByKey = new Map(relevantExisting.map((r) => [resKey(r), { id: r.id, canonical: canonicalReservation(r) }]));

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
      const deleteIds = relevantExisting.filter((r) => preview.dates.has(r.date)).map((r) => r.id);
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
    if (!importPreview) return null;
    if (importPreview.errors.length) return null;
    return buildCsvImportPlan(importPreview);
  }, [importMode, importPreview, lessons, reservations, users]);

  const handleRunCsvImport = async () => {
    const firestore = db;
    if (!firestore) {
      showToast("Firestore לא מוגדר.", "error");
      return;
    }
    if (!importText.trim()) {
      setImportMessage("בחר קובץ CSV כדי להמשיך.");
      return;
    }
    if (!importPlan) {
      setImportMessage("לא ניתן לבצע ייבוא: בדוק שיש קובץ תקין ושאין שגיאות.");
      showToast("ייבוא נכשל: יש שגיאות בקובץ.", "error");
      return;
    }

    if (section === "users") {
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
              : importPlan.kind === "exam"
                ? "מבחנים"
                : "סגירות";
        setImportMessage(`עודכנו/נוספו ${toWrite.length} ${label}.`);
        showToast(`ייבוא ${label} הושלם.`);
        return;
      }
    } catch {
      showToast("ייבוא נכשל.", "error");
    }
  };

  const csvStepTotal = 4;
  const csvTableLabel =
    section === "users"
      ? "משתמשים"
      : csvTable === "lessons"
        ? "שיעורים"
        : csvTable === "reservations"
          ? "שריונים"
          : csvTable === "special"
            ? "אירועים"
            : csvTable === "exam"
              ? "מבחנים"
            : "סגירות";

  const csvDistinctHelp = useMemo(() => {
    if (section === "users") return "email";
    if (csvTable === "lessons") return "semester + day + roomId + startTime";
    return "date + roomId + startTime";
  }, [csvTable, section]);

  const exportReservationCounts = useMemo(() => {
    const base = { regular: 0, special: 0, exam: 0, closed: 0, all: reservations.length };
    reservations.forEach((r) => {
      if (r.kind === "special") base.special += 1;
      else if (r.kind === "exam") base.exam += 1;
      else if (r.kind === "closed") base.closed += 1;
      else base.regular += 1;
    });
    return base;
  }, [reservations]);

  const exportScheduleCountLabel = useMemo(() => {
    if (section !== "schedule") return "";
    if (csvTable === "lessons") return `שיעורים: ${lessons.length}`;
    if (csvTable === "reservations") return `שריונים: ${exportReservationCounts.regular}`;
    if (csvTable === "special") return `אירועים: ${exportReservationCounts.special}`;
    if (csvTable === "exam") return `מבחנים: ${exportReservationCounts.exam}`;
    return `סגירות: ${exportReservationCounts.closed}`;
  }, [csvTable, exportReservationCounts, lessons.length, section]);

  return (
    <div className="admin-tool-content">
      <div className="admin-csv-wizard">
        <p className="admin-meta">
          שלב {csvStep}/{csvStepTotal} · טבלה: {csvTableLabel}
        </p>

        {csvStep === 1 ? (
          <>
            <p className="admin-meta">בחר טבלה לעבודה:</p>
            <div className="admin-inline" style={{ flexWrap: "wrap", gap: 10 }}>
              {(
                section === "users"
                  ? ([{ key: "users", label: "משתמשים" }] as const)
                  : ([
                      { key: "lessons", label: "שיעורים" },
                      { key: "reservations", label: "שריונים" },
                      { key: "special", label: "אירועים" },
                      { key: "exam", label: "מבחנים" },
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
                {section === "users" ? `${users.length} משתמשים` : exportScheduleCountLabel}
              </span>
            </div>

            {section === "users" ? usersCsvHelp : null}
            {section === "schedule" && (lessonsError || reservationsError) ? (
              <p className="admin-error">{lessonsError || reservationsError}</p>
            ) : null}
            {section === "schedule" && csvTable !== "users" ? scheduleCsvHelp(csvTable as Exclude<CsvTable, "users">) : null}

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
                <span className="admin-radio-help">
                  · מוחק רשומות קיימות בתחום הקובץ (סמסטרים/תאריכים), ואז מייבא מחדש
                </span>
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
  );
}
