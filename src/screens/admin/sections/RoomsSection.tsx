import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { RoomRecord } from "../../../types/admin";
import { rimonScheduleConfig } from "../../../config";
import { AddIcon, ApproveIcon, DuplicateIcon, EditIcon, ReleaseIcon } from "../../../components/Icons";
import type { BulkState } from "../bulk";
import ConfirmDialog from "../components/ConfirmDialog";
import PropsOverlay from "../components/PropsOverlay";
import FilterChip, { closeFilterChip } from "../components/FilterChip";
import RowSelectButton from "../components/RowSelectButton";
import SortSelect from "../components/SortSelect";

type RoomsSectionProps = {
  roomsRaw: RoomRecord[];
  roomsError: string;
  query: string;
  roomDraft: RoomRecord;
  setRoomDraft: Dispatch<SetStateAction<RoomRecord>>;
  toTimeInput: (minutes: number) => string;
  parseTimeInput: (value: string) => number;
  onUpsert: (room: RoomRecord) => void;
  onRemove: (roomId: string) => void;
  onReset: () => void;
  onBulkStateChange?: (state: BulkState | null) => void;
};

type RoomFilter = "all" | "open" | "closed";
type RoomShortFilter = "all" | "has" | "missing";
type RoomSort = "order" | "name" | "open_time" | "closed_first";

