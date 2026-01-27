import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { RoomRecord } from "../../../types/admin";
import { rimonScheduleConfig } from "../../../config";
import { AddIcon, ApproveIcon, ReleaseIcon } from "../../../components/Icons";

type RoomsSectionProps = {
  roomsRaw: RoomRecord[];
  roomsError: string;
  roomDraft: RoomRecord;
  setRoomDraft: Dispatch<SetStateAction<RoomRecord>>;
  toTimeInput: (minutes: number) => string;
  parseTimeInput: (value: string) => number;
  onUpsert: (room: RoomRecord) => void;
  onRemove: (roomId: string) => void;
  onReset: () => void;
};

type RoomFilter = "all" | "open" | "closed";

export default function RoomsSection({
  roomsRaw,
  roomsError,
  roomDraft,
  setRoomDraft,
  toTimeInput,
  parseTimeInput,
  onUpsert,
  onRemove,
  onReset
}: RoomsSectionProps) {
  const [filter, setFilter] = useState<RoomFilter>("all");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [isNewEntry, setIsNewEntry] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const filteredRooms = useMemo(() => {
    if (filter === "all") return roomsRaw;
    if (filter === "closed") return roomsRaw.filter((room) => room.isClosed);
    return roomsRaw.filter((room) => !room.isClosed);
  }, [filter, roomsRaw]);

  const selectedRoom = useMemo(() =>
    (selectedRoomId ? roomsRaw.find((room) => room.id === selectedRoomId) || null : null),
  [roomsRaw, selectedRoomId]);

  const handleSelect = (room: RoomRecord) => {
    setSelectedRoomId(room.id);
    setRoomDraft({
      ...room,
      openMinutes: room.openMinutes ?? rimonScheduleConfig.startHour * 60,
      closeMinutes: room.closeMinutes ?? rimonScheduleConfig.endHour * 60
    });
    setIsEditing(true);
    setIsNewEntry(false);
  };

  const handleNew = () => {
    setSelectedRoomId(null);
    onReset();
    setIsEditing(true);
    setIsNewEntry(true);
  };

  const handleDelete = () => {
    if (!selectedRoomId) return;
    onRemove(selectedRoomId);
    setSelectedRoomId(null);
    onReset();
    setIsEditing(false);
    setIsNewEntry(false);
  };

  const roomStatus = isEditing ? (selectedRoom?.name || "חדש") : "";

  return (
    <section className="admin-section">
      <div className="admin-section-toolbar">
        <div className="admin-filters">
          <button
            type="button"
            className={`chip small${filter === "all" ? " active" : ""}`}
            onClick={() => setFilter("all")}
          >
            הכל ({roomsRaw.length})
          </button>
          <button
            type="button"
            className={`chip small${filter === "open" ? " active" : ""}`}
            onClick={() => setFilter("open")}
          >
            פתוחים ({roomsRaw.filter((room) => !room.isClosed).length})
          </button>
          <button
            type="button"
            className={`chip small${filter === "closed" ? " active" : ""}`}
            onClick={() => setFilter("closed")}
          >
            סגורים ({roomsRaw.filter((room) => room.isClosed).length})
          </button>
        </div>
        {roomsError ? <span className="admin-error">{roomsError}</span> : null}
      </div>
      <div className="admin-section-body">
        <aside className="admin-properties">
          <div className="admin-card">
            <div className="admin-card-header">
              <h3>פרטי חדר</h3>
              {roomStatus ? <span className="admin-meta">{roomStatus}</span> : null}
            </div>
            <fieldset className="admin-fieldset" disabled={!isEditing}>
              <div className="admin-form-grid">
                <label>
                  מזהה
                  <input
                    type="text"
                    value={roomDraft.id}
                    onChange={(event) => setRoomDraft((prev) => ({ ...prev, id: event.target.value }))}
                  />
                </label>
                <label>
                  שם
                  <input
                    type="text"
                    value={roomDraft.name}
                    onChange={(event) => setRoomDraft((prev) => ({ ...prev, name: event.target.value }))}
                  />
                </label>
                <label>
                  קיצור
                  <input
                    type="text"
                    value={roomDraft.shortName}
                    onChange={(event) => setRoomDraft((prev) => ({ ...prev, shortName: event.target.value }))}
                  />
                </label>
                <label>
                  פתיחה
                  <input
                    type="time"
                    value={toTimeInput(roomDraft.openMinutes ?? rimonScheduleConfig.startHour * 60)}
                    onChange={(event) =>
                      setRoomDraft((prev) => ({ ...prev, openMinutes: parseTimeInput(event.target.value) }))
                    }
                  />
                </label>
                <label>
                  סגירה
                  <input
                    type="time"
                    value={toTimeInput(roomDraft.closeMinutes ?? rimonScheduleConfig.endHour * 60)}
                    onChange={(event) =>
                      setRoomDraft((prev) => ({ ...prev, closeMinutes: parseTimeInput(event.target.value) }))
                    }
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={roomDraft.isClosed}
                    onChange={(event) => setRoomDraft((prev) => ({ ...prev, isClosed: event.target.checked }))}
                  />
                  סגור זמנית
                </label>
                <label>
                  סדר תצוגה
                  <input
                    type="number"
                    value={roomDraft.sortOrder}
                    onChange={(event) => setRoomDraft((prev) => ({ ...prev, sortOrder: Number(event.target.value) }))}
                  />
                </label>
              </div>
              <div className="admin-actions">
                <button className="primary" type="button" onClick={() => onUpsert(roomDraft)} disabled={!isEditing}>
                  <ApproveIcon />
                  {isNewEntry ? "הוספה" : "עדכון"}
                </button>
                <button
                  className="secondary danger"
                  type="button"
                  onClick={handleDelete}
                  disabled={!isEditing || !selectedRoomId}
                >
                  <ReleaseIcon />
                  מחיקה
                </button>
              </div>
            </fieldset>
          </div>
        </aside>
        <div className="admin-list">
          <div className="admin-card list-card">
            <div className="admin-card-header">
              <h3>רשימת חדרים</h3>
              <button className="admin-card-action" type="button" onClick={handleNew}>
                <AddIcon />
                הוספה
              </button>
            </div>
            {filteredRooms.length ? (
              <div className="admin-table scroll tall">
                {filteredRooms.map((room) => (
                  <div
                    key={room.id}
                    className={`admin-row clickable${selectedRoomId === room.id ? " selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelect(room)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleSelect(room);
                      }
                    }}
                  >
                    <div>
                      <p className="admin-row-title">{room.name}</p>
                      <p className="admin-row-meta">
                        {room.shortName} · {toTimeInput(room.openMinutes || 0)}-{toTimeInput(room.closeMinutes || 0)}
                        {room.isClosed ? " · סגור" : ""}
                      </p>
                    </div>
                    <div className="admin-row-actions">
                      <span className={`chip small${room.isClosed ? " active" : " ghost"}`}>
                        {room.isClosed ? "סגור" : "פתוח"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="admin-meta">אין חדרים במסנן הזה.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
