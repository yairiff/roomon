import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../lib/firebase";
import { allDayKeys, defaultWeekDayKeys, rimonScheduleConfig } from "../config";
import type {
  ApiSyncEntityConfig,
  ApiSyncEntityKey,
  ApiSyncSettings,
  ReservationPolicy,
  ReservationPolicyScope,
  ReservationScopedPolicy,
  SemesterEntity,
  SemesterHoliday,
  SemesterRange
} from "../types/settings";
import type { DayKey } from "../types/schedule";
import { DEFAULT_API_SYNC_SETTINGS, DEFAULT_RESERVATION_POLICY } from "../types/settings";

const validStudyDayKeys: DayKey[] = [...defaultWeekDayKeys];
const validPolicyDayKeys: DayKey[] = [...allDayKeys];
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_POLICY_ID = "default-policy";

const toYearFromDateKey = (value: string, fallback: number) => {
  const year = Number(value.slice(0, 4));
  return Number.isInteger(year) ? year : fallback;
};

const trimDateKey = (value: unknown) => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return DATE_KEY_PATTERN.test(trimmed) ? trimmed : "";
};

const uniqueStudyDayKeys = (raw: unknown): DayKey[] => {
  if (!Array.isArray(raw)) return [...validStudyDayKeys];
  const entries = raw.filter(
    (entry): entry is DayKey => typeof entry === "string" && validStudyDayKeys.includes(entry as DayKey)
  );
  return entries.length ? Array.from(new Set(entries)) : [...validStudyDayKeys];
};

const uniqueHolidays = (raw: unknown): SemesterHoliday[] => {
  if (!Array.isArray(raw)) return [];
  const merged = new Map<string, SemesterHoliday>();

  raw.forEach((entry) => {
    if (typeof entry === "string") {
      const date = entry.trim();
      if (!DATE_KEY_PATTERN.test(date)) return;
      if (!merged.has(date)) {
        merged.set(date, {
          date,
          name: "חג",
          displayName: undefined
        });
      }
      return;
    }
    if (!entry || typeof entry !== "object") return;
    const item = entry as Record<string, unknown>;
    const date = typeof item.date === "string" ? item.date.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const displayName = typeof item.displayName === "string" ? item.displayName.trim() : "";
    const sortOrderRaw = Number(item.sortOrder);
    const sortOrder = Number.isFinite(sortOrderRaw) ? Math.round(sortOrderRaw) : undefined;
    if (!DATE_KEY_PATTERN.test(date)) return;
    merged.set(date, {
      date,
      name: name || "סגירת קמפוס",
      displayName: displayName || undefined,
      sortOrder,
      syncSource: item.syncSource === "api" ? "api" : item.syncSource === "manual" ? "manual" : undefined
    });
  });

  return Array.from(merged.values()).sort((a, b) => {
    const orderA = typeof a.sortOrder === "number" ? a.sortOrder : Number.MAX_SAFE_INTEGER;
    const orderB = typeof b.sortOrder === "number" ? b.sortOrder : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.date.localeCompare(b.date);
  });
};

const semesterIdSlug = (value: string) => {
  const latin = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return latin || "custom";
};

const buildSemesterId = (studyYear: number, letter: string, fallbackIndex: number) =>
  `semester-${studyYear}-${semesterIdSlug(letter)}-${fallbackIndex + 1}`;

const legacyLetterFromKey = (key: string) => {
  if (key === "A") return "א";
  if (key === "B") return "ב";
  return key || "אחר";
};

const seedSemestersFromRanges = (ranges: SemesterRange[]) => {
  const fallbackYear = new Date().getFullYear();
  return ranges
    .map((range, index): SemesterEntity | null => {
      const startDate = trimDateKey(range.start);
      const endDate = trimDateKey(range.end);
      if (!startDate || !endDate) return null;
      const key = (range.key || "").trim();
      const letter = legacyLetterFromKey(key);
      const studyYear = toYearFromDateKey(startDate, fallbackYear);
      return {
        id: key || buildSemesterId(studyYear, letter, index),
        studyYear,
        letter,
        startDate,
        endDate,
        studyDayKeys: [...validStudyDayKeys],
        holidays: []
      };
    })
    .filter((entry): entry is SemesterEntity => Boolean(entry));
};

