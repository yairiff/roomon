import type { DayKey, Lesson, Room, TimeSlot } from "../../../types/schedule";
import type { ReservationMap, ReserveRequest } from "../../../types/reservations";
import type { User } from "../../../types/auth";
import type { WeekDate } from "../../../lib/date";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import { AddIcon, CloseIcon, ReleaseIcon } from "../../../components/Icons";
import { useLayoutEffect, useMemo, useRef, useState, type UIEvent } from "react";
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
  onRelease: (dateKey: string, reservationId: string) => void;
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
  reserveDraft?: ReserveRequest | null;
  reserveOptions?: { durationMinutes: number; endMinutes: number }[];
  onSelectOption?: (durationMinutes: number) => void;
  onCancelDraft?: () => void;
};

const BASE_ROW_HEIGHT = 40;

type LessonBlock = {
  id: string;
  type: "lesson";
  title: string;
  meta: string;
  startMinutes: number;
  durationMinutes: number;
};

type ReservationBlock = {
  id: string;
  type: "reserved" | "special" | "closed";
  title: string;
  meta: string;
  startMinutes: number;
  durationMinutes: number;
  reservationId: string;
  reservedEmail: string;
  kind?: "special" | "closed";
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
  onRelease,
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
  reserveDraft,
  reserveOptions = [],
  onSelectOption,
  onCancelDraft
}: ScheduleGridProps) {
  const baseStartMinutes = startHour * 60;
  const baseEndMinutes = endHour * 60;
  const totalHours = endHour - startHour;
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(BASE_ROW_HEIGHT);
  const columnHeight = totalHours * rowHeight;
  const slotHeightFor = (slot: TimeSlot) => ((slot.endMinutes - slot.startMinutes) / 60) * rowHeight;
  const gridStyle = useMemo(
    () => ({ ["--row-height" as string]: `${rowHeight}px` }),
    [rowHeight]
  );

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (timeRef.current) {
      timeRef.current.scrollTop = event.currentTarget.scrollTop;
    }
  };

  useLayoutEffect(() => {
    if (!scrollRef.current) return;

    const update = () => {
      if (!scrollRef.current) return;
      const scrollHeight = scrollRef.current.clientHeight;
      const headerHeight = headerRef.current
        ? headerRef.current.clientHeight + 6
        : 0;
      const available = scrollHeight - headerHeight;
      if (available <= 0) return;
      const next = Math.max(BASE_ROW_HEIGHT, available / totalHours);
      setRowHeight(next);
    };

    update();

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (observer) {
      observer.observe(scrollRef.current);
      if (headerRef.current) observer.observe(headerRef.current);
    }

    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [showHeaders, totalHours]);

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
        type: entry.kind === "special" ? "special" : entry.kind === "closed" ? "closed" : "reserved",
        title: entry.kind === "special" ? "אירוע" : entry.kind === "closed" ? "סגור" : "שמור",
        meta: entry.reservedBy || "",
        startMinutes: entry.time,
        durationMinutes: entry.durationMinutes,
        reservationId: entry.id,
        reservedEmail: entry.reservedEmail || "",
        kind: entry.kind
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

    const roomPolicy = roomMeta?.[roomId];
    const roomOpen = roomPolicy?.openMinutes ?? baseStartMinutes;
    const roomClose = roomPolicy?.closeMinutes ?? baseEndMinutes;
    const isRoomClosed = Boolean(roomPolicy?.isClosed);

    const isSlotBusy = (slotStart: number, slotEnd: number) => {
      if (isRoomClosed) return true;
      if (slotStart < roomOpen || slotEnd > roomClose) return true;
      return blocks.some((block) => {
        const blockStart = block.startMinutes;
        const blockEnd = block.startMinutes + block.durationMinutes;
        return blockStart < slotEnd && blockEnd > slotStart;
      });
    };

    const optionActive = Boolean(
      reserveDraft &&
      reserveDraft.roomId === roomId &&
      reserveDraft.day === dayKey &&
      reserveDraft.date === dateKey &&
      reserveOptions.length
    );
    const optionHeight = rowHeight / 2;
    const hideSlots = Boolean(reserveDraft && reserveOptions.length);

    return (
      <div className="schedule-column" style={{ height: columnHeight }}>
        {!optionActive && !hideSlots
          ? timeSlots.map((slot) => {
          const slotStart = slot.startMinutes;
          const slotEnd = slot.endMinutes;
          const top = ((slotStart - baseStartMinutes) / 60) * rowHeight;
          const height = slotHeightFor(slot);
          const busy = isSlotBusy(slotStart, slotEnd);
          return (
            <button
              key={`${roomId}-${dateKey}-${slotStart}`}
              className="slot-hit"
              style={{ top, height }}
              type="button"
              aria-label="שמירה"
              onClick={(event) => {
                if (view === "daily" && onRoomSelect) {
                  event.stopPropagation();
                }
                if (adminMode) {
                  onAdminSlotClick?.({ date: dateKey, day: dayKey, time: slotStart, roomId });
                  return;
                }
                if (!currentUser?.allowed) {
                  onReserve({ date: dateKey, day: dayKey, time: slotStart, roomId });
                  return;
                }
                if (busy) return;
                onReserve({ date: dateKey, day: dayKey, time: slotStart, roomId });
              }}
              disabled={busy}
            >
              <span className="slot-label">
                <AddIcon />
              </span>
            </button>
          );
        })
          : null}

        {optionActive ? (
          <>
            <div
              className="schedule-option"
              style={{
                top: ((reserveDraft.time - baseStartMinutes) / 60) * rowHeight,
                height: rowHeight / 2,
                ["--first-hour-height" as string]: `${rowHeight / 2}px`
              }}
            >
              <div className="schedule-option-label">
                <span>מ-{formatMinutes(reserveDraft.time)} עד (בחר שעת סיום):</span>
              </div>
              <button
                type="button"
                className="option-close"
                onClick={() => onCancelDraft?.()}
                aria-label="ביטול"
              >
                <CloseIcon />
              </button>
            </div>
            {reserveOptions.map((option) => {
              const durationHours = option.durationMinutes / 60;
              const durationLabel =
                durationHours === 1 ? "שעה" : durationHours === 2 ? "שעתיים" : `${durationHours} שעות`;
              const endTop = ((option.endMinutes - baseStartMinutes) / 60) * rowHeight;
              return (
                <button
                  key={option.durationMinutes}
                  type="button"
                  className="schedule-option-end"
                  style={{ top: Math.max(0, endTop - optionHeight), height: optionHeight }}
                  onClick={() => onSelectOption?.(option.durationMinutes)}
                >
                  <span className="schedule-option-end-label">
                    {formatMinutes(option.endMinutes)} · {durationLabel}
                  </span>
                </button>
              );
            })}
          </>
        ) : null}
        {positionedBlocks.map((block) => {
          const rawStart = block.startMinutes;
          const rawEnd = block.startMinutes + block.durationMinutes;
          const clampedStart = Math.max(rawStart, baseStartMinutes);
          const clampedEnd = Math.min(rawEnd, baseEndMinutes);
          if (clampedEnd <= clampedStart) return null;

          const blockGap = 6;
          const top = ((clampedStart - baseStartMinutes) / 60) * rowHeight + blockGap / 2;
          const height = Math.max(0, ((clampedEnd - clampedStart) / 60) * rowHeight - blockGap);
          const columns = columnsById.get(block.id) ?? 1;
          const widthPercent = 100 / columns;
          const leftPercent = block.column * widthPercent;
          const gap = 6;

          const showDetails = !compact;
          const showCompactDetails = compact;
          const showCompactText = compact && (view !== "daily" || compactLabel === "status");
          const statusLabel = block.type === "reserved"
            ? "שמור"
            : block.type === "special"
              ? "אירוע"
              : block.type === "closed"
                ? "סגור"
                : "שיעור";
          const compactText = compactLabel === "status" ? statusLabel : block.title;
          const isShortLesson = block.type === "lesson" && block.durationMinutes <= 30;
          const isShortBlock = block.durationMinutes <= 45 || height < rowHeight * 0.6;
          const showInlineMeta = (isShortLesson || isShortBlock) && Boolean(block.meta);
          return (
            <div
              key={block.id}
              className={`schedule-block ${block.type}${compact ? " compact" : ""}${isShortLesson ? " short" : ""}`}
              style={{
                top,
                height,
                left: `calc(${leftPercent}% + ${gap / 2}px)`,
                width: `calc(${widthPercent}% - ${gap}px)`
              }}
              onClick={() => {
                if (adminMode) {
                  if (block.type === "lesson") {
                    onAdminLessonClick?.(block.id, dateKey);
                  } else {
                    onAdminReservationClick?.(block.reservationId, dateKey);
                  }
                  return;
                }
                if (block.type === "reserved") {
                  onReservationClick?.(block.reservationId, dateKey);
                  return;
                }
                if (view === "room" && onDateSelect) {
                  onDateSelect(dateKey);
                }
              }}
            >
              {showDetails ? (
                <>
                  <div className="block-header">
                    <span className={`block-dot ${block.type}`} />
                    <p className="cell-title">
                      {block.title}
                      {showInlineMeta ? <span className="cell-meta-inline"> · {block.meta}</span> : null}
                    </p>
                  </div>
                  {!showInlineMeta ? <p className="cell-meta">{block.meta}</p> : null}
                  {block.type === "reserved" && currentUser?.allowed && block.reservedEmail === currentUser.email ? (
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
                showCompactText ? (
                  <p
                    className={`cell-title compact-title compact-ellipsis${
                      compactLabel === "status" ? " compact-status" : ""
                    }`}
                  >
                    <span className={`block-dot ${block.type}`} />
                    {compactText}
                  </p>
                ) : (
                  <span className={`block-dot ${block.type} compact-dot`} />
                )
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const renderTimeRail = () => (
    <div className="time-rail">
      <div className="time-header" aria-hidden="true" />
      <div className="time-column" ref={timeRef} style={{ height: columnHeight }}>
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
        <div className="schedule-shell">
          <div className="scroll-area" ref={scrollRef} onScroll={handleScroll} style={gridStyle}>
            {showHeaders ? (
              <div
                className="column-headers"
                ref={headerRef}
                style={{
                  gridTemplateColumns: compactGridTemplate ?? `repeat(${rooms.length}, minmax(var(--schedule-col-min), 1fr))`
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
            ) : (
              <div className="column-headers header-spacer" ref={headerRef} aria-hidden="true" />
            )}
            <div
              className="columns-body"
              style={{
                gridTemplateColumns: compactGridTemplate ?? `repeat(${rooms.length}, minmax(var(--schedule-col-min), 1fr))`
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
          </div>
          {renderTimeRail()}
        </div>
      </section>
    );
  }

  return (
    <section className={`schedule${compact ? " compact" : ""}`}>
      <div className="schedule-shell">
        <div className="scroll-area" ref={scrollRef} onScroll={handleScroll} style={gridStyle}>
          {showHeaders ? (
            <div
              className="column-headers"
              ref={headerRef}
              style={{
                gridTemplateColumns: compactGridTemplate ?? `repeat(${weekDates.length}, minmax(var(--schedule-col-min), 1fr))`
              }}
            >
              {weekDates.map((day) => (
                <button
                  key={day.key}
                  className={`grid-header${onDateSelect ? " clickable" : ""}`}
                  type="button"
                  onClick={() => onDateSelect?.(day.dateKey)}
                >
                  <div>{day.label}</div>
                  <div className="grid-date">{day.shortDate}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="column-headers header-spacer" ref={headerRef} aria-hidden="true" />
          )}
          <div
            className="columns-body"
            style={{
              gridTemplateColumns: compactGridTemplate ?? `repeat(${weekDates.length}, minmax(var(--schedule-col-min), 1fr))`
            }}
          >
            {weekDates.map((day) => (
              <div key={day.key} className="room-column">
                {renderColumn({ dayKey: day.key, dateKey: day.dateKey, roomId: selectedRoom })}
              </div>
            ))}
          </div>
        </div>
        {renderTimeRail()}
      </div>
    </section>
  );
}
