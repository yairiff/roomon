import { useEffect, useMemo, useState } from "react";
import { AddIcon, GroupsIcon, UserIcon } from "../../../components/Icons";
import {
  getPeopleCategoryLabel,
  matchesPeopleCategory,
  peopleCategoryOptions,
  type PeopleCategory
} from "../../../lib/peopleDirectory";
import type { DirectoryUser } from "../../../types/admin";

export type ParticipantPickerTab = "people" | "groups";

export type ParticipantPickerGroup = {
  id: string;
  name: string;
  ownerEmail?: string;
  memberEmails?: string[];
  memberCount?: number;
  members?: Array<{ email: string; name?: string; pictureUrl?: string }>;
};

type ParticipantPickerOverlayProps = {
  open: boolean;
  title?: string;
  initialTab?: ParticipantPickerTab;
  peopleEnabled?: boolean;
  groupsEnabled?: boolean;
  peopleHint?: string;
  directoryUsers: DirectoryUser[];
  currentEmail?: string;
  selectedPeopleEmails: string[];
  selectedGroupId?: string;
  groups?: ParticipantPickerGroup[];
  onTogglePerson: (email: string) => void;
  onConfirmPeople: () => void;
  onSelectGroup: (groupId: string) => void;
  onChooseSelf?: () => void;
  onCreateGroup?: () => void;
  onClose: () => void;
};

const initialsFromLabel = (label: string) => {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  return (parts[0] || "?").slice(0, 2).toUpperCase();
};

