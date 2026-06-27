import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import HomeViewRouter from "./HomeViewRouter";
import ReserveConfirmOverlay from "./overlays/ReserveConfirmOverlay";
import MyScheduleAddOverlay from "./overlays/MyScheduleAddOverlay";
import ReservationDetailsOverlay from "./overlays/ReservationDetailsOverlay";
import BlockDetailsOverlay from "./overlays/BlockDetailsOverlay";
import { isFirebaseStorageDownloadUrl, isGoogleUserContentUrl } from "../../lib/profilePhoto";
import ConfirmOverlay from "./overlays/ConfirmOverlay";
import AdminEditOverlay from "./overlays/AdminEditOverlay";
import ScheduleTopBarSubtitle from "./topBar/ScheduleTopBarSubtitle";
import MyScheduleTopBarSubtitle from "./topBar/MyScheduleTopBarSubtitle";
import { useSchedule } from "../../hooks/useSchedule";
import { useLessonOverrides } from "../../hooks/useLessonOverrides";
import { useDirectoryUsers } from "../../hooks/useDirectoryUsers";
import { collection, deleteField, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../lib/firebase";
import {
  addDays,
  buildWeekDates,
  formatDateKey,
  formatShortDate,
  getDayKeyFromDateKey,
  getWeekStart,
  getWeekNumber,
  parseDateKey
} from "../../lib/date";
import { formatMinutes } from "../../lib/scheduleBuilder";
import { formatDurationLabelHe } from "../../lib/formatDurationHe";
import { applyLessonOverrides } from "../../lib/lessonOverrides";
import { buildApprovedQuotaParticipantEmails, getReservationUsageShareForEmail, normalizeEmailList } from "../../lib/quotaUsage";
import {
  deriveActiveHoursFromReservationPolicyWindows,
  isReservationPolicySlotAllowed
} from "../../lib/reservationPolicyWindows";
import type { User } from "../../types/auth";
import type { Reservation, ReservationMap, ReserveRequest } from "../../types/reservations";
import type { DayKey, Lesson, TimeSlot } from "../../types/schedule";
import type { TopBarContext, ViewMode } from "../../types/ui";
import type { MySchedulePin } from "../../types/mySchedule";
import type { ReservationPolicy } from "../../types/settings";
import { useMySchedulePins } from "./hooks/useMySchedulePins";
import { useReserveFlow } from "./hooks/useReserveFlow";
import { useAdminDraftFlow } from "./hooks/useAdminDraftFlow";
import { PERSONAL_PIN_ROOM_ID } from "./views/MyScheduleView";
import { useUserAvailability } from "./hooks/useUserAvailability";
import { useCollaborationGroups } from "./hooks/useCollaborationGroups";
import { normalizeUserAvailability } from "../../lib/collaboration";
import type {
  AvailabilityDateOffs,
  CollaborationGroup,
  CollaboratorEvent,
  RehearsalParticipant,
  UserAvailability
} from "../../types/collaboration";
import type { GroupRehearsal } from "../../types/collaboration";
import { allDayKeys, defaultWeekDayKeys } from "../../config";

export type HomeScreenProps = {
  currentUser: User | null;
  setAuthError: (message: string) => void;
  onContextChange?: (context: TopBarContext) => void;
  onReservationWindowChange?: (window: { startDate: string; endDate: string }) => void;
  onQuotaReferenceDateChange?: (dateKey: string) => void;
  reservationMap: ReservationMap;
  addReservation: (reservation: Reservation) => Promise<boolean>;
  upsertReservation: (reservation: Reservation) => Promise<boolean>;
  releaseReservation: (dateKey: string, reservationId: string) => Promise<boolean>;
  view: ViewMode;
  onViewChange: (view: ViewMode) => void;
  requestedView?: ViewMode | null;
  onRequestedViewHandled?: () => void;
  navReselectView?: ViewMode | null;
  navReselectToken?: number;
  adminMode?: boolean;
  collaborationEnabled?: boolean;
  onGroupsPendingCountChange?: (count: number) => void;
};

type CollaboratorProfile = {
  email: string;
  name: string;
  availability: UserAvailability;
  dateOffs: AvailabilityDateOffs;
  events: CollaboratorEvent[];
};

const DEFAULT_POLICY_DAY_KEYS: DayKey[] = [...defaultWeekDayKeys];
const ALL_DAY_KEYS: DayKey[] = [...allDayKeys];

const cloneAvailability = (source: UserAvailability): UserAvailability =>
  ALL_DAY_KEYS.reduce((acc, dayKey) => {
    acc[dayKey] = {
      enabled: Boolean(source[dayKey]?.enabled),
      startMinutes: Number(source[dayKey]?.startMinutes ?? 9 * 60),
      endMinutes: Number(source[dayKey]?.endMinutes ?? 22 * 60)
    };
    return acc;
  }, {} as UserAvailability);

const shiftSchoolDay = (dateKey: string, delta: number, allowedDayKeys: DayKey[]) => {
  const allowed = allowedDayKeys.length ? new Set<DayKey>(allowedDayKeys) : new Set<DayKey>(DEFAULT_POLICY_DAY_KEYS);
  let next = parseDateKey(dateKey);
  do {
    next = addDays(next, delta);
  } while (!allowed.has(getDayKeyFromDateKey(formatDateKey(next))));
  return formatDateKey(next);
};

const buildDateKeysBetween = (startDate: string, endDate: string) => {
  const keys: string[] = [];
  if (!startDate || !endDate) return keys;
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (start > end) return keys;
  for (let date = start; date <= end; date = addDays(date, 1)) {
    keys.push(formatDateKey(date));
  }
  return keys;
};

const buildTimeSlotsRange = (startMinutes: number, endMinutes: number, slotMinutes: number): TimeSlot[] => {
  const safeSlot = Math.max(15, slotMinutes || 60);
  const start = Math.max(0, Math.floor(startMinutes / safeSlot) * safeSlot);
  const end = Math.min(24 * 60, Math.ceil(endMinutes / safeSlot) * safeSlot);
  const slots: TimeSlot[] = [];
  for (let minutes = start; minutes < end; minutes += safeSlot) {
    slots.push({ startMinutes: minutes, endMinutes: Math.min(end, minutes + safeSlot) });
  }
  return slots;
};

const areCollaboratorProfilesEqual = (left: CollaboratorProfile[], right: CollaboratorProfile[]) => {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (!a || !b) return false;
    if (a.email !== b.email || a.name !== b.name) return false;
    if (JSON.stringify(a.availability) !== JSON.stringify(b.availability)) return false;
    if (JSON.stringify(a.dateOffs) !== JSON.stringify(b.dateOffs)) return false;
    if (a.events.length !== b.events.length) return false;
    for (let j = 0; j < a.events.length; j += 1) {
      const ae = a.events[j];
      const be = b.events[j];
      if (!ae || !be) return false;
      if (
        ae.id !== be.id ||
        ae.dateKey !== be.dateKey ||
        ae.startMinutes !== be.startMinutes ||
        ae.endMinutes !== be.endMinutes ||
        ae.title !== be.title
      ) {
        return false;
      }
    }
  }
  return true;
};