const DEFAULT_SEMESTERS: SemesterEntity[] = seedSemestersFromRanges(
  rimonScheduleConfig.semesterRanges.map((range) => ({ key: range.key, start: range.start, end: range.end }))
);
const DEFAULT_RANGES: SemesterRange[] = DEFAULT_SEMESTERS.map((semester) => ({
  key: semester.id,
  start: semester.startDate,
  end: semester.endDate
}));

const clampHours = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(168, numeric));
};

const clampMinutes = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(23 * 60 + 59, Math.round(numeric)));
};

const clampDays = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(365, Math.round(numeric)));
};

const clampConcurrency = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(1, Math.round(fallback) || 1);
  return Math.max(1, Math.min(32, Math.round(numeric)));
};

const clampReservationGapMinutes = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(7 * 24 * 60, Math.round(numeric)));
};

const API_SYNC_ENTITY_KEYS: ApiSyncEntityKey[] = ["rooms", "lessons", "semesters", "holidays"];

const clampIntervalMinutes = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(15, Math.min(7 * 24 * 60, Math.round(numeric)));
};

const stripUndefinedDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefinedDeep(entry));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, entry]) => {
      if (entry === undefined) return acc;
      acc[key] = stripUndefinedDeep(entry);
      return acc;
    }, {});
  }
  return value;
};

const sanitizePolicy = (policy?: Partial<ReservationPolicy>): ReservationPolicy => ({
  blockReservations: policy?.blockReservations === true,
  maxHoursPerRoomPerDay: clampHours(
    policy?.maxHoursPerRoomPerDay,
    DEFAULT_RESERVATION_POLICY.maxHoursPerRoomPerDay
  ),
  maxHoursPerRoomPerWeek: clampHours(
    policy?.maxHoursPerRoomPerWeek,
    DEFAULT_RESERVATION_POLICY.maxHoursPerRoomPerWeek
  ),
  maxHoursPerDayTotal: clampHours(
    policy?.maxHoursPerDayTotal,
    DEFAULT_RESERVATION_POLICY.maxHoursPerDayTotal
  ),
  maxHoursPerWeekTotal: clampHours(
    policy?.maxHoursPerWeekTotal,
    DEFAULT_RESERVATION_POLICY.maxHoursPerWeekTotal
  ),
  maxDaysForward: clampDays(
    policy?.maxDaysForward,
    DEFAULT_RESERVATION_POLICY.maxDaysForward
  ),
  maxConcurrentReservations: clampConcurrency(
    policy?.maxConcurrentReservations,
    DEFAULT_RESERVATION_POLICY.maxConcurrentReservations
  ),
  minMinutesBetweenReservationsPerRoom: clampReservationGapMinutes(
    policy?.minMinutesBetweenReservationsPerRoom,
    DEFAULT_RESERVATION_POLICY.minMinutesBetweenReservationsPerRoom
  ),
  minMinutesBetweenReservationsTotal: clampReservationGapMinutes(
    policy?.minMinutesBetweenReservationsTotal,
    DEFAULT_RESERVATION_POLICY.minMinutesBetweenReservationsTotal
  ),
  minLeadMode:
    policy?.minLeadMode === "day_before_time" || policy?.minLeadMode === "hours_before"
      ? policy.minLeadMode
      : DEFAULT_RESERVATION_POLICY.minLeadMode,
  minLeadHours: clampHours(policy?.minLeadHours, DEFAULT_RESERVATION_POLICY.minLeadHours),
  minLeadDayBeforeEnabled:
    policy?.minLeadDayBeforeEnabled === true || policy?.minLeadMode === "day_before_time",
  minLeadDayBeforeMinutes: clampMinutes(
    policy?.minLeadDayBeforeMinutes,
    DEFAULT_RESERVATION_POLICY.minLeadDayBeforeMinutes
  )
});

