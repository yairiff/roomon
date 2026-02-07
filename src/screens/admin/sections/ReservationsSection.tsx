import { useEffect, useMemo, useRef, useState } from "react";
import type { Reservation } from "../../../types/reservations";
import type { RoomRecord } from "../../../types/admin";
import { AddIcon, ApproveIcon, DuplicateIcon, EditIcon, ReleaseIcon } from "../../../components/Icons";
import ConfirmDialog from "../components/ConfirmDialog";

type ReservationsSectionProps = {
  reservations: Reservation[];
  reservationsError: string;
  roomsRaw: RoomRecord[];
  toTimeInput: (minutes: number) => string;
  onRemoveReservation: (reservation: Reservation) => void;
  onUpdateReservation: (reservation: Reservation) => void;
  forcedFilter?: ReservationFilter;
  showFilters?: boolean;
  onFilteredReservationsChange?: (reservations: Reservation[]) => void;
};

type ReservationFilter = "all" | "regular" | "special" | "exam" | "closed";
type ReservationSort = "date_asc" | "date_desc" | "name" | "room";

export default function ReservationsSection({
  reservations,
  reservationsError,
  roomsRaw,
  toTimeInput,
  onRemoveReservation,
  onUpdateReservation,
  forcedFilter,
  showFilters = true,
  onFilteredReservationsChange
}: ReservationsSectionProps) {
  const [filter, setFilter] = useState<ReservationFilter>("all");
  const effectiveFilter = forcedFilter ?? filter;
  const [query, setQuery] = useState("");
  const [roomFilter, setRoomFilter] = useState<string>("all");
  const [dateStart, setDateStart] = useState<string>("");
  const [dateEnd, setDateEnd] = useState<string>("");
  const [sortBy, setSortBy] = useState<ReservationSort>("date_asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
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
      exam: 0,
      closed: 0
    };
    reservations.forEach((reservation) => {
      if (reservation.kind === "special") base.special += 1;
      else if (reservation.kind === "exam") base.exam += 1;
      else if (reservation.kind === "closed") base.closed += 1;
      else base.regular += 1;
    });
    return base;
  }, [reservations]);

  const filteredReservations = useMemo(() => {
    let list =
      effectiveFilter === "all"
        ? reservations
        : effectiveFilter === "regular"
          ? reservations.filter((reservation) => !reservation.kind)
          : reservations.filter((reservation) => reservation.kind === effectiveFilter);

    if (roomFilter !== "all") {
      list = list.filter((reservation) => reservation.roomId === roomFilter);
    }

    if (dateStart) {
      list = list.filter((reservation) => reservation.date >= dateStart);
    }
    if (dateEnd) {
      list = list.filter((reservation) => reservation.date <= dateEnd);
    }

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((reservation) => {
        const roomName = roomLookup[reservation.roomId] || reservation.roomId;
        const haystack = [
          reservation.reservedBy || "",
          reservation.reservedEmail || "",
          reservation.date,
          roomName,
          kindLabel(reservation)
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      });
    }

    return [...list].sort((a, b) => {
      const aRoom = roomLookup[a.roomId] || a.roomId;
      const bRoom = roomLookup[b.roomId] || b.roomId;
      const aName = (a.reservedBy || a.reservedEmail || "").trim();
      const bName = (b.reservedBy || b.reservedEmail || "").trim();
      if (sortBy === "date_desc") {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        if (a.time !== b.time) return b.time - a.time;
        return a.roomId.localeCompare(b.roomId);
      }
      if (sortBy === "name") {
        return aName.localeCompare(bName, "he") || a.date.localeCompare(b.date) || a.time - b.time;
      }
      if (sortBy === "room") {
        return aRoom.localeCompare(bRoom, "he") || a.date.localeCompare(b.date) || a.time - b.time;
      }
      // date_asc
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.time !== b.time) return a.time - b.time;
      return a.roomId.localeCompare(b.roomId);
    });
  }, [dateEnd, dateStart, effectiveFilter, query, reservations, roomFilter, roomLookup, sortBy]);

  const filteredById = useMemo(() => {
    const map = new Map<string, Reservation>();
    filteredReservations.forEach((r) => map.set(r.id, r));
    return map;
  }, [filteredReservations]);

  const selectedInView = useMemo(
    () => Array.from(selectedIds).filter((id) => filteredById.has(id)),
    [filteredById, selectedIds]
  );

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    const total = filteredReservations.length;
    const selectedCount = selectedInView.length;
    el.indeterminate = selectedCount > 0 && selectedCount < total;
  }, [filteredReservations.length, selectedInView.length]);

  useEffect(() => {
    onFilteredReservationsChange?.(filteredReservations);
  }, [filteredReservations, onFilteredReservationsChange]);

  const selectedReservation = useMemo(() =>
    (selectedId ? reservations.find((reservation) => reservation.id === selectedId) || null : null),
  [reservations, selectedId]);

  const parseTimeValue = (value: string) => {
    const trimmed = value.trim();
    if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return null;
    const [hoursText, minutesText] = trimmed.split(":");
    const hours = Number(hoursText);
    const mins = Number(minutesText);
    if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
    if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
    return hours * 60 + mins;
  };

  const kindLabel = (reservation: Reservation) => {
    if (reservation.kind === "special") return "אירוע";
    if (reservation.kind === "exam") return "מבחן";
    if (reservation.kind === "closed") return "סגירה";
    return "שריון";
  };

  const propertiesTitle = draft
    ? kindLabel(draft) === "שריון"
      ? "פרטי שריון"
      : kindLabel(draft) === "אירוע"
        ? "פרטי אירוע"
        : kindLabel(draft) === "מבחן"
          ? "פרטי מבחן"
        : "פרטי סגירה"
    : "פרטי רשומה";

  const handleSelect = (reservation: Reservation) => {
    setSelectedId(reservation.id);
    setDraft({
      ...reservation,
      durationMinutes: reservation.durationMinutes || 60
    });
  };

  const newId = () =>
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `res-${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const handleNew = () => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const firstRoom = roomsRaw[0]?.id || "";
    const kindFromFilter =
      effectiveFilter === "special" ? "special" : effectiveFilter === "exam" ? "exam" : effectiveFilter === "closed" ? "closed" : undefined;
    const base: Reservation = {
      id: newId(),
      date,
      time: 9 * 60,
      durationMinutes: 60,
      roomId: roomFilter !== "all" ? roomFilter : firstRoom,
      reservedBy:
        kindFromFilter === "special" ? "אירוע חדש" : kindFromFilter === "exam" ? "מבחן חדש" : kindFromFilter === "closed" ? "סגור זמנית" : "אדמין",
      reservedEmail: "",
      ...(kindFromFilter ? { kind: kindFromFilter } : {})
    };
    setSelectedId(base.id);
    setDraft(base);
  };

  const duplicateReservation = (reservation: Reservation) => {
    const kind =
      reservation.kind === "special" || reservation.kind === "exam" || reservation.kind === "closed" ? reservation.kind : undefined;
    const copy: Reservation = {
      ...reservation,
      id: newId(),
      reservedBy: reservation.reservedBy ? `${reservation.reservedBy} (עותק)` : "עותק",
      ...(kind ? { kind } : {})
    };
    onUpdateReservation(copy);
    setSelectedId(copy.id);
    setDraft(copy);
  };

  const handleDelete = () => {
    if (!draft) return;
    setConfirmDeleteIds([draft.id]);
  };

  const handleUpdate = () => {
    if (!draft) return;
    onUpdateReservation(draft);
  };

  const bulkToggleAll = () => {
    if (selectedInView.length && selectedInView.length === filteredReservations.length) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredReservations.map((r) => r.id)));
  };

  const bulkEdit = () => {
    if (selectedInView.length !== 1) return;
    const r = filteredById.get(selectedInView[0]);
    if (r) handleSelect(r);
  };

  const bulkDuplicate = () => {
    if (!selectedInView.length) return;
    selectedInView.forEach((id) => {
      const r = filteredById.get(id);
      if (r) duplicateReservation(r);
    });
  };

  const bulkDelete = () => {
    if (!selectedInView.length) return;
    setConfirmDeleteIds(selectedInView);
  };

  const confirmDelete = () => {
    if (!confirmDeleteIds?.length) return;
    confirmDeleteIds.forEach((id) => {
      const r = filteredById.get(id) || reservations.find((x) => x.id === id);
      if (r) onRemoveReservation(r);
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      confirmDeleteIds.forEach((id) => next.delete(id));
      return next;
    });
    if (selectedId && confirmDeleteIds.includes(selectedId)) {
      setSelectedId(null);
      setDraft(null);
    }
    setConfirmDeleteIds(null);
  };

  return (
    <section className="admin-section">
      <ConfirmDialog
        open={Boolean(confirmDeleteIds?.length)}
        title="מחיקת שריונים"
        description={`למחוק ${confirmDeleteIds?.length || 0} רשומות?`}
        confirmLabel="מחיקה"
        cancelLabel="ביטול"
        tone="danger"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteIds(null)}
      />
      <div className="admin-section-toolbar">
        <div className="admin-filters-stack">
          {showFilters ? (
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
                className={`chip small${filter === "exam" ? " active" : ""}`}
                onClick={() => setFilter("exam")}
              >
                מבחנים ({counts.exam})
              </button>
              <button
                type="button"
                className={`chip small${filter === "closed" ? " active" : ""}`}
                onClick={() => setFilter("closed")}
              >
                סגירות ({counts.closed})
              </button>
            </div>
          ) : null}
            <div className="admin-filter-controls">
            <label>
              חיפוש
              <input
                type="search"
                value={query}
                placeholder="שם / אימייל / חדר / תאריך"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <label>
              חדר
              <select value={roomFilter} onChange={(event) => setRoomFilter(event.target.value)}>
                <option value="all">כל החדרים</option>
                {roomsRaw.map((room) => (
                  <option key={room.id} value={room.id}>{room.name}</option>
                ))}
              </select>
            </label>
            <label>
              מתאריך
              <input type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} />
            </label>
            <label>
              עד תאריך
              <input type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} />
            </label>
            <label>
              מיון
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as ReservationSort)}>
                <option value="date_asc">תאריך (עולה)</option>
                <option value="date_desc">תאריך (יורד)</option>
                <option value="room">חדר</option>
                <option value="name">שם</option>
              </select>
            </label>
              <div className="admin-filter-meta" aria-label="כמות תוצאות">
                {filteredReservations.length} תוצאות
              </div>
            </div>
          </div>
        {reservationsError ? <span className="admin-error">{reservationsError}</span> : null}
      </div>
      <div className="admin-section-body">
        <aside className="admin-properties">
          <div className="admin-card">
            <div className="admin-card-header">
              <h3>{propertiesTitle}</h3>
              {draft ? <span className="admin-meta">{draft.date}</span> : null}
            </div>
            {draft ? (
              <>
                <div className="admin-form-grid">
                  <label>
                    תאריך
                    <input
                      type="date"
                      value={draft.date}
                      onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                    />
                  </label>
                  <label>
                    התחלה
                    <input
                      type="time"
                      value={toTimeInput(draft.time)}
                      onChange={(event) => {
                        const nextStart = parseTimeValue(event.target.value);
                        if (nextStart === null) return;
                        setDraft({ ...draft, time: nextStart });
                      }}
                    />
                  </label>
                  <label>
                    סיום
                    <input
                      type="time"
                      value={toTimeInput(draft.time + (draft.durationMinutes || 60))}
                      onChange={(event) => {
                        const nextEnd = parseTimeValue(event.target.value);
                        if (nextEnd === null) return;
                        if (nextEnd < draft.time) return;
                        setDraft({ ...draft, durationMinutes: Math.max(1, nextEnd - draft.time) });
                      }}
                    />
                  </label>
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
                        const value = event.target.value as "regular" | "special" | "exam" | "closed";
                        setDraft({
                          ...draft,
                          kind: value === "regular" ? undefined : value
                        });
                      }}
                    >
                      <option value="regular">שריון</option>
                      <option value="special">אירוע</option>
                      <option value="exam">מבחן</option>
                      <option value="closed">סגירה</option>
                    </select>
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
              <h3>רשימת שריונים ואירועים</h3>
            </div>
            <div className="admin-list-toolbar">
              <div className="admin-list-toolbar-left">
                <label className="admin-select-all">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    className="admin-row-check"
                    checked={filteredReservations.length > 0 && selectedInView.length === filteredReservations.length}
                    onChange={bulkToggleAll}
                  />
                  <span>בחירה</span>
                </label>
                <span className="admin-meta">
                  {selectedInView.length ? `${selectedInView.length} נבחרו` : `${filteredReservations.length} תוצאות`}
                </span>
              </div>
              <div className="admin-list-toolbar-right">
                <button className="admin-card-action" type="button" onClick={handleNew}>
                  <AddIcon />
                  הוספה
                </button>
                <button className="admin-card-action" type="button" onClick={bulkEdit} disabled={selectedInView.length !== 1}>
                  <EditIcon />
                  עריכה
                </button>
                <button className="admin-card-action" type="button" onClick={bulkDuplicate} disabled={!selectedInView.length}>
                  <DuplicateIcon />
                  שכפול
                </button>
                <button className="admin-card-action" type="button" onClick={bulkDelete} disabled={!selectedInView.length}>
                  <ReleaseIcon />
                  מחיקה
                </button>
              </div>
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
                    <input
                      type="checkbox"
                      className="admin-row-check"
                      checked={selectedIds.has(reservation.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() =>
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(reservation.id)) next.delete(reservation.id);
                          else next.add(reservation.id);
                          return next;
                        })
                      }
                      aria-label="בחר שריון"
                    />
                    <div className="admin-row-main">
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
                      <div className="admin-row-buttons">
                        <button
                          type="button"
                          className="admin-mini-action"
                          aria-label="עריכה"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelect(reservation);
                          }}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          className="admin-mini-action"
                          aria-label="שכפול"
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicateReservation(reservation);
                          }}
                        >
                          <DuplicateIcon />
                        </button>
                        <button
                          type="button"
                          className="admin-mini-action danger"
                          aria-label="מחיקה"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteIds([reservation.id]);
                          }}
                        >
                          <ReleaseIcon />
                        </button>
                      </div>
                      <span className="chip small ghost">{kindLabel(reservation)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="admin-meta">אין רשומות במסנן הזה.</p>
            )}
          </div>
        </div>
      </div>

    </section>
  );
}
