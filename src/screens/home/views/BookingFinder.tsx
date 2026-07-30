import { useEffect, useMemo, useState } from "react";
import { gradeLabelFromCohort } from "../../../lib/academics";
import { addDays, formatDateKey, formatShortDate, getDayKeyFromDateKey, parseDateKey } from "../../../lib/date";
import { formatDurationLabelHe } from "../../../lib/formatDurationHe";
import { getAvailabilityWindowForDate } from "../../../lib/collaboration";
import { normalizeEmailList } from "../../../lib/quotaUsage";
import {
  buildReservationPolicyWindowsForDays,
  getReservationPolicyDayKeys,
  getReservationPolicyWindowsForDay
} from "../../../lib/reservationPolicyWindows";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import { AddIcon, ChevronLeftIcon, CloseIcon, GroupsIcon, MicIcon, RemoveIcon, RoomIcon, ScheduleIcon, TuneIcon, UserIcon } from "../../../components/Icons";
import GroupCreateOverlay from "../components/GroupCreateOverlay";
import { allWeekDays, defaultWeekDayKeys } from "../../../config";
import type { ReservationPolicyWindow } from "../../../lib/reservationPolicyWindows";
import type { DirectoryUser, RoomMeta } from "../../../types/admin";
import type { AvailabilityDateOffs, CollaborationGroup, CollaboratorEvent, UserAvailability } from "../../../types/collaboration";
import type { ReservationMap } from "../../../types/reservations";
import type { DayKey, Lesson, Room } from "../../../types/schedule";

export type BookingFinderProps = {
  rooms: Room[];
  lessons: Lesson[];
  reservationMap: ReservationMap;
  startHour: number;
  endHour: number;
  roomMeta?: Record<string, RoomMeta>;
  getLessonsForDate?: (dateKey: string, dayKey: DayKey) => Lesson[];
  onOpenSchedule: (roomId: string, dateKey: string) => void;
  onDateWindowChange?: (startDate: string, endDate: string) => void;
  availability: UserAvailability;
  groups: CollaborationGroup[];
  directoryUsers: DirectoryUser[];
  collaborators: Array<{
    email: string;
    name: string;
    availability: UserAvailability;
    dateOffs?: AvailabilityDateOffs;
    events: CollaboratorEvent[];
  }>;
  currentEmail?: string;
  collaborationEnabled?: boolean;
  policyMaxDurationMinutes?: number;
  policyMaxDaysForward?: number;
  policyDayKeys?: DayKey[];
  policyWindows?: ReservationPolicyWindow[];
  prefilledGroupId?: string;
  prefilledPeopleEmails?: string[];
  isActive?: boolean;
  resetToken?: number;
  onCreateGroup?: (name: string, participantEmails?: string[]) => Promise<string | void> | string | void;
  onSchedule: (selection: {
    dateKey: string;
    dayKey: DayKey;
    startMinutes: number;
    endMinutes: number;
    preferredDurationMinutes?: number;
    roomId?: string;
    groupId?: string;
    mode: { findCommonTime: boolean; findRoom: boolean };
    participantEmails: string[];
  }) => void;
};

type FinderResult = {
  date: string;
  day: DayKey;
  groupId?: string;
  roomId?: string;
  roomName?: string;
  roomCount?: number;
  outsidePolicyWindow?: boolean;
  roomOptions?: FinderRoomOption[];
  start: number;
  end: number;
  participantsCount: number;
  participantEmails: string[];
};

type FinderRoomOption = {
  roomId: string;
  roomName: string;
  groupId?: string;
  start: number;
  end: number;
  participantsCount: number;
  participantEmails: string[];
  outsidePolicyWindow: boolean;
};

type TimeInterval = { start: number; end: number };
type FinderTargetType = "group" | "people" | "self" | "";
const DURATION_STEP_MINUTES = 30;
const DEFAULT_SELF_DURATION_MINUTES = 60;
const DEFAULT_GROUP_DURATION_MINUTES = 120;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_KEY_TO_CALENDAR_DAY: Record<DayKey, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6
};

const subtractBusyFromWindow = (
  window: { start: number; end: number },
  busy: Array<{ start: number; end: number }>
) => {
  const free: Array<{ start: number; end: number }> = [];
  let cursor = window.start;
  busy.forEach((entry) => {
    if (entry.end <= cursor) return;
    if (entry.start > cursor) {
      free.push({ start: cursor, end: Math.min(entry.start, window.end) });
    }
    cursor = Math.max(cursor, entry.end);
  });
  if (cursor < window.end) {
    free.push({ start: cursor, end: window.end });
  }
  return free.filter((entry) => entry.end > entry.start);
};

const arrayShallowEqual = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
};

const hasSameIds = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
};

const memberYearSubtitle = (user: DirectoryUser) => {
  const grade = gradeLabelFromCohort(user.cohortStartYear);
  if (grade === "א" || grade === "ב" || grade === "ג") return `שנה ${grade}׳`;
  if (grade === "בוגר") return "בוגר/ת";
  return "צוות";
};

const intervalCovers = (intervals: TimeInterval[], start: number, end: number) =>
  intervals.some((interval) => interval.start <= start && interval.end >= end);

const intersectSearchWindows = (
  windows: ReservationPolicyWindow[],
  filterStartMinutes: number,
  filterEndMinutes: number
): TimeInterval[] =>
  windows
    .map((window) => ({
      start: Math.max(filterStartMinutes, window.startMinutes),
      end: Math.min(filterEndMinutes, window.endMinutes)
    }))
    .filter((window) => window.end > window.start);

