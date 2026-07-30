import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../lib/firebase";
import type { DirectoryUser } from "../types/admin";

const normalizeEmail = (value: unknown) => String(value || "").trim().toLowerCase();

const normalizeDirectoryUser = (raw: Record<string, unknown>, docId: string): DirectoryUser | null => {
  const data = raw as Partial<DirectoryUser>;
  const email = normalizeEmail(data.email || docId);
  if (!email) return null;
  const cohortStartYear = typeof data.cohortStartYear === "number" ? data.cohortStartYear : undefined;
  const phone =
    typeof raw.phone === "string"
      ? raw.phone
      : typeof raw.phoneNumber === "string"
        ? raw.phoneNumber
        : typeof raw.phone_number === "string"
          ? raw.phone_number
          : typeof raw.mobile === "string"
            ? raw.mobile
            : typeof raw.tel === "string"
              ? raw.tel
              : "";
  const pictureUrl =
    typeof raw.pictureUrl === "string"
      ? raw.pictureUrl
      : typeof raw.picture === "string"
        ? raw.picture
        : typeof raw.photoURL === "string"
          ? raw.photoURL
          : typeof raw.photoUrl === "string"
            ? raw.photoUrl
            : "";
  const themePreference =
    raw.themePreference === "dark" || raw.themePreference === "light"
      ? raw.themePreference
      : undefined;
  return {
    email,
    name: typeof data.name === "string" ? data.name : "",
    role: data.role || "pending",
    betaUser: raw.betaUser === true,
    peopleToolEnabled: raw.peopleToolEnabled === true,
    phone,
    pictureUrl,
    pictureRemoved: raw.pictureRemoved === true,
    themePreference,
    cohortStartYear,
    notes: typeof data.notes === "string" ? data.notes : ""
  };
};

export function useDirectoryUsers(enabled = true) {
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [usersReady, setUsersReady] = useState<boolean>(!db);
  const [usersError, setUsersError] = useState<string>("");
  const sourceDocIdByEmailRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!enabled) {
      setUsers([]);
      setUsersError("");
      setUsersReady(true);
      sourceDocIdByEmailRef.current = new Map();
      return;
    }
    if (!db) {
      setUsersError("Firestore is not configured.");
      setUsersReady(true);
      return;
    }

    const usersRef = collection(db, "users");
    const unsubscribe = onSnapshot(
      usersRef,
      (snapshot) => {
        const byEmail = new Map<string, { user: DirectoryUser; canonicalDoc: boolean; sourceDocId: string }>();
        snapshot.forEach((docSnap) => {
          const raw = docSnap.data() as Record<string, unknown>;
          const nextUser = normalizeDirectoryUser(raw, docSnap.id);
          if (!nextUser) return;
          const canonicalDoc = normalizeEmail(docSnap.id) === nextUser.email;
          const sourceDocId = String(docSnap.id || "").trim();
          if (!sourceDocId) return;
          const existing = byEmail.get(nextUser.email);
          if (!existing) {
            byEmail.set(nextUser.email, { user: nextUser, canonicalDoc, sourceDocId });
            return;
          }
          if (existing.canonicalDoc && !canonicalDoc) return;
          if (!existing.canonicalDoc && canonicalDoc) {
            byEmail.set(nextUser.email, { user: nextUser, canonicalDoc: true, sourceDocId });
          }
        });
        sourceDocIdByEmailRef.current = new Map(
          Array.from(byEmail.entries()).map(([email, entry]) => [email, entry.sourceDocId])
        );
        const next = Array.from(byEmail.values()).map((entry) => entry.user);
        next.sort((a, b) => a.email.localeCompare(b.email));
        setUsers(next);
        setUsersError("");
        setUsersReady(true);
      },
      () => {
        setUsersError("Failed to load users.");
        setUsersReady(true);
      }
    );

    return () => unsubscribe();
  }, [enabled]);

  const userMap = useMemo(() => {
    const map = new Map<string, DirectoryUser>();
    users.forEach((user) => map.set(user.email.toLowerCase(), user));
    return map;
  }, [users]);

  const upsertUser = async (user: DirectoryUser) => {
    if (!db) return;
    const email = normalizeEmail(user.email);
    if (!email) return;
    const targetDocId = sourceDocIdByEmailRef.current.get(email) || email;
    const safeName = String(user.name || "");
    const safeRole = user.role || "pending";
    const safePhone = String(user.phone || "");
    const safePictureUrl = String(user.pictureUrl || "");
    const safeNotes = String(user.notes || "");
    const payload: Record<string, unknown> = {
      email,
      name: safeName,
      role: safeRole,
      betaUser: user.betaUser === true,
      peopleToolEnabled: user.peopleToolEnabled === true,
      phone: safePhone,
      pictureUrl: safePictureUrl,
      pictureRemoved: user.pictureRemoved === true,
      notes: safeNotes,
      cohortStartYear: typeof user.cohortStartYear === "number" ? user.cohortStartYear : null
    };
    if (user.themePreference === "light" || user.themePreference === "dark") {
      payload.themePreference = user.themePreference;
    }
    await setDoc(
      doc(db, "users", targetDocId),
      payload,
      { merge: true }
    );
  };

  const removeUser = async (email: string) => {
    if (!db) return;
    const safe = normalizeEmail(email);
    if (!safe) return;
    const sourceDocId = sourceDocIdByEmailRef.current.get(safe);
    const docIds = Array.from(new Set([safe, sourceDocId].filter((value): value is string => Boolean(value))));
    await Promise.all(docIds.map((docId) => deleteDoc(doc(db, "users", docId))));
  };

  return {
    users,
    userMap,
    usersReady,
    usersError,
    upsertUser,
    removeUser
  };
}
