import type { DayKey, Lesson, Room, TimeSlot } from "../../../types/schedule";
import type { ReservationMap, ReserveRequest } from "../../../types/reservations";
import type { User } from "../../../types/auth";
import { addDays, formatDateKey, parseDateKey, type WeekDate } from "../../../lib/date";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import { AddIcon, ReleaseIcon } from "../../../components/Icons";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";
import type { RoomMeta } from "../../../types/admin";

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
  footer?: ReactNode;
  nowMinutes?: number;
  todayDateKey?: string;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
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
  footer,
  nowMinutes,
  todayDateKey,
  onNavigatePrev,
  onNavigateNext
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
      return Number.isFinite(parsed) ? Math.max(0.6, Math.min(1.6, parsed)) : 1;
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

  const columnHeight = totalHours * rowHeight;
  const slotHeightFor = (slot: TimeSlot) => ((slot.endMinutes - slot.startMinutes) / 60) * rowHeight;
  const colGap = compact ? 2 : 4;
  const slotActionsEnabled = showSlotActions ?? interactive;
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
      const scaled = Math.max(12, Math.min(84, base * rowScaleRef.current));
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
    const scaled = Math.max(12, Math.min(84, base * rowScale));
    setRowHeight(scaled);
  }, [compact, rowScale, totalHours]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
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
          const next = Math.max(0.6, Math.min(1.6, state.startScale * (d1 / d0)));
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
  }, [onNavigateNext, onNavigatePrev]);

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
        kind: entry.kind,
        pending: !entry.kind && pendingReservationIdSet.has(entry.id)
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

    return (
      <div className="schedule-column" style={{ height: columnHeight }}>
        {showNowLine ? <div className="now-line" style={{ top: nowTop }} aria-hidden="true" /> : null}
        {slotActionsEnabled
          ? Array.from({ length: totalHours }, (_, index) => baseStartMinutes + index * 60).flatMap((hourStart) => {
              const hourEnd = hourStart + 60;
              const hourBusy = isSlotBusy(hourStart, hourEnd);
              const hourTop = ((hourStart - baseStartMinutes) / 60) * rowHeight;
              const hourHeight = rowHeight;

              const makeHit = (slotStart: number, slotEnd: number, showPlus: boolean) => {
                const top = ((slotStart - baseStartMinutes) / 60) * rowHeight;
                const height = ((slotEnd - slotStart) / 60) * rowHeight;
                const busy = isSlotBusy(slotStart, slotEnd);
                return (
                  <button
                    key={`${roomId}-${dateKey}-${slotStart}-${slotEnd}`}
                    className="slot-hit"
                    style={{ top, height }}
                    type="button"
                    aria-label="שמירה"
                    onClick={(event) => {
                      // Prevent the room-column click handler from firing; in "all rooms" we switch
                      // to the room view only when we actually open an overlay.
                      event.stopPropagation();
                      if (adminMode) {
                        if (view === "daily" && onRoomSelect) onRoomSelect(roomId, dateKey);
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
                      if (busy) return;
                      // Default action is a 1 hour reservation; user can adjust duration in the confirmation overlay.
                      onReserve({ date: dateKey, day: dayKey, time: slotStart, roomId, durationMinutes: 60 });
                    }}
                    disabled={busy}
                  >
                    <span className="slot-label">{showPlus && !busy ? <AddIcon /> : null}</span>
                  </button>
                );
              };

              // Prefer a full 1 hour hit area when the entire hour is free.
              if (!hourBusy) {
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
                        if (view === "daily" && onRoomSelect) onRoomSelect(roomId, dateKey);
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
          // If there's not enough vertical space for a dedicated meta line, render it inline to avoid clipping.
          // (Font sizes are fixed, so a fixed px threshold is more stable than a duration heuristic.)
          const canShowSecondLine = height >= 48;
          const showInlineMeta = showDetails && hasMeta && !canShowSecondLine;
          const showCompactMeta = showCompactDetails && hasMeta;
          return (
            <div
              key={block.id}
              className={`schedule-block ${block.type}${block.pending ? " pending" : ""}${compact ? " compact" : ""}`}
              style={{
                top,
                height,
                left: `calc(${leftPercent}% + ${gap / 2}px)`,
                width: `calc(${widthPercent}% - ${gap}px)`
              }}
              onClick={(event) => {
                // In "all rooms" view we open overlays *and* switch to the room view in the background.
                if (view === "daily" && onRoomSelect) {
                  event.stopPropagation();
                  onRoomSelect(roomId, dateKey);
                }
                if (adminMode) {
                  if (block.type === "lesson") {
                    onAdminLessonClick?.(block.id, dateKey);
                  } else {
                    onAdminReservationClick?.(block.reservationId, dateKey);
                  }
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
                    {block.pending ? <span className="block-pending-spinner" aria-hidden="true" /> : null}
                  </div>
                  {!showInlineMeta && hasMeta ? <p className="cell-meta">{primaryMeta}</p> : null}
                  {hasRoomLine ? <p className="cell-room">{roomLine}</p> : null}
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
                  <div className="compact-main">{block.title}</div>
                  {showCompactMeta ? <div className="compact-sub">{block.meta}</div> : null}
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
      <section className={`schedule${compact ? " compact" : ""}`}>
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
                  <button
                    key={room.id}
                    className={`grid-header${onRoomSelect ? " clickable" : ""}`}
                    type="button"
                    onClick={() => onRoomSelect?.(room.id, selectedDate)}
                  >
                    <span>{room.shortName || room.name}</span>
                  </button>
                ))}
              </div>
              <div className="time-header" aria-hidden="true" />
            </>
          ) : null}
          <div className="scroll-area schedule-scroll" ref={scrollRef} style={gridStyle}>
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
                    onClick={() => onRoomSelect?.(room.id, selectedDate)}
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
    <section className={`schedule${compact ? " compact" : ""}`}>
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
              {weekDates.map((day) => (
                <button
                  key={day.key}
                  className={`grid-header${onDateSelect ? " clickable" : ""}`}
                  type="button"
                  onClick={() => onDateSelect?.(day.dateKey)}
                >
                  <div>
                    {day.dateKey === todayDateKey
                      ? "היום"
                      : day.dateKey === tomorrowDateKey
                        ? "מחר"
                        : day.label}
                  </div>
                  <div className="grid-date">{day.shortDate}</div>
                </button>
              ))}
            </div>
            <div className="time-header" aria-hidden="true" />
          </>
        ) : null}
        <div className="scroll-area schedule-scroll" ref={scrollRef} style={gridStyle}>
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