const collectGroupCandidateWindows = (
  baseWindow: TimeInterval,
  participantFreeWindows: Array<{ email: string; free: TimeInterval[] }>,
  minGapMinutes: number,
  requiredEmail?: string
) => {
  const boundaries = new Set<number>([baseWindow.start, baseWindow.end]);
  participantFreeWindows.forEach(({ free }) => {
    free.forEach((interval) => {
      const start = Math.max(baseWindow.start, interval.start);
      const end = Math.min(baseWindow.end, interval.end);
      if (end <= start) return;
      boundaries.add(start);
      boundaries.add(end);
    });
  });
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
  if (sortedBoundaries.length < 2) return [] as Array<{ start: number; end: number; participantEmails: string[] }>;

  const rawSegments: Array<{ start: number; end: number; participantEmails: string[] }> = [];
  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const segmentStart = sortedBoundaries[index];
    const segmentEnd = sortedBoundaries[index + 1];
    if (segmentEnd <= segmentStart) continue;
    const participantEmails = participantFreeWindows
      .filter((entry) => intervalCovers(entry.free, segmentStart, segmentEnd))
      .map((entry) => entry.email);
    if (!participantEmails.length) continue;
    if (requiredEmail && !participantEmails.includes(requiredEmail)) continue;
    rawSegments.push({ start: segmentStart, end: segmentEnd, participantEmails });
  }

  if (!rawSegments.length) return [] as Array<{ start: number; end: number; participantEmails: string[] }>;

  const mergedSegments: Array<{ start: number; end: number; participantEmails: string[] }> = [];
  rawSegments.forEach((segment) => {
    const last = mergedSegments[mergedSegments.length - 1];
    if (
      last &&
      last.end === segment.start &&
      arrayShallowEqual(last.participantEmails, segment.participantEmails)
    ) {
      last.end = segment.end;
      return;
    }
    mergedSegments.push({ ...segment, participantEmails: [...segment.participantEmails] });
  });

  return mergedSegments
    .map((segment) => {
      const alignedStart = Math.ceil(segment.start / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES;
      const alignedEnd = Math.floor(segment.end / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES;
      return { ...segment, start: alignedStart, end: alignedEnd };
    })
    .filter((segment) => segment.end > segment.start && segment.end - segment.start >= minGapMinutes);
};

export default function BookingFinder({
  rooms,
  lessons,
  reservationMap,
  startHour,
  endHour,
  roomMeta,
  getLessonsForDate,
  onOpenSchedule,
  onDateWindowChange,
  availability,
  groups,
  directoryUsers,
  collaborators,
  currentEmail,
  collaborationEnabled = true,
  policyMaxDurationMinutes,
  policyMaxDaysForward,
  policyDayKeys = defaultWeekDayKeys,
  policyWindows = [],
  prefilledGroupId,
  prefilledPeopleEmails = [],
  isActive = true,
  resetToken,
  onCreateGroup,
  onSchedule
}: BookingFinderProps) {
  const normalizedPrefilledPeopleEmails = useMemo(
    () => normalizeEmailList(prefilledPeopleEmails),
    [prefilledPeopleEmails]
  );
  const [targetType, setTargetType] = useState<FinderTargetType>(
    collaborationEnabled
      ? prefilledGroupId
        ? "group"
        : normalizedPrefilledPeopleEmails.length
          ? "people"
          : ""
      : "self"
  );
  const [placeType, setPlaceType] = useState<"room" | "noRoom" | "">(collaborationEnabled ? "" : "room");
  const [useWeekdaysFilter, setUseWeekdaysFilter] = useState(false);
  const [useHoursFilter, setUseHoursFilter] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([]);
  const [fromHour, setFromHour] = useState(startHour);
  const [toHour, setToHour] = useState(endHour);
  const [durationMinutes, setDurationMinutes] = useState<number>(
    prefilledGroupId ? DEFAULT_GROUP_DURATION_MINUTES : DEFAULT_SELF_DURATION_MINUTES
  );
  const [durationTouched, setDurationTouched] = useState(false);
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [roomSelectionTouched, setRoomSelectionTouched] = useState(false);
  const [showSpecificRoomsList, setShowSpecificRoomsList] = useState(false);
  const [placePickerOpen, setPlacePickerOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  const [selectedGroupId, setSelectedGroupId] = useState(prefilledGroupId || "");
  const [selectedPeopleEmails, setSelectedPeopleEmails] = useState<string[]>(normalizedPrefilledPeopleEmails);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groupPickerSearch, setGroupPickerSearch] = useState("");
  const [roomChoiceResult, setRoomChoiceResult] = useState<FinderResult | null>(null);
  const [createGroupOverlayOpen, setCreateGroupOverlayOpen] = useState(false);
  const [createGroupPendingName, setCreateGroupPendingName] = useState("");
  const [minParticipantsFilterOn, setMinParticipantsFilterOn] = useState(false);
  const [minParticipants, setMinParticipants] = useState(1);
  const findCommonTime = collaborationEnabled && (targetType === "group" || targetType === "people");
  const findPeopleTime = collaborationEnabled && targetType === "people";
  const findRoom = placeType === "room";

  useEffect(() => {
    if (!resetToken) return;
    const hasPrefilledGroup = collaborationEnabled && Boolean(prefilledGroupId);
    const hasPrefilledPeople = collaborationEnabled && !hasPrefilledGroup && normalizedPrefilledPeopleEmails.length > 0;
    setTargetType(hasPrefilledGroup ? "group" : hasPrefilledPeople ? "people" : collaborationEnabled ? "" : "self");
    setPlaceType(hasPrefilledGroup || hasPrefilledPeople ? "room" : collaborationEnabled ? "" : "room");
    setUseWeekdaysFilter(false);
    setUseHoursFilter(false);
    setAdvancedFiltersOpen(false);
    setSelectedWeekdays([]);
    setFromHour(startHour);
    setToHour(endHour);
    setDurationMinutes(hasPrefilledGroup ? DEFAULT_GROUP_DURATION_MINUTES : DEFAULT_SELF_DURATION_MINUTES);
    setDurationTouched(false);
    setSelectedRooms([]);
    setRoomSelectionTouched(false);
    setShowSpecificRoomsList(false);
    setPlacePickerOpen(false);
    setVisibleCount(20);
    setSelectedGroupId(prefilledGroupId || "");
    setSelectedPeopleEmails(hasPrefilledPeople ? normalizedPrefilledPeopleEmails : []);
    setGroupPickerOpen(false);
    setGroupPickerSearch("");
    setRoomChoiceResult(null);
    setCreateGroupOverlayOpen(false);
    setCreateGroupPendingName("");
    setMinParticipantsFilterOn(false);
    setMinParticipants(1);
  }, [collaborationEnabled, endHour, normalizedPrefilledPeopleEmails, prefilledGroupId, resetToken, startHour]);

  useEffect(() => {
    if (!collaborationEnabled) return;
    if (!prefilledGroupId) return;
    setTargetType("group");
    setSelectedGroupId(prefilledGroupId);
    setSelectedPeopleEmails([]);
    setPlaceType("room");
    setRoomSelectionTouched(false);
    setShowSpecificRoomsList(false);
    setPlacePickerOpen(false);
  }, [collaborationEnabled, prefilledGroupId]);

  useEffect(() => {
    if (!collaborationEnabled) return;
    if (!normalizedPrefilledPeopleEmails.length) return;
    if (prefilledGroupId) return;
    setTargetType("people");
    setSelectedGroupId("");
    setSelectedPeopleEmails(normalizedPrefilledPeopleEmails);
    setPlaceType("room");
    setRoomSelectionTouched(false);
    setShowSpecificRoomsList(false);
    setPlacePickerOpen(false);
  }, [collaborationEnabled, normalizedPrefilledPeopleEmails, prefilledGroupId]);

  useEffect(() => {
    if (collaborationEnabled) return;
    setTargetType("self");
    setPlaceType("room");
    setSelectedGroupId("");
    setSelectedPeopleEmails([]);
    setGroupPickerOpen(false);
    setCreateGroupOverlayOpen(false);
    setCreateGroupPendingName("");
    setMinParticipantsFilterOn(false);
    setMinParticipants(1);
  }, [collaborationEnabled]);

  useEffect(() => {
    if (!collaborationEnabled) return;
    if (!createGroupPendingName) return;
    const normalized = createGroupPendingName.trim().toLowerCase();
    if (!normalized) {
      setCreateGroupPendingName("");
      return;
    }
    const matched = [...groups]
      .filter((group) => group.name.trim().toLowerCase() === normalized)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!matched) return;
    setSelectedGroupId(matched.id);
    setSelectedPeopleEmails([]);
    setTargetType("group");
    setPlaceType("room");
    setRoomSelectionTouched(false);
    setShowSpecificRoomsList(false);
    setCreateGroupPendingName("");
  }, [collaborationEnabled, createGroupPendingName, groups]);

  useEffect(() => {
    if (durationTouched) return;
    if (targetType === "group" || targetType === "people") {
      setDurationMinutes(DEFAULT_GROUP_DURATION_MINUTES);
      return;
    }
    if (targetType === "self") {
      setDurationMinutes(DEFAULT_SELF_DURATION_MINUTES);
    }
  }, [durationTouched, targetType]);

  const rehearsalSuitableRoomIds = useMemo(
    () => rooms.filter((room) => room.rehearsalSuitable).map((room) => room.id),
    [rooms]
  );
  const recordingSuitableRoomIds = useMemo(
    () => rooms.filter((room) => room.recordingSuitable).map((room) => room.id),
    [rooms]
  );

  useEffect(() => {
    if (targetType !== "group" && targetType !== "people") return;
    if (!collaborationEnabled) return;
    if (roomSelectionTouched) return;
    setSelectedRooms(rehearsalSuitableRoomIds.length ? rehearsalSuitableRoomIds : []);
  }, [collaborationEnabled, rehearsalSuitableRoomIds, roomSelectionTouched, targetType]);

  const availableRooms = selectedRooms.length ? rooms.filter((room) => selectedRooms.includes(room.id)) : rooms;
  const todayKey = formatDateKey(new Date());
  const effectiveStartDate = todayKey;
  const effectiveEndDate = formatDateKey(addDays(new Date(), 30));
  const safeFromHour = Math.max(startHour, Math.min(fromHour, endHour));
  const safeToHour = Math.max(safeFromHour, Math.min(toHour, endHour));
  const effectivePolicyWindows = useMemo(
    () =>
      policyWindows.length
        ? policyWindows
        : buildReservationPolicyWindowsForDays(policyDayKeys, startHour * 60, endHour * 60),
    [endHour, policyDayKeys, policyWindows, startHour]
  );
  const allowedPolicyDays = useMemo(() => {
    const windowDayKeys = getReservationPolicyDayKeys(effectivePolicyWindows);
    const allowed = new Set(windowDayKeys.length ? windowDayKeys : defaultWeekDayKeys);
    return allWeekDays.filter((day) => allowed.has(day.key));
  }, [effectivePolicyWindows]);
  const allowedCalendarDays = useMemo(
    () => new Set(allowedPolicyDays.map((day) => DAY_KEY_TO_CALENDAR_DAY[day.key])),
    [allowedPolicyDays]
  );
  const weekdayLabels = useMemo(
    () =>
      allowedPolicyDays.map((day) => ({
        value: DAY_KEY_TO_CALENDAR_DAY[day.key],
        label: `${day.short || day.label}׳`
      })),
    [allowedPolicyDays]
  );
  const weekDayNames = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const weekDayShortNames = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
  const attendeePreviewLimit = 4;
  const formatDayDate = (dateKey: string) => {
    const dayLabel = weekDayNames[parseDateKey(dateKey).getDay()] || "";
    return `יום ${dayLabel} · ${formatShortDate(dateKey)}`;
  };
  const formatDayShort = (dateKey: string) => {
    const dayShort = weekDayShortNames[parseDateKey(dateKey).getDay()] || "";
    return `יום ${dayShort}`;
  };
  const displayLabelForEmail = (email: string) => userLabelByEmail.get(email.toLowerCase()) || email;
  const initialsForLabel = (label: string) => {
    const parts = label.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
    return (parts[0] || "?").slice(0, 2).toUpperCase();
  };

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );
  const currentEmailNormalized = (currentEmail || "").trim().toLowerCase();
  const formatMembersCount = (count: number) => {
    if (count === 1) return "משתתף 1";
    if (count === 2) return "2 משתתפים";
    return `${count} משתתפים`;
  };
  const selectedPeopleSummary = useMemo(() => {
    const count = normalizeEmailList([currentEmailNormalized, ...selectedPeopleEmails]).length;
    if (count <= 1) return "בחר אנשים";
    return formatMembersCount(count);
  }, [currentEmailNormalized, selectedPeopleEmails]);
  const filteredGroups = useMemo(() => {
    const q = groupPickerSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((group) => group.name.toLowerCase().includes(q));
  }, [groupPickerSearch, groups]);
  const usersByEmail = useMemo(() => {
    const map = new Map<string, DirectoryUser>();
    directoryUsers.forEach((user) => map.set(user.email.toLowerCase(), user));
    return map;
  }, [directoryUsers]);
  const userLabelByEmail = useMemo(() => {
    const map = new Map<string, string>();
    directoryUsers.forEach((user) => {
      const key = user.email.toLowerCase();
      const name = (user.name || "").trim();
      map.set(key, name || user.email);
    });
    collaborators.forEach((profile) => {
      const key = profile.email.toLowerCase();
      if (map.has(key)) return;
      const name = (profile.name || "").trim();
      map.set(key, name || profile.email);
    });
    return map;
  }, [collaborators, directoryUsers]);
  const profileByEmail = useMemo(() => {
    const map = new Map<
      string,
      { email: string; availability: UserAvailability; dateOffs?: AvailabilityDateOffs; events: CollaboratorEvent[] }
    >();
    collaborators.forEach((profile) => {
      map.set(profile.email.toLowerCase(), profile);
    });
    return map;
  }, [collaborators]);

  const ownProfile = useMemo(() => {
    const email = (currentEmail || "").trim().toLowerCase();
    if (email) {
      const existing = profileByEmail.get(email);
      if (existing) return existing;
    }
    return {
      email,
      availability,
      dateOffs: {} as AvailabilityDateOffs,
      events: [] as CollaboratorEvent[]
    };
  }, [availability, currentEmail, profileByEmail]);

  const participantEmails = useMemo(() => {
    if (!findCommonTime) return [];
    if (targetType === "group") {
      if (!selectedGroup) return [];
      return normalizeEmailList(selectedGroup.memberEmails);
    }
    if (targetType === "people") {
      return normalizeEmailList([currentEmailNormalized, ...selectedPeopleEmails]);
    }
    return [];
  }, [currentEmailNormalized, findCommonTime, selectedGroup, selectedPeopleEmails, targetType]);
  const totalGroupParticipants = useMemo(
    () => Array.from(new Set(participantEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))).length,
    [participantEmails]
  );
  const minParticipantsMax = Math.max(1, totalGroupParticipants || 1);
  const minParticipantsDisplay = !minParticipantsFilterOn || minParticipants >= minParticipantsMax
    ? "כולם"
    : `${minParticipants}+`;
  const canDecreaseMinParticipants = findCommonTime && minParticipantsFilterOn && minParticipants > 1;
  const canIncreaseMinParticipants = findCommonTime && minParticipantsFilterOn && minParticipants < minParticipantsMax;

  useEffect(() => {
    if (!findCommonTime) {
      setMinParticipantsFilterOn(false);
      setMinParticipants(1);
      return;
    }
    if (!minParticipantsFilterOn) {
      setMinParticipants(minParticipantsMax);
      return;
    }
    setMinParticipants((prev) => Math.max(1, Math.min(prev, minParticipantsMax)));
  }, [findCommonTime, minParticipantsFilterOn, minParticipantsMax]);

  const participantProfiles = useMemo(() => {
    if (!findCommonTime) return [];
    if (targetType === "group" && !selectedGroup) return [];
    if (targetType === "people" && participantEmails.length <= 1) return [];
    return participantEmails
      .map((email) => profileByEmail.get(email) || (email === ownProfile.email ? ownProfile : undefined))
      .filter(
        (
          entry
        ): entry is { email: string; availability: UserAvailability; dateOffs?: AvailabilityDateOffs; events: CollaboratorEvent[] } =>
          Boolean(entry)
      );
  }, [findCommonTime, ownProfile, participantEmails, profileByEmail, selectedGroup, targetType]);

  const hours = useMemo(
    () => Array.from({ length: endHour - startHour + 1 }, (_, i) => i + startHour),
    [startHour, endHour]
  );
  const maxScheduleDurationMinutes = Math.max(
    DURATION_STEP_MINUTES,
    (Math.max(endHour, startHour + 1) - startHour) * 60
  );
  const policyDurationCap = typeof policyMaxDurationMinutes === "number" && Number.isFinite(policyMaxDurationMinutes)
    ? policyMaxDurationMinutes
    : undefined;
  const maxPolicyDurationMinutes = policyDurationCap
    ? Math.max(
        DURATION_STEP_MINUTES,
        Math.floor(policyDurationCap / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES
      )
    : maxScheduleDurationMinutes;
  const maxDurationMinutes = Math.max(
    DURATION_STEP_MINUTES,
    Math.min(maxScheduleDurationMinutes, maxPolicyDurationMinutes)
  );
  const durationOptions = useMemo(() => {
    const options: number[] = [];
    for (let minutes = DURATION_STEP_MINUTES; minutes <= maxDurationMinutes; minutes += DURATION_STEP_MINUTES) {
      options.push(minutes);
    }
    return options;
  }, [maxDurationMinutes]);
  const durationFilterMinutes = Math.max(
    DURATION_STEP_MINUTES,
    Math.min(
      maxDurationMinutes,
      Math.floor((Number(durationMinutes || DEFAULT_SELF_DURATION_MINUTES) || DURATION_STEP_MINUTES) / DURATION_STEP_MINUTES) *
        DURATION_STEP_MINUTES
    )
  );
  const hasFinderModeSelection = Boolean(targetType && placeType);
  const hasCompleteCommonProfiles = participantEmails.length > 0 && participantProfiles.length === participantEmails.length;
  const canComputeResults = Boolean(
    hasFinderModeSelection &&
    (
      !findCommonTime ||
      (targetType === "group"
        ? selectedGroup && hasCompleteCommonProfiles
        : participantEmails.length > 1 && hasCompleteCommonProfiles)
    )
  );
  const durationOptionIndex = durationOptions.indexOf(durationFilterMinutes);
  const canDecreaseDuration = durationOptionIndex > 0;
  const canIncreaseDuration = durationOptionIndex >= 0 && durationOptionIndex < durationOptions.length - 1;
  const policyForwardLimitDays = useMemo(() => {
    const raw = Number(policyMaxDaysForward);
    if (!Number.isFinite(raw) || raw <= 0) return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.round(raw));
  }, [policyMaxDaysForward]);

  useEffect(() => {
    if (durationMinutes <= maxDurationMinutes) return;
    setDurationMinutes(maxDurationMinutes);
  }, [durationMinutes, maxDurationMinutes]);

  useEffect(() => {
    if (!isActive) return;
    onDateWindowChange?.(effectiveStartDate, effectiveEndDate);
  }, [effectiveEndDate, effectiveStartDate, isActive, onDateWindowChange]);

  const results = useMemo(() => {
    const start = parseDateKey(effectiveStartDate);
    const end = parseDateKey(effectiveEndDate);
    if (start > end) return [];
    if (!canComputeResults) return [];

    const minGap = durationFilterMinutes;
    const dates: string[] = [];
    for (let date = start; date <= end; date = addDays(date, 1)) {
      const day = date.getDay();
      if (!allowedCalendarDays.has(day)) continue;
      if (useWeekdaysFilter && selectedWeekdays.length && !selectedWeekdays.includes(day)) continue;
      dates.push(formatDateKey(date));
    }

    const items: FinderResult[] = [];
    const selfParticipantEmails = ownProfile.email ? [ownProfile.email] : [];
    const requiredGroupEmail = undefined;

    dates.forEach((dateKey) => {
      const dayKey = getDayKeyFromDateKey(dateKey);
      const dayLessons = getLessonsForDate
        ? getLessonsForDate(dateKey, dayKey)
        : lessons.filter((lesson) => lesson.day === dayKey);
      const reservations = reservationMap[dateKey] || [];

      const filterStartMinutes = useHoursFilter ? safeFromHour * 60 : startHour * 60;
      const filterEndMinutes = useHoursFilter ? safeToHour * 60 : endHour * 60;
      const dayBaseWindows = intersectSearchWindows(
        getReservationPolicyWindowsForDay(effectivePolicyWindows, dayKey, dateKey, { includeRoomScoped: true }),
        filterStartMinutes,
        filterEndMinutes
      );
      if (!dayBaseWindows.length) return;
      const resolveProfileFreeWindows = (profile: {
        availability: UserAvailability;
        dateOffs?: AvailabilityDateOffs;
        events: CollaboratorEvent[];
      }, baseWindows: TimeInterval[]): TimeInterval[] => {
        const availabilityWindow = getAvailabilityWindowForDate(
          profile.availability || availability,
          dayKey,
          dateKey,
          profile.dateOffs || {}
        );
        if (!availabilityWindow) return [];
        const availableBaseWindows = baseWindows
          .map((baseWindow) => ({
            start: Math.max(baseWindow.start, availabilityWindow.startMinutes),
            end: Math.min(baseWindow.end, availabilityWindow.endMinutes)
          }))
          .filter((baseWindow) => baseWindow.end > baseWindow.start);
        if (!availableBaseWindows.length) return [];
        const busy = profile.events
          .filter((entry) => entry.dateKey === dateKey)
          .map((entry) => ({ start: entry.startMinutes, end: entry.endMinutes }))
          .sort((a, b) => a.start - b.start);
        return availableBaseWindows
          .flatMap((baseWindow) => subtractBusyFromWindow(baseWindow, busy))
          .sort((a, b) => a.start - b.start);
      };

      const buildGroupFreeByEmail = (baseWindows: TimeInterval[]) =>
        findCommonTime
          ? participantProfiles.map((profile) => ({
            email: profile.email.toLowerCase(),
            free: resolveProfileFreeWindows(profile, baseWindows)
          }))
          : [];
      if (findCommonTime && !participantProfiles.length) return;

      const selfFree = targetType === "self" ? resolveProfileFreeWindows(ownProfile, dayBaseWindows) : [];

      if (findRoom) {
        availableRooms.forEach((room) => {
          const roomBaseWindows = intersectSearchWindows(
            getReservationPolicyWindowsForDay(effectivePolicyWindows, dayKey, dateKey, { roomId: room.id }),
            filterStartMinutes,
            filterEndMinutes
          );
          if (!roomBaseWindows.length) return;
          const roomBusy = [
            ...dayLessons
              .filter((lesson) => lesson.roomId === room.id)
              .map((lesson) => ({ start: lesson.startMinutes, end: lesson.startMinutes + lesson.durationMinutes })),
            ...reservations
              .filter((entry) => entry.roomId === room.id)
              .map((entry) => ({ start: entry.time, end: entry.time + entry.durationMinutes }))
          ].sort((a, b) => a.start - b.start);
          const roomFree = roomBaseWindows.flatMap((baseWindow) => subtractBusyFromWindow(baseWindow, roomBusy));
          if (findCommonTime) {
            const groupFreeByEmail = buildGroupFreeByEmail(roomBaseWindows);
            if (!groupFreeByEmail.length) return;
            roomFree.forEach((roomWindow) => {
              collectGroupCandidateWindows(roomWindow, groupFreeByEmail, minGap, requiredGroupEmail).forEach(
                (candidate) => {
                  items.push({
                    date: dateKey,
                    day: dayKey,
                    ...(findCommonTime && selectedGroupId ? { groupId: selectedGroupId } : {}),
                    roomId: room.id,
                    roomName: room.name,
                    start: candidate.start,
                    end: candidate.end,
                    participantsCount: candidate.participantEmails.length,
                    participantEmails: candidate.participantEmails
                  });
                }
              );
            });
            return;
          }
          roomFree.forEach((interval) => {
            const alignedStart = Math.ceil(interval.start / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES;
            const alignedEnd = Math.floor(interval.end / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES;
            if (alignedEnd - alignedStart < minGap || alignedEnd <= alignedStart) return;
            items.push({
              date: dateKey,
              day: dayKey,
              ...(findCommonTime && selectedGroupId ? { groupId: selectedGroupId } : {}),
              roomId: room.id,
              roomName: room.name,
              start: alignedStart,
              end: alignedEnd,
              participantsCount: Math.max(1, selfParticipantEmails.length),
              participantEmails: selfParticipantEmails
            });
          });
        });
        return;
      }

      if (findCommonTime) {
        const groupFreeByEmail = buildGroupFreeByEmail(dayBaseWindows);
        if (!groupFreeByEmail.length) return;
        dayBaseWindows.forEach((baseWindow) => {
          collectGroupCandidateWindows(baseWindow, groupFreeByEmail, minGap, requiredGroupEmail).forEach(
            (candidate) => {
              items.push({
                date: dateKey,
                day: dayKey,
                ...(findCommonTime && selectedGroupId ? { groupId: selectedGroupId } : {}),
                start: candidate.start,
                end: candidate.end,
                participantsCount: candidate.participantEmails.length,
                participantEmails: candidate.participantEmails
              });
            }
          );
        });
        return;
      }

      selfFree.forEach((interval) => {
        const alignedStart = Math.ceil(interval.start / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES;
        const alignedEnd = Math.floor(interval.end / DURATION_STEP_MINUTES) * DURATION_STEP_MINUTES;
        if (alignedEnd - alignedStart < minGap || alignedEnd <= alignedStart) return;
        items.push({
          date: dateKey,
          day: dayKey,
          ...(findCommonTime && selectedGroupId ? { groupId: selectedGroupId } : {}),
          start: alignedStart,
          end: alignedEnd,
          participantsCount: Math.max(1, selfParticipantEmails.length),
          participantEmails: selfParticipantEmails
        });
      });
    });

    const filteredItems =
      findCommonTime && minParticipantsFilterOn
        ? items.filter((item) => item.participantsCount >= minParticipants)
        : items;
    const todayDate = parseDateKey(todayKey);
    const isWithinPolicyWindow = (dateKey: string) => {
      if (!Number.isFinite(policyForwardLimitDays)) return true;
      const deltaDays = Math.floor((parseDateKey(dateKey).getTime() - todayDate.getTime()) / DAY_MS);
      return deltaDays <= policyForwardLimitDays;
    };

    const compareItems = (a: FinderResult, b: FinderResult) => {
      if (findCommonTime) {
        const aWithinPolicy = isWithinPolicyWindow(a.date);
        const bWithinPolicy = isWithinPolicyWindow(b.date);
        if (aWithinPolicy !== bWithinPolicy) return aWithinPolicy ? -1 : 1;
        if (a.participantsCount !== b.participantsCount) {
          return b.participantsCount - a.participantsCount;
        }
      }
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.start !== b.start) return a.start - b.start;
      return (a.roomName || "").localeCompare(b.roomName || "", "he");
    };

    const sortedItems = [...filteredItems].sort(compareItems);
    if (!findRoom) {
      return sortedItems.map((item) => ({
        ...item,
        outsidePolicyWindow: !isWithinPolicyWindow(item.date)
      }));
    }

    const groupedByStart = new Map<
      string,
      { result: FinderResult; roomIds: Set<string>; roomOptionsById: Map<string, FinderRoomOption> }
    >();
    sortedItems.forEach((item) => {
      const key = `${item.date}:${item.start}`;
      const outsidePolicyWindow = !isWithinPolicyWindow(item.date);
      const existing = groupedByStart.get(key);
      if (!existing) {
        const roomIds = new Set<string>();
        const roomOptionsById = new Map<string, FinderRoomOption>();
        if (item.roomId) {
          roomOptionsById.set(item.roomId, {
            roomId: item.roomId,
            roomName: item.roomName || "חדר",
            ...(item.groupId ? { groupId: item.groupId } : {}),
            start: item.start,
            end: item.end,
            participantsCount: item.participantsCount,
            participantEmails: [...item.participantEmails],
            outsidePolicyWindow
          });
        }
        if (item.roomId) roomIds.add(item.roomId);
        groupedByStart.set(key, {
          result: {
            ...item,
            outsidePolicyWindow,
            participantEmails: [...item.participantEmails]
          },
          roomIds,
          roomOptionsById
        });
        return;
      }
      if (item.roomId) {
        existing.roomIds.add(item.roomId);
        const existingOption = existing.roomOptionsById.get(item.roomId);
        if (
          !existingOption ||
          item.participantsCount > existingOption.participantsCount ||
          (item.participantsCount === existingOption.participantsCount && item.end > existingOption.end)
        ) {
          existing.roomOptionsById.set(item.roomId, {
            roomId: item.roomId,
            roomName: item.roomName || "חדר",
            ...(item.groupId ? { groupId: item.groupId } : {}),
            start: item.start,
            end: item.end,
            participantsCount: item.participantsCount,
            participantEmails: [...item.participantEmails],
            outsidePolicyWindow
          });
        }
      }
      if (item.end > existing.result.end) {
        existing.result.end = item.end;
      }
      if (item.participantsCount > existing.result.participantsCount) {
        existing.result.participantsCount = item.participantsCount;
        existing.result.participantEmails = [...item.participantEmails];
      }
    });

    return Array.from(groupedByStart.values()).map(({ result, roomIds, roomOptionsById }) => {
      const roomCount = roomIds.size;
      const roomOptions = Array.from(roomOptionsById.values()).sort((a, b) => a.roomName.localeCompare(b.roomName, "he"));
      if (roomCount > 1) {
        return {
          ...result,
          roomCount,
          roomOptions,
          roomName: `${roomCount} חדרים`
        };
      }
      if (roomCount === 1) {
        return {
          ...result,
          roomCount,
          roomOptions
        };
      }
      return result;
    });
  }, [
    availability,
    allowedCalendarDays,
    availableRooms,
    currentEmailNormalized,
    durationFilterMinutes,
    effectiveEndDate,
    effectiveStartDate,
    effectivePolicyWindows,
    endHour,
    findCommonTime,
    findRoom,
    safeFromHour,
    safeToHour,
    getLessonsForDate,
    lessons,
    participantEmails,
    participantProfiles,
    reservationMap,
    canComputeResults,
    ownProfile,
    selectedGroup,
    selectedWeekdays,
    startHour,
    targetType,
    minParticipants,
    minParticipantsFilterOn,
    policyForwardLimitDays,
    todayKey,
    useHoursFilter,
    useWeekdaysFilter
  ]);

  useEffect(() => {
    setVisibleCount(20);
  }, [
    safeFromHour,
    safeToHour,
    durationFilterMinutes,
    selectedRooms,
    selectedWeekdays,
    findCommonTime,
    findRoom,
    selectedGroupId,
    selectedPeopleEmails,
    useWeekdaysFilter,
    useHoursFilter,
    targetType,
    placeType,
    minParticipants,
    minParticipantsFilterOn
  ]);

  const visibleResults = results.slice(0, visibleCount);
  const activePlaceRoot = useMemo(() => {
    if (placeType === "noRoom") return "noRoom";
    if (placeType !== "room") return "";
    if (showSpecificRoomsList) return "specific";
    if (recordingSuitableRoomIds.length && hasSameIds(selectedRooms, recordingSuitableRoomIds)) return "recording";
    if (
      collaborationEnabled &&
      rehearsalSuitableRoomIds.length &&
      hasSameIds(selectedRooms, rehearsalSuitableRoomIds)
    ) {
      return "rehearsal";
    }
    return "all";
  }, [collaborationEnabled, placeType, recordingSuitableRoomIds, rehearsalSuitableRoomIds, selectedRooms, showSpecificRoomsList]);
  const roomSelectionSummary = useMemo(() => {
    if (
      collaborationEnabled &&
      rehearsalSuitableRoomIds.length &&
      hasSameIds(selectedRooms, rehearsalSuitableRoomIds)
    ) {
      return "מתאים להרכבים";
    }
    if (recordingSuitableRoomIds.length && hasSameIds(selectedRooms, recordingSuitableRoomIds)) return "מתאים להקלטות";
    if (!selectedRooms.length) return "כל החדרים";
    if (selectedRooms.length === 1) {
      return rooms.find((room) => room.id === selectedRooms[0])?.name || "חדר";
    }
    return `${selectedRooms.length} חדרים`;
  }, [collaborationEnabled, recordingSuitableRoomIds, rehearsalSuitableRoomIds, rooms, selectedRooms]);
  const groupSelectionSummary = selectedGroup?.name || "בחר הרכב";
  const updateDurationByStep = (direction: -1 | 1) => {
    if (durationOptionIndex < 0) return;
    const next = durationOptions[durationOptionIndex + direction];
    if (typeof next !== "number") return;
    setDurationTouched(true);
    setDurationMinutes(next);
  };
  const decreaseMinParticipants = () => {
    if (!findCommonTime || minParticipantsMax <= 1 || !minParticipantsFilterOn) return;
    setMinParticipants((prev) => Math.max(1, prev - 1));
  };
  const increaseMinParticipants = () => {
    if (!findCommonTime || !minParticipantsFilterOn) return;
    setMinParticipants((prev) => Math.min(minParticipantsMax, prev + 1));
  };

  const submitResultScheduling = (item: FinderResult, roomOption?: FinderRoomOption) => {
    onSchedule({
      dateKey: item.date,
      dayKey: item.day,
      startMinutes: roomOption?.start ?? item.start,
      endMinutes: roomOption?.end ?? item.end,
      preferredDurationMinutes: durationFilterMinutes,
      ...(roomOption?.roomId ? { roomId: roomOption.roomId } : item.roomId ? { roomId: item.roomId } : {}),
      ...(findCommonTime && targetType === "group" ? { groupId: roomOption?.groupId || item.groupId || selectedGroupId } : {}),
      mode: { findCommonTime, findRoom },
      participantEmails: roomOption?.participantEmails || item.participantEmails
    });
  };
  const scheduleFromResult = (item: FinderResult) => {
    if (findRoom && item.roomOptions && item.roomOptions.length > 1) {
      setRoomChoiceResult(item);
      return;
    }
    submitResultScheduling(item);
  };

  const openCreateGroupOverlay = () => {
    setCreateGroupOverlayOpen(true);
    setCreateGroupPendingName("");
  };

  const closeCreateGroupOverlay = () => setCreateGroupOverlayOpen(false);

  const chooseGroupTarget = () => {
    if (!collaborationEnabled) return;
    setTargetType("group");
    setSelectedPeopleEmails([]);
    setPlaceType("room");
    setRoomSelectionTouched(false);
    setShowSpecificRoomsList(false);
    setPlacePickerOpen(false);
    setGroupPickerOpen(true);
    setRoomChoiceResult(null);
  };

  const choosePeopleTarget = () => {
    if (!collaborationEnabled || !selectedPeopleEmails.length) return;
    setTargetType("people");
    setSelectedGroupId("");
    setPlaceType("room");
    setRoomSelectionTouched(false);
    setShowSpecificRoomsList(false);
    setPlacePickerOpen(false);
    setGroupPickerOpen(false);
    setRoomChoiceResult(null);
  };

  const chooseSelfTarget = () => {
    setTargetType("self");
    setSelectedPeopleEmails([]);
    setPlaceType("room");
    setRoomSelectionTouched(false);
    setSelectedRooms([]);
    setShowSpecificRoomsList(false);
    setPlacePickerOpen(false);
    setGroupPickerOpen(false);
    setRoomChoiceResult(null);
  };

  return (
    <section className="finder">
      <div className="finder-form finder-form-simple">
        {collaborationEnabled ? (
          <>
            <p className="field-label finder-section-label">בשביל מי?</p>
            <div className="finder-intents-grid">
              <div
                className={`finder-intent-card ${targetType === "group" ? "active" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={targetType === "group"}
                onClick={chooseGroupTarget}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    chooseGroupTarget();
                  }
                }}
              >
                <div className="finder-intent-card-main">
                  <span className="finder-intent-card-icon" aria-hidden="true">
                    <GroupsIcon />
                  </span>
                  <div className="finder-intent-card-text">
                    <span className="finder-intent-card-title">הרכב</span>
                    <span className="finder-intent-card-selector-value finder-intent-static-value">זמן שכולם יכולים</span>
                  </div>
                </div>
                <span className="finder-intent-card-selection finder-intent-card-selection-row">
                  <span className="finder-intent-card-selection-label">עבור</span>
                  <span className="finder-intent-card-selection-value">{groupSelectionSummary}</span>
                </span>
              </div>
              <div
                className={`finder-intent-card finder-intent-card-secondary ${targetType === "self" ? "active" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={targetType === "self"}
                onClick={chooseSelfTarget}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    chooseSelfTarget();
                  }
                }}
              >
                  <div className="finder-intent-card-main">
                  <span className="finder-intent-card-icon" aria-hidden="true">
                    <UserIcon />
                  </span>
                  <div className="finder-intent-card-text">
                    <span className="finder-intent-card-title">רק לי</span>
                    <span className="finder-intent-card-selector-value finder-intent-static-value">זמן שמתאים לי</span>
                  </div>
                </div>
              </div>
              {selectedPeopleEmails.length ? (
                <div
                  className={`finder-intent-card finder-intent-card-secondary ${targetType === "people" ? "active" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={targetType === "people"}
                  onClick={choosePeopleTarget}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      choosePeopleTarget();
                    }
                  }}
                >
                  <div className="finder-intent-card-main">
                    <span className="finder-intent-card-icon" aria-hidden="true">
                      <UserIcon />
                    </span>
                    <div className="finder-intent-card-text">
                      <span className="finder-intent-card-title">עם אנשים</span>
                      <span className="finder-intent-card-selector-value finder-intent-static-value">
                        {selectedPeopleSummary}
                      </span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {targetType || hasFinderModeSelection ? (
          <>
            <div className="finder-primary-filters">
              {targetType ? (
                <div className="finder-place-field">
                  <p className="field-label finder-section-label">איפה?</p>
                  <button
                    type="button"
                    className="finder-toggle-button finder-place-selector"
                    onClick={() => setPlacePickerOpen(true)}
                  >
                    <span className="finder-control-main">
                      {placeType === "noRoom" ? (
                        <>
                          <ScheduleIcon />
                          <span>בלי חדר</span>
                        </>
                      ) : (
                        <>
                          <RoomIcon />
                          <span>{roomSelectionSummary}</span>
                        </>
                      )}
                    </span>
                    <span className="finder-control-arrow" aria-hidden="true">
                      <ChevronLeftIcon />
                    </span>
                  </button>
                </div>
              ) : null}
              {hasFinderModeSelection ? (
                <div className="finder-duration-field">
                  <p className="field-label finder-section-label">כמה זמן?</p>
                  <label className="finder-toggle-button finder-duration-selector">
                    <span className="finder-control-main finder-duration-main">
                      <ScheduleIcon />
                      <button
                        type="button"
                        className="finder-duration-step"
                        aria-label="הקטנת משך"
                        disabled={!canDecreaseDuration}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          updateDurationByStep(-1);
                        }}
                      >
                        <RemoveIcon />
                      </button>
                      <select
                        className="finder-duration-value"
                        value={durationFilterMinutes}
                        onChange={(event) => {
                          setDurationTouched(true);
                          setDurationMinutes(Number(event.target.value));
                        }}
                      >
                        {durationOptions.map((minutes) => (
                          <option key={minutes} value={minutes}>{formatDurationLabelHe(minutes)}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="finder-duration-step"
                        aria-label="הגדלת משך"
                        disabled={!canIncreaseDuration}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          updateDurationByStep(1);
                        }}
                      >
                        <AddIcon />
                      </button>
                    </span>
                  </label>
                </div>
              ) : null}
            </div>
            {hasFinderModeSelection ? (
              <div className="finder-extra-filters-row">
                <button
                  type="button"
                  className="chip ghost small finder-expand-filters"
                  onClick={() => setAdvancedFiltersOpen((prev) => !prev)}
                >
                  {advancedFiltersOpen ? "הסתר סינונים" : "הרחב סינונים"}
                </button>
              </div>
            ) : null}

            {hasFinderModeSelection && advancedFiltersOpen ? (
              <>
                {findCommonTime ? (
                  <div className="finder-filter-toggle-row">
                    <button
                      type="button"
                      className={`finder-toggle-button ${minParticipantsFilterOn ? "active" : ""}`}
                      aria-pressed={minParticipantsFilterOn}
                      onClick={() => {
                        setMinParticipantsFilterOn((prev) => {
                          const next = !prev;
                          if (next) setMinParticipants(minParticipantsMax);
                          return next;
                        });
                      }}
                    >
                      <span className={`finder-check-circle ${minParticipantsFilterOn ? "active" : ""}`} aria-hidden="true">
                        {minParticipantsFilterOn ? "✓" : ""}
                      </span>
                      מינימום משתתפים
                    </button>
                    {minParticipantsFilterOn ? (
                      <div className="finder-duration-field finder-min-participants-field">
                        <label className="finder-toggle-button finder-duration-selector">
                          <span className="finder-control-main finder-duration-main">
                            <GroupsIcon />
                            <button
                              type="button"
                              className="finder-duration-step"
                              aria-label="הקטנת מינימום משתתפים"
                              disabled={!canDecreaseMinParticipants}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                decreaseMinParticipants();
                              }}
                            >
                              <RemoveIcon />
                            </button>
                            <span className="finder-min-participants-value">{minParticipantsDisplay}</span>
                            <button
                              type="button"
                              className="finder-duration-step"
                              aria-label="הגדלת מינימום משתתפים"
                              disabled={!canIncreaseMinParticipants}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                increaseMinParticipants();
                              }}
                            >
                              <AddIcon />
                            </button>
                          </span>
                        </label>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="finder-filter-toggle-row">
                  <button
                    type="button"
                    className={`finder-toggle-button ${useWeekdaysFilter ? "active" : ""}`}
                    aria-pressed={useWeekdaysFilter}
                    onClick={() => setUseWeekdaysFilter((prev) => !prev)}
                  >
                    <span className={`finder-check-circle ${useWeekdaysFilter ? "active" : ""}`} aria-hidden="true">
                      {useWeekdaysFilter ? "✓" : ""}
                    </span>
                    רק בימים
                  </button>
                  {useWeekdaysFilter ? (
                    <div className="finder-filter-inline-controls finder-weekdays-inline">
                      {weekdayLabels.map((day) => {
                        const selected = selectedWeekdays.includes(day.value);
                        return (
                          <button
                            key={day.value}
                            type="button"
                            className={`finder-toggle-button finder-inline-toggle ${selected ? "active" : ""}`}
                            aria-pressed={selected}
                            onClick={() => {
                              setSelectedWeekdays((prev) => (
                                selected ? prev.filter((value) => value !== day.value) : [...prev, day.value]
                              ));
                            }}
                          >
                            {day.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                <div className="finder-filter-toggle-row">
                  <button
                    type="button"
                    className={`finder-toggle-button ${useHoursFilter ? "active" : ""}`}
                    aria-pressed={useHoursFilter}
                    onClick={() => setUseHoursFilter((prev) => !prev)}
                  >
                    <span className={`finder-check-circle ${useHoursFilter ? "active" : ""}`} aria-hidden="true">
                      {useHoursFilter ? "✓" : ""}
                    </span>
                    רק בין השעות
                  </button>
                  {useHoursFilter ? (
                    <div className="finder-filter-inline-controls finder-hours-inline">
                      <label className="finder-toggle-button finder-inline-toggle finder-hours-inline-control">
                        <span className="finder-hours-inline-label">משעה</span>
                        <select
                          className="finder-hours-inline-select"
                          value={safeFromHour}
                          onChange={(event) => setFromHour(Number(event.target.value))}
                        >
                          {hours.map((hour) => (
                            <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>
                          ))}
                        </select>
                      </label>
                      <label className="finder-toggle-button finder-inline-toggle finder-hours-inline-control">
                        <span className="finder-hours-inline-label">עד שעה</span>
                        <select
                          className="finder-hours-inline-select"
                          value={safeToHour}
                          onChange={(event) => setToHour(Number(event.target.value))}
                        >
                          {hours.map((hour) => (
                            <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}

            <div className="finder-results finder-results-inline">
              {!canComputeResults && findCommonTime ? (
                <p className="finder-inline-note">
                  {targetType === "people" ? "בחר אנשים כדי להציג תוצאות." : "בחר הרכב כדי להציג תוצאות."}
                </p>
              ) : visibleResults.length ? (
                <ul className="finder-result-list">
                  {visibleResults.map((item, index) => (
                    <li
                      key={`${item.date}-${item.roomId || "common"}-${item.start}-${item.end}-${item.participantEmails.join(",") || index}`}
                      className={`finder-result ${item.roomId ? "clickable" : ""} ${item.outsidePolicyWindow ? "policy-outside" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => scheduleFromResult(item)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          scheduleFromResult(item);
                        }
                      }}
                    >
                      <div className="finder-result-text">
                        <p className="finder-result-title">
                          <span className={`dot ${item.outsidePolicyWindow ? "closed" : "empty"}`} /> {formatDayShort(item.date)} · {formatMinutes(item.start)}
                        </p>
                        <p className="finder-result-meta">
                          {(item.roomName || "ללא חדר")} · {formatDurationLabelHe(item.end - item.start)} · {formatShortDate(item.date)}
                        </p>
                      </div>
                      {findCommonTime ? (
                        <div className="finder-result-attendees" aria-label={`${item.participantsCount} משתתפים`}>
                          {(() => {
                            const visibleTarget =
                              item.participantEmails.length === attendeePreviewLimit + 1
                                ? attendeePreviewLimit + 1
                                : attendeePreviewLimit;
                            const baseHiddenCount = Math.max(0, item.participantEmails.length - visibleTarget);
                            const withoutSelf =
                              currentEmailNormalized && baseHiddenCount >= 2
                                ? item.participantEmails.filter((email) => email.toLowerCase() !== currentEmailNormalized)
                                : item.participantEmails;
                            const sourceEmails =
                              currentEmailNormalized &&
                              baseHiddenCount >= 2 &&
                              withoutSelf.length >= visibleTarget
                                ? withoutSelf
                                : item.participantEmails;
                            const visibleEmails = sourceEmails.slice(
                              0,
                              Math.min(visibleTarget, sourceEmails.length)
                            );
                            const hiddenCount = Math.max(0, item.participantEmails.length - visibleEmails.length);
                            return (
                              <>
                                {visibleEmails.map((email, attendeeIndex) => {
                                  const user = usersByEmail.get(email.toLowerCase());
                                  const label = displayLabelForEmail(email);
                                  const pictureUrl = (user?.pictureUrl || "").trim();
                                  return (
                                    <span
                                      key={`${item.date}-${item.start}-${email}`}
                                      className="finder-result-attendee"
                                      style={{ zIndex: attendeeIndex + 1 }}
                                      title={label}
                                    >
                                      {pictureUrl ? <img src={pictureUrl} alt="" loading="lazy" /> : <span>{initialsForLabel(label)}</span>}
                                    </span>
                                  );
                                })}
                                {hiddenCount >= 2 ? (
                                  <span
                                    className="finder-result-attendee finder-result-attendee-count"
                                    title={`${item.participantEmails.length} משתתפים`}
                                  >
                                    +{hiddenCount}
                                  </span>
                                ) : null}
                              </>
                            );
                          })()}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="finder-inline-note">אין התאמות בטווח שבחרת.</p>
              )}
              {results.length > visibleCount ? (
                <button type="button" className="chip ghost small" onClick={() => setVisibleCount((count) => count + 20)}>
                  עוד תוצאות
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {roomChoiceResult ? (
        <div className="groups-overlay-backdrop" role="presentation" onClick={() => setRoomChoiceResult(null)}>
          <div className="groups-overlay finder-group-picker-overlay finder-room-choice-overlay" role="dialog" onClick={(event) => event.stopPropagation()}>
            <p className="groups-overlay-title">בחירת חדר</p>
            <p className="finder-room-choice-header">
              {formatDayShort(roomChoiceResult.date)} · {formatMinutes(roomChoiceResult.start)}
            </p>
            <ul className="groups-chat-list finder-group-picker-list finder-room-choice-list">
              {(roomChoiceResult.roomOptions || []).map((option) => (
                <li key={`finder-room-choice-${roomChoiceResult.date}-${roomChoiceResult.start}-${option.roomId}`}>
                  <button
                    type="button"
                    className="groups-chat-item finder-group-picker-item finder-room-choice-item"
                    onClick={() => {
                      submitResultScheduling(roomChoiceResult, option);
                      setRoomChoiceResult(null);
                    }}
                  >
                    <ChevronLeftIcon />
                    <div className="groups-chat-text">
                      <p className="groups-chat-title">{option.roomName}</p>
                      <p className="groups-chat-subtitle">
                        פנוי עד {formatMinutes(option.end)} · {formatDurationLabelHe(option.end - option.start)}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            <div className="groups-overlay-actions">
              <button type="button" className="chip ghost" onClick={() => setRoomChoiceResult(null)}>
                סגור
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {collaborationEnabled && groupPickerOpen ? (
        <div className="groups-overlay-backdrop" role="presentation" onClick={() => setGroupPickerOpen(false)}>
          <div className="groups-overlay finder-group-picker-overlay" role="dialog" onClick={(event) => event.stopPropagation()}>
            <p className="groups-overlay-title">בחירת הרכב</p>
            <label className="finder-group-search-field">
              <input
                type="search"
                value={groupPickerSearch}
                placeholder="חיפוש הרכב"
                onChange={(event) => setGroupPickerSearch(event.target.value)}
              />
            </label>
            <ul className="groups-chat-list finder-group-picker-list">
              <li key="finder-group-create">
                <button
                  type="button"
                  className="groups-chat-item finder-group-picker-item finder-group-picker-item-create"
                  onClick={() => {
                    setGroupPickerOpen(false);
                    openCreateGroupOverlay();
                  }}
                >
                  <span className="groups-chat-avatar groups-chat-avatar-group finder-group-create-avatar" aria-hidden="true">
                    <AddIcon />
                  </span>
                  <div className="groups-chat-text">
                    <p className="groups-chat-title">הרכב חדש</p>
                    <p className="groups-chat-subtitle finder-group-create-subtitle-placeholder">placeholder</p>
                  </div>
                </button>
              </li>
              {filteredGroups.map((group) => (
                <li key={`finder-group-${group.id}`}>
                  <button
                    type="button"
                    className={`groups-chat-item finder-group-picker-item finder-group-picker-item-group ${group.id === selectedGroupId ? "active" : ""}`}
                    onClick={() => {
                      setSelectedGroupId(group.id);
                      setTargetType("group");
                      setGroupPickerOpen(false);
                    }}
                  >
                    <span className="groups-chat-avatar groups-chat-avatar-group reserve-group-selector-icon" aria-hidden="true">
                      <GroupsIcon />
                    </span>
                    <div className="groups-chat-text">
                      <p className="groups-chat-title">{group.name}</p>
                      <p className="groups-chat-subtitle">{formatMembersCount(group.memberEmails.length)}</p>
                    </div>
                    <span className="groups-members-stack reserve-group-selector-stack" aria-hidden="true">
                      {Array.from(
                        new Set(
                          [group.ownerEmail, ...group.memberEmails]
                            .map((email) => email.trim().toLowerCase())
                            .filter(Boolean)
                        )
                      )
                        .slice(0, 4)
                        .map((email, index) => {
                          const user = usersByEmail.get(email);
                          const label = displayLabelForEmail(email);
                          const pictureUrl = (user?.pictureUrl || "").trim();
                          return (
                            <span
                              key={`finder-group-member-${group.id}-${email}`}
                              className="groups-members-stack-item"
                              style={{ zIndex: index + 1 }}
                            >
                              {pictureUrl ? (
                                <img src={pictureUrl} alt="" loading="lazy" />
                              ) : (
                                <span>{initialsForLabel(label)}</span>
                              )}
                            </span>
                          );
                        })}
                    </span>
                    <ChevronLeftIcon />
                  </button>
                </li>
              ))}
            </ul>
            <div className="groups-overlay-actions">
              <button type="button" className="chip ghost" onClick={() => setGroupPickerOpen(false)}>
                סגור
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {placePickerOpen ? (
        <div className="groups-overlay-backdrop" role="presentation" onClick={() => setPlacePickerOpen(false)}>
          <div className="groups-overlay finder-group-picker-overlay" role="dialog" onClick={(event) => event.stopPropagation()}>
            <p className="groups-overlay-title">בחירת מקום</p>
            <ul className="groups-chat-list finder-group-picker-list finder-room-picker-list">
              <li key="finder-room-all">
                <button
                  type="button"
                  className={`groups-chat-item finder-group-picker-item finder-group-picker-item-group finder-room-option-item ${activePlaceRoot === "all" ? "active" : ""}`}
                  onClick={() => {
                    setPlaceType("room");
                    setRoomSelectionTouched(true);
                    setSelectedRooms([]);
                    setShowSpecificRoomsList(false);
                    setPlacePickerOpen(false);
                  }}
                >
                  <span className="finder-room-option-icon" aria-hidden="true">
                    <RoomIcon />
                  </span>
                  <div className="groups-chat-text">
                    <p className="groups-chat-title">כל החדרים</p>
                    <p className="groups-chat-subtitle">כל החדרים הפעילים לחיפוש</p>
                  </div>
                </button>
              </li>
              {collaborationEnabled ? (
                <li key="finder-room-rehearsal-suitable">
                  <button
                    type="button"
                    className={`groups-chat-item finder-group-picker-item finder-group-picker-item-group finder-room-option-item ${activePlaceRoot === "rehearsal" ? "active" : ""}`}
                    onClick={() => {
                      setPlaceType("room");
                      setRoomSelectionTouched(true);
                      setSelectedRooms(rehearsalSuitableRoomIds);
                      setShowSpecificRoomsList(false);
                      setPlacePickerOpen(false);
                    }}
                  >
                    <span className="finder-room-option-icon" aria-hidden="true">
                      <GroupsIcon />
                    </span>
                    <div className="groups-chat-text">
                      <p className="groups-chat-title">מתאים להרכבים</p>
                      <p className="groups-chat-subtitle">רק חדרים שמתאימים להרכבים</p>
                    </div>
                  </button>
                </li>
              ) : null}
              <li key="finder-room-recording-suitable">
                <button
                  type="button"
                  className={`groups-chat-item finder-group-picker-item finder-group-picker-item-group finder-room-option-item ${activePlaceRoot === "recording" ? "active" : ""}`}
                  onClick={() => {
                    setPlaceType("room");
                    setRoomSelectionTouched(true);
                    setSelectedRooms(recordingSuitableRoomIds);
                    setShowSpecificRoomsList(false);
                    setPlacePickerOpen(false);
                  }}
                >
                  <span className="finder-room-option-icon" aria-hidden="true">
                    <MicIcon />
                  </span>
                  <div className="groups-chat-text">
                    <p className="groups-chat-title">מתאים להקלטות</p>
                    <p className="groups-chat-subtitle">רק חדרים שמתאימים להקלטות</p>
                  </div>
                </button>
              </li>
              <li key="finder-specific-rooms">
                <button
                  type="button"
                  className={`groups-chat-item finder-group-picker-item finder-group-picker-item-group finder-room-option-item ${activePlaceRoot === "specific" ? "active" : ""}`}
                  onClick={() => {
                    setPlaceType("room");
                    setRoomSelectionTouched(true);
                    setShowSpecificRoomsList((prev) => !prev);
                  }}
                >
                  <span className="finder-room-option-icon" aria-hidden="true">
                    <TuneIcon />
                  </span>
                  <div className="groups-chat-text">
                    <p className="groups-chat-title">חדרים ספציפיים</p>
                    <p className="groups-chat-subtitle">בחירה ידנית מתוך רשימת חדרים</p>
                  </div>
                </button>
              </li>
              {showSpecificRoomsList ? (
                <>
                  <li className="finder-room-separator" aria-hidden="true">
                    <span />
                  </li>
                  {rooms.map((room) => {
                    const selected = placeType === "room" && selectedRooms.includes(room.id);
                    return (
                      <li key={`finder-room-pick-${room.id}`}>
                        <button
                          type="button"
                          className={`groups-chat-item finder-group-picker-item finder-group-picker-item-group finder-room-option-item finder-room-specific-item ${selected ? "active" : ""}`}
                          onClick={() => {
                            setPlaceType("room");
                            setRoomSelectionTouched(true);
                            setSelectedRooms((prev) => (
                              selected ? prev.filter((id) => id !== room.id) : [...prev, room.id]
                            ));
                          }}
                        >
                          <span className={`finder-member-check ${selected ? "active" : ""}`} aria-hidden="true">
                            {selected ? "✓" : ""}
                          </span>
                          <div className="groups-chat-text">
                            <p className="groups-chat-title">{room.name}</p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </>
              ) : null}
              {collaborationEnabled ? (
                <li key="finder-no-room">
                  <button
                    type="button"
                    className={`groups-chat-item finder-group-picker-item finder-group-picker-item-group finder-room-option-item ${activePlaceRoot === "noRoom" ? "active" : ""}`}
                    onClick={() => {
                      setPlaceType("noRoom");
                      setShowSpecificRoomsList(false);
                      setPlacePickerOpen(false);
                    }}
                  >
                    <span className="finder-room-option-icon" aria-hidden="true">
                      <CloseIcon />
                    </span>
                    <div className="groups-chat-text">
                      <p className="groups-chat-title">בלי חדר</p>
                      <p className="groups-chat-subtitle">תיאום זמן בלבד ללא חדר</p>
                    </div>
                  </button>
                </li>
              ) : null}
            </ul>
            <div className="groups-overlay-actions">
              <button type="button" className="chip ghost" onClick={() => setPlacePickerOpen(false)}>
                סגור
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {collaborationEnabled ? (
        <GroupCreateOverlay
          open={createGroupOverlayOpen}
          users={directoryUsers}
          currentEmail={currentEmail}
          onClose={closeCreateGroupOverlay}
          onCreateGroup={onCreateGroup}
          memberSubtitle={memberYearSubtitle}
          onCreated={(groupId, name) => {
            if (groupId) {
              setSelectedGroupId(groupId);
              setTargetType("group");
            } else {
              setCreateGroupPendingName(name);
            }
            setGroupPickerOpen(false);
            closeCreateGroupOverlay();
          }}
        />
      ) : null}
    </section>
  );
}
