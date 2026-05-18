import { useEffect, useMemo, useState } from "react";
import { addDays, formatDateKey, formatShortDate, getWeekStart, parseDateKey } from "../../../lib/date";
import { formatMinutes } from "../../../lib/scheduleBuilder";
import { formatDurationLabelHe } from "../../../lib/formatDurationHe";
import type { ReserveRequest } from "../../../types/reservations";
import type { DirectoryUser } from "../../../types/admin";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { AddIcon, ChevronLeftIcon, GroupsIcon } from "../../../components/Icons";
import GroupCreateOverlay from "../components/GroupCreateOverlay";

const initialsFromLabel = (label: string) => {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  return (parts[0] || "?").slice(0, 2).toUpperCase();
};

export type ReserveConfirmOverlayProps = {
  open: boolean;
  title: string;
  room: string;
  dateLine: string;
  request: ReserveRequest;
  limitEnd: number;
  startMinutes: number;
  windowStart: number;
  initialDuration: number;
  initialPrivateDescription?: string;
  userRemainingMinutes: number;
  limitHoursPerRoomPerDay: number;
  limitHoursPerRoomPerWeek: number;
  limitHoursPerDayTotal: number;
  limitHoursPerWeekTotal: number;
  limitMaxDaysForward: number;
  quotaUsage: {
    roomDayUsedMinutes: number;
    roomDayLimitMinutes: number;
    roomWeekUsedMinutes: number;
    roomWeekLimitMinutes: number;
    dayUsedMinutes: number;
    dayLimitMinutes: number;
    weekUsedMinutes: number;
    weekLimitMinutes: number;
  };
  groupOptions?: Array<{
    id: string;
    name: string;
    memberCount?: number;
    members?: Array<{ email: string; name: string; pictureUrl?: string }>;
  }>;
  directoryUsers?: DirectoryUser[];
  currentEmail?: string;
  onCreateGroup?: (name: string, participantEmails?: string[]) => Promise<string | void> | string | void;
  linkedGroupName?: string;
  initialLinkToGroup?: boolean;
  initialGroupId?: string;
  mode?: "create" | "edit";
  onRelease?: () => void;
  onConfirm: (
    startMinutes: number,
    durationMinutes: number,
    privateDescription?: string,
    linkedGroupId?: string,
    rehearsalName?: string
  ) => void;
  onClose: () => void;
};

