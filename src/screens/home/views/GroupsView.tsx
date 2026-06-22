import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AddIcon,
  ApproveIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  EditIcon,
  GroupsIcon,
  MoreIcon,
  ReleaseIcon,
  SearchIcon
} from "../../../components/Icons";
import GroupCreateOverlay from "../components/GroupCreateOverlay";
import { allWeekDays, defaultWeekDayKeys } from "../../../config";
import { gradeLabelFromCohort } from "../../../lib/academics";
import { addDays, formatDateKey, formatShortDate, getDayKeyFromDateKey } from "../../../lib/date";
import { formatDurationLabelHe } from "../../../lib/formatDurationHe";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import type { DirectoryUser } from "../../../types/admin";
import type { CollaborationGroup, GroupRehearsal, RehearsalParticipant } from "../../../types/collaboration";
import type { DayKey, Room } from "../../../types/schedule";

type GroupsViewProps = {
  currentEmail?: string;
  users: DirectoryUser[];
  rooms: Room[];
  groups: CollaborationGroup[];
  prefilledGroupId?: string;
  pendingInvites: CollaborationGroup[];
  onCreateGroup: (name: string, participantEmails?: string[]) => Promise<string | void> | string | void;
  onInviteUser: (groupId: string, email: string) => Promise<void> | void;
  onRespondToInvite: (groupId: string, accept: boolean) => Promise<void> | void;
  onRenameGroup: (groupId: string, name: string) => Promise<void> | void;
  onEditGroup: (groupId: string, payload: { name: string; memberEmails: string[] }) => Promise<void> | void;
  onDeleteGroup: (groupId: string) => Promise<void> | void;
  onLeaveGroup: (groupId: string) => Promise<void> | void;
  onRemoveMember: (groupId: string, email: string) => Promise<void> | void;
  onAddRehearsal: (groupId: string, rehearsal: GroupRehearsal) => Promise<void> | void;
  onDeleteRehearsal: (
    groupId: string,
    rehearsalId: string,
    options?: { releaseLinkedReservation?: boolean }
  ) => Promise<void> | void;
  onRespondToRehearsal: (
    groupId: string,
    rehearsalId: string,
    status: RehearsalParticipant["status"]
  ) => Promise<void> | void;
  getAvailableRoomsForSlot: (input: {
    dateKey: string;
    dayKey: DayKey;
    startMinutes: number;
    durationMinutes: number;
    excludeReservationId?: string;
  }) => { id: string; name: string }[];
  onOpenFinderForGroup: (groupId: string) => void;
  onTopBarChange?: (context: { title: string; subtitle?: ReactNode | string | null; key: string }) => void;
  policyDayKeys?: DayKey[];
  isActive?: boolean;
  resetToken?: number;
};

const DEFAULT_POLICY_DAY_KEYS: DayKey[] = [...defaultWeekDayKeys];

const displayName = (email: string, usersByEmail: Map<string, DirectoryUser>) => {
  const user = usersByEmail.get(email.toLowerCase());
  const name = (user?.name || "").trim();
  return name || email;
};

const initialsFromLabel = (label: string) => {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  return (parts[0] || "?").slice(0, 2).toUpperCase();
};

const memberYearSubtitle = (user: DirectoryUser) => {
  const grade = gradeLabelFromCohort(user.cohortStartYear);
  if (grade === "א" || grade === "ב" || grade === "ג") return `שנה ${grade}׳`;
  if (grade === "בוגר") return "בוגר/ת";
  return "צוות";
};

