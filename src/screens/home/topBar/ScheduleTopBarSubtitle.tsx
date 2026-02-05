import { useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, RoomIcon } from "../../../components/Icons";
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
  dateInputRef,
  setAllRooms,
  setRoomMode,
  setSelectedRoom,
  setSelectedDate
}: ScheduleTopBarSubtitleProps) {
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

  const roomControl = allRooms ? (
    <button type="button" className="top-bar-room-all" onClick={() => setAllRooms(false)} aria-label="בחירת חדר">
      כל החדרים
    </button>
  ) : (
    <label className="top-bar-select inline no-caret">
      <span className="sr-only">חדר</span>
      <select
        value={selectedRoom}
        onChange={(event) => {
          setAllRooms(false);
          setSelectedRoom(event.target.value);
        }}
      >
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
            <button
              type="button"
              className="top-bar-mode-mini"
              onClick={() => {
                setAllRooms(false);
                setRoomMode((prev) => (prev === "day" ? "week" : "day"));
              }}
              aria-pressed={roomMode === "week"}
              aria-label="החלפת תצוגה"
            >
              <CalendarIcon />
              <span>תצוגה שבועית</span>
            </button>
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
              onClick={() => {
                setAllRooms((prev) => {
                  const next = !prev;
                  if (next) setRoomMode("day");
                  return next;
                });
              }}
              aria-pressed={allRooms}
              aria-label="תצוגת כל החדרים"
            >
              <RoomIcon />
              <span>כל החדרים</span>
            </button>
          </div>
          <div className="top-bar-room-pill">
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