export default function ReserveConfirmOverlay({
  open,
  title,
  room,
  dateLine,
  request,
  limitEnd,
  startMinutes: initialStart,
  windowStart,
  initialDuration,
  initialPrivateDescription = "",
  userRemainingMinutes,
  limitHoursPerRoomPerDay,
  limitHoursPerRoomPerWeek,
  limitHoursPerDayTotal,
  limitHoursPerWeekTotal,
  limitMaxDaysForward,
  quotaUsage,
  groupOptions = [],
  directoryUsers = [],
  currentEmail,
  onCreateGroup,
  linkedGroupName,
  initialLinkToGroup = false,
  initialGroupId = "",
  mode = "create",
  onRelease,
  onConfirm,
  onClose
}: ReserveConfirmOverlayProps) {
  const roundDownToHalfHourMinutes = (minutes: number) => Math.max(0, Math.floor(minutes / 30) * 30);
  const formatQuotaHours = (minutes: number) => {
    const hours = roundDownToHalfHourMinutes(minutes) / 60;
    return Number.isInteger(hours) ? String(hours) : String(hours);
  };
  const quotaRows = useMemo(() => {
    const now = new Date();
    const requestDay = request.date;
    const requestDate = parseDateKey(requestDay);
    const todayKey = formatDateKey(now);
    const tomorrowKey = formatDateKey(addDays(now, 1));
    const currentWeekStart = getWeekStart(todayKey);
    const currentWeekStartKey = formatDateKey(currentWeekStart);
    const requestWeekStart = getWeekStart(request.date);
    const requestWeekStartKey = formatDateKey(requestWeekStart);
    const requestWeekEndKey = formatDateKey(addDays(requestWeekStart, 6));
    const nextWeekFromTodayKey = formatDateKey(addDays(currentWeekStart, 7));
    const nextDayResetDateKey = formatDateKey(addDays(requestDate, 1));
    const nextWeekStartKey = formatDateKey(addDays(requestWeekStart, 7));
    const nextWeekEndKey = formatDateKey(addDays(requestWeekStart, 13));
    const hoursUntilDayReset = Math.max(
      1,
      Math.ceil((parseDateKey(nextDayResetDateKey).getTime() - now.getTime()) / (60 * 60 * 1000))
    );
    const daysUntilWeekReset = Math.max(
      1,
      Math.ceil((addDays(currentWeekStart, 7).getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    );
    const isCurrentDay = requestDay === todayKey;
    const isNextDay = requestDay === tomorrowKey;
    const isCurrentWeek = requestWeekStartKey === currentWeekStartKey;
    const isNextWeek = requestWeekStartKey === nextWeekFromTodayKey;

    const dailyLabel =
      requestDay === todayKey
        ? "היום"
        : requestDay === tomorrowKey
          ? "מחר"
          : `יום ${formatShortDate(requestDay)}`;
    const weeklyLabel =
      requestWeekStartKey === currentWeekStartKey
        ? "השבוע"
        : requestWeekStartKey === nextWeekFromTodayKey
          ? "שבוע הבא"
          : `שבוע ${formatShortDate(requestWeekStartKey)}-${formatShortDate(requestWeekEndKey)}`;
    const dailyResetLabel = isCurrentDay
      ? `מתאפס בעוד ${hoursUntilDayReset} שעות`
      : isNextDay
        ? `בתאריך ${formatShortDate(nextDayResetDateKey)}`
        : "";
    const weeklyResetLabel = isCurrentWeek
      ? `מתאפס בעוד ${daysUntilWeekReset} ימים`
      : isNextWeek
        ? `בתאריכים ${formatShortDate(nextWeekStartKey)}-${formatShortDate(nextWeekEndKey)}`
        : "";
    const rows = [
      {
        label: dailyLabel,
        used: quotaUsage.dayUsedMinutes,
        limit: quotaUsage.dayLimitMinutes,
        resetLabel: dailyResetLabel
      },
      {
        label: weeklyLabel,
        used: quotaUsage.weekUsedMinutes,
        limit: quotaUsage.weekLimitMinutes,
        resetLabel: weeklyResetLabel
      }
    ];
    return rows
      .filter((row) => Number.isFinite(row.limit) && row.limit > 0)
      .map((row) => {
        const used = Math.max(0, row.used);
        const limit = Math.max(1, row.limit);
        const remaining = Math.max(0, limit - used);
        const percent = Math.max(0, Math.min(100, (remaining / limit) * 100));
        const totalHoursLabel = formatQuotaHours(limit);
        const remainingHoursLabel = formatQuotaHours(remaining);
        return {
          ...row,
          used,
          limit,
          percent,
          totalLabel: totalHoursLabel,
          remainingLabel: remainingHoursLabel,
          summaryLabel: `נותרו ${remainingHoursLabel} שעות`,
          markerPercent: percent
        };
      });
  }, [quotaUsage, request.date]);
  const [startMinutes, setStartMinutes] = useState(initialStart);
  const [endMinutes, setEndMinutes] = useState(initialStart + initialDuration);
  const [privateDescription, setPrivateDescription] = useState(initialPrivateDescription);
  const [infoOpen, setInfoOpen] = useState(false);
  const [linkToGroup, setLinkToGroup] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [groupPickerSearch, setGroupPickerSearch] = useState("");
  const [createGroupOverlayOpen, setCreateGroupOverlayOpen] = useState(false);
  const [createGroupPendingName, setCreateGroupPendingName] = useState("");
  const [rehearsalName, setRehearsalName] = useState("");

  useEffect(() => {
    if (!open) return;
    setStartMinutes(initialStart);
    setEndMinutes(initialStart + initialDuration);
    setPrivateDescription(initialPrivateDescription);
    setInfoOpen(false);
    setLinkToGroup(Boolean(initialLinkToGroup));
    setSelectedGroupId(initialGroupId || groupOptions[0]?.id || "");
    setGroupPickerOpen(false);
    setGroupPickerSearch("");
    setCreateGroupOverlayOpen(false);
    setCreateGroupPendingName("");
    setRehearsalName("");
  }, [groupOptions, initialDuration, initialGroupId, initialLinkToGroup, initialPrivateDescription, initialStart, open]);

  useEffect(() => {
    if (!groupOptions.length) {
      if (selectedGroupId) setSelectedGroupId("");
      if (linkToGroup) setLinkToGroup(false);
      return;
    }
    if (!groupOptions.some((group) => group.id === selectedGroupId)) {
      const preferredId = initialGroupId && groupOptions.some((group) => group.id === initialGroupId)
        ? initialGroupId
        : groupOptions[0].id;
      setSelectedGroupId(preferredId);
    }
  }, [groupOptions, initialGroupId, linkToGroup, selectedGroupId]);

  const selectedGroup = useMemo(
    () => groupOptions.find((group) => group.id === selectedGroupId) || null,
    [groupOptions, selectedGroupId]
  );
  const filteredGroups = useMemo(() => {
    const q = groupPickerSearch.trim().toLowerCase();
    if (!q) return groupOptions;
    return groupOptions.filter((group) => group.name.toLowerCase().includes(q));
  }, [groupOptions, groupPickerSearch]);
  const selectedGroupMembersPreview = useMemo(() => {
    if (!selectedGroup?.members?.length) return [];
    return selectedGroup.members
      .map((member) => ({
        email: (member.email || "").trim().toLowerCase(),
        name: (member.name || "").trim() || member.email,
        pictureUrl: (member.pictureUrl || "").trim()
      }))
      .filter((member) => Boolean(member.email));
  }, [selectedGroup?.members]);

  useEffect(() => {
    if (!createGroupPendingName) return;
    const normalized = createGroupPendingName.trim().toLowerCase();
    if (!normalized) {
      setCreateGroupPendingName("");
      return;
    }
    const matched = [...groupOptions]
      .filter((group) => group.name.trim().toLowerCase() === normalized)
      .sort((a, b) => a.name.localeCompare(b.name, "he"));
    if (!matched.length) return;
    setSelectedGroupId(matched[0].id);
    setLinkToGroup(true);
    setCreateGroupPendingName("");
  }, [createGroupPendingName, groupOptions]);

  const startOptions = useMemo(() => {
    const STEP = 30;
    const MIN_DURATION = 30;
    const options: number[] = [];
    for (let value = windowStart; value + MIN_DURATION <= limitEnd; value += STEP) {
      options.push(value);
    }
    return options;
  }, [limitEnd, windowStart]);

  const STEP = 30;
  const MIN_DURATION = 30;
  const maxDurationForStart = Math.floor(Math.min(limitEnd - startMinutes, userRemainingMinutes) / STEP) * STEP;
  const endOptions = useMemo(() => {
    const options: { end: number; duration: number; label: string }[] = [];
    for (let duration = MIN_DURATION; duration <= maxDurationForStart; duration += STEP) {
      const end = startMinutes + duration;
      options.push({
        end,
        duration,
        label: `${formatMinutes(end)}`
      });
    }
    return options;
  }, [MIN_DURATION, STEP, maxDurationForStart, startMinutes]);

  useEffect(() => {
    const currentDuration = endMinutes - startMinutes;
    const hasMatch = endOptions.some((opt) => opt.duration === currentDuration);
    if (hasMatch) return;
    if (endOptions.length) {
      setEndMinutes(endOptions[0].end);
    } else {
      setEndMinutes(startMinutes);
    }
  }, [endMinutes, endOptions, startMinutes]);

  if (!open || !request) return null;

  const durationMinutes = Math.max(0, endMinutes - startMinutes);
  const linkSelectionInvalid = !linkedGroupName && linkToGroup && !selectedGroupId;
  const linkedToRehearsal = Boolean(linkedGroupName || linkToGroup);
  const privateDescriptionForSubmit = linkedToRehearsal ? undefined : privateDescription.trim();
  const membersCountLabel = selectedGroup
    ? `${selectedGroup.memberCount || 0} משתתפים`
    : "בחר הרכב";

  const openCreateGroupOverlay = () => {
    setGroupPickerOpen(false);
    setCreateGroupOverlayOpen(true);
    setCreateGroupPendingName("");
  };

  return (
    <>
      <div className="reserve-overlay" onClick={onClose}>
        <div
          className="reserve-menu"
          onClick={(event) => {
            event.stopPropagation();
            setInfoOpen(false);
          }}
        >
        <p className="reserve-title">{title}</p>
        <p className="reserve-room">{room}</p>
        <p className="reserve-date">{dateLine}</p>

        <div className="reserve-row" dir="rtl">
          <div className="reserve-field reserve-field-start">
            <div className="reserve-hint-row start">
              <span className="reserve-field-hint">מ</span>
            </div>
            <select
              value={startMinutes}
              onChange={(event) => {
                const nextStart = Number(event.target.value);
                const previousDuration = Math.max(MIN_DURATION, endMinutes - startMinutes);
                setStartMinutes(nextStart);
                const nextMaxRaw = Math.min(limitEnd - nextStart, userRemainingMinutes);
                const nextMax = Math.floor(nextMaxRaw / STEP) * STEP;
                const nextDurationRaw = Math.max(MIN_DURATION, Math.min(previousDuration, nextMax));
                const nextDuration = Math.max(MIN_DURATION, Math.floor(nextDurationRaw / STEP) * STEP);
                setEndMinutes(nextStart + nextDuration);
                setInfoOpen(false);
              }}
            >
              {startOptions.map((option) => (
                <option key={option} value={option}>
                  {formatMinutes(option)}
                </option>
              ))}
            </select>
          </div>

          <div className="reserve-field reserve-field-until">
            <div className="reserve-hint-row end">
              <span className="reserve-field-hint">עד</span>
              <button
                type="button"
                className="reserve-info"
                aria-label="מידע"
                onClick={(event) => {
                  event.stopPropagation();
                  setInfoOpen((value) => !value);
                }}
              >
                <InfoOutlinedIcon fontSize="small" />
              </button>
              <div className={`reserve-tooltip${infoOpen ? " open" : ""}`} role="tooltip">
                <div className="quota-progress-title">מכסת שריונים</div>
                {quotaRows.map((row) => (
                  <div key={`quota-row-${row.label}`} className="quota-progress-row">
                    <div className="quota-progress-head">
                      <span>{row.label}</span>
                      <span className="quota-progress-inline-value">{row.summaryLabel}</span>
                    </div>
                    <span className="quota-progress-wrap" aria-hidden="true">
                      <span className="quota-progress-track">
                        <span className="quota-progress-fill" style={{ width: `${row.percent}%` }} />
                      </span>
                    </span>
                    {row.resetLabel ? (
                      <span className="quota-progress-reset-date">{row.resetLabel}</span>
                    ) : null}
                  </div>
                ))}
                {!quotaRows.length ? (
                  <div>אין מכסות פעילות.</div>
                ) : null}
              </div>
            </div>
            <select
              value={endMinutes}
              onChange={(event) => {
                setEndMinutes(Number(event.target.value));
                setInfoOpen(false);
              }}
            >
              {endOptions.map((option) => (
                <option key={option.end} value={option.end}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="reserve-duration">משך: {formatDurationLabelHe(durationMinutes)}</p>
        {!linkedToRehearsal ? (
          <div className="reserve-field reserve-note-field">
            <label htmlFor="reserve-private-description" className="reserve-field-hint reserve-note-label">
              תיאור אישי (רק בשבילך)
            </label>
            <textarea
              id="reserve-private-description"
              className="reserve-note-input"
              rows={3}
              maxLength={180}
              placeholder="למשל: חזרה לשירימון"
              value={privateDescription}
              onChange={(event) => setPrivateDescription(event.target.value)}
            />
          </div>
        ) : null}

          {linkedGroupName ? (
            <p className="reserve-detail reserve-link-locked">מקושר לחזרה בהרכב: {linkedGroupName}</p>
          ) : groupOptions.length ? (
            <div className="reserve-link-panel" dir="rtl">
              <label className="reserve-link-checkbox">
                <input
                  type="checkbox"
                  checked={linkToGroup}
                  onChange={(event) => setLinkToGroup(event.target.checked)}
                />
                <span>לקשר להרכב וליצור חזרה</span>
              </label>
              {linkToGroup ? (
                <>
                  <button
                    type="button"
                    className="secondary reserve-group-selector"
                    onClick={() => setGroupPickerOpen(true)}
                  >
                    <span className="groups-chat-avatar groups-chat-avatar-group reserve-group-selector-icon" aria-hidden="true">
                      <GroupsIcon />
                    </span>
                    <span className="reserve-group-selector-text">
                      <strong>{selectedGroup?.name || "בחירת הרכב"}</strong>
                      <span>{membersCountLabel}</span>
                    </span>
                    {selectedGroupMembersPreview.length ? (
                      <span className="groups-members-stack reserve-group-selector-stack" aria-hidden="true">
                        {selectedGroupMembersPreview.slice(0, 4).map((member, index) => (
                          <span
                            key={`reserve-selected-group-${member.email}`}
                            className="groups-members-stack-item"
                            style={{ zIndex: index + 1 }}
                            title={member.name}
                          >
                            {member.pictureUrl ? (
                              <img src={member.pictureUrl} alt="" loading="lazy" />
                            ) : (
                              <span>{initialsFromLabel(member.name)}</span>
                            )}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="reserve-group-selector-stack-spacer" aria-hidden="true" />
                    )}
                    <ChevronLeftIcon />
                  </button>
                  <div className="reserve-field reserve-note-field reserve-rehearsal-name-field">
                    <label htmlFor="reserve-rehearsal-name" className="reserve-field-hint reserve-note-label">
                      שם חזרה (אופציונלי)
                    </label>
                    <input
                      id="reserve-rehearsal-name"
                      type="text"
                      maxLength={80}
                      placeholder="לדוגמה: חזרה לשבוע הבא"
                      value={rehearsalName}
                      onChange={(event) => setRehearsalName(event.target.value)}
                    />
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="reserve-actions">
            {mode === "edit" ? (
              <>
                {onRelease ? (
                  <button className="secondary" type="button" onClick={onRelease}>
                    שחרור
                  </button>
                ) : null}
                <button
                  className="primary"
                  type="button"
                  disabled={durationMinutes < MIN_DURATION || linkSelectionInvalid}
                  onClick={() =>
                    onConfirm(
                      startMinutes,
                      durationMinutes,
                      privateDescriptionForSubmit,
                      !linkedGroupName && linkToGroup ? selectedGroupId : undefined,
                      !linkedGroupName && linkToGroup ? rehearsalName.trim() : undefined
                    )
                  }
                >
                  עדכון
                </button>
              </>
            ) : (
              <>
                <button className="secondary" type="button" onClick={onClose}>
                  ביטול
                </button>
                <button
                  className="primary"
                  type="button"
                  disabled={durationMinutes < MIN_DURATION || linkSelectionInvalid}
                  onClick={() =>
                    onConfirm(
                      startMinutes,
                      durationMinutes,
                      privateDescriptionForSubmit,
                      !linkedGroupName && linkToGroup ? selectedGroupId : undefined,
                      !linkedGroupName && linkToGroup ? rehearsalName.trim() : undefined
                    )
                  }
                >
                  אישור
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {groupPickerOpen ? (
        <div className="groups-overlay-backdrop reserve-group-picker-layer" role="presentation" onClick={() => setGroupPickerOpen(false)}>
          <div className="groups-overlay finder-group-picker-overlay" role="dialog" onClick={(event) => event.stopPropagation()}>
            <p className="groups-overlay-title">בחירת הרכב</p>
            <label className="finder-group-search-field">
              <input
                type="search"
                value={groupPickerSearch}
                placeholder="חיפוש הרכב"
                onChange={(event) => setGroupPickerSearch(event.target.value)}
              />
            </label>
            <ul className="groups-chat-list finder-group-picker-list">
              <li key="reserve-group-create">
                <button
                  type="button"
                  className="groups-chat-item finder-group-picker-item finder-group-picker-item-create"
                  onClick={openCreateGroupOverlay}
                >
                  <span className="groups-chat-avatar groups-chat-avatar-group finder-group-create-avatar" aria-hidden="true">
                    <AddIcon />
                  </span>
                  <div className="groups-chat-text">
                    <p className="groups-chat-title">הרכב חדש</p>
                    <p className="groups-chat-subtitle finder-group-create-subtitle-placeholder">placeholder</p>
                  </div>
                </button>
              </li>
              {filteredGroups.map((group) => (
                <li key={`reserve-group-${group.id}`}>
                  <button
                    type="button"
                    className={`groups-chat-item finder-group-picker-item finder-group-picker-item-group ${group.id === selectedGroupId ? "active" : ""}`}
                    onClick={() => {
                      setSelectedGroupId(group.id);
                      setLinkToGroup(true);
                      setGroupPickerOpen(false);
                    }}
                  >
                    <span className="groups-chat-avatar groups-chat-avatar-group reserve-group-selector-icon" aria-hidden="true">
                      <GroupsIcon />
                    </span>
                    <div className="groups-chat-text">
                      <p className="groups-chat-title">{group.name}</p>
                      <p className="groups-chat-subtitle">{`${group.memberCount || 0} משתתפים`}</p>
                    </div>
                    <span className="groups-members-stack reserve-group-selector-stack" aria-hidden="true">
                      {(group.members || []).slice(0, 4).map((member, index) => (
                        <span
                          key={`reserve-group-member-${group.id}-${member.email}`}
                          className="groups-members-stack-item"
                          style={{ zIndex: index + 1 }}
                        >
                          {(member.pictureUrl || "").trim() ? (
                            <img src={String(member.pictureUrl)} alt="" loading="lazy" />
                          ) : (
                            <span>{initialsFromLabel(member.name || member.email)}</span>
                          )}
                        </span>
                      ))}
                    </span>
                    <ChevronLeftIcon />
                  </button>
                </li>
              ))}
            </ul>
            <div className="groups-overlay-actions">
              <button type="button" className="chip ghost" onClick={() => setGroupPickerOpen(false)}>
                סגור
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <GroupCreateOverlay
        open={createGroupOverlayOpen}
        users={directoryUsers}
        currentEmail={currentEmail}
        onClose={() => setCreateGroupOverlayOpen(false)}
        onCreateGroup={onCreateGroup}
        onCreated={(groupId, name) => {
          setCreateGroupOverlayOpen(false);
          if (groupId) {
            setSelectedGroupId(groupId);
            setLinkToGroup(true);
            return;
          }
          setCreateGroupPendingName(name);
        }}
      />
    </>
  );
}