export default function RoomsSection({
  roomsRaw,
  roomsError,
  query,
  roomDraft,
  setRoomDraft,
  toTimeInput,
  parseTimeInput,
  onUpsert,
  onRemove,
  onReset,
  onBulkStateChange
}: RoomsSectionProps) {
  const [filter, setFilter] = useState<RoomFilter>("all");
  const [shortFilter, setShortFilter] = useState<RoomShortFilter>("all");
  const [sortBy, setSortBy] = useState<RoomSort>("order");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [isNewEntry, setIsNewEntry] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const filteredRooms = useMemo(() => {
    let list: RoomRecord[] = roomsRaw;
    if (filter !== "all") {
      list = filter === "closed" ? list.filter((room) => room.isClosed) : list.filter((room) => !room.isClosed);
    }
    if (shortFilter !== "all") {
      list = list.filter((room) => {
        const hasShort = Boolean(room.shortName && room.shortName.trim());
        return shortFilter === "has" ? hasShort : !hasShort;
      });
    }
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((room) => {
        const haystack = [room.name, room.shortName || "", room.id].join(" ").toLowerCase();
        return haystack.includes(q);
      });
    }

    return [...list].sort((a, b) => {
      const aName = a.name.localeCompare(b.name, "he");
      if (sortBy === "name") return aName;
      if (sortBy === "open_time") return (a.openMinutes ?? 0) - (b.openMinutes ?? 0) || aName;
      if (sortBy === "closed_first") return Number(b.isClosed) - Number(a.isClosed) || aName;
      // order
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || aName;
    });
  }, [filter, query, roomsRaw, shortFilter, sortBy]);

  const filteredById = useMemo(() => {
    const map = new Map<string, RoomRecord>();
    filteredRooms.forEach((room) => map.set(room.id, room));
    return map;
  }, [filteredRooms]);

  const selectedInView = useMemo(() => Array.from(selectedIds).filter((id) => filteredById.has(id)), [filteredById, selectedIds]);

  const selectedCount = selectedInView.length;

  const shortCounts = useMemo(() => {
    const base = { all: roomsRaw.length, has: 0, missing: 0 };
    roomsRaw.forEach((room) => {
      const hasShort = Boolean(room.shortName && room.shortName.trim());
      if (hasShort) base.has += 1;
      else base.missing += 1;
    });
    return base;
  }, [roomsRaw]);

  const statusCounts = useMemo(() => {
    const base = { all: roomsRaw.length, open: 0, closed: 0 };
    roomsRaw.forEach((room) => {
      if (room.isClosed) base.closed += 1;
      else base.open += 1;
    });
    return base;
  }, [roomsRaw]);

  const filterLabel: Record<RoomFilter, string> = useMemo(
    () => ({
      all: `הכל (${statusCounts.all})`,
      open: `פתוחים (${statusCounts.open})`,
      closed: `סגורים (${statusCounts.closed})`
    }),
    [statusCounts]
  );

  const shortFilterLabel: Record<RoomShortFilter, string> = useMemo(
    () => ({
      all: `הכל (${shortCounts.all})`,
      has: `קיים (${shortCounts.has})`,
      missing: `חסר (${shortCounts.missing})`
    }),
    [shortCounts]
  );

  const sortLabel: Record<RoomSort, string> = {
    order: "סדר תצוגה",
    name: "שם",
    open_time: "שעת פתיחה",
    closed_first: "סגורים קודם"
  };

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

  const duplicateRoom = (room: RoomRecord) => {
    const newId = `${room.id || "room"}-copy-${Date.now()}`;
    const copy: RoomRecord = {
      ...room,
      id: newId,
      name: room.name ? `${room.name} (עותק)` : "חדר (עותק)",
      shortName: room.shortName ? `${room.shortName}*` : "",
      sortOrder: (room.sortOrder ?? 0) + 1
    };
    onUpsert(copy);
    setSelectedRoomId(newId);
    setRoomDraft(copy);
    setIsEditing(true);
    setIsNewEntry(false);
  };

  const bulkToggleAll = () => {
    setSelectedIds((prev) => {
      const idsInView = filteredRooms.map((r) => r.id);
      if (!idsInView.length) return prev;
      const allSelected = idsInView.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        idsInView.forEach((id) => next.delete(id));
      } else {
        idsInView.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const bulkEdit = () => {
    if (selectedCount !== 1) return;
    const room = filteredById.get(selectedInView[0]);
    if (room) handleSelect(room);
  };

  const bulkDuplicate = () => {
    if (!selectedCount) return;
    selectedInView.forEach((id) => {
      const room = filteredById.get(id);
      if (room) duplicateRoom(room);
    });
  };

  const bulkDelete = () => {
    if (!selectedCount) return;
    setConfirmDeleteIds(selectedInView);
  };

  const bulkState = useMemo<BulkState>(() => {
    const total = filteredRooms.length;
    return {
      selectAll: {
        checked: total > 0 && selectedCount === total,
        indeterminate: selectedCount > 0 && selectedCount < total,
        onToggle: bulkToggleAll
      },
      selectedCount,
      totalCount: total,
      actions: [
        { id: "new", label: "הוספה", icon: <AddIcon />, onClick: handleNew },
        { id: "edit", label: "עריכה", icon: <EditIcon />, disabled: selectedCount !== 1, onClick: bulkEdit },
        { id: "duplicate", label: "שכפול", icon: <DuplicateIcon />, disabled: selectedCount === 0, onClick: bulkDuplicate },
        { id: "delete", label: "מחיקה", icon: <ReleaseIcon />, tone: "danger", disabled: selectedCount === 0, onClick: bulkDelete }
      ]
    };
  }, [bulkDelete, bulkDuplicate, bulkEdit, bulkToggleAll, filteredRooms.length, handleNew, selectedCount]);

  useEffect(() => {
    onBulkStateChange?.(bulkState);
    return () => onBulkStateChange?.(null);
  }, [bulkState, onBulkStateChange]);

  const confirmDelete = () => {
    if (!confirmDeleteIds?.length) return;
    confirmDeleteIds.forEach((id) => onRemove(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      confirmDeleteIds.forEach((id) => next.delete(id));
      return next;
    });
    if (selectedRoomId && confirmDeleteIds.includes(selectedRoomId)) {
      setSelectedRoomId(null);
      onReset();
      setIsEditing(false);
      setIsNewEntry(false);
    }
    setConfirmDeleteIds(null);
  };

  const handleDelete = () => {
    if (!selectedRoomId) return;
    setConfirmDeleteIds([selectedRoomId]);
  };

  const roomStatus = isEditing ? (selectedRoom?.name || "חדש") : "";

  const closeEditor = () => {
    setSelectedRoomId(null);
    setIsEditing(false);
    setIsNewEntry(false);
    onReset();
  };

  return (
    <section className="admin-section">
      <ConfirmDialog
        open={Boolean(confirmDeleteIds?.length)}
        title="מחיקת חדרים"
        description={`למחוק ${confirmDeleteIds?.length || 0} חדרים?`}
        confirmLabel="מחיקה"
        cancelLabel="ביטול"
        tone="danger"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteIds(null)}
      />
      <PropsOverlay open={isEditing} title="פרטי חדר" meta={roomStatus || null} onClose={closeEditor}>
        <div className="admin-card">
          <div className="admin-card-header">
            <h3>פרטי חדר</h3>
            {roomStatus ? <span className="admin-meta">{roomStatus}</span> : null}
          </div>
          <fieldset className="admin-fieldset">
            <div className="admin-form-grid">
              <label>
                מזהה
                <input
                  type="text"
                  value={roomDraft.id}
                  onChange={(event) => setRoomDraft((prev) => ({ ...prev, id: event.target.value }))}
                  disabled={!isNewEntry}
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
                  value={roomDraft.shortName || ""}
                  onChange={(event) => setRoomDraft((prev) => ({ ...prev, shortName: event.target.value }))}
                />
              </label>
              <label>
                סדר
                <input
                  type="number"
                  value={roomDraft.sortOrder ?? 0}
                  onChange={(event) => setRoomDraft((prev) => ({ ...prev, sortOrder: Number(event.target.value) }))}
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
              <label className="admin-checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(roomDraft.isClosed)}
                  onChange={(event) => setRoomDraft((prev) => ({ ...prev, isClosed: event.target.checked }))}
                />
                <span>סגור</span>
              </label>
            </div>
          </fieldset>
          <div className="admin-actions">
            <button className="primary" type="button" onClick={() => onUpsert(roomDraft)} disabled={!roomDraft.id || !roomDraft.name}>
              <ApproveIcon />
              {isNewEntry ? "הוספה" : "עדכון"}
            </button>
            <button className="secondary" type="button" onClick={() => (selectedRoom ? duplicateRoom(selectedRoom) : null)} disabled={!selectedRoom}>
              <DuplicateIcon />
              שכפול
            </button>
            <button className="danger" type="button" onClick={handleDelete} disabled={!selectedRoomId}>
              <ReleaseIcon />
              מחיקה
            </button>
          </div>
        </div>
      </PropsOverlay>
      <div className="admin-section-toolbar">
        <div className="admin-filter-bar" aria-label="סינון ומיון">
          <div className="admin-filter-group scroll" aria-label="סינונים">
            <FilterChip label="סטטוס" value={filterLabel[filter]}>
              <div className="admin-filter-options">
                {(Object.keys(filterLabel) as RoomFilter[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`admin-filter-option${filter === key ? " active" : ""}`}
                    onClick={(event) => {
                      setFilter(key);
                      closeFilterChip(event);
                    }}
                  >
                    {filterLabel[key]}
                  </button>
                ))}
              </div>
            </FilterChip>

            <FilterChip label="קיצור" value={shortFilterLabel[shortFilter]}>
              <div className="admin-filter-options">
                {(Object.keys(shortFilterLabel) as RoomShortFilter[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={`admin-filter-option${shortFilter === key ? " active" : ""}`}
                    onClick={(event) => {
                      setShortFilter(key);
                      closeFilterChip(event);
                    }}
                  >
                    {shortFilterLabel[key]}
                  </button>
                ))}
              </div>
            </FilterChip>
          </div>

          <div className="admin-filter-group" aria-label="מיון">
            <SortSelect
              label="מיון"
              value={sortBy}
              options={(Object.keys(sortLabel) as RoomSort[]).map((key) => ({ value: key, label: sortLabel[key] }))}
              onChange={(value) => setSortBy(value as RoomSort)}
            />
          </div>
        </div>
        <div className="admin-filter-summary" aria-label="סיכום">
          <span className="admin-filter-summary-count">
            {selectedInView.length ? `${selectedInView.length} מתוך ${filteredRooms.length} תוצאות` : `${filteredRooms.length} תוצאות`}
          </span>
        </div>
        {roomsError ? <span className="admin-error">{roomsError}</span> : null}
      </div>
      <div className="admin-section-body">
        <div className="admin-list">
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
                  <span className={`admin-row-stripe ${room.isClosed ? "closed" : "open"}`} aria-hidden="true" />
                  <RowSelectButton
                    selected={selectedIds.has(room.id)}
                    label="בחר חדר"
                    onToggle={() =>
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(room.id)) next.delete(room.id);
                        else next.add(room.id);
                        return next;
                      })
                    }
                  />
                  <div className="admin-row-main">
                    <p className="admin-row-title">{room.name}</p>
                    <p className="admin-row-meta">
                      {room.shortName} · {toTimeInput(room.openMinutes || 0)}-{toTimeInput(room.closeMinutes || 0)}
                      {room.isClosed ? " · סגור" : ""}
                    </p>
                  </div>
                  <div className="admin-row-actions">
                    <div className="admin-row-buttons">
                      <button
                        type="button"
                        className="admin-mini-action"
                        aria-label="עריכה"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(room);
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
                          duplicateRoom(room);
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
                          setConfirmDeleteIds([room.id]);
                        }}
                      >
                        <ReleaseIcon />
                      </button>
                    </div>
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
    </section>
  );
}
