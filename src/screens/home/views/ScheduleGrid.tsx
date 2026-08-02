import type { DayKey, Lesson, Room, TimeSlot } from "../../../types/schedule";
import type { ReservationMap, ReserveRequest, ReservationParticipant } from "../../../types/reservations";
import type { User } from "../../../types/auth";
import { addDays, formatDateKey, parseDateKey, type WeekDate } from "../../../lib/date";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import { AddIcon, CloseIcon, ReleaseIcon } from "../../../components/Icons";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { DirectoryUser, RoomMeta } from "../../../types/admin";
import type { AvailabilityDateOffs, CollaborationGroup, RehearsalParticipant, UserAvailability } from "../../../types/collaboration";
import { resolveReservationParticipantStates } from "../../../lib/reservationParticipants";

type ScheduleView = "daily" | "room";

export type ScheduleGridProps = {
  view: ScheduleView;
  rooms: Room[];
  weekDates: WeekDate[];
  timeSlots: TimeSlot[];
  selectedDate: string;
  selectedDayKey: DayKey;
  selectedRoom: string;
  lessons: Lesson[];
  roomMeta?: Record<string, RoomMeta>;
  directoryUsers?: DirectoryUser[];
  groups?: CollaborationGroup[];
  getLessonsForDate?: (dateKey: string, dayKey: DayKey) => Lesson[];
  reservationMap: ReservationMap;
  currentUser: User | null;
  onReserve: (request: ReserveRequest) => void;
  onSlotAction?: (request: ReserveRequest) => void;
  onRelease: (dateKey: string, reservationId: string) => void;
  interactive?: boolean;
  showSlotActions?: boolean;
  onEditReservation?: (dateKey: string, reservationId: string) => void;
  onLessonDetails?: (lessonId: string, dateKey: string) => void;
  onSpecialDetails?: (reservationId: string, dateKey: string) => void;
  onExamDetails?: (reservationId: string, dateKey: string) => void;
  onClosedDetails?: (reservationId: string, dateKey: string) => void;
  pendingReservationIds?: string[];
  onAdminSlotClick?: (request: ReserveRequest) => void;
  onAdminLessonClick?: (lessonId: string, dateKey: string) => void;
  onAdminReservationClick?: (reservationId: string, dateKey: string) => void;
  onReservationClick?: (reservationId: string, dateKey: string) => void;
  adminMode?: boolean;
  startHour: number;
  endHour: number;
  compact?: boolean;
  compactLabel?: "title" | "status";
  onRoomSelect?: (roomId: string, dateKey: string) => void;
  onDateSelect?: (dateKey: string) => void;
  showHeaders?: boolean;
  isSlotReservable?: (request: ReserveRequest) => boolean;
  footer?: ReactNode;
  nowMinutes?: number;
  todayDateKey?: string;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  zoomResetToken?: number;
  availability?: UserAvailability;
  availabilityDateOffs?: AvailabilityDateOffs;
  availabilityEditMode?: boolean;
  onAvailabilityDayUpdate?: (
    dayKey: DayKey,
    updates: Partial<{ enabled: boolean; startMinutes: number; endMinutes: number }>
  ) => void;
  onAvailabilityDateOffToggle?: (dateKey: string, off: boolean) => void;
  onLinkedRehearsalRespond?: (
    groupId: string,
    rehearsalId: string,
    status: RehearsalParticipant["status"]
  ) => void;
};

const BASE_ROW_HEIGHT = 28;

type LessonBlock = {
  id: string;
  type: "lesson";
  title: string;
  meta: string;
  startMinutes: number;
  durationMinutes: number;
  pending?: boolean;
};

type ReservationBlock = {
  id: string;
  type: "reserved" | "special" | "exam" | "closed";
  title: string;
  meta: string;
  startMinutes: number;
  durationMinutes: number;
  reservationId: string;
  reservedEmail: string;
  reservedPicture?: string;
  participants?: ReservationParticipant[];
  quotaParticipantEmails?: string[];
  linkedGroupId?: string;
  linkedRehearsalId?: string;
  kind?: "special" | "exam" | "closed";
  pending?: boolean;
};

type Block = LessonBlock | ReservationBlock;

type PositionedBlock = Block & { column: number };

const layoutBlocks = (blocks: Block[]): PositionedBlock[] => {
  const EPSILON = 0.5;
  const sorted = [...blocks].sort((a, b) => a.startMinutes - b.startMinutes);
  const active: { id: string; end: number; column: number }[] = [];
  const columnById = new Map<string, number>();

  sorted.forEach((block) => {
    const blockEnd = block.startMinutes + block.durationMinutes;
    for (let i = active.length - 1; i >= 0; i -= 1) {
      if (active[i].end <= block.startMinutes + EPSILON) {
        active.splice(i, 1);
      }
    }

    const used = new Set(active.map((item) => item.column));
    let column = 0;
    while (used.has(column)) column += 1;
    columnById.set(block.id, column);
    active.push({ id: block.id, end: blockEnd, column });
  });

  return blocks.map((block) => ({ ...block, column: columnById.get(block.id) ?? 0 }));
};

const groupOverlaps = (blocks: PositionedBlock[]) => {
  const EPSILON = 0.5;
  const sorted = [...blocks].sort((a, b) => a.startMinutes - b.startMinutes);
  const groups: PositionedBlock[][] = [];
  let active: PositionedBlock[] = [];

  sorted.forEach((block) => {
    active = active.filter(
      (item) => item.startMinutes + item.durationMinutes > block.startMinutes + EPSILON
    );

    if (active.length === 0) {
      groups.push([]);
    }

    groups[groups.length - 1].push(block);
    active.push(block);
  });

  return groups;
};

const buildAvatarInitials = (value: string) => {
  const cleaned = value
    .split("\n")[0]
    .split("·")[0]
    .trim();
  if (!cleaned) return "?";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
};

const rehearsalLinkKey = (groupId: string, rehearsalId: string) => `${groupId}::${rehearsalId}`;

