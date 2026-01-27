import { useMemo, useState } from "react";
import type { Reservation } from "../../../types/reservations";
import type { RoomRecord } from "../../../types/admin";
import { ApproveIcon, ReleaseIcon } from "../../../components/Icons";

type ReservationsSectionProps = {
  reservations: Reservation[];
  reservationsError: string;
  roomsRaw: RoomRecord[];
  toTimeInput: (minutes: number) => string;
  onRemoveReservation: (reservation: Reservation) => void;
  onUpdateReservation: (reservation: Reservation) => void;
};

type ReservationFilter = "all" | "regular" | "special" | "closed";

export default function ReservationsSection({
  reservations,
  reservationsError,
  roomsRaw,
  toTimeInput,
  onRemoveReservation,
  onUpdateReservation
}: ReservationsSectionProps) {
  const [filter, setFilter] = useState<ReservationFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Reservation | null>(null);

  const roomLookup = useMemo(() => {
    const lookup: Record<string, string> = {};
    roomsRaw.forEach((room) => {
      lookup[room.id] = room.name;
    });
    return lookup;
  }, [roomsRaw]);

  const counts = useMemo(() => {
    const base = {
      all: reservations.length,
      regular: 0,
      special: 0,
      closed: 0
    };
    reservations.forEach((reservation) => {
      if (reservation.kind === "special") base.special += 1;
      else if (reservation.kind === "closed") base.closed += 1;
      else base.regular += 1;
    });
    return base;
  }, [reservations]);

  const filteredReservations = useMemo(() => {
    if (filter === "all") return reservations;
    if (filter === "regular") return reservations.filter((reservation) => !reservation.kind);
    return reservations.filter((reservation) => reservation.kind === filter);
  }, [filter, reservations]);

  const selectedReservation = useMemo(() =>
    (selectedId ? reservations.find((reservation) => reservation.id === selectedId) || null : null),
  [reservations, selectedId]);

  const kindLabel = (reservation: Reservation) => {
    if (reservation.kind === "special") return "אירוע";
    if (reservation.kind === "closed") return "סגור";
    return "שריון";
  };

  const handleSelect = (reservation: Reservation) => {
    setSelectedId(reservation.id);
    setDraft({
      ...reservation,
      durationMinutes: reservation.durationMinutes || 60
    });
  };

  const handleDelete = () => {
    if (!draft) return;
    onRemoveReservation(draft);
    setSelectedId(null);
    setDraft(null);
  };

  const handleUpdate = () => {
    if (!draft) return;
    onUpdateReservation(draft);
  };

  return (
    <section className="admin-section">
      <div className="admin-section-toolbar">
        <div className="admin-filters">
          <button
            type="button"
            className={`chip small${filter === "all" ? " active" : ""}`}
            onClick={() => setFilter("all")}
          >
            הכל ({counts.all})
          </button>
          <button
            type="button"
            className={`chip small${filter === "regular" ? " active" : ""}`}
            onClick={() => setFilter("regular")}
          >
            שריונים ({counts.regular})
          </button>
          <button
            type="button"
            className={`chip small${filter === "special" ? " active" : ""}`}
            onClick={() => setFilter("special")}
          >
            אירועים ({counts.special})
          </button>
          <button
            type="button"
            className={`chip small${filter === "closed" ? " active" : ""}`}
            onClick={() => setFilter("closed")}
          >
            סגורים ({counts.closed})
          </button>
        </div>
        {reservationsError ? <span className="admin-error">{reservationsError}</span> : null}
      </div>
      <div className="admin-section-body">
        <aside className="admin-properties">
          <div className="admin-card">
            <div className="admin-card-header">
              <h3>פרטי שריון</h3>
              <span className="admin-meta">{draft?.date || "בחר שריון"}</span>
            </div>
            {draft ? (
              <>
                <div className="admin-form-grid">
                  <label>
                    שם
                    <input
                      type="text"
                      value={draft.reservedBy}
                      onChange={(event) => setDraft({ ...draft, reservedBy: event.target.value })}
                    />
                  </label>
                  <label>
                    אימייל
                    <input
                      type="email"
                      value={draft.reservedEmail}
                      onChange={(event) => setDraft({ ...draft, reservedEmail: event.target.value })}
                    />
                  </label>
                  <label>
                    סוג
                    <select
                      value={draft.kind || "regular"}
                      onChange={(event) => {
                        const value = event.target.value as "regular" | "special" | "closed";
                        setDraft({
                          ...draft,
                          kind: value === "regular" ? undefined : value
                        });
                      }}
                    >
                      <option value="regular">שריון</option>
                      <option value="special">אירוע</option>
                      <option value="closed">סגור</option>
                    </select>
                  </label>
                  <label>
                    משך (דקות)
                    <input
                      type="number"
                      min={15}
                      step={15}
                      value={draft.durationMinutes || 60}
                      onChange={(event) => setDraft({ ...draft, durationMinutes: Number(event.target.value) })}
                    />
                  </label>
                </div>
                <p className="admin-meta">
                  {kindLabel(draft)} · {draft.date} · {toTimeInput(draft.time)} · {roomLookup[draft.roomId] || draft.roomId}
                </p>
                <div className="admin-actions">
                  <button className="primary" type="button" onClick={handleUpdate}>
                    <ApproveIcon />
                    עדכון
                  </button>
                  <button className="secondary danger" type="button" onClick={handleDelete}>
                    <ReleaseIcon />
                    מחיקה
                  </button>
                </div>
              </>
            ) : (
              <p className="admin-meta">בחר שריון מהרשימה כדי לערוך או למחוק.</p>
            )}
          </div>
        </aside>
        <div className="admin-list">
          <div className="admin-card list-card">
            <div className="admin-card-header">
              <h3>רשימת שריונים</h3>
            </div>
            {filteredReservations.length ? (
              <div className="admin-table scroll tall">
                {filteredReservations.map((reservation) => (
                  <div
                    key={reservation.id}
                    className={`admin-row clickable${selectedId === reservation.id ? " selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelect(reservation)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleSelect(reservation);
                      }
                    }}
                  >
                    <div>
                      <p className="admin-row-title">
                        {reservation.reservedBy || reservation.reservedEmail || "ללא שם"}
                      </p>
                      <p className="admin-row-meta">
                        {kindLabel(reservation)} · {reservation.date} · {toTimeInput(reservation.time)} · {(reservation.durationMinutes || 60)} דק׳ · {roomLookup[reservation.roomId] || reservation.roomId}
                      </p>
                      {reservation.reservedEmail ? (
                        <p className="admin-row-meta">{reservation.reservedEmail}</p>
                      ) : null}
                    </div>
                    <div className="admin-row-actions">
                      <span className="chip small ghost">{kindLabel(reservation)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="admin-meta">אין שריונים במסנן הזה.</p>
            )}
          </div>
        </div>
      </div>

    </section>
  );
}
