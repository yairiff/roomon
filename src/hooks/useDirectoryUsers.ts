import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import type { DirectoryUser } from "../types/admin";

export function useDirectoryUsers(enabled = true) {
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [usersReady, setUsersReady] = useState<boolean>(!db);
  const [usersError, setUsersError] = useState<string>("");

  useEffect(() => {
    if (!enabled) {
      setUsers([]);
      setUsersError("");
      setUsersReady(true);
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
        const next: DirectoryUser[] = [];
        snapshot.forEach((docSnap) => {
          const raw = docSnap.data() as Record<string, unknown>;
          const data = raw as Partial<DirectoryUser>;
          const email = (data.email || docSnap.id || "").toLowerCase();
          if (!email) return;
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
          const pictureRemoved = raw.pictureRemoved === true;
          const themePreference =
            raw.themePreference === "dark" || raw.themePreference === "light"
              ? raw.themePreference
              : undefined;
          const betaUser = raw.betaUser === true;
          next.push({
            email,
            name: data.name || "",
            role: data.role || "pending",
            betaUser,
            phone: phone || (data.phone || ""),
            pictureUrl: pictureUrl || "",
            pictureRemoved,
            themePreference,
            cohortStartYear,
            notes: data.notes || ""
          });
        });
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
    const email = user.email.toLowerCase();
    if (!email) return;
    await setDoc(
      doc(db, "users", email),
      {
        ...user,
        email,
        betaUser: user.betaUser === true,
        phone: user.phone || "",
        cohortStartYear: user.cohortStartYear ?? null
      },
      { merge: true }
    );
  };

  const removeUser = async (email: string) => {
    if (!db) return;
    const safe = email.toLowerCase();
    if (!safe) return;
    await deleteDoc(doc(db, "users", safe));
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