const sanitizePartialPolicyRules = (rulesRaw: Record<string, unknown>) => {
  const rules: Partial<ReservationPolicy> = {};
  if (rulesRaw.blockReservations !== undefined) {
    rules.blockReservations = rulesRaw.blockReservations === true;
  }
  if (rulesRaw.maxHoursPerRoomPerDay !== undefined) {
    rules.maxHoursPerRoomPerDay = clampHours(rulesRaw.maxHoursPerRoomPerDay, 0);
  }
  if (rulesRaw.maxHoursPerRoomPerWeek !== undefined) {
    rules.maxHoursPerRoomPerWeek = clampHours(rulesRaw.maxHoursPerRoomPerWeek, 0);
  }
  if (rulesRaw.maxHoursPerDayTotal !== undefined) {
    rules.maxHoursPerDayTotal = clampHours(rulesRaw.maxHoursPerDayTotal, 0);
  }
  if (rulesRaw.maxHoursPerWeekTotal !== undefined) {
    rules.maxHoursPerWeekTotal = clampHours(rulesRaw.maxHoursPerWeekTotal, 0);
  }
  if (rulesRaw.maxDaysForward !== undefined) {
    rules.maxDaysForward = clampDays(rulesRaw.maxDaysForward, 0);
  }
  if (rulesRaw.maxConcurrentReservations !== undefined) {
    rules.maxConcurrentReservations = clampConcurrency(
      rulesRaw.maxConcurrentReservations,
      DEFAULT_RESERVATION_POLICY.maxConcurrentReservations
    );
  }
  if (rulesRaw.minMinutesBetweenReservationsPerRoom !== undefined) {
    rules.minMinutesBetweenReservationsPerRoom = clampReservationGapMinutes(
      rulesRaw.minMinutesBetweenReservationsPerRoom,
      0
    );
  }
  if (rulesRaw.minMinutesBetweenReservationsTotal !== undefined) {
    rules.minMinutesBetweenReservationsTotal = clampReservationGapMinutes(
      rulesRaw.minMinutesBetweenReservationsTotal,
      0
    );
  }
  if (rulesRaw.minLeadMode === "hours_before" || rulesRaw.minLeadMode === "day_before_time") {
    rules.minLeadMode = rulesRaw.minLeadMode;
  }
  if (rulesRaw.minLeadHours !== undefined) {
    rules.minLeadHours = clampHours(rulesRaw.minLeadHours, 0);
  }
  if (rulesRaw.minLeadDayBeforeEnabled !== undefined) {
    rules.minLeadDayBeforeEnabled = rulesRaw.minLeadDayBeforeEnabled === true;
  }
  if (rulesRaw.minLeadDayBeforeMinutes !== undefined) {
    rules.minLeadDayBeforeMinutes = clampMinutes(rulesRaw.minLeadDayBeforeMinutes, 18 * 60);
  }
  return rules;
};

