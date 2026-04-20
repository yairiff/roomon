import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { RoomRecord } from "../../../types/admin";
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
  onReorder: (orderedRooms: RoomRecord[]) => void;
  onRemove: (roomId: string) => void;
  onReset: () => void;
  syncEnabled?: boolean;
  isSyncedRoom?: (room: RoomRecord) => boolean;
  onBulkStateChange?: (state: BulkState | null) => void;
};

type RoomShortFilter = "all" | "has" | "missing";
type RoomSort = "order" | "name";

export default function RoomsSection({
  roomsRaw,
  roomsError,
  query,
  roomDraft,
  setRoomDraft,
  toTimeInput,
  parseTimeInput,
  onUpsert,
  onReorder,
  onRemove,
  onReset,
  syncEnabled = false,
  isSyncedRoom = (room) => room.syncSource === "api",
  onBulkStateChange
}: RoomsSectionProps) {
  const [shortFilter, setShortFilter] = useState<RoomShortFilter>("all");
  const [sortBy, setSortBy] = useState<RoomSort>("order");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [isNewEntry, setIsNewEntry] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draggingRoomId, setDraggingRoomId] = useState<string>("");

  const filteredRooms = useMemo(() => {
    let list: RoomRecord[] = roomsRaw;
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
      // order
      return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || aName;
    });
  }, [query, roomsRaw, shortFilter, sortBy]);

  const filteredById = useMemo(() => {
    const map = new Map<string, RoomRecord>();
    filteredRooms.forEach((room) => map.set(room.id, room));
    return map;
  }, [filteredRooms]);

  const selectedInView = useMemo(() => Array.from(selectedIds).filter((id) => filteredById.has(id)), [filteredById, selectedIds]);

  const selectedCount = selectedInView.length;
  const selectionIncludesSynced = selectedInView.some((id) => {
    const room = filteredById.get(id);
    return room ? isSyncedRoom(room) : false;
  });

  const shortCounts = useMemo(() => {
    const base = { all: roomsRaw.length, has: 0, missing: 0 };
    roomsRaw.forEach((room) => {
      const hasShort = Boolean(room.shortName && room.shortName.trim());
      if (hasShort) base.has += 1;
      else base.missing += 1;
    });
    return base;
  }, [roomsRaw]);

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
    name: "שם"
  };

  const selectedRoom = useMemo(() =>
    (selectedRoomId ? roomsRaw.find((room) => room.id === selectedRoomId) || null : null),
  [roomsRaw, selectedRoomId]);

  const canDragRooms = sortBy === "order";

  const handleSelect = (room: RoomRecord) => {
    setSelectedRoomId(room.id);
    setRoomDraft({ ...room });
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
      sortOrder: (room.sortOrder ?? 0) + 1,
      syncSource: "manual"
    };
    onUpsert(copy);
    setSelectedRoomId(newId);
    setRoomDraft(copy);
    setIsEditing(true);
    setIsNewEntry(false);
  };

  const moveRoom = (fromId: string, toId: string) => {
    if (!canDragRooms) return;
    if (!fromId || !toId || fromId === toId) return;
    const ordered = [...roomsRaw].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "he")
    );
    const fromIndex = ordered.findIndex((room) => room.id === fromId);
    const toIndex = ordered.findIndex((room) => room.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...ordered];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onReorder(next.map((room, index) => ({ ...room, sortOrder: index + 1 })));
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
    if (selectionIncludesSynced) return;
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
        {
          id: "edit",
          label: "עריכה",
          icon: <EditIcon />,
          disabled: selectedCount !== 1,
          onClick: bulkEdit
        },
        {
          id: "duplicate",
          label: "שכפול",
          icon: <DuplicateIcon />,
          disabled: selectedCount === 0,
          onClick: bulkDuplicate
        },
        {
          id: "delete",
          label: "מחיקה",
          icon: <ReleaseIcon />,
          tone: "danger",
          disabled: selectedCount === 0 || selectionIncludesSynced,
          onClick: bulkDelete
        }
      ]
    };
  }, [bulkDelete, bulkDuplicate, bulkEdit, bulkToggleAll, filteredRooms.length, handleNew, selectedCount, selectionIncludesSynced]);

  useEffect(() => {
    onBulkStateChange?.(bulkState);
    return () => onBulkStateChange?.(null);
  }, [bulkState, onBulkStateChange]);

  const confirmDelete = () => {
    if (!confirmDeleteIds?.length) return;
    confirmDeleteIds.forEach((id) => {
      const room = roomsRaw.find((entry) => entry.id === id);
      if (room && isSyncedRoom(room)) return;
      onRemove(id);
    });
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
    const target = roomsRaw.find((room) => room.id === selectedRoomId);
    if (target && isSyncedRoom(target)) return;
    setConfirmDeleteIds([selectedRoomId]);
  };

  const roomStatus = isEditing ? (selectedRoom?.name || "חדש") : "";
  const selectedRoomIsSynced = selectedRoom ? isSyncedRoom(selectedRoom) : false;

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
          {syncEnabled ? <p className="admin-meta">סנכרון חדרים פעיל. חדרים מסונכרנים נעולים למחיקת מזהה/מחיקה.</p> : null}
          <fieldset className="admin-fieldset" disabled={!isEditing}>
            <div className="admin-form-grid">
              <label>
                מזהה
                <input
                  type="text"
                  value={roomDraft.id}
                  onChange={(event) => setRoomDraft((prev) => ({ ...prev, id: event.target.value }))}
                  disabled={!isNewEntry || selectedRoomIsSynced}
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
            </div>
          </fieldset>
          <div className="admin-actions">
            <button
              className="primary"
              type="button"
              onClick={() => onUpsert(roomDraft)}
              disabled={!roomDraft.id}
            >
              <ApproveIcon />
              {isNewEntry ? "הוספה" : "עדכון"}
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => (selectedRoom ? duplicateRoom(selectedRoom) : null)}
              disabled={!selectedRoom}
            >
              <DuplicateIcon />
              שכפול
            </button>
            <button className="danger" type="button" onClick={handleDelete} disabled={!selectedRoomId || selectedRoomIsSynced}>
              <ReleaseIcon />
              מחיקה
            </button>
          </div>
        </div>
      </PropsOverlay>
      <div className="admin-section-toolbar">
        <div className="admin-filter-bar" aria-label="סינון ומיון">
          <div className="admin-filter-group scroll" aria-label="סינונים">
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
          {canDragRooms ? <span className="admin-meta">גרור/י שורות כדי לשנות סדר.</span> : null}
        </div>
        {syncEnabled ? <span className="admin-meta">סנכרון חדרים פעיל. אפשר לערוך שם/קיצור/סדר ולהוסיף חדרים ידניים.</span> : null}
        {roomsError ? <span className="admin-error">{roomsError}</span> : null}
      </div>
      <div className="admin-section-body">
        <div className="admin-list">
          {filteredRooms.length ? (
            <div className="admin-table scroll tall">
              {filteredRooms.map((room) => (
                <div
                  key={room.id}
                  className={`admin-row clickable${selectedRoomId === room.id ? " selected" : ""}${draggingRoomId === room.id ? " dragging" : ""}`}
                  role="button"
                  tabIndex={0}
                  draggable={canDragRooms}
                  onDragStart={() => setDraggingRoomId(room.id)}
                  onDragOver={(event) => {
                    if (!canDragRooms) return;
                    event.preventDefault();
                  }}
                  onDrop={() => {
                    if (!draggingRoomId || draggingRoomId === room.id) return;
                    moveRoom(draggingRoomId, room.id);
                    setDraggingRoomId("");
                  }}
                  onDragEnd={() => setDraggingRoomId("")}
                  onClick={() => handleSelect(room)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleSelect(room);
                    }
                  }}
                >
                  <span className="admin-row-stripe open" aria-hidden="true" />
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
                  {canDragRooms ? <span className="admin-row-grip" aria-hidden="true">⋮⋮</span> : null}
                  <div className="admin-row-main">
                    <p className="admin-row-title">
                      {room.name}
                      <span className="admin-policy-pill">{isSyncedRoom(room) ? "מסונכרן" : "ידני"}</span>
                    </p>
                    <p className="admin-row-meta">
                      {room.shortName || "ללא קיצור"}
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
                        disabled={isSyncedRoom(room)}
                        >
                          <ReleaseIcon />
                        </button>
                      </div>
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