const parseTimeToMinutes = (value: string): number | null => {
  const trimmed = value.trim();
  const matched = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!matched) return null;
  const hours = Number(matched[1]);
  const minutes = Number(matched[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const isExternalSemesterBoundaryResponse = (payload: { message?: string; reason?: string | null }) => {
  const text = `${payload.reason || ""} ${payload.message || ""}`
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  return (
    text.includes("outside configured semester dates") ||
    text.includes("outside semester") ||
    (text.includes("semester") && text.includes("outside"))
  );
};

const normalizeSeriesText = (value: string) => value.trim().replace(/\s+/g, " ");

const lessonSeriesToken = (lesson: Pick<Lesson, "title" | "teacher" | "roomId" | "startMinutes" | "durationMinutes">) =>
  [
    normalizeSeriesText(lesson.title || ""),
    normalizeSeriesText(lesson.teacher || ""),
    lesson.roomId,
    String(lesson.startMinutes),
    String(lesson.durationMinutes)
  ].join("|");

const extractLinkedIdsFromReservation = (reservation: Reservation): { groupId: string; rehearsalId: string } | null => {
  const groupId = (reservation.linkedGroupId || "").trim();
  const rehearsalId = (reservation.linkedRehearsalId || "").trim();
  if (groupId && rehearsalId) return { groupId, rehearsalId };
  return null;
};

const toPolicyLimitMinutes = (hours: number) => {
  const numeric = Number(hours);
  if (!Number.isFinite(numeric) || numeric <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(30, Math.round(numeric * 60));
};

const resolveFinderPolicyMaxDurationMinutes = (policy: ReservationPolicy) => {
  const candidates = [
    toPolicyLimitMinutes(policy.maxHoursPerRoomPerDay),
    toPolicyLimitMinutes(policy.maxHoursPerRoomPerWeek),
    toPolicyLimitMinutes(policy.maxHoursPerDayTotal),
    toPolicyLimitMinutes(policy.maxHoursPerWeekTotal)
  ].filter((value) => Number.isFinite(value));
  if (!candidates.length) return undefined;
  return Math.max(30, Math.min(...candidates));
};

export default function HomeScreen({
  currentUser,
  setAuthError,
  onContextChange,
  onReservationWindowChange,
  onQuotaReferenceDateChange,
  reservationMap,
  addReservation,
  upsertReservation,
  releaseReservation,
  view,
  onViewChange,
  requestedView,
  onRequestedViewHandled,
  navReselectView,
  navReselectToken,
  adminMode = false,
  collaborationEnabled = false,
  onGroupsPendingCountChange
}: HomeScreenProps) {
  const [selectedDate, setSelectedDate] = useState(() => formatDateKey(new Date()));
  const [selectedRoom, setSelectedRoom] = useState<string>("");
  const [allRooms, setAllRooms] = useState(true);
  const [roomMode, setRoomMode] = useState<"day" | "week">("day");
  const [myScheduleMode, setMyScheduleMode] = useState<"day" | "week" | "agenda">("week");
  const [myScheduleAgendaDays, setMyScheduleAgendaDays] = useState(14);
  const [now, setNow] = useState(() => new Date());
  const [pendingRelease, setPendingRelease] = useState<{
    dateKey: string;
    reservationId: string;
    linkedGroupId?: string;
    linkedRehearsalId?: string;
  } | null>(null);
  const [pendingLinkedEdit, setPendingLinkedEdit] = useState<{
    dateKey: string;
    reservationId: string;
    linkedGroupId: string;
    linkedRehearsalId: string;
  } | null>(null);
  const [pendingRehearsalResponse, setPendingRehearsalResponse] = useState<{
    groupId: string;
    rehearsalId: string;
    status: RehearsalParticipant["status"];
  } | null>(null);
  const [reservationDetails, setReservationDetails] = useState<{ reservation: Reservation; dateKey: string } | null>(null);
  const [blockDetails, setBlockDetails] = useState<{
    kind: "lesson" | "special" | "exam" | "closed";
    dateKey: string;
    lessonId?: string;
    roomId: string;
    startMinutes: number;
    durationMinutes: number;
    title: string;
    meta: string;
  } | null>(null);
  const [myScheduleAddDraft, setMyScheduleAddDraft] = useState<{
    request: ReserveRequest;
    roomOptions: { id: string; name: string }[];
  } | null>(null);
  const [dayTransition, setDayTransition] = useState<"" | "prev" | "next">("");
  const [toast, setToast] = useState<{ message: string; tone?: "info" | "error" | "success" } | null>(null);
  const [optimisticReservationsById, setOptimisticReservationsById] = useState<Record<string, Reservation>>({});
  const [pendingReservationIdsMap, setPendingReservationIdsMap] = useState<Record<string, true>>({});
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const lastContextKeyRef = useRef<string>("");
  const dayTransitionRafRef = useRef<number | null>(null);
  const contactCacheRef = useRef<Map<string, { name: string; phone: string; pictureUrl?: string }>>(new Map());
  const externalAvailabilityCacheRef = useRef<
    Map<string, { checkedAt: number; available: boolean; message: string }>
  >(new Map());
  const [detailsContact, setDetailsContact] = useState<{ name: string; phone: string; pictureUrl?: string } | null>(null);
  const lastWindowKeyRef = useRef<string>("");
  const lastQuotaReferenceDateRef = useRef<string>("");
  const [finderWindow, setFinderWindow] = useState<{ startDate: string; endDate: string }>(() => {
    const today = new Date();
    const start = formatDateKey(today);
    const end = formatDateKey(addDays(today, 6));
    return { startDate: start, endDate: end };
  });
  const [finderPrefilledGroupId, setFinderPrefilledGroupId] = useState<string>("");
  const [pendingFinderAutoLink, setPendingFinderAutoLink] = useState<{ groupId?: string } | null>(null);
  const pendingFinderAutoLinkRef = useRef<{ groupId?: string } | null>(null);
  const setPendingFinderAutoLinkSynced = useCallback((value: { groupId?: string } | null) => {
    pendingFinderAutoLinkRef.current = value;
    setPendingFinderAutoLink(value);
  }, []);
  const [collaboratorProfiles, setCollaboratorProfiles] = useState<CollaboratorProfile[]>([]);
  const [myScheduleAvailabilityEditMode, setMyScheduleAvailabilityEditMode] = useState(false);
  const [groupsTopBarContext, setGroupsTopBarContext] = useState<{
    title: string;
    subtitle?: ReactNode | string | null;
    key: string;
  } | null>(null);
  const [finderViewResetToken, setFinderViewResetToken] = useState(0);
  const [groupsViewResetToken, setGroupsViewResetToken] = useState(0);
  const lastHandledNavReselectTokenRef = useRef(0);
  const [roomZoomResetToken, setRoomZoomResetToken] = useState(0);
  const [myScheduleZoomResetToken, setMyScheduleZoomResetToken] = useState(0);
  const [availabilityDraft, setAvailabilityDraft] = useState<UserAvailability | null>(null);
  const [availabilityDateOffsDraft, setAvailabilityDateOffsDraft] = useState<AvailabilityDateOffs | null>(null);
  const [availabilityDraftSaving, setAvailabilityDraftSaving] = useState(false);
  const availabilityDraftRef = useRef<UserAvailability | null>(null);
  const availabilityDateOffsDraftRef = useRef<AvailabilityDateOffs | null>(null);

  const setRoomModeSynced = useCallback(
    (nextValue: "day" | "week" | ((prev: "day" | "week") => "day" | "week")) => {
      setRoomMode((prev) => {
        const next = typeof nextValue === "function" ? nextValue(prev) : nextValue;
        setMyScheduleMode((prevMode) => (prevMode === "agenda" ? prevMode : next));
        return next;
      });
    },
    []
  );

  const setMyScheduleModeSynced = useCallback(
    (
      nextValue:
        | "day"
        | "week"
        | "agenda"
        | ((prev: "day" | "week" | "agenda") => "day" | "week" | "agenda")
    ) => {
      setMyScheduleMode((prev) => {
        const next = typeof nextValue === "function" ? nextValue(prev) : nextValue;
        if (next === "day" || next === "week") {
          setRoomMode(next);
          setAllRooms(next === "day");
        }
        return next;
      });
    },
    []
  );

  const openDatePicker = () => {
    if (!dateInputRef.current) return;
    const picker = dateInputRef.current as HTMLInputElement & { showPicker?: () => void };
    if (picker.showPicker) {
      picker.showPicker();
    } else {
      picker.click();
    }
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(
    () => () => {
      if (dayTransitionRafRef.current !== null) {
        window.cancelAnimationFrame(dayTransitionRafRef.current);
      }
    },
    []
  );

  const showToast = useCallback((message: string, tone: "info" | "error" | "success" = "info") => {
    setToast({ message, tone });
  }, []);

  const addOptimisticReservation = useCallback((reservation: Reservation) => {
    setOptimisticReservationsById((prev) => ({ ...prev, [reservation.id]: reservation }));
    setPendingReservationIdsMap((prev) => ({ ...prev, [reservation.id]: true }));
  }, []);

  const clearOptimisticReservationPending = useCallback((reservationId: string) => {
    setPendingReservationIdsMap((prev) => {
      if (!prev[reservationId]) return prev;
      const next = { ...prev };
      delete next[reservationId];
      return next;
    });
  }, []);

  const removeOptimisticReservation = useCallback((reservationId: string) => {
    setOptimisticReservationsById((prev) => {
      if (!prev[reservationId]) return prev;
      const next = { ...prev };
      delete next[reservationId];
      return next;
    });
    setPendingReservationIdsMap((prev) => {
      if (!prev[reservationId]) return prev;
      const next = { ...prev };
      delete next[reservationId];
      return next;
    });
  }, []);

  useEffect(() => {
    const optimisticIds = Object.keys(optimisticReservationsById);
    const pendingIds = Object.keys(pendingReservationIdsMap);
    if (!optimisticIds.length && !pendingIds.length) return;

    const persistedIds = new Set<string>();
    Object.values(reservationMap).forEach((entries) => {
      entries.forEach((entry) => persistedIds.add(entry.id));
    });
    if (!persistedIds.size) return;

    setOptimisticReservationsById((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(prev).forEach((id) => {
        if (!persistedIds.has(id)) return;
        delete next[id];
        changed = true;
      });
      return changed ? next : prev;
    });

    setPendingReservationIdsMap((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(prev).forEach((id) => {
        if (!persistedIds.has(id)) return;
        delete next[id];
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [optimisticReservationsById, pendingReservationIdsMap, reservationMap]);

  const triggerDayTransition = useCallback((direction: "prev" | "next") => {
    setDayTransition("");
    if (dayTransitionRafRef.current !== null) {
      window.cancelAnimationFrame(dayTransitionRafRef.current);
    }
    dayTransitionRafRef.current = window.requestAnimationFrame(() => {
      setDayTransition(direction);
      dayTransitionRafRef.current = null;
    });
  }, []);

  const todayDateKey = formatDateKey(now);
  const isLocked = !currentUser?.allowed;
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "moderator";
  const hasNav = Boolean(currentUser);
  const collaborationAvailable = collaborationEnabled && Boolean(currentUser);
  const effectiveView: ViewMode =
    !collaborationAvailable && (view === "groups" || view === "mySchedule")
      ? "room"
      : view;
  const scheduleDateKey = effectiveView === "live" ? todayDateKey : selectedDate;

  const pinIdFor = useCallback(
    (pin: Pick<MySchedulePin, "kind" | "dateKey" | "roomId" | "startMinutes" | "durationMinutes" | "lessonId">) => {
      if (pin.kind === "lesson" && pin.lessonId) return `lesson:${pin.lessonId}`;
      return `${pin.kind}:${pin.dateKey}:${pin.roomId}:${pin.startMinutes}:${pin.durationMinutes}`;
    },
    []
  );

  const {
    pins: myPins,
    setPins: setMyPins,
    togglePin,
    isPinned,
    persistPins
  } = useMySchedulePins({
    email: currentUser?.email,
    pinIdFor,
    showToast: (message) => showToast(message)
  });
  const { availability, dateOffs: availabilityDateOffs, updateAvailability } = useUserAvailability({ email: currentUser?.email });
  const effectiveAvailability =
    myScheduleAvailabilityEditMode && availabilityDraft ? availabilityDraft : availability;
  const effectiveAvailabilityDateOffs =
    myScheduleAvailabilityEditMode && availabilityDateOffsDraft ? availabilityDateOffsDraft : availabilityDateOffs;

  useEffect(() => {
    availabilityDraftRef.current = availabilityDraft;
  }, [availabilityDraft]);

  useEffect(() => {
    availabilityDateOffsDraftRef.current = availabilityDateOffsDraft;
  }, [availabilityDateOffsDraft]);

  const handleAvailabilityDayUpdate = useCallback(
    (dayKey: DayKey, updates: Partial<{ enabled: boolean; startMinutes: number; endMinutes: number }>) => {
      if (!myScheduleAvailabilityEditMode) return;
      setAvailabilityDraft((prev) => {
        const base = prev ? cloneAvailability(prev) : cloneAvailability(availability);
        const current = base[dayKey] || { enabled: false, startMinutes: 9 * 60, endMinutes: 22 * 60 };
        base[dayKey] = {
          enabled: typeof updates.enabled === "boolean" ? updates.enabled : current.enabled,
          startMinutes: typeof updates.startMinutes === "number" ? updates.startMinutes : current.startMinutes,
          endMinutes: typeof updates.endMinutes === "number" ? updates.endMinutes : current.endMinutes
        };
        availabilityDraftRef.current = base;
        return base;
      });
    },
    [availability, myScheduleAvailabilityEditMode]
  );

  const handleAvailabilityDateOffToggle = useCallback(
    (dateKey: string, off: boolean) => {
      if (!dateKey || !myScheduleAvailabilityEditMode) return;
      setAvailabilityDateOffsDraft((prev) => {
        const next = { ...(prev || availabilityDateOffs) };
        if (off) next[dateKey] = true;
        else delete next[dateKey];
        availabilityDateOffsDraftRef.current = next;
        return next;
      });
    },
    [availabilityDateOffs, myScheduleAvailabilityEditMode]
  );

  const handleStartAvailabilityEditMode = useCallback(() => {
    if (availabilityDraftSaving || myScheduleAvailabilityEditMode) return;
    const nextDraft = cloneAvailability(availability);
    const nextDateOffs = { ...availabilityDateOffs };
    availabilityDraftRef.current = nextDraft;
    availabilityDateOffsDraftRef.current = nextDateOffs;
    setAvailabilityDraft(nextDraft);
    setAvailabilityDateOffsDraft(nextDateOffs);
    setMyScheduleAvailabilityEditMode(true);
  }, [availability, availabilityDateOffs, availabilityDraftSaving, myScheduleAvailabilityEditMode]);

  const handleCancelAvailabilityEditMode = useCallback(() => {
    if (availabilityDraftSaving) return;
    setMyScheduleAvailabilityEditMode(false);
    setAvailabilityDraft(null);
    setAvailabilityDateOffsDraft(null);
    availabilityDraftRef.current = null;
    availabilityDateOffsDraftRef.current = null;
  }, [availabilityDraftSaving]);

  const handleSaveAvailabilityEditMode = useCallback(async () => {
    if (availabilityDraftSaving || !myScheduleAvailabilityEditMode) return;
    const latestAvailabilityDraft = availabilityDraftRef.current;
    const latestDateOffsDraft = availabilityDateOffsDraftRef.current;
    const nextAvailability = latestAvailabilityDraft ? cloneAvailability(latestAvailabilityDraft) : cloneAvailability(availability);
    const nextDateOffs = { ...(latestDateOffsDraft || availabilityDateOffs) };
    setAvailabilityDraftSaving(true);
    try {
      await updateAvailability(nextAvailability, nextDateOffs);
      setMyScheduleAvailabilityEditMode(false);
      setAvailabilityDraft(null);
      setAvailabilityDateOffsDraft(null);
      availabilityDraftRef.current = null;
      availabilityDateOffsDraftRef.current = null;
      showToast("הזמינות נשמרה.", "success");
    } catch {
      showToast("לא ניתן היה לשמור את הזמינות.", "error");
    } finally {
      setAvailabilityDraftSaving(false);
    }
  }, [
    availability,
    availabilityDateOffs,
    availabilityDateOffsDraft,
    availabilityDraft,
    availabilityDraftSaving,
    myScheduleAvailabilityEditMode,
    showToast,
    updateAvailability
  ]);

  useEffect(() => {
    if (!myScheduleAvailabilityEditMode) return;
    if (view === "mySchedule" && myScheduleMode === "week") return;
    setMyScheduleAvailabilityEditMode(false);
    setAvailabilityDraft(null);
    setAvailabilityDateOffsDraft(null);
    availabilityDraftRef.current = null;
    availabilityDateOffsDraftRef.current = null;
  }, [myScheduleAvailabilityEditMode, myScheduleMode, view]);
  const {
    groups,
    pendingInvites,
    createGroup,
    inviteToGroup,
    respondToInvite,
    updateGroup,
    renameGroup,
    deleteGroup,
    leaveGroup,
    removeMember,
    addGroupRehearsal,
    respondToRehearsal,
    deleteGroupRehearsal
  } = useCollaborationGroups({ email: collaborationAvailable ? currentUser?.email : undefined });

  const handleCreateGroup = useCallback(
    async (name: string, participantEmails: string[] = []) => {
      const createdGroupId = await createGroup(name);
      if (!createdGroupId || typeof createdGroupId !== "string") return createdGroupId;
      const organizerEmail = (currentUser?.email || "").trim().toLowerCase();
      const normalizedParticipants = Array.from(
        new Set(
          participantEmails
            .map((entry) => entry.trim().toLowerCase())
            .filter((entry) => Boolean(entry) && entry !== organizerEmail)
        )
      );
      if (normalizedParticipants.length) {
        await Promise.all(
          normalizedParticipants.map(async (email) => {
            await inviteToGroup(createdGroupId, email);
          })
        );
      }
      return createdGroupId;
    },
    [createGroup, currentUser?.email, inviteToGroup]
  );

  const {
    rooms,
    weekDays,
    lessons,
    config,
    roomMeta,
    reservationPolicy,
    reservationPolicies,
    policyWindows,
    semesters,
    apiSync
  } = useSchedule(scheduleDateKey);
  const policyDayKeys = useMemo(() => {
    const next = weekDays.map((day) => day.key);
    if (!next.length) return DEFAULT_POLICY_DAY_KEYS;
    return Array.from(new Set(next));
  }, [weekDays]);
  const policyDayKeySet = useMemo(() => new Set<DayKey>(policyDayKeys), [policyDayKeys]);
  const activeHours = useMemo(
    () => deriveActiveHoursFromReservationPolicyWindows(policyWindows, config.startHour, config.endHour),
    [config.endHour, config.startHour, policyWindows]
  );
  const policyTimeSlots = useMemo(
    () => buildTimeSlotsRange(activeHours.startMinutes, activeHours.endMinutes, config.slotMinutes),
    [activeHours.endMinutes, activeHours.startMinutes, config.slotMinutes]
  );
  const finderPolicyMaxDurationMinutes = useMemo(
    () => resolveFinderPolicyMaxDurationMinutes(reservationPolicy),
    [reservationPolicy]
  );
  const finderPolicyMaxDaysForward = useMemo(() => {
    const raw = Number(reservationPolicy.maxDaysForward);
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    return Math.max(0, Math.round(raw));
  }, [reservationPolicy.maxDaysForward]);
  const overridesWeekDates = buildWeekDates(selectedDate, weekDays);
  const overridesWeekRange = {
    startDate: overridesWeekDates[0]?.dateKey || selectedDate,
    endDate: overridesWeekDates[overridesWeekDates.length - 1]?.dateKey || selectedDate
  };
  const overridesAgendaEnd = formatDateKey(addDays(parseDateKey(todayDateKey), Math.max(0, myScheduleAgendaDays - 1)));
  const overridesWindow =
    effectiveView === "live"
      ? { startDate: todayDateKey, endDate: todayDateKey }
      : effectiveView === "finder"
        ? finderWindow
        : effectiveView === "mySchedule"
          ? (myScheduleMode === "agenda"
            ? { startDate: todayDateKey, endDate: overridesAgendaEnd }
            : myScheduleMode === "day"
              ? { startDate: selectedDate, endDate: selectedDate }
              : overridesWeekRange)
          : overridesWeekRange;
  const { overridesByDate, addOverride, upsertOverride } = useLessonOverrides(overridesWindow);
  const { users } = useDirectoryUsers(Boolean(currentUser) || (adminMode && isAdmin));
  const reservationGroupOptions = useMemo(() => {
    if (!collaborationAvailable) return [];
    const currentEmailNormalized = (currentUser?.email || "").trim().toLowerCase();
    if (!currentEmailNormalized) return [];
    const usersByEmail = new Map(
      users.map((user) => [user.email.trim().toLowerCase(), user] as const)
    );
    return groups
      .filter((group) => {
        const memberSet = new Set<string>(
          [group.ownerEmail, ...group.memberEmails].map((entry) => entry.trim().toLowerCase())
        );
        return memberSet.has(currentEmailNormalized);
      })
      .map((group) => {
        const members = Array.from(
          new Set(
            [group.ownerEmail, ...group.memberEmails]
              .map((entry) => entry.trim().toLowerCase())
              .filter(Boolean)
          )
        ).map((email) => {
          const user = usersByEmail.get(email);
          const name = (user?.name || "").trim() || email;
          return {
            email,
            name,
            pictureUrl: (user?.pictureUrl || "").trim()
          };
        });
        return {
          id: group.id,
          name: group.name,
          memberCount: members.length,
          members
        };
      });
  }, [collaborationAvailable, currentUser?.email, groups, users]);

  const groupsPendingCount = useMemo(() => {
    if (!collaborationAvailable) return 0;
    const currentEmailNormalized = (currentUser?.email || "").trim().toLowerCase();
    if (!currentEmailNormalized) return 0;
    return groups.reduce((count, group) => {
      const hasPendingInvite = group.invites.some(
        (invite) => invite.email === currentEmailNormalized && invite.status === "pending"
      );
      const hasPendingRehearsalForMe = (group.rehearsals || []).some((rehearsal) =>
        rehearsal.participants.some(
          (participant) => participant.email === currentEmailNormalized && participant.status === "pending"
        )
      );
      return hasPendingInvite || hasPendingRehearsalForMe ? count + 1 : count;
    }, 0);
  }, [collaborationAvailable, currentUser?.email, groups]);

  useEffect(() => {
    onGroupsPendingCountChange?.(groupsPendingCount);
  }, [groupsPendingCount, onGroupsPendingCountChange]);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const checkExternalAvailability = useCallback(
    async ({
      date,
      roomId,
      startMinutes,
      durationMinutes
    }: {
      date: string;
      roomId: string;
      startMinutes: number;
      durationMinutes: number;
    }) => {
      const endpoint = apiSync.primaryEndpoint.trim();
      if (!endpoint) return { ok: true };

      const room = rooms.find((entry) => entry.id === roomId);
      const mappedExternalId =
        room?.externalId ||
        Object.entries(apiSync.roomIdMap).find(([, localRoomId]) => localRoomId === roomId)?.[0] ||
        roomId;

      const startTime = `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`;
      const cacheKey = `${mappedExternalId}|${date}|${startTime}|${durationMinutes}`;
      const cached = externalAvailabilityCacheRef.current.get(cacheKey);
      const nowMs = Date.now();
      if (cached && nowMs - cached.checkedAt < 5 * 60 * 1000) {
        return cached.available ? { ok: true } : { ok: false, message: cached.message };
      }

      try {
        const url = new URL(endpoint);
        url.searchParams.set("resource", "availability");
        url.searchParams.set("room_id", mappedExternalId);
        url.searchParams.set("date", date);
        url.searchParams.set("start_time", startTime);
        url.searchParams.set("duration_minutes", String(durationMinutes));
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timeoutId = controller ? window.setTimeout(() => controller.abort(), 3500) : null;
        const response = await fetch(url.toString(), { method: "GET", ...(controller ? { signal: controller.signal } : {}) });
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        const payload = (await response.json().catch(() => ({}))) as {
          available?: boolean;
          message?: string;
          reason?: string | null;
          conflicts?: Array<{
            id?: string;
            subject?: string;
            teacher?: string;
            start_time?: string;
            duration_minutes?: number;
            room?: { id?: string };
          }>;
        };

        if (payload.reason === "conflict" && Array.isArray(payload.conflicts) && payload.conflicts.length) {
          await Promise.all(
            payload.conflicts.map(async (conflict, index) => {
              const conflictStart = parseTimeToMinutes(typeof conflict.start_time === "string" ? conflict.start_time : "");
              if (conflictStart === null) return;
              const conflictDurationRaw = Number(conflict.duration_minutes);
              const conflictDuration = Number.isFinite(conflictDurationRaw) && conflictDurationRaw > 0 ? Math.round(conflictDurationRaw) : 60;
              const conflictRoomExternalId = typeof conflict.room?.id === "string" ? conflict.room.id.trim() : "";
              const conflictRoomId =
                (conflictRoomExternalId && apiSync.roomIdMap[conflictRoomExternalId]) ||
                rooms.find((entry) => entry.externalId === conflictRoomExternalId)?.id ||
                roomId;
              const conflictExternalId = typeof conflict.id === "string" ? conflict.id.trim() : "";
              const overrideId = `availability-${date}-${conflictExternalId || `${conflictRoomId}-${conflictStart}-${index}`}`
                .replace(/[^\w-]+/g, "_")
                .slice(0, 220);
              await upsertOverride({
                id: overrideId,
                date,
                action: "add",
                lesson: {
                  id: `availability-${conflictExternalId || `${conflictRoomId}-${conflictStart}`}`.replace(/[^\w-]+/g, "_"),
                  title: (typeof conflict.subject === "string" && conflict.subject.trim()) || "שיעור מסונכרן",
                  teacher: (typeof conflict.teacher === "string" && conflict.teacher.trim()) || "",
                  day: getDayKeyFromDateKey(date),
                  roomId: conflictRoomId,
                  startMinutes: conflictStart,
                  durationMinutes: conflictDuration
                },
                syncSource: "api",
                externalId: conflictExternalId || undefined
              });
            })
          );
          const message = payload.message || "החדר אינו זמין לפי המערכת החיצונית.";
          externalAvailabilityCacheRef.current.set(cacheKey, {
            checkedAt: nowMs,
            available: false,
            message
          });
          const count = payload.conflicts.length;
          const conflictsLabel = count === 1 ? "נמצאה התנגשות אחת" : `נמצאו ${count} התנגשויות`;
          return { ok: false, message: `${conflictsLabel} בזמן שביקשת. היומן עודכן אוטומטית עם ההתנגשויות.` };
        }

        // Third-party availability service is temporarily unavailable.
        // Do not block or notify the user for infrastructure failures.
        if (!response.ok) {
          return { ok: true };
        }

        if (payload.available === true) {
          externalAvailabilityCacheRef.current.set(cacheKey, {
            checkedAt: nowMs,
            available: true,
            message: ""
          });
          return { ok: true };
        }

        if (isExternalSemesterBoundaryResponse(payload)) {
          return { ok: true };
        }

        const message = payload.message || "החדר אינו זמין לפי המערכת החיצונית.";
        externalAvailabilityCacheRef.current.set(cacheKey, {
          checkedAt: nowMs,
          available: false,
          message
        });
        return { ok: false, message };
      } catch {
        // Network/timeout/downstream outage should not block user reservations.
        return { ok: true };
      }
    },
    [apiSync, rooms, upsertOverride]
  );

  useEffect(() => {
    if (!collaborationAvailable || view !== "mySchedule") {
      setMyScheduleAddDraft(null);
      setMyScheduleAvailabilityEditMode(false);
      setAvailabilityDraft(null);
      setAvailabilityDateOffsDraft(null);
      availabilityDraftRef.current = null;
      availabilityDateOffsDraftRef.current = null;
    }
  }, [collaborationAvailable, view]);

  const effectiveAdminMode = adminMode && isAdmin;

  useEffect(() => {
    if (isLocked && view !== "live") {
      onViewChange("live");
    }
  }, [isLocked, onViewChange, view]);

  useEffect(() => {
    if (collaborationAvailable) return;
    if (view === "groups" || view === "mySchedule") {
      onViewChange("room");
    }
  }, [collaborationAvailable, onViewChange, view]);

  useEffect(() => {
    if (collaborationAvailable) return;
    setFinderPrefilledGroupId("");
    setPendingFinderAutoLinkSynced(null);
    setGroupsTopBarContext(null);
    setPendingRehearsalResponse(null);
    setPendingLinkedEdit(null);
  }, [collaborationAvailable, setPendingFinderAutoLinkSynced]);

  useEffect(() => {
    if (!requestedView) return;
    const blockedRequestedView =
      !collaborationAvailable && (requestedView === "groups" || requestedView === "mySchedule");
    if (!blockedRequestedView) {
      onViewChange(requestedView);
    }
    onRequestedViewHandled?.();
  }, [collaborationAvailable, onRequestedViewHandled, onViewChange, requestedView]);

  useEffect(() => {
    if (!navReselectToken) return;
    if (lastHandledNavReselectTokenRef.current === navReselectToken) return;
    lastHandledNavReselectTokenRef.current = navReselectToken;
    if (collaborationAvailable && navReselectView === "groups" && view === "groups") {
      setFinderPrefilledGroupId("");
      setGroupsViewResetToken((prev) => prev + 1);
      return;
    }
    if (navReselectView === "finder" && view === "finder") {
      setFinderPrefilledGroupId("");
      setFinderViewResetToken((prev) => prev + 1);
      return;
    }
    if (navReselectView === "room" && view === "room") {
      setSelectedDate(todayDateKey);
      setAllRooms(true);
      setRoomMode("day");
      setRoomZoomResetToken((prev) => prev + 1);
      return;
    }
    if (collaborationAvailable && navReselectView === "mySchedule" && view === "mySchedule") {
      setSelectedDate(todayDateKey);
      setMyScheduleModeSynced("week");
      setMyScheduleAgendaDays(14);
      setMyScheduleZoomResetToken((prev) => prev + 1);
      setMyScheduleAddDraft(null);
      setMyScheduleAvailabilityEditMode(false);
      setAvailabilityDraft(null);
      setAvailabilityDateOffsDraft(null);
      availabilityDraftRef.current = null;
      availabilityDateOffsDraftRef.current = null;
    }
  }, [collaborationAvailable, navReselectToken, navReselectView, setMyScheduleModeSynced, todayDateKey, view]);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayDayKey = getDayKeyFromDateKey(todayDateKey);
  const roomsKey = useMemo(
    () => rooms.map((room) => `${room.id}:${room.shortName || room.name || ""}`).join("|"),
    [rooms]
  );

  const getSemesterForDate = useCallback(
    (dateKey: string) =>
      semesters.find((semester) => {
        if (!semester.startDate || !semester.endDate) return false;
        return dateKey >= semester.startDate && dateKey <= semester.endDate;
      }) || null,
    [semesters]
  );

  const holidayNameByDate = useMemo(() => {
    const map: Record<string, string> = {};
    semesters.forEach((semester) => {
      semester.holidays.forEach((holiday) => {
        if (!holiday?.date) return;
        const holidayName = (holiday.displayName || "").trim() || (holiday.name || "").trim();
        if (!holidayName) return;
        if (!map[holiday.date]) {
          map[holiday.date] = holidayName;
        }
      });
    });
    return map;
  }, [semesters]);

  const isStudyDateForLessons = useCallback(
    (dateKey: string, dayKey: DayKey) => {
      if (!policyDayKeySet.has(dayKey)) return false;
      const semester = getSemesterForDate(dateKey);
      if (!semester) return false;
      if (semester.holidays.some((holiday) => holiday.date === dateKey)) return false;
      return true;
    },
    [getSemesterForDate, policyDayKeySet]
  );

  const getLessonsForDate = useCallback(
    (dateKey: string, dayKey: DayKey) => {
      if (!isStudyDateForLessons(dateKey, dayKey)) return [];
      const baseLessons = lessons.filter((lesson) => lesson.day === dayKey);
      const overrides = overridesByDate[dateKey] || [];
      return applyLessonOverrides(baseLessons, overrides, dayKey);
    },
    [isStudyDateForLessons, lessons, overridesByDate]
  );

  // Best-effort migration: older "lesson" pins were date-specific; upgrade them to recurring pins
  // by matching them to a lesson id for that date (when possible).
  useEffect(() => {
    if (!myPins.length) return;
    let changed = false;
    const seen = new Set<string>();
    const nextPins: MySchedulePin[] = [];

    myPins.forEach((pin) => {
      if (pin.kind !== "lesson" || pin.lessonId) {
        const id = pin.id || pinIdFor(pin);
        if (!seen.has(id)) {
          seen.add(id);
          nextPins.push({ ...pin, id });
        }
        return;
      }
      const dayKey = getDayKeyFromDateKey(pin.dateKey);
      const match = getLessonsForDate(pin.dateKey, dayKey).find((lesson) => {
        if (lesson.roomId !== pin.roomId) return false;
        if (lesson.startMinutes !== pin.startMinutes) return false;
        if (lesson.durationMinutes !== pin.durationMinutes) return false;
        if ((lesson.title || "").trim() && (pin.title || "").trim()) {
          return lesson.title.trim() === pin.title.trim();
        }
        return true;
      });

      if (!match) {
        const id = pin.id || pinIdFor(pin);
        if (!seen.has(id)) {
          seen.add(id);
          nextPins.push({ ...pin, id });
        }
        return;
      }

      const upgraded: MySchedulePin = { ...pin, lessonId: match.id };
      const id = pinIdFor(upgraded);
      if (!seen.has(id)) {
        seen.add(id);
        nextPins.push({ ...upgraded, id });
      }
      if (id !== pin.id) changed = true;
    });

    if (!changed) return;
    setMyPins(nextPins);
  }, [getLessonsForDate, myPins, pinIdFor]);

  const usersByEmail = useMemo(() => {
    const map = new Map<string, { name: string }>();
    users.forEach((user) => {
      const email = user.email.toLowerCase();
      if (!email) return;
      map.set(email, { name: user.name || "" });
    });
    return map;
  }, [users]);

  const collaborationDateKeys = useMemo(() => {
    const keys = buildDateKeysBetween(finderWindow.startDate, finderWindow.endDate);
    return keys.length ? keys : [formatDateKey(new Date())];
  }, [finderWindow.endDate, finderWindow.startDate]);

  const buildCollaboratorEvents = useCallback(
    (email: string, pins: MySchedulePin[], _dateOffs: AvailabilityDateOffs = {}): CollaboratorEvent[] => {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) return [];
      const dateSet = new Set(collaborationDateKeys);
      const events: CollaboratorEvent[] = [];

      Object.entries(reservationMap).forEach(([dateKey, entries]) => {
        if (!dateSet.has(dateKey)) return;
        entries.forEach((entry) => {
          if ((entry.reservedEmail || "").trim().toLowerCase() !== normalizedEmail) return;
          events.push({
            id: `reservation:${entry.id}`,
            dateKey,
            startMinutes: entry.time,
            endMinutes: entry.time + Math.max(30, entry.durationMinutes || 60),
            title: "שריון"
          });
        });
      });

      pins.forEach((pin) => {
        if (pin.kind === "lesson" && pin.lessonId) {
          collaborationDateKeys.forEach((dateKey) => {
            const dayKey = getDayKeyFromDateKey(dateKey);
            const lesson = getLessonsForDate(dateKey, dayKey).find((entry) => entry.id === pin.lessonId);
            if (!lesson) return;
            events.push({
              id: `lesson:${dateKey}:${lesson.id}`,
              dateKey,
              startMinutes: lesson.startMinutes,
              endMinutes: lesson.startMinutes + lesson.durationMinutes,
              title: lesson.title || "שיעור"
            });
          });
          return;
        }
        if (!dateSet.has(pin.dateKey)) return;
        events.push({
          id: `pin:${pin.id}`,
          dateKey: pin.dateKey,
          startMinutes: pin.startMinutes,
          endMinutes: pin.startMinutes + pin.durationMinutes,
          title: pin.title
        });
      });

      events.sort((a, b) => {
        if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
        if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
        return a.id.localeCompare(b.id);
      });
      return events;
    },
    [collaborationDateKeys, getLessonsForDate, reservationMap]
  );

  useEffect(() => {
    const currentEmail = (currentUser?.email || "").trim().toLowerCase();
    const groupMembers = groups.flatMap((group) => group.memberEmails || []);
    if (!currentEmail && !groupMembers.length) {
      setCollaboratorProfiles((prev) => (prev.length ? [] : prev));
      return;
    }

    const targetEmails = Array.from(new Set([currentEmail, ...groupMembers].filter(Boolean)));
    const membersWithoutCurrent = targetEmails.filter((email) => email !== currentEmail);
    const fallbackName = (email: string) => usersByEmail.get(email)?.name || email;

    let cancelled = false;
    const run = async () => {
      const profiles: CollaboratorProfile[] = [];

      if (currentEmail) {
        profiles.push({
          email: currentEmail,
          name: fallbackName(currentEmail) || "אני",
          availability,
          dateOffs: availabilityDateOffs,
          events: buildCollaboratorEvents(currentEmail, myPins, availabilityDateOffs)
        });
      }

      if (db && membersWithoutCurrent.length) {
        const docs = await Promise.all(
          membersWithoutCurrent.map(async (email) => {
            const snap = await getDoc(doc(db, "users", email)).catch(() => null);
            const raw = snap?.exists() ? (snap.data() as Record<string, unknown>) : {};
            const remotePins = Array.isArray(raw.myPins) ? (raw.myPins as MySchedulePin[]) : [];
            return {
              email,
              name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : fallbackName(email),
              availability: normalizeUserAvailability(raw.availability),
              dateOffs: raw.availabilityDateOffs && typeof raw.availabilityDateOffs === "object"
                ? Object.fromEntries(
                    Object.entries(raw.availabilityDateOffs as Record<string, unknown>).filter(
                      ([dateKey, value]) => Boolean(dateKey) && Boolean(value)
                    )
                  ) as AvailabilityDateOffs
                : {},
              pins: remotePins
            };
          })
        );
        docs.forEach((entry) => {
          profiles.push({
            email: entry.email,
            name: entry.name,
            availability: entry.availability,
            dateOffs: entry.dateOffs,
            events: buildCollaboratorEvents(entry.email, entry.pins, entry.dateOffs)
          });
        });
      }

      if (cancelled) return;
      profiles.sort((a, b) => a.name.localeCompare(b.name, "he"));
      setCollaboratorProfiles((prev) => (areCollaboratorProfilesEqual(prev, profiles) ? prev : profiles));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    groups,
    availability,
    availabilityDateOffs,
    buildCollaboratorEvents,
    currentUser?.email,
    myPins,
    usersByEmail
  ]);

  const selectedDayKey = useMemo(() => getDayKeyFromDateKey(selectedDate), [selectedDate]);
  const weekDates = useMemo(() => buildWeekDates(selectedDate, weekDays), [selectedDate, weekDays]);
  const weekRange = useMemo(() => {
    const first = weekDates[0]?.dateKey || selectedDate;
    const last = weekDates[weekDates.length - 1]?.dateKey || selectedDate;
    return { startDate: first, endDate: last };
  }, [selectedDate, weekDates]);
  const roomDates = useMemo(() => {
    if (roomMode === "week") return weekDates;
    const match = weekDates.filter((day) => day.key === selectedDayKey);
    if (match.length) return match;
    return [{
      key: selectedDayKey,
      label: "",
      shortDate: formatShortDate(selectedDate),
      dateKey: selectedDate
    }];
  }, [roomMode, weekDates, selectedDayKey, selectedDate]);

  const displayReservationMap = useMemo(() => {
    const optimisticReservations = Object.values(optimisticReservationsById);
    if (effectiveAdminMode && !optimisticReservations.length) return reservationMap;

    const holidayDates = Object.keys(holidayNameByDate);
    if (!holidayDates.length && !optimisticReservations.length) return reservationMap;

    const next: ReservationMap = {};
    Object.entries(reservationMap).forEach(([key, value]) => {
      next[key] = [...value];
    });

    optimisticReservations.forEach((entry) => {
      const existing = next[entry.date] ? [...next[entry.date]] : [];
      if (existing.some((item) => item.id === entry.id)) return;
      existing.push(entry);
      next[entry.date] = existing.sort((a, b) => a.time - b.time);
    });

    if (effectiveAdminMode) {
      return next;
    }

    if (holidayDates.length && rooms.length) {
      const visibleDates = new Set<string>([
        ...Object.keys(next),
        ...weekDates.map((day) => day.dateKey),
        ...roomDates.map((day) => day.dateKey),
        ...buildDateKeysBetween(finderWindow.startDate, finderWindow.endDate),
        ...buildDateKeysBetween(todayDateKey, overridesAgendaEnd),
        selectedDate,
        todayDateKey
      ]);
      visibleDates.forEach((dateKey) => {
        const holidayName = holidayNameByDate[dateKey];
        if (!holidayName) return;
        const existing = next[dateKey] ? [...next[dateKey]] : [];
        rooms.forEach((room) => {
          const id = `holiday:${dateKey}:${room.id}`;
          if (existing.some((entry) => entry.id === id)) return;
          existing.push({
            id,
            date: dateKey,
            roomId: room.id,
            time: activeHours.startMinutes,
            durationMinutes: activeHours.endMinutes - activeHours.startMinutes,
            reservedBy: holidayName,
            reservedEmail: "",
            kind: "closed"
          });
        });
        next[dateKey] = existing.sort((a, b) => a.time - b.time);
      });
    }

    return next;
  }, [
    activeHours.endMinutes,
    activeHours.startMinutes,
    effectiveAdminMode,
    finderWindow.endDate,
    finderWindow.startDate,
    holidayNameByDate,
    overridesAgendaEnd,
    optimisticReservationsById,
    reservationMap,
    roomDates,
    rooms,
    selectedDate,
    todayDateKey,
    weekDates
  ]);

  const scheduleTimeSlots = useMemo(() => {
    if (effectiveView !== "room") return policyTimeSlots;

    const relevantDates = allRooms
      ? [selectedDate]
      : roomMode === "week"
        ? roomDates.map((entry) => entry.dateKey)
        : [selectedDate];
    const relevantRoomIds = allRooms
      ? rooms.map((room) => room.id)
      : selectedRoom
        ? [selectedRoom]
        : [];

    if (!relevantDates.length || !relevantRoomIds.length) return policyTimeSlots;

    let minStart = Number.POSITIVE_INFINITY;
    let maxEnd = Number.NEGATIVE_INFINITY;

    relevantDates.forEach((dateKey) => {
      const dayKey = getDayKeyFromDateKey(dateKey);
      getLessonsForDate(dateKey, dayKey).forEach((lesson) => {
        if (!relevantRoomIds.includes(lesson.roomId)) return;
        minStart = Math.min(minStart, lesson.startMinutes);
        maxEnd = Math.max(maxEnd, lesson.startMinutes + lesson.durationMinutes);
      });
      (displayReservationMap[dateKey] || []).forEach((entry) => {
        if (!relevantRoomIds.includes(entry.roomId)) return;
        minStart = Math.min(minStart, entry.time);
        maxEnd = Math.max(maxEnd, entry.time + Math.max(30, entry.durationMinutes || 60));
      });
    });

    if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) {
      return policyTimeSlots;
    }

    const baseStart = activeHours.startMinutes;
    const baseEnd = activeHours.endMinutes;
    const start = Math.min(baseStart, minStart);
    const end = Math.max(baseEnd, maxEnd);
    const next = buildTimeSlotsRange(start, end, config.slotMinutes);
    return next.length ? next : policyTimeSlots;
  }, [
    allRooms,
    activeHours.endMinutes,
    config.slotMinutes,
    activeHours.startMinutes,
    displayReservationMap,
    getLessonsForDate,
    roomDates,
    roomMode,
    rooms,
    selectedDate,
    selectedRoom,
    policyTimeSlots,
    effectiveView
  ]);

  useEffect(() => {
    if (!onReservationWindowChange && !onQuotaReferenceDateChange) return;
    const liveWeekStart = getWeekStart(todayDateKey);
    const liveWeekRange = {
      startDate: formatDateKey(liveWeekStart),
      endDate: formatDateKey(addDays(liveWeekStart, weekDays.length - 1))
    };
    const selectedWeekStart = getWeekStart(selectedDate);
    const selectedWeekRange = {
      startDate: formatDateKey(selectedWeekStart),
      endDate: formatDateKey(addDays(selectedWeekStart, weekDays.length - 1))
    };
    const agendaEnd = formatDateKey(addDays(parseDateKey(todayDateKey), Math.max(0, myScheduleAgendaDays - 1)));
    const desired =
      effectiveView === "live"
        ? liveWeekRange
        : effectiveView === "finder"
          ? finderWindow
          : effectiveView === "mySchedule"
            ? (myScheduleMode === "agenda"
              ? { startDate: todayDateKey, endDate: agendaEnd }
              : selectedWeekRange)
          : weekRange;
    const quotaReferenceDate =
      effectiveView === "live"
        ? todayDateKey
        : effectiveView === "finder"
          ? finderWindow.startDate
          : effectiveView === "mySchedule"
            ? (myScheduleMode === "agenda" ? todayDateKey : selectedDate)
            : selectedDate;
    if (onQuotaReferenceDateChange && quotaReferenceDate !== lastQuotaReferenceDateRef.current) {
      lastQuotaReferenceDateRef.current = quotaReferenceDate;
      onQuotaReferenceDateChange(quotaReferenceDate);
    }

    if (!onReservationWindowChange) return;
    const expandedWindow = {
      startDate: formatDateKey(getWeekStart(desired.startDate)),
      endDate: formatDateKey(addDays(getWeekStart(desired.endDate), 6))
    };
    const key = `${expandedWindow.startDate}|${expandedWindow.endDate}`;
    if (key === lastWindowKeyRef.current) return;
    lastWindowKeyRef.current = key;
    onReservationWindowChange(expandedWindow);
  }, [
    finderWindow,
    myScheduleAgendaDays,
    myScheduleMode,
    onQuotaReferenceDateChange,
    onReservationWindowChange,
    selectedDate,
    todayDateKey,
    effectiveView,
    weekDays.length,
    weekRange
  ]);

  useEffect(() => {
    if (!rooms.length) return;
    if (!selectedRoom) {
      setSelectedRoom(rooms[0].id);
      return;
    }
    const exists = rooms.some((room) => room.id === selectedRoom);
    if (!exists) {
      setSelectedRoom(rooms[0].id);
    }
  }, [rooms, selectedRoom]);

  useEffect(() => {
    if (allRooms && roomMode !== "day") {
      setRoomMode("day");
    }
  }, [allRooms, roomMode]);


  const {
    pendingConfirm,
    setPendingConfirm,
    getAvailability,
    handleReserve,
    handleConfirmReserve,
    handleEditReservation: baseHandleEditReservation,
    handleConfirmEdit: baseHandleConfirmEdit
  } = useReserveFlow({
    currentUser,
    view: effectiveView,
    allRooms,
    onViewChange,
    setAllRooms,
    setSelectedRoom,
    setSelectedDate,
    setRoomMode: setRoomModeSynced,
    setAuthError,
    showToast,
    reservationMap: displayReservationMap,
    roomMeta,
    reservationPolicy,
    reservationPolicies,
    allowedPolicyDayKeys: policyDayKeys,
    allowedPolicyWindows: policyWindows,
    config: { startHour: activeHours.startHour, endHour: activeHours.endHour },
    getLessonsForDate,
    addReservation,
    upsertReservation,
    onOptimisticCreate: addOptimisticReservation,
    onOptimisticPendingClear: clearOptimisticReservationPending,
    onOptimisticRemove: removeOptimisticReservation,
    checkExternalAvailability
  });

  const pendingReservationIds = useMemo(
    () => Object.keys(pendingReservationIdsMap),
    [pendingReservationIdsMap]
  );

  const {
    adminDraft,
    setAdminDraft,
    adminError,
    collisionConfirm,
    handleAdminSlotClick,
    handleAdminLessonClick,
    handleAdminReservationClick,
    handleAdminSave,
    handleAdminDeleteLesson,
    handleAdminDeleteReservation,
    switchAdminType
  } = useAdminDraftFlow({
    enabled: effectiveAdminMode,
    currentUser,
    config,
    roomMeta,
    reservationMap,
    getLessonsForDate,
    addOverride,
    addReservation,
    upsertReservation,
    releaseReservation
  });

  const handleReservationDetails = (reservationId: string, dateKey: string) => {
    const reservation = (displayReservationMap[dateKey] || []).find((entry) => entry.id === reservationId);
    if (!reservation) return;
    setReservationDetails({ reservation, dateKey });
  };

  const handleLessonDetails = (lessonId: string, dateKey: string) => {
    const dayKey = getDayKeyFromDateKey(dateKey);
    const lesson = getLessonsForDate(dateKey, dayKey).find((entry) => entry.id === lessonId);
    if (!lesson) return;
    setBlockDetails({
      kind: "lesson",
      dateKey,
      lessonId: lesson.id,
      roomId: lesson.roomId,
      startMinutes: lesson.startMinutes,
      durationMinutes: lesson.durationMinutes,
      title: lesson.title,
      meta: lesson.teacher || "ללא מרצה"
    });
  };

  const handleSpecialDetails = (reservationId: string, dateKey: string) => {
    const reservation = (displayReservationMap[dateKey] || []).find((entry) => entry.id === reservationId);
    if (!reservation) return;
    setBlockDetails({
      kind: "special",
      dateKey,
      roomId: reservation.roomId,
      startMinutes: reservation.time,
      durationMinutes: reservation.durationMinutes,
      title: reservation.reservedBy || "אירוע",
      meta: ""
    });
  };

  const handleExamDetails = (reservationId: string, dateKey: string) => {
    const reservation = (displayReservationMap[dateKey] || []).find((entry) => entry.id === reservationId);
    if (!reservation) return;
    setBlockDetails({
      kind: "exam",
      dateKey,
      roomId: reservation.roomId,
      startMinutes: reservation.time,
      durationMinutes: reservation.durationMinutes,
      title: reservation.reservedBy || "מבחן",
      meta: ""
    });
  };

  const handleClosedDetails = (reservationId: string, dateKey: string) => {
    const reservation = (displayReservationMap[dateKey] || []).find((entry) => entry.id === reservationId);
    if (!reservation) return;
    setBlockDetails({
      kind: "closed",
      dateKey,
      roomId: reservation.roomId,
      startMinutes: reservation.time,
      durationMinutes: reservation.durationMinutes,
      title: reservation.reservedBy || "סגור",
      meta: ""
    });
  };


  const findReservationById = useCallback(
    (dateKey: string, reservationId: string) => {
      const inDate = (displayReservationMap[dateKey] || []).find((entry) => entry.id === reservationId);
      if (inDate) return inDate;
      for (const entries of Object.values(displayReservationMap)) {
        const found = entries.find((entry) => entry.id === reservationId);
        if (found) return found;
      }
      return null;
    },
    [displayReservationMap]
  );

  const isReservationInPast = useCallback((reservation: Reservation | null | undefined) => {
    if (!reservation) return true;
    const reservationStart = parseDateKey(reservation.date);
    reservationStart.setHours(Math.floor(reservation.time / 60), reservation.time % 60, 0, 0);
    return Date.now() >= reservationStart.getTime();
  }, []);

  const canReleaseReservationNow = useCallback(
    (reservation: Reservation | null | undefined) => {
      if (!reservation) return false;
      if (!isReservationInPast(reservation)) return true;
      showToast("לא ניתן לשחרר שריון בזמן עבר.", "error");
      return false;
    },
    [isReservationInPast, showToast]
  );

  const handleRelease = useCallback(
    (dateKey: string, reservationId: string) => {
      const reservation = findReservationById(dateKey, reservationId);
      if (!reservation) {
        setPendingRelease({ dateKey, reservationId });
        return;
      }
      if (!canReleaseReservationNow(reservation)) return;
      const linked = collaborationAvailable ? extractLinkedIdsFromReservation(reservation) : null;
      setPendingRelease({
        dateKey,
        reservationId,
        ...(linked ? { linkedGroupId: linked.groupId, linkedRehearsalId: linked.rehearsalId } : {})
      });
    },
    [canReleaseReservationNow, collaborationAvailable, findReservationById]
  );

  const handleEditReservation = useCallback(
    (dateKey: string, reservationId: string) => {
      const reservation = findReservationById(dateKey, reservationId);
      if (!reservation) return;
      const linked = collaborationAvailable ? extractLinkedIdsFromReservation(reservation) : null;
      if (linked) {
        setPendingLinkedEdit({
          dateKey,
          reservationId,
          linkedGroupId: linked.groupId,
          linkedRehearsalId: linked.rehearsalId
        });
        return;
      }
      baseHandleEditReservation(dateKey, reservationId);
    },
    [baseHandleEditReservation, collaborationAvailable, findReservationById]
  );

  const handleRoomSelect = (roomId: string, dateKey = selectedDate) => {
    setAllRooms(false);
    setSelectedRoom(roomId);
    setSelectedDate(dateKey);
    setRoomModeSynced("day");
    onViewChange("room");
  };

  const handleDaySelect = (dateKey: string) => {
    setSelectedDate(dateKey);
    setRoomModeSynced("day");
    onViewChange("room");
  };

  const handlePrev = useCallback(() => {
    if (effectiveView === "mySchedule") {
      if (myScheduleMode === "agenda") return;
      triggerDayTransition("prev");
      if (myScheduleMode === "week") {
        setSelectedDate(formatDateKey(addDays(parseDateKey(selectedDate), -7)));
        return;
      }
      setSelectedDate(shiftSchoolDay(selectedDate, -1, policyDayKeys));
      return;
    }
    if (effectiveView === "room") {
      triggerDayTransition("prev");
      const isAllRooms = allRooms;
      if (!isAllRooms && roomMode === "week") {
        const delta = -7;
        setSelectedDate(formatDateKey(addDays(parseDateKey(selectedDate), delta)));
        return;
      }
      setSelectedDate(shiftSchoolDay(selectedDate, -1, policyDayKeys));
      return;
    }
    triggerDayTransition("prev");
    setSelectedDate(shiftSchoolDay(selectedDate, -1, policyDayKeys));
  }, [allRooms, effectiveView, myScheduleMode, policyDayKeys, roomMode, selectedDate, triggerDayTransition]);

  const handleNext = useCallback(() => {
    if (effectiveView === "mySchedule") {
      if (myScheduleMode === "agenda") return;
      triggerDayTransition("next");
      if (myScheduleMode === "week") {
        setSelectedDate(formatDateKey(addDays(parseDateKey(selectedDate), 7)));
        return;
      }
      setSelectedDate(shiftSchoolDay(selectedDate, 1, policyDayKeys));
      return;
    }
    if (effectiveView === "room") {
      triggerDayTransition("next");
      const isAllRooms = allRooms;
      if (!isAllRooms && roomMode === "week") {
        const delta = 7;
        setSelectedDate(formatDateKey(addDays(parseDateKey(selectedDate), delta)));
        return;
      }
      setSelectedDate(shiftSchoolDay(selectedDate, 1, policyDayKeys));
      return;
    }
    triggerDayTransition("next");
    setSelectedDate(shiftSchoolDay(selectedDate, 1, policyDayKeys));
  }, [allRooms, effectiveView, myScheduleMode, policyDayKeys, roomMode, selectedDate, triggerDayTransition]);

  useEffect(() => {
    if (!onContextChange) return;
    const liveClockKey = effectiveView === "live"
      ? now.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
      : "";
    const liveTopBarData =
      effectiveView === "live"
        ? (() => {
            const today = parseDateKey(todayDateKey);
            const weekdayLabel = new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(today);
            const dateLabel = new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit" }).format(today);
            const isWeekend = today.getDay() === 5 || today.getDay() === 6;
            const isClosedNow = isWeekend || nowMinutes < activeHours.startMinutes || nowMinutes >= activeHours.endMinutes;
            const reservationDuration = (durationMinutes: number | undefined) => {
              const numeric = Number(durationMinutes);
              return Number.isFinite(numeric) && numeric > 0 ? numeric : 60;
            };
            const todayLessons = getLessonsForDate(todayDateKey, todayDayKey);
            const todayReservations = displayReservationMap[todayDateKey] || [];
            const roomStatuses = rooms.map((room) => {
              if (isClosedNow) return "closed" as const;
              const hasActiveLesson = todayLessons.some(
                (lesson) =>
                  lesson.roomId === room.id &&
                  lesson.startMinutes <= nowMinutes &&
                  lesson.startMinutes + lesson.durationMinutes > nowMinutes
              );
              if (hasActiveLesson) return "lesson" as const;
              const hasActiveReservation = todayReservations.some(
                (entry) =>
                  entry.roomId === room.id &&
                  entry.time <= nowMinutes &&
                  entry.time + reservationDuration(entry.durationMinutes) > nowMinutes
              );
              if (hasActiveReservation) return "reserved" as const;
              return "empty" as const;
            });
            const eligibleRoomCount = roomStatuses.length;
            const availableCount = roomStatuses.filter((status) => status === "empty").length;
            return {
              weekdayLabel,
              dateLabel,
              isClosedNow,
              eligibleRoomCount,
              availableCount
            };
          })()
        : null;
    const contextKey = [
      effectiveView,
      roomMode,
      myScheduleMode,
      myScheduleAvailabilityEditMode ? "availability-edit" : "availability-idle",
      availabilityDraftSaving ? "availability-saving" : "availability-ready",
      allRooms ? "all" : "single",
      selectedDate,
      selectedRoom,
      roomsKey,
      groupsTopBarContext?.key || "",
      liveClockKey,
      liveTopBarData
        ? `${liveTopBarData.isClosedNow ? "closed" : "open"}-${liveTopBarData.availableCount}-${liveTopBarData.eligibleRoomCount}`
        : ""
    ].join("::");
    if (lastContextKeyRef.current === contextKey) {
      return;
    }
    lastContextKeyRef.current = contextKey;
    const titles: Record<ViewMode, string> = {
      live: "",
      room: "מערכת שעות",
      finder: "תמצא לי",
      mySchedule: "הלו״ז שלי",
      groups: groupsTopBarContext?.title || "הרכבים"
    };

    const dayLabel = weekDays.find((day) => day.key === selectedDayKey)?.label || "";
    const shortDate = formatShortDate(selectedDate);
    const tomorrowDateKey = formatDateKey(addDays(parseDateKey(todayDateKey), 1));
    const relativeDayLabel =
      selectedDate === todayDateKey
        ? "היום"
        : selectedDate === tomorrowDateKey
          ? "מחר"
          : dayLabel;
    const navText = effectiveView === "room" && roomMode === "week" && !allRooms
      ? `שבוע ${getWeekNumber(selectedDate)}`
      : `${relativeDayLabel} · ${shortDate}`;

    const context: TopBarContext = {
      title: titles[effectiveView]
    };

    if (effectiveView === "room") {
      context.subtitle = (
        <ScheduleTopBarSubtitle
          rooms={rooms}
          selectedRoom={selectedRoom}
          allRooms={allRooms}
          roomMode={roomMode}
          selectedDate={selectedDate}
          navText={navText}
          onPrev={handlePrev}
          onNext={handleNext}
          onOpenDatePicker={openDatePicker}
          onToggleAllRooms={() => {
            setAllRooms((prev) => {
              const next = !prev;
              if (next) setRoomMode("day");
              return next;
            });
          }}
          dateInputRef={dateInputRef}
          setAllRooms={setAllRooms}
          setRoomMode={setRoomModeSynced}
          setSelectedRoom={setSelectedRoom}
          setSelectedDate={setSelectedDate}
        />
      );
    } else if (effectiveView === "finder") {
      context.subtitle = "מציאת חדר וזמן פנויים";
    } else if (effectiveView === "mySchedule") {
      context.subtitle = (
        <MyScheduleTopBarSubtitle
          myScheduleMode={myScheduleMode}
          setMyScheduleMode={setMyScheduleModeSynced}
          selectedDate={selectedDate}
          navText={navText}
          weekDates={weekDates}
          onPrev={handlePrev}
          onNext={handleNext}
          onOpenDatePicker={openDatePicker}
          dateInputRef={dateInputRef}
          setSelectedDate={setSelectedDate}
          availabilityEditMode={myScheduleAvailabilityEditMode}
          availabilityEditSaving={availabilityDraftSaving}
          onStartAvailabilityEditMode={handleStartAvailabilityEditMode}
          onSaveAvailabilityEditMode={() => {
            void handleSaveAvailabilityEditMode();
          }}
          onCancelAvailabilityEditMode={handleCancelAvailabilityEditMode}
        />
      );
    } else if (effectiveView === "groups") {
      context.subtitle = groupsTopBarContext?.subtitle ?? null;
    } else if (effectiveView === "live") {
      if (!liveTopBarData) return;

      context.subtitle = (
        <div className="top-bar-live">
          <div className="top-bar-live-clock">{liveClockKey}</div>
          <div className="top-bar-live-date">{liveTopBarData.weekdayLabel} · {liveTopBarData.dateLabel}</div>
          <div className="top-bar-live-summary">
            {liveTopBarData.isClosedNow
              ? "סגור עכשיו"
              : `חדרים זמינים עכשיו: ${liveTopBarData.availableCount}/${liveTopBarData.eligibleRoomCount}`}
          </div>
        </div>
      );
    }

    onContextChange(context);
  }, [
    onContextChange,
    rooms,
    selectedRoom,
    allRooms,
    effectiveView,
    roomMode,
    myScheduleMode,
    myScheduleAvailabilityEditMode,
    availabilityDraftSaving,
    selectedDate,
    selectedDayKey,
    weekDays,
    weekDates,
    roomsKey,
    handlePrev,
    handleNext,
    onViewChange,
    now,
    nowMinutes,
    todayDateKey,
    todayDayKey,
    displayReservationMap,
    getLessonsForDate,
    activeHours.startMinutes,
    activeHours.endMinutes,
    roomMeta,
    groupsTopBarContext
  ]);

  const handleOpenPinned = useCallback((pin: MySchedulePin) => {
    if (pin.kind === "reservation") {
      const reservedBy = pin.title === "שמור" ? (pin.meta || "שמור") : (pin.title || pin.meta || "שמור");
      setReservationDetails({
        dateKey: pin.dateKey,
        reservation: {
          id: pin.id,
          date: pin.dateKey,
          time: pin.startMinutes,
          durationMinutes: pin.durationMinutes,
          roomId: pin.roomId,
          reservedBy,
          reservedEmail: pin.reservedEmail || ""
        }
      });
      return;
    }
    setBlockDetails({
      kind: pin.kind,
      dateKey: pin.dateKey,
      lessonId: pin.kind === "lesson" ? pin.lessonId : undefined,
      roomId: pin.roomId,
      startMinutes: pin.startMinutes,
      durationMinutes: pin.durationMinutes,
      title: pin.title,
      meta: pin.meta
    });
  }, []);

  const handleMyScheduleAddSlot = useCallback(
    (request: ReserveRequest) => {
      const availableRooms = rooms
        .filter((room) => Boolean(getAvailability({ ...request, roomId: room.id, durationMinutes: 60 })))
        .map((room) => ({ id: room.id, name: room.name || room.shortName || room.id }));
      setMyScheduleAddDraft({ request, roomOptions: availableRooms });
    },
    [getAvailability, rooms]
  );

  const getAvailableRoomsForSlot = useCallback(
    (input: {
      dateKey: string;
      dayKey: DayKey;
      startMinutes: number;
      durationMinutes: number;
      excludeReservationId?: string;
    }) => {
      const alignedDuration = Math.max(30, Math.floor((input.durationMinutes || 0) / 30) * 30 || 30);
      const targetEnd = input.startMinutes + alignedDuration;
      return rooms
        .filter((room) => {
          const availability = getAvailability(
            {
              date: input.dateKey,
              day: input.dayKey,
              time: input.startMinutes,
              roomId: room.id,
              durationMinutes: alignedDuration
            },
            input.excludeReservationId
          );
          if (!availability) return false;
          return availability.startMinutes <= input.startMinutes && availability.limitEnd >= targetEnd;
        })
        .map((room) => ({ id: room.id, name: room.name || room.shortName || room.id }));
    },
    [getAvailability, rooms]
  );

  const toggleAssociatedLessonPins = useCallback(
    async (lessonDetails: {
      lessonId?: string;
      dateKey: string;
      roomId: string;
      startMinutes: number;
      durationMinutes: number;
      title: string;
      meta: string;
    }) => {
      if (!lessonDetails.lessonId) {
        await togglePin({
          kind: "lesson",
          dateKey: lessonDetails.dateKey,
          lessonId: lessonDetails.lessonId,
          roomId: lessonDetails.roomId,
          startMinutes: lessonDetails.startMinutes,
          durationMinutes: lessonDetails.durationMinutes,
          title: lessonDetails.title,
          meta: lessonDetails.meta
        });
        return;
      }

      if (!apiSync.entities.lessons.enabled || !db) {
        await togglePin({
          kind: "lesson",
          dateKey: lessonDetails.dateKey,
          lessonId: lessonDetails.lessonId,
          roomId: lessonDetails.roomId,
          startMinutes: lessonDetails.startMinutes,
          durationMinutes: lessonDetails.durationMinutes,
          title: lessonDetails.title,
          meta: lessonDetails.meta
        });
        return;
      }

      const semester = getSemesterForDate(lessonDetails.dateKey);
      if (!semester?.startDate || !semester?.endDate) {
        await togglePin({
          kind: "lesson",
          dateKey: lessonDetails.dateKey,
          lessonId: lessonDetails.lessonId,
          roomId: lessonDetails.roomId,
          startMinutes: lessonDetails.startMinutes,
          durationMinutes: lessonDetails.durationMinutes,
          title: lessonDetails.title,
          meta: lessonDetails.meta
        });
        return;
      }

      const seriesToken = lessonSeriesToken({
        title: lessonDetails.title,
        teacher: lessonDetails.meta,
        roomId: lessonDetails.roomId,
        startMinutes: lessonDetails.startMinutes,
        durationMinutes: lessonDetails.durationMinutes
      });
      const nextById = new Map<string, MySchedulePin>();
      const pushPin = (
        dateKey: string,
        lesson: Pick<Lesson, "id" | "roomId" | "startMinutes" | "durationMinutes" | "title" | "teacher">
      ) => {
        const base = {
          kind: "lesson" as const,
          dateKey,
          lessonId: lesson.id,
          roomId: lesson.roomId,
          startMinutes: lesson.startMinutes,
          durationMinutes: lesson.durationMinutes
        };
        const id = pinIdFor(base);
        nextById.set(id, {
          id,
          ...base,
          title: lesson.title,
          meta: lesson.teacher || "ללא מרצה",
          createdAt: Date.now()
        });
      };
      pushPin(lessonDetails.dateKey, {
        id: lessonDetails.lessonId,
        roomId: lessonDetails.roomId,
        startMinutes: lessonDetails.startMinutes,
        durationMinutes: lessonDetails.durationMinutes,
        title: lessonDetails.title,
        teacher: lessonDetails.meta
      });

      try {
        const overridesRef = collection(db, "lessonOverrides");
        const parseCandidate = (
          data: Record<string, unknown>
        ): { date: string; externalId: string; lesson: Lesson } | null => {
          if (data.syncSource !== "api") return null;
          if (data.action !== "add") return null;
          const lessonRaw = data.lesson;
          if (!lessonRaw || typeof lessonRaw !== "object") return null;
          const lesson = lessonRaw as Record<string, unknown>;
          const date = typeof data.date === "string" ? data.date : "";
          const id = typeof lesson.id === "string" ? lesson.id : "";
          const roomId = typeof lesson.roomId === "string" ? lesson.roomId : "";
          const title = typeof lesson.title === "string" ? lesson.title : "";
          const teacher = typeof lesson.teacher === "string" ? lesson.teacher : "";
          const startMinutes = Number(lesson.startMinutes);
          const durationMinutes = Number(lesson.durationMinutes);
          if (!date || !id || !roomId) return null;
          if (!Number.isFinite(startMinutes) || !Number.isFinite(durationMinutes)) return null;
          return {
            date,
            externalId: typeof data.externalId === "string" ? data.externalId.trim() : "",
            lesson: {
              id,
              title,
              teacher,
              day: getDayKeyFromDateKey(date),
              roomId,
              startMinutes: Math.round(startMinutes),
              durationMinutes: Math.round(durationMinutes)
            }
          };
        };

        let externalSeriesId = "";
        const currentLessonSnapshot = await getDocs(query(overridesRef, where("lesson.id", "==", lessonDetails.lessonId)));
        currentLessonSnapshot.forEach((docSnap) => {
          if (externalSeriesId) return;
          const parsed = parseCandidate(docSnap.data() as Record<string, unknown>);
          if (!parsed) return;
          if (parsed.date !== lessonDetails.dateKey) return;
          if (!parsed.externalId) return;
          externalSeriesId = parsed.externalId;
        });

        if (externalSeriesId) {
          const seriesSnapshot = await getDocs(query(overridesRef, where("externalId", "==", externalSeriesId)));
          seriesSnapshot.forEach((docSnap) => {
            const parsed = parseCandidate(docSnap.data() as Record<string, unknown>);
            if (!parsed) return;
            if (parsed.date < semester.startDate || parsed.date > semester.endDate) return;
            pushPin(parsed.date, parsed.lesson);
          });
        }

        if (nextById.size <= 1) {
          const snapshot = await getDocs(
            query(overridesRef, where("date", ">=", semester.startDate), where("date", "<=", semester.endDate))
          );
          snapshot.forEach((docSnap) => {
            const parsed = parseCandidate(docSnap.data() as Record<string, unknown>);
            if (!parsed) return;
            if (lessonSeriesToken(parsed.lesson) !== seriesToken) return;
            pushPin(parsed.date, parsed.lesson);
          });
        }
      } catch {
        await togglePin({
          kind: "lesson",
          dateKey: lessonDetails.dateKey,
          lessonId: lessonDetails.lessonId,
          roomId: lessonDetails.roomId,
          startMinutes: lessonDetails.startMinutes,
          durationMinutes: lessonDetails.durationMinutes,
          title: lessonDetails.title,
          meta: lessonDetails.meta
        });
        return;
      }

      const candidatePins = Array.from(nextById.values());
      if (candidatePins.length <= 1) {
        await togglePin({
          kind: "lesson",
          dateKey: lessonDetails.dateKey,
          lessonId: lessonDetails.lessonId,
          roomId: lessonDetails.roomId,
          startMinutes: lessonDetails.startMinutes,
          durationMinutes: lessonDetails.durationMinutes,
          title: lessonDetails.title,
          meta: lessonDetails.meta
        });
        return;
      }

      const currentIds = new Set(myPins.map((pin) => pin.id));
      const candidateIds = new Set(candidatePins.map((pin) => pin.id));
      const allPinned = candidatePins.every((pin) => currentIds.has(pin.id));
      const nextPins = allPinned
        ? myPins.filter((pin) => !candidateIds.has(pin.id))
        : [
            ...myPins,
            ...candidatePins.filter((pin) => !currentIds.has(pin.id))
          ];
      await persistPins(nextPins);
      showToast(allPinned ? "כל המופעים הוסרו מהמערכת שלי." : "כל המופעים המשויכים נוספו למערכת שלי.");
    },
    [apiSync.entities.lessons.enabled, db, getSemesterForDate, myPins, persistPins, pinIdFor, showToast, togglePin]
  );

  const mutatePinsForEmail = useCallback(
    async (email: string, updater: (pins: MySchedulePin[]) => MySchedulePin[]) => {
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail) return;

      if (currentUser && normalizedEmail === currentUser.email.toLowerCase()) {
        const nextPins = updater(myPins);
        await persistPins(nextPins);
        return;
      }

      if (!db) return;
      try {
        const userRef = doc(db, "users", normalizedEmail);
        const snap = await getDoc(userRef);
        const raw = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
        const existingPins = Array.isArray(raw.myPins) ? (raw.myPins as MySchedulePin[]) : [];
        const nextPins = updater(existingPins);
        await setDoc(
          userRef,
          {
            email: normalizedEmail,
            myPins: nextPins,
            myPinsUpdatedAt: serverTimestamp()
          },
          { merge: true }
        );
      } catch {
        // Best effort for cross-user updates.
      }
    },
    [currentUser, db, myPins, persistPins]
  );

  const persistTentativePinForEmail = useCallback(
    async (email: string, pin: MySchedulePin) => {
      await mutatePinsForEmail(email, (existingPins) => {
        const index = existingPins.findIndex((entry) => entry.id === pin.id);
        if (index < 0) return [...existingPins, pin];
        const next = existingPins.slice();
        next[index] = { ...next[index], ...pin, id: next[index].id };
        return next;
      });
    },
    [mutatePinsForEmail]
  );

  const removeLinkedPinsForGroupRehearsal = useCallback(
    async (emails: string[], groupId: string, rehearsalId: string) => {
      await Promise.all(
        emails.map(async (email) => {
          await mutatePinsForEmail(email, (existingPins) =>
            existingPins.filter(
              (pin) => !(pin.linkedGroupId === groupId && pin.linkedRehearsalId === rehearsalId)
            )
          );
        })
      );
    },
    [mutatePinsForEmail]
  );

  const updateLinkedPinStatusForEmail = useCallback(
    async (
      email: string,
      groupId: string,
      rehearsalId: string,
      status: RehearsalParticipant["status"],
      source?: { groupName: string; dateKey: string; roomId?: string; startMinutes: number; durationMinutes: number }
    ) => {
      await mutatePinsForEmail(email, (existingPins) => {
        const filtered = existingPins.filter(
          (pin) => !(pin.linkedGroupId === groupId && pin.linkedRehearsalId === rehearsalId)
        );
        if (status === "declined") {
          return filtered;
        }
        const pinSource = source;
        if (!pinSource) return filtered;
        const pinBase = {
          kind: "reservation" as const,
          dateKey: pinSource.dateKey,
          roomId: pinSource.roomId || PERSONAL_PIN_ROOM_ID,
          startMinutes: pinSource.startMinutes,
          durationMinutes: pinSource.durationMinutes
        };
        const pinMeta = status === "pending"
          ? `הרכב: ${pinSource.groupName} · ממתין לאישור`
          : pinSource.roomId
            ? `הרכב: ${pinSource.groupName}`
            : `הרכב: ${pinSource.groupName} · ממתין לחדר`;
        const nextPin: MySchedulePin = {
          id: pinIdFor(pinBase),
          ...pinBase,
          title: `חזרה · ${pinSource.groupName}`,
          meta: pinMeta,
          linkedGroupId: groupId,
          linkedRehearsalId: rehearsalId,
          rehearsalStatus: status,
          createdAt: Date.now()
        };
        return [...filtered, nextPin];
      });
    },
    [mutatePinsForEmail, pinIdFor]
  );

  const validateDirectReservationByPolicy = useCallback(
    (input: {
      dateKey: string;
      dayKey: DayKey;
      roomId: string;
      startMinutes: number;
      durationMinutes: number;
      excludeReservationId?: string;
    }) => {
      if (!currentUser?.allowed || !currentUser.email) {
        setAuthError("יש להתחבר עם חשבון סטודנט מאושר.");
        return false;
      }

      const toPolicyLimitMinutes = (hours: number) => {
        const numeric = Number(hours);
        if (!Number.isFinite(numeric) || numeric <= 0) return Number.POSITIVE_INFINITY;
        const raw = Math.floor(numeric * 60);
        return Math.max(0, Math.floor(raw / 30) * 30);
      };
      const formatHoursLabel = (hours: number) => {
        const rounded = Math.round(hours * 10) / 10;
        return Number.isInteger(rounded) ? String(rounded) : String(rounded);
      };
      const toDayDelta = (fromDateKey: string, toDateKey: string) => {
        const start = parseDateKey(fromDateKey);
        const target = parseDateKey(toDateKey);
        const ms = target.getTime() - start.getTime();
        return Math.floor(ms / (24 * 60 * 60 * 1000));
      };

      const { dateKey, roomId, startMinutes, durationMinutes, excludeReservationId } = input;
      const endMinutes = startMinutes + durationMinutes;
      if (!policyDayKeySet.has(input.dayKey)) {
        showToast("לא ניתן לשריין ביום הזה לפי מדיניות המערכת.", "error");
        return false;
      }
      if (durationMinutes <= 0 || startMinutes < 0 || endMinutes > 24 * 60) {
        showToast("טווח זמן לא תקין.", "error");
        return false;
      }
      if (
        !isReservationPolicySlotAllowed(policyWindows, {
          dateKey,
          dayKey: input.dayKey,
          roomId,
          startMinutes,
          endMinutes
        })
      ) {
        showToast("השעה מחוץ לשעות הפעילות לפי מדיניות המערכת.", "error");
        return false;
      }

      let effectivePolicy = { ...reservationPolicy };
      const scopedPolicies = reservationPolicies.filter((policy) => policy.enabled);
      const matchedPolicies: { name: string; rules: Partial<typeof reservationPolicy> }[] = [];

      scopedPolicies.forEach((policy) => {
        if (policy.isDefault) {
          effectivePolicy = { ...effectivePolicy, ...(policy.rules as typeof reservationPolicy) };
          return;
        }
        if (policy.scope.roomIds.length && !policy.scope.roomIds.includes(roomId)) return;
        if (policy.scope.dayKeys.length && !policy.scope.dayKeys.includes(input.dayKey)) return;
        if (policy.scope.dateStart && dateKey < policy.scope.dateStart) return;
        if (policy.scope.dateEnd && dateKey > policy.scope.dateEnd) return;
        if (typeof policy.scope.startMinutes === "number" && startMinutes < policy.scope.startMinutes) return;
        if (typeof policy.scope.endMinutes === "number" && startMinutes >= policy.scope.endMinutes) return;
        matchedPolicies.push({ name: policy.name, rules: policy.rules as Partial<typeof reservationPolicy> });
      });

      const firstMatched = matchedPolicies[0];
      if (firstMatched) {
        effectivePolicy = { ...effectivePolicy, ...(firstMatched.rules as typeof reservationPolicy) };
      }

      if (effectivePolicy.blockReservations) {
        showToast(
          firstMatched?.name
            ? `שריון חסום לפי מדיניות "${firstMatched.name}".`
            : "השריון חסום לפי מדיניות המערכת.",
          "error"
        );
        return false;
      }

      const roomOpen = config.startHour * 60;
      const roomClose = config.endHour * 60;
      if (startMinutes < roomOpen || endMinutes > roomClose) {
        showToast("השעה מחוץ לשעות הפעילות של החדר.", "error");
        return false;
      }

      const maxDaysForward = Math.max(0, Math.round(effectivePolicy.maxDaysForward));
      if (maxDaysForward > 0) {
        const todayKey = formatDateKey(new Date());
        const delta = toDayDelta(todayKey, dateKey);
        if (delta > maxDaysForward) {
          showToast(`אפשר לשריין עד ${maxDaysForward} ימים קדימה.`, "error");
          return false;
        }
      }

      const nowDate = new Date();
      const startDate = parseDateKey(dateKey);
      startDate.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
      if (nowDate.getTime() >= startDate.getTime()) {
        showToast("לא ניתן לשריין או לעדכן שריון בזמן עבר.", "error");
        return false;
      }
      if (effectivePolicy.minLeadMode === "day_before_time" || effectivePolicy.minLeadDayBeforeEnabled) {
        const deadline = addDays(parseDateKey(dateKey), -1);
        const cutoffMinutes = Math.max(0, Math.min(23 * 60 + 59, effectivePolicy.minLeadDayBeforeMinutes));
        deadline.setHours(Math.floor(cutoffMinutes / 60), cutoffMinutes % 60, 0, 0);
        if (nowDate.getTime() > deadline.getTime()) {
          showToast(
            firstMatched?.name
              ? `שריון לסלוט הזה נסגר ביום שלפני בשעה ${formatMinutes(cutoffMinutes)} לפי מדיניות "${firstMatched.name}".`
              : `שריון לסלוט הזה נסגר ביום שלפני בשעה ${formatMinutes(cutoffMinutes)}.`,
            "error"
          );
          return false;
        }
      } else {
        const leadHours = Math.max(0, effectivePolicy.minLeadHours);
        if (leadHours > 0) {
          const deadline = new Date(startDate.getTime() - leadHours * 60 * 60 * 1000);
          if (nowDate.getTime() > deadline.getTime()) {
            showToast(
              firstMatched?.name
                ? `שריון לסלוט הזה נסגר ${formatHoursLabel(leadHours)} שעות לפני תחילתו לפי מדיניות "${firstMatched.name}".`
                : `שריון לסלוט הזה נסגר ${formatHoursLabel(leadHours)} שעות לפני תחילתו.`,
              "error"
            );
            return false;
          }
        }
      }

      const dayLessons = getLessonsForDate(dateKey, input.dayKey);
      const overlapsLesson = dayLessons.some((lesson) => {
        if (lesson.roomId !== roomId) return false;
        const lessonEnd = lesson.startMinutes + lesson.durationMinutes;
        return lesson.startMinutes < endMinutes && lessonEnd > startMinutes;
      });
      if (overlapsLesson) {
        showToast("קיים שיעור חופף.", "error");
        return false;
      }

      const dayReservations = displayReservationMap[dateKey] || [];
      const overlapsReservation = dayReservations.some((entry) => {
        if (entry.id === excludeReservationId) return false;
        if (entry.roomId !== roomId) return false;
        const entryEnd = entry.time + entry.durationMinutes;
        return entry.time < endMinutes && entryEnd > startMinutes;
      });
      if (overlapsReservation) {
        showToast("קיים שריון חופף.", "error");
        return false;
      }

      const currentEmail = (currentUser.email || "").trim().toLowerCase();
      const maxConcurrentReservations = Math.max(1, Math.round(Number(effectivePolicy.maxConcurrentReservations) || 1));
      const overlappingUserReservationCount = dayReservations.filter((entry) => {
        if (entry.id === excludeReservationId) return false;
        if (getReservationUsageShareForEmail(entry, currentEmail) <= 0) return false;
        const entryEnd = entry.time + entry.durationMinutes;
        return entry.time < endMinutes && entryEnd > startMinutes;
      }).length;
      if (overlappingUserReservationCount + 1 > maxConcurrentReservations) {
        showToast(
          firstMatched?.name
            ? `מותר עד ${maxConcurrentReservations} שריונים במקביל לפי מדיניות "${firstMatched.name}".`
            : `מותר עד ${maxConcurrentReservations} שריונים במקביל בזמן נתון.`,
          "error"
        );
        return false;
      }

      const roomDayUsed = dayReservations
        .filter(
          (entry) =>
            entry.id !== excludeReservationId && entry.roomId === roomId
        )
        .reduce((sum, entry) => sum + getReservationUsageShareForEmail(entry, currentEmail), 0);
      const totalDayUsed = dayReservations
        .filter((entry) => entry.id !== excludeReservationId)
        .reduce((sum, entry) => sum + getReservationUsageShareForEmail(entry, currentEmail), 0);

      const weekStart = getWeekStart(dateKey);
      const weekStartKey = formatDateKey(weekStart);
      const weekEndKey = formatDateKey(addDays(weekStart, 6));
      let roomWeekUsed = 0;
      let totalWeekUsed = 0;
      Object.entries(displayReservationMap).forEach(([entryDateKey, entries]) => {
        if (entryDateKey < weekStartKey || entryDateKey > weekEndKey) return;
        entries.forEach((entry) => {
          if (entry.id === excludeReservationId) return;
          const usageShare = getReservationUsageShareForEmail(entry, currentEmail);
          if (usageShare <= 0) return;
          totalWeekUsed += usageShare;
          if (entry.roomId === roomId) roomWeekUsed += usageShare;
        });
      });

      const roomDayRemaining = Math.max(0, toPolicyLimitMinutes(effectivePolicy.maxHoursPerRoomPerDay) - roomDayUsed);
      const roomWeekRemaining = Math.max(0, toPolicyLimitMinutes(effectivePolicy.maxHoursPerRoomPerWeek) - roomWeekUsed);
      const totalDayRemaining = Math.max(0, toPolicyLimitMinutes(effectivePolicy.maxHoursPerDayTotal) - totalDayUsed);
      const totalWeekRemaining = Math.max(0, toPolicyLimitMinutes(effectivePolicy.maxHoursPerWeekTotal) - totalWeekUsed);

      if (roomDayRemaining < durationMinutes) {
        showToast(
          `מקסימום ${formatHoursLabel(effectivePolicy.maxHoursPerRoomPerDay)} שעות לחדר ביום.\nלהחרגה יש לפנות למנהל מורשה.`,
          "error"
        );
        return false;
      }
      if (roomWeekRemaining < durationMinutes) {
        showToast(
          `מקסימום ${formatHoursLabel(effectivePolicy.maxHoursPerRoomPerWeek)} שעות לחדר בשבוע.\nלהחרגה יש לפנות למנהל מורשה.`,
          "error"
        );
        return false;
      }
      if (totalDayRemaining < durationMinutes) {
        showToast(
          `מקסימום ${formatHoursLabel(effectivePolicy.maxHoursPerDayTotal)} שעות ליום לכל הסטודנט.\nלהחרגה יש לפנות למנהל מורשה.`,
          "error"
        );
        return false;
      }
      if (totalWeekRemaining < durationMinutes) {
        showToast(
          `מקסימום ${formatHoursLabel(effectivePolicy.maxHoursPerWeekTotal)} שעות לשבוע לכל הסטודנט.\nלהחרגה יש לפנות למנהל מורשה.`,
          "error"
        );
        return false;
      }

      return true;
    },
    [
      config.endHour,
      config.startHour,
      currentUser?.allowed,
      currentUser?.email,
      displayReservationMap,
      getLessonsForDate,
      reservationPolicies,
      reservationPolicy,
      policyDayKeySet,
      policyWindows,
      setAuthError,
      showToast
    ]
  );

  const handleFinderSchedule = useCallback(
    async (selection: {
      dateKey: string;
      dayKey: DayKey;
      startMinutes: number;
      endMinutes: number;
      preferredDurationMinutes?: number;
      roomId?: string;
      groupId?: string;
      mode: { findCommonTime: boolean; findRoom: boolean };
      participantEmails: string[];
    }) => {
      const organizerEmail = (currentUser?.email || "").trim().toLowerCase();
      if (!organizerEmail) {
        setAuthError("יש להתחבר כדי לתזמן חזרה.");
        return;
      }
      if (!collaborationAvailable) {
        if (selection.mode.findRoom && selection.roomId) {
          handleReserve(
            {
              date: selection.dateKey,
              day: selection.dayKey,
              time: selection.startMinutes,
              roomId: selection.roomId,
              durationMinutes: Math.max(
                30,
                selection.preferredDurationMinutes || selection.endMinutes - selection.startMinutes
              )
            },
            { keepCurrentView: true }
          );
          return;
        }
        showToast("יש לבחור חדר כדי להמשיך.");
        return;
      }
      const selectedGroupId = (selection.groupId || "").trim();
      const selectedGroup = selectedGroupId ? groups.find((group) => group.id === selectedGroupId) || null : null;
      const durationMinutes = Math.max(
        30,
        selection.preferredDurationMinutes || selection.endMinutes - selection.startMinutes
      );
      if (selection.mode.findRoom && selection.roomId) {
        const autoLinkGroupId = selection.mode.findCommonTime ? selectedGroupId : "";
        setPendingFinderAutoLinkSynced(autoLinkGroupId ? { groupId: autoLinkGroupId } : null);
        handleReserve({
          date: selection.dateKey,
          day: selection.dayKey,
          time: selection.startMinutes,
          roomId: selection.roomId,
          durationMinutes
        }, { keepCurrentView: true });
        return;
      }
      setPendingFinderAutoLinkSynced(null);
      const nowMs = Date.now();
      const defaultParticipants = selectedGroup?.memberEmails?.length
        ? selectedGroup.memberEmails
        : [organizerEmail];
      const participantEmails = Array.from(
        new Set(
          [
            organizerEmail,
            ...(
              (selection.participantEmails || []).length
                ? selection.participantEmails
                : defaultParticipants
            )
              .map((email) => email.trim().toLowerCase())
              .filter(Boolean)
          ]
        )
      );
      const roomIdForPins = selection.roomId || PERSONAL_PIN_ROOM_ID;
      const title = selectedGroup ? `חזרה · ${selectedGroup.name}` : "חזרה";
      const rehearsalId = `reh-${nowMs}-${Math.random().toString(36).slice(2, 8)}`;
      const reservationId = `group-${selectedGroup?.id || "solo"}-${rehearsalId}`;
      const linkedGroupId = selectedGroup?.id;

      await Promise.all(
        participantEmails.map(async (email) => {
          const pinBase = {
            kind: "reservation" as const,
            dateKey: selection.dateKey,
            roomId: roomIdForPins,
            startMinutes: selection.startMinutes,
            durationMinutes
          };
          const participantStatus: RehearsalParticipant["status"] = email === organizerEmail ? "approved" : "pending";
          const pin: MySchedulePin = {
            id: pinIdFor(pinBase),
            ...pinBase,
            title,
            meta: selectedGroup
              ? participantStatus === "pending"
                ? `הרכב: ${selectedGroup.name} · ממתין לאישור`
                : selection.mode.findRoom && selection.roomId
                  ? `הרכב: ${selectedGroup.name}`
                  : `הרכב: ${selectedGroup.name} · ממתין לחדר`
              : "חזרה מתוזמנת",
            ...(linkedGroupId ? { linkedGroupId } : {}),
            ...(linkedGroupId ? { linkedRehearsalId: rehearsalId } : {}),
            rehearsalStatus: participantStatus,
            createdAt: nowMs
          };
          await persistTentativePinForEmail(email, pin);
        })
      );

      if (selection.mode.findCommonTime && selectedGroup) {
        const rehearsal: GroupRehearsal = {
          id: rehearsalId,
          title: "חזרת הרכב",
          dateKey: selection.dateKey,
          dayKey: selection.dayKey,
          startMinutes: selection.startMinutes,
          durationMinutes,
          ...(selection.mode.findRoom && selection.roomId ? { roomId: selection.roomId } : {}),
          ...(selection.mode.findRoom && selection.roomId ? { reservationId } : {}),
          mode: selection.mode,
          participants: participantEmails.map((email) => ({
            email,
            status: email === organizerEmail ? "approved" : "pending",
            updatedAt: nowMs
          })),
          createdBy: organizerEmail,
          createdAt: nowMs
        };
        await addGroupRehearsal(selectedGroup.id, rehearsal);
      }

      showToast("החזרה נוספה ונשלחה למשתתפים לאישור.", "success");
    },
    [
      addGroupRehearsal,
      collaborationAvailable,
      currentUser,
      groups,
      handleReserve,
      persistTentativePinForEmail,
      pinIdFor,
      setAuthError,
      setPendingFinderAutoLinkSynced,
      showToast
    ]
  );

  const findGroupRehearsal = useCallback(
    (groupId: string, rehearsalId: string) => {
      const group = groups.find((entry) => entry.id === groupId) || null;
      if (!group) return { group: null, rehearsal: null as GroupRehearsal | null };
      const rehearsal = (group.rehearsals || []).find((entry) => entry.id === rehearsalId) || null;
      return { group, rehearsal };
    },
    [groups]
  );

  const findLinkedReservationForRehearsal = useCallback(
    (groupId: string, rehearsal: GroupRehearsal) => {
      const dateReservations = displayReservationMap[rehearsal.dateKey] || [];
      const byId = rehearsal.reservationId
        ? dateReservations.find((entry) => entry.id === rehearsal.reservationId)
        : null;
      if (byId) return byId;
      if (rehearsal.reservationId) {
        for (const entries of Object.values(displayReservationMap)) {
          const found = entries.find((entry) => entry.id === rehearsal.reservationId);
          if (found) return found;
        }
      }
      for (const entries of Object.values(displayReservationMap)) {
        const found = entries.find((entry) => {
          const linked = extractLinkedIdsFromReservation(entry);
          return Boolean(linked && linked.groupId === groupId && linked.rehearsalId === rehearsal.id);
        });
        if (found) return found;
      }
      return null;
    },
    [displayReservationMap]
  );

  useEffect(() => {
    if (!collaborationAvailable || !db) return;
    const pendingUpdates: Array<Promise<unknown>> = [];
    groups.forEach((group) => {
      (group.rehearsals || []).forEach((rehearsal) => {
        const linkedReservation = findLinkedReservationForRehearsal(group.id, rehearsal);
        if (!linkedReservation) return;
        const desiredParticipants = buildApprovedQuotaParticipantEmails(
          rehearsal.participants,
          linkedReservation.reservedEmail
        );
        const currentParticipants = normalizeEmailList(linkedReservation.quotaParticipantEmails || []);
        const desiredSorted = [...desiredParticipants].sort();
        const currentSorted = [...currentParticipants].sort();
        const unchanged =
          desiredSorted.length === currentSorted.length &&
          desiredSorted.every((value, index) => value === currentSorted[index]);
        if (unchanged) return;
        pendingUpdates.push(
          updateDoc(doc(db, "reservations", linkedReservation.id), {
            quotaParticipantEmails: desiredParticipants,
            updatedAt: serverTimestamp()
          })
        );
      });
    });
    if (!pendingUpdates.length) return;
    void Promise.allSettled(pendingUpdates);
  }, [collaborationAvailable, findLinkedReservationForRehearsal, groups]);

  const clearReservationLinkMetadata = useCallback(
    async (reservationId: string) => {
      if (!db || !reservationId) return false;
      try {
        await updateDoc(doc(db, "reservations", reservationId), {
          linkedGroupId: deleteField(),
          linkedRehearsalId: deleteField(),
          quotaParticipantEmails: deleteField(),
          updatedAt: serverTimestamp()
        });
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const syncLinkedPinsForRehearsal = useCallback(
    async (group: CollaborationGroup, rehearsal: GroupRehearsal) => {
      await Promise.all(
        rehearsal.participants.map(async (participant) => {
          await mutatePinsForEmail(participant.email, (existingPins) => {
            const filtered = existingPins.filter(
              (pin) => !(pin.linkedGroupId === group.id && pin.linkedRehearsalId === rehearsal.id)
            );
            if (participant.status === "declined") return filtered;
            const pinBase = {
              kind: "reservation" as const,
              dateKey: rehearsal.dateKey,
              roomId: rehearsal.roomId || PERSONAL_PIN_ROOM_ID,
              startMinutes: rehearsal.startMinutes,
              durationMinutes: rehearsal.durationMinutes
            };
            const pinMeta = participant.status === "pending"
              ? `הרכב: ${group.name} · ממתין לאישור`
              : rehearsal.roomId
                ? `הרכב: ${group.name}`
                : `הרכב: ${group.name} · ממתין לחדר`;
            const nextPin: MySchedulePin = {
              id: pinIdFor(pinBase),
              ...pinBase,
              title: `חזרה · ${group.name}`,
              meta: pinMeta,
              linkedGroupId: group.id,
              linkedRehearsalId: rehearsal.id,
              rehearsalStatus: participant.status,
              createdAt: Date.now()
            };
            return [...filtered, nextPin];
          });
        })
      );
    },
    [mutatePinsForEmail, pinIdFor]
  );

  const upsertGroupRehearsalWithLinkedReservation = useCallback(
    async (groupId: string, rehearsal: GroupRehearsal) => {
      const group = groups.find((entry) => entry.id === groupId) || null;
      if (!group) return;
      let nextRehearsal = { ...rehearsal };
      const linkedReservation = findLinkedReservationForRehearsal(group.id, rehearsal);

      if (nextRehearsal.roomId) {
        const reservationId = linkedReservation?.id || nextRehearsal.reservationId || `group-${group.id}-${nextRehearsal.id}`;
        const allowed = validateDirectReservationByPolicy({
          dateKey: nextRehearsal.dateKey,
          dayKey: getDayKeyFromDateKey(nextRehearsal.dateKey),
          roomId: nextRehearsal.roomId,
          startMinutes: nextRehearsal.startMinutes,
          durationMinutes: nextRehearsal.durationMinutes,
          ...(linkedReservation?.id ? { excludeReservationId: linkedReservation.id } : {})
        });
        if (!allowed) {
          return;
        }
        const reservation: Reservation = {
          id: reservationId,
          date: nextRehearsal.dateKey,
          time: nextRehearsal.startMinutes,
          durationMinutes: nextRehearsal.durationMinutes,
          roomId: nextRehearsal.roomId,
          reservedBy: linkedReservation?.reservedBy || `חזרת הרכב · ${group.name}`,
          reservedEmail:
            linkedReservation?.reservedEmail || nextRehearsal.createdBy || group.ownerEmail,
          quotaParticipantEmails: buildApprovedQuotaParticipantEmails(
            nextRehearsal.participants,
            linkedReservation?.reservedEmail || nextRehearsal.createdBy || group.ownerEmail
          ),
          linkedGroupId: group.id,
          linkedRehearsalId: nextRehearsal.id
        };
        const reservationSaved = linkedReservation
          ? await upsertReservation(reservation)
          : await addReservation(reservation);
        if (!reservationSaved) {
          showToast("לא ניתן היה לעדכן את שריון החדר המקושר.", "error");
          return;
        }
        nextRehearsal = {
          ...nextRehearsal,
          reservationId,
          mode: { ...nextRehearsal.mode, findRoom: true }
        };
      } else if (linkedReservation) {
        const cleared = await clearReservationLinkMetadata(linkedReservation.id);
        if (!cleared) {
          showToast("לא ניתן היה לנתק את הקישור מהשריון.", "error");
          return;
        }
        const { reservationId: _reservationId, roomId: _roomId, ...rest } = nextRehearsal;
        nextRehearsal = {
          ...rest,
          mode: { ...rest.mode, findRoom: false }
        };
      }

      await addGroupRehearsal(group.id, nextRehearsal);
      await syncLinkedPinsForRehearsal(group, nextRehearsal);
    },
    [
      addGroupRehearsal,
      addReservation,
      clearReservationLinkMetadata,
      findLinkedReservationForRehearsal,
      groups,
      showToast,
      syncLinkedPinsForRehearsal,
      upsertReservation,
      validateDirectReservationByPolicy
    ]
  );

  const updateLinkedRehearsalFromReservation = useCallback(
    async (reservation: Reservation) => {
      const linked = extractLinkedIdsFromReservation(reservation);
      if (!linked) return;
      const { group, rehearsal } = findGroupRehearsal(linked.groupId, linked.rehearsalId);
      if (!group || !rehearsal) return;
      const next: GroupRehearsal = {
        ...rehearsal,
        dateKey: reservation.date,
        dayKey: getDayKeyFromDateKey(reservation.date),
        startMinutes: reservation.time,
        durationMinutes: reservation.durationMinutes,
        roomId: reservation.roomId,
        reservationId: reservation.id,
        mode: { ...rehearsal.mode, findRoom: true }
      };
      await addGroupRehearsal(group.id, next);
      await syncLinkedPinsForRehearsal(group, next);
    },
    [addGroupRehearsal, findGroupRehearsal, syncLinkedPinsForRehearsal]
  );

  const unlinkRehearsalRoomFromReservation = useCallback(
    async (groupId: string, rehearsalId: string) => {
      const { group, rehearsal } = findGroupRehearsal(groupId, rehearsalId);
      if (!group || !rehearsal) return;
      const next: GroupRehearsal = {
        ...rehearsal,
        mode: { ...rehearsal.mode, findRoom: false }
      };
      delete next.roomId;
      delete next.reservationId;
      await addGroupRehearsal(group.id, next);
      await syncLinkedPinsForRehearsal(group, next);
    },
    [addGroupRehearsal, findGroupRehearsal, syncLinkedPinsForRehearsal]
  );

  const createLinkedRehearsalFromReservation = useCallback(
    async (reservation: Reservation, groupId: string, rehearsalName?: string) => {
      const organizerEmail = (currentUser?.email || "").trim().toLowerCase();
      if (!organizerEmail) {
        setAuthError("יש להתחבר כדי לקשר שריון לחזרה.");
        return false;
      }
      const group = groups.find((entry) => entry.id === groupId) || null;
      if (!group) {
        showToast("לא נמצא הרכב לקישור.", "error");
        return false;
      }
      const participantEmails = Array.from(
        new Set(
          [group.ownerEmail, ...group.memberEmails]
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean)
        )
      );
      if (!participantEmails.includes(organizerEmail)) {
        showToast("אפשר לקשר רק להרכב שאת/ה משתתפ/ת בו.", "error");
        return false;
      }
      const nowMs = Date.now();
      const rehearsalId = `reh-${nowMs}-${Math.random().toString(36).slice(2, 8)}`;
      const cleanRehearsalName = (rehearsalName || "").trim();
      const rehearsal: GroupRehearsal = {
        id: rehearsalId,
        title: cleanRehearsalName || "חזרת הרכב",
        dateKey: reservation.date,
        dayKey: getDayKeyFromDateKey(reservation.date),
        startMinutes: reservation.time,
        durationMinutes: reservation.durationMinutes,
        roomId: reservation.roomId,
        reservationId: reservation.id,
        mode: { findCommonTime: true, findRoom: true },
        participants: participantEmails.map((email) => ({
          email,
          status: email === organizerEmail ? "approved" : "pending",
          updatedAt: nowMs
        })),
        createdBy: organizerEmail,
        createdAt: nowMs
      };

      try {
        await addGroupRehearsal(group.id, rehearsal);
      } catch {
        showToast("לא ניתן היה ליצור חזרה בהרכב.", "error");
        return false;
      }

      const linkedSaved = await upsertReservation({
        ...reservation,
        quotaParticipantEmails: buildApprovedQuotaParticipantEmails(rehearsal.participants, reservation.reservedEmail),
        linkedGroupId: group.id,
        linkedRehearsalId: rehearsal.id
      });
      if (!linkedSaved) {
        showToast("השריון נשמר אך הקישור להרכב נכשל.", "error");
        return false;
      }

      await syncLinkedPinsForRehearsal(group, rehearsal);
      showToast("השריון קושר להרכב ונוצרה חזרה חדשה.", "success");
      return true;
    },
    [
      addGroupRehearsal,
      currentUser?.email,
      groups,
      setAuthError,
      showToast,
      syncLinkedPinsForRehearsal,
      upsertReservation
    ]
  );

  const applyRehearsalResponse = useCallback(
    async (groupId: string, rehearsalId: string, status: RehearsalParticipant["status"]) => {
      const currentEmail = (currentUser?.email || "").trim().toLowerCase();
      if (!currentEmail) return;
      const { group, rehearsal } = findGroupRehearsal(groupId, rehearsalId);
      await respondToRehearsal(groupId, rehearsalId, status);
      await updateLinkedPinStatusForEmail(
        currentEmail,
        groupId,
        rehearsalId,
        status,
        group && rehearsal
          ? {
              groupName: group.name,
              dateKey: rehearsal.dateKey,
              roomId: rehearsal.roomId,
              startMinutes: rehearsal.startMinutes,
              durationMinutes: rehearsal.durationMinutes
            }
          : undefined
      );
    },
    [currentUser?.email, findGroupRehearsal, respondToRehearsal, updateLinkedPinStatusForEmail]
  );

  const handleConfirmEdit = useCallback(
    async (pending: Parameters<typeof baseHandleConfirmEdit>[0], startMinutes: number, durationMinutes: number, privateDescription?: string) => {
      const currentEntry = (displayReservationMap[pending.request.date] || []).find(
        (entry) => entry.id === pending.reservationId
      );
      const ok = await baseHandleConfirmEdit(pending, startMinutes, durationMinutes, privateDescription);
      if (!ok || !currentEntry) return null;
      const updatedReservation: Reservation = {
        ...currentEntry,
        time: startMinutes,
        durationMinutes,
        privateDescription: (privateDescription || "").trim()
      };
      if (extractLinkedIdsFromReservation(currentEntry)) {
        await updateLinkedRehearsalFromReservation(updatedReservation);
      }
      setPendingLinkedEdit(null);
      return updatedReservation;
    },
    [baseHandleConfirmEdit, displayReservationMap, updateLinkedRehearsalFromReservation]
  );

  const handleRespondToGroupRehearsal = useCallback(
    async (groupId: string, rehearsalId: string, status: RehearsalParticipant["status"]) => {
      const currentEmail = (currentUser?.email || "").trim().toLowerCase();
      if (!currentEmail) return;
      const { rehearsal } = findGroupRehearsal(groupId, rehearsalId);
      if (!rehearsal) return;
      const currentStatus = rehearsal.participants.find((entry) => entry.email === currentEmail)?.status;
      if (!currentStatus || currentStatus === status) return;
      if (currentStatus !== "pending") {
        setPendingRehearsalResponse({ groupId, rehearsalId, status });
        return;
      }
      await applyRehearsalResponse(groupId, rehearsalId, status);
    },
    [applyRehearsalResponse, currentUser?.email, findGroupRehearsal]
  );

  const handleDeleteGroupRehearsal = useCallback(
    async (groupId: string, rehearsalId: string, options?: { releaseLinkedReservation?: boolean }) => {
      const { rehearsal } = findGroupRehearsal(groupId, rehearsalId);
      if (!rehearsal) return;
      const linkedReservation = findLinkedReservationForRehearsal(groupId, rehearsal);
      const releaseLinkedReservation = options?.releaseLinkedReservation !== false;
      if (linkedReservation) {
        if (releaseLinkedReservation) {
          if (isReservationInPast(linkedReservation)) {
            showToast("לא ניתן לשחרר את החדר המשויך לחזרה בזמן עבר.", "error");
            return;
          }
          const ok = await releaseReservation(rehearsal.dateKey, linkedReservation.id);
          if (!ok) {
            showToast("לא ניתן היה לשחרר את החדר המשויך לחזרה.", "error");
            return;
          }
        } else {
          const cleared = await clearReservationLinkMetadata(linkedReservation.id);
          if (!cleared) {
            showToast("לא ניתן היה לנתק את הקישור מהשריון.", "error");
            return;
          }
        }
      }
      await removeLinkedPinsForGroupRehearsal(
        rehearsal.participants.map((entry) => entry.email),
        groupId,
        rehearsalId
      );
      await deleteGroupRehearsal(groupId, rehearsalId);
    },
    [
      deleteGroupRehearsal,
      findGroupRehearsal,
      findLinkedReservationForRehearsal,
      isReservationInPast,
      releaseReservation,
      removeLinkedPinsForGroupRehearsal,
      showToast,
      clearReservationLinkMetadata
    ]
  );

  const handleDeleteGroup = useCallback(
    async (groupId: string) => {
      const group = groups.find((entry) => entry.id === groupId) || null;
      if (!group) return;
      let failedReleaseCount = 0;
      let failedUnlinkCount = 0;
      const handledReservationIds = new Set<string>();
      for (const rehearsal of group.rehearsals || []) {
        const linkedReservation = findLinkedReservationForRehearsal(group.id, rehearsal);
        if (linkedReservation && !handledReservationIds.has(linkedReservation.id)) {
          handledReservationIds.add(linkedReservation.id);
          if (isReservationInPast(linkedReservation)) {
            failedReleaseCount += 1;
            const cleared = await clearReservationLinkMetadata(linkedReservation.id);
            if (!cleared) {
              failedUnlinkCount += 1;
            }
            continue;
          }
          const released = await releaseReservation(rehearsal.dateKey, linkedReservation.id);
          if (!released) {
            failedReleaseCount += 1;
            const cleared = await clearReservationLinkMetadata(linkedReservation.id);
            if (!cleared) {
              failedUnlinkCount += 1;
            }
          }
        }
        await removeLinkedPinsForGroupRehearsal(
          rehearsal.participants.map((participant) => participant.email),
          group.id,
          rehearsal.id
        );
      }
      await deleteGroup(groupId);
      if (failedUnlinkCount > 0) {
        showToast("ההרכב נמחק, אך חלק מהקישורים לשריונים לא עודכנו.", "error");
      } else if (failedReleaseCount > 0) {
        showToast("ההרכב נמחק, אך חלק משריוני החדר לא שוחררו.", "error");
      }
    },
    [
      clearReservationLinkMetadata,
      deleteGroup,
      findLinkedReservationForRehearsal,
      groups,
      isReservationInPast,
      releaseReservation,
      removeLinkedPinsForGroupRehearsal,
      showToast
    ]
  );

  const handleGroupRemoveMember = useCallback(
    async (groupId: string, memberEmail: string) => {
      const group = groups.find((entry) => entry.id === groupId) || null;
      if (!group) return;
      const normalizedMember = memberEmail.trim().toLowerCase();
      if (!normalizedMember) return;
      const affectedRehearsals = (group.rehearsals || []).filter((rehearsal) =>
        rehearsal.participants.some((participant) => participant.email === normalizedMember)
      );
      await removeMember(groupId, normalizedMember);
      await Promise.all(
        affectedRehearsals.map(async (rehearsal) => {
          await removeLinkedPinsForGroupRehearsal([normalizedMember], groupId, rehearsal.id);
        })
      );
    },
    [groups, removeLinkedPinsForGroupRehearsal, removeMember]
  );

  const handleGroupLeave = useCallback(
    async (groupId: string) => {
      const normalizedEmail = (currentUser?.email || "").trim().toLowerCase();
      if (!normalizedEmail) return;
      const group = groups.find((entry) => entry.id === groupId) || null;
      if (!group) return;
      const affectedRehearsals = (group.rehearsals || []).filter((rehearsal) =>
        rehearsal.participants.some((participant) => participant.email === normalizedEmail)
      );
      await leaveGroup(groupId);
      await Promise.all(
        affectedRehearsals.map(async (rehearsal) => {
          await removeLinkedPinsForGroupRehearsal([normalizedEmail], groupId, rehearsal.id);
        })
      );
    },
    [currentUser?.email, groups, leaveGroup, removeLinkedPinsForGroupRehearsal]
  );

  const handleGroupEdit = useCallback(
    async (groupId: string, payload: { name: string; memberEmails: string[] }) => {
      const group = groups.find((entry) => entry.id === groupId) || null;
      if (!group) return;
      const owner = group.ownerEmail.toLowerCase();
      const nextMembers = Array.from(
        new Set(
          payload.memberEmails
            .map((entry) => entry.trim().toLowerCase())
            .filter((entry) => Boolean(entry) && entry !== owner)
        )
      );
      const currentMembers = group.memberEmails
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => Boolean(entry) && entry !== owner);
      const removedMembers = currentMembers.filter((entry) => !nextMembers.includes(entry));
      const affectedRehearsalsByMember = new Map<string, string[]>();
      if (removedMembers.length) {
        const removedSet = new Set(removedMembers);
        (group.rehearsals || []).forEach((rehearsal) => {
          rehearsal.participants.forEach((participant) => {
            const participantEmail = participant.email.trim().toLowerCase();
            if (!removedSet.has(participantEmail)) return;
            const existing = affectedRehearsalsByMember.get(participantEmail) || [];
            affectedRehearsalsByMember.set(participantEmail, [...existing, rehearsal.id]);
          });
        });
      }

      await updateGroup(groupId, { name: payload.name, memberEmails: nextMembers });

      if (!removedMembers.length) return;
      await Promise.all(
        removedMembers.map(async (memberEmail) => {
          const rehearsalIds = affectedRehearsalsByMember.get(memberEmail) || [];
          await Promise.all(
            rehearsalIds.map((rehearsalId) =>
              removeLinkedPinsForGroupRehearsal([memberEmail], groupId, rehearsalId)
            )
          );
        })
      );
    },
    [groups, removeLinkedPinsForGroupRehearsal, updateGroup]
  );

  const handleFinderDateWindowChange = useCallback((startDate: string, endDate: string) => {
    setFinderWindow((prev) => {
      if (prev.startDate === startDate && prev.endDate === endDate) return prev;
      return { startDate, endDate };
    });
  }, []);

  const viewNode = (
    <HomeViewRouter
      view={effectiveView}
      collaborationEnabled={collaborationAvailable}
      rooms={rooms}
      lessons={lessons}
      reservationMap={displayReservationMap}
      roomMeta={roomMeta}
      getLessonsForDate={getLessonsForDate}
      startHour={activeHours.startHour}
      endHour={activeHours.endHour}
      nowMinutes={nowMinutes}
      todayDateKey={todayDateKey}
      todayDayKey={todayDayKey}
      onFinderDateWindowChange={handleFinderDateWindowChange}
      availability={effectiveAvailability}
      groups={collaborationAvailable ? groups : []}
      collaboratorProfiles={collaboratorProfiles}
      finderPolicyMaxDurationMinutes={finderPolicyMaxDurationMinutes}
      finderPolicyMaxDaysForward={finderPolicyMaxDaysForward}
      finderPrefilledGroupId={collaborationAvailable ? finderPrefilledGroupId : ""}
      onFinderSchedule={handleFinderSchedule}
      onCreateGroup={handleCreateGroup}
      myScheduleMode={myScheduleMode}
      onMyScheduleModeChange={setMyScheduleModeSynced}
      myScheduleAgendaDays={myScheduleAgendaDays}
      onMyScheduleAgendaLoadMore={() => setMyScheduleAgendaDays((prev) => prev + 14)}
      pins={myPins}
      onOpenPinned={handleOpenPinned}
      onMyScheduleAddSlot={handleMyScheduleAddSlot}
      onSelectedDateChange={setSelectedDate}
      onAvailabilityDayUpdate={handleAvailabilityDayUpdate}
      availabilityDateOffs={effectiveAvailabilityDateOffs}
      onAvailabilityDateOffToggle={handleAvailabilityDateOffToggle}
      availabilityEditMode={myScheduleAvailabilityEditMode}
      allRooms={allRooms}
      roomMode={roomMode}
      weekDates={weekDates}
      roomDates={roomDates}
      timeSlots={effectiveView === "room" ? scheduleTimeSlots : policyTimeSlots}
      selectedDate={selectedDate}
      selectedDayKey={selectedDayKey}
      selectedRoom={selectedRoom}
      currentUser={currentUser}
      adminMode={effectiveAdminMode}
      onRoomSelect={handleRoomSelect}
      onDateSelect={handleDaySelect}
      onReserve={handleReserve}
      onRelease={handleRelease}
      onEditReservation={handleEditReservation}
      onLessonDetails={handleLessonDetails}
      onSpecialDetails={handleSpecialDetails}
      onExamDetails={handleExamDetails}
      onClosedDetails={handleClosedDetails}
      pendingReservationIds={pendingReservationIds}
      onAdminSlotClick={handleAdminSlotClick}
      onAdminLessonClick={handleAdminLessonClick}
      onAdminReservationClick={handleAdminReservationClick}
      onReservationClick={handleReservationDetails}
      onNavigatePrev={handlePrev}
      onNavigateNext={handleNext}
      currentEmail={(currentUser?.email || "").toLowerCase()}
      directoryUsers={users}
	      pendingInvites={collaborationAvailable ? pendingInvites : []}
	      onGroupCreate={handleCreateGroup}
	      onGroupInvite={(groupId, email) => { void inviteToGroup(groupId, email); }}
	      onGroupInviteResponse={(groupId, accept) => { void respondToInvite(groupId, accept); }}
	      onGroupRename={(groupId, name) => { void renameGroup(groupId, name); }}
      onGroupEdit={(groupId, payload) => { void handleGroupEdit(groupId, payload); }}
      onGroupDelete={(groupId) => { void handleDeleteGroup(groupId); }}
      onGroupLeave={(groupId) => { void handleGroupLeave(groupId); }}
      onGroupRemoveMember={(groupId, email) => { void handleGroupRemoveMember(groupId, email); }}
      onAddGroupRehearsal={(groupId, rehearsal) => { void upsertGroupRehearsalWithLinkedReservation(groupId, rehearsal); }}
      onDeleteGroupRehearsal={(groupId, rehearsalId, options) => { void handleDeleteGroupRehearsal(groupId, rehearsalId, options); }}
      onRespondToGroupRehearsal={(groupId, rehearsalId, status) => { void handleRespondToGroupRehearsal(groupId, rehearsalId, status); }}
      getAvailableRoomsForSlot={getAvailableRoomsForSlot}
      policyDayKeys={policyDayKeys}
      policyWindows={policyWindows}
      roomZoomResetToken={roomZoomResetToken}
      myScheduleZoomResetToken={myScheduleZoomResetToken}
      onOpenFinderForGroup={(groupId) => {
        if (!collaborationAvailable) return;
        setFinderPrefilledGroupId(groupId);
        onViewChange("finder");
      }}
	      onGroupsTopBarChange={setGroupsTopBarContext}
	      finderResetToken={finderViewResetToken}
	      groupsResetToken={groupsViewResetToken}
	    />
	  );

  const scheduleView = effectiveView === "room";

  const pendingReleaseEntry = pendingRelease
    ? (reservationMap[pendingRelease.dateKey] || []).find((entry) => entry.id === pendingRelease.reservationId)
    : null;
  const pendingReleaseIsLinked = Boolean(pendingRelease?.linkedGroupId && pendingRelease?.linkedRehearsalId);
  const releaseRoomName = pendingReleaseEntry
    ? rooms.find((room) => room.id === pendingReleaseEntry.roomId)?.name || pendingReleaseEntry.roomId
    : "";
  const releaseDayLabel = pendingRelease
    ? weekDays.find((day) => day.key === getDayKeyFromDateKey(pendingRelease.dateKey))?.label || ""
    : "";
  const releaseDateLine = pendingRelease
    ? `יום ${releaseDayLabel} ${formatShortDate(pendingRelease.dateKey)}`
    : "";
  const releaseTimeLine = pendingReleaseEntry
    ? `בין ${formatMinutes(pendingReleaseEntry.time)}-` +
      `${formatMinutes(pendingReleaseEntry.time + pendingReleaseEntry.durationMinutes)} · ` +
      `${formatDurationLabelHe(pendingReleaseEntry.durationMinutes)}`
    : "";
  const pendingLinkedEditEntry = pendingLinkedEdit
    ? (reservationMap[pendingLinkedEdit.dateKey] || []).find((entry) => entry.id === pendingLinkedEdit.reservationId)
    : null;
  const pendingLinkedEditRoomName = pendingLinkedEditEntry
    ? rooms.find((room) => room.id === pendingLinkedEditEntry.roomId)?.name || pendingLinkedEditEntry.roomId
    : "";
  const pendingLinkedEditDayLabel = pendingLinkedEdit
    ? weekDays.find((day) => day.key === getDayKeyFromDateKey(pendingLinkedEdit.dateKey))?.label || ""
    : "";
  const pendingLinkedEditDateLine = pendingLinkedEdit
    ? `יום ${pendingLinkedEditDayLabel} ${formatShortDate(pendingLinkedEdit.dateKey)}`
    : "";
  const pendingLinkedEditTimeLine = pendingLinkedEditEntry
    ? `בין ${formatMinutes(pendingLinkedEditEntry.time)}-` +
      `${formatMinutes(pendingLinkedEditEntry.time + pendingLinkedEditEntry.durationMinutes)} · ` +
      `${formatDurationLabelHe(pendingLinkedEditEntry.durationMinutes)}`
    : "";

  const detailsReservation = reservationDetails?.reservation || null;
  useEffect(() => {
    const email = (detailsReservation?.reservedEmail || "").trim().toLowerCase();
    if (!email) {
      setDetailsContact(null);
      return;
    }
    const nameFromReservation = (detailsReservation?.reservedBy || "").trim();
    const phoneFromReservation = (detailsReservation?.reservedPhone || "").trim();
    const pictureFromReservation = (detailsReservation?.reservedPicture || "").trim();

    const cached = contactCacheRef.current.get(email);
    if (cached) {
      const merged = {
        ...cached,
        ...(nameFromReservation ? { name: nameFromReservation } : {}),
        ...(phoneFromReservation ? { phone: phoneFromReservation } : {}),
        ...(pictureFromReservation ? { pictureUrl: pictureFromReservation } : {})
      };
      setDetailsContact(merged);
      return;
    }

    // Prefer contact info stored on the reservation itself (no extra reads), but still
    // allow a single user-doc read to backfill a missing picture URL.
    if (phoneFromReservation && pictureFromReservation) {
      const contact = {
        name: nameFromReservation,
        phone: phoneFromReservation,
        pictureUrl: pictureFromReservation
      };
      contactCacheRef.current.set(email, contact);
      setDetailsContact(contact);
      return;
    }
    if (phoneFromReservation) {
      // Show the phone immediately, then try to backfill the picture from the users directory.
      setDetailsContact({ name: nameFromReservation, phone: phoneFromReservation });
    }
    if (!db) {
      setDetailsContact(null);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, "users", email))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setDetailsContact(phoneFromReservation ? { name: nameFromReservation, phone: phoneFromReservation } : null);
          return;
        }
        const data = snap.data() as Record<string, unknown>;
        const phone =
          typeof data.phone === "string"
            ? data.phone
            : typeof data.phoneNumber === "string"
              ? data.phoneNumber
              : typeof data.phone_number === "string"
                ? data.phone_number
                : typeof data.mobile === "string"
                  ? data.mobile
                  : typeof data.tel === "string"
                    ? data.tel
                    : "";
        const pictureUrl =
          typeof data.pictureUrl === "string"
            ? data.pictureUrl
            : typeof data.picture === "string"
              ? data.picture
              : typeof data.photoURL === "string"
                ? data.photoURL
                : typeof data.photoUrl === "string"
                  ? data.photoUrl
                  : "";
        const contact = {
          name: typeof data.name === "string" ? data.name : nameFromReservation,
          phone: phoneFromReservation || phone,
          ...(pictureUrl ? { pictureUrl } : {})
        };
        contactCacheRef.current.set(email, contact);
        setDetailsContact(contact);
      })
      .catch(() => {
        if (cancelled) return;
        setDetailsContact(phoneFromReservation ? { name: nameFromReservation, phone: phoneFromReservation } : null);
      });
    return () => {
      cancelled = true;
    };
  }, [detailsReservation?.reservedEmail]);

  const detailsRoomName = detailsReservation
    ? rooms.find((room) => room.id === detailsReservation.roomId)?.name || detailsReservation.roomId
    : "";
  const detailsDayLabel = reservationDetails
    ? weekDays.find((day) => day.key === getDayKeyFromDateKey(reservationDetails.dateKey))?.label || ""
    : "";
  const detailsDateLine = reservationDetails
    ? `יום ${detailsDayLabel} ${formatShortDate(reservationDetails.dateKey)}`
    : "";
  const detailsDuration = detailsReservation?.durationMinutes || 60;
  const detailsTimeLine = detailsReservation
    ? `בין ${formatMinutes(detailsReservation.time)}-` +
      `${formatMinutes(detailsReservation.time + detailsDuration)} · ` +
      `${formatDurationLabelHe(detailsDuration)}`
    : "";
  const detailsIsMine = Boolean(
    currentUser &&
      detailsReservation &&
      detailsReservation.reservedEmail &&
      currentUser.email.toLowerCase() === detailsReservation.reservedEmail.toLowerCase()
  );
  const detailsPrivateDescription = detailsIsMine ? (detailsReservation?.privateDescription || "").trim() : "";
  const detailsName = detailsReservation?.reservedBy || detailsContact?.name || "";
  const detailsEmail = detailsReservation?.reservedEmail || "";
  const detailsPhone = detailsReservation?.reservedPhone || detailsContact?.phone || "";
  const detailsPictureUrl = (() => {
    const directoryUrl = (detailsContact?.pictureUrl || "").trim();
    const reservedUrl = (detailsReservation?.reservedPicture || "").trim();
    if (directoryUrl && isFirebaseStorageDownloadUrl(directoryUrl)) return directoryUrl;
    if (reservedUrl && isFirebaseStorageDownloadUrl(reservedUrl)) return reservedUrl;

    // Avoid hotlinking Google profile images for other users; it frequently 429s under even light usage.
    // We'll show initials until the user's Storage-cached photo is available.
    if (directoryUrl && isGoogleUserContentUrl(directoryUrl)) return "";
    if (reservedUrl && isGoogleUserContentUrl(reservedUrl)) return "";

    return (
      directoryUrl ||
      reservedUrl ||
      (currentUser && detailsEmail && currentUser.email.toLowerCase() === detailsEmail.toLowerCase()
        ? (currentUser.picture || "")
        : "")
    );
  })();
  const reservationPinned = detailsReservation
    ? isPinned({
        kind: "reservation",
        dateKey: detailsReservation.date,
        roomId: detailsReservation.roomId,
        startMinutes: detailsReservation.time,
        durationMinutes: detailsDuration
      })
    : false;
  const linkedBlockPin = blockDetails
    ? collaborationAvailable
      ? myPins.find(
          (pin) =>
            pin.dateKey === blockDetails.dateKey &&
            pin.roomId === blockDetails.roomId &&
            pin.startMinutes === blockDetails.startMinutes &&
            pin.durationMinutes === blockDetails.durationMinutes &&
            pin.kind === blockDetails.kind &&
            Boolean(pin.linkedGroupId && pin.linkedRehearsalId)
        ) || null
      : null
    : null;
  const linkedBlockIds = linkedBlockPin
    ? { groupId: linkedBlockPin.linkedGroupId || "", rehearsalId: linkedBlockPin.linkedRehearsalId || "" }
    : null;
  const linkedBlockCurrentStatus = linkedBlockPin?.rehearsalStatus || "pending";
  const blockDetailsRoomName = blockDetails
    ? blockDetails.roomId === PERSONAL_PIN_ROOM_ID
      ? "אישי"
      : rooms.find((room) => room.id === blockDetails.roomId)?.name || blockDetails.roomId
    : "";
  const pendingConfirmReservation =
    pendingConfirm?.mode === "edit" && pendingConfirm.reservationId
      ? (displayReservationMap[pendingConfirm.request.date] || []).find(
          (entry) => entry.id === pendingConfirm.reservationId
        ) || null
      : null;
  const pendingConfirmLinkedIds = pendingConfirmReservation
    ? collaborationAvailable
      ? extractLinkedIdsFromReservation(pendingConfirmReservation)
      : null
    : null;
  const pendingConfirmLinkedGroupName = pendingConfirmLinkedIds
    ? groups.find((group) => group.id === pendingConfirmLinkedIds.groupId)?.name || "ללא שם"
    : undefined;
  const effectivePendingFinderAutoLink = pendingFinderAutoLinkRef.current || pendingFinderAutoLink;

  return (
    <div className={`booking-shell${scheduleView ? " schedule-view" : ""}`}>
      <div
        className={`view-shell${dayTransition ? ` day-transition-${dayTransition}` : ""}`}
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget) return;
          if (!dayTransition) return;
          setDayTransition("");
        }}
      >
        {viewNode}
      </div>
      {toast ? (
        <div
          className={`home-toast${toast.tone === "error" ? " error" : toast.tone === "success" ? " success" : ""}`}
          style={{ bottom: hasNav ? "calc(18px + env(safe-area-inset-bottom) + 74px)" : "calc(18px + env(safe-area-inset-bottom))" }}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      ) : null}
      {pendingConfirm ? (
        <ReserveConfirmOverlay
          open
          title={pendingConfirm.mode === "edit" ? "עריכת שריון" : "שריון חדר"}
          room={rooms.find((room) => room.id === pendingConfirm.request.roomId)?.name || ""}
          dateLine={`יום ${weekDays.find((day) => day.key === pendingConfirm.request.day)?.label || ""} ` +
            `${formatShortDate(pendingConfirm.request.date)}`}
          request={pendingConfirm.request}
          limitEnd={pendingConfirm.limitEnd}
          startMinutes={pendingConfirm.startMinutes}
          windowStart={pendingConfirm.windowStart}
          initialDuration={pendingConfirm.durationMinutes}
          initialPrivateDescription={pendingConfirm.privateDescription}
          userRemainingMinutes={pendingConfirm.userRemainingMinutes}
          limitHoursPerRoomPerDay={pendingConfirm.limitHoursPerRoomPerDay}
          limitHoursPerRoomPerWeek={pendingConfirm.limitHoursPerRoomPerWeek}
          limitHoursPerDayTotal={pendingConfirm.limitHoursPerDayTotal}
          limitHoursPerWeekTotal={pendingConfirm.limitHoursPerWeekTotal}
          limitMaxDaysForward={pendingConfirm.limitMaxDaysForward}
          quotaUsage={pendingConfirm.quotaUsage}
          groupOptions={reservationGroupOptions}
          directoryUsers={users}
          currentEmail={currentUser?.email}
          onCreateGroup={handleCreateGroup}
          linkedGroupName={pendingConfirmLinkedGroupName}
          initialLinkToGroup={collaborationAvailable && Boolean(effectivePendingFinderAutoLink?.groupId)}
          initialGroupId={collaborationAvailable ? (effectivePendingFinderAutoLink?.groupId || "") : ""}
          mode={pendingConfirm.mode}
          onRelease={
            pendingConfirm.mode === "edit" && pendingConfirm.reservationId
              ? () => {
                  handleRelease(pendingConfirm.request.date, pendingConfirm.reservationId!);
                  setPendingConfirm(null);
                }
              : undefined
          }
          onConfirm={(startMinutes, durationMinutes, privateDescription, linkedGroupId, rehearsalName) => {
            void (async () => {
              if (pendingConfirm.mode === "edit") {
                const updatedReservation = await handleConfirmEdit(
                  pendingConfirm,
                  startMinutes,
                  durationMinutes,
                  privateDescription
                );
                if (
                  updatedReservation &&
                  collaborationAvailable &&
                  linkedGroupId &&
                  !extractLinkedIdsFromReservation(updatedReservation)
                ) {
                  await createLinkedRehearsalFromReservation(updatedReservation, linkedGroupId, rehearsalName);
                }
                return;
              }
              const autoLinkedGroupId = effectivePendingFinderAutoLink?.groupId;
              const createdReservation = await handleConfirmReserve(
                pendingConfirm.request,
                startMinutes,
                durationMinutes,
                privateDescription
              );
              if (!createdReservation) return;
              const targetLinkedGroupId = collaborationAvailable ? (linkedGroupId || autoLinkedGroupId) : "";
              if (targetLinkedGroupId) {
                await createLinkedRehearsalFromReservation(
                  createdReservation,
                  targetLinkedGroupId,
                  rehearsalName
                );
              }
              setPendingFinderAutoLinkSynced(null);
            })();
          }}
          onClose={() => {
            setPendingConfirm(null);
            if (collaborationAvailable) {
              setPendingFinderAutoLinkSynced(null);
            }
          }}
        />
      ) : null}
      {myScheduleAddDraft ? (
        <MyScheduleAddOverlay
          open
          dateLine={`יום ${weekDays.find((day) => day.key === myScheduleAddDraft.request.day)?.label || ""} ` +
            `${formatShortDate(myScheduleAddDraft.request.date)}`}
          timeLine={`החל מ-${formatMinutes(myScheduleAddDraft.request.time)}`}
          roomOptions={myScheduleAddDraft.roomOptions}
          onContinueReservation={(roomId) => {
            const request: ReserveRequest = {
              ...myScheduleAddDraft.request,
              roomId,
              durationMinutes: 60
            };
            setMyScheduleAddDraft(null);
            handleReserve(request);
          }}
          onAddPersonalBlock={(note) => {
            if (!currentUser?.email) {
              setAuthError("יש להתחבר כדי להוסיף בלוק אישי.");
              return;
            }
            togglePin({
              kind: "closed",
              dateKey: myScheduleAddDraft.request.date,
              roomId: PERSONAL_PIN_ROOM_ID,
              startMinutes: myScheduleAddDraft.request.time,
              durationMinutes: 60,
              title: note || "חסום אישי",
              meta: ""
            });
            setMyScheduleAddDraft(null);
          }}
          onClose={() => setMyScheduleAddDraft(null)}
        />
      ) : null}
      <ReservationDetailsOverlay
        open={Boolean(reservationDetails)}
        title="פרטי שריון"
        room={detailsRoomName}
        dateLine={detailsDateLine}
        timeLine={detailsTimeLine}
        name={detailsName}
        email={detailsEmail}
        phone={detailsPhone}
        pictureUrl={detailsPictureUrl || undefined}
        privateDescription={detailsPrivateDescription || undefined}
        pinned={reservationPinned}
        onTogglePin={
          detailsReservation && currentUser?.email
            ? () => togglePin({
                kind: "reservation",
                dateKey: reservationDetails?.dateKey || detailsReservation.date,
                roomId: detailsReservation.roomId,
                startMinutes: detailsReservation.time,
                durationMinutes: detailsDuration,
                title: "שמור",
                meta: detailsName,
                reservedEmail: detailsEmail
              })
            : undefined
        }
        onClose={() => setReservationDetails(null)}
      />
      <BlockDetailsOverlay
        open={Boolean(blockDetails)}
        title={
          blockDetails?.kind === "lesson"
            ? (blockDetails.title || "שיעור")
            : blockDetails?.kind === "special"
              ? (blockDetails.title || "אירוע")
              : blockDetails?.kind === "exam"
                ? (blockDetails.title || "מבחן")
                : (blockDetails?.title || "סגירה")
        }
        room={
          blockDetails
            ? blockDetails.kind === "lesson"
              ? [blockDetails.meta || "ללא מרצה", blockDetailsRoomName].filter(Boolean).join(" · ")
              : blockDetailsRoomName
            : ""
        }
        dateLine={
          blockDetails
            ? `יום ${weekDays.find((day) => day.key === getDayKeyFromDateKey(blockDetails.dateKey))?.label || ""} ${formatShortDate(blockDetails.dateKey)}`
            : ""
        }
        timeLine={
          blockDetails
            ? `בין ${formatMinutes(blockDetails.startMinutes)}-${formatMinutes(blockDetails.startMinutes + blockDetails.durationMinutes)} · ` +
              `${formatDurationLabelHe(blockDetails.durationMinutes)}`
            : ""
        }
        lines={
          blockDetails?.kind === "lesson"
            ? []
            : [
                { label: blockDetails?.kind === "special" ? "אירוע" : "סגירה", value: blockDetails?.title || "" }
              ]
        }
        pinned={
          Boolean(
            blockDetails &&
              isPinned({
                kind: blockDetails.kind,
                dateKey: blockDetails.dateKey,
                lessonId: blockDetails.kind === "lesson" ? blockDetails.lessonId : undefined,
                roomId: blockDetails.roomId,
                startMinutes: blockDetails.startMinutes,
                durationMinutes: blockDetails.durationMinutes
              })
          )
        }
        onTogglePin={
          blockDetails && currentUser?.email
            ? () => {
                if (blockDetails.kind === "lesson") {
                  void toggleAssociatedLessonPins({
                    lessonId: blockDetails.lessonId,
                    dateKey: blockDetails.dateKey,
                    roomId: blockDetails.roomId,
                    startMinutes: blockDetails.startMinutes,
                    durationMinutes: blockDetails.durationMinutes,
                    title: blockDetails.title,
                    meta: blockDetails.meta
                  });
                  return;
                }
                void togglePin({
                  kind: blockDetails.kind,
                  dateKey: blockDetails.dateKey,
                  roomId: blockDetails.roomId,
                  startMinutes: blockDetails.startMinutes,
                  durationMinutes: blockDetails.durationMinutes,
                  title: blockDetails.title,
                  meta: blockDetails.meta
                });
              }
            : undefined
        }
        actions={
          linkedBlockIds
            ? [
                {
                  label: "אישור",
                  tone: linkedBlockCurrentStatus === "approved" ? "primary" : "secondary",
                  onClick: () => {
                    setBlockDetails(null);
                    void handleRespondToGroupRehearsal(linkedBlockIds.groupId, linkedBlockIds.rehearsalId, "approved");
                  }
                },
                {
                  label: "דחייה",
                  tone: linkedBlockCurrentStatus === "declined" ? "danger" : "secondary",
                  onClick: () => {
                    setBlockDetails(null);
                    void handleRespondToGroupRehearsal(linkedBlockIds.groupId, linkedBlockIds.rehearsalId, "declined");
                  }
                }
              ]
            : []
        }
        onClose={() => setBlockDetails(null)}
      />
      {pendingReleaseIsLinked ? (
        <BlockDetailsOverlay
          open={Boolean(pendingRelease)}
          title="שחרור חדר מחזרה מקושרת"
          room={releaseRoomName}
          dateLine={releaseDateLine}
          timeLine={releaseTimeLine}
          lines={[{ label: "פעולה נדרשת", value: "איך לעדכן את החזרה המקושרת?" }]}
          actions={[
            {
              label: "עדכון חזרה ללא חדר",
              tone: "primary",
              onClick: () => {
                if (!pendingRelease?.linkedGroupId || !pendingRelease.linkedRehearsalId) return;
                void (async () => {
                  if (!canReleaseReservationNow(pendingReleaseEntry)) return;
                  const ok = await releaseReservation(pendingRelease.dateKey, pendingRelease.reservationId);
                  if (!ok) {
                    showToast("שחרור נכשל (בדוק הגדרות Firestore).", "error");
                    return;
                  }
                  await unlinkRehearsalRoomFromReservation(
                    pendingRelease.linkedGroupId,
                    pendingRelease.linkedRehearsalId
                  );
                  setPendingRelease(null);
                })();
              }
            },
            {
              label: "מחיקת החזרה",
              tone: "danger",
              onClick: () => {
                if (!pendingRelease?.linkedGroupId || !pendingRelease.linkedRehearsalId) return;
                void (async () => {
                  if (!canReleaseReservationNow(pendingReleaseEntry)) return;
                  const ok = await releaseReservation(pendingRelease.dateKey, pendingRelease.reservationId);
                  if (!ok) {
                    showToast("שחרור נכשל (בדוק הגדרות Firestore).", "error");
                    return;
                  }
                  await handleDeleteGroupRehearsal(
                    pendingRelease.linkedGroupId,
                    pendingRelease.linkedRehearsalId,
                    { releaseLinkedReservation: false }
                  );
                  setPendingRelease(null);
                })();
              }
            }
          ]}
          onClose={() => setPendingRelease(null)}
        />
      ) : (
        <ConfirmOverlay
          open={Boolean(pendingRelease)}
          title="שחרור חדר"
          room={releaseRoomName}
          dateLine={releaseDateLine}
          timeLine={releaseTimeLine}
          confirmLabel="שחרור"
          cancelLabel="ביטול"
          onConfirm={() => {
            if (!pendingRelease) return;
            void (async () => {
              if (!canReleaseReservationNow(pendingReleaseEntry)) return;
              const ok = await releaseReservation(pendingRelease.dateKey, pendingRelease.reservationId);
              if (!ok) {
                showToast("שחרור נכשל (בדוק הגדרות Firestore).", "error");
                return;
              }
              setPendingRelease(null);
            })();
          }}
          onClose={() => setPendingRelease(null)}
        />
      )}
      <ConfirmOverlay
        open={Boolean(pendingLinkedEdit)}
        title="השריון מקושר לחזרה. שינוי השריון יעדכן גם את החזרה."
        room={pendingLinkedEditRoomName}
        dateLine={pendingLinkedEditDateLine}
        timeLine={pendingLinkedEditTimeLine}
        confirmLabel="המשך"
        cancelLabel="ביטול"
        onConfirm={() => {
          if (!pendingLinkedEdit) return;
          baseHandleEditReservation(pendingLinkedEdit.dateKey, pendingLinkedEdit.reservationId);
          setPendingLinkedEdit(null);
        }}
        onClose={() => setPendingLinkedEdit(null)}
      />
      <ConfirmOverlay
        open={Boolean(pendingRehearsalResponse)}
        title="לשנות את תשובתך לחזרה?"
        confirmLabel="כן"
        cancelLabel="לא"
        onConfirm={() => {
          if (!pendingRehearsalResponse) return;
          void applyRehearsalResponse(
            pendingRehearsalResponse.groupId,
            pendingRehearsalResponse.rehearsalId,
            pendingRehearsalResponse.status
          );
          setPendingRehearsalResponse(null);
        }}
        onClose={() => setPendingRehearsalResponse(null)}
      />
      <AdminEditOverlay
        draft={adminDraft}
        rooms={rooms}
        weekDays={weekDays}
        users={users}
        canSave={effectiveAdminMode}
        error={adminError}
        collisionPending={Boolean(collisionConfirm)}
        onClose={() => setAdminDraft(null)}
        setDraft={setAdminDraft}
        onSwitchType={switchAdminType}
        onDeleteLesson={() => { void handleAdminDeleteLesson(); }}
        onDeleteReservation={handleAdminDeleteReservation}
        onSave={handleAdminSave}
      />
    </div>
  );
}