const sanitizeSemesters = (
  semestersRaw: unknown,
  legacyRangesRaw: unknown
): SemesterEntity[] => {
  const fallbackYear = new Date().getFullYear();
  const legacyRanges = Array.isArray(legacyRangesRaw)
    ? legacyRangesRaw
        .map((range) => {
          if (!range || typeof range !== "object") return null;
          const item = range as Record<string, unknown>;
          const key = typeof item.key === "string" ? item.key.trim() : "";
          const start = trimDateKey(item.start);
          const end = trimDateKey(item.end);
          if (!start || !end) return null;
          return { key, start, end } as SemesterRange;
        })
        .filter((entry): entry is SemesterRange => Boolean(entry))
    : [];

  const base = Array.isArray(semestersRaw)
    ? semestersRaw
        .map((raw, index): SemesterEntity | null => {
          if (!raw || typeof raw !== "object") return null;
          const item = raw as Record<string, unknown>;
          const startDate = trimDateKey(item.startDate ?? item.start);
          const endDate = trimDateKey(item.endDate ?? item.end);
          if (!startDate || !endDate) return null;

          const rawLetter =
            typeof item.letter === "string" && item.letter.trim()
              ? item.letter.trim()
              : typeof item.label === "string" && item.label.trim()
                ? item.label.trim()
                : typeof item.key === "string" && item.key.trim()
                  ? legacyLetterFromKey(item.key.trim())
                  : "אחר";
          const studyYearRaw =
            typeof item.studyYear === "number" || typeof item.studyYear === "string"
              ? Number(item.studyYear)
              : toYearFromDateKey(endDate, fallbackYear) - 1;
          const studyYear = Number.isFinite(studyYearRaw)
            ? Math.max(2000, Math.min(2100, Math.floor(studyYearRaw)))
            : toYearFromDateKey(endDate, fallbackYear) - 1;
          const idRaw =
            typeof item.id === "string" && item.id.trim()
              ? item.id.trim()
              : typeof item.key === "string" && item.key.trim()
                ? item.key.trim()
                : "";
          const displayName = typeof item.displayName === "string" ? item.displayName.trim() : "";
          const sortOrderRaw = Number(item.sortOrder);
          const sortOrder = Number.isFinite(sortOrderRaw) ? Math.round(sortOrderRaw) : undefined;
          return {
            id: idRaw || buildSemesterId(studyYear, rawLetter, index),
            studyYear,
            letter: rawLetter,
            displayName: displayName || undefined,
            sortOrder,
            syncSource:
              item.syncSource === "api"
                ? "api"
                : item.syncSource === "manual"
                  ? "manual"
                  : (idRaw || "").startsWith("api-semester-")
                    ? "api"
                    : undefined,
            startDate,
            endDate,
            studyDayKeys: uniqueStudyDayKeys(item.studyDayKeys),
            holidays: uniqueHolidays(item.holidays)
          };
        })
        .filter((entry): entry is SemesterEntity => Boolean(entry))
    : [];

  const list = base.length
    ? base
    : legacyRanges.length
      ? seedSemestersFromRanges(legacyRanges)
      : DEFAULT_SEMESTERS;

  if (!list.length) return [];

  const usedIds = new Set<string>();
  return list
    .map((semester, index) => {
    let id = semester.id || buildSemesterId(semester.studyYear, semester.letter, index);
    while (usedIds.has(id)) {
      id = `${id}-${index + 1}`;
    }
    usedIds.add(id);
    return {
      ...semester,
      id
    };
    })
    .sort((a, b) => {
      const orderA = typeof a.sortOrder === "number" ? a.sortOrder : Number.MAX_SAFE_INTEGER;
      const orderB = typeof b.sortOrder === "number" ? b.sortOrder : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id);
    });
};

const semesterRangesFromSemesters = (semesters: SemesterEntity[]): SemesterRange[] =>
  semesters.map((semester) => ({
    key: semester.id,
    start: semester.startDate,
    end: semester.endDate
  }));