export default function ParticipantPickerOverlay({
  open,
  title = "הוספת משתתפים",
  initialTab = "people",
  peopleEnabled = true,
  groupsEnabled = false,
  peopleHint,
  directoryUsers,
  currentEmail,
  selectedPeopleEmails,
  selectedGroupId = "",
  groups = [],
  onTogglePerson,
  onConfirmPeople,
  onSelectGroup,
  onChooseSelf,
  onCreateGroup,
  onClose
}: ParticipantPickerOverlayProps) {
  const [requestedTab, setRequestedTab] = useState<ParticipantPickerTab>(initialTab);
  const [peopleSearch, setPeopleSearch] = useState("");
  const [peopleCategory, setPeopleCategory] = useState<PeopleCategory>("all");
  const [groupSearch, setGroupSearch] = useState("");
  const currentEmailNormalized = (currentEmail || "").trim().toLowerCase();
  const selectedPeople = useMemo(
    () => new Set(selectedPeopleEmails.map((email) => email.trim().toLowerCase()).filter(Boolean)),
    [selectedPeopleEmails]
  );
  const usersByEmail = useMemo(() => {
    const map = new Map<string, DirectoryUser>();
    directoryUsers.forEach((user) => map.set(user.email.trim().toLowerCase(), user));
    return map;
  }, [directoryUsers]);

  useEffect(() => {
    if (!open) return;
    const nextTab = initialTab === "groups" && groupsEnabled
      ? "groups"
      : peopleEnabled
        ? "people"
        : "groups";
    setRequestedTab(nextTab);
    setPeopleSearch("");
    setPeopleCategory("all");
    setGroupSearch("");
  }, [groupsEnabled, initialTab, open, peopleEnabled]);

  const activeTab: ParticipantPickerTab = requestedTab === "groups" && groupsEnabled
    ? "groups"
    : peopleEnabled
      ? "people"
      : "groups";

  const people = useMemo(() => {
    const query = peopleSearch.trim().toLowerCase();
    return directoryUsers
      .filter((user) => user.email.trim().toLowerCase() !== currentEmailNormalized)
      .filter((user) => matchesPeopleCategory(user, peopleCategory))
      .filter((user) => {
        if (!query) return true;
        const name = (user.name || "").trim().toLowerCase();
        const email = user.email.trim().toLowerCase();
        const phone = (user.phone || "").trim().toLowerCase();
        const category = getPeopleCategoryLabel(user).toLowerCase();
        return name.includes(query) || email.includes(query) || phone.includes(query) || category.includes(query);
      })
      .sort((left, right) => {
        const leftSelected = selectedPeople.has(left.email.trim().toLowerCase());
        const rightSelected = selectedPeople.has(right.email.trim().toLowerCase());
        if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
        return ((left.name || left.email).trim()).localeCompare((right.name || right.email).trim(), "he");
      });
  }, [currentEmailNormalized, directoryUsers, peopleCategory, peopleSearch, selectedPeople]);

  const filteredGroups = useMemo(() => {
    const query = groupSearch.trim().toLowerCase();
    if (!query) return groups;
    return groups.filter((group) => group.name.trim().toLowerCase().includes(query));
  }, [groupSearch, groups]);

  const getGroupMembers = (group: ParticipantPickerGroup) => {
    const explicitMembers = group.members || [];
    if (explicitMembers.length) {
      return explicitMembers
        .map((member) => {
          const email = member.email.trim().toLowerCase();
          const directoryUser = usersByEmail.get(email);
          return {
            email,
            name: (member.name || directoryUser?.name || email).trim(),
            pictureUrl: (member.pictureUrl || directoryUser?.pictureUrl || "").trim()
          };
        })
        .filter((member) => Boolean(member.email));
    }
    const emails = Array.from(
      new Set(
        [group.ownerEmail || "", ...(group.memberEmails || [])]
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean)
      )
    );
    return emails.map((email) => {
      const user = usersByEmail.get(email);
      return {
        email,
        name: (user?.name || email).trim(),
        pictureUrl: (user?.pictureUrl || "").trim()
      };
    });
  };

  if (!open || (!peopleEnabled && !groupsEnabled)) return null;

  return (
    <div className="groups-overlay-backdrop reserve-group-picker-layer" role="presentation">
      <div
        className="groups-overlay finder-group-picker-overlay reserve-participant-picker-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="groups-overlay-title">{title}</p>
        {peopleEnabled && groupsEnabled ? (
          <div className="reserve-participant-tabs" role="tablist" aria-label="סוג משתתפים">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "people"}
              className={activeTab === "people" ? "active" : ""}
              onClick={() => setRequestedTab("people")}
            >
              <UserIcon />
              <span>אנשים</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "groups"}
              className={activeTab === "groups" ? "active" : ""}
              onClick={() => setRequestedTab("groups")}
            >
              <GroupsIcon />
              <span>הרכבים</span>
            </button>
          </div>
        ) : null}

        {activeTab === "people" && peopleEnabled ? (
          <>
            <div className="reserve-participant-filter-row">
              {peopleHint ? <p className="participant-picker-people-hint">{peopleHint}</p> : null}
              <label className="finder-group-search-field">
                <input
                  type="search"
                  value={peopleSearch}
                  placeholder="חיפוש אנשים"
                  onChange={(event) => setPeopleSearch(event.target.value)}
                />
              </label>
              <select
                className="reserve-participant-category"
                aria-label="סינון לפי שנתון"
                value={peopleCategory}
                onChange={(event) => setPeopleCategory(event.target.value as PeopleCategory)}
              >
                {peopleCategoryOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <ul className="groups-chat-list finder-group-picker-list">
              {people.map((user) => {
                const email = user.email.trim().toLowerCase();
                const selected = selectedPeople.has(email);
                const label = (user.name || "").trim() || user.email;
                const pictureUrl = (user.pictureUrl || "").trim();
                return (
                  <li key={`participant-picker-person-${email}`}>
                    <button
                      type="button"
                      className={`groups-chat-item finder-group-picker-item reserve-person-picker-row ${selected ? "active" : ""}`}
                      aria-pressed={selected}
                      onClick={(event) => {
                        event.stopPropagation();
                        onTogglePerson(email);
                      }}
                    >
                      <span className={`finder-member-check ${selected ? "active" : ""}`} aria-hidden="true">
                        {selected ? "✓" : ""}
                      </span>
                      <span className="groups-chat-avatar">
                        {pictureUrl ? <img src={pictureUrl} alt="" loading="lazy" /> : label.slice(0, 1)}
                      </span>
                      <span className="groups-chat-text">
                        <span className="groups-chat-title">{label}</span>
                        <span className="groups-chat-subtitle">{getPeopleCategoryLabel(user)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {!people.length ? <p className="finder-inline-note">לא נמצאו משתמשים.</p> : null}
          </>
        ) : (
          <>
            <label className="finder-group-search-field">
              <input
                type="search"
                value={groupSearch}
                placeholder="חיפוש הרכב"
                onChange={(event) => setGroupSearch(event.target.value)}
              />
            </label>
            <ul className="groups-chat-list finder-group-picker-list">
              {onCreateGroup ? (
                <li key="participant-picker-group-create">
                  <button
                    type="button"
                    className="groups-chat-item finder-group-picker-item finder-group-picker-item-create"
                    onClick={() => {
                      onClose();
                      onCreateGroup();
                    }}
                  >
                    <span className="groups-chat-avatar groups-chat-avatar-group finder-group-create-avatar" aria-hidden="true">
                      <AddIcon />
                    </span>
                    <span className="groups-chat-text"><span className="groups-chat-title">הרכב חדש</span></span>
                  </button>
                </li>
              ) : null}
              {filteredGroups.map((group) => {
                const members = getGroupMembers(group);
                const memberCount = group.memberCount || members.length;
                return (
                  <li key={`participant-picker-group-${group.id}`}>
                    <button
                      type="button"
                      className={`groups-chat-item finder-group-picker-item finder-group-picker-item-group ${group.id === selectedGroupId ? "active" : ""}`}
                      onClick={() => {
                        onSelectGroup(group.id);
                        onClose();
                      }}
                    >
                      <span className="groups-chat-avatar groups-chat-avatar-group reserve-group-selector-icon" aria-hidden="true">
                        <GroupsIcon />
                      </span>
                      <span className="groups-chat-text">
                        <span className="groups-chat-title">{group.name}</span>
                        <span className="groups-chat-subtitle">{`${memberCount} משתתפים`}</span>
                      </span>
                      {members.length ? (
                        <span className="groups-members-stack reserve-group-selector-stack" aria-hidden="true">
                          {members.slice(0, 4).map((member, index) => (
                            <span
                              key={`participant-picker-group-${group.id}-${member.email}`}
                              className="groups-members-stack-item"
                              style={{ zIndex: index + 1 }}
                            >
                              {member.pictureUrl ? (
                                <img src={member.pictureUrl} alt="" loading="lazy" />
                              ) : (
                                <span>{initialsFromLabel(member.name)}</span>
                              )}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {!filteredGroups.length && !onCreateGroup ? <p className="finder-inline-note">אין הרכבים זמינים.</p> : null}
          </>
        )}

        <div className="groups-overlay-actions">
          {onChooseSelf ? (
            <button
              type="button"
              className="chip ghost"
              onClick={() => {
                onChooseSelf();
                onClose();
              }}
            >
              רק אני
            </button>
          ) : <span />}
          {activeTab === "people" && peopleEnabled ? (
            <button
              type="button"
              className="chip active"
              onClick={() => {
                onConfirmPeople();
                onClose();
              }}
            >
              סיום
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
