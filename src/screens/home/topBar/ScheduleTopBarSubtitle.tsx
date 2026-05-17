import { useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import { ChevronLeftIcon, ChevronRightIcon, RoomIcon } from "../../../components/Icons";
import type { Room } from "../../../types/schedule";

type ScheduleTopBarSubtitleProps = {
  rooms: Room[];
  selectedRoom: string;
  allRooms: boolean;
  roomMode: "day" | "week";
  selectedDate: string;
  navText: string;
  onPrev: () => void;
  onNext: () => void;
  onOpenDatePicker: () => void;
  onToggleAllRooms: () => void;
  dateInputRef: RefObject<HTMLInputElement>;
  setAllRooms: Dispatch<SetStateAction<boolean>>;
  setRoomMode: Dispatch<SetStateAction<"day" | "week">>;
  setSelectedRoom: Dispatch<SetStateAction<string>>;
  setSelectedDate: Dispatch<SetStateAction<string>>;
};

export default function ScheduleTopBarSubtitle({
  rooms,
  selectedRoom,
  allRooms,
  roomMode,
  selectedDate,
  navText,
  onPrev,
  onNext,
  onOpenDatePicker,
  onToggleAllRooms,
  dateInputRef,
  setAllRooms,
  setRoomMode,
  setSelectedRoom,
  setSelectedDate
}: ScheduleTopBarSubtitleProps) {
  const ALL_ROOMS_VALUE = "__all_rooms__";
  const roomOptions = useMemo(
    () => rooms.map((room) => ({ id: room.id, label: room.name || room.shortName || room.id })),
    [rooms]
  );
  const roomIdList = useMemo(() => roomOptions.map((opt) => opt.id), [roomOptions]);
  const roomIndex = Math.max(0, roomIdList.indexOf(selectedRoom));

  const shiftRoom = (delta: number) => {
    if (!roomIdList.length) return;
    const next = (roomIndex + delta + roomIdList.length) % roomIdList.length;
    setAllRooms(false);
    setSelectedRoom(roomIdList[next]);
  };

  const roomControl = (
    <label className="top-bar-select inline no-caret">
      <span className="sr-only">חדר</span>
      <select
        value={allRooms ? ALL_ROOMS_VALUE : selectedRoom}
        onChange={(event) => {
          if (event.target.value === ALL_ROOMS_VALUE) {
            setAllRooms(true);
            return;
          }
          setAllRooms(false);
          setSelectedRoom(event.target.value);
        }}
      >
        <option value={ALL_ROOMS_VALUE}>כל החדרים</option>
        {roomOptions.map((room) => (
          <option key={room.id} value={room.id}>
            {room.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="top-bar-schedule">
      <div className="top-bar-schedule-row">
        <div className="top-bar-field schedule-date">
          <div className="top-bar-field-hints">
            <span className="top-bar-field-hint">תאריך</span>
            <div className="top-bar-mode-group" role="tablist" aria-label="תצוגת מערכת">
              <button
                type="button"
                className="top-bar-mode-mini"
                aria-pressed={roomMode === "day"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setAllRooms(false);
                  setRoomMode("day");
                }}
              >
                יומי
              </button>
              <button
                type="button"
                className="top-bar-mode-mini"
                aria-pressed={roomMode === "week"}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setAllRooms(false);
                  setRoomMode("week");
                }}
              >
                שבועי
              </button>
            </div>
          </div>
          <div className="top-bar-date-pill schedule">
            <button type="button" className="icon-button inline" onClick={onPrev} aria-label="הקודם">
              <ChevronRightIcon />
            </button>
            <button type="button" className="top-bar-date-button" onClick={onOpenDatePicker}>
              {navText}
            </button>
            <button type="button" className="icon-button inline" onClick={onNext} aria-label="הבא">
              <ChevronLeftIcon />
            </button>
          </div>
          <input
            ref={dateInputRef}
            className="top-bar-date-input"
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </div>

        <div className="top-bar-field schedule-room">
          <div className="top-bar-field-hints">
            <span className="top-bar-field-hint">חדר</span>
            <button
              type="button"
              className="top-bar-mode-mini"
              onClick={onToggleAllRooms}
              aria-pressed={allRooms}
              aria-label="תצוגת כל החדרים"
            >
              <RoomIcon />
              <span>כל החדרים</span>
            </button>
          </div>
          <div className="top-bar-date-pill schedule top-bar-room-pill">
            <button type="button" className="icon-button inline" onClick={() => shiftRoom(-1)} aria-label="חדר קודם">
              <ChevronRightIcon />
            </button>
            {roomControl}
            <button type="button" className="icon-button inline" onClick={() => shiftRoom(1)} aria-label="חדר הבא">
              <ChevronLeftIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