const buildDefaultPolicyRow = (
  policy: ReservationPolicy,
  previous?: {
    id?: string;
    name?: string;
    enabled?: boolean;
    scope?: ReservationPolicyScope;
  }
): ReservationScopedPolicy => ({
  id: previous?.id || DEFAULT_POLICY_ID,
  name: "כל המקרים",
  enabled: true,
  isDefault: true,
  scope: {
    roomIds: [],
    semesterIds: [],
    dayKeys:
      previous?.scope?.dayKeys?.length
        ? previous.scope.dayKeys.filter((key): key is DayKey => validPolicyDayKeys.includes(key as DayKey))
        : [...validStudyDayKeys],
    startMinutes:
      typeof previous?.scope?.startMinutes === "number"
        ? clampMinutes(previous.scope.startMinutes, rimonScheduleConfig.startHour * 60)
        : rimonScheduleConfig.startHour * 60,
    endMinutes:
      typeof previous?.scope?.endMinutes === "number"
        ? clampMinutes(previous.scope.endMinutes, rimonScheduleConfig.endHour * 60)
        : rimonScheduleConfig.endHour * 60
  },
  rules: { ...policy, blockReservations: false }
});

const ensureDefaultPolicyRow = (
  policies: ReservationScopedPolicy[],
  fallback: ReservationPolicy
) => {
  const list = [...policies];
  const defaultIndex = list.findIndex((entry) => entry.isDefault || entry.id === DEFAULT_POLICY_ID);
  const defaultSource = defaultIndex >= 0 ? list[defaultIndex] : undefined;
  const defaultRules = sanitizePolicy({
    ...fallback,
    ...(defaultSource?.rules || {})
  });
  const defaultRow = buildDefaultPolicyRow(defaultRules, defaultSource);
  const nonDefault = list
    .filter((entry, index) => index !== defaultIndex)
    .map((entry) => ({ ...entry, isDefault: false }));
  return [...nonDefault, defaultRow];
};

const sanitizeScopedPolicies = (
  policies: unknown,
  fallbackDefault: ReservationPolicy
): ReservationScopedPolicy[] => {
  const mapped = Array.isArray(policies)
    ? policies
        .map((raw, index): ReservationScopedPolicy | null => {
          if (!raw || typeof raw !== "object") return null;
          const item = raw as Record<string, unknown>;
          const scopeRaw =
            item.scope && typeof item.scope === "object"
              ? (item.scope as Record<string, unknown>)
              : {};
          const rulesRaw =
            item.rules && typeof item.rules === "object"
              ? (item.rules as Record<string, unknown>)
              : {};
          const id =
            typeof item.id === "string" && item.id.trim()
              ? item.id.trim()
              : `policy-${index + 1}`;
          const name =
            typeof item.name === "string" && item.name.trim()
              ? item.name.trim()
              : `Policy ${index + 1}`;
          const isDefault = item.isDefault === true || id === DEFAULT_POLICY_ID;
          const scopeRoomIds = Array.isArray(scopeRaw.roomIds)
            ? scopeRaw.roomIds
                .filter((entry): entry is string => typeof entry === "string")
                .map((entry) => entry.trim())
                .filter(Boolean)
            : [];
          const scopeSemesterIds = Array.isArray(scopeRaw.semesterIds)
            ? scopeRaw.semesterIds
                .filter((entry): entry is string => typeof entry === "string")
                .map((entry) => entry.trim())
                .filter(Boolean)
            : [];
          const defaultScope = {
            roomIds: [],
            semesterIds: [],
            dayKeys: Array.isArray(scopeRaw.dayKeys)
              ? scopeRaw.dayKeys.filter(
                  (entry): entry is DayKey =>
                    typeof entry === "string" && validPolicyDayKeys.includes(entry as DayKey)
                )
              : [...validStudyDayKeys],
            startMinutes:
              scopeRaw.startMinutes !== undefined
                ? clampMinutes(scopeRaw.startMinutes, rimonScheduleConfig.startHour * 60)
                : rimonScheduleConfig.startHour * 60,
            endMinutes:
              scopeRaw.endMinutes !== undefined
                ? clampMinutes(scopeRaw.endMinutes, rimonScheduleConfig.endHour * 60)
                : rimonScheduleConfig.endHour * 60
          };
          return {
            id,
            name: isDefault ? "כל המקרים" : name,
            enabled: item.enabled !== false,
            isDefault,
            scope: isDefault
              ? defaultScope
              : {
                  roomIds: scopeRoomIds,
                  semesterIds: scopeSemesterIds,
                  dayKeys: Array.isArray(scopeRaw.dayKeys)
                    ? scopeRaw.dayKeys.filter(
                        (entry): entry is DayKey =>
                          typeof entry === "string" && validPolicyDayKeys.includes(entry as DayKey)
                      )
                    : [],
                  dateStart: typeof scopeRaw.dateStart === "string" ? scopeRaw.dateStart : undefined,
                  dateEnd: typeof scopeRaw.dateEnd === "string" ? scopeRaw.dateEnd : undefined,
                  startMinutes:
                    scopeRaw.startMinutes !== undefined ? clampMinutes(scopeRaw.startMinutes, 0) : undefined,
                  endMinutes:
                    scopeRaw.endMinutes !== undefined ? clampMinutes(scopeRaw.endMinutes, 23 * 60 + 59) : undefined
                },
            rules: isDefault
              ? sanitizePolicy({ ...fallbackDefault, ...rulesRaw })
              : sanitizePartialPolicyRules(rulesRaw)
          };
        })
        .filter((entry): entry is ReservationScopedPolicy => Boolean(entry))
    : [];
  return ensureDefaultPolicyRow(mapped, fallbackDefault);
};

