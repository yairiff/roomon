import { useEffect, useState } from "react";

type RoomOption = {
  id: string;
  name: string;
};

export type MyScheduleAddOverlayProps = {
  open: boolean;
  dateLine: string;
  timeLine: string;
  roomOptions: RoomOption[];
  onContinueReservation: (roomId: string) => void;
  onAddPersonalBlock: (note: string) => void;
  onClose: () => void;
};

export default function MyScheduleAddOverlay({
  open,
  dateLine,
  timeLine,
  roomOptions,
  onContinueReservation,
  onAddPersonalBlock,
  onClose
}: MyScheduleAddOverlayProps) {
  const [mode, setMode] = useState<"reservation" | "closed">("reservation");
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    if (roomOptions.length) {
      setSelectedRoomId(roomOptions[0].id);
      setMode("reservation");
    } else {
      setSelectedRoomId("");
      setMode("closed");
    }
    setNote("");
  }, [open, roomOptions]);

  if (!open) return null;

  return (
    <div className="reserve-overlay" onClick={onClose}>
      <div className="reserve-menu my-schedule-add-menu" onClick={(event) => event.stopPropagation()}>
        <p className="reserve-title">הוספה למערכת שלי</p>
        <div className="reserve-details">
          <p className="reserve-date">{dateLine}</p>
          <p className="reserve-time">{timeLine}</p>
        </div>

        <div className="my-schedule-add-modes" role="tablist" aria-label="סוג הוספה">
          <button
            type="button"
            className={`my-schedule-add-mode${mode === "reservation" ? " active" : ""}`}
            onClick={() => setMode("reservation")}
            aria-pressed={mode === "reservation"}
          >
            שריון
          </button>
          <button
            type="button"
            className={`my-schedule-add-mode${mode === "closed" ? " active" : ""}`}
            onClick={() => setMode("closed")}
            aria-pressed={mode === "closed"}
          >
            בלוק אישי
          </button>
        </div>

        {mode === "reservation" ? (
          <div className="reserve-field reserve-note-field">
            <label htmlFor="my-schedule-room" className="reserve-field-hint reserve-note-label">
              חדרים פנויים בסלוט הזה
            </label>
            <select
              id="my-schedule-room"
              value={selectedRoomId}
              onChange={(event) => setSelectedRoomId(event.target.value)}
              disabled={!roomOptions.length}
            >
              {roomOptions.length ? (
                roomOptions.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))
              ) : (
                <option value="">אין חדרים פנויים</option>
              )}
            </select>
          </div>
        ) : (
          <div className="reserve-field reserve-note-field">
            <label htmlFor="my-schedule-note" className="reserve-field-hint reserve-note-label">
              תיאור חופשי
            </label>
            <textarea
              id="my-schedule-note"
              className="reserve-note-input"
              rows={3}
              maxLength={120}
              placeholder="למשל: זמן עבודה מרוכז"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        )}

        <div className="reserve-actions">
          <button className="secondary" type="button" onClick={onClose}>
            ביטול
          </button>
          {mode === "reservation" ? (
            <button
              className="primary"
              type="button"
              disabled={!selectedRoomId}
              onClick={() => onContinueReservation(selectedRoomId)}
            >
              המשך
            </button>
          ) : (
            <button className="primary" type="button" onClick={() => onAddPersonalBlock(note.trim())}>
              הוספה
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