function ReservationAvatar({
  pictureUrl,
  fallbackLabel,
  compact = false,
  className = ""
}: {
  pictureUrl: string;
  fallbackLabel: string;
  compact?: boolean;
  className?: string;
}) {
  const [imageError, setImageError] = useState(false);
  const showImage = Boolean(pictureUrl) && !imageError;

  return (
    <span
      className={`schedule-reservation-avatar${compact ? " compact" : ""}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      {showImage ? (
        <img src={pictureUrl} alt="" loading="lazy" onError={() => setImageError(true)} />
      ) : (
        <span>{buildAvatarInitials(fallbackLabel)}</span>
      )}
    </span>
  );
}

export default function ScheduleGrid({
  view,
  rooms,
  weekDates,
  timeSlots,
  selectedDate,
  selectedDayKey,
  selectedRoom,
  lessons,
  roomMeta,
  directoryUsers = [],
  groups = [],
  getLessonsForDate,
  reservationMap,
  currentUser,
  onReserve,
  onSlotAction,
  onRelease,
  interactive = true,
  showSlotActions,
  onEditReservation,
  onLessonDetails,
  onSpecialDetails,
  onExamDetails,
  onClosedDetails,
  pendingReservationIds = [],
  onAdminSlotClick,
  onAdminLessonClick,
  onAdminReservationClick,
  onReservationClick,
  adminMode = false,
  startHour,
  endHour,
  compact = false,
  compactLabel = "title",
  onRoomSelect,
  onDateSelect,
  showHeaders = true,
  isSlotReservable,
  footer,
  nowMinutes,
  todayDateKey,
  onNavigatePrev,
  onNavigateNext,
  zoomResetToken,
  availability,
  availabilityDateOffs = {},
  availabilityEditMode = false,
  onAvailabilityDayUpdate,
  onAvailabilityDateOffToggle,
  onLinkedRehearsalRespond
}: ScheduleGridProps) {
  const baseStartMinutes = startHour * 60;
  const baseEndMinutes = endHour * 60;
  const totalHours = endHour - startHour;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(BASE_ROW_HEIGHT);
  const [rowScale, setRowScale] = useState(() => {
    try {
      const raw = localStorage.getItem("rimon_schedule_row_scale_v1");
      const parsed = raw ? Number(raw) : 1;
      return Number.isFinite(parsed) ? Math.max(1, Math.min(1.6, parsed)) : 1;
    } catch {
      return 1;
    }
  });
  const rowScaleRef = useRef(rowScale);
  useEffect(() => {
    rowScaleRef.current = rowScale;
    try {
      localStorage.setItem("rimon_schedule_row_scale_v1", String(rowScale));
    } catch {
      // ignore
    }
  }, [rowScale]);

  useEffect(() => {
    if (!availabilityEditMode || rowScale === 1) return;
    setRowScale(1);
  }, [availabilityEditMode, rowScale]);

  useEffect(() => {
    if (!zoomResetToken) return;
    setRowScale(1);
  }, [zoomResetToken]);

  const columnHeight = totalHours * rowHeight;
  const slotHeightFor = (slot: TimeSlot) => ((slot.endMinutes - slot.startMinutes) / 60) * rowHeight;
  const colGap = compact ? 2 : 4;
  const slotActionsEnabled = (showSlotActions ?? interactive) && !availabilityEditMode;
  const gridStyle = useMemo(
    () => ({ ["--row-height" as string]: `${rowHeight}px` }),
    [rowHeight]
  );
  const tomorrowDateKey = useMemo(
    () => (todayDateKey ? formatDateKey(addDays(parseDateKey(todayDateKey), 1)) : ""),
    [todayDateKey]
  );
  const pendingReservationIdSet = useMemo(
    () => new Set(pendingReservationIds),
    [pendingReservationIds]
  );
  const availabilityTrackRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const directoryUsersByEmail = useMemo(() => {
    const map = new Map<string, { name: string; pictureUrl: string }>();
    directoryUsers.forEach((user) => {
      const email = (user.email || "").trim().toLowerCase();
      if (!email) return;
      map.set(email, {
        name: (user.name || "").trim(),
        pictureUrl: (user.pictureUrl || "").trim()
      });
    });
    return map;
  }, [directoryUsers]);
  const rehearsalDataByLink = useMemo(() => {
    const map = new Map<
      string,
      {
        approvedParticipantEmails: string[];
        participantStatusByEmail: Map<string, RehearsalParticipant["status"]>;
        createdBy: string;
      }
    >();
    groups.forEach((group) => {
      const groupId = (group.id || "").trim();
      if (!groupId) return;
      (group.rehearsals || []).forEach((rehearsal) => {
        const rehearsalId = (rehearsal.id || "").trim();
        if (!rehearsalId) return;
        const participantStatusByEmail = new Map<string, RehearsalParticipant["status"]>();
        const approvedParticipantEmails: string[] = [];
        rehearsal.participants.forEach((participant) => {
          const email = (participant.email || "").trim().toLowerCase();
          if (!email) return;
          const status: RehearsalParticipant["status"] =
            participant.status === "declined" ? "declined" : "approved";
          participantStatusByEmail.set(email, status);
          if (status === "approved") approvedParticipantEmails.push(email);
        });
        map.set(rehearsalLinkKey(groupId, rehearsalId), {
          approvedParticipantEmails: Array.from(new Set(approvedParticipantEmails)),
          participantStatusByEmail,
          createdBy: (rehearsal.createdBy || "").trim().toLowerCase()
        });
      });
    });
    return map;
  }, [groups]);
  const [availabilityDrag, setAvailabilityDrag] = useState<{
    trackKey: string;
    dayKey: DayKey;
    handle: "start" | "end";
  } | null>(null);
  const [availabilityPreviewByDay, setAvailabilityPreviewByDay] = useState<
    Partial<Record<DayKey, { startMinutes: number; endMinutes: number }>>
  >({});
  const availabilityPreviewRef = useRef<Partial<Record<DayKey, { startMinutes: number; endMinutes: number }>>>({});

  useEffect(() => {
    availabilityPreviewRef.current = availabilityPreviewByDay;
  }, [availabilityPreviewByDay]);

  useEffect(() => {
    if (!availabilityDrag || !availability || !onAvailabilityDayUpdate) return;
    const commitDayDraft = (dayKey: DayKey) => {
      const current = availability[dayKey];
      const draft = availabilityPreviewRef.current[dayKey];
      if (!current || !draft) return;
      if (draft.startMinutes !== current.startMinutes) {
        onAvailabilityDayUpdate(dayKey, { startMinutes: draft.startMinutes });
      }
      if (draft.endMinutes !== current.endMinutes) {
        onAvailabilityDayUpdate(dayKey, { endMinutes: draft.endMinutes });
      }
    };
    const move = (event: PointerEvent) => {
      const track = availabilityTrackRefs.current[availabilityDrag.trackKey];
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      const minutesRaw = baseStartMinutes + (y / Math.max(1, rect.height)) * (baseEndMinutes - baseStartMinutes);
      const snapped = Math.max(0, Math.min(24 * 60, Math.round(minutesRaw / 30) * 30));
      const current = availability[availabilityDrag.dayKey];
      if (!current) return;
      setAvailabilityPreviewByDay((prev) => {
        const draft = prev[availabilityDrag.dayKey];
        const draftStart = draft?.startMinutes ?? current.startMinutes;
        const draftEnd = draft?.endMinutes ?? current.endMinutes;
        if (availabilityDrag.handle === "start") {
          const nextStart = Math.max(baseStartMinutes, Math.min(snapped, draftEnd - 30));
          if (nextStart === draftStart) return prev;
          return {
            ...prev,
            [availabilityDrag.dayKey]: { startMinutes: nextStart, endMinutes: draftEnd }
          };
        }
        const nextEnd = Math.min(baseEndMinutes, Math.max(snapped, draftStart + 30));
        if (nextEnd === draftEnd) return prev;
        return {
          ...prev,
          [availabilityDrag.dayKey]: { startMinutes: draftStart, endMinutes: nextEnd }
        };
      });
      commitDayDraft(availabilityDrag.dayKey);
    };
    const finalize = () => {
      const dayKey = availabilityDrag.dayKey;
      commitDayDraft(dayKey);
      setAvailabilityPreviewByDay((prev) => {
        if (!prev[dayKey]) return prev;
        const next = { ...prev };
        delete next[dayKey];
        return next;
      });
      setAvailabilityDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finalize, { once: true });
    window.addEventListener("pointercancel", finalize, { once: true });
    window.addEventListener("blur", finalize, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finalize);
      window.removeEventListener("pointercancel", finalize);
      window.removeEventListener("blur", finalize);
    };
  }, [
    availability,
    availabilityDrag,
    baseEndMinutes,
    baseStartMinutes,
    onAvailabilityDayUpdate
  ]);

  useLayoutEffect(() => {
    if (!scrollRef.current) return;

    const update = () => {
      if (!scrollRef.current) return;
      const scrollHeight = scrollRef.current.clientHeight;
      const available = scrollHeight;
      if (available <= 0) return;
      const baseMin = compact ? 20 : 24;
      const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
      const minRowHeight =
        viewportH < 640 ? Math.max(14, baseMin - 6) : viewportH < 720 ? Math.max(16, baseMin - 4) : baseMin;
      const fit = available / totalHours;
      const base = Math.max(minRowHeight, fit);
      const scaled = Math.max(base, Math.min(84, base * rowScaleRef.current));
      setRowHeight(scaled);
    };

    update();

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (observer) {
      observer.observe(scrollRef.current);
    }

    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [showHeaders, totalHours]);

  useEffect(() => {
    // Apply pinch scale immediately (ResizeObserver fires later, but UX should feel direct).
    if (!scrollRef.current) return;
    const scrollHeight = scrollRef.current.clientHeight;
    const available = scrollHeight;
    if (available <= 0) return;
    const baseMin = compact ? 20 : 24;
    const viewportH = typeof window !== "undefined" ? window.innerHeight : 800;
    const minRowHeight =
      viewportH < 640 ? Math.max(14, baseMin - 6) : viewportH < 720 ? Math.max(16, baseMin - 4) : baseMin;
    const fit = available / totalHours;
    const base = Math.max(minRowHeight, fit);
    const scaled = Math.max(base, Math.min(84, base * rowScale));
    setRowHeight(scaled);
  }, [compact, rowScale, totalHours]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (availabilityEditMode) return;
    if (!onNavigatePrev && !onNavigateNext) return;

    const state = {
      mode: "none" as "none" | "swipe" | "pinch",
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
      startTime: 0,
      startDist: 0,
      startScale: 1,
      navigated: false
    };

    const dist = (t1: Touch, t2: Touch) => {
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      return Math.hypot(dx, dy);
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        state.mode = "pinch";
        state.startDist = dist(event.touches[0], event.touches[1]);
        state.startScale = rowScaleRef.current;
        state.navigated = false;
        return;
      }
      if (event.touches.length !== 1) return;
      state.mode = "swipe";
      state.startX = event.touches[0].clientX;
      state.startY = event.touches[0].clientY;
      state.lastX = state.startX;
      state.lastY = state.startY;
      state.startTime = Date.now();
      state.navigated = false;
    };

    const onMove = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        if (state.mode !== "pinch") {
          state.mode = "pinch";
          state.startDist = dist(event.touches[0], event.touches[1]);
          state.startScale = rowScaleRef.current;
        }
        const d0 = state.startDist || 0;
        const d1 = dist(event.touches[0], event.touches[1]);
        if (d0 > 0 && d1 > 0) {
          const next = Math.max(1, Math.min(1.6, state.startScale * (d1 / d0)));
          setRowScale(next);
          // Prevent browser pinch-zoom; keep the gesture scoped to the grid only.
          event.preventDefault();
        }
        return;
      }
      if (event.touches.length !== 1) return;
      if (state.mode !== "swipe") return;
      state.lastX = event.touches[0].clientX;
      state.lastY = event.touches[0].clientY;
    };

    const onEnd = () => {
      if (state.mode !== "swipe" || state.navigated) {
        state.mode = "none";
        return;
      }
      const dx = state.lastX - state.startX;
      const dy = state.lastY - state.startY;
      const dt = Date.now() - state.startTime;
      state.mode = "none";

      if (dt > 650) return;
      if (Math.abs(dx) < 60) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.4) return;

      // Requested UX: swipe right => next, swipe left => previous.
      if (dx > 0) onNavigateNext?.();
      else onNavigatePrev?.();
      state.navigated = true;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [availabilityEditMode, onNavigateNext, onNavigatePrev]);

  const compactGridTemplate = useMemo(
    () =>
      (view === "daily" || (view === "room" && compact))
        ? (view === "daily"
          ? `repeat(${rooms.length}, minmax(0, 1fr))`
          : `repeat(${weekDates.length}, minmax(0, 1fr))`)
        : null,
    [compact, rooms.length, weekDates.length, view]
  );

  const buildLessonBlocks = (dayKey: DayKey, roomId: string, dateKey: string): LessonBlock[] => {
    const sourceLessons = getLessonsForDate
      ? getLessonsForDate(dateKey, dayKey)
      : lessons.filter((lesson) => lesson.day === dayKey);
    return sourceLessons
      .filter((lesson) => lesson.roomId === roomId)
      .map((lesson) => ({
        id: lesson.id,
        type: "lesson" as const,
        title: lesson.title,
        meta: lesson.teacher || "ללא מרצה",
        startMinutes: lesson.startMinutes,
        durationMinutes: lesson.durationMinutes
      }));
  };

const buildReservationBlocks = (dateKey: string, roomId: string): ReservationBlock[] =>
    (reservationMap[dateKey] || [])
      .filter((entry) => entry.roomId === roomId)
      .map((entry) => ({
        id: entry.id,
        type:
          entry.kind === "special"
            ? "special"
            : entry.kind === "exam"
              ? "exam"
              : entry.kind === "closed"
                ? "closed"
                : "reserved",
        title:
          entry.kind === "special"
            ? "אירוע"
            : entry.kind === "exam"
              ? "מבחן"
              : entry.kind === "closed"
                ? "סגירה"
                : "שמור",
        meta: entry.reservedBy || "",
        startMinutes: entry.time,
        durationMinutes: entry.durationMinutes,
        reservationId: entry.id,
        reservedEmail: entry.reservedEmail || "",
        reservedPicture: entry.reservedPicture || "",
        participants: entry.participants,
        quotaParticipantEmails: entry.quotaParticipantEmails,
        linkedGroupId: entry.linkedGroupId,
        linkedRehearsalId: entry.linkedRehearsalId,
        kind: entry.kind,
        pending: Boolean(entry.pending) || (!entry.kind && pendingReservationIdSet.has(entry.id))
      }));

  const renderColumn = ({ dayKey, dateKey, roomId }: { dayKey: DayKey; dateKey: string; roomId: string }) => {
    const blocks: Block[] = [
      ...buildLessonBlocks(dayKey, roomId, dateKey),
      ...buildReservationBlocks(dateKey, roomId)
    ];
    const positionedBlocks = layoutBlocks(blocks);
    const columnsById = new Map<string, number>();

    groupOverlaps(positionedBlocks).forEach((group) => {
      const maxColumn = group.reduce((max, block) => Math.max(max, block.column), 0);
      const columns = maxColumn + 1;
      group.forEach((block) => columnsById.set(block.id, columns));
    });

    const isSlotBusy = (slotStart: number, slotEnd: number) => {
      return blocks.some((block) => {
        const blockStart = block.startMinutes;
        const blockEnd = block.startMinutes + block.durationMinutes;
        return blockStart < slotEnd && blockEnd > slotStart;
      });
    };

    const showNowLine = Boolean(
      typeof nowMinutes === "number" &&
        todayDateKey &&
        dateKey === todayDateKey &&
        nowMinutes >= baseStartMinutes &&
        nowMinutes <= baseEndMinutes
    );
    const nowTop = showNowLine ? ((nowMinutes! - baseStartMinutes) / 60) * rowHeight : 0;
    const nowLabel = showNowLine ? formatMinutes(nowMinutes!) : "";
    const showSingleNowBubble = view === "daily" && rooms.length > 1;
    const showNowBubble = !showSingleNowBubble || roomId === rooms[0]?.id;
    const flipNowBubble = showNowLine && nowTop > columnHeight - 24;
    const dayAvailability = availability?.[dayKey];
    const dayPreview = availabilityPreviewByDay[dayKey];
    const hasDateException = Boolean(availabilityDateOffs[dateKey]);
    const trackKey = `${roomId}:${dateKey}`;
    const effectiveStart = dayPreview?.startMinutes ?? dayAvailability?.startMinutes ?? baseStartMinutes;
    const effectiveEnd = dayPreview?.endMinutes ?? dayAvailability?.endMinutes ?? baseEndMinutes;
    const rangeStart = dayAvailability
      ? Math.max(baseStartMinutes, Math.min(effectiveStart, baseEndMinutes - 30))
      : baseStartMinutes;
    const rangeEnd = dayAvailability
      ? Math.min(baseEndMinutes, Math.max(effectiveEnd, rangeStart + 30))
      : baseEndMinutes;
    const rangeTop = ((rangeStart - baseStartMinutes) / 60) * rowHeight;
    const rangeHeight = ((rangeEnd - rangeStart) / 60) * rowHeight;
    const weekdayEnabled = Boolean(dayAvailability?.enabled);
    const showAvailabilityWindow = dayAvailability ? (weekdayEnabled ? !hasDateException : hasDateException) : false;
    const showAvailabilityLines = showAvailabilityWindow && availabilityEditMode;
    const startLabel = `מ-${formatMinutes(rangeStart)}`;
    const endLabel = `עד ${formatMinutes(rangeEnd)}`;
    const beginAvailabilityDrag = (handle: "start" | "end") => (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!availabilityEditMode || !dayAvailability) return;
      event.preventDefault();
      event.stopPropagation();
      setAvailabilityPreviewByDay((prev) => (
        prev[dayKey]
          ? prev
          : {
              ...prev,
              [dayKey]: {
                startMinutes: dayAvailability.startMinutes,
                endMinutes: dayAvailability.endMinutes
              }
            }
      ));
      setAvailabilityDrag({ trackKey, dayKey, handle });
    };

    return (
      <div className="schedule-column" style={{ height: columnHeight }}>
        {dayAvailability ? (
          <>
            <div className={`availability-overlay availability-bg${availabilityEditMode ? " editable" : ""}`}>
              {showAvailabilityWindow ? (
                <div
                  className="availability-window"
                  style={{
                    top: rangeTop,
                    height: Math.max(2, rangeHeight)
                  }}
                />
              ) : null}
            </div>
            <div
              ref={(node) => {
                availabilityTrackRefs.current[trackKey] = node;
              }}
              className={`availability-overlay availability-lines${availabilityEditMode ? " editable" : ""}`}
            >
              {showAvailabilityLines ? (
                <>
                  <button
                    type="button"
                    className="availability-line top"
                    style={{ top: rangeTop }}
                    tabIndex={availabilityEditMode ? 0 : -1}
                    onPointerDown={beginAvailabilityDrag("start")}
                    aria-label={`שעת התחלה ${formatMinutes(rangeStart)}`}
                  >
                    <span className="availability-line-pill">{startLabel}</span>
                  </button>
                  <button
                    type="button"
                    className="availability-line bottom"
                    style={{ top: rangeTop + rangeHeight }}
                    tabIndex={availabilityEditMode ? 0 : -1}
                    onPointerDown={beginAvailabilityDrag("end")}
                    aria-label={`שעת סיום ${formatMinutes(rangeEnd)}`}
                  >
                    <span className="availability-line-pill">{endLabel}</span>
                  </button>
                </>
              ) : null}
            </div>
          </>
        ) : null}
        {showNowLine ? (
          <div className={`now-line${flipNowBubble ? " flip-bubble" : ""}`} style={{ top: nowTop }} aria-hidden="true">
            {showNowBubble ? <span className="now-line-pill">{nowLabel}</span> : null}
          </div>
        ) : null}
        {slotActionsEnabled
          ? Array.from({ length: totalHours }, (_, index) => baseStartMinutes + index * 60).flatMap((hourStart) => {
              const hourEnd = hourStart + 60;
              const hourBusy = isSlotBusy(hourStart, hourEnd);
              const hourReservable = adminMode || !isSlotReservable || isSlotReservable({
                date: dateKey,
                day: dayKey,
                time: hourStart,
                roomId,
                durationMinutes: 60
              });
              const hourTop = ((hourStart - baseStartMinutes) / 60) * rowHeight;
              const hourHeight = rowHeight;

              const makeHit = (slotStart: number, slotEnd: number, showPlus: boolean) => {
                const top = ((slotStart - baseStartMinutes) / 60) * rowHeight;
                const height = ((slotEnd - slotStart) / 60) * rowHeight;
                const busy = isSlotBusy(slotStart, slotEnd);
                const reservable = adminMode || !isSlotReservable || isSlotReservable({
                  date: dateKey,
                  day: dayKey,
                  time: slotStart,
                  roomId,
                  durationMinutes: slotEnd - slotStart
                });
                return (
                  <button
                    key={`${roomId}-${dateKey}-${slotStart}-${slotEnd}`}
                    className="slot-hit"
                    style={{ top, height }}
                    type="button"
                    aria-label="שמירה"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (adminMode) {
                        onAdminSlotClick?.({ date: dateKey, day: dayKey, time: slotStart, roomId });
                        return;
                      }
                      if (onSlotAction) {
                        onSlotAction({ date: dateKey, day: dayKey, time: slotStart, roomId });
                        return;
                      }
                      if (!currentUser?.allowed) {
                        onReserve({ date: dateKey, day: dayKey, time: slotStart, roomId });
                        return;
                      }
                      if (busy || !reservable) return;
                      // Default action is a 1 hour reservation; user can adjust duration in the confirmation overlay.
                      onReserve({ date: dateKey, day: dayKey, time: slotStart, roomId, durationMinutes: 60 });
                    }}
                    disabled={busy || !reservable}
                  >
                    <span className="slot-label">{showPlus && !busy && reservable ? <AddIcon /> : null}</span>
                  </button>
                );
              };

              // Prefer a full 1 hour hit area when the entire hour is free.
              if (!hourBusy && hourReservable) {
                return [
                  <button
                    key={`${roomId}-${dateKey}-${hourStart}-hour`}
                    className="slot-hit"
                    style={{ top: hourTop, height: hourHeight }}
                    type="button"
                    aria-label="שמירה"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (adminMode) {
                        onAdminSlotClick?.({ date: dateKey, day: dayKey, time: hourStart, roomId });
                        return;
                      }
                      if (onSlotAction) {
                        onSlotAction({ date: dateKey, day: dayKey, time: hourStart, roomId });
                        return;
                      }
                      if (!currentUser?.allowed) {
                        onReserve({ date: dateKey, day: dayKey, time: hourStart, roomId });
                        return;
                      }
                      onReserve({ date: dateKey, day: dayKey, time: hourStart, roomId, durationMinutes: 60 });
                    }}
                  >
                    <span className="slot-label">
                      <AddIcon />
                    </span>
                  </button>
                ];
              }

              // Otherwise, allow half-hour clicks only where there isn't a full-hour window.
              return [makeHit(hourStart, hourStart + 30, false), makeHit(hourStart + 30, hourEnd, false)];
            })
          : null}
        {positionedBlocks.map((block) => {
          const rawStart = block.startMinutes;
          const rawEnd = block.startMinutes + block.durationMinutes;
          if (rawEnd <= baseStartMinutes || rawStart >= baseEndMinutes) return null;
          const clampedEnd = Math.min(rawEnd, baseEndMinutes);

          // Use the raw start time so events outside the visible range are naturally clipped
          // by the schedule column (instead of being clamped to the first visible row).
          const blockGap = colGap;
          const top = ((rawStart - baseStartMinutes) / 60) * rowHeight + blockGap / 2;
          const height = Math.max(0, ((clampedEnd - rawStart) / 60) * rowHeight - blockGap);
          const columns = columnsById.get(block.id) ?? 1;
          const widthPercent = 100 / columns;
          const leftPercent = block.column * widthPercent;
          const gap = colGap;

          const showDetails = !compact;
          const showCompactDetails = compact;
          const metaLines = (block.meta || "").split("\n").map((part) => part.trim()).filter(Boolean);
          const primaryMeta = metaLines[0] || "";
          const roomLine = metaLines.length > 1 ? metaLines[metaLines.length - 1] : "";
          const hasRoomLine = Boolean(roomLine) && roomLine !== primaryMeta;
          const hasMeta = Boolean(primaryMeta);
          const showPendingSpinner =
            block.type !== "lesson" &&
            block.pending &&
            pendingReservationIdSet.has(block.reservationId);
          const currentUserEmail = (currentUser?.email || "").trim().toLowerCase();
          const reservationAvatar =
            block.type === "reserved"
              ? (() => {
                  const normalizedEmail = (block.reservedEmail || "").trim().toLowerCase();
                  const directoryUser = normalizedEmail ? directoryUsersByEmail.get(normalizedEmail) : undefined;
                  const ownPicture =
                    normalizedEmail && currentUserEmail && normalizedEmail === currentUserEmail
                      ? (currentUser?.picture || "").trim()
                      : "";
                  const pictureUrl =
                    (block.reservedPicture || "").trim() ||
                    (directoryUser?.pictureUrl || "").trim() ||
                    ownPicture;
                  const fallbackLabel =
                    (directoryUser?.name || "").trim() ||
                    primaryMeta ||
                    (normalizedEmail ? normalizedEmail.split("@")[0] : "") ||
                    "שמור";
                  if (!pictureUrl && !fallbackLabel) return null;
                  return { pictureUrl, fallbackLabel };
                })()
              : null;
          const rehearsalData =
            block.type !== "lesson" && block.linkedGroupId && block.linkedRehearsalId
              ? rehearsalDataByLink.get(
                  rehearsalLinkKey(block.linkedGroupId, block.linkedRehearsalId)
                ) || null
              : null;
          const approvedParticipantEmails = rehearsalData
            ? rehearsalData.approvedParticipantEmails
            : block.type !== "lesson"
              ? resolveReservationParticipantStates(block)
                  .filter((participant) => participant.status === "approved")
                  .map((participant) => participant.email)
              : [];
          const rehearsalAvatars =
            approvedParticipantEmails.length
              ? (() => {
                  const participantEmails = approvedParticipantEmails;
                  const seen = new Set<string>();
                  return participantEmails
                    .map((entry) => entry.trim().toLowerCase())
                    .filter(Boolean)
                    .filter((email) => {
                      if (seen.has(email)) return false;
                      seen.add(email);
                      return true;
                    })
                    .map((email) => {
                      const directoryUser = directoryUsersByEmail.get(email);
                      const ownPicture =
                        currentUserEmail && email === currentUserEmail
                          ? (currentUser?.picture || "").trim()
                          : "";
                      const pictureUrl = (directoryUser?.pictureUrl || "").trim() || ownPicture;
                      const fallbackLabel =
                        (directoryUser?.name || "").trim() ||
                        (email ? email.split("@")[0] : "") ||
                        "משתתף";
                      return {
                        email,
                        pictureUrl,
                        fallbackLabel
                      };
                    });
                })()
              : [];
          const currentUserRehearsalStatus =
            currentUserEmail && rehearsalData
              ? rehearsalData.participantStatusByEmail.get(currentUserEmail)
              : undefined;
          const linkedGroupId = block.type !== "lesson" ? block.linkedGroupId : undefined;
          const linkedRehearsalId = block.type !== "lesson" ? block.linkedRehearsalId : undefined;
          const showPendingRehearsalActions = Boolean(
            !adminMode &&
              block.type !== "lesson" &&
              block.linkedGroupId &&
              block.linkedRehearsalId &&
              currentUserRehearsalStatus &&
              currentUserRehearsalStatus !== "declined" &&
              currentUserEmail !== rehearsalData?.createdBy &&
              onLinkedRehearsalRespond
          );
          const hasRehearsalStack = rehearsalAvatars.length > 0;
          const hasMultiParticipantRehearsalStack = rehearsalAvatars.length > 1;
          const otherParticipantNames =
            block.type !== "lesson"
              ? rehearsalAvatars
                  .filter((avatar) => avatar.email !== (block.reservedEmail || "").trim().toLowerCase())
                  .map((avatar) => avatar.fallbackLabel)
              : [];
          const participantLineMinHeight = compact
            ? hasRoomLine
              ? 76
              : 64
            : hasRoomLine
              ? 82
              : 68;
          const showParticipantNames = otherParticipantNames.length > 0 && height >= participantLineMinHeight;
          // If there's not enough vertical space for a dedicated meta line, render it inline to avoid clipping.
          // (Font sizes are fixed, so a fixed px threshold is more stable than a duration heuristic.)
          const canShowSecondLine = height >= 48;
          const showInlineMeta = showDetails && hasMeta && !canShowSecondLine;
          const showCompactMeta = showCompactDetails && hasMeta;
          const showCompactPending = showPendingSpinner && height >= 20;
          const minAvatarHeight = hasMultiParticipantRehearsalStack
            ? compact
              ? 16
              : 20
            : compact
              ? showCompactMeta || showPendingRehearsalActions
                ? 34
                : 24
              : showInlineMeta || showPendingRehearsalActions
                ? 42
                : 56;
          const canShowBottomAvatar = height >= minAvatarHeight;
          const showBottomAvatar = hasRehearsalStack
            ? canShowBottomAvatar
            : canShowBottomAvatar && Boolean(reservationAvatar);
          const rehearsalAvatarPreviewLimit = compact ? 3 : 4;
          const rehearsalAvatarVisibleTarget =
            rehearsalAvatars.length === rehearsalAvatarPreviewLimit + 1
              ? rehearsalAvatarPreviewLimit + 1
              : rehearsalAvatarPreviewLimit;
          const baseHiddenCount = Math.max(0, rehearsalAvatars.length - rehearsalAvatarVisibleTarget);
          const rehearsalAvatarsWithoutSelf =
            currentUserEmail && baseHiddenCount >= 2
              ? rehearsalAvatars.filter((avatar) => avatar.email !== currentUserEmail)
              : rehearsalAvatars;
          const rehearsalStackSource =
            currentUserEmail &&
            baseHiddenCount >= 2 &&
            rehearsalAvatarsWithoutSelf.length >= rehearsalAvatarVisibleTarget
              ? rehearsalAvatarsWithoutSelf
              : rehearsalAvatars;
          const displayedRehearsalAvatars = rehearsalStackSource.slice(
            0,
            Math.min(rehearsalAvatarVisibleTarget, rehearsalStackSource.length)
          );
          const rehearsalAvatarHiddenCount = Math.max(
            0,
            rehearsalAvatars.length - displayedRehearsalAvatars.length
          );
          return (
            <div
              key={block.id}
              className={`schedule-block ${block.type}${block.pending ? " pending" : ""}${compact ? " compact" : ""}${showBottomAvatar ? " has-bottom-avatar" : ""}`}
              style={{
                top,
                height,
                left: `calc(${leftPercent}% + ${gap / 2}px)`,
                width: `calc(${widthPercent}% - ${gap}px)`
              }}
              onClick={(event) => {
                if (adminMode) {
                  if (block.type === "lesson") {
                    onAdminLessonClick?.(block.id, dateKey);
                  } else {
                    onAdminReservationClick?.(block.reservationId, dateKey);
                  }
                  return;
                }
                // All-rooms daily mode: tap any existing block to expand into this room/day view.
                if (view === "daily" && onRoomSelect) {
                  onRoomSelect(roomId, dateKey);
                  return;
                }
                // Weekly mode: tap any block to jump into the daily view for that date.
                if (view === "room" && onDateSelect) {
                  onDateSelect(dateKey);
                  return;
                }
                if (block.type === "lesson") {
                  onLessonDetails?.(block.id, dateKey);
                  return;
                }
                if (block.type === "special") {
                  onSpecialDetails?.(block.reservationId, dateKey);
                  return;
                }
                if (block.type === "exam") {
                  onExamDetails?.(block.reservationId, dateKey);
                  return;
                }
                if (block.type === "closed") {
                  onClosedDetails?.(block.reservationId, dateKey);
                  return;
                }
                if (block.type === "reserved") {
                  if (currentUser?.allowed && block.reservedEmail === currentUser.email) {
                    onEditReservation?.(dateKey, block.reservationId);
                    return;
                  }
                  onReservationClick?.(block.reservationId, dateKey);
                  return;
                }
              }}
            >
              {showDetails ? (
                <>
                  <div className="block-header">
                    <span className={`block-dot ${block.type}`} />
                    <p className="cell-title">
                      {block.title}
                      {showInlineMeta ? <span className="cell-meta-inline"> · {primaryMeta}</span> : null}
                    </p>
                    {showPendingSpinner ? (
                      <div className="block-header-end">
                        <span className="block-pending-spinner" aria-hidden="true" />
                      </div>
                    ) : null}
                  </div>
                  {!showInlineMeta && hasMeta ? <p className="cell-meta">{primaryMeta}</p> : null}
                  {showParticipantNames ? (
                    <p className="schedule-participant-line">
                      <span className="schedule-participant-label">משתתפים:</span>
                      <span className="schedule-participant-list">{otherParticipantNames.join(", ")}</span>
                    </p>
                  ) : null}
                  {hasRoomLine ? <p className="cell-room">{roomLine}</p> : null}
                  {showPendingRehearsalActions ? (
                    <div className="block-rehearsal-actions">
                      <button
                        type="button"
                        className="cell-action icon-button rehearsal decline"
                        aria-label="דחייה"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!linkedGroupId || !linkedRehearsalId) return;
                          onLinkedRehearsalRespond?.(linkedGroupId, linkedRehearsalId, "declined");
                        }}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  ) : null}
                  {interactive && block.type === "reserved" && !block.pending && currentUser?.allowed && block.reservedEmail === currentUser.email ? (
                    <button
                      className="cell-action icon-button corner"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRelease(dateKey, block.reservationId);
                      }}
                      type="button"
                      aria-label="Release"
                    >
                      <ReleaseIcon />
                    </button>
                  ) : null}
                </>
              ) : null}
              {showCompactDetails ? (
                <div className="compact-lines">
                  <div className="compact-main-row">
                    <div className="compact-main">{block.title}</div>
                    {showCompactPending ? (
                      <div className="compact-main-end">
                        {showCompactPending ? <span className="block-pending-spinner" aria-hidden="true" /> : null}
                      </div>
                    ) : null}
                  </div>
                  {showCompactMeta ? <div className="compact-sub compact-sub-primary">{primaryMeta}</div> : null}
                  {showParticipantNames ? (
                    <div className="schedule-participant-line compact">
                      <span className="schedule-participant-label">משתתפים:</span>
                      <span className="schedule-participant-list">{otherParticipantNames.join(", ")}</span>
                    </div>
                  ) : null}
                  {showCompactMeta && hasRoomLine ? <div className="compact-sub compact-sub-room">{roomLine}</div> : null}
                  {showPendingRehearsalActions ? (
                    <div className="block-rehearsal-actions compact">
                      <button
                        type="button"
                        className="cell-action icon-button rehearsal decline"
                        aria-label="דחייה"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!linkedGroupId || !linkedRehearsalId) return;
                          onLinkedRehearsalRespond?.(linkedGroupId, linkedRehearsalId, "declined");
                        }}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {showBottomAvatar ? (
                <div className={`schedule-block-avatar-anchor${compact ? " compact" : ""}`} aria-hidden="true">
                  {hasRehearsalStack ? (
                    <div className={`schedule-avatar-stack${compact ? " compact" : ""}`}>
                      {displayedRehearsalAvatars.map((avatar, index) => (
                        <span
                          key={`stack-${block.id}-${avatar.email}`}
                          className="schedule-avatar-stack-item"
                          style={{ zIndex: index + 1 }}
                        >
                          <ReservationAvatar
                            pictureUrl={avatar.pictureUrl}
                            fallbackLabel={avatar.fallbackLabel}
                            compact={compact}
                            className="stacked"
                          />
                        </span>
                      ))}
                      {rehearsalAvatarHiddenCount >= 2 ? (
                        <span className="schedule-avatar-stack-more">
                          +{rehearsalAvatarHiddenCount}
                        </span>
                      ) : null}
                    </div>
                  ) : reservationAvatar ? (
                    <ReservationAvatar
                      pictureUrl={reservationAvatar.pictureUrl}
                      fallbackLabel={reservationAvatar.fallbackLabel}
                      compact={compact}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const renderTimeColumn = () => (
    <div className="time-column">
      <div className="time-column-inner" style={{ height: columnHeight }}>
        {timeSlots.map((slot) => (
          <div
            key={slot.startMinutes}
            className="time-cell"
            style={{ height: slotHeightFor(slot) }}
          >
            {formatMinutes(slot.startMinutes)}
          </div>
        ))}
      </div>
    </div>
  );

  if (view === "daily") {
    return (
      <section className={`schedule${compact ? " compact" : ""}${availabilityEditMode ? " availability-edit" : ""}`}>
        <div className={`schedule-shell${showHeaders ? " has-headers" : ""}`}>
          {showHeaders ? (
            <>
              <div
                className="column-headers"
                style={{
                  gridTemplateColumns:
                    compactGridTemplate ?? `repeat(${rooms.length}, minmax(var(--schedule-col-min), 1fr))`
                }}
              >
                {rooms.map((room) => (
                  <div
                    key={room.id}
                    className={`grid-header room-header${onRoomSelect ? " clickable" : ""}`}
                  >
                    {onRoomSelect ? (
                      <button
                        type="button"
                        className="grid-header-main-button"
                        onClick={() => onRoomSelect(room.id, selectedDate)}
                        aria-label={`מעבר לחדר ${room.name}`}
                      >
                        <span>{room.shortName || room.name}</span>
                      </button>
                    ) : (
                      <span>{room.shortName || room.name}</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="time-header" aria-hidden="true" />
            </>
          ) : null}
          <div
            className={`scroll-area schedule-scroll${availabilityEditMode ? " edit-mode" : ""}`}
            ref={scrollRef}
            style={gridStyle}
          >
            <div className="schedule-scroll-inner">
              <div
                className="columns-body"
                style={{
                  gridTemplateColumns:
                    compactGridTemplate ?? `repeat(${rooms.length}, minmax(var(--schedule-col-min), 1fr))`
                }}
              >
                {rooms.map((room) => (
                  <div
                    key={room.id}
                    className="room-column"
                  >
                    {renderColumn({ dayKey: selectedDayKey, dateKey: selectedDate, roomId: room.id })}
                  </div>
                ))}
              </div>
              {renderTimeColumn()}
            </div>
          </div>
        </div>
        {footer ? <div className="schedule-footer">{footer}</div> : null}
      </section>
    );
  }

  return (
    <section className={`schedule${compact ? " compact" : ""}${availabilityEditMode ? " availability-edit" : ""}`}>
      {availabilityEditMode ? (
        <p className="availability-edit-caption">מתי אפשר לקבוע איתי בקמפוס?</p>
      ) : null}
      <div className={`schedule-shell${showHeaders ? " has-headers" : ""}`}>
        {showHeaders ? (
          <>
            <div
              className="column-headers"
              style={{
                gridTemplateColumns:
                  compactGridTemplate ?? `repeat(${weekDates.length}, minmax(var(--schedule-col-min), 1fr))`
              }}
            >
              {weekDates.map((day) => {
                const weekdayEnabled = Boolean(availability?.[day.key]?.enabled);
                const dayLabel = availabilityEditMode
                  ? day.label
                  : day.dateKey === todayDateKey
                    ? "היום"
                    : day.dateKey === tomorrowDateKey
                      ? "מחר"
                      : day.label;
                return (
                  <div
                    key={day.key}
                    className={`grid-header weekday-header${onDateSelect && !availabilityEditMode ? " clickable" : ""}${availabilityEditMode ? " availability-editable" : ""}`}
                  >
                    {onDateSelect && !availabilityEditMode ? (
                      <button
                        type="button"
                        className="grid-header-main-button"
                        onClick={() => onDateSelect(day.dateKey)}
                      >
                        <div className="grid-header-main">
                          <div>{dayLabel}</div>
                          {!availabilityEditMode ? <div className="grid-date">{day.shortDate}</div> : null}
                        </div>
                      </button>
                    ) : (
                      <div className="grid-header-main">
                        <div>{dayLabel}</div>
                        {!availabilityEditMode ? <div className="grid-date">{day.shortDate}</div> : null}
                      </div>
                    )}
                    {availabilityEditMode && onAvailabilityDateOffToggle && onAvailabilityDayUpdate ? (
                      <div
                        className="availability-header-controls"
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className={`availability-header-button ${weekdayEnabled ? "active" : ""}`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            onAvailabilityDayUpdate(day.key, { enabled: !weekdayEnabled });
                          }}
                          aria-pressed={weekdayEnabled}
                          aria-label={`${day.label}: ${weekdayEnabled ? "זמין בקמפוס" : "לא זמין בקמפוס"}`}
                        >
                          <span className={`availability-header-check ${weekdayEnabled ? "active" : ""}`} aria-hidden="true">
                            ✓
                          </span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="time-header" aria-hidden="true" />
          </>
        ) : null}
        <div
          className={`scroll-area schedule-scroll${availabilityEditMode ? " edit-mode" : ""}`}
          ref={scrollRef}
          style={gridStyle}
        >
          <div className="schedule-scroll-inner">
            <div
              className="columns-body"
              style={{
                gridTemplateColumns:
                  compactGridTemplate ?? `repeat(${weekDates.length}, minmax(var(--schedule-col-min), 1fr))`
              }}
            >
              {weekDates.map((day) => (
                <div key={day.key} className="room-column">
                  {renderColumn({ dayKey: day.key, dateKey: day.dateKey, roomId: selectedRoom })}
                </div>
              ))}
            </div>
            {renderTimeColumn()}
          </div>
        </div>
      </div>
      {footer ? <div className="schedule-footer">{footer}</div> : null}
    </section>
  );
}