const sanitizeApiSyncEntity = (
  raw: unknown,
  fallback: ApiSyncEntityConfig
): ApiSyncEntityConfig => {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    enabled: source.enabled === true,
    lastSuccessAt:
      typeof source.lastSuccessAt === "number" ? Math.max(0, Math.round(source.lastSuccessAt)) : undefined,
    lastAttemptAt:
      typeof source.lastAttemptAt === "number" ? Math.max(0, Math.round(source.lastAttemptAt)) : undefined,
    lastError: typeof source.lastError === "string" ? source.lastError : undefined
  };
};

const sanitizeRoomIdMap = (raw: unknown): Record<string, string> => {
  if (!raw || typeof raw !== "object") return {};
  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, string>>((acc, [remote, local]) => {
    if (typeof local !== "string") return acc;
    const remoteTrimmed = remote.trim();
    const localTrimmed = local.trim();
    if (!remoteTrimmed || !localTrimmed) return acc;
    acc[remoteTrimmed] = localTrimmed;
    return acc;
  }, {});
};

const sanitizeApiSyncSettings = (raw: unknown): ApiSyncSettings => {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const entitiesRaw =
    source.entities && typeof source.entities === "object"
      ? (source.entities as Record<string, unknown>)
      : {};
  const entities = API_SYNC_ENTITY_KEYS.reduce<Record<ApiSyncEntityKey, ApiSyncEntityConfig>>((acc, key) => {
    acc[key] = sanitizeApiSyncEntity(entitiesRaw[key], DEFAULT_API_SYNC_SETTINGS.entities[key]);
    return acc;
  }, { ...DEFAULT_API_SYNC_SETTINGS.entities });
  const legacyInterval =
    Object.values(entitiesRaw)
      .map((entry) =>
        entry && typeof entry === "object"
          ? Number((entry as Record<string, unknown>).intervalMinutes)
          : Number.NaN
      )
      .find((value) => Number.isFinite(value)) ?? DEFAULT_API_SYNC_SETTINGS.intervalMinutes;

  return {
    primaryEndpoint: (() => {
      if (typeof source.primaryEndpoint !== "string") return DEFAULT_API_SYNC_SETTINGS.primaryEndpoint;
      const trimmed = source.primaryEndpoint.trim();
      return trimmed || DEFAULT_API_SYNC_SETTINGS.primaryEndpoint;
    })(),
    intervalMinutes: clampIntervalMinutes(
      source.intervalMinutes,
      clampIntervalMinutes(legacyInterval, DEFAULT_API_SYNC_SETTINGS.intervalMinutes)
    ),
    entities,
    roomIdMap: sanitizeRoomIdMap(source.roomIdMap)
  };
};

