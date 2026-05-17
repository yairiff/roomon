import { useEffect, useMemo, useRef, useState } from "react";
import type { DirectoryUser } from "../../../types/admin";

type GroupCreateOverlayProps = {
  open: boolean;
  users: DirectoryUser[];
  currentEmail?: string;
  title?: string;
  createLabel?: string;
  initialName?: string;
  initialMemberEmails?: string[];
  requireName?: boolean;
  onClose: () => void;
  onCreateGroup?: (name: string, participantEmails?: string[]) => Promise<string | void> | string | void;
  onSubmitGroup?: (name: string, participantEmails: string[]) => Promise<string | void> | string | void;
  onCreated?: (groupId: string | null, name: string) => void;
  memberSubtitle?: (user: DirectoryUser) => string;
};

const initialsFromLabel = (label: string) => {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  return (parts[0] || "?").slice(0, 2).toUpperCase();
};

export default function GroupCreateOverlay({
  open,
  users,
  currentEmail,
  title = "הרכב חדש",
  createLabel = "יצירה",
  initialName = "",
  initialMemberEmails = [],
  requireName = true,
  onClose,
  onCreateGroup,
  onSubmitGroup,
  onCreated,
  memberSubtitle
}: GroupCreateOverlayProps) {
  const [name, setName] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [nameError, setNameError] = useState("");
  const memberListRef = useRef<HTMLUListElement | null>(null);
  const wasOpenRef = useRef(false);
  const currentEmailNormalized = (currentEmail || "").trim().toLowerCase();

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!open || wasOpen) return;
    setName(initialName);
    setMemberSearch("");
    setMembers(
      Array.from(
        new Set(
          initialMemberEmails
            .map((entry) => entry.trim().toLowerCase())
            .filter((entry) => Boolean(entry) && entry !== currentEmailNormalized)
        )
      )
    );
    setCreating(false);
    setNameError("");
  }, [currentEmailNormalized, initialMemberEmails, initialName, open]);

  const memberOptions = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    const selectedSet = new Set(members.map((email) => email.toLowerCase()));
    return users
      .filter((user) => user.email.toLowerCase() !== currentEmailNormalized)
      .filter((user) => {
        if (!q) return true;
        const normalizedName = (user.name || "").trim().toLowerCase();
        const normalizedEmail = user.email.toLowerCase();
        return normalizedName.includes(q) || normalizedEmail.includes(q);
      })
      .sort((a, b) => {
        const aSelected = selectedSet.has(a.email.toLowerCase());
        const bSelected = selectedSet.has(b.email.toLowerCase());
        if (aSelected !== bSelected) return aSelected ? -1 : 1;
        return ((a.name || a.email).trim()).localeCompare((b.name || b.email).trim(), "he");
      });
  }, [currentEmailNormalized, memberSearch, members, users]);

  const selectedMembersPreview = useMemo(() => {
    const byEmail = new Map<string, DirectoryUser>();
    users.forEach((user) => byEmail.set(user.email.toLowerCase(), user));
    return members
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
      .map((email) => {
        const user = byEmail.get(email);
        const nameValue = ((user?.name || "").trim() || email).trim();
        return {
          email,
          name: nameValue,
          initials: initialsFromLabel(nameValue),
          pictureUrl: (user?.pictureUrl || "").trim()
        };
      });
  }, [members, users]);

  const toggleMember = (email: string, selected: boolean) => {
    const previousScrollTop = memberListRef.current?.scrollTop ?? 0;
    setMemberSearch("");
    setMembers((prev) => (
      selected ? prev.filter((entry) => entry !== email) : (prev.includes(email) ? prev : [...prev, email])
    ));
    window.requestAnimationFrame(() => {
      if (memberListRef.current) {
        memberListRef.current.scrollTop = previousScrollTop;
      }
    });
  };

  const submit = async () => {
    const cleanName = name.trim();
    if (requireName && !cleanName) {
      setNameError("שם ההרכב הוא שדה חובה.");
      return;
    }
    setNameError("");
    const normalizedMembers = Array.from(
      new Set(
        members
          .map((entry) => entry.trim().toLowerCase())
          .filter((entry) => Boolean(entry) && entry !== currentEmailNormalized)
      )
    );
    if (!normalizedMembers.length) return;
    setCreating(true);
    try {
      const createdGroupId = onSubmitGroup
        ? await onSubmitGroup(cleanName, normalizedMembers)
        : onCreateGroup
          ? await onCreateGroup(cleanName, normalizedMembers)
          : undefined;
      onCreated?.(typeof createdGroupId === "string" && createdGroupId ? createdGroupId : null, cleanName);
    } finally {
      setCreating(false);
    }
  };

  if (!open) return null;

  return (
    <div className="groups-overlay-backdrop reserve-group-picker-layer" role="presentation" onClick={onClose}>
      <div className="groups-overlay finder-group-create-overlay" role="dialog" onClick={(event) => event.stopPropagation()}>
        <p className="groups-overlay-title">{title}</p>
        <label className="reserve-field-hint reserve-note-label" htmlFor="group-create-name-input">
          שם ההרכב {requireName ? "*" : ""}
        </label>
        <input
          id="group-create-name-input"
          type="text"
          className="groups-name-input"
          value={name}
          placeholder="שם ההרכב"
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) setNameError("");
          }}
          required={requireName}
          aria-invalid={Boolean(nameError)}
        />
        {nameError ? <p className="finder-inline-note admin-error">{nameError}</p> : null}
        <label className="finder-group-search-field">
          <input
            type="search"
            value={memberSearch}
            placeholder="חיפוש משתתפים"
            onChange={(event) => setMemberSearch(event.target.value)}
          />
        </label>
        <ul ref={memberListRef} className="groups-chat-list finder-group-picker-list">
          {memberOptions.map((user) => {
            const email = user.email.toLowerCase();
            const selected = members.includes(email);
            const userLabel = (user.name || "").trim() || user.email;
            return (
              <li key={`group-create-member-${user.email}`}>
                <button
                  type="button"
                  className={`groups-chat-item finder-group-picker-item ${selected ? "active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => toggleMember(email, selected)}
                >
                  <div className="groups-chat-avatar">
                    {(user.pictureUrl || "").trim() ? (
                      <img src={String(user.pictureUrl)} alt="" loading="lazy" />
                    ) : (
                      userLabel.slice(0, 1)
                    )}
                  </div>
                  <div className="groups-chat-text">
                    <p className="groups-chat-title">{userLabel}</p>
                    <p className="groups-chat-subtitle">{memberSubtitle ? memberSubtitle(user) : user.email}</p>
                  </div>
                  <span className={`finder-member-check ${selected ? "active" : ""}`} aria-hidden="true">
                    {selected ? "✓" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {!memberOptions.length ? <p className="finder-inline-note">לא נמצאו משתמשים.</p> : null}
        {selectedMembersPreview.length ? (
          <div className="groups-selected-members-summary" aria-live="polite">
            <span className="groups-selected-members-label">משתתפים שנבחרו:</span>
            <div className="groups-members-stack groups-members-stack-summary" aria-label="משתתפים שנבחרו">
              {(() => {
                const previewLimit = 6;
                const visibleCount =
                  selectedMembersPreview.length === previewLimit + 1 ? previewLimit + 1 : previewLimit;
                const hiddenCount = Math.max(0, selectedMembersPreview.length - visibleCount);
                return (
                  <>
                    {selectedMembersPreview.slice(0, visibleCount).map((member, index) => (
                      <span
                        key={`group-create-selected-${member.email}`}
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
                    {hiddenCount >= 2 ? (
                      <span className="groups-members-stack-item groups-members-stack-count">+{hiddenCount}</span>
                    ) : null}
                  </>
                );
              })()}
            </div>
          </div>
        ) : (
          <p className="finder-inline-note">יש לבחור לפחות משתתף אחד נוסף.</p>
        )}
        <div className="groups-overlay-actions">
          <button type="button" className="chip ghost" onClick={onClose} disabled={creating}>
            ביטול
          </button>
          <button
            type="button"
            className="chip active"
            disabled={creating || members.length < 1}
            onClick={() => {
              void submit();
            }}
          >
            {createLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