const parseTimeToMinutes = (value: string) => {
  const matched = value.trim().match(/^(\d{2}):(\d{2})$/);
  if (!matched) return null;
  const hours = Number(matched[1]);
  const minutes = Number(matched[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const nextRehearsal = (group: CollaborationGroup) => {
  const sorted = [...(group.rehearsals || [])].sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
    return a.startMinutes - b.startMinutes;
  });
  return sorted[0] || null;
};

const canManageRehearsal = (rehearsal: GroupRehearsal, group: CollaborationGroup, currentEmail: string) =>
  group.ownerEmail === currentEmail || rehearsal.createdBy === currentEmail;

export default function GroupsView({
  currentEmail,
  users,
  rooms,
  groups,
  prefilledGroupId,
  pendingInvites,
  onCreateGroup,
  onInviteUser,
  onRespondToInvite,
  onRenameGroup,
  onEditGroup,
  onDeleteGroup,
  onLeaveGroup,
  onRemoveMember,
  onAddRehearsal,
  onDeleteRehearsal,
  onRespondToRehearsal,
  getAvailableRoomsForSlot,
  onOpenFinderForGroup,
  onTopBarChange,
  policyDayKeys = DEFAULT_POLICY_DAY_KEYS,
  isActive = true,
  resetToken
}: GroupsViewProps) {
  const currentEmailNormalized = (currentEmail || "").trim().toLowerCase();
  const [selectedGroupId, setSelectedGroupId] = useState(prefilledGroupId || "");
  const [createOverlayOpen, setCreateOverlayOpen] = useState(false);

  const [rehearsalOverlayOpen, setRehearsalOverlayOpen] = useState(false);
  const [editingRehearsalId, setEditingRehearsalId] = useState<string>("");
  const [rehearsalName, setRehearsalName] = useState("");
  const [rehearsalDate, setRehearsalDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rehearsalStartTime, setRehearsalStartTime] = useState("18:00");
  const [rehearsalEndTime, setRehearsalEndTime] = useState("19:00");
  const [rehearsalReserveRoom, setRehearsalReserveRoom] = useState(false);
  const [rehearsalRoomId, setRehearsalRoomId] = useState("");

  const [detailsRehearsal, setDetailsRehearsal] = useState<GroupRehearsal | null>(null);
  const [rehearsalMenuTarget, setRehearsalMenuTarget] = useState<GroupRehearsal | null>(null);
  const [rehearsalDeleteTarget, setRehearsalDeleteTarget] = useState<GroupRehearsal | null>(null);

  const [groupActionsOpen, setGroupActionsOpen] = useState(false);
  const [groupEditOverlayOpen, setGroupEditOverlayOpen] = useState(false);
  const [deleteGroupOverlayOpen, setDeleteGroupOverlayOpen] = useState(false);
  const allowedPolicyDaySet = useMemo(() => {
    const source = policyDayKeys.length ? policyDayKeys : DEFAULT_POLICY_DAY_KEYS;
    return new Set<DayKey>(source);
  }, [policyDayKeys]);

  useEffect(() => {
    if (prefilledGroupId) {
      setSelectedGroupId(prefilledGroupId);
    }
  }, [prefilledGroupId]);

  useEffect(() => {
    if (!resetToken) return;
    setSelectedGroupId("");
    setDetailsRehearsal(null);
    setRehearsalMenuTarget(null);
    setRehearsalDeleteTarget(null);
    setGroupActionsOpen(false);
    setGroupEditOverlayOpen(false);
    setDeleteGroupOverlayOpen(false);
    setRehearsalOverlayOpen(false);
    setCreateOverlayOpen(false);
    setRehearsalName("");
  }, [resetToken]);

  useEffect(() => {
    if (selectedGroupId && !groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId("");
    }
  }, [groups, selectedGroupId]);

  const usersByEmail = useMemo(() => {
    const map = new Map<string, DirectoryUser>();
    users.forEach((user) => map.set(user.email.toLowerCase(), user));
    return map;
  }, [users]);

  const roomNameById = useMemo(() => {
    const map = new Map<string, string>();
    rooms.forEach((room) => map.set(room.id, room.name));
    return map;
  }, [rooms]);

  const listSorted = useMemo(
    () => [...groups].sort((a, b) => a.name.localeCompare(b.name, "he")),
    [groups]
  );

  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === selectedGroupId) || null,
    [groups, selectedGroupId]
  );

  const editingRehearsal = useMemo(
    () =>
      editingRehearsalId && selectedGroup
        ? (selectedGroup.rehearsals || []).find((entry) => entry.id === editingRehearsalId) || null
        : null,
    [editingRehearsalId, selectedGroup]
  );

  const isGroupOwner = selectedGroup?.ownerEmail === currentEmailNormalized;

  const sortedRehearsals = useMemo(() => {
    if (!selectedGroup) return [];
    return [...(selectedGroup.rehearsals || [])].sort((a, b) => {
      if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
      return a.startMinutes - b.startMinutes;
    });
  }, [selectedGroup]);

  const rehearsalStartMinutes = useMemo(
    () => parseTimeToMinutes(rehearsalStartTime),
    [rehearsalStartTime]
  );
  const rehearsalEndMinutes = useMemo(
    () => parseTimeToMinutes(rehearsalEndTime),
    [rehearsalEndTime]
  );
  const rehearsalDurationMinutes = useMemo(() => {
    if (rehearsalStartMinutes === null || rehearsalEndMinutes === null) return null;
    if (rehearsalEndMinutes <= rehearsalStartMinutes) return null;
    return Math.max(30, Math.round((rehearsalEndMinutes - rehearsalStartMinutes) / 30) * 30);
  }, [rehearsalEndMinutes, rehearsalStartMinutes]);
  const rehearsalRoomOptions = useMemo(() => {
    if (rehearsalStartMinutes === null || !rehearsalDurationMinutes) return [];
    return getAvailableRoomsForSlot({
      dateKey: rehearsalDate,
      dayKey: getDayKeyFromDateKey(rehearsalDate),
      startMinutes: rehearsalStartMinutes,
      durationMinutes: rehearsalDurationMinutes,
      ...(editingRehearsal?.reservationId ? { excludeReservationId: editingRehearsal.reservationId } : {})
    });
  }, [
    editingRehearsal?.reservationId,
    getAvailableRoomsForSlot,
    rehearsalDate,
    rehearsalDurationMinutes,
    rehearsalStartMinutes
  ]);

  useEffect(() => {
    if (!rehearsalOverlayOpen || !rehearsalReserveRoom) return;
    const roomAvailable = rehearsalRoomOptions.some((room) => room.id === rehearsalRoomId);
    if (roomAvailable) return;
    setRehearsalRoomId(rehearsalRoomOptions[0]?.id || "");
  }, [rehearsalOverlayOpen, rehearsalReserveRoom, rehearsalRoomId, rehearsalRoomOptions]);

  const pendingInviteMap = useMemo(() => {
    const map = new Set<string>();
    pendingInvites.forEach((group) => map.add(group.id));
    return map;
  }, [pendingInvites]);

  const groupMembersSorted = useMemo(() => {
    if (!selectedGroup) return [];
    return [...selectedGroup.memberEmails]
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
      .sort((a, b) => {
        const aIsSelf = Boolean(currentEmailNormalized) && a === currentEmailNormalized;
        const bIsSelf = Boolean(currentEmailNormalized) && b === currentEmailNormalized;
        if (aIsSelf && !bIsSelf) return 1;
        if (!aIsSelf && bIsSelf) return -1;
        return displayName(a, usersByEmail).localeCompare(displayName(b, usersByEmail), "he");
      });
  }, [currentEmailNormalized, selectedGroup, usersByEmail]);
  const groupMembersLine = useMemo(() => {
    if (!groupMembersSorted.length) return "";
    return groupMembersSorted
      .map((email) => (email === currentEmailNormalized ? "את/ה" : displayName(email, usersByEmail)))
      .join(", ");
  }, [currentEmailNormalized, groupMembersSorted, usersByEmail]);

  useEffect(() => {
    if (!isActive) return;
    if (!onTopBarChange) return;
    if (!selectedGroup) {
      onTopBarChange({
        title: "הרכבים",
        subtitle: "ניהול הרכבים ומעקב אחרי חזרות",
        key: "groups:list"
      });
      return;
    }
    const subtitle = (
      <div className="groups-topbar-inline groups-topbar-inline-detail">
        <div className="groups-topbar-detail-row">
          <button
            type="button"
            className="groups-topbar-action"
            onClick={() => setSelectedGroupId("")}
            aria-label="חזרה לרשימת הרכבים"
          >
            <ChevronRightIcon />
          </button>
          <div className="groups-chat-avatar groups-chat-avatar-group groups-topbar-group-avatar" aria-hidden="true">
            <GroupsIcon />
          </div>
          <div className="groups-topbar-text">
            <p className="groups-topbar-group-name">{selectedGroup.name}</p>
            <p className="groups-topbar-members">{groupMembersLine}</p>
          </div>
          <button
            type="button"
            className="groups-topbar-action"
            onClick={() => setGroupActionsOpen(true)}
            aria-label="פעולות הרכב"
          >
            <MoreIcon />
          </button>
        </div>
      </div>
    );
    onTopBarChange({
      title: "הרכבים",
      subtitle,
      key: `groups:${selectedGroup.id}:${selectedGroup.name}:${groupMembersLine}`
    });
  }, [groupMembersLine, isActive, isGroupOwner, onTopBarChange, selectedGroup]);

  const openRehearsalOverlay = (rehearsal?: GroupRehearsal) => {
    if (!selectedGroup) return;
    if (!rehearsal) {
      let nextDate = addDays(new Date(), 1);
      let nextDateKey = formatDateKey(nextDate);
      for (let i = 0; i < 14; i += 1) {
        const dayKey = getDayKeyFromDateKey(nextDateKey);
        if (allowedPolicyDaySet.has(dayKey)) break;
        nextDate = addDays(nextDate, 1);
        nextDateKey = formatDateKey(nextDate);
      }
      setEditingRehearsalId("");
      setRehearsalName("");
      setRehearsalDate(nextDateKey);
      setRehearsalStartTime("18:00");
      setRehearsalEndTime("19:00");
      setRehearsalReserveRoom(false);
      setRehearsalRoomId("");
      setRehearsalOverlayOpen(true);
      return;
    }

    setEditingRehearsalId(rehearsal.id);
    setRehearsalName(rehearsal.title === "חזרה" ? "" : rehearsal.title);
    setRehearsalDate(rehearsal.dateKey);
    setRehearsalStartTime(
      `${String(Math.floor(rehearsal.startMinutes / 60)).padStart(2, "0")}:${String(rehearsal.startMinutes % 60).padStart(2, "0")}`
    );
    const rehearsalEndMinutes = rehearsal.startMinutes + rehearsal.durationMinutes;
    setRehearsalEndTime(
      `${String(Math.floor(rehearsalEndMinutes / 60)).padStart(2, "0")}:${String(rehearsalEndMinutes % 60).padStart(2, "0")}`
    );
    setRehearsalReserveRoom(Boolean(rehearsal.roomId));
    setRehearsalRoomId(rehearsal.roomId || "");
    setRehearsalOverlayOpen(true);
  };

  const closeCreateOverlay = () => setCreateOverlayOpen(false);

  const openGroupEditOverlay = () => {
    if (!selectedGroup) return;
    setGroupEditOverlayOpen(true);
  };

  const closeGroupEditOverlay = () => {
    setGroupEditOverlayOpen(false);
  };

  const submitRehearsal = () => {
    if (!selectedGroup || !currentEmailNormalized) return;
    if (rehearsalStartMinutes === null || rehearsalEndMinutes === null || !rehearsalDurationMinutes) return;
    const startMinutes = rehearsalStartMinutes;
    const durationMinutes = rehearsalDurationMinutes;
    if (rehearsalReserveRoom && !rehearsalRoomId) return;
    const participantEmails = Array.from(
      new Set(
        selectedGroup.memberEmails
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean)
      )
    );
    if (!participantEmails.length) return;

    const now = Date.now();
    const existing = editingRehearsal;
    const existingParticipantByEmail = new Map(
      (existing?.participants || []).map((participant) => [participant.email, participant])
    );

    const participants = participantEmails.map((email) => {
      const previous = existingParticipantByEmail.get(email);
      const fallbackStatus: RehearsalParticipant["status"] = email === currentEmailNormalized ? "approved" : "pending";
      const status = previous?.status || fallbackStatus;
      return {
        email,
        status,
        updatedAt: previous?.updatedAt || now
      };
    });

    const rehearsal: GroupRehearsal = {
      id: existing?.id || `reh-${now}-${Math.random().toString(36).slice(2, 8)}`,
      title: rehearsalName.trim() || "חזרה",
      dateKey: rehearsalDate,
      dayKey: getDayKeyFromDateKey(rehearsalDate),
      startMinutes,
      durationMinutes,
      ...(rehearsalReserveRoom && rehearsalRoomId ? { roomId: rehearsalRoomId } : {}),
      ...(rehearsalReserveRoom && existing?.reservationId ? { reservationId: existing.reservationId } : {}),
      mode: { findCommonTime: true, findRoom: rehearsalReserveRoom && Boolean(rehearsalRoomId) },
      participants,
      createdBy: existing?.createdBy || currentEmailNormalized,
      createdAt: existing?.createdAt || now
    };

    void onAddRehearsal(selectedGroup.id, rehearsal);
    setRehearsalOverlayOpen(false);
    setEditingRehearsalId("");
    setRehearsalName("");
    setRehearsalReserveRoom(false);
    setRehearsalRoomId("");
  };

  if (!selectedGroup) {
    return (
      <section className="finder groups-view groups-whatsapp">
        {pendingInvites.length ? (
          <div className="finder-results groups-panel">
            <p className="field-label">הזמנות ממתינות</p>
            <ul className="finder-result-list">
              {pendingInvites.map((group) => (
                <li key={`invite-${group.id}`} className="finder-result">
                  <div>
                    <p className="finder-result-title">{group.name}</p>
                    <p className="finder-result-meta">דורש אישור שלך</p>
                  </div>
                  <div className="groups-inline-actions">
                    <button type="button" className="icon-button" onClick={() => void onRespondToInvite(group.id, true)}>
                      <ApproveIcon />
                    </button>
                    <button type="button" className="icon-button" onClick={() => void onRespondToInvite(group.id, false)}>
                      <CloseIcon />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="finder-results groups-list-panel">
          <ul className="groups-chat-list">
            {listSorted.map((group) => {
              const upcoming = nextRehearsal(group);
              const subtitle = (() => {
                if (!upcoming) return "אין חזרות מתוזמנות";
                const dayKey = upcoming.dayKey || getDayKeyFromDateKey(upcoming.dateKey);
                const weekdayShort = allWeekDays.find((day) => day.key === dayKey)?.short || "";
                const weekdayToken = weekdayShort ? `יום ${weekdayShort}׳` : "יום";
                const endMinutes = upcoming.startMinutes + upcoming.durationMinutes;
                return `הבא: ${weekdayToken} ${formatShortDate(upcoming.dateKey)} · ` +
                  `${formatMinutes(upcoming.startMinutes)}-${formatMinutes(endMinutes)}`;
              })();
              const sortedMemberEmails = Array.from(
                new Set(
                  group.memberEmails
                    .map((email) => email.trim().toLowerCase())
                    .filter(Boolean)
                )
              ).sort((a, b) => {
                const aIsSelf = Boolean(currentEmailNormalized) && a === currentEmailNormalized;
                const bIsSelf = Boolean(currentEmailNormalized) && b === currentEmailNormalized;
                if (aIsSelf && !bIsSelf) return -1;
                if (!aIsSelf && bIsSelf) return 1;
                return displayName(b, usersByEmail).localeCompare(displayName(a, usersByEmail), "he");
              });
              const previewLimit = 4;
              const previewVisibleTarget =
                sortedMemberEmails.length === previewLimit + 1 ? previewLimit + 1 : previewLimit;
              const baseHiddenCount = Math.max(0, sortedMemberEmails.length - previewVisibleTarget);
              const withoutSelf =
                currentEmailNormalized && baseHiddenCount >= 2
                  ? sortedMemberEmails.filter((email) => email !== currentEmailNormalized)
                  : sortedMemberEmails;
              const previewSourceEmails =
                currentEmailNormalized &&
                baseHiddenCount >= 2 &&
                withoutSelf.length >= previewVisibleTarget
                  ? withoutSelf
                  : sortedMemberEmails;
              const previewEmails = previewSourceEmails.slice(
                0,
                Math.min(previewVisibleTarget, previewSourceEmails.length)
              );
              const previewHiddenCount = Math.max(0, sortedMemberEmails.length - previewEmails.length);
              const memberPreview = previewEmails.map((email) => {
                const normalized = email.toLowerCase();
                const user = usersByEmail.get(normalized);
                const name = displayName(normalized, usersByEmail);
                return {
                  email: normalized,
                  name,
                  initials: initialsFromLabel(name),
                  pictureUrl: (user?.pictureUrl || "").trim()
                };
              });
              const hasPendingRehearsalsForMe = Boolean(
                currentEmailNormalized &&
                  (group.rehearsals || []).some((rehearsal) =>
                    rehearsal.participants.some(
                      (participant) =>
                        participant.email === currentEmailNormalized &&
                        participant.status === "pending"
                    )
                  )
              );
              const showPendingBadge = hasPendingRehearsalsForMe || pendingInviteMap.has(group.id);
              return (
                <li key={group.id}>
                  <button
                    type="button"
                    className="groups-chat-item groups-chat-item-group"
                    onClick={() => setSelectedGroupId(group.id)}
                  >
                    <div className="groups-chat-avatar groups-chat-avatar-group" aria-hidden="true">
                      <GroupsIcon />
                      {showPendingBadge ? <span className="groups-icon-pending-badge" /> : null}
                    </div>
                    <div className="groups-chat-text">
                      <p className="groups-chat-title">{group.name}</p>
                      <p className="groups-chat-subtitle">{subtitle}</p>
                    </div>
                    <div className="groups-members-stack groups-members-stack-group" aria-label="משתתפי ההרכב">
                      {memberPreview.map((member, index) => (
                        <span
                          key={`${group.id}-member-preview-${member.email}`}
                          className="groups-members-stack-item"
                          style={{ zIndex: index + 1 }}
                          title={member.name}
                        >
                          {member.pictureUrl ? (
                            <img src={member.pictureUrl} alt="" loading="lazy" />
                          ) : (
                            <span>{member.initials}</span>
                          )}
                        </span>
                      ))}
                      {previewHiddenCount >= 2 ? (
                        <span className="groups-members-stack-item groups-members-stack-count">
                          +{previewHiddenCount}
                        </span>
                      ) : null}
                    </div>
                    <ChevronLeftIcon />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <button
          type="button"
          className="groups-fab"
          onClick={() => setCreateOverlayOpen(true)}
        >
          <AddIcon />
        </button>

        <GroupCreateOverlay
          open={createOverlayOpen}
          users={users}
          currentEmail={currentEmail}
          onClose={closeCreateOverlay}
          onCreateGroup={onCreateGroup}
          memberSubtitle={memberYearSubtitle}
          onCreated={(groupId) => {
            if (groupId) {
              setSelectedGroupId(groupId);
            }
            closeCreateOverlay();
          }}
        />
      </section>
    );
  }

  const currentUserStatus = detailsRehearsal?.participants.find(
    (participant) => participant.email === currentEmailNormalized
  )?.status;
  const detailsApprovedParticipants = detailsRehearsal
    ? detailsRehearsal.participants
      .filter((participant) => participant.status === "approved")
      .map((participant) => participant.email.trim().toLowerCase())
      .filter(Boolean)
    : [];

  return (
    <section className="finder groups-view groups-whatsapp">
      <div className="finder-results groups-panel">
        {sortedRehearsals.length ? (
          <ul className="groups-rehearsal-list">
            {sortedRehearsals.map((rehearsal) => {
              const approvedParticipants = rehearsal.participants
                .filter((participant) => participant.status === "approved")
                .map((participant) => participant.email.trim().toLowerCase())
                .filter(Boolean);
              const rehearsalManageAllowed = canManageRehearsal(rehearsal, selectedGroup, currentEmailNormalized);
              const currentParticipantStatus = rehearsal.participants.find(
                (participant) => participant.email === currentEmailNormalized
              )?.status;
              const dayLabel = allWeekDays.find(
                (day) => day.key === (rehearsal.dayKey || getDayKeyFromDateKey(rehearsal.dateKey))
              )?.label || "";
              const previewVisible = approvedParticipants.slice(0, 4);
              const previewHiddenCount = Math.max(0, approvedParticipants.length - previewVisible.length);
              return (
                <li
                  key={rehearsal.id}
                  className="groups-rehearsal-item-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetailsRehearsal(rehearsal)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setDetailsRehearsal(rehearsal);
                    }
                  }}
                >
                  <div className="groups-rehearsal-row">
                    <div className="groups-rehearsal-row-main">
                      <p className="groups-rehearsal-title">{rehearsal.title || "חזרה"}</p>
                      <p className="groups-rehearsal-meta">
                        יום {dayLabel} · {formatShortDate(rehearsal.dateKey)} · {formatMinutes(rehearsal.startMinutes)}–
                        {formatMinutes(rehearsal.startMinutes + rehearsal.durationMinutes)}
                        {rehearsal.roomId ? ` · ${roomNameById.get(rehearsal.roomId) || rehearsal.roomId}` : ""}
                      </p>
                      <div className="groups-members-stack groups-members-stack-group groups-rehearsal-approved-stack" aria-label="משתתפים שאישרו">
                        {previewVisible.map((email, index) => {
                          const user = usersByEmail.get(email);
                          const name = displayName(email, usersByEmail);
                          const pictureUrl = (user?.pictureUrl || "").trim();
                          return (
                            <span
                              key={`rehearsal-approved-${rehearsal.id}-${email}`}
                              className="groups-members-stack-item"
                              style={{ zIndex: index + 1 }}
                              title={name}
                            >
                              {pictureUrl ? <img src={pictureUrl} alt="" loading="lazy" /> : <span>{initialsFromLabel(name)}</span>}
                            </span>
                          );
                        })}
                        {previewHiddenCount >= 2 ? (
                          <span className="groups-members-stack-item groups-members-stack-count">+{previewHiddenCount}</span>
                        ) : null}
                      </div>
                    </div>
                    {currentParticipantStatus === "pending" ? (
                      <div className="groups-inline-actions">
                        <button
                          type="button"
                          className="icon-button groups-rehearsal-respond-button approve"
                          onClick={(event) => {
                            event.stopPropagation();
                            void onRespondToRehearsal(selectedGroup.id, rehearsal.id, "approved");
                          }}
                          aria-label="אישור"
                        >
                          <ApproveIcon />
                        </button>
                        <button
                          type="button"
                          className="icon-button groups-rehearsal-respond-button decline"
                          onClick={(event) => {
                            event.stopPropagation();
                            void onRespondToRehearsal(selectedGroup.id, rehearsal.id, "declined");
                          }}
                          aria-label="דחייה"
                        >
                          <CloseIcon />
                        </button>
                      </div>
                    ) : null}
                    {rehearsalManageAllowed ? (
                      <button
                        type="button"
                        className="icon-button groups-rehearsal-menu-button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setRehearsalMenuTarget(rehearsal);
                        }}
                        aria-label="פעולות חזרה"
                      >
                        <MoreIcon />
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="groups-rehearsals-empty" role="status" aria-live="polite">
            <p className="groups-rehearsals-empty-title">אין חזרות מתוזמנות</p>
            <p className="groups-rehearsals-empty-meta">אפשר להוסיף חזרה ידנית או לאתר זמן פנוי להרכב.</p>
          </div>
        )}
      </div>

      <div className="groups-fab-stack">
        <button type="button" className="groups-fab-secondary" onClick={() => openRehearsalOverlay()} aria-label="הוספת חזרה ידנית">
          <AddIcon />
        </button>
        <button type="button" className="groups-fab groups-fab-search" onClick={() => onOpenFinderForGroup(selectedGroup.id)} aria-label="איתור חזרה">
          <SearchIcon />
        </button>
      </div>

      {rehearsalOverlayOpen ? (
        <div className="reserve-overlay" role="presentation" onClick={() => setRehearsalOverlayOpen(false)}>
          <div className="reserve-menu groups-rehearsal-reserve-menu" role="dialog" onClick={(event) => event.stopPropagation()}>
            <p className="reserve-title">{editingRehearsalId ? "עריכת חזרה" : "הוספת חזרה"}</p>

            <div className="reserve-row" dir="rtl">
              <div className="reserve-field">
                <div className="reserve-hint-row start">
                  <span className="reserve-field-hint">שם חזרה (אופציונלי)</span>
                </div>
                <input
                  type="text"
                  value={rehearsalName}
                  placeholder="חזרה להרכב"
                  maxLength={80}
                  onChange={(event) => setRehearsalName(event.target.value)}
                />
              </div>
            </div>

            <div className="reserve-row" dir="rtl">
              <div className="reserve-field">
                <div className="reserve-hint-row start">
                  <span className="reserve-field-hint">תאריך</span>
                </div>
                <input type="date" value={rehearsalDate} onChange={(event) => setRehearsalDate(event.target.value)} />
              </div>
            </div>

            <div className="reserve-row" dir="rtl">
              <div className="reserve-field reserve-field-start">
                <div className="reserve-hint-row start">
                  <span className="reserve-field-hint">מ</span>
                </div>
                <input
                  type="time"
                  step={1800}
                  value={rehearsalStartTime}
                  onChange={(event) => setRehearsalStartTime(event.target.value)}
                />
              </div>
              <div className="reserve-field reserve-field-until">
                <div className="reserve-hint-row end">
                  <span className="reserve-field-hint">עד</span>
                </div>
                <input
                  type="time"
                  step={1800}
                  value={rehearsalEndTime}
                  onChange={(event) => setRehearsalEndTime(event.target.value)}
                />
              </div>
            </div>

            {rehearsalDurationMinutes ? <p className="reserve-duration">משך: {formatDurationLabelHe(rehearsalDurationMinutes)}</p> : null}

            <div className="reserve-row groups-rehearsal-reserve-row" dir="rtl">
              <label className="groups-rehearsal-reserve-checkbox">
                <input
                  type="checkbox"
                  checked={rehearsalReserveRoom}
                  onChange={(event) => setRehearsalReserveRoom(event.target.checked)}
                />
                <span>לשריין חדר</span>
              </label>
            </div>

            {rehearsalReserveRoom ? (
              <div className="reserve-row" dir="rtl">
                <div className="reserve-field">
                  <div className="reserve-hint-row start">
                    <span className="reserve-field-hint">חדר זמין בזמן הזה</span>
                  </div>
                  <select
                    value={rehearsalRoomId}
                    onChange={(event) => setRehearsalRoomId(event.target.value)}
                    disabled={!rehearsalRoomOptions.length}
                  >
                    {rehearsalRoomOptions.length ? (
                      rehearsalRoomOptions.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.name}
                        </option>
                      ))
                    ) : (
                      <option value="">אין חדרים פנויים</option>
                    )}
                  </select>
                </div>
              </div>
            ) : null}

            <div className="reserve-actions">
              <button type="button" className="secondary" onClick={() => setRehearsalOverlayOpen(false)}>
                ביטול
              </button>
              <button
                type="button"
                className="primary"
                disabled={
                  rehearsalStartMinutes === null ||
                  rehearsalEndMinutes === null ||
                  rehearsalEndMinutes <= rehearsalStartMinutes ||
                  (rehearsalReserveRoom && !rehearsalRoomId)
                }
                onClick={submitRehearsal}
              >
                {editingRehearsalId ? "עדכון" : "שמירה"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detailsRehearsal ? (
        <div className="groups-overlay-backdrop" role="presentation" onClick={() => setDetailsRehearsal(null)}>
          <div className="groups-overlay groups-rehearsal-details-overlay" role="dialog" onClick={(event) => event.stopPropagation()}>
            <div className="groups-rehearsal-details-head">
              <p className="groups-overlay-title">{detailsRehearsal.title || "חזרה"}</p>
              <p className="groups-rehearsal-meta">
                יום {allWeekDays.find((day) => day.key === (detailsRehearsal.dayKey || getDayKeyFromDateKey(detailsRehearsal.dateKey)))?.label || ""} ·
                {" "}{formatShortDate(detailsRehearsal.dateKey)} · {formatMinutes(detailsRehearsal.startMinutes)}–
                {formatMinutes(detailsRehearsal.startMinutes + detailsRehearsal.durationMinutes)}
              </p>
              {detailsRehearsal.roomId ? (
                <p className="groups-rehearsal-details-room">{roomNameById.get(detailsRehearsal.roomId) || detailsRehearsal.roomId}</p>
              ) : null}
            </div>

            {detailsApprovedParticipants.length ? (
              <div className="groups-rehearsal-details-approved">
                <span className="groups-rehearsal-details-approved-label">משתתפים שאישרו</span>
                <div className="groups-members-stack groups-members-stack-summary groups-rehearsal-approved-stack" aria-label="משתתפים שאישרו">
                  {detailsApprovedParticipants.slice(0, 6).map((email, index) => {
                    const user = usersByEmail.get(email);
                    const name = displayName(email, usersByEmail);
                    const pictureUrl = (user?.pictureUrl || "").trim();
                    return (
                      <span
                        key={`details-approved-${detailsRehearsal.id}-${email}`}
                        className="groups-members-stack-item"
                        style={{ zIndex: index + 1 }}
                        title={name}
                      >
                        {pictureUrl ? <img src={pictureUrl} alt="" loading="lazy" /> : <span>{initialsFromLabel(name)}</span>}
                      </span>
                    );
                  })}
                  {detailsApprovedParticipants.length > 6 ? (
                    <span className="groups-members-stack-item groups-members-stack-count">
                      +{detailsApprovedParticipants.length - 6}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}

            <ul className="groups-rehearsal-details-list">
              {detailsRehearsal.participants.map((participant) => {
                const user = usersByEmail.get(participant.email);
                const name = displayName(participant.email, usersByEmail);
                const pictureUrl = (user?.pictureUrl || "").trim();
                return (
                  <li key={`${detailsRehearsal.id}-${participant.email}`} className="groups-rehearsal-member-row">
                    <div className="groups-chat-avatar">
                      {pictureUrl ? <img src={pictureUrl} alt="" loading="lazy" /> : name.slice(0, 1)}
                    </div>
                    <div className="groups-rehearsal-member-text">
                      <p className="groups-chat-title">{name}</p>
                      <p className="groups-chat-subtitle">{participant.email}</p>
                    </div>
                    <span className={`groups-rehearsal-member-status ${participant.status}`}>
                      {participant.status === "approved" ? "אישר" : participant.status === "declined" ? "דחה" : "ממתין"}
                    </span>
                  </li>
                );
              })}
            </ul>

            {currentUserStatus ? (
              <div className="groups-rehearsal-details-actions">
                <button
                  type="button"
                  className={`groups-rehearsal-details-action decline ${currentUserStatus === "declined" ? "active" : ""}`}
                  onClick={() => {
                    void onRespondToRehearsal(selectedGroup.id, detailsRehearsal.id, "declined");
                    setDetailsRehearsal(null);
                  }}
                >
                  דחייה
                </button>
                <button
                  type="button"
                  className={`groups-rehearsal-details-action approve ${currentUserStatus === "approved" ? "active" : ""}`}
                  onClick={() => {
                    void onRespondToRehearsal(selectedGroup.id, detailsRehearsal.id, "approved");
                    setDetailsRehearsal(null);
                  }}
                >
                  אישור
                </button>
              </div>
            ) : null}

            {canManageRehearsal(detailsRehearsal, selectedGroup, currentEmailNormalized) ? (
              <div className="groups-rehearsal-details-actions groups-rehearsal-details-actions-manage">
                <button
                  type="button"
                  className="groups-rehearsal-details-action ghost"
                  onClick={() => {
                    setDetailsRehearsal(null);
                    openRehearsalOverlay(detailsRehearsal);
                  }}
                >
                  <EditIcon />
                  עריכה
                </button>
                <button
                  type="button"
                  className="groups-rehearsal-details-action danger"
                  onClick={() => {
                    setDetailsRehearsal(null);
                    setRehearsalDeleteTarget(detailsRehearsal);
                  }}
                >
                  <ReleaseIcon />
                  מחיקה
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
 
      {groupActionsOpen && selectedGroup ? (
        <div className="groups-overlay-backdrop" role="presentation" onClick={() => setGroupActionsOpen(false)}>
          <div className="groups-action-sheet" role="dialog" onClick={(event) => event.stopPropagation()}>
            {isGroupOwner ? (
              <>
                <button
                  type="button"
                  className="groups-action-button"
                  onClick={() => {
                    setGroupActionsOpen(false);
                    openGroupEditOverlay();
                  }}
                >
                  <EditIcon />
                  עריכת הרכב
                </button>
                <button
                  type="button"
                  className="groups-action-button danger"
                  onClick={() => {
                    setGroupActionsOpen(false);
                    setDeleteGroupOverlayOpen(true);
                  }}
                >
                  <ReleaseIcon />
                  מחיקת הרכב
                </button>
              </>
            ) : (
              <button
                type="button"
                className="groups-action-button danger"
                onClick={() => {
                  setGroupActionsOpen(false);
                  void onLeaveGroup(selectedGroup.id);
                  setSelectedGroupId("");
                }}
              >
                <ReleaseIcon />
                יציאה מההרכב
              </button>
            )}
          </div>
        </div>
      ) : null}

      {groupEditOverlayOpen && isGroupOwner && selectedGroup ? (
        <GroupCreateOverlay
          open
          users={users}
          currentEmail={currentEmail}
          title="עריכת הרכב"
          createLabel="שמירה"
          initialName={selectedGroup.name}
          initialMemberEmails={selectedGroup.memberEmails.filter(
            (email) => email.trim().toLowerCase() !== selectedGroup.ownerEmail.toLowerCase()
          )}
          onClose={closeGroupEditOverlay}
          onSubmitGroup={async (name, memberEmails) => {
            await Promise.resolve(onEditGroup(selectedGroup.id, { name: name.trim(), memberEmails }));
            closeGroupEditOverlay();
          }}
          memberSubtitle={memberYearSubtitle}
        />
      ) : null}

      {deleteGroupOverlayOpen && isGroupOwner ? (
        <div className="groups-overlay-backdrop" role="presentation" onClick={() => setDeleteGroupOverlayOpen(false)}>
          <div className="groups-overlay" role="dialog" onClick={(event) => event.stopPropagation()}>
            <p className="groups-overlay-title">מחיקת הרכב</p>
            <p className="finder-result-meta">הפעולה תמחק את ההרכב וכל החזרות המשויכות אליו.</p>
            <div className="groups-overlay-actions">
              <button type="button" className="chip ghost" onClick={() => setDeleteGroupOverlayOpen(false)}>
                ביטול
              </button>
              <button
                type="button"
                className="chip danger"
                onClick={() => {
                  void onDeleteGroup(selectedGroup.id);
                  setDeleteGroupOverlayOpen(false);
                  setSelectedGroupId("");
                }}
              >
                מחיקה
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {rehearsalMenuTarget && canManageRehearsal(rehearsalMenuTarget, selectedGroup, currentEmailNormalized) ? (
        <div className="groups-overlay-backdrop" role="presentation" onClick={() => setRehearsalMenuTarget(null)}>
          <div className="groups-action-sheet" role="dialog" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="groups-action-button"
              onClick={() => {
                const target = rehearsalMenuTarget;
                setRehearsalMenuTarget(null);
                if (target) openRehearsalOverlay(target);
              }}
            >
              <EditIcon />
              עריכת חזרה
            </button>
            <button
              type="button"
              className="groups-action-button danger"
              onClick={() => {
                setRehearsalDeleteTarget(rehearsalMenuTarget);
                setRehearsalMenuTarget(null);
              }}
            >
              <ReleaseIcon />
              מחיקת חזרה
            </button>
          </div>
        </div>
      ) : null}

      {rehearsalDeleteTarget ? (
        <div className="groups-overlay-backdrop" role="presentation" onClick={() => setRehearsalDeleteTarget(null)}>
          <div className="groups-overlay" role="dialog" onClick={(event) => event.stopPropagation()}>
            <p className="groups-overlay-title">מחיקת חזרה</p>
            <p className="finder-result-meta">למחוק את "{rehearsalDeleteTarget.title}"?</p>
            {rehearsalDeleteTarget.roomId || rehearsalDeleteTarget.reservationId ? (
              <p className="finder-result-meta">החזרה מקושרת לשריון חדר. אפשר למחוק עם או בלי שחרור החדר.</p>
            ) : null}
            <div className="groups-overlay-actions">
              <button type="button" className="chip ghost" onClick={() => setRehearsalDeleteTarget(null)}>
                ביטול
              </button>
              {rehearsalDeleteTarget.roomId || rehearsalDeleteTarget.reservationId ? (
                <button
                  type="button"
                  className="chip ghost"
                  onClick={() => {
                    void onDeleteRehearsal(selectedGroup.id, rehearsalDeleteTarget.id, {
                      releaseLinkedReservation: false
                    });
                    setRehearsalDeleteTarget(null);
                  }}
                >
                  מחיקה בלבד
                </button>
              ) : null}
              <button
                type="button"
                className="chip danger"
                onClick={() => {
                  void onDeleteRehearsal(selectedGroup.id, rehearsalDeleteTarget.id, {
                    releaseLinkedReservation: true
                  });
                  setRehearsalDeleteTarget(null);
                }}
              >
                {rehearsalDeleteTarget.roomId || rehearsalDeleteTarget.reservationId
                  ? "מחיקה + שחרור חדר"
                  : "מחיקה"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