export function useScheduleSettings() {
  const [semesters, setSemesters] = useState<SemesterEntity[]>(DEFAULT_SEMESTERS);
  const [semesterRanges, setSemesterRanges] = useState<SemesterRange[]>(DEFAULT_RANGES);
  const [reservationPolicies, setReservationPolicies] = useState<ReservationScopedPolicy[]>([
    buildDefaultPolicyRow(DEFAULT_RESERVATION_POLICY)
  ]);
  const [apiSync, setApiSync] = useState<ApiSyncSettings>(DEFAULT_API_SYNC_SETTINGS);
  const [settingsReady, setSettingsReady] = useState<boolean>(!db);
  const [settingsError, setSettingsError] = useState<string>("");

  useEffect(() => {
    if (!db) {
      setSettingsError("Firestore is not configured.");
      setSettingsReady(true);
      return;
    }

    const ref = doc(db, "settings", "schedule");
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as {
          semesters?: unknown;
          semesterRanges?: SemesterRange[];
          reservationPolicy?: Partial<ReservationPolicy>;
          reservationPolicies?: unknown;
          apiSync?: unknown;
        } | undefined;
        const legacyDefault = sanitizePolicy(data?.reservationPolicy);
        const nextSemesters = sanitizeSemesters(data?.semesters, data?.semesterRanges);
        setSemesters(nextSemesters);
        setSemesterRanges(semesterRangesFromSemesters(nextSemesters));
        setReservationPolicies(sanitizeScopedPolicies(data?.reservationPolicies, legacyDefault));
        setApiSync(sanitizeApiSyncSettings(data?.apiSync));
        setSettingsError("");
        setSettingsReady(true);
      },
      () => {
        setSettingsError("Failed to load schedule settings.");
        setSettingsReady(true);
      }
    );

    return () => unsubscribe();
  }, []);

  const saveSemesters = async (nextSemesters: SemesterEntity[]) => {
    if (!db) return;
    const sanitized = sanitizeSemesters(nextSemesters, []);
    const ranges = semesterRangesFromSemesters(sanitized);
    await setDoc(
      doc(db, "settings", "schedule"),
      stripUndefinedDeep({
        semesters: sanitized,
        // Keep legacy field for older readers.
        semesterRanges: ranges
      }) as Record<string, unknown>,
      { merge: true }
    );
  };

  const saveSemesterRanges = async (ranges: SemesterRange[]) => {
    await saveSemesters(seedSemestersFromRanges(ranges));
  };

  const saveReservationPolicies = async (policies: ReservationScopedPolicy[]) => {
    if (!db) return;
    const sanitized = ensureDefaultPolicyRow(policies, DEFAULT_RESERVATION_POLICY);
    const defaultPolicy = sanitizePolicy(sanitized.find((entry) => entry.isDefault)?.rules);
    await setDoc(
      doc(db, "settings", "schedule"),
      stripUndefinedDeep({
        reservationPolicies: sanitized,
        // Keep a mirrored legacy field for backward compatibility.
        reservationPolicy: defaultPolicy
      }) as Record<string, unknown>,
      { merge: true }
    );
  };

  const saveApiSync = async (next: ApiSyncSettings) => {
    if (!db) return;
    const sanitized = sanitizeApiSyncSettings(next);
    await setDoc(
      doc(db, "settings", "schedule"),
      {
        apiSync: stripUndefinedDeep(sanitized)
      },
      { merge: true }
    );
  };

  const reservationPolicy = sanitizePolicy(reservationPolicies.find((entry) => entry.isDefault)?.rules);

  return {
    semesters,
    semesterRanges,
    reservationPolicy,
    reservationPolicies,
    apiSync,
    settingsReady,
    settingsError,
    saveSemesters,
    saveSemesterRanges,
    saveReservationPolicies,
    saveApiSync
  };
}
