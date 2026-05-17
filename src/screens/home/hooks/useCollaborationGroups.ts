import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, deleteDoc, doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { normalizeCollaborationGroup } from "../../../lib/collaboration";
import type { CollaborationGroup, GroupRehearsal, RehearsalParticipant } from "../../../types/collaboration";

type UseCollaborationGroupsArgs = {
  email?: string | null;
};

const buildParticipantEmails = (group: Pick<CollaborationGroup, "ownerEmail" | "memberEmails" | "invites">) => {
  const set = new Set<string>([group.ownerEmail]);
  group.memberEmails.forEach((member) => set.add(member));
  group.invites.forEach((invite) => set.add(invite.email));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
};

export function useCollaborationGroups({ email }: UseCollaborationGroupsArgs) {
  const normalizedEmail = useMemo(() => (email || "").trim().toLowerCase(), [email]);
  const [groups, setGroups] = useState<CollaborationGroup[]>([]);
  const [ready, setReady] = useState<boolean>(!db);

  useEffect(() => {
    if (!normalizedEmail || !db) {
      setGroups([]);
      setReady(true);
      return;
    }
    setReady(false);
    const groupsRef = collection(db, "collaborationGroups");
    const unsubscribe = onSnapshot(
      groupsRef,
      (snapshot) => {
        const next: CollaborationGroup[] = [];
        snapshot.forEach((docSnap) => {
          const parsed = normalizeCollaborationGroup(docSnap.data(), docSnap.id);
          if (!parsed) return;
          const invited = parsed.invites.some((invite) => invite.email === normalizedEmail);
          const participates =
            parsed.ownerEmail === normalizedEmail || parsed.participantEmails.includes(normalizedEmail) || invited;
          if (!participates) return;
          next.push(parsed);
        });
        next.sort((a, b) => a.name.localeCompare(b.name, "he"));
        setGroups(next);
        setReady(true);
      },
      () => {
        setReady(true);
      }
    );
    return () => unsubscribe();
  }, [normalizedEmail]);

  const createGroup = useCallback(
    async (name: string) => {
      if (!normalizedEmail || !db) return;
      const cleanName = name.trim();
      if (!cleanName) return;
      const groupsRef = collection(db, "collaborationGroups");
      const groupRef = doc(groupsRef);
      const now = Date.now();
      const created: CollaborationGroup = {
        id: groupRef.id,
        name: cleanName,
        ownerEmail: normalizedEmail,
        memberEmails: [normalizedEmail],
        invites: [],
        participantEmails: [normalizedEmail],
        rehearsals: [],
        createdAt: now,
        updatedAt: now
      };
      await setDoc(groupRef, {
        ...created,
        createdAtServer: serverTimestamp(),
        updatedAtServer: serverTimestamp()
      });
      return groupRef.id;
    },
    [normalizedEmail]
  );

  const saveGroup = useCallback(async (group: CollaborationGroup) => {
    if (!db) return;
    const normalized: CollaborationGroup = {
      ...group,
      name: group.name.trim(),
      memberEmails: Array.from(
        new Set([group.ownerEmail, ...group.memberEmails.map((entry) => entry.trim().toLowerCase())])
      ),
      invites: group.invites.map((invite) => ({ ...invite, email: invite.email.trim().toLowerCase() })),
      participantEmails: buildParticipantEmails(group),
      rehearsals: (group.rehearsals || []).slice(),
      updatedAt: Date.now()
    };
    await setDoc(
      doc(db, "collaborationGroups", normalized.id),
      {
        ...normalized,
        updatedAtServer: serverTimestamp()
      },
      { merge: true }
    );
  }, []);

  const inviteToGroup = useCallback(
    async (groupId: string, inviteeEmail: string) => {
      if (!normalizedEmail || !db) return;
      const group = await getDoc(doc(db, "collaborationGroups", groupId))
        .then((snap) => (snap.exists() ? normalizeCollaborationGroup(snap.data(), snap.id) : null))
        .catch(() => null);
      if (!group) return;
      if (group.ownerEmail !== normalizedEmail) return;
      const normalizedInvitee = inviteeEmail.trim().toLowerCase();
      if (!normalizedInvitee || normalizedInvitee === normalizedEmail) return;
      if (group.memberEmails.includes(normalizedInvitee)) return;
      const now = Date.now();
      const memberSet = new Set<string>([group.ownerEmail, ...group.memberEmails, normalizedInvitee]);
      const nextRehearsals = (group.rehearsals || []).map((rehearsal) => {
        const alreadyParticipant = rehearsal.participants.some((participant) => participant.email === normalizedInvitee);
        if (alreadyParticipant) return rehearsal;
        return {
          ...rehearsal,
          participants: [
            ...rehearsal.participants,
            {
              email: normalizedInvitee,
              status: "pending" as const,
              updatedAt: now
            }
          ]
        };
      });
      await saveGroup({
        ...group,
        memberEmails: Array.from(memberSet),
        invites: group.invites.filter((invite) => invite.email !== normalizedInvitee),
        rehearsals: nextRehearsals
      });
    },
    [normalizedEmail, saveGroup]
  );

  const respondToInvite = useCallback(
    async (groupId: string, accept: boolean) => {
      if (!normalizedEmail) return;
      const group = groups.find((entry) => entry.id === groupId);
      if (!group) return;
      const invite = group.invites.find((entry) => entry.email === normalizedEmail);
      if (!invite || invite.status !== "pending") return;
      const now = Date.now();
      const nextInvites = group.invites.map((entry) =>
        entry.email === normalizedEmail
          ? { ...entry, status: accept ? "accepted" : "declined", respondedAt: now }
          : entry
      );
      const memberSet = new Set(group.memberEmails);
      if (accept) {
        memberSet.add(normalizedEmail);
      }
      await saveGroup({
        ...group,
        invites: nextInvites,
        memberEmails: Array.from(memberSet)
      });
    },
    [groups, normalizedEmail, saveGroup]
  );

  const removeMember = useCallback(
    async (groupId: string, memberEmail: string) => {
      if (!normalizedEmail || !db) return;
      const group = await getDoc(doc(db, "collaborationGroups", groupId))
        .then((snap) => (snap.exists() ? normalizeCollaborationGroup(snap.data(), snap.id) : null))
        .catch(() => null);
      if (!group) return;
      if (group.ownerEmail !== normalizedEmail) return;
      const normalizedMember = memberEmail.trim().toLowerCase();
      if (!normalizedMember || normalizedMember === group.ownerEmail) return;
      await saveGroup({
        ...group,
        memberEmails: group.memberEmails.filter((entry) => entry !== normalizedMember),
        invites: group.invites.filter((invite) => invite.email !== normalizedMember),
        rehearsals: (group.rehearsals || []).map((rehearsal) => ({
          ...rehearsal,
          participants: rehearsal.participants.filter((participant) => participant.email !== normalizedMember)
        }))
      });
    },
    [normalizedEmail, saveGroup]
  );

  const renameGroup = useCallback(
    async (groupId: string, nextName: string) => {
      if (!normalizedEmail) return;
      const group = groups.find((entry) => entry.id === groupId);
      if (!group) return;
      if (group.ownerEmail !== normalizedEmail) return;
      const cleanName = nextName.trim();
      if (!cleanName || cleanName === group.name) return;
      await saveGroup({ ...group, name: cleanName });
    },
    [groups, normalizedEmail, saveGroup]
  );

  const updateGroup = useCallback(
    async (groupId: string, updates: { name: string; memberEmails: string[] }) => {
      if (!normalizedEmail || !db) return;
      const group = await getDoc(doc(db, "collaborationGroups", groupId))
        .then((snap) => (snap.exists() ? normalizeCollaborationGroup(snap.data(), snap.id) : null))
        .catch(() => null);
      if (!group) return;
      if (group.ownerEmail !== normalizedEmail) return;

      const nextName = (updates.name || "").trim();
      if (!nextName) return;

      const owner = group.ownerEmail;
      const nextMemberEmails = Array.from(
        new Set(
          [owner, ...(updates.memberEmails || [])]
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean)
        )
      );
      const nextMemberSet = new Set(nextMemberEmails);
      const now = Date.now();

      const nextRehearsals = (group.rehearsals || []).map((rehearsal) => {
        const participantByEmail = new Map(
          rehearsal.participants.map((participant) => [participant.email.trim().toLowerCase(), participant])
        );
        const participants = nextMemberEmails.map((memberEmail) => {
          const existing = participantByEmail.get(memberEmail);
          if (existing) return existing;
          return {
            email: memberEmail,
            status: (memberEmail === owner ? "approved" : "pending") as RehearsalParticipant["status"],
            updatedAt: now
          };
        });
        return { ...rehearsal, participants };
      });

      await saveGroup({
        ...group,
        name: nextName,
        memberEmails: nextMemberEmails,
        invites: group.invites.filter((invite) => !nextMemberSet.has(invite.email)),
        rehearsals: nextRehearsals
      });
    },
    [normalizedEmail, saveGroup]
  );

  const deleteGroupById = useCallback(
    async (groupId: string) => {
      if (!normalizedEmail || !db) return;
      const group = groups.find((entry) => entry.id === groupId);
      if (!group) return;
      if (group.ownerEmail !== normalizedEmail) return;
      await deleteDoc(doc(db, "collaborationGroups", groupId));
    },
    [groups, normalizedEmail]
  );

  const leaveGroup = useCallback(
    async (groupId: string) => {
      if (!normalizedEmail) return;
      const group = groups.find((entry) => entry.id === groupId);
      if (!group) return;
      if (group.ownerEmail === normalizedEmail) return;
      const memberSet = new Set(group.memberEmails.map((entry) => entry.trim().toLowerCase()));
      if (!memberSet.has(normalizedEmail)) return;
      await saveGroup({
        ...group,
        memberEmails: group.memberEmails.filter((entry) => entry.trim().toLowerCase() !== normalizedEmail),
        invites: group.invites.filter((invite) => invite.email !== normalizedEmail),
        rehearsals: (group.rehearsals || []).map((rehearsal) => ({
          ...rehearsal,
          participants: rehearsal.participants.filter((participant) => participant.email !== normalizedEmail)
        }))
      });
    },
    [groups, normalizedEmail, saveGroup]
  );

  const addGroupRehearsal = useCallback(
    async (groupId: string, rehearsal: GroupRehearsal) => {
      if (!normalizedEmail) return;
      const group = groups.find((entry) => entry.id === groupId);
      if (!group) return;
      if (!group.memberEmails.includes(normalizedEmail)) return;
      const rehearsals = [...(group.rehearsals || [])];
      const existingIndex = rehearsals.findIndex((entry) => entry.id === rehearsal.id);
      if (existingIndex >= 0) {
        rehearsals[existingIndex] = rehearsal;
      } else {
        rehearsals.push(rehearsal);
      }
      await saveGroup({ ...group, rehearsals });
    },
    [groups, normalizedEmail, saveGroup]
  );

  const respondToRehearsal = useCallback(
    async (groupId: string, rehearsalId: string, status: RehearsalParticipant["status"]) => {
      if (!normalizedEmail) return;
      const group = groups.find((entry) => entry.id === groupId);
      if (!group) return;
      const rehearsals = (group.rehearsals || []).map((rehearsal) => {
        if (rehearsal.id !== rehearsalId) return rehearsal;
        const nextParticipants = rehearsal.participants.map((participant) =>
          participant.email === normalizedEmail
            ? { ...participant, status, updatedAt: Date.now() }
            : participant
        );
        return { ...rehearsal, participants: nextParticipants };
      });
      await saveGroup({ ...group, rehearsals });
    },
    [groups, normalizedEmail, saveGroup]
  );

  const deleteGroupRehearsal = useCallback(
    async (groupId: string, rehearsalId: string) => {
      if (!normalizedEmail) return;
      const group = groups.find((entry) => entry.id === groupId);
      if (!group) return;
      const rehearsal = (group.rehearsals || []).find((entry) => entry.id === rehearsalId);
      if (!rehearsal) return;
      const isOwner = group.ownerEmail === normalizedEmail;
      const isCreator = rehearsal.createdBy === normalizedEmail;
      if (!isOwner && !isCreator) return;
      await saveGroup({
        ...group,
        rehearsals: (group.rehearsals || []).filter((entry) => entry.id !== rehearsalId)
      });
    },
    [groups, normalizedEmail, saveGroup]
  );

  const pendingInvites = useMemo(
    () =>
      groups
        .filter((group) => group.invites.some((invite) => invite.email === normalizedEmail && invite.status === "pending"))
        .sort((a, b) => a.name.localeCompare(b.name, "he")),
    [groups, normalizedEmail]
  );

  return {
    groups,
    ready,
    pendingInvites,
    createGroup,
    inviteToGroup,
    respondToInvite,
    removeMember,
    updateGroup,
    renameGroup,
    deleteGroup: deleteGroupById,
    leaveGroup,
    addGroupRehearsal,
    respondToRehearsal,
    deleteGroupRehearsal
  };
}
